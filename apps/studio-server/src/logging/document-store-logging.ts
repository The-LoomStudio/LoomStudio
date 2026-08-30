import type {
  ActorRef,
  ChangesetOperation,
  DocumentStore,
  SqliteDocumentStore,
  WriteDocumentResult,
} from '@loom-studio/document-store'
import type { Logger } from '@loom-studio/logging'
import type { JsonObject } from '@loom-studio/shared'

export function withDocumentStoreLogging(documents: DocumentStore, logger: Logger): DocumentStore {
  const sqliteDocuments = documents as Partial<SqliteDocumentStore>
  return {
    get: (id, options) => documents.get(id, options),
    list: input => documents.list(input),
    getChangeset: id => documents.getChangeset(id),
    subscribeCommits: observer => documents.subscribeCommits(observer),
    write: input => observe(
      logger,
      failureData('write', input.actor, input.reason, input.id, input.type),
      () => documents.write(input),
      result => logWriteCommitted(logger, result, input.actor, input.reason),
    ),
    delete: input => observe(
      logger,
      failureData('delete', input.actor, input.reason, input.id),
      () => documents.delete(input),
      result => logWriteCommitted(logger, result, input.actor, input.reason),
    ),
    transact: async (input, fn) => {
      try {
        const result = await documents.transact(input, fn)
        logCommitted(logger, {
          changesetId: result.changeset.id,
          operations: result.changeset.operations,
          actor: result.changeset.createdBy,
          reason: result.changeset.reason,
          correlationId: result.changeset.correlationId,
          callId: result.changeset.callId,
          parentCallId: result.changeset.parentCallId,
        })
        return result
      } catch (error) {
        logFailed(logger, failureData('transact', input.actor, input.reason), error)
        throw error
      }
    },
    ...(typeof sqliteDocuments.participateTransaction === 'function' ? {
      participateTransaction: (
        dataTx: Parameters<SqliteDocumentStore['participateTransaction']>[0],
        fn: Parameters<SqliteDocumentStore['participateTransaction']>[1],
      ) => observe(
        logger,
        failureData('participate', dataTx.actor, dataTx.reason),
        () => sqliteDocuments.participateTransaction!(dataTx, fn),
        () => undefined,
      ),
    } : {}),
    revertChangeset: input => observe(
      logger,
      {
        ...failureData('revert', input.actor, input.reason),
        targetChangesetId: input.changesetId,
      },
      () => documents.revertChangeset(input),
      result => logWriteCommitted(logger, result, input.actor, input.reason),
    ),
  }
}

async function observe<T>(
  logger: Logger,
  data: JsonObject,
  run: () => Promise<T>,
  onSuccess: (result: T) => void,
): Promise<T> {
  try {
    const result = await run()
    onSuccess(result)
    return result
  } catch (error) {
    logFailed(logger, data, error)
    throw error
  }
}

function logFailed(logger: Logger, data: JsonObject, error: unknown): void {
  logger.error('Document store operation failed', {
    event: 'document.operation.failed',
    data: {
      ...data,
      failureType: error instanceof Error ? error.name : 'UnknownError',
    },
  })
}

function logWriteCommitted(
  logger: Logger,
  result: WriteDocumentResult,
  actor?: ActorRef,
  reason?: string,
): void {
  logCommitted(logger, {
    changesetId: result.changesetId,
    operations: result.operations,
    actor,
    reason,
    correlationId: result.correlationId,
    callId: result.callId,
    parentCallId: result.parentCallId,
  })
}

function logCommitted(logger: Logger, change: {
  changesetId: string
  operations: ChangesetOperation[]
  actor?: ActorRef
  reason?: string
  correlationId?: string
  callId?: string
  parentCallId?: string
}): void {
  logger.info('Document changeset committed', {
    event: 'document.changeset.committed',
    data: {
      changesetId: change.changesetId,
      operationCount: change.operations.length,
      ...(change.actor ? { actor: change.actor } : {}),
      ...(change.reason ? { reason: change.reason } : {}),
      operations: change.operations.map(operation => ({
        kind: operation.kind,
        documentId: operation.documentId,
        type: operation.type,
        ...(operation.fromVersion === undefined ? {} : { fromVersion: operation.fromVersion }),
        toVersion: operation.toVersion,
      })),
    },
    correlationId: change.correlationId,
    callId: change.callId,
    parentCallId: change.parentCallId,
  })
}

function failureData(
  operation: 'write' | 'delete' | 'transact' | 'participate' | 'revert',
  actor?: ActorRef,
  reason?: string,
  documentId?: string,
  documentType?: string,
): JsonObject {
  return {
    operation,
    ...(actor ? { actor } : {}),
    ...(reason ? { reason } : {}),
    ...(documentId ? { documentId } : {}),
    ...(documentType ? { documentType } : {}),
  }
}
