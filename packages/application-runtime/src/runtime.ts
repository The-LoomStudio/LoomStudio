import type { DocumentRecord, DocumentStore } from '@loom-studio/document-store'
import type { AgentMessage } from '@loom-studio/agent-store'
import type { JsonValue } from '@loom-studio/shared'
import {
  assertModelProfileExists,
  assertNonEmpty,
  assertProviderAccountExists,
} from './agent.js'
import {
  cardToSnapshot,
  normalizeCardContent,
  normalizeCardMedia,
  normalizeOpening,
  normalizeOptionalString,
  normalizePreset,
  normalizeSettingLayer,
  readOpeningEntries,
  toCardSource,
} from './card.js'
import { createApplicationRuntimeContext, type ApplicationRuntimeContext } from './application-context.js'
import { applicationDocumentTypes } from './document-types.js'
import { listDocuments, readDocument, toVersioned, writeDocument } from './document-store.js'
import { executeDocumentMutation } from './mutation.js'
import type { ActivationFacts } from './prompt-activation.js'
import { buildOpenAIChatPayload, type OpenAIChatPayload } from './provider-payload.js'
import { composeAgentTurnPrompt } from './agent-turn.js'
import {
  createPromptResourceAsset,
  deletePromptResourceAsset,
  exportCardArtifact,
  getImportBundle,
  getPromptResource,
  importCardBundle,
  isCardBundleArtifact,
  listCardPromptResources,
  movePromptResourceAsset,
  readPromptResourceInputs,
  updatePromptResourceAsset,
  updatePromptResourceAssets,
  updateCardPromptResources,
  type CardBundleArtifact,
} from './workspace.js'
import type {
  AgentLocalBindingContent,
  AgentPresetContent,
  ApplicationRuntime,
  ApplicationRuntimeOptions,
  CardMediaRefs,
  CardSourceContent,
  ModelProfileContent,
  ProviderAccountContent,
  ProviderMessage,
  RuntimeRequestContext,
} from './types.js'

const applicationActor = { kind: 'kernel', id: 'application-runtime' } as const

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

  return {
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
        cards: result.items.map(card => toCardSource(card as never)),
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

    createProviderAccount: async input => {
      assertNonEmpty(input.providerExtensionId, 'providerExtensionId')
      assertNonEmpty(input.displayName, 'displayName')

      const timestamp = ctx.now()
      const providerAccount = await writeDocument<ProviderAccountContent>(ctx.documents, {
        id: ctx.createId('provider-account'),
        type: applicationDocumentTypes.providerAccount,
        content: {
          providerExtensionId: input.providerExtensionId,
          displayName: input.displayName,
          config: input.config ?? {},
          secretRefs: input.secretRefs ?? {},
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        expectedVersion: 'new',
      })

      return { providerAccount: toVersioned(providerAccount) }
    },

    getProviderAccount: async input => {
      const providerAccount = await readDocument<ProviderAccountContent>(ctx.documents, input.providerAccountId, applicationDocumentTypes.providerAccount)
      return { providerAccount: redactProviderAccount(toVersioned(providerAccount)) }
    },

    listProviderAccounts: async input => {
      const result = await ctx.documents.list({
        type: applicationDocumentTypes.providerAccount,
        cursor: input?.cursor,
        limit: input?.limit,
      })

      return {
        providerAccounts: result.items.map(providerAccount => redactProviderAccount(toVersioned(providerAccount as never))),
        nextCursor: result.nextCursor,
      }
    },

    createModelProfile: async input => {
      assertNonEmpty(input.providerAccountId, 'providerAccountId')
      assertNonEmpty(input.displayName, 'displayName')
      assertNonEmpty(input.providerModelId, 'providerModelId')
      await assertProviderAccountExists(ctx.documents, input.providerAccountId)

      const timestamp = ctx.now()
      const modelProfile = await writeDocument<ModelProfileContent>(ctx.documents, {
        id: ctx.createId('model-profile'),
        type: applicationDocumentTypes.modelProfile,
        content: {
          providerAccountId: input.providerAccountId,
          capability: input.capability ?? 'chat.completion',
          displayName: input.displayName,
          providerModelId: input.providerModelId,
          config: input.config ?? {},
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        expectedVersion: 'new',
      })

      return { modelProfile: toVersioned(modelProfile) }
    },

    getModelProfile: async input => {
      const modelProfile = await readDocument<ModelProfileContent>(ctx.documents, input.modelProfileId, applicationDocumentTypes.modelProfile)
      return { modelProfile: toVersioned(modelProfile) }
    },

    listModelProfiles: async input => {
      const offset = input?.cursor ? Number(input.cursor) : 0
      const limit = input?.limit ?? 100
      if (!Number.isInteger(offset) || offset < 0) throw new Error('listModelProfiles cursor must be a non-negative integer')
      if (!Number.isInteger(limit) || limit < 1) throw new Error('listModelProfiles limit must be a positive integer')

      // ponytail: Document Store 暂不支持按内容字段查询；数据量增长后应将 providerAccountId 提升为可索引过滤条件。
      const matchingProfiles = (await listDocuments<ModelProfileContent>(ctx.documents, applicationDocumentTypes.modelProfile))
        .map(toVersioned)
        .filter(modelProfile => !input?.providerAccountId || modelProfile.providerAccountId === input.providerAccountId)
      const modelProfiles = matchingProfiles.slice(offset, offset + limit)
      const nextOffset = offset + limit

      return {
        modelProfiles,
        nextCursor: nextOffset < matchingProfiles.length ? String(nextOffset) : undefined,
      }
    },

    createAgentPreset: async input => {
      assertNonEmpty(input.name, 'name')
      assertNonEmpty(input.instructions, 'instructions')
      const promptResourceIds = [...new Set(input.promptResourceIds ?? [])]
      if (promptResourceIds.length) {
        await readPromptResourceInputs({ documents: ctx.documents, resourceIds: promptResourceIds, macroContext: { user: 'User' } })
      }
      const timestamp = ctx.now()
      const agentPreset = await writeDocument<AgentPresetContent>(ctx.documents, {
        id: ctx.createId('agent-preset'),
        type: applicationDocumentTypes.agentPreset,
        content: {
          name: input.name,
          instructions: input.instructions,
          promptResourceIds,
          historyPolicy: input.historyPolicy ?? 'persistent',
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        expectedVersion: 'new',
      })
      return { agentPreset: toVersioned(agentPreset) }
    },

    getAgentPreset: async input => ({
      agentPreset: toVersioned(await readDocument<AgentPresetContent>(ctx.documents, input.agentPresetId, applicationDocumentTypes.agentPreset)),
    }),

    listAgentPresets: async input => {
      const result = await ctx.documents.list({ type: applicationDocumentTypes.agentPreset, cursor: input?.cursor, limit: input?.limit })
      return { agentPresets: result.items.map(item => toVersioned(item as never)), nextCursor: result.nextCursor }
    },

    updateAgentPreset: async input => {
      const existing = await readDocument<AgentPresetContent>(ctx.documents, input.agentPresetId, applicationDocumentTypes.agentPreset)
      if (input.name !== undefined) assertNonEmpty(input.name, 'name')
      if (input.instructions !== undefined) assertNonEmpty(input.instructions, 'instructions')
      const promptResourceIds = input.promptResourceIds ? [...new Set(input.promptResourceIds)] : undefined
      if (promptResourceIds?.length) {
        await readPromptResourceInputs({ documents: ctx.documents, resourceIds: promptResourceIds, macroContext: { user: 'User' } })
      }
      const agentPreset = await writeDocument<AgentPresetContent>(ctx.documents, {
        id: existing.id,
        type: applicationDocumentTypes.agentPreset,
        content: {
          ...existing.content,
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.instructions !== undefined ? { instructions: input.instructions } : {}),
          ...(promptResourceIds ? { promptResourceIds } : {}),
          ...(input.historyPolicy !== undefined ? { historyPolicy: input.historyPolicy } : {}),
          updatedAt: ctx.now(),
        },
        expectedVersion: existing.version,
      })
      return { agentPreset: toVersioned(agentPreset) }
    },

    deleteAgentPreset: async input => {
      await readDocument<AgentPresetContent>(ctx.documents, input.agentPresetId, applicationDocumentTypes.agentPreset)
      await ctx.documents.delete({ id: input.agentPresetId })
      return { deleted: true as const }
    },

    createAgentLocalBinding: async input => {
      assertNonEmpty(input.name, 'name')
      if (input.modelProfileId) {
        await assertModelProfileExists(ctx.documents, input.modelProfileId)
      }

      const timestamp = ctx.now()
      const localBinding = await writeDocument<AgentLocalBindingContent>(ctx.documents, {
        id: ctx.createId('agent-local-binding'),
        type: applicationDocumentTypes.agentLocalBinding,
        content: {
          name: input.name,
          purpose: input.purpose ?? 'narrative',
          modelProfileId: input.modelProfileId,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        expectedVersion: 'new',
      })

      return { localBinding: toVersioned(localBinding) }
    },

    getAgentLocalBinding: async input => {
      const localBinding = await readDocument<AgentLocalBindingContent>(ctx.documents, input.localBindingId, applicationDocumentTypes.agentLocalBinding)
      return { localBinding: toVersioned(localBinding) }
    },

    listAgentLocalBindings: async input => {
      const result = await ctx.documents.list({
        type: applicationDocumentTypes.agentLocalBinding,
        cursor: input?.cursor,
        limit: input?.limit,
      })

      return {
        localBindings: result.items.map(localBinding => toVersioned(localBinding as never)),
        nextCursor: result.nextCursor,
      }
    },

    updateProviderAccount: async input => {
      const existing = await readDocument<ProviderAccountContent>(ctx.documents, input.providerAccountId, applicationDocumentTypes.providerAccount)
      const timestamp = ctx.now()
      const updated = await writeDocument<ProviderAccountContent>(ctx.documents, {
        id: existing.id,
        type: applicationDocumentTypes.providerAccount,
        content: {
          ...existing.content,
          ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
          ...(input.config !== undefined ? { config: input.config } : {}),
          ...(input.secretRefs !== undefined ? { secretRefs: input.secretRefs } : {}),
          updatedAt: timestamp,
        },
        expectedVersion: existing.version,
      })
      return { providerAccount: redactProviderAccount(toVersioned(updated)) }
    },

    deleteProviderAccount: async input => {
      await readDocument<ProviderAccountContent>(ctx.documents, input.providerAccountId, applicationDocumentTypes.providerAccount)
      await ctx.documents.delete({ id: input.providerAccountId })
      return { deleted: true as const }
    },

    updateModelProfile: async input => {
      const existing = await readDocument<ModelProfileContent>(ctx.documents, input.modelProfileId, applicationDocumentTypes.modelProfile)
      const timestamp = ctx.now()
      const updated = await writeDocument<ModelProfileContent>(ctx.documents, {
        id: existing.id,
        type: applicationDocumentTypes.modelProfile,
        content: {
          ...existing.content,
          ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
          ...(input.providerModelId !== undefined ? { providerModelId: input.providerModelId } : {}),
          ...(input.config !== undefined ? { config: input.config } : {}),
          updatedAt: timestamp,
        },
        expectedVersion: existing.version,
      })
      return { modelProfile: toVersioned(updated) }
    },

    deleteModelProfile: async input => {
      await readDocument<ModelProfileContent>(ctx.documents, input.modelProfileId, applicationDocumentTypes.modelProfile)
      await ctx.documents.delete({ id: input.modelProfileId })
      return { deleted: true as const }
    },

    pingModelProfile: async (input, requestContext) => {
      const result = await ctx.gateway.invokeChat({
        request: {
          messages: [{ role: 'user', content: input.text ?? 'hi' }],
        },
        modelProfileId: input.modelProfileId,
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

    updateAgentLocalBinding: async input => {
      const existing = await readDocument<AgentLocalBindingContent>(ctx.documents, input.localBindingId, applicationDocumentTypes.agentLocalBinding)
      if (input.modelProfileId) {
        await assertModelProfileExists(ctx.documents, input.modelProfileId)
      }
      const timestamp = ctx.now()
      const updated = await writeDocument<AgentLocalBindingContent>(ctx.documents, {
        id: existing.id,
        type: applicationDocumentTypes.agentLocalBinding,
        content: {
          ...existing.content,
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.purpose !== undefined ? { purpose: input.purpose } : {}),
          ...(input.modelProfileId !== undefined ? { modelProfileId: input.modelProfileId } : {}),
          updatedAt: timestamp,
        },
        expectedVersion: existing.version,
      })
      return { localBinding: toVersioned(updated) }
    },

    deleteAgentLocalBinding: async input => {
      await readDocument<AgentLocalBindingContent>(ctx.documents, input.localBindingId, applicationDocumentTypes.agentLocalBinding)
      await ctx.documents.delete({ id: input.localBindingId })
      return { deleted: true as const }
    },

    createAgentSession: async (input, requestContext) => {
      await readDocument<AgentPresetContent>(ctx.documents, input.agentPresetId, applicationDocumentTypes.agentPreset)
      const result = await requireAgents().createSession({
        ...agentWriteContext(requestContext, 'application.createAgentSession'),
        agentPresetId: input.agentPresetId,
        title: input.title,
      })
      return { session: result.session, mutation: { changesetId: result.commit.changesetId } }
    },

    getAgentSession: async input => {
      const session = await requireAgents().getSession(input.agentSessionId)
      if (!session) throw new Error(`Agent session not found: ${input.agentSessionId}`)
      return { session }
    },

    getAgentMessagePage: input => requireAgents().getMessagePage(input),

    appendAgentMessages: async (input, requestContext) => {
      const result = await requireAgents().appendMessages({
        ...agentWriteContext(requestContext, 'application.appendAgentMessages'),
        ...input,
      })
      return {
        session: result.session,
        messages: result.messages,
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
        messages: prepared.prompt.messages,
        projection: prepared.prompt.projection,
        providerPayloadPreview: await buildProviderPayloadPreview({
          documents: ctx.documents,
          messages: prepared.prompt.messages,
          modelProfile: prepared.localBinding?.content.modelProfileId
            ? await readDocument<ModelProfileContent>(ctx.documents, prepared.localBinding.content.modelProfileId, applicationDocumentTypes.modelProfile)
            : undefined,
        }),
      }
    },

    invokeAgentTurn: async (input, requestContext) => {
      if (!ctx.dataEngine) throw new Error('Data Engine is not configured')
      const agents = requireAgents()
      const prepared = await prepareAgentTurn(ctx, input, 'runtime', requestContext)
      const { localBinding, narrativePage, narratives, prompt, runId, session } = prepared
      const providerResult = await ctx.gateway.invokeChat({
        request: {
          messages: prompt.messages,
          metadata: {
            purpose: input.narrativeTarget?.commit ? 'narrative' : 'agent',
            agentSessionId: session.id,
            runId,
            ...(narrativePage ? {
              timelineId: narrativePage.timeline.id,
              branchId: narrativePage.branch.id,
            } : {}),
          },
        },
        modelProfileId: localBinding?.content.modelProfileId,
        runId,
        sessionId: session.id,
        branchId: narrativePage?.branch.id ?? 'agent-only',
        ...(requestContext ? { context: requestContext } : {}),
      })
      if (input.narrativeTarget?.commit && !providerResult.message.content) {
        throw new Error('Narrative commit requires assistant text content')
      }

      const userMessageId = ctx.createId('agent-message')
      const assistantMessageId = ctx.createId('agent-message')
      const writeContext = agentWriteContext(requestContext, 'application.invokeAgentTurn')
      const transaction = await ctx.dataEngine.transact(writeContext, async dataTx => {
        const appended = agents.transaction(dataTx).appendMessages({
          agentSessionId: session.id,
          expectedMessageCount: session.messageCount,
          messages: [
            { id: userMessageId, runId, message: { role: 'user', content: input.input } },
            { id: assistantMessageId, runId, message: providerResult.message },
          ],
        })
        const narrative = narrativePage && input.narrativeTarget?.commit
          ? narratives!.transaction(dataTx).appendNode({
              timelineId: narrativePage.timeline.id,
              branchId: narrativePage.branch.id,
              expectedHeadNodeId: narrativePage.branch.headNodeId ?? null,
              body: { format: 'loom-markdown.v1', raw: providerResult.message.content! },
              source: {
                agentSessionId: session.id,
                agentMessageId: assistantMessageId,
                runId,
              },
            })
          : undefined
        return { appended, narrative }
      })
      const [user, assistant] = transaction.value.appended.messages as [AgentMessage, AgentMessage]

      return {
        runId,
        agentSession: transaction.value.appended.session,
        messages: { user, assistant },
        ...(transaction.value.narrative ? { narrative: transaction.value.narrative } : {}),
        provider: {
          provider: providerResult.provider,
          model: providerResult.model,
          ...(providerResult.finishReason ? { finishReason: providerResult.finishReason } : {}),
          ...(providerResult.usage ? { usage: providerResult.usage } : {}),
          ...(providerResult.providerCallId ? { providerCallId: providerResult.providerCallId } : {}),
        },
        projection: prompt.projection,
        mutation: { changesetId: transaction.commit.changesetId },
      }
    },

    createNarrativeTimelineFromCard: async (input, requestContext) => {
      const card = await readDocument<CardSourceContent>(ctx.documents, input.cardId, applicationDocumentTypes.cardSource)
      const cardContent = normalizeCardContent(card.content)
      const openingEntries = readOpeningEntries(cardToSnapshot(card))
      const created = await requireNarratives().createTimeline({
        ...narrativeWriteContext(requestContext, 'application.createNarrativeTimelineFromCard'),
        title: input.title ?? cardContent.name,
        createdFrom: { cardId: card.id, cardVersion: card.version },
        promptResourceIds: cardContent.promptResourceIds ?? [],
        openingNodes: openingEntries.map(entry => ({
          body: { format: 'loom-markdown.v1' as const, raw: entry.content },
        })),
      })
      return {
        timeline: created.timeline,
        branch: created.branch,
        nodes: created.nodes,
        mutation: { changesetId: created.commit.changesetId },
      }
    },

    getNarrativeTimeline: async input => {
      const timeline = await requireNarratives().getTimeline(input.timelineId)
      if (!timeline) throw new Error(`Narrative timeline not found: ${input.timelineId}`)
      return { timeline }
    },

    getNarrativePage: input => requireNarratives().getPage(input),

    forkNarrativeBranch: async (input, requestContext) => {
      const result = await requireNarratives().forkBranch({
        ...narrativeWriteContext(requestContext, 'application.forkNarrativeBranch'),
        ...input,
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
      const result = await requireNarratives().deleteTimeline({
        ...narrativeWriteContext(requestContext, 'application.deleteNarrativeTimeline'),
        ...input,
      })
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
          importerVersion: 'loom.cardBundle@1',
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
        resource: await getPromptResource({
          documents: ctx.documents,
          resourceId: input.resourceId,
        }),
      }
    },

    listCardPromptResources: async input => {
      return {
        resources: await listCardPromptResources({
          cardId: input.cardId,
          documents: ctx.documents,
        }),
      }
    },

    updateCardPromptResources: async (input, requestContext) => {
      const mutation = await executeDocumentMutation(ctx.documents, requestContext, 'application.updateCardPromptResources', async documents => {
        return await updateCardPromptResources({
          cardId: input.cardId,
          documents,
          now: ctx.now(),
          promptResourceIds: input.promptResourceIds,
        })
      })
      return { card: mutation.value, mutation: mutation.mutation }
    },

    createPromptResourceAsset: async (input, requestContext) => {
      const mutation = await executeDocumentMutation(ctx.documents, requestContext, 'application.createPromptResourceAsset', async documents => {
        return await createPromptResourceAsset({
          asset: input.asset,
          documents,
          now: ctx.now(),
          position: input.position,
          resourceId: input.resourceId,
          targetAssetId: input.targetAssetId,
        })
      })
      return { resource: mutation.value, mutation: mutation.mutation }
    },

    updatePromptResourceAsset: async (input, requestContext) => {
      const mutation = await executeDocumentMutation(ctx.documents, requestContext, 'application.updatePromptResourceAsset', async documents => {
        return await updatePromptResourceAsset({
          assetId: input.assetId,
          body: input.body,
          capabilities: input.capabilities,
          documents,
          enabled: input.enabled,
          label: input.label,
          meta: input.meta,
          now: ctx.now(),
          resourceId: input.resourceId,
        })
      })
      return { resource: mutation.value, mutation: mutation.mutation }
    },

    updatePromptResourceAssets: async (input, requestContext) => {
      const mutation = await executeDocumentMutation(ctx.documents, requestContext, 'application.updatePromptResourceAssets', async documents => {
        return await updatePromptResourceAssets({
          documents,
          now: ctx.now(),
          resourceId: input.resourceId,
          updates: input.updates,
        })
      })
      return { resource: mutation.value, mutation: mutation.mutation }
    },

    movePromptResourceAsset: async (input, requestContext) => {
      const mutation = await executeDocumentMutation(ctx.documents, requestContext, 'application.movePromptResourceAsset', async documents => {
        return await movePromptResourceAsset({
          assetId: input.assetId,
          documents,
          now: ctx.now(),
          position: input.position,
          resourceId: input.resourceId,
          targetAssetId: input.targetAssetId,
        })
      })
      return { resource: mutation.value, mutation: mutation.mutation }
    },

    deletePromptResourceAsset: async (input, requestContext) => {
      const mutation = await executeDocumentMutation(ctx.documents, requestContext, 'application.deletePromptResourceAsset', async documents => {
        return await deletePromptResourceAsset({
          assetId: input.assetId,
          documents,
          now: ctx.now(),
          resourceId: input.resourceId,
        })
      })
      return { resource: mutation.value, mutation: mutation.mutation }
    },

    exportCardArtifact: async input => {
      return {
        artifact: await exportCardArtifact({
          cardId: input.cardId,
          documents: ctx.documents,
        }),
      }
    },

  }
}

async function prepareAgentTurn(
  ctx: ApplicationRuntimeContext,
  input: {
    agentSessionId: string
    localBindingId?: string
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
  const agentPage = await ctx.agents.getMessagePage({ agentSessionId: session.id, limit: 100 })
  const agentPreset = await readDocument<AgentPresetContent>(ctx.documents, session.agentPresetId, applicationDocumentTypes.agentPreset)
  const localBinding = input.localBindingId
    ? await readDocument<AgentLocalBindingContent>(ctx.documents, input.localBindingId, applicationDocumentTypes.agentLocalBinding)
    : undefined
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
  try {
    prompt = await composeAgentTurnPrompt({
      activationFacts: input.activationFacts,
      agentMessages: agentPreset.content.historyPolicy === 'persistent'
        ? agentPage.messages.map(message => message.message)
        : [],
      agentPreset: agentPreset.content,
      documents: ctx.documents,
      narrative: narrativePage ? { nodes: narrativePage.nodes, timeline: narrativePage.timeline } : undefined,
      userInput: input.input,
    })
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
    localBinding,
    narrativePage,
    narratives,
    prompt,
    runId,
    session,
  }
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

function redactProviderAccount<T extends { secretRefs: Record<string, string> }>(account: T): T {
  const redacted: Record<string, string> = {}
  for (const [key, value] of Object.entries(account.secretRefs)) {
    if (value.startsWith('env:')) redacted[key] = value
    else redacted[key] = value.startsWith('plain:') ? 'plain:***' : '***'
  }
  return { ...account, secretRefs: redacted }
}

async function buildProviderPayloadPreview(input: {
  documents: DocumentStore
  messages: ProviderMessage[]
  modelProfile?: DocumentRecord<ModelProfileContent>
}): Promise<OpenAIChatPayload | undefined> {
  if (!input.modelProfile) return undefined
  const providerAccount = await readDocument<ProviderAccountContent>(
    input.documents,
    input.modelProfile.content.providerAccountId,
    applicationDocumentTypes.providerAccount,
  )
  const providerExtensionId = providerAccount.content.providerExtensionId
  if (providerExtensionId !== 'official.openai-compatible' && providerExtensionId !== 'openai-compatible') return undefined
  return buildOpenAIChatPayload({
    messages: input.messages,
    modelProfile: {
      id: input.modelProfile.id,
      providerAccountId: input.modelProfile.content.providerAccountId,
      capability: input.modelProfile.content.capability,
      displayName: input.modelProfile.content.displayName,
      providerModelId: input.modelProfile.content.providerModelId,
      config: input.modelProfile.content.config,
    },
  })
}
