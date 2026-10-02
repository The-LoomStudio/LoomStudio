import { createAssetStore } from '@loom-studio/asset-store'
import { createBlobStore } from '@loom-studio/blob-store'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createId, nowIso } from '@loom-studio/shared'
import { once } from 'node:events'
import { ReadStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { get, type IncomingMessage, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { createApplicationSessionAuth } from '../../../apps/studio-server/src/http/application-session-auth.js'
import { createStudioHttpServer } from '../../../apps/studio-server/src/http/http-server.js'

async function listen(options: Omit<Parameters<typeof createStudioHttpServer>[0], 'auth'>) {
  const server = createStudioHttpServer({ ...options, auth: createApplicationSessionAuth() })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing test server address')
  const origin = `http://127.0.0.1:${address.port}`
  const session = await fetch(`${origin}/auth/session`, { method: 'POST', headers: { origin } })
  const cookie = session.headers.get('set-cookie')!.split(';')[0]!
  return { server, origin, cookie }
}

async function openEventSocket({ server, origin, cookie }: Awaited<ReturnType<typeof listen>>) {
  const serverResponse = Promise.withResolvers<ServerResponse>()
  const clientResponse = Promise.withResolvers<IncomingMessage>()
  const capture = (request: IncomingMessage, response: ServerResponse) => {
    if (request.url === '/extensions/events') serverResponse.resolve(response)
  }
  server.on('request', capture)
  const request = get(`${origin}/extensions/events`, { headers: { cookie }, agent: false }, stream => {
    stream.pause()
    stream.on('error', () => {})
    clientResponse.resolve(stream)
  })
  request.on('error', clientResponse.reject)
  try {
    const [response, stream] = await Promise.all([serverResponse.promise, clientResponse.promise])
    const closed = new Promise<void>(resolve => stream.once('close', resolve))
    return { request, response, stream, closed }
  } catch (error) {
    request.destroy()
    throw error
  } finally {
    server.off('request', capture)
  }
}

describe('HTTP request lifecycle', () => {
  it('bounds multi-frame SSE output under socket backpressure and disposes the slow subscriber exactly once', async () => {
    type Events = NonNullable<Parameters<typeof createStudioHttpServer>[0]['extensionEvents']>
    let emit!: Parameters<Events['subscribe']>[0]
    const dispose = vi.fn()
    const endpoint = await listen({
      rpcRouter: { call: async () => null },
      extensionEvents: { subscribe: handler => { emit = handler; return { dispose } } },
    })
    const client = await openEventSocket(endpoint)
    const socket = client.response.socket!
    const serverClosed = once(client.response, 'close')
    const socketClosed = once(socket, 'close')
    try {
      expect(client.stream.statusCode).toBe(200)
      socket.cork()
      const framePayloadBytes = 16 * 1024
      const maximumBufferedBytes = 256 * 1024
      let frames = 0
      let peakBytes = 0
      while (!client.response.destroyed && frames < 32) {
        emit({ name: 'data.changed', meta: { eventId: `frame-${frames}` }, data: { payload: 'x'.repeat(framePayloadBytes) } } as never)
        frames += 1
        peakBytes = Math.max(peakBytes, client.response.writableLength)
        expect(client.response.writableLength).toBeLessThanOrEqual(maximumBufferedBytes)
      }
      expect(frames).toBeGreaterThan(1)
      expect(frames * framePayloadBytes).toBeGreaterThanOrEqual(maximumBufferedBytes)
      expect(peakBytes).toBeGreaterThan(maximumBufferedBytes - 2 * framePayloadBytes)
      expect(client.response.destroyed).toBe(true)
      await Promise.all([serverClosed, socketClosed])
      client.stream.resume()
      await client.closed
      expect(client.stream.aborted).toBe(true)
      await expect.poll(() => dispose.mock.calls.length).toBe(1)
      emit({ name: 'data.changed', meta: { eventId: 'after-close' }, data: {} } as never)
      client.request.destroy()
      await endpoint.server.shutdown()
      expect(dispose).toHaveBeenCalledOnce()
    } finally {
      client.request.destroy()
      await endpoint.server.shutdown()
    }
  })

  it('resumes SSE after a real socket drain and cancels the backpressure deadline', async () => {
    type Events = NonNullable<Parameters<typeof createStudioHttpServer>[0]['extensionEvents']>
    let emit!: Parameters<Events['subscribe']>[0]
    const dispose = vi.fn()
    const endpoint = await listen({
      rpcRouter: { call: async () => null },
      extensionEvents: { subscribe: handler => { emit = handler; return { dispose } } },
    })
    const client = await openEventSocket(endpoint)
    const socket = client.response.socket!
    try {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      socket.cork()
      emit({ name: 'data.changed', meta: { eventId: 'blocked' }, data: { payload: 'x'.repeat(128 * 1024) } } as never)
      expect(client.response.writableNeedDrain).toBe(true)
      expect(client.response.destroyed).toBe(false)
      vi.advanceTimersByTime(29_999)
      expect(client.response.destroyed).toBe(false)
      const drained = once(client.response, 'drain')
      const received = Promise.withResolvers<void>()
      let text = ''
      client.stream.on('data', chunk => {
        text += chunk.toString()
        if (text.includes('id: after-drain\n')) received.resolve()
      })
      socket.uncork()
      client.stream.resume()
      await drained
      expect(client.response.writableLength).toBe(0)
      vi.advanceTimersByTime(30_000)
      expect(client.response.destroyed).toBe(false)
      expect(dispose).not.toHaveBeenCalled()
      emit({ name: 'data.changed', meta: { eventId: 'after-drain' }, data: {} } as never)
      await received.promise
      expect(client.response.destroyed).toBe(false)
      vi.useRealTimers()
      client.request.destroy()
      await client.closed
      await endpoint.server.shutdown()
      expect(dispose).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
      socket.uncork()
      client.request.destroy()
      await endpoint.server.shutdown()
    }
  })

  it('disconnects sustained SSE socket backpressure at 30 seconds without resetting the deadline for later frames', async () => {
    type Events = NonNullable<Parameters<typeof createStudioHttpServer>[0]['extensionEvents']>
    let emit!: Parameters<Events['subscribe']>[0]
    const dispose = vi.fn()
    const endpoint = await listen({
      rpcRouter: { call: async () => null },
      extensionEvents: { subscribe: handler => { emit = handler; return { dispose } } },
    })
    const client = await openEventSocket(endpoint)
    const socket = client.response.socket!
    const serverClosed = once(client.response, 'close')
    try {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      socket.cork()
      emit({ name: 'data.changed', meta: { eventId: 'first' }, data: { payload: 'x'.repeat(128 * 1024) } } as never)
      expect(client.response.writableNeedDrain).toBe(true)
      vi.advanceTimersByTime(29_000)
      emit({ name: 'data.changed', meta: { eventId: 'later' }, data: { payload: 'x'.repeat(16 * 1024) } } as never)
      expect(client.response.writableLength).toBeLessThan(256 * 1024)
      vi.advanceTimersByTime(999)
      expect(client.response.destroyed).toBe(false)
      vi.advanceTimersByTime(1)
      expect(client.response.destroyed).toBe(true)
      vi.useRealTimers()
      await serverClosed
      client.stream.resume()
      await client.closed
      await expect.poll(() => dispose.mock.calls.length).toBe(1)
      await endpoint.server.shutdown()
      expect(dispose).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
      client.request.destroy()
      await endpoint.server.shutdown()
    }
  })

  it('disconnects an oversized SSE subscriber and releases its subscription', async () => {
    type Events = NonNullable<Parameters<typeof createStudioHttpServer>[0]['extensionEvents']>
    let emit!: Parameters<Events['subscribe']>[0]
    const dispose = vi.fn()
    const { server, origin, cookie } = await listen({
      rpcRouter: { call: async () => null },
      extensionEvents: { subscribe: handler => { emit = handler; return { dispose } } },
    })
    try {
      const response = await fetch(`${origin}/extensions/events`, { headers: { cookie } })
      const body = response.text().catch(error => error)
      emit({ name: 'data.changed', meta: { eventId: 'large' }, data: { payload: 'x'.repeat(256 * 1024) } } as never)
      await body
      await expect.poll(() => dispose.mock.calls.length).toBe(1)
    } finally { await server.shutdown() }
  })
  it('cancels RPCs and waits for their business work even after the client disconnects', async () => {
    const started = Promise.withResolvers<AbortSignal>()
    const release = Promise.withResolvers<void>()
    let finished = false
    let drained = false
    const { server, origin, cookie } = await listen({
      rpcRouter: {
        call: async (_method, _params, context) => {
          started.resolve(context.signal!)
          await release.promise
          finished = true
          return null
        },
      },
    })
    const controller = new AbortController()
    const request = fetch(`${origin}/rpc`, {
      method: 'POST', headers: { cookie, 'content-type': 'application/json' }, signal: controller.signal,
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'test.wait', params: {} }),
    }).catch(error => error)
    try {
      const signal = await started.promise
      controller.abort()
      await request
      await expect.poll(() => signal.aborted).toBe(true)
      const shutdown = server.shutdown()
      expect(server.shutdown()).toBe(shutdown)
      void shutdown.then(() => { drained = true })
      await new Promise<void>(resolve => setImmediate(resolve))
      expect(server.listening).toBe(false)
      expect(finished).toBe(false)
      expect(drained).toBe(false)
      await expect(fetch(`${origin}/health`)).rejects.toThrow()
      release.resolve()
      await shutdown
      expect(finished).toBe(true)
    } finally {
      controller.abort()
      release.resolve()
      await server.shutdown()
    }
  })

  it('waits for asynchronous SSE subscription disposal during shutdown', async () => {
    const release = Promise.withResolvers<void>()
    const started = Promise.withResolvers<void>()
    const dispose = vi.fn(async () => { started.resolve(); await release.promise })
    const { server, origin, cookie } = await listen({
      rpcRouter: { call: async () => null },
      extensionEvents: { subscribe: () => ({ dispose }) },
    })
    try {
      const response = await fetch(`${origin}/extensions/events`, { headers: { cookie } })
      const body = response.text().catch(error => error)
      let drained = false
      const shutdown = server.shutdown()
      void shutdown.then(() => { drained = true })
      await started.promise
      await body
      expect(drained).toBe(false)
      release.resolve()
      await shutdown
      expect(dispose).toHaveBeenCalledOnce()
    } finally {
      release.resolve()
      await server.shutdown()
    }
  })

  it.each(['streaming cancellation', 'opening cancellation', 'source failure'] as const)('releases the Asset source after %s', async phase => {
    const root = await mkdtemp(join(tmpdir(), 'loom-http-assets-'))
    const engine = createSqliteDataEngine({ filename: ':memory:', createId, now: nowIso })
    const blobs = createBlobStore({ engine, rootDirectory: root, createId, now: nowIso })
    const assets = createAssetStore({ engine, blobs, createId, now: nowIso })
    const { asset } = await assets.createMediaAsset({
      source: Buffer.alloc(16), kind: 'test.media', actor: { kind: 'system', id: 'test' },
    })
    const source = phase === 'opening cancellation'
      ? await assets.openMediaAsset(asset.id)
      : new Readable({ read() {} })
    if (source instanceof ReadStream) {
      if (source.pending) await once(source, 'open')
      if (!('fd' in source)) throw new Error('ReadStream does not expose its file descriptor')
      expect(source.fd).toEqual(expect.any(Number))
    }
    const opening = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const { server, origin, cookie } = await listen({
      rpcRouter: { call: async () => null },
      assets: {
        ...assets,
        openMediaAsset: async () => {
          opening.resolve()
          if (phase === 'opening cancellation') await release.promise
          return source
        },
      },
    })
    const controller = new AbortController()
    const request = fetch(`${origin}/assets/${asset.id}`, { headers: { cookie }, signal: controller.signal })
    const outcome = request.catch(error => error)
    try {
      await opening.promise
      if (phase !== 'opening cancellation') {
        source.push(Buffer.from('x'))
        const response = await request
        const reader = response.body!.getReader()
        expect((await reader.read()).value).toEqual(new Uint8Array([120]))
        const remaining = reader.read().catch(error => error)
        if (phase === 'source failure') source.destroy(new Error('Simulated Asset read failure'))
        else controller.abort()
        expect(await remaining).toBeInstanceOf(Error)
      } else {
        controller.abort()
        await outcome
      }
      release.resolve()
      await expect.poll(() => source.destroyed).toBe(true)
      await expect.poll(() => source.closed).toBe(true)
      if (source instanceof ReadStream) {
        if (!('fd' in source)) throw new Error('ReadStream does not expose its file descriptor')
        expect(source.fd).toBeNull()
      }
    } finally {
      controller.abort()
      release.resolve()
      source.destroy()
      await server.shutdown()
      await engine.close()
      await rm(root, { recursive: true, force: true })
    }
  })
})
