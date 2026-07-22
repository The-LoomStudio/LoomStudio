import type { LogQuery, LogReader } from '@loom-studio/logging'
import { describe, expect, it, vi } from 'vitest'
import { callLogsRpc } from '../../../apps/studio-server/src/logs-rpc.js'

describe('logs.list RPC', () => {
  it('validates and forwards query parameters', () => {
    const query = vi.fn<(input: LogQuery) => ReturnType<LogReader['query']>>(() => ({
      items: [],
      cursor: 'memory:test:0',
      hasMore: false,
    }))

    callLogsRpc({ query }, 'logs.list', {
      limit: 25,
      levels: ['warn', 'error'],
      namespacePrefix: 'runtime.provider',
      since: '2026-07-22T08:00:00Z',
    })

    expect(query).toHaveBeenCalledWith({
      limit: 25,
      cursor: undefined,
      levels: ['warn', 'error'],
      namespacePrefix: 'runtime.provider',
      service: undefined,
      instanceId: undefined,
      since: '2026-07-22T08:00:00.000Z',
      until: undefined,
    })
  })

  it('rejects unsafe limits and empty level filters', () => {
    const logs: LogReader = {
      query: () => ({ items: [], cursor: 'memory:test:0', hasMore: false }),
    }

    expect(() => callLogsRpc(logs, 'logs.list', { limit: 501 })).toThrow('between 1 and 500')
    expect(() => callLogsRpc(logs, 'logs.list', { levels: [] })).toThrow('levels must contain')
  })
})
