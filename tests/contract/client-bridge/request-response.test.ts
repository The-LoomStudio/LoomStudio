import { createClientBridge } from '@loom-studio/client-bridge'
import type { RpcResponse } from '@loom-studio/transport'
import { describe, expect, it } from 'vitest'

function createFetch(response: RpcResponse): typeof fetch {
  return (async (_input: RequestInfo | URL, init?: RequestInit) => {
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as typeof fetch
}

describe('client bridge request-response contract', () => {
  it('sends json rpc requests and returns result payloads', async () => {
    const bridge = createClientBridge({
      endpoint: 'http://localhost/rpc',
      fetch: createFetch({
        jsonrpc: '2.0',
        id: 'client-1',
        result: { ok: true },
        meta: { clientId: 'test', correlationId: 'corr-1', callId: 'call-1' },
      }),
    })

    await bridge.connect()
    const result = await bridge.call('system.ping', { echo: 'hello' })

    expect(bridge.getConnectionState()).toBe('connected')
    expect(result).toEqual({ ok: true })
  })

  it('surfaces rpc error responses', async () => {
    const bridge = createClientBridge({
      endpoint: 'http://localhost/rpc',
      fetch: createFetch({
        jsonrpc: '2.0',
        id: 'client-1',
        error: { code: 'rpc.handler_failed', message: 'boom' },
        meta: { clientId: 'test', correlationId: 'corr-1', callId: 'call-1' },
      }),
    })

    await expect(bridge.call('system.bad')).rejects.toThrow('boom')
  })

  it('keeps raw request access for tests and low-level diagnostics', async () => {
    const bridge = createClientBridge({
      endpoint: 'http://localhost/rpc',
      fetch: createFetch({
        jsonrpc: '2.0',
        id: 7,
        result: { items: [] },
        meta: { clientId: 'test', correlationId: 'corr-1', callId: 'call-1' },
      }),
    })

    const response = await bridge.request({ jsonrpc: '2.0', id: 7, method: 'diagnostics.list' })

    expect(response.result).toEqual({ items: [] })
  })
})
