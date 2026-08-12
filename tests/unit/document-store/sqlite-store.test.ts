import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { mkdtemp, rm } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'

describe('sqlite document store', () => {
  it('creates schema version 1 with the expected tables, indexes, and WAL mode', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'loom-docstore-'))
    const filename = join(dir, 'store.sqlite')

    try {
      const store = createSqliteDocumentStore({ filename })
      store.close()
      const database = new DatabaseSync(filename)
      const migrations = database.prepare('SELECT namespace, version FROM schema_migrations ORDER BY namespace').all()
      const journal = database.prepare('PRAGMA journal_mode').get() as { journal_mode: string }
      const objects = database.prepare("SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all()
      const changesetColumns = database.prepare('PRAGMA table_info(changesets)').all() as Array<{ name: string }>
      database.close()

      expect(migrations).toEqual([
        { namespace: 'platform.data-engine', version: 1 },
        { namespace: 'platform.documents', version: 1 },
      ])
      expect(journal.journal_mode).toBe('wal')
      expect(changesetColumns.map(column => column.name)).toContain('committed_at')
      expect(objects).toEqual([
        { type: 'index', name: 'idx_documents_owner' },
        { type: 'index', name: 'idx_documents_tombstoned' },
        { type: 'index', name: 'idx_documents_type' },
        { type: 'index', name: 'idx_revisions_document' },
        { type: 'table', name: 'changesets' },
        { type: 'table', name: 'document_revisions' },
        { type: 'table', name: 'documents' },
        { type: 'table', name: 'schema_migrations' },
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('upgrades an unversioned existing schema without losing documents', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'loom-docstore-'))
    const filename = join(dir, 'store.sqlite')

    try {
      const first = createSqliteDocumentStore({ filename })
      await first.write({
        id: 'legacy-doc',
        type: 'example.note',
        content: { preserved: true },
        expectedVersion: 'new',
      })
      first.close()
      const legacy = new DatabaseSync(filename)
      legacy.prepare('DELETE FROM schema_migrations WHERE namespace = ?').run('platform.documents')
      legacy.close()

      const migrated = createSqliteDocumentStore({ filename })
      expect(await migrated.get('legacy-doc')).toMatchObject({ content: { preserved: true } })
      migrated.close()
      const inspected = new DatabaseSync(filename)
      const version = inspected.prepare('SELECT version FROM schema_migrations WHERE namespace = ?').get('platform.documents') as { version: number }
      inspected.close()

      expect(version.version).toBe(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rolls back a failed migration without advancing the schema version', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'loom-docstore-'))
    const filename = join(dir, 'store.sqlite')

    try {
      const incompatible = new DatabaseSync(filename)
      incompatible.exec('CREATE TABLE documents (id TEXT PRIMARY KEY);')
      incompatible.close()

      expect(() => createSqliteDocumentStore({ filename })).toThrow()

      const inspected = new DatabaseSync(filename)
      const migrations = inspected.prepare('SELECT namespace, version FROM schema_migrations ORDER BY namespace').all()
      const tables = inspected.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
      const indexes = inspected.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%' ORDER BY name").all()
      inspected.close()

      expect(migrations).toEqual([{ namespace: 'platform.data-engine', version: 1 }])
      expect(tables).toEqual([
        { name: 'changesets' },
        { name: 'documents' },
        { name: 'schema_migrations' },
      ])
      expect(indexes).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects an incomplete unversioned schema without advancing the schema version', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'loom-docstore-'))
    const filename = join(dir, 'store.sqlite')

    try {
      const incomplete = new DatabaseSync(filename)
      incomplete.exec(`
        CREATE TABLE documents (
          id TEXT PRIMARY KEY, type TEXT NOT NULL, version INTEGER NOT NULL,
          content_json TEXT NOT NULL, meta_json TEXT NOT NULL, owner_extension_id TEXT,
          tombstoned INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
        );
        CREATE TABLE document_revisions (
          document_id TEXT NOT NULL, version INTEGER NOT NULL, type TEXT NOT NULL,
          content_json TEXT NOT NULL, meta_json TEXT NOT NULL, changeset_id TEXT NOT NULL,
          created_at TEXT NOT NULL, PRIMARY KEY (document_id, version)
        );
        CREATE TABLE changesets (
          id TEXT PRIMARY KEY, created_at TEXT NOT NULL, created_by_json TEXT NOT NULL,
          reason TEXT, correlation_id TEXT, call_id TEXT, parent_call_id TEXT,
          operations_json TEXT NOT NULL
        );
      `)
      incomplete.close()

      expect(() => createSqliteDocumentStore({ filename }))
        .toThrow('SQLite table document_revisions is missing required columns: created_by_json')

      const inspected = new DatabaseSync(filename)
      const migrations = inspected.prepare('SELECT namespace, version FROM schema_migrations ORDER BY namespace').all()
      inspected.close()

      expect(migrations).toEqual([{ namespace: 'platform.data-engine', version: 1 }])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects databases created by a newer document schema version', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'loom-docstore-'))
    const filename = join(dir, 'store.sqlite')

    try {
      const newer = new DatabaseSync(filename)
      newer.exec(`
        CREATE TABLE schema_migrations (namespace TEXT PRIMARY KEY, version INTEGER NOT NULL);
        INSERT INTO schema_migrations (namespace, version) VALUES ('platform.documents', 2);
      `)
      newer.close()

      expect(() => createSqliteDocumentStore({ filename }))
        .toThrow('SQLite schema platform.documents@2 is newer than supported version 1')

      const inspected = new DatabaseSync(filename)
      const version = inspected.prepare('SELECT version FROM schema_migrations WHERE namespace = ?').get('platform.documents') as { version: number }
      const journal = inspected.prepare('PRAGMA journal_mode').get() as { journal_mode: string }
      inspected.close()

      expect(version.version).toBe(2)
      expect(journal.journal_mode).toBe('wal')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('persists current documents and revisions across store instances', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'loom-docstore-'))
    const filename = join(dir, 'store.sqlite')

    try {
      const first = createSqliteDocumentStore({ filename })
      const created = await first.write({
        id: 'doc-1',
        type: 'example.note',
        content: { text: 'v1' },
        expectedVersion: 'new',
      })
      const updated = await first.write({
        id: 'doc-1',
        type: 'example.note',
        content: { text: 'v2' },
        expectedVersion: 1,
      })
      first.close()

      const second = createSqliteDocumentStore({ filename })
      const current = await second.get('doc-1')
      const revision = await second.get('doc-1', { version: 1 })
      const changeset = await second.getChangeset(updated.changesetId)
      const listed = await second.list({ type: 'example.note' })
      second.close()

      expect(created.operations[0]).toMatchObject({ kind: 'create', toVersion: 1 })
      expect(updated.operations[0]).toMatchObject({ kind: 'update', fromVersion: 1, toVersion: 2 })
      expect(current).toMatchObject({ id: 'doc-1', version: 2, content: { text: 'v2' } })
      expect(revision).toMatchObject({ id: 'doc-1', version: 1, content: { text: 'v1' } })
      expect(changeset).toMatchObject({ id: updated.changesetId, operations: updated.operations })
      expect(listed.items).toHaveLength(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('uses the shared data engine changeset id and leaves an external engine open', async () => {
    let nextId = 0
    const engine = createSqliteDataEngine({
      filename: ':memory:',
      createId: prefix => `${prefix}-${++nextId}`,
      now: () => '2026-08-12T00:00:00.000Z',
    })
    const store = createSqliteDocumentStore({ engine })
    const engineCommits: string[] = []
    const documentCommits: string[] = []
    engine.subscribeCommits(commit => engineCommits.push(commit.changesetId))
    store.subscribeCommits(commit => documentCommits.push(commit.changesetId))

    const written = await store.write({
      id: 'shared-doc',
      type: 'example.note',
      content: { ok: true },
      expectedVersion: 'new',
    })

    expect(written.changesetId).toBe(written.commit.changesetId)
    expect(engineCommits).toEqual([written.changesetId])
    expect(documentCommits).toEqual([written.changesetId])

    const mixed = await engine.transact({ actor: { kind: 'system', id: 'test' } }, async tx => {
      tx.recordOperations([
        {
          store: 'documents',
          kind: 'update',
          entityId: 'shared-doc',
          entityType: 'example.note',
          fromVersion: 1,
          toVersion: 1,
        },
        {
          store: 'agent',
          kind: 'create',
          entityId: 'message-1',
          entityType: 'agent.message',
        },
      ])
    })
    await expect(store.revertChangeset({
      changesetId: mixed.commit.changesetId,
      actor: { kind: 'system', id: 'test' },
    })).rejects.toMatchObject({ code: 'document.changeset_not_revertible' })

    store.close()
    await expect(engine.read(database => database.prepare('SELECT 1 AS ok').get())).resolves.toEqual({ ok: 1 })
    engine.close()
  })

  it('serializes concurrent public operations around an open transaction', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'loom-docstore-'))
    const filename = join(dir, 'store.sqlite')

    try {
      const store = createSqliteDocumentStore({ filename })
      let releaseTransaction!: () => void
      const transactionGate = new Promise<void>(resolve => {
        releaseTransaction = resolve
      })
      let transactionStarted!: () => void
      const started = new Promise<void>(resolve => {
        transactionStarted = resolve
      })

      const transaction = store.transact({ actor: { kind: 'system', id: 'test' } }, async tx => {
        await tx.write({
          id: 'transaction-doc',
          type: 'example.note',
          content: { committed: false },
          expectedVersion: 'new',
        })
        transactionStarted()
        await transactionGate
      })
      await started

      const concurrentRead = store.get('transaction-doc')
      const concurrentWrite = store.write({
        id: 'concurrent-doc',
        type: 'example.note',
        content: { committed: true },
        expectedVersion: 'new',
      })
      let readSettled = false
      let writeSettled = false
      void concurrentRead.finally(() => {
        readSettled = true
      })
      void concurrentWrite.finally(() => {
        writeSettled = true
      })
      await Promise.resolve()

      expect(readSettled).toBe(false)
      expect(writeSettled).toBe(false)
      releaseTransaction()

      await expect(transaction).resolves.toMatchObject({ changeset: { operations: [{ documentId: 'transaction-doc' }] } })
      await expect(concurrentRead).resolves.toMatchObject({ id: 'transaction-doc' })
      await expect(concurrentWrite).resolves.toMatchObject({ documents: [{ id: 'concurrent-doc' }] })
      store.close()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('keeps tombstoned documents out of default reads while preserving history', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'loom-docstore-'))
    const filename = join(dir, 'store.sqlite')

    try {
      const store = createSqliteDocumentStore({ filename })
      await store.write({
        id: 'doc-delete',
        type: 'example.note',
        content: { ok: true },
        expectedVersion: 'new',
      })
      const deleted = await store.delete({
        id: 'doc-delete',
        expectedVersion: 1,
        reason: 'test delete',
      })
      const hidden = await store.get('doc-delete')
      const included = await store.get('doc-delete', { includeTombstone: true })
      const revision = await store.get('doc-delete', { version: 1 })
      const listed = await store.list({ type: 'example.note' })
      store.close()

      expect(deleted.operations[0]).toMatchObject({ kind: 'delete', fromVersion: 1, toVersion: 2 })
      expect(hidden).toBeNull()
      expect(included?.meta.tombstone?.reason).toBe('test delete')
      expect(revision).toMatchObject({ version: 1, content: { ok: true } })
      expect(listed.items).toHaveLength(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rolls back writes when a transaction fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'loom-docstore-'))
    const filename = join(dir, 'store.sqlite')

    try {
      const store = createSqliteDocumentStore({ filename })

      await expect(store.transact({ actor: { kind: 'system', id: 'test' } }, async tx => {
        await tx.write({
          id: 'rolled-back',
          type: 'example.note',
          content: { ok: false },
          expectedVersion: 'new',
        })
        throw new Error('stop transaction')
      })).rejects.toThrow('stop transaction')

      expect(await store.get('rolled-back')).toBeNull()
      store.close()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
