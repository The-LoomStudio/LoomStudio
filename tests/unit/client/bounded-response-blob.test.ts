import { createServer } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { readBoundedResponseBlob } from '../../../apps/studio-client/src/shared/browser/download.js'

function responseStream(chunks: Uint8Array[], headers?: HeadersInit, cancelFailure = false) {
  let index = 0
  const cancel = vi.fn(() => {
    if (cancelFailure) throw new Error('Cancel failed')
  })
  const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
    if (index < chunks.length) controller.enqueue(chunks[index++]!)
    else controller.close()
  })
  const response = new Response(new ReadableStream({ pull, cancel }, { highWaterMark: 0 }), { headers })
  return { response, pull, cancel }
}

describe('bounded response download', () => {
  it.each([undefined, 'invalid', '1'])('stops at the first overflowing chunk with content-length %s', async length => {
    const { response, pull, cancel } = responseStream(
      Array.from({ length: 10 }, () => new Uint8Array(4)),
      length === undefined ? undefined : { 'content-length': length },
    )
    await expect(readBoundedResponseBlob(response, 8, 'Too large')).rejects.toThrow('Too large')
    expect(pull).toHaveBeenCalledTimes(3)
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(response.body?.locked).toBe(false)
  })

  it('cancels a declared oversized response before reading it', async () => {
    const { response, pull, cancel } = responseStream([new Uint8Array(1)], { 'content-length': '9' })
    await expect(readBoundedResponseBlob(response, 8, 'Too large')).rejects.toThrow('Too large')
    expect(pull).not.toHaveBeenCalled()
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('preserves binary bytes and MIME at exactly the limit without a length header', async () => {
    const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
    const { response, cancel } = responseStream([signature.subarray(0, 3), signature.subarray(3)], { 'content-type': 'image/png' })
    const blob = await readBoundedResponseBlob(response, signature.length, 'Too large')
    expect(blob.type).toBe('image/png')
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(signature)
    expect(cancel).not.toHaveBeenCalled()
    expect(response.body?.locked).toBe(false)
  })

  it('counts encoded bytes rather than text characters', async () => {
    const bytes = new TextEncoder().encode('你好')
    expect(bytes.byteLength).toBe(6)
    const { response, cancel } = responseStream([bytes.subarray(0, 3), bytes.subarray(3)])
    await expect(readBoundedResponseBlob(response, 5, 'Too large')).rejects.toThrow('Too large')
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('keeps the size error when stream cancellation fails', async () => {
    const { response } = responseStream([new Uint8Array(9)], undefined, true)
    await expect(readBoundedResponseBlob(response, 8, 'Too large')).rejects.toThrow('Too large')
    expect(response.body?.locked).toBe(false)
  })

  it('propagates read failures and releases the reader', async () => {
    const failure = new Error('Connection interrupted')
    const response = new Response(new ReadableStream({
      pull(controller) { controller.error(failure) },
    }))
    await expect(readBoundedResponseBlob(response, 8, 'Too large')).rejects.toBe(failure)
    expect(response.body?.locked).toBe(false)
  })

  it('keeps an empty response empty', async () => {
    const blob = await readBoundedResponseBlob(new Response(null, { status: 204 }), 8, 'Too large')
    expect(blob.size).toBe(0)
  })

  it('rejects a real fetch body when its download is aborted', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/zip' })
      response.write('partial')
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const controller = new AbortController()
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Missing test server port')
      const response = await fetch(`http://127.0.0.1:${address.port}`, { signal: controller.signal })
      const read = readBoundedResponseBlob(response, 128, 'Too large')
      controller.abort()
      await expect(read).rejects.toMatchObject({ name: 'AbortError' })
      expect(response.body?.locked).toBe(false)
    } finally {
      controller.abort()
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  })
})
