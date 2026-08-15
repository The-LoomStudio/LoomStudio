import { describe, expect, it } from 'vitest'
import { callRpc, withStudioServer } from './helpers.js'

describe('studio server media asset data plane', () => {
  it('uploads immutable bytes and reads them by assetId', async () => {
    await withStudioServer(async port => {
      const bytes = Buffer.from('fake png bytes')
      const upload = await fetch(`http://127.0.0.1:${port}/assets`, {
        method: 'POST',
        headers: {
          'content-type': 'image/png',
          'x-loom-asset-kind': 'card.avatar',
          'x-loom-asset-label': 'Avatar',
        },
        body: bytes,
      })
      expect(upload.status).toBe(201)
      const created = await upload.json() as {
        asset: { id: string; kind: string; mediaType: string; sizeBytes: number }
        url: string
      }
      expect(created.asset).toMatchObject({
        kind: 'card.avatar',
        mediaType: 'image/png',
        sizeBytes: bytes.byteLength,
      })

      const read = await fetch(`http://127.0.0.1:${port}${created.url}`)
      expect(read.status).toBe(200)
      expect(read.headers.get('content-type')).toBe('image/png')
      expect(read.headers.get('x-content-type-options')).toBe('nosniff')
      expect(Buffer.from(await read.arrayBuffer())).toEqual(bytes)

      const head = await fetch(`http://127.0.0.1:${port}${created.url}`, { method: 'HEAD' })
      expect(head.status).toBe(200)
      expect(head.headers.get('content-length')).toBe(String(bytes.byteLength))

      const card = await callRpc<{ card: { id: string } }>(port, 'application.createCard', {
        name: 'Asset Card',
      })
      const updated = await callRpc<{ card: { media?: { avatarAssetId?: string } } }>(port, 'application.updateCard', {
        cardId: card.card.id,
        media: { avatarAssetId: created.asset.id },
      })
      expect(updated.card.media).toEqual({ avatarAssetId: created.asset.id })
    })
  })

  it('rejects uploads without an explicit asset kind', async () => {
    await withStudioServer(async port => {
      const response = await fetch(`http://127.0.0.1:${port}/assets`, {
        method: 'POST',
        headers: { 'content-type': 'image/png' },
        body: Buffer.from('bytes'),
      })
      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'asset.invalid_request' },
      })
    })
  })

  it('rejects Card references to unknown Media Assets', async () => {
    await withStudioServer(async port => {
      const card = await callRpc<{ card: { id: string } }>(port, 'application.createCard', {
        name: 'Missing Asset Card',
      })
      await expect(callRpc(port, 'application.updateCard', {
        cardId: card.card.id,
        media: { coverAssetId: 'asset-missing' },
      })).rejects.toThrow('Media Asset not found: asset-missing')
    })
  })
})
