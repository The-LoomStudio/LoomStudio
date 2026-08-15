import type { DocumentRecord, DocumentStore } from '@loom-studio/document-store'
import type { AgentMessage } from '@loom-studio/agent-store'
import type { JsonValue } from '@loom-studio/shared'
import {
  assertProviderModelExists,
  assertNonEmpty,
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
  toCardSummary,
  toCardSource,
} from './card.js'
import { createApplicationRuntimeContext, type ApplicationRuntimeContext } from './application-context.js'
import { applicationDocumentTypes } from './document-types.js'
import { listDocuments, readDocument, toVersioned, writeDocument } from './document-store.js'
import { executeDocumentMutation } from './mutation.js'
import {
  createOfficialPromptResourceContents,
  officialPromptResourceIds,
} from './prompt-resource-defaults.js'
import type { ActivationFacts } from './prompt-activation.js'
import { buildOpenAIChatPayload, type OpenAIChatPayload } from './provider-payload.js'
import { composeAgentTurnPrompt } from './agent-turn.js'
import {
  createPromptResource,
  createPromptResourceAsset,
  deletePromptResource,
  deletePromptResourceAsset,
  duplicatePromptResource,
  exportCardArtifact,
  exportPromptResourceArtifact,
  getImportBundle,
  getPromptResource,
  importCardBundle,
  importPromptResourceArtifact,
  isCardBundleArtifact,
  listCardPromptResources,
  listPromptResources,
  movePromptResourceAsset,
  updatePresetSettingLinks,
  updatePromptResourceAsset,
  updatePromptResourceAssets,
  updateCardPromptResources,
  type CardBundleArtifact,
  type PromptResourceContent,
} from './workspace.js'
import type {
  AgentProfileContent,
  ApplicationRuntime,
  ApplicationRuntimeOptions,
  CardMediaRefs,
  CardSourceContent,
  ProviderProfileContent,
  ProviderProfileView,
  ProviderMessage,
  RuntimeRequestContext,
} from './types.js'

const applicationActor = { kind: 'kernel', id: 'application-runtime' } as const
const legacyOfficialAgentPresetId = 'agent-preset.official.loom-assistant'

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
    initialize: async () => {
      const timestamp = ctx.now()
      const promptContents = createOfficialPromptResourceContents(timestamp)
      const documentsToCreate = [
        {
          id: officialPromptResourceIds.assistantPreset,
          type: applicationDocumentTypes.promptResource,
          content: promptContents[0]!,
        },
        {
          id: officialPromptResourceIds.knowledgeSetting,
          type: applicationDocumentTypes.promptResource,
          content: promptContents[1]!,
        },
      ]
      const existing = await Promise.all(documentsToCreate.map(document => ctx.documents.get(document.id)))
      const existingProfiles = await listDocuments<AgentProfileContent>(ctx.documents, applicationDocumentTypes.agentProfile)
      const legacyOfficialPreset = await ctx.documents.get(legacyOfficialAgentPresetId)
      const officialPreset = existing[0] as DocumentRecord<PromptResourceContent> | undefined
      const officialPresetCurrent = officialPreset?.content.resourceKind === 'preset'
        && officialPreset.content.historyPolicy === 'persistent'
        && officialPreset.content.linkedSettingIds?.length === 1
        && officialPreset.content.linkedSettingIds[0] === officialPromptResourceIds.knowledgeSetting
      const hasLegacyProfile = existingProfiles.some(profile => profile.content.presetId === legacyOfficialAgentPresetId)
      if (existing.every(Boolean) && officialPresetCurrent && !legacyOfficialPreset && !hasLegacyProfile) return

      await ctx.documents.transact({
        actor: applicationActor,
        reason: 'application.initializePromptResources',
      }, async documents => {
        for (const document of documentsToCreate) {
          const current = await documents.get(document.id)
          if (current) {
            if (current.type !== document.type) {
              throw new Error(`Official Document id is occupied by another type: ${document.id}`)
            }
            if (document.id === officialPromptResourceIds.assistantPreset) {
              const content = current.content as PromptResourceContent
              if (content.resourceKind === 'preset') {
                await writeDocument(documents, {
                  id: current.id,
                  type: applicationDocumentTypes.promptResource,
                  content: {
                    ...content,
                    linkedSettingIds: [officialPromptResourceIds.knowledgeSetting],
                    historyPolicy: 'persistent',
                    updatedAt: timestamp,
                  },
                  expectedVersion: current.version,
                })
              }
            }
            continue
          }
          await writeDocument(documents, {
            id: document.id,
            type: document.type,
            content: document.content,
            expectedVersion: 'new',
          })
        }
        const profiles = await listDocuments<AgentProfileContent>(documents, applicationDocumentTypes.agentProfile)
        for (const profile of profiles.filter(item => item.content.presetId === legacyOfficialAgentPresetId)) {
          await writeDocument<AgentProfileContent>(documents, {
            id: profile.id,
            type: applicationDocumentTypes.agentProfile,
            content: {
              ...profile.content,
              presetId: officialPromptResourceIds.assistantPreset,
              updatedAt: timestamp,
            },
            expectedVersion: profile.version,
          })
        }
        const legacyPreset = await documents.get(legacyOfficialAgentPresetId)
        if (legacyPreset) await documents.delete({ id: legacyPreset.id, expectedVersion: legacyPreset.version })
      })
    },

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

    createProviderProfile: async (input, requestContext) => {
      assertNonEmpty(input.providerExtensionId, 'providerExtensionId')
      assertNonEmpty(input.displayName, 'displayName')
      assertProviderCredential(input.providerExtensionId, input.credential)
      const id = ctx.createId('provider-profile')
      const timestamp = ctx.now()
      const enabledModelIds = normalizeModelIds(input.enabledModelIds)
      const secret = input.credential
        ? await requireSecrets().create({
            ...secretWriteContext(requestContext, 'application.createProviderProfile.credential'),
            owner: { type: 'provider-profile', id },
            purpose: 'provider.credentials',
            label: input.displayName,
            plaintext: { values: input.credential },
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
          config: input.config ?? {},
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
      await readPresetResource(ctx.documents, input.presetId)
      await assertProviderModelExists(ctx.documents, input.model)

      const timestamp = ctx.now()
      const agentProfile = await writeDocument<AgentProfileContent>(ctx.documents, {
        id: ctx.createId('agent-profile'),
        type: applicationDocumentTypes.agentProfile,
        content: {
          name: input.name,
          presetId: input.presetId,
          model: input.model,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        expectedVersion: 'new',
      })

      return { agentProfile: toVersioned(agentProfile) }
    },

    getAgentProfile: async input => {
      const agentProfile = await readDocument<AgentProfileContent>(ctx.documents, input.agentProfileId, applicationDocumentTypes.agentProfile)
      return { agentProfile: toVersioned(agentProfile) }
    },

    listAgentProfiles: async input => {
      const result = await ctx.documents.list({
        type: applicationDocumentTypes.agentProfile,
        cursor: input?.cursor,
        limit: input?.limit,
      })

      return {
        agentProfiles: result.items.map(agentProfile => toVersioned(agentProfile as never)),
        nextCursor: result.nextCursor,
      }
    },

    updateProviderProfile: async input => {
      const existing = await readDocument<ProviderProfileContent>(ctx.documents, input.providerProfileId, applicationDocumentTypes.providerProfile)
      if (input.displayName !== undefined) assertNonEmpty(input.displayName, 'displayName')
      const timestamp = ctx.now()
      const updated = await writeDocument<ProviderProfileContent>(ctx.documents, {
        id: existing.id,
        type: applicationDocumentTypes.providerProfile,
        content: {
          ...existing.content,
          ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
          ...(input.config !== undefined ? { config: input.config } : {}),
          ...(input.enabledModelIds !== undefined ? { enabledModelIds: normalizeModelIds(input.enabledModelIds) } : {}),
          updatedAt: timestamp,
        },
        expectedVersion: existing.version,
      })
      return { providerProfile: await toProviderProfileView(ctx, updated) }
    },

    replaceProviderCredential: async (input, requestContext) => {
      const existing = await readDocument<ProviderProfileContent>(ctx.documents, input.providerProfileId, applicationDocumentTypes.providerProfile)
      assertProviderCredential(existing.content.providerExtensionId, input.credential)
      const secrets = requireSecrets()
      const owner = { type: 'provider-profile', id: existing.id }
      if (existing.content.secretRef) {
        const result = await secrets.replace({
          ...secretWriteContext(requestContext, 'application.replaceProviderCredential'),
          ref: existing.content.secretRef,
          owner,
          plaintext: { values: input.credential },
        })
        return { credential: { configured: true, updatedAt: result.metadata.updatedAt } }
      }
      const created = await secrets.create({
        ...secretWriteContext(requestContext, 'application.replaceProviderCredential'),
        owner,
        purpose: 'provider.credentials',
        label: existing.content.displayName,
        plaintext: { values: input.credential },
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
        await readPresetResource(ctx.documents, input.presetId)
      }
      if (input.model !== undefined) await assertProviderModelExists(ctx.documents, input.model)
      const timestamp = ctx.now()
      const updated = await writeDocument<AgentProfileContent>(ctx.documents, {
        id: existing.id,
        type: applicationDocumentTypes.agentProfile,
        content: {
          ...existing.content,
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.presetId !== undefined ? { presetId: input.presetId } : {}),
          ...(input.model !== undefined ? { model: input.model } : {}),
          updatedAt: timestamp,
        },
        expectedVersion: existing.version,
      })
      return { agentProfile: toVersioned(updated) }
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
        promptBuildTrace: prepared.prompt.promptBuildTrace,
        providerPayloadPreview: await buildProviderPayloadPreview({
          documents: ctx.documents,
          messages: prepared.prompt.messages,
          model: prepared.model,
        }),
      }
    },

    invokeAgentTurn: async (input, requestContext) => {
      if (!ctx.dataEngine) throw new Error('Data Engine is not configured')
      const agents = requireAgents()
      const prepared = await prepareAgentTurn(ctx, input, 'runtime', requestContext)
      const { model, narrativePage, narratives, prompt, runId, session } = prepared
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
        model,
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
        promptBuildTrace: prompt.promptBuildTrace,
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
      return {
        timeline,
        branches: await requireNarratives().listBranches(timeline.id),
      }
    },

    listNarrativeTimelines: input => requireNarratives().listTimelines(input),

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

    listPromptResources: async input => ({
      resources: await listPromptResources({
        documents: ctx.documents,
        resourceKind: input?.resourceKind,
      }),
    }),

    createPromptResource: async (input, requestContext) => {
      const mutation = await executeDocumentMutation(ctx.documents, requestContext, 'application.createPromptResource', async documents => {
        return await createPromptResource({
          createId: ctx.createId,
          documents,
          name: input.name,
          now: ctx.now(),
          resourceKind: input.resourceKind,
        })
      })
      return { resource: mutation.value, mutation: mutation.mutation }
    },

    duplicatePromptResource: async (input, requestContext) => {
      const mutation = await executeDocumentMutation(ctx.documents, requestContext, 'application.duplicatePromptResource', async documents => {
        return await duplicatePromptResource({
          createId: ctx.createId,
          documents,
          name: input.name,
          now: ctx.now(),
          resourceId: input.resourceId,
        })
      })
      return { resource: mutation.value, mutation: mutation.mutation }
    },

    deletePromptResource: async (input, requestContext) => {
      const resource = await getPromptResource({ documents: ctx.documents, resourceId: input.resourceId })
      if (resource.origin?.kind === 'builtin') {
        throw new Error(`Built-in Prompt Resource is read-only; duplicate it before editing: ${resource.id}`)
      }
      if (resource.resourceKind === 'preset') {
        const profiles = await listDocuments<AgentProfileContent>(ctx.documents, applicationDocumentTypes.agentProfile)
        if (profiles.some(profile => profile.content.presetId === input.resourceId)) {
          throw new Error(`Preset is still referenced by an Agent Profile: ${input.resourceId}`)
        }
      }
      const timelineReferences = await findTimelinePromptResourceReferences(ctx, input.resourceId)
      const detachedTimelines = await detachTimelinePromptResourceReferences(ctx, timelineReferences, input.resourceId, requestContext)
      let mutation
      try {
        mutation = await executeDocumentMutation(ctx.documents, requestContext, 'application.deletePromptResource', async documents => {
        const cards = await listDocuments<CardSourceContent>(documents, applicationDocumentTypes.cardSource)
        const referencedCards = cards.filter(card => card.content.promptResourceIds?.includes(input.resourceId))
        for (const card of referencedCards) {
          await writeDocument<CardSourceContent>(documents, {
            id: card.id,
            type: applicationDocumentTypes.cardSource,
            content: {
              ...card.content,
              promptResourceIds: card.content.promptResourceIds?.filter(id => id !== input.resourceId),
              updatedAt: ctx.now(),
            },
            expectedVersion: card.version,
          })
        }
        const presets = await listPromptResources({ documents, resourceKind: 'preset' })
        const referencedPresets = presets.filter(preset => preset.linkedSettingIds?.includes(input.resourceId))
        for (const preset of referencedPresets) {
          const { id, version, ...content } = preset
          await writeDocument<PromptResourceContent>(documents, {
            id,
            type: applicationDocumentTypes.promptResource,
            content: {
              ...content,
              linkedSettingIds: preset.linkedSettingIds?.filter(id => id !== input.resourceId),
              updatedAt: ctx.now(),
            },
            expectedVersion: version,
          })
        }
        await deletePromptResource({ documents, resourceId: input.resourceId })
          return {
            cards: referencedCards.length,
            presets: referencedPresets.length,
          }
        })
      } catch (error) {
        await restoreTimelinePromptResourceReferences(ctx, detachedTimelines, input.resourceId, requestContext)
        throw error
      }
      return {
        deleted: true as const,
        detachedReferences: {
          ...mutation.value,
          timelines: detachedTimelines.length,
        },
        mutation: mutation.mutation,
      }
    },

    importPromptResource: async (input, requestContext) => {
      const mutation = await executeDocumentMutation(ctx.documents, requestContext, 'application.importPromptResource', async documents => {
        return await importPromptResourceArtifact({
          artifact: input.artifact,
          createId: ctx.createId,
          documents,
          now: ctx.now(),
        })
      })
      return { resource: mutation.value, mutation: mutation.mutation }
    },

    exportPromptResource: async input => ({
      artifact: await exportPromptResourceArtifact({
        documents: ctx.documents,
        resourceId: input.resourceId,
      }),
    }),

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

    updatePresetSettings: async (input, requestContext) => {
      const mutation = await executeDocumentMutation(ctx.documents, requestContext, 'application.updatePresetSettings', async documents => {
        return await updatePresetSettingLinks({
          documents,
          linkedSettingIds: input.linkedSettingIds,
          now: ctx.now(),
          presetId: input.presetId,
        })
      })
      return { resource: mutation.value, mutation: mutation.mutation }
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
  const agentProfile = await readDocument<AgentProfileContent>(ctx.documents, session.agentProfileId, applicationDocumentTypes.agentProfile)
  const preset = await readPresetResource(ctx.documents, agentProfile.content.presetId)
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
      agentMessages: (preset.historyPolicy ?? 'persistent') === 'persistent'
        ? agentPage.messages.map(message => message.message)
        : [],
      documents: ctx.documents,
      narrative: narrativePage ? { nodes: narrativePage.nodes, timeline: narrativePage.timeline } : undefined,
      preset,
      userInput: input.input,
      buildId,
      runId,
      agentSessionId: session.id,
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
    model: agentProfile.content.model,
    narrativePage,
    narratives,
    prompt,
    runId,
    session,
  }
}

async function readPresetResource(
  documents: DocumentStore,
  presetId: string,
): Promise<PromptResourceContent & { id: string; version: number }> {
  const preset = await getPromptResource({ documents, resourceId: presetId })
  if (preset.resourceKind !== 'preset') throw new Error(`Prompt Resource is not a Preset: ${presetId}`)
  return preset
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

async function detachTimelinePromptResourceReferences(
  ctx: ApplicationRuntimeContext,
  timelines: Array<{ id: string; promptResourceIds: string[] }>,
  resourceId: string,
  requestContext: RuntimeRequestContext | undefined,
): Promise<Array<{ id: string; promptResourceIds: string[] }>> {
  if (!ctx.narratives) return []
  const detached: Array<{ id: string; promptResourceIds: string[] }> = []
  try {
    for (const timeline of timelines) {
      await ctx.narratives.updatePromptResources({
        ...narrativeWriteContextFromRequest(requestContext, 'application.deletePromptResource.detachTimeline'),
        timelineId: timeline.id,
        promptResourceIds: timeline.promptResourceIds.filter(id => id !== resourceId),
        expectedPromptResourceIds: timeline.promptResourceIds,
      })
      detached.push(timeline)
    }
  } catch (error) {
    await restoreTimelinePromptResourceReferences(ctx, detached, resourceId, requestContext)
    throw error
  }
  return detached
}

async function restoreTimelinePromptResourceReferences(
  ctx: ApplicationRuntimeContext,
  timelines: Array<{ id: string; promptResourceIds: string[] }>,
  resourceId: string,
  requestContext: RuntimeRequestContext | undefined,
): Promise<void> {
  if (!ctx.narratives) return
  for (const timeline of timelines) {
    const detachedIds = timeline.promptResourceIds.filter(id => id !== resourceId)
    await ctx.narratives.updatePromptResources({
      ...narrativeWriteContextFromRequest(requestContext, 'application.deletePromptResource.restoreTimeline'),
      timelineId: timeline.id,
      promptResourceIds: timeline.promptResourceIds,
      expectedPromptResourceIds: detachedIds,
    })
  }
}

function narrativeWriteContextFromRequest(requestContext: RuntimeRequestContext | undefined, reason: string) {
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

function assertProviderCredential(providerExtensionId: string, credential: Record<string, string> | undefined): void {
  if (!credential) return
  if (
    (providerExtensionId === 'official.openai-compatible' || providerExtensionId === 'openai-compatible')
    && !credential.apiKey?.trim()
  ) {
    throw new Error('OpenAI-compatible Provider credential requires apiKey')
  }
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
