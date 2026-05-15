import type { JsonValue } from '@loom-studio/shared'
import { createId, nowIso } from '@loom-studio/shared'

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

  return {
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
  }
}
