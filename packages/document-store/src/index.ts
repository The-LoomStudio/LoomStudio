import type { JsonValue } from '@loom-studio/shared'
import { createId, nowIso } from '@loom-studio/shared'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export type ActorRef = {
  kind: 'kernel' | 'client' | 'extension' | 'workspace-adapter' | 'system'
  id: string
}

export type DocumentSourceRef = {
  kind: 'workspace-file' | 'import-package' | 'generated' | 'manual' | string
  uri?: string
  adapterId?: string
  externalId?: string
}

export type TombstoneMeta = {
  deletedAt: string
  deletedBy: ActorRef
  reason?: string
}

export type DocumentMeta = {
  createdAt: string
  updatedAt: string
  createdBy: ActorRef
  updatedBy: ActorRef
  ownerExtensionId?: string
  source?: DocumentSourceRef
  tombstone?: TombstoneMeta
}

export type DocumentRecord<T = JsonValue> = {
  id: string
  type: string
  version: number
  content: T
  meta: DocumentMeta
}

export type ChangesetOperation = {
  kind: 'create' | 'update' | 'delete' | 'restore'
  documentId: string
  type: string
  fromVersion?: number
  toVersion: number
}

export type WriteDocumentInput = {
  id?: string
  type: string
  content: JsonValue
  meta?: Partial<DocumentMeta>
  expectedVersion?: number | 'new'
  reason?: string
  actor?: ActorRef
  correlationId?: string
  callId?: string
  parentCallId?: string
}

export type DeleteDocumentInput = {
  id: string
  expectedVersion?: number
  reason?: string
  actor?: ActorRef
  correlationId?: string
  callId?: string
  parentCallId?: string
}

export type ListDocumentsInput = {
  type?: string
  includeTombstone?: boolean
  ownerExtensionId?: string
  limit?: number
  cursor?: string
}

export type PageResult<T> = {
  items: T[]
  nextCursor?: string
}

export type WriteDocumentResult = {
  changesetId: string
  documents: DocumentRecord[]
  operations: ChangesetOperation[]
  correlationId?: string
  callId?: string
  parentCallId?: string
}

export type DocumentStore = {
  get(id: string, options?: { includeTombstone?: boolean; version?: number }): Promise<DocumentRecord | null>
  list(input?: ListDocumentsInput): Promise<PageResult<DocumentRecord>>
  write(input: WriteDocumentInput): Promise<WriteDocumentResult>
  delete(input: DeleteDocumentInput): Promise<WriteDocumentResult>
  transact<T>(fn: (tx: DocumentStore) => Promise<T>): Promise<T>
}

export type SqliteDocumentStore = DocumentStore & {
  close(): void
}

export type SqliteDocumentStoreOptions = {
  filename: string
}

const kernelActor: ActorRef = {
  kind: 'kernel',
  id: 'kernel',
}

export function createInMemoryDocumentStore(): DocumentStore {
  const current = new Map<string, DocumentRecord>()
  const revisions = new Map<string, DocumentRecord[]>()

  function cloneDocument(document: DocumentRecord): DocumentRecord {
    return structuredClone(document) as DocumentRecord
  }

  function saveRevision(document: DocumentRecord): void {
    const existing = revisions.get(document.id) ?? []
    existing.push(cloneDocument(document))
    revisions.set(document.id, existing)
  }

  const store: DocumentStore = {
    get: async (id, options) => {
      const document = options?.version
        ? revisions.get(id)?.find(revision => revision.version === options.version)
        : current.get(id)

      if (!document) return null
      if (document.meta.tombstone && !options?.includeTombstone) return null

      return cloneDocument(document)
    },

    list: async input => {
      const offset = input?.cursor ? Number(input.cursor) : 0
      const limit = input?.limit ?? 100
      const filtered = [...current.values()].filter(document => {
        if (input?.type && document.type !== input.type) return false
        if (!input?.includeTombstone && document.meta.tombstone) return false
        if (input?.ownerExtensionId && document.meta.ownerExtensionId !== input.ownerExtensionId) return false
        return true
      })
      const items = filtered.slice(offset, offset + limit).map(cloneDocument)
      const nextOffset = offset + limit

      return {
        items,
        nextCursor: nextOffset < filtered.length ? String(nextOffset) : undefined,
      }
    },

    write: async input => {
      const actor = input.actor ?? kernelActor
      const now = nowIso()
      const existing = input.id ? current.get(input.id) : undefined

      if (input.expectedVersion === 'new' && existing) {
        throw new Error(`Document already exists: ${input.id}`)
      }

      if (typeof input.expectedVersion === 'number' && existing?.version !== input.expectedVersion) {
        throw new Error(`Document version conflict: ${input.id}`)
      }

      const document: DocumentRecord = {
        id: input.id ?? createId(input.type),
        type: input.type,
        version: existing ? existing.version + 1 : 1,
        content: input.content,
        meta: {
          createdAt: existing?.meta.createdAt ?? input.meta?.createdAt ?? now,
          updatedAt: now,
          createdBy: existing?.meta.createdBy ?? input.meta?.createdBy ?? actor,
          updatedBy: actor,
          ownerExtensionId: input.meta?.ownerExtensionId ?? existing?.meta.ownerExtensionId,
          source: input.meta?.source ?? existing?.meta.source,
        },
      }

      current.set(document.id, cloneDocument(document))
      saveRevision(document)

      return {
        changesetId: createId('chg'),
        documents: [cloneDocument(document)],
        correlationId: input.correlationId,
        callId: input.callId,
        parentCallId: input.parentCallId,
        operations: [
          {
            kind: existing ? 'update' : 'create',
            documentId: document.id,
            type: document.type,
            fromVersion: existing?.version,
            toVersion: document.version,
          },
        ],
      }
    },

    delete: async input => {
      const actor = input.actor ?? kernelActor
      const existing = current.get(input.id)

      if (!existing) {
        throw new Error(`Document not found: ${input.id}`)
      }

      if (typeof input.expectedVersion === 'number' && existing.version !== input.expectedVersion) {
        throw new Error(`Document version conflict: ${input.id}`)
      }

      const document: DocumentRecord = {
        ...cloneDocument(existing),
        version: existing.version + 1,
        meta: {
          ...existing.meta,
          updatedAt: nowIso(),
          updatedBy: actor,
          tombstone: {
            deletedAt: nowIso(),
            deletedBy: actor,
            reason: input.reason,
          },
        },
      }

      current.set(document.id, cloneDocument(document))
      saveRevision(document)

      return {
        changesetId: createId('chg'),
        documents: [cloneDocument(document)],
        correlationId: input.correlationId,
        callId: input.callId,
        parentCallId: input.parentCallId,
        operations: [
          {
            kind: 'delete',
            documentId: document.id,
            type: document.type,
            fromVersion: existing.version,
            toVersion: document.version,
          },
        ],
      }
    },

    transact: async fn => {
      const currentSnapshot = new Map([...current.entries()].map(([id, document]) => [id, cloneDocument(document)]))
      const revisionsSnapshot = new Map([...revisions.entries()].map(([id, items]) => [id, items.map(cloneDocument)]))

      try {
        return await fn(store)
      } catch (error) {
        current.clear()
        revisions.clear()

        for (const [id, document] of currentSnapshot) {
          current.set(id, document)
        }

        for (const [id, items] of revisionsSnapshot) {
          revisions.set(id, items)
        }

        throw error
      }
    },
  }

  return store
}

export function createSqliteDocumentStore(options: SqliteDocumentStoreOptions): SqliteDocumentStore {
  if (options.filename !== ':memory:') {
    mkdirSync(dirname(options.filename), { recursive: true })
  }

  const database = new DatabaseSync(options.filename)
  let transactionDepth = 0
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

  const store: SqliteDocumentStore = {
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

    write: async input => {
      const actor = input.actor ?? kernelActor
      const timestamp = nowIso()
      const existing = input.id ? getCurrent(database, input.id) : undefined

      if (input.expectedVersion === 'new' && existing) {
        throw new Error(`Document already exists: ${input.id}`)
      }

      if (typeof input.expectedVersion === 'number' && existing?.version !== input.expectedVersion) {
        throw new Error(`Document version conflict: ${input.id}`)
      }

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
        kind: existing ? 'update' : 'create',
        documentId: document.id,
        type: document.type,
        fromVersion: existing?.version,
        toVersion: document.version,
      }
      const changesetId = createId('chg')

      writeChangeset(database, {
        changesetId,
        actor,
        timestamp,
        reason: input.reason,
        correlationId: input.correlationId,
        callId: input.callId,
        parentCallId: input.parentCallId,
        operations: [operation],
        documents: [document],
      }, transactionDepth > 0)

      return {
        changesetId,
        documents: [cloneDocument(document)],
        correlationId: input.correlationId,
        callId: input.callId,
        parentCallId: input.parentCallId,
        operations: [operation],
      }
    },

    delete: async input => {
      const actor = input.actor ?? kernelActor
      const existing = getCurrent(database, input.id)

      if (!existing) {
        throw new Error(`Document not found: ${input.id}`)
      }

      if (typeof input.expectedVersion === 'number' && existing.version !== input.expectedVersion) {
        throw new Error(`Document version conflict: ${input.id}`)
      }

      const timestamp = nowIso()
      const document: DocumentRecord = {
        ...cloneDocument(existing),
        version: existing.version + 1,
        meta: {
          ...existing.meta,
          updatedAt: timestamp,
          updatedBy: actor,
          tombstone: {
            deletedAt: timestamp,
            deletedBy: actor,
            reason: input.reason,
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
      const changesetId = createId('chg')

      writeChangeset(database, {
        changesetId,
        actor,
        timestamp,
        reason: input.reason,
        correlationId: input.correlationId,
        callId: input.callId,
        parentCallId: input.parentCallId,
        operations: [operation],
        documents: [document],
      }, transactionDepth > 0)

      return {
        changesetId,
        documents: [cloneDocument(document)],
        correlationId: input.correlationId,
        callId: input.callId,
        parentCallId: input.parentCallId,
        operations: [operation],
      }
    },

    close: () => {
      database.close()
    },

    transact: async fn => {
      if (transactionDepth > 0) {
        transactionDepth += 1

        try {
          return await fn(store)
        } finally {
          transactionDepth -= 1
        }
      }

      database.exec('BEGIN IMMEDIATE')
      transactionDepth = 1

      try {
        const result = await fn(store)
        database.exec('COMMIT')
        return result
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      } finally {
        transactionDepth = 0
      }
    },
  }

  return store
}

function writeChangeset(
  database: DatabaseSync,
  input: {
    changesetId: string
    actor: ActorRef
    timestamp: string
    reason?: string
    correlationId?: string
    callId?: string
    parentCallId?: string
    operations: ChangesetOperation[]
    documents: DocumentRecord[]
  },
  useExistingTransaction = false,
): void {
  if (!useExistingTransaction) {
    database.exec('BEGIN IMMEDIATE')
  }

  try {
    database
      .prepare('INSERT INTO changesets (id, created_at, created_by_json, reason, correlation_id, call_id, parent_call_id, operations_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(
        input.changesetId,
        input.timestamp,
        JSON.stringify(input.actor),
        input.reason ?? null,
        input.correlationId ?? null,
        input.callId ?? null,
        input.parentCallId ?? null,
        JSON.stringify(input.operations),
      )

    for (const document of input.documents) {
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
          input.changesetId,
          input.timestamp,
          JSON.stringify(input.actor),
        )
    }

    if (!useExistingTransaction) {
      database.exec('COMMIT')
    }
  } catch (error) {
    if (!useExistingTransaction) {
      database.exec('ROLLBACK')
    }
    throw error
  }
}

function getCurrent(database: DatabaseSync, id: string): DocumentRecord | undefined {
  const row = database.prepare('SELECT id, type, version, content_json, meta_json FROM documents WHERE id = ?').get(id)
  return row ? rowToDocument(row) : undefined
}

function rowToDocument(row: unknown): DocumentRecord {
  const record = row as {
    id: string
    type: string
    version: number
    content_json: string
    meta_json: string
  }

  return {
    id: record.id,
    type: record.type,
    version: record.version,
    content: JSON.parse(record.content_json) as JsonValue,
    meta: JSON.parse(record.meta_json) as DocumentMeta,
  }
}

function cloneDocument(document: DocumentRecord): DocumentRecord {
  return structuredClone(document) as DocumentRecord
}
