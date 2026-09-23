import { createBlobStore, BlobStoreError } from '@loom-studio/blob-store'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
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

  it.each([false, true])('preserves another prepared write after rollback and discard (separate store: %s)', async separateStore => {
    const fixture = await createFixture()
    try {
      const otherStore = separateStore ? createStore(fixture.engine, fixture.blobRoot) : fixture.store
      const first = await fixture.store.prepareWrite({ source: Buffer.from('shared prepared bytes') })
      const second = await otherStore.prepareWrite({ source: Buffer.from('shared prepared bytes') })
      expect(first.existing).toBe(false)
      expect(second.existing).toBe(false)

      await expect(fixture.engine.transact({ actor: { kind: 'system', id: 'test' } }, async tx => {
        fixture.store.participateWrite(tx, first)
        throw new Error('rollback')
      })).rejects.toThrow('rollback')
      await fixture.store.discardPreparedWrite(first)
      await fixture.store.discardPreparedWrite(first)
      expect(await fixture.store.getBySha256(first.blob.sha256)).toBeUndefined()

      const committed = await fixture.engine.transact({ actor: { kind: 'system', id: 'test' } }, async tx =>
        otherStore.participateWrite(tx, second))
      await otherStore.discardPreparedWrite(second)

      expect(Buffer.from(await otherStore.read(committed.value.blob.id)).toString()).toBe('shared prepared bytes')
      expect(fixture.engine.database.prepare('SELECT COUNT(*) AS count FROM stored_blobs').get()).toEqual({ count: 1 })
    } finally {
      await fixture.engine.close()
    }
  })

  it('retains unreferenced finalized bytes without metadata when a prepared write is discarded', async () => {
    const fixture = await createFixture()
    try {
      const prepared = await fixture.store.prepareWrite({ source: Buffer.from('unreferenced bytes') })
      await fixture.store.discardPreparedWrite(prepared)

      expect(await fixture.store.getBySha256(prepared.blob.sha256)).toBeUndefined()
      expect(await readdir(join(fixture.blobRoot, 'staging'))).toEqual([])
      const hash = prepared.blob.sha256
      expect(await readFile(join(fixture.blobRoot, 'sha256', hash.slice(0, 2), hash.slice(2, 4), hash), 'utf8'))
        .toBe('unreferenced bytes')
    } finally {
      await fixture.engine.close()
    }
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

  it('participates in a caller-owned transaction without exposing rolled-back metadata', async () => {
    const fixture = await createFixture()
    const prepared = await fixture.store.prepareWrite({ source: Buffer.from('transactional') })

    await expect(fixture.engine.transact({ actor: { kind: 'system', id: 'test' } }, async tx => {
      fixture.store.participateWrite(tx, prepared)
      throw new Error('rollback')
    })).rejects.toThrow('rollback')
    expect(await fixture.store.get(prepared.blob.id)).toBeUndefined()

    await fixture.engine.transact({ actor: { kind: 'system', id: 'test' } }, async tx => {
      fixture.store.participateWrite(tx, prepared)
    })
    expect(Buffer.from(await fixture.store.read(prepared.blob.id)).toString()).toBe('transactional')
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
