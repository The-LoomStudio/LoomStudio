import type { LogPage, LogRecord } from '@loom-studio/logging'
import { describe, expect, it, vi } from 'vitest'
import { createLatestRequestGuard, mergePolledLogRecords, readLogPages, runLatestRequest } from '../../../apps/studio-client/src/features/log-viewer/model/log-feed-model.js'
import { buildLogStream, highestLogLevel, matchesLogSearch, moreSevereLogLevel } from '../../../apps/studio-client/src/widgets/log-viewer/log-viewer-model.js'

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
  it('only groups adjacent records with the same namespace on the chronological timeline', () => {
    const stream = buildLogStream([records[3]!, records[1]!, records[0]!, records[2]!])

    expect(stream).toEqual([
      { kind: 'record', record: records[0] },
      { kind: 'record', record: records[1] },
      {
        kind: 'group',
        namespace: 'runtime.provider',
        records: [records[2], records[3]],
        firstTimestamp: records[2]?.timestamp,
        lastTimestamp: records[3]?.timestamp,
      },
    ])
  })

  it('searches structured fields as well as the visible message', () => {
    expect(matchesLogSearch(records[0]!, 'provider connected')).toBe(true)
    expect(matchesLogSearch(records[0]!, 'gpt-test')).toBe(true)
    expect(matchesLogSearch(records[0]!, 'missing')).toBe(false)
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
