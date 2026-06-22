import { createErrorResponse, parseRpcRequest } from '@loom-studio/transport'
import { describe, expect, it } from 'vitest'

describe('transport rpc envelope contract', () => {
  it('parses rpc request metadata and serializes invalid request errors', () => {
    const request = parseRpcRequest({ jsonrpc: '2.0', id: '1', method: 'system.ping', params: {}, meta: { correlationId: 'corr-1' } })
    expect(request.method).toBe('system.ping')
    expect(request.meta?.correlationId).toBe('corr-1')

    const response = createErrorResponse(null, new Error('bad'), 'rpc.invalid_request', {
      clientId: 'client-1',
      correlationId: 'corr-1',
      callId: 'call-1',
    })
    expect(response.error?.code).toBe('rpc.invalid_request')
    expect(response.error?.message).toBe('bad')
    expect(response.meta?.callId).toBe('call-1')
  })
})
