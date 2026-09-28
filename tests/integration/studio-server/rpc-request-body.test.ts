import { request as httpRequest } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApplicationSessionAuth } from '../../../apps/studio-server/src/http/application-session-auth.js'
import { createStudioHttpServer } from '../../../apps/studio-server/src/http/http-server.js'
import * as bodyReader from '../../../apps/studio-server/src/http/rpc-request-body.js'

describe('RPC HTTP request budget', () => {
  let server: ReturnType<typeof createStudioHttpServer>
  let origin: string
  let cookie: string
  const call = vi.fn(async () => ({ accepted: true }))

  beforeEach(async () => {
    call.mockClear()
    server = createStudioHttpServer({ auth: createApplicationSessionAuth(), rpcRouter: { call } })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing server address')
    origin = `http://127.0.0.1:${address.port}`
    const response = await fetch(`${origin}/auth/session`, { method: 'POST', headers: { origin } })
    cookie = response.headers.get('set-cookie')!.split(';')[0]!
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await server.shutdown()
  })

  function post(chunks: Buffer[], headers: Record<string, string>, end = true) {
    return new Promise<{ status: number; connection?: string; body: string }>((resolve, reject) => {
      const request = httpRequest(`${origin}/rpc`, {
        method: 'POST', headers: { cookie, 'content-type': 'application/json', ...headers },
      }, response => {
        let body = ''
        response.setEncoding('utf8')
        response.on('data', chunk => { body += chunk })
        response.once('error', reject)
        response.once('end', () => resolve({ status: response.statusCode!, connection: response.headers.connection, body }))
      })
      request.once('error', reject)
      request.flushHeaders()
      for (const chunk of chunks) request.write(chunk)
      if (end) request.end()
    })
  }

  it('returns a complete 413 for a declared body above 384 MiB without waiting for it', async () => {
    expect(bodyReader.maxRpcRequestBodyBytes).toBe(384 * 1024 * 1024)
    const response = await post([], { 'content-length': String(bodyReader.maxRpcRequestBodyBytes + 1) }, false)
    expect(response.status).toBe(413)
    expect(response.connection).toBe('close')
    expect(JSON.parse(response.body)).toMatchObject({ id: null, error: { code: 'rpc.request_too_large' } })
    expect(call).not.toHaveBeenCalled()
  })

  it('rejects an unfinished chunked upload on actual bytes, before parsing or dispatch', async () => {
    const read = bodyReader.readRpcRequestBody
    // Exercise the real reader and HTTP path without allocating a 384 MiB test payload.
    vi.spyOn(bodyReader, 'readRpcRequestBody').mockImplementationOnce((request, signal, limit) => {
      expect(limit).toBe(bodyReader.maxRpcRequestBodyBytes)
      return read(request, signal, 4)
    })
    const response = await post([Buffer.from('中'), Buffer.from('ab')], { 'transfer-encoding': 'chunked' }, false)
    expect(response.status).toBe(413)
    expect(JSON.parse(response.body)).toMatchObject({ error: { code: 'rpc.request_too_large' } })
    expect(call).not.toHaveBeenCalled()
  })

  it('dispatches an exact-limit JSON body with split multibyte text unchanged', async () => {
    const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'test.write', params: { text: '中😀' } }))
    const read = bodyReader.readRpcRequestBody
    vi.spyOn(bodyReader, 'readRpcRequestBody').mockImplementationOnce((request, signal) => read(request, signal, body.length))
    const split = body.indexOf(Buffer.from('中')) + 1
    const response = await post([body.subarray(0, split), body.subarray(split)], { 'content-length': String(body.length) })
    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toMatchObject({ id: 7, result: { accepted: true } })
    expect(call).toHaveBeenCalledExactlyOnceWith('test.write', { text: '中😀' }, expect.objectContaining({ signal: expect.any(AbortSignal) }))
  })
})
