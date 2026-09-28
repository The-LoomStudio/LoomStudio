import { IncomingMessage } from 'node:http'
import { Socket } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { readRpcRequestBody } from '../../../apps/studio-server/src/http/rpc-request-body.js'

const requests: IncomingMessage[] = []
afterEach(() => { for (const request of requests.splice(0)) request.destroy() })

function fixture(headers: IncomingMessage['headers'] = {}) {
  const request = new IncomingMessage(new Socket())
  request.headers = headers
  requests.push(request)
  const controller = new AbortController()
  return { request, controller }
}

describe('RPC request body budget', () => {
  it('preserves UTF-8 split between chunks at the exact byte limit', async () => {
    const { request, controller } = fixture()
    const text = '{"text":"中😀"}'
    const source = Buffer.from(text)
    const reading = readRpcRequestBody(request, controller.signal, source.length)
    for (const byte of source) request.emit('data', Buffer.from([byte]))
    request.emit('end')
    await expect(reading).resolves.toBe(text)
    expect(request.listenerCount('data')).toBe(0)
    expect(request.listenerCount('close')).toBe(0)
  })

  it.each([undefined, '1'])('counts actual bytes even when content-length is %s', async length => {
    const { request, controller } = fixture(length ? { 'content-length': length } : {})
    const reading = readRpcRequestBody(request, controller.signal, 4)
    request.emit('data', Buffer.from('中'))
    request.emit('data', Buffer.from('ab'))
    await expect(reading).rejects.toMatchObject({ code: 'rpc.request_too_large' })
    expect(request.isPaused()).toBe(true)
    expect(request.listenerCount('data')).toBe(0)
    request.emit('data', Buffer.from('must not accumulate'))
    request.emit('end')
  })

  it('rejects an oversized declared body before consuming a chunk', async () => {
    const { request, controller } = fixture({ 'content-length': '5' })
    await expect(readRpcRequestBody(request, controller.signal, 4))
      .rejects.toMatchObject({ code: 'rpc.request_too_large' })
    expect(request.listenerCount('data')).toBe(0)
    expect(request.isPaused()).toBe(true)
    expect(request.destroyed).toBe(false)
  })

  it('counts malformed UTF-8 by wire bytes rather than replacement character size', async () => {
    const { request, controller } = fixture()
    const reading = readRpcRequestBody(request, controller.signal, 1)
    request.emit('data', Buffer.from([0xff]))
    request.emit('end')
    await expect(reading).resolves.toBe('\ufffd')
  })

  it.each(['abort', 'close', 'error'] as const)('settles a partial request on %s and removes listeners', async outcome => {
    const { request, controller } = fixture()
    const reading = readRpcRequestBody(request, controller.signal, 16)
    request.emit('data', Buffer.from('partial'))
    if (outcome === 'abort') controller.abort(new Error('Cancelled'))
    else if (outcome === 'error') request.emit('error', new Error('Read failed'))
    else request.emit('close')
    await expect(reading).rejects.toThrow()
    for (const event of ['data', 'end', 'close', 'error']) expect(request.listenerCount(event)).toBe(0)
    expect(request.isPaused()).toBe(true)
  })

  it('does not start reading when already cancelled', async () => {
    const { request, controller } = fixture()
    const error = new Error('Already cancelled')
    controller.abort(error)
    await expect(readRpcRequestBody(request, controller.signal, 16)).rejects.toBe(error)
    expect(request.listenerCount('data')).toBe(0)
  })
})
