import type { DocumentRecord, DocumentStore, SqliteDocumentStore } from '@loom-studio/document-store'
import type { AgentTranscriptEntry } from '@loom-studio/agent-store'
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
import { applyApplicationStateMutation, applyGlobalStateDefaultInTransaction, getApplicationStateSnapshot, initializeGlobalState, revertApplicationStateChangeset } from './state.js'
import {
  toStateDefinitionEntry,
  materializeTimelineState,
  validateStateDefinitionDraft,
  validateStateValue,
  validateTimelineStateBinding,
} from './state-definition.js'
import { createVariableRenderContext, type VariableRenderContext } from './variables.js'
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
  getImportBundle,
  importCardBundle,
  isCardBundleArtifact,
  type CardBundleArtifact,
  type PromptResourceContent,
} from './workspace.js'
import { fromStoredResource, listMappedResources, readMappedResource, toStoredNodeDraft, toStoredResourceInput } from './prompt-resource-mapper.js'
import type {
  AgentProfileContent,
  AgentToolContent,
  AgentToolEntry,
  ApplicationRuntime,
  ApplicationRuntimeOptions,
  CardMediaRefs,
  CardSourceContent,
  StateDefinitionContent,
  StateDefinitionDraft,
  StateMutationOperation,
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

  function requireDocumentParticipant(): SqliteDocumentStore {
    const participant = ctx.documents as Partial<SqliteDocumentStore>
    if (typeof participant.participateTransaction !== 'function') {
      throw new Error('Shared Sqlite Document Store participant is required')
    }
    return ctx.documents as SqliteDocumentStore
  }

  function narrativeWriteContext(requestContext: RuntimeRequestContext | undefined, reason: string) {
    return {
      actor: requestContext?.clientId
        ? { kind: 'client' as const, id: requestContext.clientId }
        : applicationActor,
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
    const variables = await readAgentTurnVariables(ctx, card.id, initialState)
    const openingEntries = readOpeningEntries(cardContent, variables)
    const transaction = await ctx.dataEngine.transact(
      narrativeWriteContext(requestContext, reason),
      async dataTx => {
        const stateTx = ctx.states.transaction(dataTx)
        const narrativeTx = narratives.transaction(dataTx)
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
      },
    )
    return {
      ...transaction.value,
      mutation: { changesetId: transaction.commit.changesetId },
    }
  }

  return {
    initialize: async () => {
      await initializeGlobalState(ctx)
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
            await writeDocument<AgentToolContent>(ctx.documents, {
              id: definition.id,
              type: applicationDocumentTypes.agentTool,
              content: toAgentToolContent(definition, content.createdAt, timestamp),
              expectedVersion: existing.version,
            })
          }
          continue
        }
        await writeDocument<AgentToolContent>(ctx.documents, {
          id: definition.id,
          type: applicationDocumentTypes.agentTool,
          content: toAgentToolContent(definition, timestamp),
          expectedVersion: 'new',
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

    deleteCard: async (input, requestContext) => {
      const mutation = await executeDocumentMutation(ctx.documents, requestContext, 'application.deleteCard', async documents => {
        const card = await readDocument<CardSourceContent>(documents, input.cardId, applicationDocumentTypes.cardSource)
        await documents.delete({ id: card.id, expectedVersion: card.version })
        return true as const
      })

      return { deleted: mutation.value, mutation: mutation.mutation }
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
      const enabledModelIds = normalizeModelIds(input.enabledModelIds)
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
          ...(input.enabledModelIds !== undefined ? { enabledModelIds: normalizeModelIds(input.enabledModelIds) } : {}),
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
          ...toAgentToolContent(input.definition, existing.content.createdAt),
          updatedAt: ctx.now(),
        },
        expectedVersion: existing.version,
      })
      await refreshAgentToolRegistry(ctx)
      return {
        tool: toAgentToolEntry(updated),
      }
    },

    analyzeAgentTools: async input => {
      const profile = await readDocument<AgentProfileContent>(ctx.documents, input.agentProfileId, applicationDocumentTypes.agentProfile)
      const capability = await readProviderCapability(ctx, profile.content.model.providerProfileId)
      const mounts = await ctx.promptResources.listPresetToolMounts({ presetResourceId: profile.content.presetId })
      const enabledToolIds = resolveEnabledPresetToolMounts(mounts, profile.content.toolOverrides ?? {}).map(mount => mount.toolId)
      return {
        analysis: ctx.agentTools.analyze(enabledToolIds, {
          nativeFunction: capability.nativeFunctionTools,
          providerCustom: capability.providerCustomTools,
          content: true,
        }),
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
      const result = await requireAgents().deleteSession({
        ...agentWriteContext(requestContext, 'application.deleteAgentSession'),
        ...input,
      })
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
      const result = await ctx.dataEngine.transact(
        narrativeWriteContext(requestContext, 'application.deleteNarrativeTimeline'),
        async dataTx => {
          const timeline = narratives.transaction(dataTx).deleteTimeline(input)
          if (scope) ctx.states.transaction(dataTx).tombstoneScope({ scopeId: scope.id })
          return timeline
        },
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
          actor: requestContext?.clientId
            ? { kind: 'client', id: requestContext.clientId }
            : applicationActor,
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

    getImportBundle: async input => {
      return {
        importBundle: await getImportBundle({
          documents: ctx.documents,
          importBundleId: input.importBundleId,
        }),
      }
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
          return { deleted: resourceTx.deleteResource({ resourceId: input.resourceId, expectedVersion: resource.version }) }
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

    listCardPromptResources: async input => {
      const card = await readDocument<CardSourceContent>(ctx.documents, input.cardId, applicationDocumentTypes.cardSource)
      const resources = []
      for (const resourceId of card.content.promptResourceIds ?? []) resources.push(await readMappedResource(ctx.promptResources, resourceId))
      return { resources }
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
        actor: requestContext?.clientId
          ? { kind: 'client' as const, id: requestContext.clientId }
          : applicationActor,
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
    actor: requestContext?.clientId
      ? { kind: 'client' as const, id: requestContext.clientId }
      : applicationActor,
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
  const variables = await readAgentTurnVariables(
    ctx,
    narrativePage?.timeline.createdFrom?.cardId,
    timelineState?.value,
  )
  try {
    const textRules = (await listDocuments<TextTransformRuleContent>(ctx.documents, applicationDocumentTypes.textTransformRule)).map(document => toVersioned(document))
    const globalAndExtensionRules = textRules.filter(rule => rule.owner.kind === 'workspace' || rule.owner.kind === 'extension' || rule.owner.kind === 'user-override')
    const presetRules = textRules.filter(rule => rule.owner.kind === 'preset' && rule.owner.presetId === preset.id)
    const cardRules = narrativePage?.timeline.createdFrom?.cardId
      ? textRules.filter(rule => rule.owner.kind === 'card' && rule.owner.cardId === narrativePage.timeline.createdFrom!.cardId)
      : []
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
  cardId: string | undefined,
  timeline?: JsonObject,
): Promise<VariableRenderContext> {
  const globalSnapshot = await ctx.states.getGlobalSnapshot()
  const global = structuredClone(globalSnapshot?.revision.snapshot ?? {})
  let fallbackUser = 'User'
  if (cardId) {
    const card = await readDocument<CardSourceContent>(
      ctx.documents,
      cardId,
      applicationDocumentTypes.cardSource,
    )
    if (typeof card.content.userName === 'string' && card.content.userName.trim().length > 0) {
      fallbackUser = card.content.userName
    }
  }
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
    slot: 'studio.panel',
    renderMode: 'panel',
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
    let first = true
    const entries: AgentTranscriptEntry[] = []
    do {
      const page = await agents.getEntryPage({ agentSessionId: source.sessionId, ...(cursor ? { cursor } : {}), limit: 100 })
      entries.unshift(...page.entries)
      cursor = page.nextCursor
      first = false
    } while (cursor || first)
    return entries.flatMap(entry => entry.entry.kind === 'message'
      ? [{ id: entry.id, source, role: entry.entry.role, text: entry.entry.content, sequence: entry.sequence, createdAt: entry.createdAt }]
      : [])
  }
  const narratives = ctx.narratives
  if (!narratives) throw new Error('Narrative Store is not configured')
  let cursor: string | undefined
  let first = true
  const nodes: import('@loom-studio/narrative-store').NarrativeNode[] = []
  do {
    const page = await narratives.getPage({ timelineId: source.timelineId, branchId: source.branchId, ...(cursor ? { cursor } : {}), limit: 100 })
    nodes.unshift(...page.nodes)
    cursor = page.nextCursor
    first = false
  } while (cursor || first)
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
  if (source.kind === 'agent-session') {
    const session = await ctx.agents?.getSession(source.sessionId)
    if (!session) throw new Error(`Agent Session not found: ${source.sessionId}`)
    const profile = await readDocument<AgentProfileContent>(ctx.documents, session.agentProfileId, applicationDocumentTypes.agentProfile)
    presetId = profile.content.presetId
  } else {
    const timeline = await ctx.narratives?.getTimeline(source.timelineId)
    if (!timeline) throw new Error(`Narrative Timeline not found: ${source.timelineId}`)
    cardId = timeline.createdFrom?.cardId
  }
  return rules.filter(rule => {
    if (rule.owner.kind === 'preset') return rule.owner.presetId === presetId
    if (rule.owner.kind === 'card') return rule.owner.cardId === cardId
    return true
  })
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
): AgentToolContent {
  return {
    owner: structuredClone(definition.owner),
    name: definition.name,
    description: definition.description,
    input: structuredClone(definition.input),
    ...(definition.prompt ? { prompt: structuredClone(definition.prompt) } : {}),
    createdAt,
    updatedAt,
  }
}

function toAgentToolEntry(
  document: DocumentRecord<AgentToolContent>,
): AgentToolEntry {
  const { createdAt, updatedAt, ...definition } = document.content
  return {
    id: document.id,
    version: document.version,
    ...structuredClone(definition),
    createdAt,
    updatedAt,
  }
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

function secretWriteContext(requestContext: RuntimeRequestContext | undefined, reason: string) {
  return {
    actor: requestContext?.clientId
      ? { kind: 'client' as const, id: requestContext.clientId }
      : applicationActor,
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
