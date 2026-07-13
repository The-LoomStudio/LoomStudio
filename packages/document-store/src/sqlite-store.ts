import type { JsonValue } from '@loom-studio/shared'
import { createId, nowIso } from '@loom-studio/shared'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  assertExpectedVersion,
  cloneDocument,
  createPendingChangeset,
  finalizeChangeset,
  recordPendingChange,
  restoredDocument,
  transactionInputFromWrite,
  writeResult,
  writeResultFromChangeset,
  type PendingChangeset,
} from './changeset.js'
import type {
  ActorRef,
  Changeset,
  ChangesetOperation,
  DeleteDocumentInput,
  DocumentMeta,
  DocumentRecord,
  DocumentTransaction,
  DocumentTransactionInput,
  DocumentTransactionResult,
  SqliteDocumentStore,
  SqliteDocumentStoreOptions,
  WriteDocumentInput,
  WriteDocumentResult,
} from './types.js'
import { DocumentStoreError as StoreError } from './types.js'

export function createSqliteDocumentStore(options: SqliteDocumentStoreOptions): SqliteDocumentStore {
  if (options.filename !== ':memory:') {
    mkdirSync(dirname(options.filename), { recursive: true })
  }

  const database = new DatabaseSync(options.filename)
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      version INTEGER NOT NULL,
      content_json TEXT NOT NULL,
      meta_json TEXT NOT NULL,
      owner_extension_id TEXT,
      tombstoned INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS document_revisions (
      document_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      type TEXT NOT NULL,
      content_json TEXT NOT NULL,
      meta_json TEXT NOT NULL,
      changeset_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      created_by_json TEXT NOT NULL,
      PRIMARY KEY (document_id, version)
    );

    CREATE TABLE IF NOT EXISTS changesets (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      created_by_json TEXT NOT NULL,
      reason TEXT,
      correlation_id TEXT,
      call_id TEXT,
      parent_call_id TEXT,
      operations_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_documents_type ON documents(type);
    CREATE INDEX IF NOT EXISTS idx_documents_owner ON documents(owner_extension_id);
    CREATE INDEX IF NOT EXISTS idx_documents_tombstoned ON documents(tombstoned);
    CREATE INDEX IF NOT EXISTS idx_revisions_document ON document_revisions(document_id, version);
  `)

  const read: Pick<DocumentTransaction, 'get' | 'list'> = {
    get: async (id, options) => {
      const row = options?.version
        ? database.prepare('SELECT document_id AS id, type, version, content_json, meta_json FROM document_revisions WHERE document_id = ? AND version = ?').get(id, options.version)
        : database.prepare('SELECT id, type, version, content_json, meta_json FROM documents WHERE id = ?').get(id)

      if (!row) return null

      const document = rowToDocument(row)
      if (document.meta.tombstone && !options?.includeTombstone) return null

      return document
    },

    list: async input => {
      const offset = input?.cursor ? Number(input.cursor) : 0
      const limit = input?.limit ?? 100
      const clauses: string[] = []
      const values: Array<string | number> = []

      if (input?.type) {
        clauses.push('type = ?')
        values.push(input.type)
      }

      if (!input?.includeTombstone) {
        clauses.push('tombstoned = 0')
      }

      if (input?.ownerExtensionId) {
        clauses.push('owner_extension_id = ?')
        values.push(input.ownerExtensionId)
      }

      const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
      const rows = database
        .prepare(`SELECT id, type, version, content_json, meta_json FROM documents ${where} ORDER BY rowid LIMIT ? OFFSET ?`)
        .all(...values, limit, offset)
      const items = rows.map(rowToDocument)
      const nextOffset = offset + limit
      const hasMore = rows.length === limit && database
        .prepare(`SELECT 1 FROM documents ${where} ORDER BY rowid LIMIT 1 OFFSET ?`)
        .get(...values, nextOffset)

      return {
        items,
        nextCursor: hasMore ? String(nextOffset) : undefined,
      }
    },
  }

  function applyWrite(input: WriteDocumentInput, pending: PendingChangeset): WriteDocumentResult {
    const actor = pending.createdBy
    const timestamp = nowIso()
    const existing = input.id ? getCurrent(database, input.id) : undefined

    assertExpectedVersion(input.id, existing, input.expectedVersion)

    const document: DocumentRecord = {
      id: input.id ?? createId(input.type),
      type: input.type,
      version: existing ? existing.version + 1 : 1,
      content: input.content,
      meta: {
        createdAt: existing?.meta.createdAt ?? input.meta?.createdAt ?? timestamp,
        updatedAt: timestamp,
        createdBy: existing?.meta.createdBy ?? input.meta?.createdBy ?? actor,
        updatedBy: actor,
        ownerExtensionId: input.meta?.ownerExtensionId ?? existing?.meta.ownerExtensionId,
        source: input.meta?.source ?? existing?.meta.source,
      },
    }
    const operation: ChangesetOperation = {
      kind: existing?.meta.tombstone ? 'restore' : existing ? 'update' : 'create',
      documentId: document.id,
      type: document.type,
      fromVersion: existing?.version,
      toVersion: document.version,
    }

    writeDocumentRevision(database, document, pending.id)
    recordPendingChange(pending, operation, document)

    return writeResult(pending, [document], [operation])
  }

  function applyDelete(input: DeleteDocumentInput, pending: PendingChangeset): WriteDocumentResult {
    const existing = getCurrent(database, input.id)

    if (!existing) {
      throw new StoreError('document.not_found', `Document not found: ${input.id}`)
    }

    if (typeof input.expectedVersion === 'number' && existing.version !== input.expectedVersion) {
      throw new StoreError('document.conflict', `Document version conflict: ${input.id}`)
    }

    const timestamp = nowIso()
    const document: DocumentRecord = {
      ...cloneDocument(existing),
      version: existing.version + 1,
      meta: {
        ...existing.meta,
        updatedAt: timestamp,
        updatedBy: pending.createdBy,
        tombstone: {
          deletedAt: timestamp,
          deletedBy: pending.createdBy,
          reason: input.reason ?? pending.reason,
        },
      },
    }
    const operation: ChangesetOperation = {
      kind: 'delete',
      documentId: document.id,
      type: document.type,
      fromVersion: existing.version,
      toVersion: document.version,
    }

    writeDocumentRevision(database, document, pending.id)
    recordPendingChange(pending, operation, document)

    return writeResult(pending, [document], [operation])
  }

  function applyRestore(target: DocumentRecord, pending: PendingChangeset): DocumentRecord {
    const existing = getCurrent(database, target.id)
    if (!existing) throw new StoreError('document.not_found', `Document not found: ${target.id}`)

    const document = restoredDocument(existing, target, pending.createdBy)
    const operation: ChangesetOperation = {
      kind: 'restore',
      documentId: document.id,
      type: document.type,
      fromVersion: existing.version,
      toVersion: document.version,
    }

    writeDocumentRevision(database, document, pending.id)
    recordPendingChange(pending, operation, document)

    return document
  }

  function createTransaction(pending: PendingChangeset): DocumentTransaction {
    return {
      ...read,
      write: async input => applyWrite(input, pending),
      delete: async input => applyDelete(input, pending),
    }
  }

  function runTransaction<T>(
    input: DocumentTransactionInput,
    fn: (pending: PendingChangeset, tx: DocumentTransaction) => Promise<T>,
  ): Promise<DocumentTransactionResult<T>> {
    return (async () => {
      const pending = createPendingChangeset(input)
      database.exec('BEGIN IMMEDIATE')

      try {
        const value = await fn(pending, createTransaction(pending))
        const changeset = finalizeChangeset(pending)
        insertChangeset(database, changeset)
        database.exec('COMMIT')
        return { value, changeset }
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
    })()
  }

  const store: SqliteDocumentStore = {
    ...read,

    write: async input => {
      const result = await runTransaction(transactionInputFromWrite(input), async pending => applyWrite(input, pending))
      return { ...result.value, operations: result.changeset.operations }
    },

    delete: async input => {
      const result = await runTransaction(transactionInputFromWrite(input), async pending => applyDelete(input, pending))
      return { ...result.value, operations: result.changeset.operations }
    },

    transact: (input, fn) => runTransaction(input, async (_pending, tx) => fn(tx)),

    getChangeset: async id => {
      const row = database
        .prepare('SELECT id, created_at, created_by_json, reason, correlation_id, call_id, parent_call_id, operations_json FROM changesets WHERE id = ?')
        .get(id)
      return row ? rowToChangeset(row) : null
    },

    revertChangeset: async input => {
      const result = await runTransaction(input, async pending => {
        const row = database
          .prepare('SELECT id, created_at, created_by_json, reason, correlation_id, call_id, parent_call_id, operations_json FROM changesets WHERE id = ?')
          .get(input.changesetId)
        if (!row) throw new StoreError('document.changeset_not_found', `Changeset not found: ${input.changesetId}`)
        const target = rowToChangeset(row)
        const restoreTargets = target.operations.map(operation => {
          const existing = getCurrent(database, operation.documentId)
          if (!existing || existing.version !== operation.toVersion) {
            throw new StoreError('document.conflict', `Document version conflict: ${operation.documentId}`)
          }

          if (operation.fromVersion === undefined) return { operation }

          const revision = getRevision(database, operation.documentId, operation.fromVersion)
          if (!revision) {
            throw new StoreError('document.revision_not_found', `Document revision not found: ${operation.documentId}@${operation.fromVersion}`)
          }

          return { operation, revision }
        })

        return restoreTargets.map(item => item.revision
          ? applyRestore(item.revision, pending)
          : applyDelete({ id: item.operation.documentId, expectedVersion: item.operation.toVersion }, pending).documents[0]!)
      })

      return writeResultFromChangeset(result.changeset, result.value)
    },

    close: () => {
      database.close()
    },
  }

  return store
}

function insertChangeset(database: DatabaseSync, changeset: Changeset): void {
  database
    .prepare('INSERT INTO changesets (id, created_at, created_by_json, reason, correlation_id, call_id, parent_call_id, operations_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(
      changeset.id,
      changeset.createdAt,
      JSON.stringify(changeset.createdBy),
      changeset.reason ?? null,
      changeset.correlationId ?? null,
      changeset.callId ?? null,
      changeset.parentCallId ?? null,
      JSON.stringify(changeset.operations),
    )
}

function writeDocumentRevision(database: DatabaseSync, document: DocumentRecord, changesetId: string): void {
  database
    .prepare('INSERT OR REPLACE INTO documents (id, type, version, content_json, meta_json, owner_extension_id, tombstoned, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(
      document.id,
      document.type,
      document.version,
      JSON.stringify(document.content),
      JSON.stringify(document.meta),
      document.meta.ownerExtensionId ?? null,
      document.meta.tombstone ? 1 : 0,
      document.meta.updatedAt,
    )
  database
    .prepare('INSERT INTO document_revisions (document_id, version, type, content_json, meta_json, changeset_id, created_at, created_by_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(
      document.id,
      document.version,
      document.type,
      JSON.stringify(document.content),
      JSON.stringify(document.meta),
      changesetId,
      document.meta.updatedAt,
      JSON.stringify(document.meta.updatedBy),
    )
}

function getCurrent(database: DatabaseSync, id: string): DocumentRecord | undefined {
  const row = database.prepare('SELECT id, type, version, content_json, meta_json FROM documents WHERE id = ?').get(id)
  return row ? rowToDocument(row) : undefined
}

function getRevision(database: DatabaseSync, documentId: string, version: number): DocumentRecord | undefined {
  const row = database
    .prepare('SELECT document_id AS id, type, version, content_json, meta_json FROM document_revisions WHERE document_id = ? AND version = ?')
    .get(documentId, version)
  return row ? rowToDocument(row) : undefined
}

function rowToDocument(row: unknown): DocumentRecord {
  const value = row as {
    id: string
    type: string
    version: number
    content_json: string
    meta_json: string
  }

  return {
    id: value.id,
    type: value.type,
    version: value.version,
    content: JSON.parse(value.content_json) as JsonValue,
    meta: JSON.parse(value.meta_json) as DocumentMeta,
  }
}

function rowToChangeset(row: unknown): Changeset {
  const value = row as {
    id: string
    created_at: string
    created_by_json: string
    reason: string | null
    correlation_id: string | null
    call_id: string | null
    parent_call_id: string | null
    operations_json: string
  }

  return {
    id: value.id,
    createdAt: value.created_at,
    createdBy: JSON.parse(value.created_by_json) as ActorRef,
    reason: value.reason ?? undefined,
    correlationId: value.correlation_id ?? undefined,
    callId: value.call_id ?? undefined,
    parentCallId: value.parent_call_id ?? undefined,
    operations: JSON.parse(value.operations_json) as ChangesetOperation[],
  }
}
