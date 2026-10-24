import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPromptResourceStore } from '@loom-studio/application-data'
import { applicationDocumentTypes, createApplicationRuntime, readUserProfiles, resolveCurrentUserProfile } from '@loom-studio/application-runtime'
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

describe('global user profiles', () => {
  it('persists one global selection across runtimes and restart, preserving raw fields and explicit empty selection', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'loom-user-profiles-'))
    let f = open(directory)
    try {
      const initial = (await f.runtime.getUserProfiles()).config
      expect(initial).toEqual({ profiles: [], currentProfileId: null, version: 0 })
      expect(resolveCurrentUserProfile(initial)).toEqual({ name: 'User', description: '' })
      expect((await f.documents.list({ type: applicationDocumentTypes.userProfiles })).items).toEqual([])

      const first = await f.runtime.createUserProfile({ expectedVersion: 0, name: 'Alice', description: 'First profile' })
      const firstId = first.config.currentProfileId!
      expect(first.mutation.changesetId).toBeTruthy()
      const second = await f.otherRuntime.createUserProfile({ expectedVersion: 1, name: '  ' })
      const secondId = second.config.currentProfileId!
      expect(secondId).not.toBe(firstId)
      expect(resolveCurrentUserProfile(second.config)).toMatchObject({ id: secondId, name: 'User', description: '' })
      expect(second.config.profiles[1]?.name).toBe('  ')
      const selected = await f.runtime.selectUserProfile({ expectedVersion: 2, profileId: firstId })
      expect((await f.otherRuntime.getUserProfiles()).config).toEqual(selected.config)
      const updated = await f.otherRuntime.updateUserProfile({ expectedVersion: 3, profileId: firstId, description: 'Updated description' })
      expect(resolveCurrentUserProfile(updated.config)).toEqual({ id: firstId, name: 'Alice', description: 'Updated description' })

      f.engine.close()
      f = open(directory)
      expect(await readUserProfiles(f.documents)).toEqual(updated.config)
      const deletedCurrent = await f.runtime.deleteUserProfile({ expectedVersion: 4, profileId: firstId })
      expect(deletedCurrent.config.currentProfileId).toBeNull()
      expect(deletedCurrent.config.profiles.map(profile => profile.id)).toEqual([secondId])
      expect(resolveCurrentUserProfile(deletedCurrent.config)).toEqual({ name: 'User', description: '' })
      const third = await f.runtime.createUserProfile({ expectedVersion: 5 })
      const deletedOther = await f.runtime.deleteUserProfile({ expectedVersion: 6, profileId: secondId })
      expect(deletedOther.config.currentProfileId).toBe(third.config.currentProfileId)
      const empty = await f.runtime.deleteUserProfile({ expectedVersion: 7, profileId: third.config.currentProfileId! })
      expect(empty.config).toEqual({ profiles: [], currentProfileId: null, version: 8 })
      expect((await f.documents.list({ type: applicationDocumentTypes.userProfiles })).items).toHaveLength(1)
    } finally {
      f.engine.close()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('uses one CAS for every profile and rejects stale, invalid and missing targets without partial writes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'loom-user-profile-cas-'))
    const f = open(directory)
    try {
      for (const expectedVersion of [-1, 0.5, NaN, Infinity]) {
        await expect(f.runtime.createUserProfile({ expectedVersion })).rejects.toThrow(/configuration version/)
      }
      const first = await f.runtime.createUserProfile({ expectedVersion: 0, name: 'First' })
      await expect(f.runtime.createUserProfile({ expectedVersion: 0 })).rejects.toThrow(/already exists/)
      const second = await f.runtime.createUserProfile({ expectedVersion: 1, name: 'Second' })
      await expect(f.runtime.updateUserProfile({ expectedVersion: 1, profileId: first.config.currentProfileId!, name: 'Stale' })).rejects.toThrow()
      await expect(f.runtime.selectUserProfile({ expectedVersion: 1, profileId: first.config.currentProfileId! })).rejects.toThrow()
      await expect(f.runtime.deleteUserProfile({ expectedVersion: 1, profileId: second.config.currentProfileId! })).rejects.toThrow()
      for (const operation of [f.runtime.updateUserProfile, f.runtime.selectUserProfile, f.runtime.deleteUserProfile]) {
        await expect(operation({ expectedVersion: 2, profileId: 'missing' })).rejects.toThrow(/User profile not found/)
      }
      expect((await f.runtime.getUserProfiles()).config).toEqual(second.config)
      const writes = await Promise.allSettled([
        f.runtime.updateUserProfile({ expectedVersion: 2, profileId: first.config.currentProfileId!, name: 'Winner A' }),
        f.otherRuntime.updateUserProfile({ expectedVersion: 2, profileId: second.config.currentProfileId!, name: 'Winner B' }),
      ])
      expect(writes.filter(write => write.status === 'fulfilled')).toHaveLength(1)
      expect(writes.filter(write => write.status === 'rejected')).toHaveLength(1)
      expect((await f.runtime.getUserProfiles()).config.version).toBe(3)
    } finally {
      f.engine.close()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('validates avatar references and MIME, retaining assets when references are replaced, cleared or deleted', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'loom-user-profile-avatar-'))
    const f = open(directory)
    try {
      const actor = { kind: 'client' as const, id: 'test' }
      const makeAsset = async (mediaType?: string) => (await f.assets.createMediaAsset({
        source: new TextEncoder().encode(mediaType ?? 'unknown'), kind: 'user.avatar', mediaType, actor,
      })).asset
      const image = await makeAsset('image/png')
      const replacement = await makeAsset('image/webp')
      const invalid = await Promise.all([makeAsset('text/html'), makeAsset('image/svg+xml'), makeAsset()])
      const created = await f.runtime.createUserProfile({ expectedVersion: 0 })
      const profileId = created.config.currentProfileId!
      await expect(f.runtime.updateUserProfile({ expectedVersion: 1, profileId, avatarAssetId: 'missing' })).rejects.toThrow(/Media Asset not found/)
      for (const asset of invalid) {
        await expect(f.runtime.updateUserProfile({ expectedVersion: 1, profileId, avatarAssetId: asset.id })).rejects.toThrow(/supported raster image/)
      }
      expect((await f.runtime.getUserProfiles()).config).toEqual(created.config)
      const attached = await f.runtime.updateUserProfile({ expectedVersion: 1, profileId, avatarAssetId: image.id })
      expect(resolveCurrentUserProfile(attached.config).avatarAssetId).toBe(image.id)
      await f.runtime.updateUserProfile({ expectedVersion: 2, profileId, avatarAssetId: replacement.id })
      expect(await f.assets.getMediaAsset(image.id)).toEqual(image)
      const cleared = await f.runtime.updateUserProfile({ expectedVersion: 3, profileId, avatarAssetId: null })
      expect(resolveCurrentUserProfile(cleared.config)).not.toHaveProperty('avatarAssetId')
      await f.runtime.updateUserProfile({ expectedVersion: 4, profileId, avatarAssetId: replacement.id })
      await f.runtime.deleteUserProfile({ expectedVersion: 5, profileId })
      expect(await f.assets.getMediaAsset(replacement.id)).toEqual(replacement)
    } finally {
      f.engine.close()
      await rm(directory, { recursive: true, force: true })
    }
  })
})
