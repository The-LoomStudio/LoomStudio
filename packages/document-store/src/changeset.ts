import type { JsonValue } from '@loom-studio/shared'
import { createId, nowIso } from '@loom-studio/shared'
import { DocumentStoreError } from './types.js'
import type {
  ActorRef,
  Changeset,
  ChangesetOperation,
  DeleteDocumentInput,
  DocumentCommitFact,
  DocumentCommitObserver,
  DocumentCommitSubscription,
  DocumentRecord,
  DocumentTransactionInput,
  WriteDocumentInput,
  WriteDocumentResult,
} from './types.js'

export type PendingDocumentChange = {
  documentId: string
  type: string
  fromVersion?: number
  toVersion: number
  finalTombstoned: boolean
  restored: boolean
}

export type PendingChangeset = Omit<Changeset, 'operations'> & {
  changes: Map<string, PendingDocumentChange>
}

export const kernelActor: ActorRef = {
  kind: 'kernel',
  id: 'kernel',
}

export function createPendingChangeset(input: {
  actor?: ActorRef
  reason?: string
  correlationId?: string
  callId?: string
  parentCallId?: string
}): PendingChangeset {
  return {
    id: createId('chg'),
    createdAt: nowIso(),
    createdBy: input.actor ?? kernelActor,
    reason: input.reason,
    correlationId: input.correlationId,
    callId: input.callId,
    parentCallId: input.parentCallId,
    changes: new Map(),
  }
}

export function recordPendingChange(pending: PendingChangeset, operation: ChangesetOperation, document: DocumentRecord): void {
  const existing = pending.changes.get(operation.documentId)

  if (!existing) {
    pending.changes.set(operation.documentId, {
      documentId: operation.documentId,
      type: operation.type,
      fromVersion: operation.fromVersion,
      toVersion: operation.toVersion,
      finalTombstoned: Boolean(document.meta.tombstone),
      restored: operation.kind === 'restore',
    })
    return
  }

  existing.type = operation.type
  existing.toVersion = operation.toVersion
  existing.finalTombstoned = Boolean(document.meta.tombstone)
  existing.restored ||= operation.kind === 'restore'
}

export function finalizeChangeset(pending: PendingChangeset): Changeset {
  const operations = [...pending.changes.values()].map(change => ({
    kind: readFinalOperationKind(change),
    documentId: change.documentId,
    type: change.type,
    fromVersion: change.fromVersion,
    toVersion: change.toVersion,
  }))

  if (operations.length === 0) {
    throw new DocumentStoreError('document.transaction_empty', 'Document transaction produced no changes')
  }

  return {
    id: pending.id,
    createdAt: pending.createdAt,
    createdBy: pending.createdBy,
    reason: pending.reason,
    correlationId: pending.correlationId,
    callId: pending.callId,
    parentCallId: pending.parentCallId,
    operations,
  }
}

export function finalizeCommitFact(pending: PendingChangeset): DocumentCommitFact {
  const changeset = finalizeChangeset(pending)

  return {
    changeset,
    documents: [...pending.changes.values()].map(change => ({
      id: change.documentId,
      type: change.type,
      version: change.toVersion,
      tombstoned: change.finalTombstoned,
    })),
  }
}

export function createCommitNotifier(): {
  notify(commit: DocumentCommitFact): void
  subscribe(observer: DocumentCommitObserver): DocumentCommitSubscription
} {
  const observers = new Set<DocumentCommitObserver>()

  return {
    notify: commit => {
      for (const observer of observers) {
        try {
          observer(structuredClone(commit) as DocumentCommitFact)
        } catch {
          // ponytail: Post-commit observer failures cannot roll back persisted data; route them to Diagnostics when observers gain a reporter.
        }
      }
    },
    subscribe: observer => {
      observers.add(observer)
      return { dispose: () => observers.delete(observer) }
    },
  }
}

export function transactionInputFromWrite(input: WriteDocumentInput | DeleteDocumentInput): DocumentTransactionInput {
  return {
    actor: input.actor ?? kernelActor,
    reason: input.reason,
    correlationId: input.correlationId,
    callId: input.callId,
    parentCallId: input.parentCallId,
  }
}

export function writeResult(pending: PendingChangeset, documents: DocumentRecord[], operations: ChangesetOperation[]): WriteDocumentResult {
  return {
    changesetId: pending.id,
    documents: documents.map(cloneDocument),
    operations: structuredClone(operations) as ChangesetOperation[],
    correlationId: pending.correlationId,
    callId: pending.callId,
    parentCallId: pending.parentCallId,
  }
}

export function writeResultFromChangeset(changeset: Changeset, documents: DocumentRecord[]): WriteDocumentResult {
  return {
    changesetId: changeset.id,
    documents: documents.map(cloneDocument),
    operations: structuredClone(changeset.operations) as ChangesetOperation[],
    correlationId: changeset.correlationId,
    callId: changeset.callId,
    parentCallId: changeset.parentCallId,
  }
}

export function assertExpectedVersion(id: string | undefined, existing: DocumentRecord | undefined, expectedVersion: number | 'new' | undefined): void {
  if (expectedVersion === 'new' && existing) {
    throw new DocumentStoreError('document.conflict', `Document already exists: ${id}`)
  }

  if (typeof expectedVersion === 'number' && existing?.version !== expectedVersion) {
    throw new DocumentStoreError('document.conflict', `Document version conflict: ${id}`)
  }
}

export function restoredDocument(existing: DocumentRecord, target: DocumentRecord, actor: ActorRef): DocumentRecord {
  return {
    id: existing.id,
    type: target.type,
    version: existing.version + 1,
    content: structuredClone(target.content) as JsonValue,
    meta: {
      ...structuredClone(target.meta),
      createdAt: existing.meta.createdAt,
      createdBy: existing.meta.createdBy,
      updatedAt: nowIso(),
      updatedBy: actor,
    },
  }
}

export function cloneDocument(document: DocumentRecord): DocumentRecord {
  return structuredClone(document) as DocumentRecord
}

export function cloneChangeset(changeset: Changeset): Changeset {
  return structuredClone(changeset) as Changeset
}

function readFinalOperationKind(change: PendingDocumentChange): ChangesetOperation['kind'] {
  if (change.fromVersion === undefined) return 'create'
  if (change.finalTombstoned) return 'delete'
  if (change.restored) return 'restore'
  return 'update'
}
