import type { JsonObject, JsonValue } from '@loom-studio/shared'
import type { ApplicationRuntimeContext } from '../foundation/application-context.js'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import { listDocuments, readDocument, writeDocument } from '../foundation/document-store.js'
import { executeDocumentMutation } from '../foundation/mutation.js'
import {
  applyApplicationStateMutation,
  applyGlobalStateDefaultInTransaction,
  getApplicationStateSnapshot,
} from '../state/state.js'
import {
  toStateDefinitionEntry,
  validateStateDefinitionDraft,
  validateStateValue,
} from '../state/state-definition.js'
import type {
  ApplyStateMutationInput,
  ApplyStateMutationResult,
  CardSourceContent,
  DeleteStateDefinitionInput,
  DeleteStateDefinitionResult,
  GetStateDefinitionInput,
  GetStateDefinitionResult,
  GetStateSnapshotInput,
  GetStateSnapshotResult,
  ListStateDefinitionsInput,
  ListStateDefinitionsResult,
  RuntimeRequestContext,
  StateDefinitionContent,
  UpsertStateDefinitionInput,
  UpsertStateDefinitionResult,
} from '../types.js'
import {
  narrativeWriteContext,
  requireDocumentParticipant,
} from './context.js'

export function createStateRuntimeMethods(ctx: ApplicationRuntimeContext) {
  return {
    getStateSnapshot: async (input: GetStateSnapshotInput): Promise<GetStateSnapshotResult> => ({
      snapshot: await getApplicationStateSnapshot(ctx, input.target),
    }),

    applyStateMutation: (input: ApplyStateMutationInput, requestContext?: RuntimeRequestContext): Promise<ApplyStateMutationResult> =>
      applyApplicationStateMutation(ctx, input, requestContext),

    listStateDefinitions: async (input?: ListStateDefinitionsInput): Promise<ListStateDefinitionsResult> => {
      const definitions = await listDocuments<StateDefinitionContent>(ctx.documents, applicationDocumentTypes.stateDefinition)
      return {
        definitions: definitions
          .map(toStateDefinitionEntry)
          .filter(definition => input?.kind === undefined || definition.kind === input.kind),
      }
    },

    getStateDefinition: async (input: GetStateDefinitionInput): Promise<GetStateDefinitionResult> => ({
      definition: toStateDefinitionEntry(await readDocument<StateDefinitionContent>(
        ctx.documents,
        input.definitionId,
        applicationDocumentTypes.stateDefinition,
      )),
    }),

    upsertStateDefinition: async (input: UpsertStateDefinitionInput, requestContext?: RuntimeRequestContext): Promise<UpsertStateDefinitionResult> => {
      validateStateDefinitionDraft(input.definition)
      const existing = await ctx.documents.get(input.definitionId)
      if (existing && existing.type !== applicationDocumentTypes.stateDefinition) {
        throw new Error(`Unexpected document type for ${input.definitionId}: ${existing.type}`)
      }
      if (existing && input.expectedVersion === undefined) {
        throw new Error(`expectedVersion is required when updating State Definition: ${input.definitionId}`)
      }
      if (existing && existing.version !== input.expectedVersion) {
        throw new Error(`State Definition version conflict: ${input.definitionId}`)
      }
      if (!existing && input.expectedVersion !== undefined) {
        throw new Error(`State Definition does not exist: ${input.definitionId}`)
      }

      const timestamp = ctx.now()
      const content: StateDefinitionContent = {
        ...structuredClone(input.definition),
        createdAt: existing ? (existing.content as StateDefinitionContent).createdAt : timestamp,
        updatedAt: timestamp,
      }
      const globalDefinition = input.definition.kind === 'global' ? input.definition : undefined
      const globalSnapshot = globalDefinition
        ? await ctx.states.getGlobalSnapshot('workspace')
        : null
      if (globalDefinition && !globalSnapshot) {
        throw new Error('Global state is not initialized')
      }
      const currentValue = globalDefinition
        ? readDotPath(globalSnapshot!.revision.snapshot, globalDefinition.path.replace(/^global\./, ''))
        : { found: false as const }
      if (globalDefinition && currentValue.found) {
        validateStateValue(currentValue.value, globalDefinition.schema, globalDefinition.path)
      }
      const shouldCreateDefault = globalDefinition !== undefined
        && !currentValue.found
        && globalDefinition.default !== undefined
      const documentParticipant = requireDocumentParticipant(ctx)
      const transaction = await ctx.dataEngine.transact({
        ...narrativeWriteContext(requestContext, 'application.upsertStateDefinition'),
      }, async dataTx => documentParticipant.participateTransaction(dataTx, async documents => {
        const written = await writeDocument<StateDefinitionContent>(documents, {
          id: input.definitionId,
          type: applicationDocumentTypes.stateDefinition,
          content,
          expectedVersion: existing ? existing.version : 'new',
        })
        if (shouldCreateDefault) {
          applyGlobalStateDefaultInTransaction(ctx, dataTx, {
            scopeId: globalSnapshot!.scope.id,
            parentRevisionId: globalSnapshot!.revision.id,
            snapshot: globalSnapshot!.revision.snapshot,
            path: globalDefinition.path.replace(/^global\./, ''),
            value: globalDefinition.default!,
          })
        }
        return written
      }))
      return {
        definition: toStateDefinitionEntry(transaction.value.value),
        mutation: { changesetId: transaction.commit.changesetId },
      }
    },

    deleteStateDefinition: async (input: DeleteStateDefinitionInput, requestContext?: RuntimeRequestContext): Promise<DeleteStateDefinitionResult> => {
      const existing = await readDocument<StateDefinitionContent>(ctx.documents, input.definitionId, applicationDocumentTypes.stateDefinition)
      if (input.expectedVersion !== undefined && input.expectedVersion !== existing.version) {
        throw new Error(`State Definition version conflict: ${input.definitionId}`)
      }
      const cards = await listDocuments<CardSourceContent>(ctx.documents, applicationDocumentTypes.cardSource)
      if (cards.some(card => card.content.stateDefinitionIds?.includes(input.definitionId)
        || card.content.timelineStateBindings?.some(binding => binding.templateId === input.definitionId))) {
        throw new Error(`State Definition is still referenced by a Card: ${input.definitionId}`)
      }
      const mutation = await executeDocumentMutation(ctx.documents, requestContext, 'application.deleteStateDefinition', async documents => {
        await documents.delete({ id: existing.id, expectedVersion: existing.version })
        return true as const
      })
      return { deleted: mutation.value, mutation: mutation.mutation }
    },
  }
}

export function readDotPath(root: JsonObject, path: string): { found: true; value: JsonValue } | { found: false } {
  let current: JsonValue = root
  for (const segment of path.split('.')) {
    if (typeof current !== 'object' || current === null || Array.isArray(current) || !(segment in current)) {
      return { found: false }
    }
    current = (current as Record<string, JsonValue>)[segment]!
  }
  return { found: true, value: current }
}
