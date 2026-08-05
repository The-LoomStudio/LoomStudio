import type { LogPage, LogRecord } from '@loom-studio/logging'
import { describe, expect, it, vi } from 'vitest'
import { buildLogStream, highestLogLevel, matchesLogSearch, moreSevereLogLevel, readLogPages } from './log-viewer-model.js'

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
})
