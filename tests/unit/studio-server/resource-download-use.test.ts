import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createId, nowIso } from '@loom-studio/shared'
import { createApplicationRuntime, type CardBundleArtifact } from '@loom-studio/application-runtime'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createPromptResourceStore } from '@loom-studio/application-data'
import { createAssetStore, createBlobStore } from '@loom-studio/asset-store'
import { describe, expect, it } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { createResourceDownloadService } from '../../../apps/studio-server/src/resource-downloads/service.js'
import { createResourceDownloadUse } from '../../../apps/studio-server/src/resource-adoption/download-use.js'
import { createCardTransferService } from '../../../apps/studio-server/src/codecs/card-transfer-service.js'
import { encodeCardBundleZip } from '../../../apps/studio-server/src/codecs/card-bundle-zip.js'
import { defaultCardPng } from '../../../apps/studio-server/src/codecs/card-png.js'

async function fixture(work: (f: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  const f = await setup()
  try { await work(f) } finally { await f.downloads.close(); await f.engine.close(); await rm(f.directory, { recursive: true, force: true }) }
}
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'loom-adoption-test-'))
  const engine = createSqliteDataEngine({ filename: ':memory:', createId, now: nowIso })
  const documents = createSqliteDocumentStore({ engine })
  const promptResources = createPromptResourceStore({ engine })
  const blobs = createBlobStore({ engine, rootDirectory: directory, createId, now: nowIso })
  const assets = createAssetStore({ engine, blobs, createId, now: nowIso })
  const runtime = createApplicationRuntime({ dataEngine: engine, documents, promptResources, blobs, mediaAssets: { get: id => assets.getMediaAsset(id) } })
  const artifact: CardBundleArtifact = { schemaVersion: 4, artifactId: 'fog', displayName: '雾港', card: { name: '雾港' }, contextAssets: [] }
  const avatar = { bytes: defaultCardPng, mediaType: 'image/png' }
  const cards = createCardTransferService({ applicationRuntime: runtime, assets, directoryMedia: { read: async () => undefined } as never, importConversions: {} as never, saveImportedCard: async () => {} })
  const imported = await cards.importCardArchive({ artifact: structuredClone(artifact), avatar, background: avatar }, 'test')
  const next = { ...artifact, card: { name: '雾港新版' } }
  const archive = encodeCardBundleZip({ artifact: next, avatar })
  let payload = archive
  const downloads = createResourceDownloadService({ directory: join(directory, 'downloads'), transport: async () => payload })
  await downloads.initialize()
  const candidates = await downloads.resolve({ url: 'https://cdn.example/fog.zip', kind: 'card' })
  const task = await downloads.start({ candidateId: candidates.candidates[0]!.id })
  for (let attempt = 0; attempt < 100 && downloads.get(task.id).status !== 'ready'; attempt++) await new Promise(resolve => setTimeout(resolve, 5))
  expect(downloads.get(task.id).status).toBe('ready')
  const use = createResourceDownloadUse({ downloads, runtime, cards, extensions: {} as never })
  return { directory, engine, assets, runtime, downloads, cards, use, task, card: imported.card, next, avatar, setPayload: (value: Uint8Array) => { payload = value } }
}

describe('downloaded Card adoption', () => {
  it('attaches a Card-scoped dependency to the selected Card without globally installing or authorizing it', async () => fixture(async f => {
    const manifest = { manifestVersion: 2, id: 'test.private', version: '1.0.0', displayName: 'Private', engines: { studio: '*' }, modules: [] }
    f.setPayload(zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)) }))
    f.downloads.registerAdapter({ id: 'test-source', matches: url => url.hostname === 'platform.example', resolve: async input => [{ name: 'Private', kind: 'extension',
      source: { adapterId: 'test-source', url: input.url, resourceId: manifest.id }, target: { kind: 'file', url: 'https://cdn.example/private.zip' }, dependencyTarget: 'card' }] })
    const resolved = await f.downloads.resolve({ url: 'https://platform.example/private', kind: 'extension' })
    const task = await f.downloads.start({ candidateId: resolved.candidates[0]!.id })
    for (let attempt = 0; attempt < 100 && f.downloads.get(task.id).status !== 'ready'; attempt++) await new Promise(resolve => setTimeout(resolve, 5))
    expect(f.downloads.get(task.id).status).toBe('ready')
    await expect(f.use.preview(task.id)).rejects.toThrow('角色私有依赖')
    const preview = await f.use.preview(task.id, f.card.id)
    const result = await f.use.commit(task.id, preview.token, 'test')
    expect(result.id).toBe(f.card.id)
    expect((await f.runtime.getCardExtensionPackage({ cardId: f.card.id, packageId: manifest.id })).archive.version).toBe('1.0.0')
    expect((await f.runtime.listExtensionInstallations()).installations).toEqual([])
    expect(f.downloads.listUpdates()[0]?.targetId).toBe(f.card.id)
  }))

  it('adopts package media with content and clears a removed background without trusting author asset IDs', async () => fixture(async f => {
    const preview = await f.use.previewCardUpdate({ id: f.task.id, cardId: f.card.id })
    const result = await f.use.applyCardUpdate({ id: f.task.id, cardId: f.card.id, expectedVersion: preview.expectedVersion, expectedFingerprint: preview.fingerprint }, 'test')
    expect(result.card.name).toBe('雾港新版')
    expect(result.card.media?.avatarAssetId).not.toBe(f.card.media?.avatarAssetId)
    expect(result.card.media?.coverAssetId).toBeUndefined()
    expect(await f.assets.readMediaAsset(result.card.media!.avatarAssetId!)).toEqual(defaultCardPng)
  }))

  it('keeps player media when requested', async () => fixture(async f => {
    const preview = await f.use.previewCardUpdate({ id: f.task.id, cardId: f.card.id })
    const result = await f.use.applyCardUpdate({ id: f.task.id, cardId: f.card.id, expectedVersion: preview.expectedVersion, expectedFingerprint: preview.fingerprint, keepMedia: true }, 'test')
    expect(result.card.media).toEqual(f.card.media)
    expect(result.card.name).toBe('雾港新版')
  }))

  it('rejects changed staged bytes after review before changing the Card', async () => fixture(async f => {
    const preview = await f.use.previewCardUpdate({ id: f.task.id, cardId: f.card.id })
    await writeFile(f.downloads.readArtifact(f.task.id).path, encodeCardBundleZip({ artifact: f.next, avatar: f.avatar, background: f.avatar }))
    await expect(f.use.applyCardUpdate({ id: f.task.id, cardId: f.card.id, expectedVersion: preview.expectedVersion, expectedFingerprint: preview.fingerprint }, 'test')).rejects.toThrow('下载包已变化')
    expect((await f.runtime.getCard({ cardId: f.card.id })).card).toEqual(f.card)
  }))

  it('emits structured operational log events for adoption and update', async () => fixture(async f => {
    const records: Array<{ event?: string; data?: Record<string, unknown> }> = []
    const logger = {
      info: (_msg: string, meta?: any) => { if (meta) records.push(meta) },
      error: (_msg: string, meta?: any) => { if (meta) records.push(meta) },
      warn: () => {},
      debug: () => {},
      child: () => logger,
    } as any
    const use = createResourceDownloadUse({ downloads: f.downloads, runtime: f.runtime, cards: f.cards, extensions: {} as never, logger })
    const preview = await use.previewCardUpdate({ id: f.task.id, cardId: f.card.id })
    await use.applyCardUpdate({ id: f.task.id, cardId: f.card.id, expectedVersion: preview.expectedVersion, expectedFingerprint: preview.fingerprint }, 'test')
    expect(records.map(r => r.event)).toContain('resource.card.updated')
    expect(records.find(r => r.event === 'resource.card.updated')?.data).toMatchObject({
      cardId: f.card.id,
      taskId: f.task.id,
      durationMs: expect.any(Number),
    })
  }))
})
