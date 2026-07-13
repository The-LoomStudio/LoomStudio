import type { DocumentStore, DocumentTransaction } from '@loom-studio/document-store'
import type { MutationReceipt, RuntimeRequestContext } from './types.js'

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
    actor: context?.clientId
      ? { kind: 'client', id: context.clientId }
      : { kind: 'kernel', id: 'application-runtime' },
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
