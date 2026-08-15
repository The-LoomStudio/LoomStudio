import { describe, expect, it } from 'vitest'
import { authenticatedFetch, callRpc, withStudioServer } from './helpers.js'

describe('studio server media asset data plane', () => {
  it('uploads immutable bytes and reads them by assetId', async () => {
    await withStudioServer(async port => {
      const bytes = Buffer.from('fake png bytes')
      const upload = await authenticatedFetch(port, '/assets', {
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

      const read = await authenticatedFetch(port, created.url)
      expect(read.status).toBe(200)
      expect(read.headers.get('content-type')).toBe('image/png')
      expect(read.headers.get('x-content-type-options')).toBe('nosniff')
      expect(Buffer.from(await read.arrayBuffer())).toEqual(bytes)

      const head = await authenticatedFetch(port, created.url, { method: 'HEAD' })
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
      const response = await authenticatedFetch(port, '/assets', {
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

  it('exports and imports a Card through a PNG iTXt container', async () => {
    await withStudioServer(async port => {
      const created = await callRpc<{ card: { id: string } }>(port, 'application.createCard', {
        name: 'PNG Round Trip',
        description: '压缩 iTXt 测试',
      })
      const exported = await authenticatedFetch(port, `/cards/${created.card.id}/export.png`)
      expect(exported.status).toBe(200)
      expect(exported.headers.get('content-type')).toBe('image/png')
      const bytes = await exported.arrayBuffer()
      expect(bytes.byteLength).toBeGreaterThan(100)

      const imported = await authenticatedFetch(port, '/cards/import/png', {
        method: 'POST',
        headers: { 'content-type': 'image/png' },
        body: bytes,
      })
      expect(imported.status).toBe(201)
      await expect(imported.json()).resolves.toMatchObject({
        card: {
          name: 'PNG Round Trip',
          description: '压缩 iTXt 测试',
          media: {
            avatarAssetId: expect.any(String),
          },
        },
      })
    })
  })

  it('exports and imports complete .loomcard and Polyglot packages', async () => {
    await withStudioServer(async port => {
      const created = await callRpc<{ card: { id: string } }>(port, 'application.createCard', {
        name: 'Complete Package',
      })

      const loomCard = await authenticatedFetch(port, `/cards/${created.card.id}/export.loomcard`)
      expect(loomCard.status).toBe(200)
      expect(loomCard.headers.get('content-type')).toBe('application/vnd.loom.card+zip')
      const loomCardBytes = await loomCard.arrayBuffer()
      const importedLoomCard = await authenticatedFetch(port, '/cards/import/loomcard', {
        method: 'POST',
        body: loomCardBytes,
      })
      expect(importedLoomCard.status).toBe(201)
      await expect(importedLoomCard.json()).resolves.toMatchObject({ card: { name: 'Complete Package' } })

      const polyglot = await authenticatedFetch(port, `/cards/${created.card.id}/export.polyglot.png`)
      expect(polyglot.status).toBe(200)
      expect(polyglot.headers.get('content-type')).toBe('image/png')
      const importedPolyglot = await authenticatedFetch(port, '/cards/import/png', {
        method: 'POST',
        headers: { 'content-type': 'image/png' },
        body: await polyglot.arrayBuffer(),
      })
      expect(importedPolyglot.status).toBe(201)
      await expect(importedPolyglot.json()).resolves.toMatchObject({ card: { name: 'Complete Package' } })
    })
  })
})
