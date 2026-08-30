import type { DocumentRecord, DocumentStore, DocumentTransaction, SqliteDocumentStore } from '@loom-studio/document-store'
import type { ExtensionEntityRef, ExtensionRecordEntry, ExtensionStorageScope } from '@loom-studio/extension-sdk'
import { officialFakeModelId } from '@loom-studio/ai-gateway'
import type { AgentTranscriptEntry } from '@loom-studio/agent-store'
import type { NarrativeTimeline } from '@loom-studio/narrative-store'
import type { JsonObject, JsonValue } from '@loom-studio/shared'
import type { PromptResourceMutation } from '@loom-studio/prompt-resource-store'
import {
  assertProviderModelExists,
  assertNonEmpty,
} from './agent.js'
import {
  normalizeCardContent,
  normalizeCardMedia,
  normalizeOpening,
  normalizeOptionalString,
  normalizePreset,
  normalizeSettingLayer,
  readOpeningEntries,
  toCardSummary,
  toCardSource,
} from './card.js'
import { createApplicationRuntimeContext, type ApplicationRuntimeContext } from './application-context.js'
import { applicationDocumentTypes } from './document-types.js'
import { listDocuments, readDocument, toVersioned, writeDocument } from './document-store.js'
import { executeDocumentMutation } from './mutation.js'
import { isObject } from './json.js'
import { applyApplicationStateMutation, applyGlobalStateDefaultInTransaction, getApplicationStateSnapshot, initializeGlobalState, revertApplicationStateChangeset } from './state.js'
import {
  toStateDefinitionEntry,
  materializeTimelineState,
  validateStateDefinitionDraft,
  validateStateValue,
  validateTimelineStateBinding,
} from './state-definition.js'
import { createVariableRenderContext, type VariableRenderContext } from './variables.js'
import { readTimelineRuntimeContext, timelineRuntimeContextId } from './timeline-runtime-context.js'
import {
  extractHistory as extractHistorySnapshot,
  projectHistoryEntries,
  validateTextExtractorDraft,
  validateTextTransformRuleDraft,
  type HistorySource,
  type HistoryTextEntry,
  type RendererDefinition,
  type TextExtractorContent,
  type TextTransformPhase,
  type TextTransformRuleContent,
  type TextTransformRuleEntry,
} from './history-text.js'
import {
  createOfficialPromptResourceContents,
  officialPromptResourceIds,
} from './prompt-resource-defaults.js'
import { isPromptActivation, type ActivationFacts } from './prompt-activation.js'
import { buildOpenAIChatPayload, type OpenAIChatPayload } from './provider-payload.js'
import { defaultCompositionSkeleton } from './prompt-builder.js'
import { composeAgentTurnPrompt } from './agent-turn.js'
import { createAgentToolRegistry, type ToolDefinition } from './agent/tool-registry.js'
import {
  compileAgentToolSet,
  createContentToolPromptRuntimeInputs,
  resolveEnabledPresetToolMounts,
  runNativeToolLoop,
} from './agent/tool-loop.js'
import {
  exportCardArtifact,
  applyDefaultPromptProjection,
  importCardBundle,
  isCardBundleArtifact,
  isPromptResourceArtifact,
  normalizePortableExtensionPayloadArtifact,
  type CardBundleArtifact,
  type PortableExtensionPayloadArtifact,
  type PortableExtensionPayloadContent,
  type PromptResourceArtifact,
  type PromptResourceContent,
} from './workspace.js'
import { fromStoredResource, listMappedResources, readMappedResource, toStoredNodeDraft, toStoredResourceInput } from './prompt-resource-mapper.js'
import type {
  AgentProfileContent,
  AgentToolContent,
  AgentToolEntry,
  AiCapabilityProfileContent,
  AiCapabilityProfileView,
  ApplicationRuntime,
  ApplicationRuntimeOptions,
  CardMediaRefs,
  CardSourceContent,
  ImportExtensionPackageResourcesInput,
  ImportExtensionPackageResourcesResult,
  PortableExtensionPayloadEntry,
  RemoveExtensionPackageResourcesInput,
  RemoveExtensionPackageResourcesResult,
  StateDefinitionContent,
  StateDefinitionDraft,
  StateMutationOperation,
  TimelineRuntimeContextContent,
  ProviderProfileContent,
  ProviderProfileView,
  ProviderMessage,
  RuntimeRequestContext,
} from './types.js'

const applicationActor = { kind: 'kernel', id: 'application-runtime' } as const
const obsoleteBuiltinAgentToolIds = new Set([
  'official/test_structured',
  'official/test_content',
])
const obsoleteBuiltinAgentToolDescriptions = new Map([
  [
    'official/search_context',
    'Search active context items already authorized for the current Agent turn. Returns item IDs and short snippets for read_context.',
  ],
  [
    'official/read_context',
    'Read one active context item from the current Agent turn by the item ID returned by search_context.',
  ],
])

export function createApplicationRuntime(options: ApplicationRuntimeOptions): ApplicationRuntime {
  const ctx = createApplicationRuntimeContext(options)

  function requireNarratives() {
    if (!ctx.narratives) throw new Error('Narrative Store is not configured')
    return ctx.narratives
  }

  function requireAgents() {
    if (!ctx.agents) throw new Error('Agent Store is not configured')
    return ctx.agents
  }

  function requireSecrets() {
    if (!ctx.secrets) throw new Error('Secret Store is not configured')
    return ctx.secrets
  }

  function requireAiCapabilities() {
    if (!ctx.aiCapabilities) throw new Error('AI Gateway capabilities are not configured')
    return ctx.aiCapabilities
  }

  function requireDocumentParticipant(): SqliteDocumentStore {
    const participant = ctx.documents as Partial<SqliteDocumentStore>
    if (typeof participant.participateTransaction !== 'function') {
      throw new Error('Shared Sqlite Document Store participant is required')
    }
    return ctx.documents as SqliteDocumentStore
  }

  function narrativeWriteContext(requestContext: RuntimeRequestContext | undefined, reason: string) {
    return {
      actor: requestContext?.actor ?? (requestContext?.clientId
        ? { kind: 'client' as const, id: requestContext.clientId }
        : applicationActor),
      reason,
      correlationId: requestContext?.correlationId,
      callId: requestContext?.callId,
      parentCallId: requestContext?.parentCallId,
    }
  }

  const agentWriteContext = narrativeWriteContext

  async function createTimelineFromCard(
    input: { cardId: string; title?: string },
    requestContext: RuntimeRequestContext | undefined,
    reason: string,
  ) {
    const narratives = requireNarratives()
    const card = await readDocument<CardSourceContent>(ctx.documents, input.cardId, applicationDocumentTypes.cardSource)
    const cardContent = normalizeCardContent(card.content)
    const templates = new Map<string, Extract<StateDefinitionDraft, { kind: 'timeline-template' }>>()
    for (const definitionId of cardContent.stateDefinitionIds ?? []) {
      const definition = await readDocument<StateDefinitionContent>(ctx.documents, definitionId, applicationDocumentTypes.stateDefinition)
      if (definition.content.kind !== 'timeline-template') {
        throw new Error(`Card State Definition is not a timeline template: ${definitionId}`)
      }
      templates.set(definition.id, definition.content)
    }
    const initialState = materializeTimelineState({
      bindings: cardContent.timelineStateBindings ?? [],
      templates,
    })
    const timelineId = ctx.createId('timeline')
    const branchId = ctx.createId('branch')
    const stateScopeId = ctx.createId('state-scope')
    const stateRevisionId = ctx.createId('state-revision')
    const runtimeContext = await buildTimelineRuntimeContext(ctx, {
      timelineId,
      card,
      cardContent,
      templates,
    })
    const variables = await readAgentTurnVariables(ctx, runtimeContext.fallbackUserName, initialState)
    const openingEntries = readOpeningEntries(cardContent, variables)
    const transaction = await ctx.dataEngine.transact(
      narrativeWriteContext(requestContext, reason),
      async dataTx => requireDocumentParticipant().participateTransaction(dataTx, async documents => {
        const stateTx = ctx.states.transaction(dataTx)
        const narrativeTx = narratives.transaction(dataTx)
        await writeDocument<TimelineRuntimeContextContent>(documents, {
          id: timelineRuntimeContextId(timelineId),
          type: applicationDocumentTypes.timelineRuntimeContext,
          content: runtimeContext,
          expectedVersion: 'new',
        })
        stateTx.createScope({ id: stateScopeId, kind: 'timeline', ownerId: timelineId })
        stateTx.createRevision({
          id: stateRevisionId,
          scopeId: stateScopeId,
          snapshot: initialState,
          operations: [],
        })
        return narrativeTx.createTimeline({
          id: timelineId,
          primaryBranchId: branchId,
          stateRevisionId,
          title: input.title ?? cardContent.name,
          createdFrom: { cardId: card.id, cardVersion: card.version },
          promptResourceIds: cardContent.promptResourceIds ?? [],
          openingNodes: openingEntries.map(entry => ({
            body: { format: 'loom-markdown.v1' as const, raw: entry.content },
          })),
        })
      }),
    )
    return {
      ...transaction.value.value,
      mutation: { changesetId: transaction.commit.changesetId },
    }
  }

  return {
    initialize: async () => {
      await initializeGlobalState(ctx)
      await initializeOfficialFakeProviderProfiles(ctx)
      const timestamp = ctx.now()
      const promptContents = createOfficialPromptResourceContents(timestamp)
      for (const [index, content] of promptContents.entries()) {
        const id = index === 0 ? officialPromptResourceIds.assistantPreset : officialPromptResourceIds.knowledgeSetting
        if (!await ctx.promptResources.getResource(id)) {
          await ctx.promptResources.createResource({
            ...toStoredResourceInput({ id, content }),
            actor: applicationActor,
            reason: 'application.initializePromptResources',
          })
        }
      }
      const officialMounts = await ctx.promptResources.listSettingMounts({ source: { kind: 'manual', id: 'global' } })
      if (!officialMounts.some(mount => mount.settingResourceId === officialPromptResourceIds.knowledgeSetting)) {
        await ctx.promptResources.addSettingMount({
          actor: applicationActor,
          reason: 'application.initializePromptResources',
          source: { kind: 'manual', id: 'global' },
          settingResourceId: officialPromptResourceIds.knowledgeSetting,
          orderIndex: officialMounts.length,
          origin: { kind: 'builtin', key: 'loom-assistant-preset' },
        })
      }
      const existingToolMounts = await ctx.promptResources.listPresetToolMounts({ presetResourceId: officialPromptResourceIds.assistantPreset })
      const retainedToolMounts = existingToolMounts.filter(mount => !obsoleteBuiltinAgentToolIds.has(mount.toolId))
      if (retainedToolMounts.length !== existingToolMounts.length) {
        await ctx.promptResources.replacePresetToolMounts({
          actor: applicationActor,
          reason: 'application.removeObsoleteBuiltinAgentTools',
          presetResourceId: officialPromptResourceIds.assistantPreset,
          mounts: retainedToolMounts.map(mount => ({
            toolId: mount.toolId,
            orderIndex: mount.orderIndex,
            defaultEnabled: mount.defaultEnabled,
            ...(mount.activation ? { activation: structuredClone(mount.activation) } : {}),
            ...(mount.provider ? { provider: { ...mount.provider } } : {}),
            ...(mount.content ? { content: { ...mount.content } } : {}),
            origin: structuredClone(mount.origin),
          })),
        })
      }
      for (const toolId of obsoleteBuiltinAgentToolIds) {
        const document = await ctx.documents.get(toolId)
        if (!document) continue
        await ctx.documents.delete({
          id: toolId,
          expectedVersion: document.version,
          actor: applicationActor,
          reason: 'application.removeObsoleteBuiltinAgentTools',
        })
      }
      for (const definition of ctx.agentTools.list()) {
        const existing = await ctx.documents.get(definition.id)
        if (existing) {
          const content = existing.content as AgentToolContent
          if (content.description === obsoleteBuiltinAgentToolDescriptions.get(definition.id)) {
            await ctx.documents.write({
              id: definition.id,
              type: applicationDocumentTypes.agentTool,
              content: toAgentToolContent(definition, content.createdAt, timestamp),
              expectedVersion: existing.version,
              actor: applicationActor,
              reason: 'application.initializePromptResources',
            })
          }
          continue
        }
        await ctx.documents.write({
          id: definition.id,
          type: applicationDocumentTypes.agentTool,
          content: toAgentToolContent(definition, timestamp),
          expectedVersion: 'new',
          actor: applicationActor,
          reason: 'application.initializePromptResources',
        })
      }
      await refreshAgentToolRegistry(ctx)
      const officialToolMounts = await ctx.promptResources.listPresetToolMounts({ presetResourceId: officialPromptResourceIds.assistantPreset })
      for (const [orderIndex, definition] of ctx.agentTools.list().entries()) {
        if (officialToolMounts.some(mount => mount.toolId === definition.id)) continue
        await ctx.promptResources.addPresetToolMount({
          actor: applicationActor,
          reason: 'application.initializePromptResources',
          presetResourceId: officialPromptResourceIds.assistantPreset,
          toolId: definition.id,
          orderIndex,
          defaultEnabled: false,
          ...(definition.prompt?.activation ? { activation: structuredClone(definition.prompt.activation) } : {}),
          ...(definition.prompt?.provider ? { provider: { ...definition.prompt.provider } } : {}),
          ...(definition.prompt?.content ? { content: { ...definition.prompt.content } } : {}),
          origin: { kind: 'builtin', key: 'loom-assistant-preset' },
        })
      }
    },

    getStateSnapshot: async input => ({
      snapshot: await getApplicationStateSnapshot(ctx, input.target),
    }),

    applyStateMutation: (input, requestContext) => applyApplicationStateMutation(ctx, input, requestContext),

    listStateDefinitions: async input => {
      const definitions = await listDocuments<StateDefinitionContent>(ctx.documents, applicationDocumentTypes.stateDefinition)
      return {
        definitions: definitions
          .map(toStateDefinitionEntry)
          .filter(definition => input?.kind === undefined || definition.kind === input.kind),
      }
    },

    getStateDefinition: async input => ({
      definition: toStateDefinitionEntry(await readDocument<StateDefinitionContent>(
        ctx.documents,
        input.definitionId,
        applicationDocumentTypes.stateDefinition,
      )),
    }),

    upsertStateDefinition: async (input, requestContext) => {
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
      const documentParticipant = requireDocumentParticipant()
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

    deleteStateDefinition: async (input, requestContext) => {
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

    listTextTransformRules: async () => ({
      rules: (await listDocuments<TextTransformRuleContent>(ctx.documents, applicationDocumentTypes.textTransformRule))
        .map(document => toVersioned(document)),
    }),

    getTextTransformRule: async input => ({
      rule: toVersioned(await readDocument<TextTransformRuleContent>(ctx.documents, input.ruleId, applicationDocumentTypes.textTransformRule)),
    }),

    upsertTextTransformRule: async (input, requestContext) => {
      validateTextTransformRuleDraft(input.rule)
      const existing = await ctx.documents.get(input.ruleId)
      assertExpectedDocumentVersion(existing, input.expectedVersion, applicationDocumentTypes.textTransformRule, 'Text Transform Rule', input.ruleId)
      const timestamp = ctx.now()
      const mutation = await executeDocumentMutation(ctx.documents, requestContext, 'application.upsertTextTransformRule', async documents =>
        writeDocument<TextTransformRuleContent>(documents, {
          id: input.ruleId,
          type: applicationDocumentTypes.textTransformRule,
          content: {
            ...structuredClone(input.rule),
            createdAt: existing ? (existing.content as TextTransformRuleContent).createdAt : timestamp,
            updatedAt: timestamp,
          },
          expectedVersion: existing ? existing.version : 'new',
        }),
      )
      return { rule: toVersioned(mutation.value), mutation: mutation.mutation }
    },

    deleteTextTransformRule: async (input, requestContext) => {
      const existing = await readDocument<TextTransformRuleContent>(ctx.documents, input.ruleId, applicationDocumentTypes.textTransformRule)
      if (input.expectedVersion !== undefined && existing.version !== input.expectedVersion) throw new Error(`Text Transform Rule version conflict: ${input.ruleId}`)
      const mutation = await executeDocumentMutation(ctx.documents, requestContext, 'application.deleteTextTransformRule', async documents => {
        await documents.delete({ id: existing.id, expectedVersion: existing.version })
        return true as const
      })
      return { deleted: mutation.value, mutation: mutation.mutation }
    },

    listTextExtractors: async () => ({
      extractors: (await listDocuments<TextExtractorContent>(ctx.documents, applicationDocumentTypes.textExtractor)).map(document => toVersioned(document)),
    }),

    getTextExtractor: async input => ({
      extractor: toVersioned(await readDocument<TextExtractorContent>(ctx.documents, input.extractorId, applicationDocumentTypes.textExtractor)),
    }),

    upsertTextExtractor: async (input, requestContext) => {
      validateTextExtractorDraft(input.extractor)
      const existing = await ctx.documents.get(input.extractorId)
      assertExpectedDocumentVersion(existing, input.expectedVersion, applicationDocumentTypes.textExtractor, 'Text Extractor', input.extractorId)
      const timestamp = ctx.now()
      const mutation = await executeDocumentMutation(ctx.documents, requestContext, 'application.upsertTextExtractor', async documents =>
        writeDocument<TextExtractorContent>(documents, {
          id: input.extractorId,
          type: applicationDocumentTypes.textExtractor,
          content: {
            ...structuredClone(input.extractor),
            createdAt: existing ? (existing.content as TextExtractorContent).createdAt : timestamp,
            updatedAt: timestamp,
          },
          expectedVersion: existing ? existing.version : 'new',
        }),
      )
      return { extractor: toVersioned(mutation.value), mutation: mutation.mutation }
    },

    deleteTextExtractor: async (input, requestContext) => {
      const existing = await readDocument<TextExtractorContent>(ctx.documents, input.extractorId, applicationDocumentTypes.textExtractor)
      if (input.expectedVersion !== undefined && existing.version !== input.expectedVersion) throw new Error(`Text Extractor version conflict: ${input.extractorId}`)
      const mutation = await executeDocumentMutation(ctx.documents, requestContext, 'application.deleteTextExtractor', async documents => {
        await documents.delete({ id: existing.id, expectedVersion: existing.version })
        return true as const
      })
      return { deleted: mutation.value, mutation: mutation.mutation }
    },

    projectHistory: async input => ({ snapshot: await projectRuntimeHistory(ctx, input.source, input.phase) }),

    extractHistory: async input => {
      const extractor = toVersioned(await readDocument<TextExtractorContent>(ctx.documents, input.extractorId, applicationDocumentTypes.textExtractor))
      const snapshot = await projectRuntimeHistory(ctx, input.source, input.phase ?? 'display')
      return { extraction: extractHistorySnapshot({ snapshot, extractor }), snapshot }
    },

    listRenderers: async () => ({ renderers: builtInRenderers.map(renderer => structuredClone(renderer)) }),
    listExtensionRecords: async input => ({ records: await listApplicationExtensionRecords(ctx.documents, input) }),
    getExtensionRecord: async input => ({ record: await getApplicationExtensionRecord(ctx.documents, input.packageId, input.recordId) }),

    createCard: async (input, requestContext) => {
      if (input.name.trim().length === 0) {
        throw new Error('createCard name cannot be empty')
      }
      await assertCardMedia(ctx, input.media)

      const mutation = await executeDocumentMutation(ctx.documents, requestContext, 'application.createCard', async documents => {
        const timestamp = ctx.now()
        const card = await writeDocument<CardSourceContent>(documents, {
          id: ctx.createId('card'),
          type: applicationDocumentTypes.cardSource,
          content: {
            name: input.name,
            userName: normalizeOptionalString(input.userName),
            description: input.description,
            promptResourceIds: [],
            media: normalizeCardMedia(input.media),
            preset: normalizePreset(input.preset),
            opening: normalizeOpening(input.opening),
            settingLayer: normalizeSettingLayer(input.settingLayer, input.setting),
            createdAt: timestamp,
            updatedAt: timestamp,
          },
          expectedVersion: 'new',
        })

        return toCardSource(card)
      })

      return {
        card: mutation.value,
        mutation: mutation.mutation,
      }
    },

    getCard: async input => {
      const card = await readDocument<CardSourceContent>(ctx.documents, input.cardId, applicationDocumentTypes.cardSource)
      return {
        card: toCardSource(card),
      }
    },

    listCards: async input => {
      const result = await ctx.documents.list({
        type: applicationDocumentTypes.cardSource,
        cursor: input?.cursor,
        limit: input?.limit,
      })

      return {
        cards: result.items.map(card => toCardSummary(card as never)),
        nextCursor: result.nextCursor,
      }
    },

    updateCard: async (input, requestContext) => {
      if (input.name !== undefined && input.name.trim().length === 0) {
        throw new Error('updateCard name cannot be empty')
      }
      await assertCardMedia(ctx, input.media)
      const mutation = await executeDocumentMutation(ctx.documents, requestContext, 'application.updateCard', async documents => {
        const existing = await readDocument<CardSourceContent>(documents, input.cardId, applicationDocumentTypes.cardSource)
        const stateDefinitionIds = input.stateDefinitionIds ?? existing.content.stateDefinitionIds ?? []
        const timelineStateBindings = input.timelineStateBindings ?? existing.content.timelineStateBindings ?? []
        if (new Set(stateDefinitionIds).size !== stateDefinitionIds.length) throw new Error('Duplicate State Definition id')
        for (const definitionId of stateDefinitionIds) {
          const definition = await readDocument<StateDefinitionContent>(documents, definitionId, applicationDocumentTypes.stateDefinition)
          if (definition.content.kind !== 'timeline-template') throw new Error(`Card State Definition is not a timeline template: ${definitionId}`)
        }
        for (const binding of timelineStateBindings) {
          validateTimelineStateBinding(binding)
          if (!stateDefinitionIds.includes(binding.templateId)) {
            throw new Error(`Timeline State Binding template is not mounted on Card: ${binding.templateId}`)
          }
        }
        const updated = await writeDocument<CardSourceContent>(documents, {
          id: existing.id,
          type: applicationDocumentTypes.cardSource,
          content: normalizeCardContent({
            ...existing.content,
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.userName !== undefined ? { userName: normalizeOptionalString(input.userName) } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...(input.preset !== undefined ? { preset: normalizePreset(input.preset) } : {}),
            ...(input.opening !== undefined ? { opening: normalizeOpening(input.opening) } : {}),
            ...(input.settingLayer !== undefined ? { settingLayer: normalizeSettingLayer(input.settingLayer, undefined) } : {}),
            ...(input.media !== undefined ? { media: normalizeCardMedia(input.media) } : {}),
            ...(input.stateDefinitionIds !== undefined ? { stateDefinitionIds: [...input.stateDefinitionIds] } : {}),
            ...(input.timelineStateBindings !== undefined ? { timelineStateBindings: structuredClone(input.timelineStateBindings) } : {}),
            updatedAt: ctx.now(),
          }),
          expectedVersion: existing.version,
        })

        return toCardSource(updated)
      })

      return { card: mutation.value, mutation: mutation.mutation }
    },

    previewCardDeletion: async input => {
      await readDocument<CardSourceContent>(ctx.documents, input.cardId, applicationDocumentTypes.cardSource)
      const timelines = ctx.narratives ? await listAllCardTimelines(ctx, input.cardId) : []
      const timelineIds = new Set(timelines.map(timeline => timeline.id))
      const extensionData = await countCardDeletionExtensionData(ctx.documents, input.cardId, timelineIds)
      const textTransformRuleIds = (await listDocuments<TextTransformRuleContent>(ctx.documents, applicationDocumentTypes.textTransformRule))
        .filter(rule => rule.content.owner.kind === 'card' && rule.content.owner.cardId === input.cardId)
        .map(rule => rule.id)
      return {
        cardId: input.cardId,
        timelines: timelines.map(timeline => ({
          id: timeline.id,
          ...(timeline.title ? { title: timeline.title } : {}),
        })),
        extensionData,
        textTransformRuleIds,
      }
    },

    deleteCard: async (input, requestContext) => {
      const card = await readDocument<CardSourceContent>(ctx.documents, input.cardId, applicationDocumentTypes.cardSource)
      const timelines = ctx.narratives ? await listAllCardTimelines(ctx, input.cardId) : []
      const ownedRules = (await listDocuments<TextTransformRuleContent>(ctx.documents, applicationDocumentTypes.textTransformRule))
        .filter(rule => rule.content.owner.kind === 'card' && rule.content.owner.cardId === input.cardId)
      if (input.includePlayData && timelines.length > 0) {
        const narratives = requireNarratives()
        const documentParticipant = requireDocumentParticipant()
        const scopes = new Map<string, string>()
        for (const timeline of timelines) {
          const scope = await ctx.states.getScope({ kind: 'timeline', ownerId: timeline.id })
          if (scope) scopes.set(timeline.id, scope.id)
        }
        const result = await ctx.dataEngine.transact(
          narrativeWriteContext(requestContext, 'application.deleteCard'),
          async dataTx => documentParticipant.participateTransaction(dataTx, async documents => {
            const narrativeTx = narratives.transaction(dataTx)
            const stateTx = ctx.states.transaction(dataTx)
            for (const timeline of timelines) {
              narrativeTx.deleteTimeline({ timelineId: timeline.id })
              const scopeId = scopes.get(timeline.id)
              if (scopeId) stateTx.tombstoneScope({ scopeId })
              const runtimeContext = await documents.get(timelineRuntimeContextId(timeline.id))
              if (runtimeContext && !runtimeContext.meta.tombstone) {
                await documents.delete({ id: runtimeContext.id, expectedVersion: runtimeContext.version })
              }
              await tombstoneExtensionStorageScope(documents, { kind: 'timeline', timelineId: timeline.id })
            }
            const currentCard = await readDocument<CardSourceContent>(documents, input.cardId, applicationDocumentTypes.cardSource)
            await tombstoneExtensionStorageScope(documents, { kind: 'card', cardId: input.cardId })
            for (const rule of ownedRules) await documents.delete({ id: rule.id, expectedVersion: rule.version })
            await documents.delete({ id: currentCard.id, expectedVersion: currentCard.version })
            return true as const
          }, { allowEmpty: true }),
        )
        return { deleted: true as const, mutation: { changesetId: result.commit.changesetId } }
      }
      const cardContent = normalizeCardContent(card.content)
      const templates = new Map<string, Extract<StateDefinitionDraft, { kind: 'timeline-template' }>>()
      for (const definitionId of cardContent.stateDefinitionIds ?? []) {
        const definition = await readDocument<StateDefinitionContent>(ctx.documents, definitionId, applicationDocumentTypes.stateDefinition)
        if (definition.content.kind === 'timeline-template') templates.set(definition.id, definition.content)
      }
      const missingRuntimeContexts = [] as TimelineRuntimeContextContent[]
      for (const timeline of timelines) {
        if (await readTimelineRuntimeContext(ctx, timeline.id)) continue
        missingRuntimeContexts.push(await buildTimelineRuntimeContext(ctx, {
          timelineId: timeline.id,
          card,
          cardContent,
          templates,
        }))
      }
      const mutation = await executeDocumentMutation(ctx.documents, requestContext, 'application.deleteCard', async documents => {
        const currentCard = await readDocument<CardSourceContent>(documents, input.cardId, applicationDocumentTypes.cardSource)
        for (const runtimeContext of missingRuntimeContexts) {
          await writeDocument<TimelineRuntimeContextContent>(documents, {
            id: timelineRuntimeContextId(runtimeContext.timelineId),
            type: applicationDocumentTypes.timelineRuntimeContext,
            content: runtimeContext,
            expectedVersion: 'new',
          })
        }
        await tombstoneExtensionStorageScope(documents, { kind: 'card', cardId: input.cardId })
        for (const rule of ownedRules) await documents.delete({ id: rule.id, expectedVersion: rule.version })
        await documents.delete({ id: currentCard.id, expectedVersion: currentCard.version })
        return true as const
      })

      return { deleted: mutation.value, mutation: mutation.mutation }
    },

    listPortableExtensionPayloads: async input => ({
      payloads: (await listDocuments<PortableExtensionPayloadContent>(
        ctx.documents,
        applicationDocumentTypes.portableExtensionPayload,
      ))
        .map(toPortableExtensionPayloadEntry)
        .filter(payload => input?.packageId === undefined || payload.packageId === input.packageId),
    }),

    getPortableExtensionPayload: async input => ({
      payload: toPortableExtensionPayloadEntry(await readDocument<PortableExtensionPayloadContent>(
        ctx.documents,
        input.payloadId,
        applicationDocumentTypes.portableExtensionPayload,
      )),
    }),

    createPortableExtensionPayload: async (input, requestContext) => {
      const artifactPayloadId = input.artifactPayloadId ?? ctx.createId('payload')
      const payload = normalizePortableExtensionPayloadArtifact({ id: artifactPayloadId, ...input.payload })
      const mutation = await executeDocumentMutation(
        ctx.documents,
        requestContext,
        'application.createPortableExtensionPayload',
        async documents => {
          const timestamp = ctx.now()
          return await writeDocument<PortableExtensionPayloadContent>(documents, {
            id: ctx.createId('portable-payload'),
            type: applicationDocumentTypes.portableExtensionPayload,
            content: {
              ...portableExtensionPayloadFields(payload),
              artifactPayloadId,
              createdAt: timestamp,
              updatedAt: timestamp,
            },
            expectedVersion: 'new',
          })
        },
      )
      return { payload: toPortableExtensionPayloadEntry(mutation.value), mutation: mutation.mutation }
    },

    updatePortableExtensionPayload: async (input, requestContext) => {
      const mutation = await executeDocumentMutation(
        ctx.documents,
        requestContext,
        'application.updatePortableExtensionPayload',
        async documents => {
          const existing = await readDocument<PortableExtensionPayloadContent>(
            documents,
            input.payloadId,
            applicationDocumentTypes.portableExtensionPayload,
          )
          if (existing.version !== input.expectedVersion) {
            throw new Error(`Portable Extension Payload version conflict: ${input.payloadId}`)
          }
          const payload = normalizePortableExtensionPayloadArtifact({
            id: existing.content.artifactPayloadId,
            ...input.payload,
          })
          return await writeDocument<PortableExtensionPayloadContent>(documents, {
            id: existing.id,
            type: applicationDocumentTypes.portableExtensionPayload,
            content: {
              ...portableExtensionPayloadFields(payload),
              artifactPayloadId: existing.content.artifactPayloadId,
              createdAt: existing.content.createdAt,
              updatedAt: ctx.now(),
            },
            expectedVersion: existing.version,
          })
        },
      )
      return { payload: toPortableExtensionPayloadEntry(mutation.value), mutation: mutation.mutation }
    },

    deletePortableExtensionPayload: async (input, requestContext) => {
      const cards = await listDocuments<CardSourceContent>(ctx.documents, applicationDocumentTypes.cardSource)
      const referencingCard = cards.find(card => card.content.portableExtensionPayloadIds?.includes(input.payloadId))
      if (referencingCard) {
        throw new Error(`Portable Extension Payload is still bound to Card: ${referencingCard.id}`)
      }
      const existing = await readDocument<PortableExtensionPayloadContent>(
        ctx.documents,
        input.payloadId,
        applicationDocumentTypes.portableExtensionPayload,
      )
      if (existing.version !== input.expectedVersion) {
        throw new Error(`Portable Extension Payload version conflict: ${input.payloadId}`)
      }
      const mutation = await executeDocumentMutation(
        ctx.documents,
        requestContext,
        'application.deletePortableExtensionPayload',
        async documents => {
          await documents.delete({ id: existing.id, expectedVersion: existing.version })
          return true as const
        },
      )
      return { deleted: mutation.value, mutation: mutation.mutation }
    },

    replaceCardPortableExtensionPayloads: async (input, requestContext) => {
      if (new Set(input.payloadIds).size !== input.payloadIds.length) {
        throw new Error('Duplicate Portable Extension Payload binding')
      }
      const mutation = await executeDocumentMutation(
        ctx.documents,
        requestContext,
        'application.replaceCardPortableExtensionPayloads',
        async documents => {
          const card = await readDocument<CardSourceContent>(documents, input.cardId, applicationDocumentTypes.cardSource)
          if (card.version !== input.expectedVersion) throw new Error(`Card version conflict: ${input.cardId}`)
          const payloads = await Promise.all(input.payloadIds.map(payloadId => readDocument<PortableExtensionPayloadContent>(
            documents,
            payloadId,
            applicationDocumentTypes.portableExtensionPayload,
          )))
          const artifactPayloadIds = payloads.map(payload => payload.content.artifactPayloadId)
          if (new Set(artifactPayloadIds).size !== artifactPayloadIds.length) {
            throw new Error('Duplicate Artifact Payload id in Card bindings')
          }
          const updated = await writeDocument<CardSourceContent>(documents, {
            id: card.id,
            type: applicationDocumentTypes.cardSource,
            content: normalizeCardContent({
              ...card.content,
              portableExtensionPayloadIds: [...input.payloadIds],
              updatedAt: ctx.now(),
            }),
            expectedVersion: card.version,
          })
          return toCardSource(updated)
        },
      )
      return { card: mutation.value, mutation: mutation.mutation }
    },

    createProviderProfile: async (input, requestContext) => {
      assertNonEmpty(input.providerExtensionId, 'providerExtensionId')
      assertNonEmpty(input.displayName, 'displayName')
      const providerConfig = ctx.providerAdapters.validateAccountConfig(input.providerExtensionId, input.config ?? {})
      const providerCredential = input.credential
        ? ctx.providerAdapters.validateCredential(input.providerExtensionId, input.credential)
        : undefined
      const id = ctx.createId('provider-profile')
      const timestamp = ctx.now()
      const enabledModelIds = normalizeProviderModelIds(input.providerExtensionId, input.enabledModelIds)
      const secret = providerCredential
        ? await requireSecrets().create({
            ...secretWriteContext(requestContext, 'application.createProviderProfile.credential'),
            owner: { type: 'provider-profile', id },
            purpose: 'provider.credentials',
            label: input.displayName,
            plaintext: { values: providerCredential },
          })
        : undefined
      let providerProfile
      try {
        providerProfile = await writeDocument<ProviderProfileContent>(ctx.documents, {
        id,
        type: applicationDocumentTypes.providerProfile,
        content: {
          providerExtensionId: input.providerExtensionId,
          displayName: input.displayName,
          config: providerConfig,
          enabledModelIds,
          ...(secret ? { secretRef: secret.metadata.ref } : {}),
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        expectedVersion: 'new',
      })
      } catch (error) {
        if (secret) {
          await requireSecrets().delete({
            ...secretWriteContext(requestContext, 'application.createProviderProfile.rollback'),
            ref: secret.metadata.ref,
            owner: { type: 'provider-profile', id },
          })
        }
        throw error
      }

      return { providerProfile: await toProviderProfileView(ctx, providerProfile) }
    },

    getProviderProfile: async input => {
      const profile = await readDocument<ProviderProfileContent>(ctx.documents, input.providerProfileId, applicationDocumentTypes.providerProfile)
      return { providerProfile: await toProviderProfileView(ctx, profile) }
    },

    listProviderProfiles: async input => {
      const result = await ctx.documents.list({
        type: applicationDocumentTypes.providerProfile,
        cursor: input?.cursor,
        limit: input?.limit,
      })

      return {
        providerProfiles: await Promise.all(result.items.map(profile => toProviderProfileView(ctx, profile as never))),
        nextCursor: result.nextCursor,
      }
    },

    createAiCapabilityProfile: async input => {
      assertNonEmpty(input.providerProfileId, 'providerProfileId')
      assertNonEmpty(input.capabilityId, 'capabilityId')
      assertNonEmpty(input.displayName, 'displayName')
      const providerProfile = await readDocument<ProviderProfileContent>(
        ctx.documents,
        input.providerProfileId,
        applicationDocumentTypes.providerProfile,
      )
      const config = requireAiCapabilities().validateProfileConfig(
        providerProfile.content.providerExtensionId,
        input.capabilityId,
        input.config ?? {},
      )
      const timestamp = ctx.now()
      const profile = await writeDocument<AiCapabilityProfileContent>(ctx.documents, {
        id: ctx.createId('ai-capability-profile'),
        type: applicationDocumentTypes.aiCapabilityProfile,
        content: {
          providerProfileId: providerProfile.id,
          capabilityId: input.capabilityId,
          displayName: input.displayName,
          config,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        expectedVersion: 'new',
      })
      return { profile: await toAiCapabilityProfileView(ctx, profile) }
    },

    getAiCapabilityProfile: async input => {
      const profile = await readDocument<AiCapabilityProfileContent>(
        ctx.documents,
        input.profileId,
        applicationDocumentTypes.aiCapabilityProfile,
      )
      return { profile: await toAiCapabilityProfileView(ctx, profile) }
    },

    listAiCapabilityProfiles: async input => {
      const result = await ctx.documents.list({
        type: applicationDocumentTypes.aiCapabilityProfile,
        cursor: input?.cursor,
        limit: input?.limit,
      })
      const profiles = result.items as DocumentRecord<AiCapabilityProfileContent>[]
      const filtered = profiles.filter(profile => (
        (!input?.providerProfileId || profile.content.providerProfileId === input.providerProfileId)
        && (!input?.capabilityId || profile.content.capabilityId === input.capabilityId)
      ))
      return {
        profiles: await Promise.all(filtered.map(profile => toAiCapabilityProfileView(ctx, profile))),
        nextCursor: result.nextCursor,
      }
    },

    updateAiCapabilityProfile: async input => {
      const existing = await readDocument<AiCapabilityProfileContent>(
        ctx.documents,
        input.profileId,
        applicationDocumentTypes.aiCapabilityProfile,
      )
      if (input.displayName !== undefined) assertNonEmpty(input.displayName, 'displayName')
      let config = existing.content.config
      if (input.config !== undefined) {
        const providerProfile = await readDocument<ProviderProfileContent>(
          ctx.documents,
          existing.content.providerProfileId,
          applicationDocumentTypes.providerProfile,
        )
        config = requireAiCapabilities().validateProfileConfig(
          providerProfile.content.providerExtensionId,
          existing.content.capabilityId,
          input.config,
        )
      }
      const updated = await writeDocument<AiCapabilityProfileContent>(ctx.documents, {
        id: existing.id,
        type: applicationDocumentTypes.aiCapabilityProfile,
        content: {
          ...existing.content,
          ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
          config,
          updatedAt: ctx.now(),
        },
        expectedVersion: existing.version,
      })
      return { profile: await toAiCapabilityProfileView(ctx, updated) }
    },

    deleteAiCapabilityProfile: async input => {
      const existing = await readDocument<AiCapabilityProfileContent>(
        ctx.documents,
        input.profileId,
        applicationDocumentTypes.aiCapabilityProfile,
      )
      await ctx.documents.delete({ id: existing.id, expectedVersion: existing.version })
      return { deleted: true as const }
    },

    createAgentProfile: async input => {
      assertNonEmpty(input.name, 'name')
      await readPresetResource(ctx.promptResources, input.presetId)
      await assertProviderModelExists(ctx.documents, input.model)
      const toolOverrides = normalizeToolOverrides(input.toolOverrides)
      assertResolvedTools(ctx, Object.keys(toolOverrides))

      const timestamp = ctx.now()
      const agentProfile = await writeDocument<AgentProfileContent>(ctx.documents, {
        id: ctx.createId('agent-profile'),
        type: applicationDocumentTypes.agentProfile,
        content: {
          name: input.name,
          presetId: input.presetId,
          model: input.model,
          toolOverrides,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        expectedVersion: 'new',
      })

      return { agentProfile: toAgentProfileEntry(agentProfile) }
    },

    getAgentProfile: async input => {
      const agentProfile = await readDocument<AgentProfileContent>(ctx.documents, input.agentProfileId, applicationDocumentTypes.agentProfile)
      return { agentProfile: toAgentProfileEntry(agentProfile) }
    },

    listAgentProfiles: async input => {
      const result = await ctx.documents.list({
        type: applicationDocumentTypes.agentProfile,
        cursor: input?.cursor,
        limit: input?.limit,
      })

      return {
        agentProfiles: result.items.map(agentProfile => toAgentProfileEntry(agentProfile as DocumentRecord<AgentProfileContent>)),
        nextCursor: result.nextCursor,
      }
    },

    updateProviderProfile: async input => {
      const existing = await readDocument<ProviderProfileContent>(ctx.documents, input.providerProfileId, applicationDocumentTypes.providerProfile)
      if (input.displayName !== undefined) assertNonEmpty(input.displayName, 'displayName')
      const providerConfig = input.config === undefined
        ? existing.content.config
        : ctx.providerAdapters.validateAccountConfig(existing.content.providerExtensionId, input.config)
      const timestamp = ctx.now()
      const updated = await writeDocument<ProviderProfileContent>(ctx.documents, {
        id: existing.id,
        type: applicationDocumentTypes.providerProfile,
        content: {
          ...existing.content,
          ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
          config: providerConfig,
          ...(input.enabledModelIds !== undefined
            ? { enabledModelIds: normalizeProviderModelIds(existing.content.providerExtensionId, input.enabledModelIds) }
            : {}),
          updatedAt: timestamp,
        },
        expectedVersion: existing.version,
      })
      return { providerProfile: await toProviderProfileView(ctx, updated) }
    },

    replaceProviderCredential: async (input, requestContext) => {
      const existing = await readDocument<ProviderProfileContent>(ctx.documents, input.providerProfileId, applicationDocumentTypes.providerProfile)
      const providerCredential = ctx.providerAdapters.validateCredential(existing.content.providerExtensionId, input.credential)
      const secrets = requireSecrets()
      const owner = { type: 'provider-profile', id: existing.id }
      if (existing.content.secretRef) {
        const result = await secrets.replace({
          ...secretWriteContext(requestContext, 'application.replaceProviderCredential'),
          ref: existing.content.secretRef,
          owner,
          plaintext: { values: providerCredential },
        })
        return { credential: { configured: true, updatedAt: result.metadata.updatedAt } }
      }
      const created = await secrets.create({
        ...secretWriteContext(requestContext, 'application.replaceProviderCredential'),
        owner,
        purpose: 'provider.credentials',
        label: existing.content.displayName,
        plaintext: { values: providerCredential },
      })
      try {
        await writeDocument<ProviderProfileContent>(ctx.documents, {
          id: existing.id,
          type: applicationDocumentTypes.providerProfile,
          content: { ...existing.content, secretRef: created.metadata.ref, updatedAt: ctx.now() },
          expectedVersion: existing.version,
        })
      } catch (error) {
        await secrets.delete({
          ...secretWriteContext(requestContext, 'application.replaceProviderCredential.rollback'),
          ref: created.metadata.ref,
          owner,
        })
        throw error
      }
      return { credential: { configured: true, updatedAt: created.metadata.updatedAt } }
    },

    deleteProviderProfile: async (input, requestContext) => {
      const existing = await readDocument<ProviderProfileContent>(ctx.documents, input.providerProfileId, applicationDocumentTypes.providerProfile)
      const profiles = await listDocuments<AgentProfileContent>(ctx.documents, applicationDocumentTypes.agentProfile)
      if (profiles.some(profile => profile.content.model.providerProfileId === existing.id)) {
        throw new Error(`Provider Profile is still referenced by an Agent Profile: ${existing.id}`)
      }
      const capabilityProfiles = await listDocuments<AiCapabilityProfileContent>(
        ctx.documents,
        applicationDocumentTypes.aiCapabilityProfile,
      )
      if (capabilityProfiles.some(profile => profile.content.providerProfileId === existing.id)) {
        throw new Error(`Provider Profile is still referenced by an AI Capability Profile: ${existing.id}`)
      }
      await ctx.documents.delete({ id: existing.id, expectedVersion: existing.version })
      let credentialCleanupPending = false
      if (existing.content.secretRef) {
        const deleted = await requireSecrets().delete({
          ...secretWriteContext(requestContext, 'application.deleteProviderProfile.credential'),
          ref: existing.content.secretRef,
          owner: { type: 'provider-profile', id: existing.id },
        })
        credentialCleanupPending = deleted.cleanupPending
      }
      return { deleted: true as const, credentialCleanupPending }
    },

    listProviderModels: async (input, requestContext) => {
      if (!ctx.gateway.listModels) throw new Error('AI Gateway does not support model discovery')
      return await ctx.gateway.listModels({
        providerProfileId: input.providerProfileId,
        ...(requestContext ? { context: requestContext } : {}),
      })
    },

    pingProviderModel: async (input, requestContext) => {
      await assertProviderModelExists(ctx.documents, input)
      const result = await ctx.gateway.invokeChat({
        request: {
          messages: [{ role: 'user', content: input.text ?? 'hi' }],
        },
        model: { providerProfileId: input.providerProfileId, modelId: input.modelId },
        runId: ctx.createId('run'),
        sessionId: ctx.createId('session'),
        branchId: ctx.createId('branch'),
        ...(requestContext ? { context: requestContext } : {}),
      })

      return {
        text: result.text,
        provider: result.provider,
        model: result.model,
        raw: result.raw,
      }
    },

    updateAgentProfile: async input => {
      const existing = await readDocument<AgentProfileContent>(ctx.documents, input.agentProfileId, applicationDocumentTypes.agentProfile)
      if (input.name !== undefined) assertNonEmpty(input.name, 'name')
      if (input.presetId !== undefined) {
        await readPresetResource(ctx.promptResources, input.presetId)
      }
      if (input.model !== undefined) await assertProviderModelExists(ctx.documents, input.model)
      const toolOverrides = input.toolOverrides === undefined
        ? existing.content.toolOverrides ?? {}
        : normalizeToolOverrides(input.toolOverrides)
      assertResolvedTools(ctx, Object.keys(toolOverrides))
      const timestamp = ctx.now()
      const updated = await writeDocument<AgentProfileContent>(ctx.documents, {
        id: existing.id,
        type: applicationDocumentTypes.agentProfile,
        content: {
          ...existing.content,
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.presetId !== undefined ? { presetId: input.presetId } : {}),
          ...(input.model !== undefined ? { model: input.model } : {}),
          toolOverrides,
          updatedAt: timestamp,
        },
        expectedVersion: existing.version,
      })
      return { agentProfile: toAgentProfileEntry(updated) }
    },

    listAgentTools: async () => ({ tools: await listAgentToolEntries(ctx) }),

    importExtensionPackageResources: (input, requestContext) => importExtensionPackageResources(ctx, input, requestContext, requireDocumentParticipant()),

    removeExtensionPackageResources: (input, requestContext) => removeExtensionPackageResources(ctx, input, requestContext, requireDocumentParticipant()),

    updateAgentTool: async (input) => {
      const existing = await readDocument<AgentToolContent>(
        ctx.documents,
        input.toolId,
        applicationDocumentTypes.agentTool,
      )
      if (input.expectedVersion !== existing.version)
        throw new Error(`Agent tool version conflict: ${input.toolId}`)
      if (input.definition.id !== input.toolId)
        throw new Error('Agent tool definition id cannot change')
      createAgentToolRegistry([input.definition])
      const updated = await writeDocument<AgentToolContent>(ctx.documents, {
        id: existing.id,
        type: applicationDocumentTypes.agentTool,
        content: {
          ...toAgentToolContent(input.definition, existing.content.createdAt, ctx.now(), existing.content.origin),
          updatedAt: ctx.now(),
        },
        expectedVersion: existing.version,
      })
      await refreshAgentToolRegistry(ctx)
      return {
        tool: toAgentToolEntry(updated),
      }
    },

    deleteAgentProfile: async input => {
      await readDocument<AgentProfileContent>(ctx.documents, input.agentProfileId, applicationDocumentTypes.agentProfile)
      if (await requireAgents().hasSessionForProfile(input.agentProfileId)) {
        throw new Error(`Agent Profile is still referenced by an Agent Session: ${input.agentProfileId}`)
      }
      await ctx.documents.delete({ id: input.agentProfileId })
      return { deleted: true as const }
    },

    createAgentSession: async (input, requestContext) => {
      await readDocument<AgentProfileContent>(ctx.documents, input.agentProfileId, applicationDocumentTypes.agentProfile)
      const result = await requireAgents().createSession({
        ...agentWriteContext(requestContext, 'application.createAgentSession'),
        agentProfileId: input.agentProfileId,
        title: input.title,
      })
      return { session: result.session, mutation: { changesetId: result.commit.changesetId } }
    },

    getAgentSession: async input => {
      const session = await requireAgents().getSession(input.agentSessionId)
      if (!session) throw new Error(`Agent session not found: ${input.agentSessionId}`)
      return { session }
    },

    getAgentTranscriptPage: input => requireAgents().getEntryPage(input),

    appendAgentTranscriptEntries: async (input, requestContext) => {
      const result = await requireAgents().appendEntries({
        ...agentWriteContext(requestContext, 'application.appendAgentTranscriptEntries'),
        ...input,
      })
      return {
        session: result.session,
        entries: result.entries,
        mutation: { changesetId: result.commit.changesetId },
      }
    },

    deleteAgentSession: async (input, requestContext) => {
      const agents = requireAgents()
      const documentParticipant = requireDocumentParticipant()
      const result = await ctx.dataEngine.transact(
        agentWriteContext(requestContext, 'application.deleteAgentSession'),
        async dataTx => documentParticipant.participateTransaction(dataTx, async documents => {
          const session = agents.transaction(dataTx).deleteSession(input)
          await tombstoneExtensionStorageScope(documents, {
            kind: 'agent-session',
            agentSessionId: input.agentSessionId,
          })
          return session
        }, { allowEmpty: true }),
      )
      return { deleted: true as const, mutation: { changesetId: result.commit.changesetId } }
    },

    previewAgentTurn: async (input, requestContext) => {
      const prepared = await prepareAgentTurn(ctx, input, 'preview', requestContext)
      return {
        runId: prepared.runId,
        messages: prepared.agentStepMessages,
        projection: prepared.prompt.projection,
        promptBuildTrace: prepared.prompt.promptBuildTrace,
        toolExposures: prepared.compiledToolSet.tools.map(
          (tool) => tool.exposure,
        ),
        toolPromptBuildTrace: prepared.compiledToolSet.trace,
        providerPayloadPreview: await buildProviderPayloadPreview({
          documents: ctx.documents,
          messages: prepared.agentStepMessages,
          model: prepared.model,
        }),
      }
    },

    invokeAgentTurn: async (input, requestContext) => {
      const agents = requireAgents()
      const prepared = await prepareAgentTurn(ctx, input, 'runtime', requestContext)
      const {
        model,
        narrativePage,
        narratives,
        prompt,
        agentStepMessages,
        compiledToolSet,
        runId,
        session,
      } = prepared
      const classificationRules = await filterRulesForSource(
        ctx,
        { kind: 'agent-session', sessionId: session.id },
        (await listDocuments<TextTransformRuleContent>(ctx.documents, applicationDocumentTypes.textTransformRule)).map(document => toVersioned(document)),
      )
      const loop = await runNativeToolLoop({
        ctx,
        agents,
        session,
        runId,
        model,
        initialMessages: agentStepMessages,
        userInput: input.input,
        compiledToolSet,
        toolExecutionScope: prompt.toolExecutionScope,
        branchId: narrativePage?.branch.id ?? 'agent-only',
        purpose: input.narrativeTarget?.commit ? 'narrative' : 'agent',
        classificationRules,
        ...(requestContext ? { requestContext } : {}),
      })
      const narrative = narrativePage && input.narrativeTarget?.commit
        ? await ctx.dataEngine.transact(
            narrativeWriteContext(requestContext, 'application.invokeAgentTurn.narrative'),
            async dataTx => {
              const narrativeTx = narratives!.transaction(dataTx)
              const user = narrativeTx.appendNode({
                timelineId: narrativePage.timeline.id,
                branchId: narrativePage.branch.id,
                expectedHeadNodeId: narrativePage.branch.headNodeId ?? null,
                stateRevisionId: narrativePage.branch.stateHeadRevisionId,
                body: { format: 'loom-markdown.v1', raw: readMessageEntryContent(loop.userEntry, 'user') },
                source: {
                  agentSessionId: session.id,
                  agentMessageId: loop.userEntry.id,
                  runId,
                },
              })
              const assistant = narrativeTx.appendNode({
                timelineId: narrativePage.timeline.id,
                branchId: narrativePage.branch.id,
                expectedHeadNodeId: user.node.id,
                stateRevisionId: narrativePage.branch.stateHeadRevisionId,
                body: { format: 'loom-markdown.v1', raw: readMessageEntryContent(loop.assistantEntry, 'assistant') },
                source: {
                  agentSessionId: session.id,
                  agentMessageId: loop.assistantEntry.id,
                  runId,
                },
              })
              return {
                timeline: assistant.timeline,
                branch: assistant.branch,
                node: assistant.node,
                nodes: [user.node, assistant.node],
              }
            },
          )
        : undefined

      return {
        runId,
        agentSession: loop.session,
        entries: { user: loop.userEntry, assistant: loop.assistantEntry },
        ...(narrative ? { narrative: narrative.value } : {}),
        provider: {
          provider: loop.providerResult.provider,
          model: loop.providerResult.model,
          ...(loop.providerResult.finishReason ? { finishReason: loop.providerResult.finishReason } : {}),
          ...(loop.providerResult.usage ? { usage: loop.providerResult.usage } : {}),
          ...(loop.providerResult.providerCallId ? { providerCallId: loop.providerResult.providerCallId } : {}),
        },
        projection: prompt.projection,
        promptBuildTrace: prompt.promptBuildTrace,
        toolExposures: compiledToolSet.tools.map((tool) => tool.exposure),
        toolPromptBuildTrace: loop.toolPromptBuildTrace,
        mutation: { changesetId: narrative?.commit.changesetId ?? loop.changesetId },
      }
    },

    createNarrativeTimeline: (input, requestContext) => createTimelineFromCard(
      input, requestContext, 'application.createNarrativeTimeline',
    ),

    getNarrativeTimeline: async input => {
      const timeline = await requireNarratives().getTimeline(input.timelineId)
      if (!timeline) throw new Error(`Narrative timeline not found: ${input.timelineId}`)
      return {
        timeline,
        branches: await requireNarratives().listBranches(timeline.id),
      }
    },

    listNarrativeTimelines: input => requireNarratives().listTimelines(input),

    getNarrativePage: input => requireNarratives().getPage(input),

    forkNarrativeBranch: async (input, requestContext) => {
      const narratives = requireNarratives()
      const branches = await narratives.listBranches(input.timelineId)
      const sourceBranch = branches.find(branch => branch.id === input.fromBranchId)
      if (!sourceBranch) throw new Error(`Narrative branch not found: ${input.fromBranchId}`)
      const page = await narratives.getPage({ timelineId: input.timelineId, branchId: input.fromBranchId })
      const fromNode = page.nodes.find(node => node.id === input.fromNodeId)
      if (!fromNode) throw new Error(`Narrative node not found on branch: ${input.fromNodeId}`)
      const stateRevisionId = sourceBranch.headNodeId === fromNode.id
        ? sourceBranch.stateHeadRevisionId
        : fromNode.stateRevisionId
      const result = await requireNarratives().forkBranch({
        ...narrativeWriteContext(requestContext, 'application.forkNarrativeBranch'),
        ...input,
        stateRevisionId,
      })
      return { branch: result.branch, mutation: { changesetId: result.commit.changesetId } }
    },

    switchNarrativeBranch: async (input, requestContext) => {
      const result = await requireNarratives().switchBranch({
        ...narrativeWriteContext(requestContext, 'application.switchNarrativeBranch'),
        ...input,
      })
      return { timeline: result.timeline, mutation: { changesetId: result.commit.changesetId } }
    },

    deleteNarrativeTimeline: async (input, requestContext) => {
      const narratives = requireNarratives()
      const scope = await ctx.states.getScope({ kind: 'timeline', ownerId: input.timelineId })
      const documentParticipant = requireDocumentParticipant()
      const result = await ctx.dataEngine.transact(
        narrativeWriteContext(requestContext, 'application.deleteNarrativeTimeline'),
        async dataTx => documentParticipant.participateTransaction(dataTx, async documents => {
          const timeline = narratives.transaction(dataTx).deleteTimeline(input)
          if (scope) ctx.states.transaction(dataTx).tombstoneScope({ scopeId: scope.id })
          const runtimeContext = await documents.get(timelineRuntimeContextId(input.timelineId))
          if (runtimeContext && !runtimeContext.meta.tombstone) {
            await documents.delete({ id: runtimeContext.id, expectedVersion: runtimeContext.version })
          }
          await tombstoneExtensionStorageScope(documents, {
            kind: 'timeline',
            timelineId: input.timelineId,
          })
          return timeline
        }, { allowEmpty: true }),
      )
      return { deleted: true as const, mutation: { changesetId: result.commit.changesetId } }
    },

    importCardBundle: async (input, requestContext) => {
      const artifact = input.source ? parseCardBundleSource(input.source.text) : input.artifact
      await assertCardMedia(ctx, artifact.card.media)
      const sourceText = input.source?.text ?? `${JSON.stringify(artifact, null, 2)}\n`
      const storedSourceArtifact = ctx.sourceArtifacts
        ? await ctx.sourceArtifacts.preserve({
          source: new TextEncoder().encode(sourceText),
          format: 'loom.cardBundle',
          originalFileName: input.source?.originalFileName,
          mediaType: 'application/json',
          importerVersion: 'loom.cardBundle@2',
          actor: requestContext?.actor ?? (requestContext?.clientId
            ? { kind: 'client', id: requestContext.clientId }
            : applicationActor),
          reason: 'application.importCardBundle.sourceArtifact',
          correlationId: requestContext?.correlationId,
          callId: requestContext?.callId,
          parentCallId: requestContext?.parentCallId,
        })
        : undefined
      return await importCardBundle({
        artifact,
        context: requestContext,
        documents: ctx.documents,
        promptResources: ctx.promptResources,
        dataEngine: ctx.dataEngine,
        now: ctx.now(),
        storedSourceArtifact,
      })
    },

    getPromptResource: async input => {
      return {
        resource: await readMappedResource(ctx.promptResources, input.resourceId),
      }
    },

    listPromptResources: async input => ({
      resources: await listMappedResources(ctx.promptResources, input?.resourceKind),
    }),

    createPromptResource: async (input, requestContext) => {
      const content = createEmptyPromptResourceContent(ctx.createId, input.name, input.resourceKind, ctx.now())
      const result = await ctx.promptResources.createResource({
        ...toStoredResourceInput({ content }),
        ...promptResourceWriteContext(requestContext),
        reason: 'application.createPromptResource',
      })
      return { resource: fromStoredResource(result.resource), mutation: { changesetId: result.commit.changesetId } }
    },

    duplicatePromptResource: async (input, requestContext) => {
      const source = await ctx.promptResources.getResource(input.resourceId)
      if (!source) throw new Error(`Prompt resource not found: ${input.resourceId}`)
      const sourceContent = await readMappedResource(ctx.promptResources, input.resourceId)
      const duplicateContent = clonePromptResourceContent(sourceContent, ctx.createId, input.name?.trim() || `${sourceContent.rootNode.label} Copy`)
      const sourceMounts = source.resourceKind === 'preset'
        ? await ctx.promptResources.listSettingMounts({ source: { kind: 'preset', id: source.id } })
        : []
      const sourceToolMounts = source.resourceKind === 'preset'
        ? await ctx.promptResources.listPresetToolMounts({ presetResourceId: source.id })
        : []
      const transaction = await ctx.dataEngine.transact({
        ...promptResourceWriteContext(requestContext),
        reason: 'application.duplicatePromptResource',
      }, async dataTx => {
        const resourceTx = ctx.promptResources.transaction(dataTx)
        const created = resourceTx.createResource(toStoredResourceInput({ content: duplicateContent }))
        const mounts = sourceMounts.map(mount => resourceTx.addSettingMount({
          source: { kind: 'preset', id: created.id },
          settingResourceId: mount.settingResourceId,
          orderIndex: mount.orderIndex,
          origin: mount.origin,
        }))
        const toolMounts = sourceToolMounts.map(mount => resourceTx.addPresetToolMount({
          presetResourceId: created.id,
          toolId: mount.toolId,
          orderIndex: mount.orderIndex,
          defaultEnabled: mount.defaultEnabled,
          ...(mount.activation ? { activation: mount.activation } : {}),
          ...(mount.provider ? { provider: mount.provider } : {}),
          ...(mount.content ? { content: mount.content } : {}),
          origin: mount.origin,
        }))
        return { resource: created, mounts, toolMounts }
      })
      return {
        resource: fromStoredResource(transaction.value.resource),
        mutation: { changesetId: transaction.commit.changesetId },
      }
    },

    deletePromptResource: async (input, requestContext) => {
      const resource = await readMappedResource(ctx.promptResources, input.resourceId)
      if (resource.resourceKind === 'preset') {
        const profiles = await listDocuments<AgentProfileContent>(ctx.documents, applicationDocumentTypes.agentProfile)
        if (profiles.some(profile => profile.content.presetId === input.resourceId)) {
          throw new Error(`Preset is still referenced by an Agent Profile: ${input.resourceId}`)
        }
      }
      const timelineReferences = await findTimelinePromptResourceReferences(ctx, input.resourceId)
      const cards = await listDocuments<CardSourceContent>(ctx.documents, applicationDocumentTypes.cardSource)
      const referencedCards = cards.filter(card => card.content.promptResourceIds?.includes(input.resourceId))
      const ownedRules = resource.resourceKind === 'preset'
        ? (await listDocuments<TextTransformRuleContent>(ctx.documents, applicationDocumentTypes.textTransformRule))
          .filter(rule => rule.content.owner.kind === 'preset' && rule.content.owner.presetId === input.resourceId)
        : []
      const settingMounts = resource.resourceKind === 'setting'
        ? await ctx.promptResources.listSettingMounts({ settingResourceId: input.resourceId })
        : []
      const presetCount = new Set(settingMounts
        .filter(mount => mount.source.kind === 'preset')
        .map(mount => mount.source.id))
        .size
      const documentParticipant = requireDocumentParticipant()
      const transaction = await ctx.dataEngine.transact({
        ...promptResourceWriteContext(requestContext),
        reason: 'application.deletePromptResource',
      }, async dataTx => {
        const resourceTx = ctx.promptResources.transaction(dataTx)
        const narrativeTx = ctx.narratives?.transaction(dataTx)
        for (const timeline of timelineReferences) {
          narrativeTx?.updatePromptResources({
            timelineId: timeline.id,
            promptResourceIds: timeline.promptResourceIds.filter(id => id !== input.resourceId),
            expectedPromptResourceIds: timeline.promptResourceIds,
          })
        }
        if (referencedCards.length === 0) {
          return documentParticipant.participateTransaction(dataTx, async documents => {
            for (const rule of ownedRules) await documents.delete({ id: rule.id, expectedVersion: rule.version })
            return { deleted: resourceTx.deleteResource({ resourceId: input.resourceId, expectedVersion: resource.version }) }
          }, { allowEmpty: true })
        }
        return await documentParticipant.participateTransaction(dataTx, async documents => {
          for (const card of referencedCards) {
            const currentCard = await readDocument<CardSourceContent>(documents, card.id, applicationDocumentTypes.cardSource)
            await writeDocument<CardSourceContent>(documents, {
              id: currentCard.id,
              type: applicationDocumentTypes.cardSource,
              content: {
                ...currentCard.content,
                promptResourceIds: currentCard.content.promptResourceIds?.filter(id => id !== input.resourceId),
                updatedAt: ctx.now(),
              },
              expectedVersion: currentCard.version,
            })
          }
          for (const rule of ownedRules) await documents.delete({ id: rule.id, expectedVersion: rule.version })
          return { deleted: resourceTx.deleteResource({ resourceId: input.resourceId, expectedVersion: resource.version }) }
        })
      })
      return {
        deleted: true as const,
        detachedReferences: { presets: presetCount, cards: referencedCards.length, timelines: timelineReferences.length },
        mutation: { changesetId: transaction.commit.changesetId },
      }
    },

    revertPromptResourceChangeset: async (input, requestContext) => {
      const result = await ctx.promptResources.revertChangeset({
        changesetId: input.changesetId,
        expectedVersion: input.expectedVersion,
        ...promptResourceWriteContext(requestContext),
        reason: 'application.revertPromptResourceChangeset',
      })
      return { mutation: { changesetId: result.commit.changesetId } }
    },

    importPromptResource: async (input, requestContext) => {
      const content: PromptResourceContent = {
        resourceKind: input.artifact.resourceKind,
        rootNode: clonePromptResourceNode(input.artifact.rootNode, ctx.createId),
        ...(input.artifact.resourceKind === 'preset' ? { historyPolicy: 'persistent' as const } : {}),
        createdAt: ctx.now(),
        updatedAt: ctx.now(),
      }
      const result = await ctx.promptResources.createResource({
        ...toStoredResourceInput({ content }),
        ...promptResourceWriteContext(requestContext),
        reason: 'application.importPromptResource',
      })
      return { resource: fromStoredResource(result.resource), mutation: { changesetId: result.commit.changesetId } }
    },

    exportPromptResource: async input => {
      const resource = await readMappedResource(ctx.promptResources, input.resourceId)
      return {
        artifact: {
          format: 'loom.promptResource' as const,
          schemaVersion: 1 as const,
          resourceKind: resource.resourceKind,
          rootNode: resource.rootNode,
        },
      }
    },

    updateCardPromptResources: async (input, requestContext) => {
      if (new Set(input.promptResourceIds).size !== input.promptResourceIds.length) throw new Error('Duplicate prompt resource id')
      for (const resourceId of input.promptResourceIds) {
        if (!await ctx.promptResources.getResource(resourceId)) throw new Error(`Prompt resource not found: ${resourceId}`)
      }
      const documentParticipant = requireDocumentParticipant()
      const transaction = await ctx.dataEngine.transact({
        ...promptResourceWriteContext(requestContext),
        reason: 'application.updateCardPromptResources',
      }, async dataTx => documentParticipant.participateTransaction(dataTx, async documents => {
        const card = await readDocument<CardSourceContent>(documents, input.cardId, applicationDocumentTypes.cardSource)
        return await writeDocument<CardSourceContent>(documents, {
          id: card.id,
          type: applicationDocumentTypes.cardSource,
          content: normalizeCardContent({ ...card.content, promptResourceIds: [...input.promptResourceIds], updatedAt: ctx.now() }),
          expectedVersion: card.version,
        })
      }))
      return {
        card: toCardSource(transaction.value.value),
        mutation: { changesetId: transaction.commit.changesetId },
      }
    },

    listSettingMounts: async input => ({
      mounts: await ctx.promptResources.listSettingMounts({ source: input?.source }),
    }),

    replaceSettingMounts: async (input, requestContext) => {
      for (const settingId of input.settingResourceIds) {
        const setting = await ctx.promptResources.getResource(settingId)
        if (!setting) throw new Error(`Prompt resource not found: ${settingId}`)
        if (setting.resourceKind !== 'setting') throw new Error(`Prompt resource ${settingId} can only link Setting resources`)
      }
      const result = await ctx.promptResources.replaceSettingMounts({
        ...promptResourceWriteContext(requestContext),
        reason: 'application.replaceSettingMounts',
        source: input.source,
        mounts: input.settingResourceIds.map((settingResourceId, orderIndex) => ({ settingResourceId, orderIndex })),
      })
      return { mounts: result.mounts, mutation: { changesetId: result.commit.changesetId } }
    },

    listPresetToolMounts: async input => ({
      mounts: await ctx.promptResources.listPresetToolMounts({
        presetResourceId: input?.presetId,
        toolId: input?.toolId,
      }),
    }),

    replacePresetToolMounts: async (input, requestContext) => {
      await readPresetResource(ctx.promptResources, input.presetId)
      const seen = new Set<string>()
      for (const mount of input.mounts) {
        if (seen.has(mount.toolId)) throw new Error(`Preset Tool mount is duplicated: ${mount.toolId}`)
        seen.add(mount.toolId)
        const resolved = ctx.agentTools.resolve([mount.toolId])
        const definition = resolved.tools[0]
        if (!definition) throw new Error(resolved.diagnostics[0]?.message ?? `Agent tool is not registered: ${mount.toolId}`)
        if (mount.activation !== undefined && !isPromptActivation(mount.activation)) {
          throw new Error(`Preset Tool mount activation is invalid: ${mount.toolId}`)
        }
        if (definition.input.kind === 'structured' && mount.content !== undefined) {
          throw new Error(`Structured Tool cannot use Content placement: ${mount.toolId}`)
        }
      }
      const result = await ctx.promptResources.replacePresetToolMounts({
        ...promptResourceWriteContext(requestContext),
        reason: 'application.replacePresetToolMounts',
        presetResourceId: input.presetId,
        mounts: input.mounts.map(mount => ({
          toolId: mount.toolId,
          orderIndex: mount.orderIndex,
          defaultEnabled: mount.defaultEnabled,
          ...(mount.activation ? { activation: structuredClone(mount.activation) } : {}),
          ...(mount.provider ? { provider: { ...mount.provider } } : {}),
          ...(mount.content ? { content: { ...mount.content } } : {}),
        })),
      })
      return { mounts: result.mounts, mutation: { changesetId: result.commit.changesetId } }
    },

    createPromptResourceAsset: async (input, requestContext) => {
      const current = await ctx.promptResources.getResource(input.resourceId)
      if (!current) throw new Error(`Prompt resource not found: ${input.resourceId}`)
      const placement = resolveAssetPlacement(fromStoredResource(current).rootNode, input.targetAssetId, input.position)
      const asset = applyDefaultPromptProjection(input.asset, fromStoredResource(current))
      const mutation: PromptResourceMutation = { kind: 'node.create', parentId: placement.parentId, node: toStoredNodeDraft(asset) }
      const result = await ctx.promptResources.mutateResource({
        ...promptResourceWriteContext(requestContext), reason: 'application.createPromptResourceAsset',
        resourceId: input.resourceId, expectedVersion: current.version,
        mutations: [{ ...mutation, node: { ...mutation.node, orderIndex: placement.orderIndex } }, ...buildInsertionReorderMutations(fromStoredResource(current).rootNode, placement.parentId, placement.orderIndex)],
      })
      return { resource: fromStoredResource(result.resource), mutation: { changesetId: result.commit.changesetId } }
    },

    updatePromptResourceAsset: async (input, requestContext) => {
      return updatePromptResourceAssets({ resourceId: input.resourceId, updates: [{ ...input, assetId: input.assetId }], requestContext, ctx })
    },

    updatePromptResourceAssets: async (input, requestContext) => {
      return updatePromptResourceAssets({ resourceId: input.resourceId, updates: input.updates, requestContext, ctx })
    },

    movePromptResourceAsset: async (input, requestContext) => {
      const current = await ctx.promptResources.getResource(input.resourceId)
      if (!current) throw new Error(`Prompt resource not found: ${input.resourceId}`)
      const placement = resolveAssetPlacement(fromStoredResource(current).rootNode, input.targetAssetId, input.position)
      const result = await ctx.promptResources.mutateResource({
        ...promptResourceWriteContext(requestContext), reason: 'application.movePromptResourceAsset',
        resourceId: input.resourceId, expectedVersion: current.version,
        mutations: buildMoveMutations(fromStoredResource(current).rootNode, input.assetId, placement),
      })
      return { resource: fromStoredResource(result.resource), mutation: { changesetId: result.commit.changesetId } }
    },

    deletePromptResourceAsset: async (input, requestContext) => {
      const current = await ctx.promptResources.getResource(input.resourceId)
      if (!current) throw new Error(`Prompt resource not found: ${input.resourceId}`)
      const result = await ctx.promptResources.mutateResource({
        ...promptResourceWriteContext(requestContext), reason: 'application.deletePromptResourceAsset',
        resourceId: input.resourceId, expectedVersion: current.version,
        mutations: [{ kind: 'node.delete', nodeId: input.assetId }],
      })
      return { resource: fromStoredResource(result.resource), mutation: { changesetId: result.commit.changesetId } }
    },

    exportCardBundle: async input => {
      return {
        artifact: await exportCardArtifact({
          cardId: input.cardId,
          documents: ctx.documents,
          promptResources: ctx.promptResources,
        }),
      }
    },

    revertChangeset: async (input, requestContext) => {
      const stateRevision = ctx.dataEngine.database.prepare('SELECT 1 FROM state_revisions WHERE changeset_id = ? LIMIT 1').get(input.changesetId)
      if (stateRevision) {
        const documentChangeset = await ctx.documents.getChangeset(input.changesetId)
        const result = await revertApplicationStateChangeset(
          ctx,
          input.changesetId,
          requestContext,
          documentChangeset?.operations.length
            ? { participant: requireDocumentParticipant(), changeset: documentChangeset }
            : undefined,
        )
        return { mutation: result }
      }
      const result = await ctx.documents.revertChangeset({
        changesetId: input.changesetId,
        actor: requestContext?.actor ?? (requestContext?.clientId
          ? { kind: 'client' as const, id: requestContext.clientId }
          : applicationActor),
        reason: 'application.revertChangeset',
        correlationId: requestContext?.correlationId,
        callId: requestContext?.callId,
        parentCallId: requestContext?.parentCallId,
      })
      return { mutation: { changesetId: result.commit.changesetId } }
    },

  }
}

function readDotPath(root: JsonObject, path: string): { found: true; value: JsonValue } | { found: false } {
  let current: JsonValue = root
  for (const segment of path.split('.')) {
    if (typeof current !== 'object' || current === null || Array.isArray(current) || !(segment in current)) {
      return { found: false }
    }
    current = current[segment]!
  }
  return { found: true, value: current }
}

function promptResourceWriteContext(requestContext: RuntimeRequestContext | undefined) {
  return {
    actor: requestContext?.actor ?? (requestContext?.clientId
      ? { kind: 'client' as const, id: requestContext.clientId }
      : applicationActor),
    correlationId: requestContext?.correlationId,
    callId: requestContext?.callId,
    parentCallId: requestContext?.parentCallId,
  }
}

function createEmptyPromptResourceContent(
  createId: (prefix: string) => string,
  name: string,
  resourceKind: PromptResourceContent['resourceKind'],
  timestamp: string,
): PromptResourceContent {
  const rootNode: PromptResourceContent['rootNode'] = {
    id: createId('prompt-node'),
    label: name.trim(),
    meta: resourceKind === 'preset' ? 'Composition Preset' : resourceKind === 'setting' ? 'Setting Layer' : 'Prompt Resource',
    category: resourceKind === 'history' || resourceKind === 'runtime' || resourceKind === 'prompt' ? undefined : resourceKind,
    kind: 'module',
    body: '',
    ...(resourceKind === 'preset' ? {
      children: [{
        id: createId('prompt-node'),
        label: '主排序',
        meta: 'Projection Order Profile',
        category: 'preset' as const,
        kind: 'order' as const,
        body: '',
        skeletonPatch: {
          zones: defaultCompositionSkeleton.zones.map(zone => ({ ...zone })),
          items: defaultCompositionSkeleton.items.map(item => ({ ...item })),
          fallbackZoneId: defaultCompositionSkeleton.fallbackZoneId,
        },
        orderList: [],
        slotRanks: [],
      }],
    } : {}),
  }
  return {
    resourceKind,
    rootNode,
    ...(resourceKind === 'preset' ? { historyPolicy: 'persistent' as const } : {}),
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

function clonePromptResourceContent(
  source: PromptResourceContent & { id: string; version: number },
  createId: (prefix: string) => string,
  name?: string,
): PromptResourceContent {
  const rootNode = clonePromptResourceNode(source.rootNode, createId)
  if (name?.trim()) rootNode.label = name.trim()
  return {
    ...source,
    rootNode,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  }
}

function clonePromptResourceNode(
  node: PromptResourceContent['rootNode'],
  createId: (prefix: string) => string,
): PromptResourceContent['rootNode'] {
  return {
    ...node,
    id: createId('prompt-node'),
    ...(node.children ? { children: node.children.map(child => clonePromptResourceNode(child, createId)) } : {}),
  }
}

function findPromptNode(
  root: PromptResourceContent['rootNode'],
  id: string,
  parentId?: string,
): { node: PromptResourceContent['rootNode']; parentId?: string; index: number } | undefined {
  if (root.id === id) return { node: root, parentId, index: 0 }
  for (const [index, child] of (root.children ?? []).entries()) {
    if (child.id === id) return { node: child, parentId: root.id, index }
    const found = findPromptNode(child, id, root.id)
    if (found) return found
  }
  return undefined
}

function resolveAssetPlacement(
  root: PromptResourceContent['rootNode'],
  targetId: string,
  position: 'before' | 'inside' | 'after',
): { parentId: string; orderIndex: number } {
  const target = findPromptNode(root, targetId)
  if (!target) throw new Error(`Prompt asset target not found: ${targetId}`)
  if (position === 'inside') {
    if (target.node.kind !== 'module' && target.node.kind !== 'folder') throw new Error(`Prompt asset target cannot contain children: ${targetId}`)
    return { parentId: target.node.id, orderIndex: target.node.children?.length ?? 0 }
  }
  if (!target.parentId) throw new Error(`Prompt asset cannot be placed beside the root: ${targetId}`)
  return { parentId: target.parentId, orderIndex: target.index + (position === 'after' ? 1 : 0) }
}

function buildInsertionReorderMutations(
  root: PromptResourceContent['rootNode'],
  parentId: string,
  insertedIndex: number,
): PromptResourceMutation[] {
  const parent = findPromptNode(root, parentId)?.node
  if (!parent) return []
  return (parent.children ?? [])
    .filter((_, index) => index >= insertedIndex)
    .map((node, offset) => ({
      kind: 'node.move' as const,
      nodeId: node.id,
      parentId,
      orderIndex: insertedIndex + offset + 1,
    }))
}

function buildMoveMutations(
  root: PromptResourceContent['rootNode'],
  nodeId: string,
  placement: { parentId: string; orderIndex: number },
): PromptResourceMutation[] {
  const source = findPromptNode(root, nodeId)
  if (!source) throw new Error(`Prompt asset not found: ${nodeId}`)
  if (!source.parentId) throw new Error(`Prompt asset cannot be moved: ${nodeId}`)
  if (source.node.kind === 'module' || source.node.kind === 'order') throw new Error(`Prompt asset cannot be moved: ${nodeId}`)
  if (findPromptNode(source.node, placement.parentId)) throw new Error('Cannot move prompt asset inside its own subtree')

  const siblingLists = new Map<string, string[]>()
  const visit = (parent: PromptResourceContent['rootNode']): void => {
    siblingLists.set(parent.id, (parent.children ?? []).map(child => child.id))
    parent.children?.forEach(visit)
  }
  visit(root)
  const sourceSiblings = siblingLists.get(source.parentId) ?? []
  const destinationSiblings = siblingLists.get(placement.parentId) ?? []
  const nextSource = sourceSiblings.filter(id => id !== nodeId)
  const nextDestination = placement.parentId === source.parentId ? nextSource : destinationSiblings.filter(id => id !== nodeId)
  const insertAt = Math.max(0, Math.min(placement.orderIndex, nextDestination.length))
  nextDestination.splice(insertAt, 0, nodeId)
  siblingLists.set(source.parentId, nextSource)
  siblingLists.set(placement.parentId, nextDestination)

  const mutations: PromptResourceMutation[] = []
  for (const [parentId, desired] of siblingLists) {
    const currentParent = findPromptNode(root, parentId)?.node
    const current = (currentParent?.children ?? []).map(child => child.id)
    for (const [orderIndex, childId] of desired.entries()) {
      if (current[orderIndex] === childId && childId !== nodeId) continue
      if (childId === nodeId || current[orderIndex] !== childId) {
        mutations.push({ kind: 'node.move', nodeId: childId, parentId, orderIndex })
      }
    }
  }
  return mutations
}

async function updatePromptResourceAssets(input: {
  ctx: ApplicationRuntimeContext
  requestContext?: RuntimeRequestContext
  resourceId: string
  updates: Array<{
    assetId: string
    body?: string
    capabilities?: PromptResourceContent['rootNode']['capabilities']
    enabled?: boolean
    label?: string
    meta?: string
    orderList?: string[]
    skeletonPatch?: PromptResourceContent['rootNode']['skeletonPatch']
    slotRanks?: PromptResourceContent['rootNode']['slotRanks']
  }>
}): Promise<{ resource: PromptResourceContent & { id: string; version: number }; mutation: { changesetId: string } }> {
  const current = await input.ctx.promptResources.getResource(input.resourceId)
  if (!current) throw new Error(`Prompt resource not found: ${input.resourceId}`)
  const currentTree = fromStoredResource(current).rootNode
  const mutations: PromptResourceMutation[] = input.updates.map(update => ({
    kind: 'node.update',
    nodeId: update.assetId,
    patch: {
      ...(update.label === undefined ? {} : { label: update.label }),
      ...(update.body === undefined ? {} : { body: update.body }),
      ...(update.capabilities === undefined ? {} : { capabilities: update.capabilities }),
      ...(update.enabled === undefined ? {} : { enabled: update.enabled }),
      ...(update.meta === undefined ? {} : { meta: update.meta }),
      ...(update.orderList === undefined && update.skeletonPatch === undefined && update.slotRanks === undefined ? {} : {
        extra: {
          ...(findPromptNode(currentTree, update.assetId) ? (toStoredNodeDraft(findPromptNode(currentTree, update.assetId)!.node).extra ?? {}) : {}),
          ...(update.orderList === undefined ? {} : { orderList: update.orderList }),
          ...(update.skeletonPatch === undefined ? {} : { skeletonPatch: update.skeletonPatch }),
          ...(update.slotRanks === undefined ? {} : { slotRanks: update.slotRanks }),
        },
      }),
    },
  }))
  const result = await input.ctx.promptResources.mutateResource({
    ...promptResourceWriteContext(input.requestContext),
    reason: 'application.updatePromptResourceAssets',
    resourceId: input.resourceId,
    expectedVersion: current.version,
    mutations,
  })
  return {
    resource: fromStoredResource(result.resource),
    mutation: { changesetId: result.commit.changesetId },
  }
}



async function prepareAgentTurn(
  ctx: ApplicationRuntimeContext,
  input: {
    agentSessionId: string
    input: string
    activationFacts?: ActivationFacts
    narrativeTarget?: { timelineId: string; branchId?: string; commit: boolean }
  },
  mode: 'preview' | 'runtime',
  requestContext?: RuntimeRequestContext,
) {
  if (input.input.trim().length === 0) throw new Error('Agent turn input cannot be empty')
  if (!ctx.agents) throw new Error('Agent Store is not configured')
  const session = await ctx.agents.getSession(input.agentSessionId)
  if (!session) throw new Error(`Agent session not found: ${input.agentSessionId}`)
  const narratives = input.narrativeTarget ? ctx.narratives : undefined
  if (input.narrativeTarget && !narratives) throw new Error('Narrative Store is not configured')
  // ponytail: M0 projects only the latest 100 records; add an explicit context-window policy before larger histories need summarization.
  const narrativePage = input.narrativeTarget
    ? await narratives!.getPage({
        timelineId: input.narrativeTarget.timelineId,
        branchId: input.narrativeTarget.branchId,
        limit: 100,
      })
    : undefined
  const agentPage = await ctx.agents.getEntryPage({ agentSessionId: session.id, limit: 100 })
  const agentProfile = await readDocument<AgentProfileContent>(ctx.documents, session.agentProfileId, applicationDocumentTypes.agentProfile)
  const preset = await readPresetResource(ctx.promptResources, agentProfile.content.presetId)
  const toolMounts = await ctx.promptResources.listPresetToolMounts({ presetResourceId: preset.id })
  const runId = ctx.createId('run')
  const buildId = ctx.createId('build')
  const startedAt = performance.now()
  const references = {
    buildId,
    mode,
    agentSessionId: session.id,
    runId,
    ...(narrativePage ? {
      timelineId: narrativePage.timeline.id,
      branchId: narrativePage.branch.id,
    } : {}),
  }
  const logContext = {
    ...(requestContext?.correlationId ? { correlationId: requestContext.correlationId } : {}),
    ...(requestContext?.callId ? { callId: requestContext.callId } : {}),
    ...(requestContext?.parentCallId ? { parentCallId: requestContext.parentCallId } : {}),
  }
  ctx.logger?.info(`${mode} prompt build started`, {
    event: 'prompt.build.started',
    data: references,
    ...logContext,
  })
  let prompt
  let compiledToolSet
  const timelineState = narrativePage
    ? await getApplicationStateSnapshot(ctx, {
        scope: 'timeline',
        timelineId: narrativePage.timeline.id,
        branchId: narrativePage.branch.id,
      })
    : undefined
  const timelineRuntimeContext = narrativePage
    ? await readTimelineRuntimeContext(ctx, narrativePage.timeline.id)
    : undefined
  const variables = await readAgentTurnVariables(
    ctx,
    timelineRuntimeContext?.fallbackUserName
      ?? await readLegacyCardUserName(ctx, narrativePage?.timeline.createdFrom?.cardId),
    timelineState?.value,
  )
  try {
    const textRules = (await listDocuments<TextTransformRuleContent>(ctx.documents, applicationDocumentTypes.textTransformRule)).map(document => toVersioned(document))
    const globalAndExtensionRules = textRules.filter(rule => rule.owner.kind === 'workspace' || rule.owner.kind === 'extension' || rule.owner.kind === 'user-override')
    const presetRules = textRules.filter(rule => rule.owner.kind === 'preset' && rule.owner.presetId === preset.id)
    const cardRules = timelineRuntimeContext?.textTransformRules ?? (narrativePage?.timeline.createdFrom?.cardId
      ? textRules.filter(rule => rule.owner.kind === 'card' && rule.owner.cardId === narrativePage.timeline.createdFrom!.cardId)
      : [])
    compiledToolSet = await compileAgentToolSet({
      ctx,
      model: agentProfile.content.model,
      toolMounts,
      toolOverrides: agentProfile.content.toolOverrides ?? {},
      variables,
      currentInput: input.input,
      activationFacts: input.activationFacts,
    })
    prompt = await composeAgentTurnPrompt({
      activationFacts: input.activationFacts,
      variables,
      agentMessages: (preset.historyPolicy ?? 'persistent') === 'persistent'
        ? agentPage.entries
        : [],
        promptResources: ctx.promptResources,
      narrative: narrativePage ? { nodes: narrativePage.nodes, timeline: narrativePage.timeline, branchId: narrativePage.branch.id } : undefined,
      preset,
      userInput: input.input,
      buildId,
      runId,
      agentSessionId: session.id,
      historyRules: {
        session: [...globalAndExtensionRules, ...presetRules],
        narrative: [...globalAndExtensionRules, ...presetRules, ...cardRules],
      },
      externalRuntime: createContentToolPromptRuntimeInputs(compiledToolSet),
    })
    const allowedTimelineTarget = narrativePage
      ? { scope: 'timeline' as const, timelineId: narrativePage.timeline.id, branchId: narrativePage.branch.id }
      : undefined
    prompt.toolExecutionScope.state = {
      canAccess: target => target.scope === 'global'
        || (allowedTimelineTarget !== undefined
          && target.timelineId === allowedTimelineTarget.timelineId
          && target.branchId === allowedTimelineTarget.branchId),
      read: async target => {
        const snapshot = await getApplicationStateSnapshot(ctx, target)
        return { revisionId: snapshot.revisionId, value: snapshot.value }
      },
      update: async stateInput => {
        const result = await applyApplicationStateMutation(ctx, {
          target: stateInput.target,
          expectedRevisionId: stateInput.expectedRevisionId,
          operations: stateInput.operations as unknown as StateMutationOperation[],
          idempotencyKey: stateInput.idempotencyKey,
        }, requestContext)
        return { revisionId: result.snapshot.revisionId }
      },
    }
    const durationMs = readDurationMs(startedAt)
    ctx.logger?.info(`${mode} prompt build completed · ${prompt.messages.length} messages · ${durationMs} ms`, {
      event: 'prompt.build.completed',
      data: { ...references, messageCount: prompt.messages.length, durationMs },
      ...logContext,
    })
  } catch (error) {
    const durationMs = readDurationMs(startedAt)
    ctx.logger?.error(`${mode} prompt build failed after ${durationMs} ms`, {
      event: 'prompt.build.failed',
      data: {
        ...references,
        durationMs,
        failureType: error instanceof Error ? error.name : 'UnknownError',
      },
      ...logContext,
    })
    throw error
  }
  return {
    agentProfile,
    model: agentProfile.content.model,
    narrativePage,
    narratives,
    prompt,
    variables,
    compiledToolSet,
    agentStepMessages: prompt.messages,
    runId,
    session,
  }
}

async function readAgentTurnVariables(
  ctx: ApplicationRuntimeContext,
  fallbackUserName: string | undefined,
  timeline?: JsonObject,
): Promise<VariableRenderContext> {
  const globalSnapshot = await ctx.states.getGlobalSnapshot()
  const global = structuredClone(globalSnapshot?.revision.snapshot ?? {})
  const fallbackUser = fallbackUserName?.trim() || 'User'
  const user = global.user
  if (!user || typeof user !== 'object' || Array.isArray(user)) {
    global.user = { name: fallbackUser }
  } else if (typeof user.name !== 'string' || user.name.trim().length === 0) {
    user.name = fallbackUser
  }
  return createVariableRenderContext({
    global,
    ...(timeline ? { timeline } : {}),
    computed: {
      global: {
        time: { now: ctx.now() },
      },
    },
  })
}

async function readLegacyCardUserName(
  ctx: ApplicationRuntimeContext,
  cardId: string | undefined,
): Promise<string | undefined> {
  if (!cardId) return undefined
  const card = await readDocument<CardSourceContent>(ctx.documents, cardId, applicationDocumentTypes.cardSource)
  return card.content.userName
}

async function buildTimelineRuntimeContext(
  ctx: ApplicationRuntimeContext,
  input: {
    timelineId: string
    card: DocumentRecord<CardSourceContent>
    cardContent: CardSourceContent
    templates: Map<string, Extract<StateDefinitionDraft, { kind: 'timeline-template' }>>
  },
): Promise<TimelineRuntimeContextContent> {
  const textTransformRules = (await listDocuments<TextTransformRuleContent>(ctx.documents, applicationDocumentTypes.textTransformRule))
    .filter(rule => rule.content.owner.kind === 'card' && rule.content.owner.cardId === input.card.id)
    .map(rule => toVersioned(rule))
  return {
    timelineId: input.timelineId,
    sourceCardId: input.card.id,
    sourceCardVersion: input.card.version,
    fallbackUserName: input.cardContent.userName?.trim() || 'User',
    stateBindings: (input.cardContent.timelineStateBindings ?? []).map(binding => {
      const template = input.templates.get(binding.templateId)
      if (!template) throw new Error(`Timeline State template not found: ${binding.templateId}`)
      return { path: binding.path, schema: structuredClone(template.schema) }
    }),
    textTransformRules,
    createdAt: ctx.now(),
  }
}

async function listAllCardTimelines(
  ctx: ApplicationRuntimeContext,
  cardId: string,
) {
  const timelines: NarrativeTimeline[] = []
  let cursor: string | undefined
  do {
    const page = await ctx.narratives!.listTimelines({ createdFromCardId: cardId, ...(cursor ? { cursor } : {}), limit: 100 })
    timelines.push(...page.timelines)
    cursor = page.nextCursor
  } while (cursor)
  return timelines
}

async function readPresetResource(
  promptResources: ApplicationRuntimeContext['promptResources'],
  presetId: string,
): Promise<PromptResourceContent & { id: string; version: number }> {
  const preset = await readMappedResource(promptResources, presetId)
  if (preset.resourceKind !== 'preset') throw new Error(`Prompt Resource is not a Preset: ${presetId}`)
  return preset
}

const builtInRenderers: RendererDefinition[] = [
  {
    id: 'official/json-artifact',
    name: 'JSON Artifact',
    artifactType: 'application/json',
    surface: 'shell.workspace-panel',
    instanceScope: 'workspace',
    fallback: 'json',
  },
]

async function projectRuntimeHistory(
  ctx: ApplicationRuntimeContext,
  source: HistorySource,
  phase: TextTransformPhase,
) {
  const entries = await readRuntimeHistoryEntries(ctx, source)
  const documents = await listDocuments<TextTransformRuleContent>(ctx.documents, applicationDocumentTypes.textTransformRule)
  const rules = documents.map(document => toVersioned(document))
  const activeRules = await filterRulesForSource(ctx, source, rules)
  return projectHistoryEntries({ source, phase, entries, rules: activeRules })
}

async function readRuntimeHistoryEntries(
  ctx: ApplicationRuntimeContext,
  source: HistorySource,
): Promise<HistoryTextEntry[]> {
  if (source.kind === 'agent-session') {
    const agents = ctx.agents
    if (!agents) throw new Error('Agent Store is not configured')
    let cursor = source.headEntryId
    const entries: AgentTranscriptEntry[] = []
    do {
      const page = await agents.getEntryPage({ agentSessionId: source.sessionId, ...(cursor ? { cursor } : {}), limit: 100 })
      entries.unshift(...page.entries)
      cursor = page.nextCursor
    } while (cursor)
    return entries.flatMap(entry => entry.entry.kind === 'message'
      ? [{ id: entry.id, source, role: entry.entry.role, text: entry.entry.content, sequence: entry.sequence, createdAt: entry.createdAt }]
      : [])
  }
  const narratives = ctx.narratives
  if (!narratives) throw new Error('Narrative Store is not configured')
  let cursor: string | undefined
  const nodes: import('@loom-studio/narrative-store').NarrativeNode[] = []
  do {
    const page = await narratives.getPage({ timelineId: source.timelineId, branchId: source.branchId, ...(cursor ? { cursor } : {}), limit: 100 })
    nodes.unshift(...page.nodes)
    cursor = page.nextCursor
  } while (cursor)
  return nodes.map((node, sequence) => ({
    id: node.id,
    source,
    text: node.body.raw,
    sequence: sequence + 1,
    createdAt: node.createdAt,
  }))
}

async function filterRulesForSource(
  ctx: ApplicationRuntimeContext,
  source: HistorySource,
  rules: TextTransformRuleEntry[],
): Promise<TextTransformRuleEntry[]> {
  let presetId: string | undefined
  let cardId: string | undefined
  let snapshotRules: TextTransformRuleEntry[] = []
  let hasTimelineRuntimeContext = false
  if (source.kind === 'agent-session') {
    const session = await ctx.agents?.getSession(source.sessionId)
    if (!session) throw new Error(`Agent Session not found: ${source.sessionId}`)
    const profile = await readDocument<AgentProfileContent>(ctx.documents, session.agentProfileId, applicationDocumentTypes.agentProfile)
    presetId = profile.content.presetId
  } else {
    const timeline = await ctx.narratives?.getTimeline(source.timelineId)
    if (!timeline) throw new Error(`Narrative Timeline not found: ${source.timelineId}`)
    cardId = timeline.createdFrom?.cardId
    const runtimeContext = await readTimelineRuntimeContext(ctx, source.timelineId)
    hasTimelineRuntimeContext = Boolean(runtimeContext)
    snapshotRules = runtimeContext?.textTransformRules ?? []
  }
  const active = rules.filter(rule => {
    if (rule.owner.kind === 'preset') return rule.owner.presetId === presetId
    if (rule.owner.kind === 'card') return !hasTimelineRuntimeContext && rule.owner.cardId === cardId
    return true
  })
  return [...active, ...snapshotRules]
}

function assertExpectedDocumentVersion(
  existing: DocumentRecord | null,
  expectedVersion: number | undefined,
  expectedType: string,
  label: string,
  id: string,
): void {
  if (existing && existing.type !== expectedType) throw new Error(`Unexpected document type for ${id}: ${existing.type}`)
  if (existing && expectedVersion === undefined) throw new Error(`expectedVersion is required when updating ${label}: ${id}`)
  if (existing && existing.version !== expectedVersion) throw new Error(`${label} version conflict: ${id}`)
  if (!existing && expectedVersion !== undefined) throw new Error(`${label} does not exist: ${id}`)
}

function portableExtensionPayloadFields(
  payload: PortableExtensionPayloadArtifact,
): Omit<PortableExtensionPayloadArtifact, 'id'> {
  return {
    packageId: payload.packageId,
    fileName: payload.fileName,
    format: payload.format,
    mediaType: payload.mediaType,
    ...(payload.schemaVersion !== undefined ? { schemaVersion: payload.schemaVersion } : {}),
    ...(payload.requirement !== undefined ? { requirement: structuredClone(payload.requirement) } : {}),
    ...(payload.metadata !== undefined ? { metadata: structuredClone(payload.metadata) } : {}),
    content: payload.content,
  }
}

function toPortableExtensionPayloadEntry(
  document: DocumentRecord<PortableExtensionPayloadContent>,
): PortableExtensionPayloadEntry {
  return {
    id: document.id,
    artifactPayloadId: document.content.artifactPayloadId,
    ...portableExtensionPayloadFields({
      id: document.content.artifactPayloadId,
      packageId: document.content.packageId,
      fileName: document.content.fileName,
      format: document.content.format,
      mediaType: document.content.mediaType,
      ...(document.content.schemaVersion !== undefined ? { schemaVersion: document.content.schemaVersion } : {}),
      ...(document.content.requirement !== undefined ? { requirement: document.content.requirement } : {}),
      ...(document.content.metadata !== undefined ? { metadata: document.content.metadata } : {}),
      content: document.content.content,
    }),
    version: document.version,
    createdAt: document.content.createdAt,
    updatedAt: document.content.updatedAt,
  }
}

type ApplicationExtensionRecordContent = {
  scope: ExtensionStorageScope
  recordType: string
  data: JsonValue
  bindings: ExtensionEntityRef[]
  createdAt: string
  updatedAt: string
}

async function listApplicationExtensionRecords(
  documents: DocumentTransaction,
  input: { packageId: string; scope?: ExtensionStorageScope; recordType?: string; binding?: ExtensionEntityRef },
): Promise<ExtensionRecordEntry[]> {
  const records: ExtensionRecordEntry[] = []
  let cursor: string | undefined
  do {
    const page = await documents.list({
      type: applicationDocumentTypes.extensionRecord,
      ownerExtensionId: input.packageId,
      cursor,
      limit: 100,
    })
    for (const document of page.items) {
      const record = toApplicationExtensionRecord(input.packageId, document)
      if (input.scope && !sameExtensionStorageScope(record.scope, input.scope)) continue
      if (input.recordType && record.recordType !== input.recordType) continue
      if (input.binding && !record.bindings.some(binding => sameExtensionEntityRef(binding, input.binding!))) continue
      records.push(record)
    }
    cursor = page.nextCursor
  } while (cursor)
  return records.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
}

async function getApplicationExtensionRecord(
  documents: DocumentTransaction,
  packageId: string,
  recordId: string,
): Promise<ExtensionRecordEntry | null> {
  const document = await documents.get(recordId)
  if (!document) return null
  if (document.type !== applicationDocumentTypes.extensionRecord || document.meta.ownerExtensionId !== packageId) {
    throw new Error(`Extension Record is not owned by package ${packageId}: ${recordId}`)
  }
  return toApplicationExtensionRecord(packageId, document)
}

function toApplicationExtensionRecord(packageId: string, document: DocumentRecord): ExtensionRecordEntry {
  if (!isObject(document.content)) throw new Error(`Extension Record content must be an object: ${document.id}`)
  const content = document.content as unknown as Partial<ApplicationExtensionRecordContent>
  if (!isExtensionStorageScope(content.scope) || typeof content.recordType !== 'string' || !content.recordType) {
    throw new Error(`Extension Record content is invalid: ${document.id}`)
  }
  if (!Array.isArray(content.bindings) || !content.bindings.every(isExtensionEntityRef)) {
    throw new Error(`Extension Record bindings are invalid: ${document.id}`)
  }
  if (typeof content.createdAt !== 'string' || typeof content.updatedAt !== 'string' || content.data === undefined) {
    throw new Error(`Extension Record metadata is invalid: ${document.id}`)
  }
  return {
    id: document.id,
    packageId,
    scope: structuredClone(content.scope),
    recordType: content.recordType,
    data: structuredClone(content.data),
    bindings: structuredClone(content.bindings),
    version: document.version,
    createdAt: content.createdAt,
    updatedAt: content.updatedAt,
  }
}

function isExtensionStorageScope(value: unknown): value is ExtensionStorageScope {
  return isObject(value) && (
    value.kind === 'global'
    || (value.kind === 'card' && typeof value.cardId === 'string' && Boolean(value.cardId))
    || (value.kind === 'timeline' && typeof value.timelineId === 'string' && Boolean(value.timelineId))
    || (value.kind === 'agent-session' && typeof value.agentSessionId === 'string' && Boolean(value.agentSessionId))
  )
}

function isExtensionEntityRef(value: unknown): value is ExtensionEntityRef {
  return isObject(value) && (
    (value.kind === 'narrative-node' && typeof value.timelineId === 'string' && typeof value.nodeId === 'string')
    || (value.kind === 'agent-message' && typeof value.agentSessionId === 'string' && typeof value.messageId === 'string')
    || (value.kind === 'asset' && typeof value.assetId === 'string')
    || (value.kind === 'state-path' && typeof value.timelineId === 'string' && typeof value.path === 'string')
  )
}

function sameExtensionStorageScope(left: ExtensionStorageScope, right: ExtensionStorageScope): boolean {
  if (left.kind !== right.kind) return false
  if (left.kind === 'global') return true
  if (left.kind === 'card' && right.kind === 'card') return left.cardId === right.cardId
  if (left.kind === 'timeline' && right.kind === 'timeline') return left.timelineId === right.timelineId
  return left.kind === 'agent-session' && right.kind === 'agent-session' && left.agentSessionId === right.agentSessionId
}

function sameExtensionEntityRef(left: ExtensionEntityRef, right: ExtensionEntityRef): boolean {
  if (left.kind !== right.kind) return false
  if (left.kind === 'narrative-node' && right.kind === 'narrative-node') return left.timelineId === right.timelineId && left.nodeId === right.nodeId
  if (left.kind === 'agent-message' && right.kind === 'agent-message') return left.agentSessionId === right.agentSessionId && left.messageId === right.messageId
  if (left.kind === 'asset' && right.kind === 'asset') return left.assetId === right.assetId
  return left.kind === 'state-path' && right.kind === 'state-path' && left.timelineId === right.timelineId && left.path === right.path
}

async function findTimelinePromptResourceReferences(
  ctx: ApplicationRuntimeContext,
  resourceId: string,
): Promise<Array<{ id: string; promptResourceIds: string[] }>> {
  if (!ctx.narratives) return []
  const references: Array<{ id: string; promptResourceIds: string[] }> = []
  let cursor: string | undefined
  do {
    const page = await ctx.narratives.listTimelines({ cursor, limit: 100 })
    references.push(...page.timelines
      .filter(item => item.promptResourceIds.includes(resourceId))
      .map(item => ({ id: item.id, promptResourceIds: item.promptResourceIds })))
    cursor = page.nextCursor
  } while (cursor)
  return references
}

function readDurationMs(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 100) / 100
}

function parseCardBundleSource(source: string): CardBundleArtifact {
  if (new TextEncoder().encode(source).byteLength > 16 * 1024 * 1024) {
    throw new Error('Card bundle source exceeds 16 MiB')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    throw new Error('Card bundle source must be valid JSON')
  }
  if (!isCardBundleArtifact(parsed as JsonValue)) throw new Error('Card bundle source does not contain a valid CardBundleArtifact')
  return parsed as CardBundleArtifact
}

async function assertCardMedia(
  ctx: ApplicationRuntimeContext,
  media: CardMediaRefs | undefined,
): Promise<void> {
  const assetIds = [...new Set([media?.avatarAssetId, media?.coverAssetId].filter((value): value is string => Boolean(value)))]
  if (assetIds.length === 0) return
  if (!ctx.mediaAssets) throw new Error('Media Asset Store is not configured')
  for (const assetId of assetIds) {
    if (!await ctx.mediaAssets.get(assetId)) throw new Error(`Media Asset not found: ${assetId}`)
  }
}

function normalizeModelIds(modelIds: string[] | undefined): string[] {
  const normalized = [...new Set((modelIds ?? []).map(modelId => modelId.trim()).filter(Boolean))]
  if (normalized.length > 500) throw new Error('Provider Profile enabledModelIds exceeds 500 entries')
  return normalized
}

function normalizeProviderModelIds(providerExtensionId: string, modelIds: string[] | undefined): string[] {
  return isOfficialFakeProvider(providerExtensionId)
    ? [officialFakeModelId]
    : normalizeModelIds(modelIds)
}

async function initializeOfficialFakeProviderProfiles(ctx: ApplicationRuntimeContext): Promise<void> {
  const profiles = await listDocuments<ProviderProfileContent>(ctx.documents, applicationDocumentTypes.providerProfile)
  const providerProfileIds = new Set<string>()
  for (const profile of profiles) {
    if (!isOfficialFakeProvider(profile.content.providerExtensionId)) continue
    providerProfileIds.add(profile.id)
    const config = ctx.providerAdapters.validateAccountConfig(profile.content.providerExtensionId, profile.content.config)
    const enabledModelIds = [officialFakeModelId]
    if (
      JSON.stringify(config) === JSON.stringify(profile.content.config)
      && enabledModelIds.length === profile.content.enabledModelIds.length
    ) continue
    await writeDocument<ProviderProfileContent>(ctx.documents, {
      id: profile.id,
      type: applicationDocumentTypes.providerProfile,
      content: {
        ...profile.content,
        config,
        enabledModelIds,
        updatedAt: ctx.now(),
      },
      expectedVersion: profile.version,
    })
  }

  const capabilityProfiles = await listDocuments<AiCapabilityProfileContent>(
    ctx.documents,
    applicationDocumentTypes.aiCapabilityProfile,
  )
  for (const profile of capabilityProfiles) {
    if (!providerProfileIds.has(profile.content.providerProfileId)) continue
    const capabilityId = profile.content.capabilityId === 'text.generate'
      ? 'chat.completions'
      : profile.content.capabilityId
    if (capabilityId === profile.content.capabilityId && Object.keys(profile.content.config).length === 0) continue
    await writeDocument<AiCapabilityProfileContent>(ctx.documents, {
      id: profile.id,
      type: applicationDocumentTypes.aiCapabilityProfile,
      content: {
        ...profile.content,
        capabilityId,
        config: {},
        updatedAt: ctx.now(),
      },
      expectedVersion: profile.version,
    })
  }
}

function isOfficialFakeProvider(providerExtensionId: string): boolean {
  return providerExtensionId === 'official.fake' || providerExtensionId === 'fake'
}

function readMessageEntryContent(entry: AgentTranscriptEntry, role: 'user' | 'assistant'): string {
  if (entry.entry.kind !== 'message' || entry.entry.role !== role) {
    throw new Error(`Expected ${role} message entry: ${entry.id}`)
  }
  return entry.entry.content
}

function normalizeToolOverrides(overrides: Record<string, boolean> | undefined): Record<string, boolean> {
  const normalized: Record<string, boolean> = {}
  for (const [toolId, enabled] of Object.entries(overrides ?? {})) {
    const normalizedToolId = toolId.trim()
    if (!normalizedToolId) throw new Error('Agent Profile Tool override id cannot be empty')
    if (typeof enabled !== 'boolean') throw new Error(`Agent Profile Tool override must be boolean: ${normalizedToolId}`)
    normalized[normalizedToolId] = enabled
  }
  if (Object.keys(normalized).length > 200) throw new Error('Agent Profile toolOverrides exceeds 200 entries')
  return normalized
}

function assertResolvedTools(ctx: ApplicationRuntimeContext, toolIds: string[]): void {
  const error = ctx.agentTools.resolve(toolIds).diagnostics.find(diagnostic => diagnostic.severity === 'error')
  if (error) throw new Error(error.message)
}

function toAgentProfileEntry(document: DocumentRecord<AgentProfileContent>) {
  return {
    ...toVersioned(document),
    toolOverrides: { ...(document.content.toolOverrides ?? {}) },
  }
}

function toAgentToolContent(
  definition: ToolDefinition,
  createdAt: string,
  updatedAt = createdAt,
  origin?: AgentToolContent['origin'],
): AgentToolContent {
  return {
    owner: structuredClone(definition.owner),
    name: definition.name,
    description: definition.description,
    input: structuredClone(definition.input),
    ...(definition.prompt ? { prompt: structuredClone(definition.prompt) } : {}),
    ...(origin ? { origin: structuredClone(origin) } : {}),
    createdAt,
    updatedAt,
  }
}

function toAgentToolEntry(
  document: DocumentRecord<AgentToolContent>,
): AgentToolEntry {
  const { createdAt, updatedAt, origin, ...definition } = document.content
  return {
    id: document.id,
    version: document.version,
    ...structuredClone(definition),
    ...(origin ? { origin: structuredClone(origin) } : {}),
    createdAt,
    updatedAt,
  }
}

async function importExtensionPackageResources(
  ctx: ApplicationRuntimeContext,
  input: ImportExtensionPackageResourcesInput,
  requestContext: RuntimeRequestContext | undefined,
  documentParticipant: SqliteDocumentStore,
): Promise<ImportExtensionPackageResourcesResult> {
  assertNonEmpty(input.packageId, 'packageId')
  assertNonEmpty(input.packageVersion, 'packageVersion')
  const timestamp = ctx.now()
  const origin = (contributionId: string) => ({
    kind: 'extension-package' as const,
    packageId: input.packageId,
    packageVersion: input.packageVersion,
    contributionId,
  })

  const promptContributions = new Map(input.promptResources.map(item => [item.contribution.id, item]))
  if (promptContributions.size !== input.promptResources.length) throw new Error('Extension Prompt Resource contribution ids must be unique')
  const agentToolDefinitions = new Map<string, ToolDefinition>()
  for (const item of input.agentTools) {
    if (agentToolDefinitions.has(item.contribution.id)) throw new Error(`Extension Agent Tool contribution is duplicated: ${item.contribution.id}`)
    agentToolDefinitions.set(item.contribution.id, readExtensionAgentToolDefinition(input.packageId, item.contribution.id, item.definition))
  }

  const promptArtifacts = new Map<string, PromptResourceArtifact>()
  const nodeIds = new Set<string>()
  for (const item of input.promptResources) {
    if (!isPromptResourceArtifact(item.artifact)) throw new Error(`Extension Prompt Resource artifact is invalid: ${item.contribution.id}`)
    if (item.artifact.resourceKind !== item.contribution.resourceKind) {
      throw new Error(`Extension Prompt Resource kind does not match its manifest: ${item.contribution.id}`)
    }
    validateExtensionPromptNodeIds(input.packageId, item.artifact.rootNode, nodeIds)
    promptArtifacts.set(item.contribution.id, structuredClone(item.artifact))
    for (const mount of item.contribution.settingMounts ?? []) {
      const target = promptContributions.get(mount.resourceId)
      if (!target || target.contribution.resourceKind !== 'setting') throw new Error(`Extension Preset Setting mount is unresolved: ${mount.resourceId}`)
    }
    for (const mount of item.contribution.toolMounts ?? []) {
      const definition = agentToolDefinitions.get(mount.toolId)
      if (!definition) throw new Error(`Extension Preset Tool mount is unresolved: ${mount.toolId}`)
      if (mount.activation !== undefined && !isPromptActivation(mount.activation)) throw new Error(`Extension Preset Tool activation is invalid: ${mount.toolId}`)
      if (definition.input.kind === 'structured' && mount.content !== undefined) throw new Error(`Structured Tool cannot use Content placement: ${mount.toolId}`)
    }
  }

  const existingPromptResources = await listMappedResources(ctx.promptResources, undefined, { includeTombstone: true })
  const promptResourceIds = new Map<string, string>()
  const restorablePromptResourceVersions = new Map<string, number>()
  for (const resource of existingPromptResources) {
    const resourceOrigin = resource.origin
    if (resourceOrigin?.kind !== 'extension-package' || resourceOrigin.packageId !== input.packageId) continue
    if (resourceOrigin.packageVersion !== input.packageVersion) {
      throw new Error(`Extension Prompt Resource update requires an explicit migration: ${resourceOrigin.contributionId}`)
    }
    if (!promptContributions.has(resourceOrigin.contributionId)) continue
    if (promptResourceIds.has(resourceOrigin.contributionId)) throw new Error(`Extension Prompt Resource origin is duplicated: ${resourceOrigin.contributionId}`)
    promptResourceIds.set(resourceOrigin.contributionId, resource.id)
    if (resource.tombstoned) restorablePromptResourceVersions.set(resourceOrigin.contributionId, resource.version)
  }

  for (const tool of await listAgentToolEntries(ctx)) {
    if (tool.origin?.kind !== 'extension-package' || tool.origin.packageId !== input.packageId) continue
    if (tool.origin.packageVersion !== input.packageVersion) {
      throw new Error(`Extension Agent Tool update requires an explicit migration: ${tool.origin.contributionId}`)
    }
  }

  const existingAgentTools = new Set<string>()
  const restorableAgentToolVersions = new Map<string, number>()
  for (const [toolId] of agentToolDefinitions) {
    const document = await ctx.documents.get(toolId, { includeTombstone: true })
    if (!document) continue
    if (document.type !== applicationDocumentTypes.agentTool) throw new Error(`Extension Agent Tool id conflicts with another Document: ${toolId}`)
    const content = document.content as AgentToolContent
    if (content.origin?.kind !== 'extension-package' || content.origin.packageId !== input.packageId || content.origin.contributionId !== toolId) {
      throw new Error(`Extension Agent Tool id is already owned by another source: ${toolId}`)
    }
    if (content.origin.packageVersion !== input.packageVersion) {
      throw new Error(`Extension Agent Tool update requires an explicit migration: ${toolId}`)
    }
    if (document.meta.tombstone) {
      restorableAgentToolVersions.set(toolId, document.version)
      continue
    }
    existingAgentTools.add(toolId)
  }

  const missingPromptResources = input.promptResources.filter(item => !promptResourceIds.has(item.contribution.id) || restorablePromptResourceVersions.has(item.contribution.id))
  const missingAgentTools = input.agentTools.filter(item => !existingAgentTools.has(item.contribution.id))
  if (missingPromptResources.length === 0 && missingAgentTools.length === 0) {
    return {
      promptResources: input.promptResources.map(item => ({
        contributionId: item.contribution.id,
        resourceId: promptResourceIds.get(item.contribution.id)!,
        resourceKind: item.contribution.resourceKind,
      })),
      agentTools: input.agentTools.map(item => ({ contributionId: item.contribution.id, toolId: item.contribution.id })),
    }
  }

  const transaction = await ctx.dataEngine.transact({
    ...promptResourceWriteContext(requestContext),
    reason: 'application.importExtensionPackageResources',
  }, async dataTx => {
    const resourceTx = ctx.promptResources.transaction(dataTx)
    return documentParticipant.participateTransaction(dataTx, async documents => {
      const newlyCreatedPromptIds = new Set<string>()
      for (const item of missingPromptResources) {
        const artifact = promptArtifacts.get(item.contribution.id)!
        const restorableVersion = restorablePromptResourceVersions.get(item.contribution.id)
        const resourceId = promptResourceIds.get(item.contribution.id) ?? ctx.createId('prompt-resource')
        if (restorableVersion === undefined) {
          resourceTx.createResource(toStoredResourceInput({
            id: resourceId,
            content: {
              resourceKind: artifact.resourceKind,
              rootNode: structuredClone(artifact.rootNode),
              ...(artifact.resourceKind === 'preset' ? { historyPolicy: 'persistent' as const } : {}),
              origin: origin(item.contribution.id),
              createdAt: timestamp,
              updatedAt: timestamp,
            },
          }))
        } else {
          resourceTx.restoreResource({ resourceId, expectedVersion: restorableVersion })
        }
        promptResourceIds.set(item.contribution.id, resourceId)
        newlyCreatedPromptIds.add(item.contribution.id)
      }
      for (const item of missingAgentTools) {
        const definition = agentToolDefinitions.get(item.contribution.id)!
        await writeDocument<AgentToolContent>(documents, {
          id: definition.id,
          type: applicationDocumentTypes.agentTool,
          content: toAgentToolContent(definition, timestamp, timestamp, origin(item.contribution.id)),
          expectedVersion: restorableAgentToolVersions.get(definition.id) ?? 'new',
        })
      }
      for (const item of input.promptResources) {
        if (!newlyCreatedPromptIds.has(item.contribution.id) || item.contribution.resourceKind !== 'preset') continue
        const presetResourceId = promptResourceIds.get(item.contribution.id)!
        for (const [orderIndex, mount] of (item.contribution.settingMounts ?? []).entries()) {
          resourceTx.addSettingMount({
            source: { kind: 'preset', id: presetResourceId },
            settingResourceId: promptResourceIds.get(mount.resourceId)!,
            orderIndex: mount.orderIndex ?? orderIndex,
            origin: origin(item.contribution.id),
          })
        }
        for (const [orderIndex, mount] of (item.contribution.toolMounts ?? []).entries()) {
          resourceTx.addPresetToolMount({
            presetResourceId,
            toolId: mount.toolId,
            orderIndex: mount.orderIndex ?? orderIndex,
            defaultEnabled: mount.defaultEnabled ?? false,
            ...(mount.activation ? { activation: structuredClone(mount.activation) } : {}),
            ...(mount.provider ? { provider: { ...mount.provider } } : {}),
            ...(mount.content ? { content: { ...mount.content } } : {}),
            origin: origin(item.contribution.id),
          })
        }
      }
      return undefined
    }, { allowEmpty: true })
  })
  await refreshAgentToolRegistry(ctx)
  return {
    promptResources: input.promptResources.map(item => ({
      contributionId: item.contribution.id,
      resourceId: promptResourceIds.get(item.contribution.id)!,
      resourceKind: item.contribution.resourceKind,
    })),
    agentTools: input.agentTools.map(item => ({ contributionId: item.contribution.id, toolId: item.contribution.id })),
    mutation: { changesetId: transaction.commit.changesetId },
  }
}

async function removeExtensionPackageResources(
  ctx: ApplicationRuntimeContext,
  input: RemoveExtensionPackageResourcesInput,
  requestContext: RuntimeRequestContext | undefined,
  documentParticipant: SqliteDocumentStore,
): Promise<RemoveExtensionPackageResourcesResult> {
  assertNonEmpty(input.packageId, 'packageId')
  const promptResources = (await listMappedResources(ctx.promptResources))
    .filter(resource => resource.origin?.kind === 'extension-package' && resource.origin.packageId === input.packageId)
  const promptResourceIds = new Set(promptResources.map(resource => resource.id))
  const presetResourceIds = new Set(promptResources.filter(resource => resource.resourceKind === 'preset').map(resource => resource.id))
  const agentTools = (await listAgentToolEntries(ctx))
    .filter(tool => tool.origin?.kind === 'extension-package' && tool.origin.packageId === input.packageId)
  const agentToolIds = new Set(agentTools.map(tool => tool.id))

  if (promptResources.length === 0 && agentTools.length === 0) {
    return {
      packageId: input.packageId,
      promptResourceIds: [],
      agentToolIds: [],
      detachedReferences: { cards: 0, timelines: 0, agentProfiles: 0, presetToolMounts: 0 },
    }
  }

  const profiles = await listDocuments<AgentProfileContent>(ctx.documents, applicationDocumentTypes.agentProfile)
  const blockingProfiles = profiles.filter(profile => presetResourceIds.has(profile.content.presetId))
  if (blockingProfiles.length > 0) {
    throw new Error(`Extension Package resources are still referenced by Agent Profiles: ${blockingProfiles.map(profile => profile.id).join(', ')}`)
  }
  const profilesWithToolOverrides = profiles.filter(profile => Object.keys(profile.content.toolOverrides ?? {}).some(toolId => agentToolIds.has(toolId)))
  const cards = (await listDocuments<CardSourceContent>(ctx.documents, applicationDocumentTypes.cardSource))
    .filter(card => card.content.promptResourceIds?.some(resourceId => promptResourceIds.has(resourceId)))
  const timelineReferences = new Map<string, { id: string; promptResourceIds: string[] }>()
  for (const resourceId of promptResourceIds) {
    for (const timeline of await findTimelinePromptResourceReferences(ctx, resourceId)) timelineReferences.set(timeline.id, timeline)
  }

  const toolMounts = await ctx.promptResources.listPresetToolMounts()
  const removedToolMounts = toolMounts.filter(mount => presetResourceIds.has(mount.presetResourceId) || agentToolIds.has(mount.toolId))
  const affectedPresetIds = new Set(removedToolMounts
    .filter(mount => !presetResourceIds.has(mount.presetResourceId))
    .map(mount => mount.presetResourceId))

  const transaction = await ctx.dataEngine.transact({
    ...promptResourceWriteContext(requestContext),
    reason: 'application.removeExtensionPackageResources',
  }, async dataTx => {
    const resourceTx = ctx.promptResources.transaction(dataTx)
    const narrativeTx = ctx.narratives?.transaction(dataTx)
    for (const timeline of timelineReferences.values()) {
      narrativeTx?.updatePromptResources({
        timelineId: timeline.id,
        promptResourceIds: timeline.promptResourceIds.filter(resourceId => !promptResourceIds.has(resourceId)),
        expectedPromptResourceIds: timeline.promptResourceIds,
      })
    }
    for (const presetResourceId of affectedPresetIds) {
      resourceTx.replacePresetToolMounts({
        presetResourceId,
        mounts: toolMounts
          .filter(mount => mount.presetResourceId === presetResourceId && !agentToolIds.has(mount.toolId))
          .map(mount => ({
            toolId: mount.toolId,
            orderIndex: mount.orderIndex,
            defaultEnabled: mount.defaultEnabled,
            ...(mount.activation ? { activation: structuredClone(mount.activation) } : {}),
            ...(mount.provider ? { provider: { ...mount.provider } } : {}),
            ...(mount.content ? { content: { ...mount.content } } : {}),
            origin: structuredClone(mount.origin),
          })),
      })
    }
    return documentParticipant.participateTransaction(dataTx, async documents => {
      for (const card of cards) {
        await writeDocument<CardSourceContent>(documents, {
          id: card.id,
          type: applicationDocumentTypes.cardSource,
          content: {
            ...card.content,
            promptResourceIds: card.content.promptResourceIds?.filter(resourceId => !promptResourceIds.has(resourceId)),
            updatedAt: ctx.now(),
          },
          expectedVersion: card.version,
        })
      }
      for (const profile of profilesWithToolOverrides) {
        await writeDocument<AgentProfileContent>(documents, {
          id: profile.id,
          type: applicationDocumentTypes.agentProfile,
          content: {
            ...profile.content,
            toolOverrides: Object.fromEntries(Object.entries(profile.content.toolOverrides ?? {}).filter(([toolId]) => !agentToolIds.has(toolId))),
            updatedAt: ctx.now(),
          },
          expectedVersion: profile.version,
        })
      }
      for (const tool of agentTools) await documents.delete({ id: tool.id, expectedVersion: tool.version })
      for (const resource of promptResources) resourceTx.deleteResource({ resourceId: resource.id, expectedVersion: resource.version })
      return undefined
    }, { allowEmpty: true })
  })
  await refreshAgentToolRegistry(ctx)
  return {
    packageId: input.packageId,
    promptResourceIds: [...promptResourceIds].sort(),
    agentToolIds: [...agentToolIds].sort(),
    detachedReferences: {
      cards: cards.length,
      timelines: timelineReferences.size,
      agentProfiles: profilesWithToolOverrides.length,
      presetToolMounts: removedToolMounts.length,
    },
    mutation: { changesetId: transaction.commit.changesetId },
  }
}

function readExtensionAgentToolDefinition(packageId: string, toolId: string, value: JsonValue): ToolDefinition {
  if (!isObject(value)) throw new Error(`Extension Agent Tool definition must be an object: ${toolId}`)
  if ('id' in value || 'owner' in value) throw new Error(`Extension Agent Tool definition cannot override id or owner: ${toolId}`)
  if (typeof value.name !== 'string' || typeof value.description !== 'string' || !isObject(value.input)) {
    throw new Error(`Extension Agent Tool definition is incomplete: ${toolId}`)
  }
  if (value.prompt !== undefined && !isObject(value.prompt)) throw new Error(`Extension Agent Tool prompt must be an object: ${toolId}`)
  const definition: ToolDefinition = {
    id: toolId,
    owner: { namespace: packageId },
    name: value.name,
    description: value.description,
    input: structuredClone(value.input) as ToolDefinition['input'],
    ...(value.prompt === undefined ? {} : { prompt: structuredClone(value.prompt) as ToolDefinition['prompt'] }),
  }
  createAgentToolRegistry([definition])
  return definition
}

function validateExtensionPromptNodeIds(packageId: string, node: PromptResourceArtifact['rootNode'], seen: Set<string>): void {
  if (!node.id.startsWith(`${packageId}.`)) throw new Error(`Extension Prompt Resource node id must use package namespace: ${node.id}`)
  if (seen.has(node.id)) throw new Error(`Extension Prompt Resource node id must be unique: ${node.id}`)
  seen.add(node.id)
  for (const child of node.children ?? []) validateExtensionPromptNodeIds(packageId, child, seen)
}

async function listAgentToolEntries(
  ctx: ApplicationRuntimeContext,
): Promise<AgentToolEntry[]> {
  const documents = await listDocuments<AgentToolContent>(
    ctx.documents,
    applicationDocumentTypes.agentTool,
  )
  if (documents.length > 0) return documents.map(toAgentToolEntry)
  const timestamp = ctx.now()
  return ctx.agentTools.list().map((definition) => ({
    ...structuredClone(definition),
    version: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  }))
}

async function refreshAgentToolRegistry(
  ctx: ApplicationRuntimeContext,
): Promise<void> {
  const documents = await listDocuments<AgentToolContent>(
    ctx.documents,
    applicationDocumentTypes.agentTool,
  )
  if (documents.length === 0) return
  ctx.agentTools.replaceDefinitions(
    documents.map((document) => ({
      id: document.id,
      owner: structuredClone(document.content.owner),
      name: document.content.name,
      description: document.content.description,
      input: structuredClone(document.content.input),
      ...(document.content.prompt
        ? { prompt: structuredClone(document.content.prompt) }
        : {}),
    })),
  )
}

async function readProviderCapability(ctx: ApplicationRuntimeContext, providerProfileId: string) {
  const profile = await readDocument<ProviderProfileContent>(ctx.documents, providerProfileId, applicationDocumentTypes.providerProfile)
  return ctx.providerAdapters.getCapability(profile.content.providerExtensionId)
}

type ExtensionStorageScopeRef =
  | { kind: 'card'; cardId: string }
  | { kind: 'timeline'; timelineId: string }
  | { kind: 'agent-session'; agentSessionId: string }

async function tombstoneExtensionStorageScope(
  documents: DocumentTransaction,
  scope: ExtensionStorageScopeRef,
): Promise<void> {
  for (const type of [applicationDocumentTypes.extensionConfig, applicationDocumentTypes.extensionRecord]) {
    const matches: DocumentRecord[] = []
    let cursor: string | undefined
    do {
      const page = await documents.list({ type, cursor, limit: 200 })
      matches.push(...page.items.filter(document => hasExtensionStorageScope(document.content, scope)))
      cursor = page.nextCursor
    } while (cursor)
    for (const document of matches) {
      await documents.delete({
        id: document.id,
        expectedVersion: document.version,
        reason: `extension.storage.scope.deleted:${scope.kind}`,
      })
    }
  }
}

function hasExtensionStorageScope(content: JsonValue, scope: ExtensionStorageScopeRef): boolean {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return false
  const storedScope = content.scope
  if (!storedScope || typeof storedScope !== 'object' || Array.isArray(storedScope)) return false
  if (scope.kind === 'card') {
    return storedScope.kind === 'card' && storedScope.cardId === scope.cardId
  }
  if (scope.kind === 'timeline') {
    return storedScope.kind === 'timeline' && storedScope.timelineId === scope.timelineId
  }
  return storedScope.kind === 'agent-session' && storedScope.agentSessionId === scope.agentSessionId
}

async function countCardDeletionExtensionData(
  documents: DocumentStore,
  cardId: string,
  timelineIds: ReadonlySet<string>,
) {
  const counts = {
    cardScoped: { configs: 0, records: 0 },
    timelineScoped: { configs: 0, records: 0 },
  }
  for (const [type, key] of [
    [applicationDocumentTypes.extensionConfig, 'configs'],
    [applicationDocumentTypes.extensionRecord, 'records'],
  ] as const) {
    const entries = await listDocuments<JsonValue>(documents, type)
    for (const entry of entries) {
      if (hasExtensionStorageScope(entry.content, { kind: 'card', cardId })) counts.cardScoped[key] += 1
      if (hasTimelineExtensionStorageScope(entry.content, timelineIds)) {
        counts.timelineScoped[key] += 1
      }
    }
  }
  return counts
}

function hasTimelineExtensionStorageScope(content: JsonValue, timelineIds: ReadonlySet<string>): boolean {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return false
  const scope = content.scope
  return Boolean(
    scope
    && typeof scope === 'object'
    && !Array.isArray(scope)
    && scope.kind === 'timeline'
    && typeof scope.timelineId === 'string'
    && timelineIds.has(scope.timelineId),
  )
}

function secretWriteContext(requestContext: RuntimeRequestContext | undefined, reason: string) {
  return {
    actor: requestContext?.actor ?? (requestContext?.clientId
      ? { kind: 'client' as const, id: requestContext.clientId }
      : applicationActor),
    reason,
    correlationId: requestContext?.correlationId,
    callId: requestContext?.callId,
    parentCallId: requestContext?.parentCallId,
  }
}

async function toProviderProfileView(
  ctx: ApplicationRuntimeContext,
  profile: DocumentRecord<ProviderProfileContent>,
): Promise<ProviderProfileView> {
  const metadata = profile.content.secretRef && ctx.secrets
    ? await ctx.secrets.getMetadata(profile.content.secretRef)
    : undefined
  return {
    id: profile.id,
    version: profile.version,
    providerExtensionId: profile.content.providerExtensionId,
    displayName: profile.content.displayName,
    config: profile.content.config,
    enabledModelIds: [...profile.content.enabledModelIds],
    credential: {
      configured: metadata?.state === 'active',
      ...(metadata?.updatedAt ? { updatedAt: metadata.updatedAt } : {}),
    },
    createdAt: profile.content.createdAt,
    updatedAt: profile.content.updatedAt,
  }
}

async function toAiCapabilityProfileView(
  ctx: ApplicationRuntimeContext,
  profile: DocumentRecord<AiCapabilityProfileContent>,
): Promise<AiCapabilityProfileView> {
  const providerProfile = await readDocument<ProviderProfileContent>(
    ctx.documents,
    profile.content.providerProfileId,
    applicationDocumentTypes.providerProfile,
  )
  const provider = ctx.aiCapabilities?.get(providerProfile.content.providerExtensionId)
  return {
    id: profile.id,
    version: profile.version,
    providerProfileId: providerProfile.id,
    providerExtensionId: providerProfile.content.providerExtensionId,
    capabilityId: profile.content.capabilityId,
    displayName: profile.content.displayName,
    config: profile.content.config,
    available: provider?.capabilities.some(capability => capability.id === profile.content.capabilityId) ?? false,
    createdAt: profile.content.createdAt,
    updatedAt: profile.content.updatedAt,
  }
}

async function buildProviderPayloadPreview(input: {
  documents: DocumentStore
  messages: ProviderMessage[]
  model?: { providerProfileId: string; modelId: string }
}): Promise<OpenAIChatPayload | undefined> {
  if (!input.model) return undefined
  const providerProfile = await readDocument<ProviderProfileContent>(input.documents, input.model.providerProfileId, applicationDocumentTypes.providerProfile)
  const providerExtensionId = providerProfile.content.providerExtensionId
  if (providerExtensionId !== 'official.openai-compatible' && providerExtensionId !== 'openai-compatible') return undefined
  return buildOpenAIChatPayload({
    messages: input.messages,
    modelId: input.model.modelId,
  })
}
