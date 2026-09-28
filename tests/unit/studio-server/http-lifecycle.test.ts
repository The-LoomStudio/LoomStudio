import { createAssetStore } from '@loom-studio/asset-store'
import { createBlobStore } from '@loom-studio/blob-store'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createId, nowIso } from '@loom-studio/shared'
import { once } from 'node:events'
import { ReadStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
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

describe('HTTP request lifecycle', () => {
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
