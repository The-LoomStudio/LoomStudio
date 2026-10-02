import type {
  ActorRef,
  ChangesetOperation,
  DocumentStore,
  SqliteDocumentStore,
  WriteDocumentResult,
} from '@loom-studio/document-store'
import { readLogFailure, type Logger } from '@loom-studio/logging'
import type { JsonObject } from '@loom-studio/shared'

export function withDocumentStoreLogging(documents: DocumentStore, logger: Logger): DocumentStore {
  const sqliteDocuments = documents as Partial<SqliteDocumentStore>
  return {
    get: (id, options) => documents.get(id, options),
    list: input => documents.list(input),
    listCardBindings: input => documents.listCardBindings(input),
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
        options?: Parameters<SqliteDocumentStore['participateTransaction']>[2],
      ) => observe(
        logger,
        failureData('participate', dataTx.actor, dataTx.reason),
        () => sqliteDocuments.participateTransaction!(dataTx, fn, options),
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
  const failure = readLogFailure(error)
  logger.error(`Document ${String(data.operation)} failed · ${failure.failureReason}`, {
    event: 'document.operation.failed',
    data: {
      ...data,
      outcome: 'failed',
      detail: `Document ${String(data.operation)} operation failed`,
      ...failure,
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
  const operationTypes = [...new Set(change.operations.map(operation => operation.type))]
  const operationCategories = [...new Set(change.operations
    .map(operation => `${operation.kind} ${operation.type}`)
  )]
  const visibleCategories = operationCategories.slice(0, 3)
  const remainingCategoryCount = operationCategories.length - visibleCategories.length
  const operationDetail = visibleCategories.length === 0
    ? 'none'
    : `${visibleCategories.join(', ')}${remainingCategoryCount > 0 ? ` · ${remainingCategoryCount} more categories` : ''}`
  logger.info(`Document changeset committed · ${change.operations.length} operation${change.operations.length === 1 ? '' : 's'}`, {
    event: 'document.changeset.committed',
    data: {
      changesetId: change.changesetId,
      operationCount: change.operations.length,
      operationTypes,
      outcome: 'completed',
      detail: `${change.operations.length} operation${change.operations.length === 1 ? '' : 's'} · ${operationDetail}`,
      ...(change.actor ? { actor: change.actor } : {}),
      ...(readSafeOperationReason(change.reason) ? { reason: readSafeOperationReason(change.reason) } : {}),
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
    ...(readSafeOperationReason(reason) ? { reason: readSafeOperationReason(reason) } : {}),
    ...(documentId ? { documentId } : {}),
    ...(documentType ? { documentType } : {}),
  }
}

const knownApplicationOperationReasons = new Set([
  'application.applyCardDirectoryState',
  'application.applyStateMutation',
  'application.appendAgentTranscriptEntries',
  'application.codeact.configure',
  'application.codeact.copy',
  'application.codeact.create',
  'application.codeact.delete',
  'application.codeact.move',
  'application.codeact.write',
  'application.createCard',
  'application.createAgentSession',
  'application.createNarrativeTimeline',
  'application.createLoomScriptMount',
  'application.createPromptResource',
  'application.createPortableExtensionPayload',
  'application.createPromptResourceAsset',
  'application.deleteAgentSession',
  'application.deleteCards',
  'application.deleteNarrativeTimeline',
  'application.deletePromptResource',
  'application.deletePromptResourceAsset',
  'application.deletePortableExtensionPayload',
  'application.deleteStateDefinition',
  'application.deleteTextExtractor',
  'application.deleteTextPipelineOverride',
  'application.deleteTextTransformRule',
  'application.duplicatePromptResource',
  'application.forkNarrativeBranch',
  'application.importCardBundle',
  'application.importCardBundle.sourceArtifact',
  'application.importCardPng.media',
  'application.importExtensionPackageResources',
  'application.importLoomCard.media',
  'application.importLoomScript',
  'application.importPromptResource',
  'application.importPromptResource.textTransformRules',
  'application.importTimelineArchive',
  'application.importTimelineArchive.pendingParticipants',
  'application.initializeGlobalState',
  'application.initializePromptResources',
  'application.installOfficialContent',
  'application.invokeAgentTurn',
  'application.invokeAgentTurn.narrative',
  'application.movePromptResourceAsset',
  'application.removeExtensionPackageResources',
  'application.removeObsoleteBuiltinAgentTools',
  'application.replaceCardPortableExtensionPayloads',
  'application.replacePresetToolMounts',
  'application.replaceSettingMounts',
  'application.revertChangeset',
  'application.revertPromptResourceChangeset',
  'application.revertStateChangeset',
  'application.switchNarrativeBranch',
  'application.tool.appendNarrative',
  'application.tool.editNarrative',
  'application.tool.updatePromptResource',
  'application.updateAgentSession',
  'application.updateCard',
  'application.updateCardPromptResources',
  'application.updateLoomScript',
  'application.updateLoomScriptMount',
  'application.updateNarrativeTimeline',
  'application.updatePortableExtensionPayload',
  'application.updatePromptResourceAssets',
  'application.updatePromptResourceMacros',
  'application.upsertExtensionConfig',
  'application.upsertStateDefinition',
  'application.upsertTextExtractor',
  'application.upsertTextPipelineOverride',
  'application.upsertTextTransformRule',
])

function readSafeOperationReason(reason: string | undefined): string | undefined {
  return reason !== undefined && knownApplicationOperationReasons.has(reason) ? reason : undefined
}
