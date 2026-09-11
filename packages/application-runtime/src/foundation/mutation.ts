import type { DocumentStore, DocumentTransaction, SqliteDocumentStore } from '@loom-studio/document-store'
import type { MutationReceipt, RuntimeRequestContext } from '../types.js'
import type { ApplicationRuntimeContext } from './application-context.js'

type DocumentMutationResult<T> = {
  value: T
  mutation: MutationReceipt
}

export async function executeDocumentMutation<T>(
  documents: DocumentStore,
  context: RuntimeRequestContext | undefined,
  reason: string,
  mutate: (tx: DocumentTransaction) => Promise<T>,
): Promise<DocumentMutationResult<T>> {
  const result = await documents.transact({
    actor: context?.actor ?? (context?.clientId
      ? { kind: 'client', id: context.clientId }
      : { kind: 'kernel', id: 'application-runtime' }),
    reason,
    correlationId: context?.correlationId,
    callId: context?.callId,
    parentCallId: context?.parentCallId,
  }, mutate)

  return {
    value: result.value,
    mutation: { changesetId: result.changeset.id },
  }
}

export async function executeBlobDocumentMutation<T>(
  ctx: Pick<ApplicationRuntimeContext, 'blobs' | 'dataEngine' | 'documents'>,
  context: RuntimeRequestContext | undefined,
  reason: string,
  source: { bytes: Uint8Array; mediaType?: string; maxBytes?: number },
  mutate: (documents: DocumentTransaction, blob: { id: string; sha256: string; sizeBytes: number; mediaType?: string }) => Promise<T>,
): Promise<DocumentMutationResult<T>> {
  if (!ctx.blobs) throw new Error('Blob Store is not configured')
  if (!isSqliteDocumentStore(ctx.documents)) throw new Error('Shared SQLite Document Store is required for atomic Blob mutations')
  const documents = ctx.documents
  const prepared = await ctx.blobs.prepareWrite({
    source: source.bytes,
    mediaType: source.mediaType,
    maxBytes: source.maxBytes,
  })
  const result = await ctx.dataEngine.transact({
    actor: context?.actor ?? (context?.clientId
      ? { kind: 'client', id: context.clientId }
      : { kind: 'kernel', id: 'application-runtime' }),
    reason,
    correlationId: context?.correlationId,
    callId: context?.callId,
    parentCallId: context?.parentCallId,
  }, async tx => {
    const stored = ctx.blobs!.participateWrite(tx, prepared).blob
    const documentResult = await documents.participateTransaction(
      tx,
      transaction => mutate(transaction, stored),
    )
    return { value: documentResult.value, changesetId: documentResult.changeset.id }
  })
  return {
    value: result.value.value,
    mutation: { changesetId: result.value.changesetId },
  }
}

function isSqliteDocumentStore(documents: DocumentStore): documents is SqliteDocumentStore {
  return 'participateTransaction' in documents && typeof documents.participateTransaction === 'function'
}
