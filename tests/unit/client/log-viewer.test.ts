import type { LogPage, LogRecord } from '@loom-studio/logging'
import { describe, expect, it, vi } from 'vitest'
import { createLatestRequestGuard, mergePolledLogRecords, readLogPages, runLatestRequest } from '../../../apps/studio-client/src/features/log-viewer/model/log-feed-model.js'
import { highestLogLevel, moreSevereLogLevel } from '../../../apps/studio-client/src/widgets/log-viewer/log-viewer-model.js'
import { filterLogRecords, logSource } from '../../../apps/studio-client/src/features/log-viewer/model/log-presentation.js'
import { formatLogReport, selectDiagnosticContext } from '../../../apps/studio-client/src/features/log-viewer/model/log-report.js'
import { readLogReferences } from '../../../apps/studio-client/src/features/log-viewer/model/log-references.js'

const records: LogRecord[] = [
  {
    timestamp: '2026-08-05T01:00:00.000Z',
    level: 'info',
    service: 'studio-server',
    instanceId: 'test',
    namespace: 'runtime.provider',
    message: 'Provider connected',
    event: 'PROVIDER_CONNECTED',
    data: { model: 'gpt-test' },
  },
  {
    timestamp: '2026-08-05T01:01:00.000Z',
    level: 'error',
    service: 'studio-server',
    instanceId: 'test',
    namespace: 'runtime.agent',
    message: 'Turn failed',
  },
  {
    timestamp: '2026-08-05T01:02:00.000Z',
    level: 'debug',
    service: 'studio-server',
    instanceId: 'test',
    namespace: 'runtime.provider',
    message: 'Response received',
  },
  {
    timestamp: '2026-08-05T01:03:00.000Z',
    level: 'debug',
    service: 'studio-server',
    instanceId: 'test',
    namespace: 'runtime.provider',
    message: 'Response parsed',
  },
]

describe('log viewer model', () => {
  it('copies bounded failure context with causal IDs, gaps, and no raw private payload', () => {
    const context = selectDiagnosticContext(records)
    expect(context).toEqual(records)
    const withPayload = [{ ...records[1]!, data: { runId: 'run-1', prompt: 'private prompt', toolResult: 'private result' } }]
    const report = formatLogReport({ records: withPayload, version: 'test', capturedAt: 'now', scope: 'server', notices: ['evicted: 10'] })
    expect(report).toContain('run-1')
    expect(report).toContain('evicted: 10')
    expect(report).not.toContain('private prompt')
    expect(report).not.toContain('private result')
    withPayload[0]!.message = 'changed after preview'
    expect(report).not.toContain('changed after preview')
  })
  it('uses structured IDs for references, never private labels or message mention syntax', () => {
    const refs = readLogReferences({ ...records[0]!, message: '<@card:untrusted>', data: { cardId: 'card-1', runId: 'run-1' } })
    expect(refs).toHaveLength(2)
    expect(refs[0]!.uri).toContain('type=card')
    expect(refs.some(ref => ref.uri.includes('untrusted'))).toBe(false)
  })
  it('filters technical successes but keeps RPC failures visible and can isolate a real run ID', () => {
    const input: LogRecord[] = [
      { ...records[0]!, namespace: 'transport.rpc', data: { technical: true, runId: 'run-1' } },
      { ...records[1]!, namespace: 'transport.rpc', data: { technical: true, runId: 'run-1' } },
      { ...records[0]!, data: { runId: 'run-2', durationMs: 12 } },
    ]
    expect(filterLogRecords(input, { query: '', level: 'all', technical: false })).toEqual(input.slice(1))
    expect(filterLogRecords(input, { query: '', level: 'all', technical: false, runId: 'run-1' })).toEqual([input[1]])
    expect(filterLogRecords(input, { query: '', level: 'all', technical: true })).toEqual(input)
    expect(logSource(input[1]!)).toBe('RPC')
  })
  it('preserves reference ID control-character and Unicode boundaries', () => {
    const references = (cardId: string) => readLogReferences({ ...records[0]!, data: { cardId } })
    for (const code of [...Array.from({ length: 32 }, (_, index) => index), 127]) {
      expect(references(`card${String.fromCharCode(code)}id`)).toEqual([])
    }
    for (const id of [' ', '~', '\u0080', '\u009f', '\u2028', '角色😀', 'a'.repeat(1023)]) {
      expect(references(id)).toHaveLength(1)
    }
    expect(references('')).toEqual([])
    expect(references('a'.repeat(1024))).toEqual([])
  })
  it('searches structured fields as well as the visible message', () => {
    const search = (query: string) => filterLogRecords(records, { query, level: 'all', technical: true })
    expect(search('provider connected')).toEqual([records[0]])
    expect(search('gpt-test')).toEqual([records[0]])
    expect(search('missing')).toEqual([])
  })

  it('consumes every server page so the latest logs are not hidden', async () => {
    const pages: LogPage[] = [
      { items: [records[0]!], cursor: 'logs:1', hasMore: true },
      { items: [records[1]!, records[2]!, records[3]!], cursor: 'logs:4', hasMore: false },
    ]
    const list = vi.fn(async () => pages.shift()!)

    await expect(readLogPages(list)).resolves.toEqual({ items: records, cursor: 'logs:4', gap: undefined, truncated: false })
    expect(list).toHaveBeenNthCalledWith(1, { cursor: undefined, limit: 500 })
    expect(list).toHaveBeenNthCalledWith(2, { cursor: 'logs:1', limit: 500 })
  })

  it('reads incrementally from a cursor and reports the highest new severity', async () => {
    const list = vi.fn(async (): Promise<LogPage> => ({ items: [records[2]!, records[1]!], cursor: 'logs:6', hasMore: false }))

    await expect(readLogPages(list, 'logs:4')).resolves.toEqual({
      items: [records[2], records[1]],
      cursor: 'logs:6',
      gap: undefined,
      truncated: false,
    })
    expect(list).toHaveBeenCalledWith({ cursor: 'logs:4', limit: 500 })
    expect(highestLogLevel([records[2]!, records[1]!])).toBe('error')
    expect(moreSevereLogLevel('warn', 'info')).toBe('warn')
  })

  it('merges incremental records within the client buffer and replaces records after a reset gap', () => {
    expect(mergePolledLogRecords([records[0]!], [records[1]!])).toEqual([records[0], records[1]])
    expect(mergePolledLogRecords([records[0]!], [records[1]!], { reason: 'reset' })).toEqual([records[1]])
  })

  it('only commits and finishes the latest refresh when requests resolve out of order', async () => {
    const guard = createLatestRequestGuard()
    const first = deferred<string>()
    const second = deferred<string>()
    const committed: string[] = []
    const finished: string[] = []

    const firstRun = runLatestRequest({
      guard,
      request: () => first.promise,
      onStart: () => undefined,
      onSuccess: value => committed.push(value),
      onError: () => undefined,
      onFinish: () => finished.push('first'),
    })
    const secondRun = runLatestRequest({
      guard,
      request: () => second.promise,
      onStart: () => undefined,
      onSuccess: value => committed.push(value),
      onError: () => undefined,
      onFinish: () => finished.push('second'),
    })

    first.resolve('server')
    await firstRun
    expect(committed).toEqual([])
    expect(finished).toEqual([])

    second.resolve('client')
    await secondRun
    expect(committed).toEqual(['client'])
    expect(finished).toEqual(['second'])
  })

  it('invalidates an in-flight poll snapshot when a refresh begins', () => {
    const guard = createLatestRequestGuard()
    const firstRefresh = guard.begin()
    const pollSnapshot = guard.current()

    expect(guard.isCurrent(firstRefresh)).toBe(true)
    expect(guard.isCurrent(pollSnapshot)).toBe(true)

    const nextRefresh = guard.begin()
    expect(guard.isCurrent(pollSnapshot)).toBe(false)
    expect(guard.isCurrent(nextRefresh)).toBe(true)
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(resolvePromise => { resolve = resolvePromise })
  return { promise, resolve }
}
