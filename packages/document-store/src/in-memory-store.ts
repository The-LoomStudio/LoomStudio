import { AsyncLocalStorage } from 'node:async_hooks'
import { createId, nowIso } from '@loom-studio/shared'
import {
  assertExpectedVersion,
  cloneChangeset,
  cloneDocument,
  createCommitNotifier,
  createPendingChangeset,
  finalizeCommitFact,
  recordPendingChange,
  restoredDocument,
  writeResult,
  type PendingChangeset,
} from './changeset.js'
import type {
  Changeset,
  ChangesetOperation,
  DeleteDocumentInput,
  DocumentRecord,
  DocumentStore,
  DocumentTransaction,
  WriteDocumentInput,
  WriteDocumentResult,
} from './types.js'
import { DocumentStoreError as StoreError } from './types.js'
import { readDocumentPage } from './pagination.js'

export function createInMemoryDocumentStore(): DocumentStore {
  const current = new Map<string, DocumentRecord>()
  const revisions = new Map<string, DocumentRecord[]>()
  const changesets = new Map<string, Changeset>()
  const commitNotifier = createCommitNotifier()
  const transactionContext = new AsyncLocalStorage<boolean>()
  let operationQueue = Promise.resolve()

  async function serialize<T>(operation: () => T | Promise<T>): Promise<T> {
    if (transactionContext.getStore()) {
      throw new StoreError('document.reentrant_transaction', 'Use the transaction instance instead of the outer document store inside a transaction.')
    }
    const result = operationQueue.then(operation)
    operationQueue = result.then(() => undefined, () => undefined)
    return result
  }

  const read: Pick<DocumentTransaction, 'get' | 'list' | 'listCardBindings'> = {
    listCardBindings: async input => [...current.values()]
      .filter(document => {
        const content = document.content as { promptResourceIds?: string[] }
        return document.type === input.type && !document.meta.tombstone
          && content.promptResourceIds?.includes(input.resourceId)
      })
      .map(document => ({ id: document.id, name: (document.content as { name: string }).name })),
    get: async (id, options) => {
      const document = options?.version
        ? revisions.get(id)?.find(revision => revision.version === options.version)
        : current.get(id)

      if (!document) return null
      if (document.meta.tombstone && !options?.includeTombstone) return null

      return cloneDocument(document)
    },

    list: async input => {
      const page = readDocumentPage(input)
      const filtered = [...current.values()].map((document, index) => ({ document, position: index + 1 })).filter(({ document, position }) => {
        if (position <= page.after) return false
        if (input?.type && document.type !== input.type) return false
        if (!input?.includeTombstone && document.meta.tombstone) return false
        if (input?.ownerExtensionId && document.meta.ownerExtensionId !== input.ownerExtensionId) return false
        if (input?.ownerInstallationId !== undefined && (document.meta.ownerInstallationId ?? null) !== input.ownerInstallationId) return false
        return true
      })
      const items = filtered.slice(0, page.limit).map(({ document }) => cloneDocument(document))

      return {
        items,
        nextCursor: filtered.length > page.limit ? page.cursor(filtered[page.limit - 1]!.position) : undefined,
      }
    },
  }

  function saveRevision(document: DocumentRecord): void {
    const existing = revisions.get(document.id) ?? []
    existing.push(cloneDocument(document))
    revisions.set(document.id, existing)
  }

  function applyWrite(input: WriteDocumentInput, pending: PendingChangeset): WriteDocumentResult {
    const actor = pending.createdBy
    const timestamp = nowIso()
    const existing = input.id ? current.get(input.id) : undefined

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
        ownerInstallationId: input.meta?.ownerInstallationId ?? existing?.meta.ownerInstallationId,
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

    current.set(document.id, cloneDocument(document))
    saveRevision(document)
    recordPendingChange(pending, operation, document)

    return writeResult(pending, [document], [operation])
  }

  function applyDelete(input: DeleteDocumentInput, pending: PendingChangeset): WriteDocumentResult {
    const existing = current.get(input.id)

    if (!existing) {
      throw new StoreError('document.not_found', `Document not found: ${input.id}`)
    }

    assertExpectedVersion(input.id, existing, input.expectedVersion)

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

    current.set(document.id, cloneDocument(document))
    saveRevision(document)
    recordPendingChange(pending, operation, document)

    return writeResult(pending, [document], [operation])
  }

  function applyRestore(target: DocumentRecord, pending: PendingChangeset): DocumentRecord {
    const existing = current.get(target.id)
    if (!existing) throw new StoreError('document.not_found', `Document not found: ${target.id}`)

    const document = restoredDocument(existing, target, pending.createdBy)
    const operation: ChangesetOperation = {
      kind: 'restore',
      documentId: document.id,
      type: document.type,
      fromVersion: existing.version,
      toVersion: document.version,
    }

    current.set(document.id, cloneDocument(document))
    saveRevision(document)
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

  const store: DocumentStore = {
    get: (id, options) => serialize(() => read.get(id, options)),
    list: input => serialize(() => read.list(input)),
    listCardBindings: input => serialize(() => read.listCardBindings(input)),

    write: input => serialize(() => {
      const pending = createPendingChangeset(input)
      const result = applyWrite(input, pending)
      const commit = finalizeCommitFact(pending)
      changesets.set(commit.changeset.id, cloneChangeset(commit.changeset))
      commitNotifier.notify(commit)
      return { ...result, operations: commit.changeset.operations, commit }
    }),

    delete: input => serialize(() => {
      const pending = createPendingChangeset(input)
      const result = applyDelete(input, pending)
      const commit = finalizeCommitFact(pending)
      changesets.set(commit.changeset.id, cloneChangeset(commit.changeset))
      commitNotifier.notify(commit)
      return { ...result, operations: commit.changeset.operations, commit }
    }),

    transact: (input, fn) => serialize(async () => {
      const snapshot = snapshotState(current, revisions, changesets)
      const pending = createPendingChangeset(input)

      try {
        const value = await transactionContext.run(true, () => fn(createTransaction(pending)))
        const commit = finalizeCommitFact(pending)
        changesets.set(commit.changeset.id, cloneChangeset(commit.changeset))
        commitNotifier.notify(commit)
        return { value, changeset: commit.changeset, commit }
      } catch (error) {
        restoreState(current, revisions, changesets, snapshot)
        throw error
      }
    }),

    getChangeset: id => serialize(() => {
      const changeset = changesets.get(id)
      return changeset ? cloneChangeset(changeset) : null
    }),

    revertChangeset: input => serialize(() => {
      const snapshot = snapshotState(current, revisions, changesets)
      const target = changesets.get(input.changesetId)
      if (!target) throw new StoreError('document.changeset_not_found', `Changeset not found: ${input.changesetId}`)
      const pending = createPendingChangeset(input)

      try {
        const restoreTargets = target.operations.map(operation => {
          const existing = current.get(operation.documentId)
          if (!existing || existing.version !== operation.toVersion) {
            throw new StoreError('document.conflict', `Document version conflict: ${operation.documentId}`)
          }

          if (operation.fromVersion === undefined) return { operation }

          const revision = revisions.get(operation.documentId)?.find(item => item.version === operation.fromVersion)
          if (!revision) {
            throw new StoreError('document.revision_not_found', `Document revision not found: ${operation.documentId}@${operation.fromVersion}`)
          }

          return { operation, revision: cloneDocument(revision) }
        })
        const documents = restoreTargets.map(item => item.revision
          ? applyRestore(item.revision, pending)
          : applyDelete({ id: item.operation.documentId, expectedVersion: item.operation.toVersion }, pending).documents[0]!)
        const commit = finalizeCommitFact(pending)
        changesets.set(commit.changeset.id, cloneChangeset(commit.changeset))
        commitNotifier.notify(commit)
        return { ...writeResult(pending, documents, commit.changeset.operations), commit }
      } catch (error) {
        restoreState(current, revisions, changesets, snapshot)
        throw error
      }
    }),

    subscribeCommits: observer => commitNotifier.subscribe(observer),
  }

  return store
}

function snapshotState(
  current: Map<string, DocumentRecord>,
  revisions: Map<string, DocumentRecord[]>,
  changesets: Map<string, Changeset>,
): {
  current: Map<string, DocumentRecord>
  revisions: Map<string, DocumentRecord[]>
  changesets: Map<string, Changeset>
} {
  return {
    current: new Map([...current.entries()].map(([id, document]) => [id, cloneDocument(document)])),
    revisions: new Map([...revisions.entries()].map(([id, items]) => [id, items.map(cloneDocument)])),
    changesets: new Map([...changesets.entries()].map(([id, changeset]) => [id, cloneChangeset(changeset)])),
  }
}

function restoreState(
  current: Map<string, DocumentRecord>,
  revisions: Map<string, DocumentRecord[]>,
  changesets: Map<string, Changeset>,
  snapshot: ReturnType<typeof snapshotState>,
): void {
  current.clear()
  revisions.clear()
  changesets.clear()

  for (const [id, document] of snapshot.current) current.set(id, document)
  for (const [id, items] of snapshot.revisions) revisions.set(id, items)
  for (const [id, changeset] of snapshot.changesets) changesets.set(id, changeset)
}
