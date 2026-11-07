import { request as httpRequest } from 'node:http'
import type { ApplicationRuntime } from '@loom-studio/application-runtime'
import type { AssetStore } from '@loom-studio/asset-store'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApplicationSessionAuth } from '../../../apps/studio-server/src/http/application-session-auth.js'
import { createStudioHttpServer } from '../../../apps/studio-server/src/http/http-server.js'

const viteOrigin = 'http://127.0.0.1:18011'
const configuredOrigin = 'https://localhost:5443'
const rpcBody = JSON.stringify({ presetId: 'control', expectedMountIds: [], mounts: [] })

describe('protected HTTP Origin boundary', () => {
  let server: ReturnType<typeof createStudioHttpServer>
  let origin: string
  let cookie: string
  const call = vi.fn(async () => ({ accepted: true }))
  const upload = vi.fn(async () => ({ asset: { id: 'asset-test' }, commit: { changesetId: 'commit-test' } }))
  const importPng = vi.fn(async () => ({ imported: true }))
  const importBundle = vi.fn(async () => ({ imported: true }))
  const readMedia = vi.fn(async () => ({ bytes: Buffer.from('image-control'), mediaType: 'image/png' }))

  beforeEach(async () => {
    vi.clearAllMocks()
    server = createStudioHttpServer({
      auth: createApplicationSessionAuth({ allowedOrigins: [viteOrigin, configuredOrigin] }),
      applicationRuntime: { replacePresetToolMounts: call } as unknown as ApplicationRuntime,
      // Only HTTP dispatch is exercised; no database, files or user credentials are used.
      assets: { createMediaAsset: upload } as unknown as AssetStore,
      cardMedia: { read: readMedia },
      cardPng: {
        import: importPng,
        importBundle,
        export: async () => Buffer.from('png'),
        exportBundle: async () => Buffer.from('zip'),
        exportPolyglot: async () => Buffer.from('polyglot'),
      },
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing test address')
    origin = `http://127.0.0.1:${address.port}`
    const response = await fetch(`${origin}/auth/session`, { method: 'POST', headers: { origin } })
    expect(response.status).toBe(204)
    cookie = response.headers.get('set-cookie')!.split(';')[0]!
  })

  afterEach(async () => { await server.shutdown() })

  it('rejects wrong Origin with a valid cookie and text/plain before RPC dispatch', async () => {
    const response = await fetch(`${origin}/trpc/application.replacePresetToolMounts`, {
      method: 'POST',
      headers: { cookie, origin: 'http://127.0.0.1:5999', 'content-type': 'text/plain' },
      body: rpcBody,
    })
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ error: { code: 'auth.origin_forbidden' } })
    expect(call).not.toHaveBeenCalled()
  })

  it.each(['same-origin', 'vite', 'configured', 'absent'])('accepts JSON RPC with %s Origin', async kind => {
    const headers: Record<string, string> = { cookie, 'content-type': 'application/json; charset=utf-8' }
    if (kind !== 'absent') headers.origin = kind === 'same-origin' ? origin : kind === 'vite' ? viteOrigin : configuredOrigin
    const response = await fetch(`${origin}/trpc/application.replacePresetToolMounts`, { method: 'POST', headers, body: rpcBody })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ result: { data: { accepted: true } } })
    expect(call).toHaveBeenCalledOnce()
    expect(call).toHaveBeenCalledWith({ presetId: 'control', expectedMountIds: [], mounts: [] }, expect.objectContaining({ clientId: expect.stringMatching(/^session:/) }))
  })

  it.each([
    'null',
    '',
    'http://127.0.0.1:5999',
    'http://localhost:18011',
    'http://127.0.0.1:18011.evil.example',
    `${viteOrigin}/path`,
    `${viteOrigin}/`,
    `${viteOrigin}?query=1`,
    'http://user@127.0.0.1:18011',
    `${viteOrigin}, http://127.0.0.1:5999`,
  ])('rejects non-allowlisted or non-Origin header %j even with JSON', async deniedOrigin => {
    const response = await fetch(`${origin}/trpc/application.replacePresetToolMounts`, {
      method: 'POST',
      headers: { cookie, origin: deniedOrigin, 'content-type': 'application/json' },
      body: rpcBody,
    })
    expect(response.status).toBe(403)
    expect(call).not.toHaveBeenCalled()
  })

  it.each(['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=test', undefined])(
    'rejects RPC Content-Type %j with and without Origin',
    async contentType => {
      for (const withOrigin of [true, false]) {
        const headers: Record<string, string> = { cookie }
        if (withOrigin) headers.origin = origin
        if (contentType) headers['content-type'] = contentType
        const response = await fetch(`${origin}/trpc/application.replacePresetToolMounts`, { method: 'POST', headers, body: Buffer.from(rpcBody) })
        expect(response.status).toBe(415)
        await expect(response.json()).resolves.toMatchObject({ error: { code: 'rpc.unsupported_media_type' } })
      }
      expect(call).not.toHaveBeenCalled()
    },
  )

  it.each(['/assets', '/cards/import/png', '/cards/import/loomcard'])('rejects wrong Origin before %s upload dispatch', async path => {
    const response = await fetch(`${origin}${path}`, {
      method: 'POST',
      headers: { cookie, origin: 'http://127.0.0.1:5999', 'content-type': 'text/plain', 'x-loom-asset-kind': 'test' },
      body: 'upload-control',
    })
    expect(response.status).toBe(403)
    expect(upload).not.toHaveBeenCalled()
    expect(importPng).not.toHaveBeenCalled()
    expect(importBundle).not.toHaveBeenCalled()
  })

  it.each([viteOrigin, undefined])('preserves uploads with allowed or absent Origin %j', async requestOrigin => {
    const headers: Record<string, string> = { cookie, 'content-type': 'image/png', 'x-loom-asset-kind': 'test' }
    if (requestOrigin) headers.origin = requestOrigin
    for (const path of ['/assets', '/cards/import/png', '/cards/import/loomcard']) {
      const response = await fetch(`${origin}${path}`, { method: 'POST', headers, body: Buffer.from('upload-control') })
      expect(response.status).toBe(201)
      await response.text()
    }
    expect(upload).toHaveBeenCalledOnce()
    expect(importPng).toHaveBeenCalledOnce()
    expect(importBundle).toHaveBeenCalledOnce()
  })

  it.each(['GET', 'HEAD'])('preserves no-Origin image %s and rejects explicit wrong Origin', async method => {
    const path = `${origin}/cards/test/media/avatar`
    const response = await fetch(path, { method, headers: { cookie } })
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(method === 'GET' ? 'image-control' : '')
    expect(readMedia).toHaveBeenCalledOnce()
    const rejected = await fetch(path, { method, headers: { cookie, origin: 'http://127.0.0.1:5999' } })
    expect(rejected.status).toBe(403)
    expect(readMedia).toHaveBeenCalledOnce()
  })

  it('keeps bootstrap strict and accepts configured development origins', async () => {
    for (const requestOrigin of [undefined, 'null', `${viteOrigin}/path`]) {
      const response = await fetch(`${origin}/auth/session`, {
        method: 'POST', headers: requestOrigin === undefined ? {} : { origin: requestOrigin },
      })
      expect(response.status).toBe(403)
    }
    for (const requestOrigin of [viteOrigin, configuredOrigin]) {
      const response = await fetch(`${origin}/auth/session`, { method: 'POST', headers: { origin: requestOrigin } })
      expect(response.status).toBe(204)
      expect(response.headers.get('set-cookie')).toContain('HttpOnly')
    }
  })

  it('rejects private network origins when allowPrivateNetworkOrigins is disabled', async () => {
    for (const lanOrigin of ['http://192.168.1.50:18011', 'http://10.0.0.1:18011', 'http://macbook.local:18011']) {
      const response = await fetch(`${origin}/auth/session`, {
        method: 'POST',
        headers: { origin: lanOrigin, host: new URL(lanOrigin).host },
      })
      expect(response.status).toBe(403)
    }
  })
})

describe('LAN mode private network Origin boundary', () => {
  let server: ReturnType<typeof createStudioHttpServer>
  let serverOrigin: string

  const postSession = (url: string, headers: Record<string, string>) =>
    new Promise<{ status: number; cookie?: string }>((resolve, reject) => {
      const parsed = new URL(url)
      const req = httpRequest({
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname,
        method: 'POST',
        headers,
      }, res => {
        resolve({
          status: res.statusCode ?? 0,
          cookie: res.headers['set-cookie']?.[0],
        })
      })
      req.on('error', reject)
      req.end()
    })

  beforeEach(async () => {
    server = createStudioHttpServer({
      auth: createApplicationSessionAuth({
        allowedOrigins: [viteOrigin],
        allowPrivateNetworkOrigins: true,
      }),
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing test address')
    serverOrigin = `http://127.0.0.1:${address.port}`
  })

  afterEach(async () => { await server.shutdown() })

  it('accepts RFC 1918 and local mDNS origins when allowPrivateNetworkOrigins is enabled', async () => {
    const validOrigins = [
      'http://192.168.1.100:18011',
      'http://10.10.0.5:18011',
      'http://172.20.1.2:18011',
      'http://macbook-air.local:18011',
    ]
    for (const lanOrigin of validOrigins) {
      const host = new URL(lanOrigin).host
      const response = await postSession(`${serverOrigin}/auth/session`, { origin: lanOrigin, host })
      expect(response.status).toBe(204)
      expect(response.cookie).toContain('HttpOnly')
    }
  })

  it('still rejects public IP and external domain origins in LAN mode', async () => {
    const forbiddenOrigins = [
      'http://8.8.8.8:18011',
      'http://1.1.1.1:18011',
      'http://evil.com:18011',
      'http://172.32.0.1:18011',
    ]
    for (const forbidden of forbiddenOrigins) {
      const host = new URL(forbidden).host
      const response = await postSession(`${serverOrigin}/auth/session`, { origin: forbidden, host })
      expect(response.status).toBe(403)
    }
  })

  it('rejects origin-host mismatch even with private IP', async () => {
    const response = await postSession(`${serverOrigin}/auth/session`, {
      origin: 'http://192.168.1.100:18011',
      host: '192.168.1.200:18011',
    })
    expect(response.status).toBe(403)
  })
})
