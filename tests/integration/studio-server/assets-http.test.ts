import { describe, expect, it } from 'vitest'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { unzipSync, zipSync } from 'fflate'
import type { CardBundleArtifact } from '@loom-studio/application-runtime'
import { defaultCardPng, encodeCardBundlePng, readCardPngArchive, readPolyglotArchive } from '../../../apps/studio-server/src/codecs/card-png.js'
import { decodeCardBundleZip } from '../../../apps/studio-server/src/codecs/card-bundle-zip.js'
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
      expect(loomCard.headers.get('content-disposition')).toContain('loom-card.loomcard.zip')
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

  it('edits real unpacked files and imports the complete result in another workspace', async () => {
    await withStudioServer(async (port, dir) => {
      const artifact: CardBundleArtifact = {
        schemaVersion: 4, artifactId: 'author-project', displayName: 'Author Project',
        card: { name: 'Author Project', description: 'Before editing', macros: { difficulty: '{{user}}: hard' } },
        contextAssets: [],
        state: {
          kind: 'loom.state', schemaVersion: 1,
          contribution: {
            id: 'author-project.state',
            entityTypes: [{ id: 'character', collectionPath: 'entity.character' }],
            templates: [{
              id: 'author-project.vitals', templateVersion: 1, componentKey: 'vitals',
              targetEntityTypeIds: ['character'], schema: { type: 'object' }, initial: { hp: 100 },
            }],
            entities: [{ typeId: 'character', entityId: 'alice' }],
            componentMounts: [{
              templateId: 'author-project.vitals', templateVersion: 1, componentKey: 'vitals',
              target: { kind: 'entity-type', typeId: 'character' },
            }],
            bindings: [],
          },
        },
        textTransformRules: [{
          name: 'Hide tag', enabled: true, orderIndex: 2, targets: ['narrative'], phases: ['prompt'],
          matcher: { kind: 'regex', pattern: '<private>.*?</private>', flags: 'gs' },
          effect: { kind: 'replace', replacement: '' },
        }],
        textExtractors: [{
          name: 'Weather', enabled: true, orderIndex: 1, targets: ['narrative'],
          matcher: { kind: 'regex', pattern: '<weather>(.*?)</weather>', flags: 'gs', contentGroup: 1 },
          parser: 'text', strategy: 'latest-valid', artifactType: 'weather',
        }],
        scriptAttachments: [{
          orderIndex: 3,
          script: {
            format: 'loom.script', schemaVersion: 1, fileName: 'demo.loom.js',
            source: [
              '// ==LoomScript==',
              '// @format 1',
              '// @id author-project.demo',
              '// @name Demo',
              '// @version 1.0.0',
              '// @runtime client-sandbox',
              '// @contribution {"kind":"renderer","id":"demo","surface":"shell.workspace-panel","scope":"workspace","inputs":["artifact:weather"]}',
              '// ==/LoomScript==',
              'export const renderers = {}',
            ].join('\r\n'),
          },
        }],
      }
      const created = await callRpc<{ card: { id: string } }>(port, 'application.importCardBundle', { artifact })
      const backgroundUpload = await authenticatedFetch(port, '/assets', {
        method: 'POST', headers: { 'content-type': 'image/png', 'x-loom-asset-kind': 'card.background' },
        body: defaultCardPng,
      })
      expect(backgroundUpload.status).toBe(201)
      const background = await backgroundUpload.json() as { asset: { id: string } }
      await callRpc(port, 'application.updateCard', { cardId: created.card.id, media: { coverAssetId: background.asset.id } })
      const exported = await authenticatedFetch(port, `/cards/${created.card.id}/export.png`)
      expect(exported.status).toBe(200)
      const png = new Uint8Array(await exported.arrayBuffer())
      expect(readPolyglotArchive(png)).toBeUndefined()
      const files = unzipSync(readCardPngArchive(png)!)
      const root = join(dir, 'author-files')
      for (const [path, bytes] of Object.entries(files)) {
        await mkdir(dirname(join(root, path)), { recursive: true })
        await writeFile(join(root, path), bytes)
      }
      await writeFile(join(root, 'card/description.md'), 'Edited in a real Markdown file.\n')
      const editedFiles = Object.fromEntries(await Promise.all(Object.keys(files).map(async path =>
        [path, await readFile(join(root, path))] as const)))
      const editedArchive = zipSync(editedFiles)
      await withStudioServer(async otherPort => {
        const response = await authenticatedFetch(otherPort, '/cards/import/loomcard', {
          method: 'POST', body: editedArchive,
        })
        expect(response.status).toBe(201)
        const imported = await response.json() as { card: { id: string; description: string; media: { coverAssetId: string } } }
        expect(imported.card.description).toBe('Edited in a real Markdown file.\n')
        const restored = await callRpc<{ artifact: CardBundleArtifact }>(otherPort, 'application.exportCardBundle', { cardId: imported.card.id })
        expect(restored.artifact.card.macros).toEqual(artifact.card.macros)
        expect(restored.artifact.state?.contribution.templates).toEqual(artifact.state?.contribution.templates)
        expect(restored.artifact.state?.contribution.entities).toEqual(artifact.state?.contribution.entities)
        expect(restored.artifact.state?.contribution.componentMounts).toEqual(artifact.state?.contribution.componentMounts)
        expect(restored.artifact.textTransformRules).toEqual(artifact.textTransformRules)
        expect(restored.artifact.textExtractors).toEqual(artifact.textExtractors)
        expect(restored.artifact.scriptAttachments).toEqual(artifact.scriptAttachments)
        const reexport = await authenticatedFetch(otherPort, `/cards/${imported.card.id}/export.png`)
        expect(reexport.status).toBe(200)
        const reexportArchive = readCardPngArchive(new Uint8Array(await reexport.arrayBuffer()))!
        const restoredBundle = await decodeCardBundleZip(reexportArchive)
        expect(Buffer.from(restoredBundle.avatar.bytes)).toEqual(defaultCardPng)
        expect(Buffer.from(restoredBundle.background!.bytes)).toEqual(defaultCardPng)
        const pngImport = await authenticatedFetch(port, '/cards/import/png', {
          method: 'POST', body: encodeCardBundlePng(defaultCardPng, reexportArchive),
        })
        expect(pngImport.status).toBe(201)
      })
    })
  })

  it('reports a broken native PNG Bundle without falling through to ST', async () => {
    await withStudioServer(async port => {
      const response = await authenticatedFetch(port, '/cards/import/png', {
        method: 'POST', body: encodeCardBundlePng(defaultCardPng, Buffer.from('not a ZIP')),
      })
      expect(response.ok).toBe(false)
      const body = await response.text()
      expect(body).not.toContain('sillytavern.importer')
    })
  })
})
