import { createAssetStore } from '@loom-studio/asset-store'
import { createBlobStore } from '@loom-studio/blob-store'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('AssetStore', () => {
  it('keeps Source Artifact identity separate from shared Blob bytes', async () => {
    const fixture = await createFixture()
    const first = await fixture.assets.preserveSourceArtifact({
      source: Buffer.from('{"name":"test"}'),
      format: 'st.preset.json',
      originalFileName: 'preset.json',
      mediaType: 'application/json',
      actor: { kind: 'client', id: 'test' },
    })
    const second = await fixture.assets.preserveSourceArtifact({
      source: Buffer.from('{"name":"test"}'),
      format: 'st.preset.json',
      originalFileName: 'copy.json',
      mediaType: 'application/json',
      actor: { kind: 'client', id: 'test' },
    })

    expect(first.artifact.id).not.toBe(second.artifact.id)
    expect(first.artifact.blobId).toBe(second.artifact.blobId)
    expect(await fixture.assets.getSourceArtifact(first.artifact.id)).toEqual(first.artifact)
    fixture.engine.close()
  })

  it('preserves PNG Source Artifact bytes exactly', async () => {
    const fixture = await createFixture()
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x10])
    const preserved = await fixture.assets.preserveSourceArtifact({
      source: bytes,
      format: 'st.card.png',
      originalFileName: 'character.png',
      mediaType: 'image/png',
      actor: { kind: 'client', id: 'test' },
    })

    expect(Buffer.from(await fixture.blobs.read(preserved.artifact.blobId))).toEqual(bytes)
    fixture.engine.close()
  })

  it('creates multiple Media Assets referencing one Blob', async () => {
    const fixture = await createFixture()
    const blob = await fixture.blobs.write({
      source: Buffer.from('image bytes'),
      mediaType: 'image/png',
      actor: { kind: 'system', id: 'test' },
    })
    const first = await fixture.assets.createMediaAsset({
      blobId: blob.blob.id,
      kind: 'card.avatar',
      actor: { kind: 'client', id: 'test' },
    })
    const second = await fixture.assets.createMediaAsset({
      blobId: blob.blob.id,
      kind: 'card.cover',
      actor: { kind: 'client', id: 'test' },
    })

    expect(first.asset.id).not.toBe(second.asset.id)
    expect(first.asset.blobId).toBe(second.asset.blobId)
    expect(Buffer.from(await fixture.assets.readMediaAsset(first.asset.id)).toString()).toBe('image bytes')
    fixture.engine.close()
  })
})

async function createFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'loom-asset-store-'))
  directories.push(directory)
  let id = 0
  const engine = createSqliteDataEngine({
    filename: join(directory, 'studio.sqlite'),
    createId: prefix => `${prefix}-${++id}`,
    now: () => '2026-08-15T00:00:00.000Z',
  })
  const blobs = createBlobStore({
    engine,
    rootDirectory: join(directory, 'blobs'),
    createId: prefix => `${prefix}-${++id}`,
    now: () => '2026-08-15T00:00:00.000Z',
  })
  const assets = createAssetStore({
    engine,
    blobs,
    createId: prefix => `${prefix}-${++id}`,
    now: () => '2026-08-15T00:00:00.000Z',
  })
  return { directory, engine, blobs, assets }
}
