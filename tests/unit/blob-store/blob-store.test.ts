import { createBlobStore, BlobStoreError } from '@loom-studio/blob-store'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('BlobStore', () => {
  it('persists immutable bytes and deduplicates by SHA-256', async () => {
    const fixture = await createFixture()
    const first = await fixture.store.write({
      source: Buffer.from('same bytes'),
      mediaType: 'text/plain',
      actor: { kind: 'system', id: 'test' },
    })
    const second = await fixture.store.write({
      source: Buffer.from('same bytes'),
      mediaType: 'text/plain',
      actor: { kind: 'system', id: 'test' },
    })

    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
    expect(second.blob.id).toBe(first.blob.id)
    expect(Buffer.from(await fixture.store.read(first.blob.id)).toString()).toBe('same bytes')
    const filename = join(
      fixture.blobRoot,
      'sha256',
      first.blob.sha256.slice(0, 2),
      first.blob.sha256.slice(2, 4),
      first.blob.sha256,
    )
    expect(await readFile(filename, 'utf8')).toBe('same bytes')
    fixture.engine.close()
  })

  it('deduplicates concurrent writes of the same bytes', async () => {
    const fixture = await createFixture()
    const [first, second] = await Promise.all([
      fixture.store.write({ source: Buffer.from('concurrent'), actor: { kind: 'system', id: 'test' } }),
      fixture.store.write({ source: Buffer.from('concurrent'), actor: { kind: 'system', id: 'test' } }),
    ])

    expect(first.blob.id).toBe(second.blob.id)
    expect(fixture.engine.database.prepare('SELECT COUNT(*) AS count FROM stored_blobs').get()).toEqual({ count: 1 })
    fixture.engine.close()
  })

  it('survives reopening the shared SQLite engine', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'loom-blob-store-'))
    directories.push(directory)
    const databaseFile = join(directory, 'studio.sqlite')
    const blobRoot = join(directory, 'blobs')
    const firstEngine = createEngine(databaseFile)
    const firstStore = createStore(firstEngine, blobRoot)
    const written = await firstStore.write({
      source: Buffer.from('persistent'),
      actor: { kind: 'system', id: 'test' },
    })
    firstEngine.close()

    const secondEngine = createEngine(databaseFile)
    const secondStore = createStore(secondEngine, blobRoot)
    expect(await secondStore.get(written.blob.id)).toEqual(written.blob)
    expect(Buffer.from(await secondStore.read(written.blob.id)).toString()).toBe('persistent')
    secondEngine.close()
  })

  it('rejects oversized input without committing metadata', async () => {
    const fixture = await createFixture()
    await expect(fixture.store.write({
      source: Buffer.from('too large'),
      maxBytes: 3,
      actor: { kind: 'system', id: 'test' },
    })).rejects.toMatchObject<Partial<BlobStoreError>>({ code: 'blob.too_large' })
    expect(fixture.engine.database.prepare('SELECT COUNT(*) AS count FROM stored_blobs').get()).toEqual({ count: 0 })
    fixture.engine.close()
  })
})

async function createFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'loom-blob-store-'))
  directories.push(directory)
  const blobRoot = join(directory, 'blobs')
  const engine = createEngine(join(directory, 'studio.sqlite'))
  return { blobRoot, engine, store: createStore(engine, blobRoot) }
}

function createEngine(filename: string) {
  let id = 0
  return createSqliteDataEngine({
    filename,
    createId: prefix => `${prefix}-${++id}`,
    now: () => '2026-08-15T00:00:00.000Z',
  })
}

function createStore(engine: ReturnType<typeof createEngine>, rootDirectory: string) {
  let id = 0
  return createBlobStore({
    engine,
    rootDirectory,
    createId: prefix => `${prefix}-${++id}`,
    now: () => '2026-08-15T00:00:00.000Z',
  })
}
