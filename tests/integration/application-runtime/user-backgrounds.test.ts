import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPromptResourceStore } from '@loom-studio/application-data'
import { applicationDocumentTypes, createApplicationRuntime, readUserBackgrounds } from '@loom-studio/application-runtime'
import { createAssetStore } from '@loom-studio/asset-store'
import { createBlobStore } from '@loom-studio/blob-store'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createId, nowIso } from '@loom-studio/shared'
import { describe, expect, it } from 'vitest'

function open(directory: string) {
  const clock = { createId, now: nowIso }
  const engine = createSqliteDataEngine({ filename: join(directory, 'data.sqlite'), ...clock })
  const documents = createSqliteDocumentStore({ engine })
  const blobs = createBlobStore({ engine, rootDirectory: join(directory, 'blobs'), ...clock })
  const assets = createAssetStore({ engine, blobs, ...clock })
  const options = {
    dataEngine: engine, documents,
    promptResources: createPromptResourceStore({ engine, ...clock }),
    mediaAssets: { get: (id: string) => assets.getMediaAsset(id) },
  }
  return { engine, documents, assets, runtime: createApplicationRuntime(options), otherRuntime: createApplicationRuntime(options) }
}

describe('global user backgrounds', () => {
  it('persists global records across runtimes and restart, removing only the background reference', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'loom-user-backgrounds-'))
    let f = open(directory)
    try {
      expect((await f.runtime.getUserBackgrounds()).config).toEqual({ backgrounds: [], version: 0 })
      expect((await f.documents.list({ type: applicationDocumentTypes.userBackgrounds })).items).toEqual([])
      const image = (await f.assets.createMediaAsset({
        source: new Uint8Array([1, 2, 3]), kind: 'user.background', mediaType: 'image/png',
        actor: { kind: 'client', id: 'test' },
      })).asset
      const added = await f.runtime.addUserBackground({ expectedVersion: 0, name: '  雨夜  ', assetId: image.id })
      expect(added.config).toEqual({ backgrounds: [{ id: expect.any(String), name: '  雨夜  ', assetId: image.id }], version: 1 })
      expect(added.mutation.changesetId).toBeTruthy()
      expect((await f.otherRuntime.getUserBackgrounds()).config).toEqual(added.config)
      f.engine.close()
      f = open(directory)
      expect(await readUserBackgrounds(f.documents)).toEqual(added.config)
      const removed = await f.runtime.removeUserBackground({ expectedVersion: 1, backgroundId: added.config.backgrounds[0]!.id })
      expect(removed.config).toEqual({ backgrounds: [], version: 2 })
      expect(removed.mutation.changesetId).toBeTruthy()
      expect(await f.assets.getMediaAsset(image.id)).toEqual(image)
      expect((await f.documents.list({ type: applicationDocumentTypes.userBackgrounds })).items).toHaveLength(1)
    } finally {
      f.engine.close()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('uses one CAS across additions and removals without partial writes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'loom-user-backgrounds-cas-'))
    const f = open(directory)
    try {
      const image = (await f.assets.createMediaAsset({
        source: new Uint8Array([1]), kind: 'user.background', mediaType: 'image/webp',
        actor: { kind: 'client', id: 'test' },
      })).asset
      const add = (expectedVersion: number) => f.runtime.addUserBackground({ expectedVersion, name: '场景', assetId: image.id })
      for (const expectedVersion of [-1, 0.5, NaN, Infinity]) {
        await expect(add(expectedVersion)).rejects.toThrow(/configuration version/)
      }
      const first = await add(0)
      const backgroundId = first.config.backgrounds[0]!.id
      await expect(add(0)).rejects.toThrow(/already exists/)
      const second = await add(1)
      await expect(add(1)).rejects.toThrow()
      await expect(f.runtime.removeUserBackground({ expectedVersion: 1, backgroundId })).rejects.toThrow()
      await expect(f.runtime.removeUserBackground({ expectedVersion: 2, backgroundId: 'missing' })).rejects.toThrow(/User background not found/)
      expect((await f.runtime.getUserBackgrounds()).config).toEqual(second.config)
      const writes = await Promise.allSettled([
        f.runtime.addUserBackground({ expectedVersion: 2, name: '另一个场景', assetId: image.id }),
        f.otherRuntime.removeUserBackground({ expectedVersion: 2, backgroundId }),
      ])
      expect(writes.filter(write => write.status === 'fulfilled')).toHaveLength(1)
      expect(writes.filter(write => write.status === 'rejected')).toHaveLength(1)
      expect((await f.runtime.getUserBackgrounds()).config.version).toBe(3)
    } finally {
      f.engine.close()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('requires an existing supported raster asset and leaves the configuration unchanged on rejection', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'loom-user-backgrounds-assets-'))
    const f = open(directory)
    try {
      const makeAsset = async (mediaType?: string) => (await f.assets.createMediaAsset({
        source: new TextEncoder().encode(mediaType ?? 'unknown'), kind: 'user.background', mediaType,
        actor: { kind: 'client', id: 'test' },
      })).asset
      await expect(f.runtime.addUserBackground({ expectedVersion: 0, name: 'missing', assetId: 'missing' })).rejects.toThrow(/Media Asset not found/)
      for (const mediaType of ['image/svg+xml', 'text/html', undefined]) {
        const asset = await makeAsset(mediaType)
        await expect(f.runtime.addUserBackground({ expectedVersion: 0, name: 'invalid', assetId: asset.id })).rejects.toThrow(/supported raster image/)
      }
      expect((await f.runtime.getUserBackgrounds()).config).toEqual({ backgrounds: [], version: 0 })
      for (const [index, mediaType] of ['image/png', 'image/apng', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'].entries()) {
        const asset = await makeAsset(mediaType)
        const added = await f.runtime.addUserBackground({ expectedVersion: index, name: mediaType, assetId: asset.id })
        expect(added.config.backgrounds.at(-1)?.assetId).toBe(asset.id)
      }
    } finally {
      f.engine.close()
      await rm(directory, { recursive: true, force: true })
    }
  })
})
