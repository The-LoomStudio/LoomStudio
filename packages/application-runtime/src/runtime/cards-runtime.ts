import type { DocumentRecord, DocumentStore, DocumentTransaction } from '@loom-studio/document-store'
import type { SqliteDataTransaction } from '@loom-studio/data-engine'
import type { NarrativeTimeline } from '@loom-studio/narrative-store'
import type { JsonObject, JsonValue } from '@loom-studio/shared'
import type { ApplicationRuntimeContext } from '../foundation/application-context.js'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import { listDocuments, readDocument, writeDocument } from '../foundation/document-store.js'
import { executeDocumentMutation } from '../foundation/mutation.js'
import {
  normalizeCardContent,
  normalizeCardMedia,
  normalizeOpening,
  normalizeOptionalString,
  normalizePreset,
  normalizeSettingLayer,
  toCardSource,
  toCardSummary,
} from '../cards/card.js'
import {
  exportCardArtifact,
  importCardBundle as importWorkspaceCardBundle,
  isCardBundleArtifact,
  type CardBundleArtifact,
} from '../cards/workspace.js'
import { validateTimelineStateBinding } from '../state/state-definition.js'
import { readTimelineRuntimeContext, timelineRuntimeContextId } from '../narrative/timeline-runtime-context.js'
import type {
  CardMediaRefs,
  CardSourceContent,
  CreateCardInput,
  CreateCardResult,
  DeleteCardInput,
  DeleteCardResult,
  ExportCardBundleInput,
  ExportCardBundleResult,
  GetCardInput,
  GetCardResult,
  ImportCardBundleInput,
  ImportCardBundleResult,
  ListCardsInput,
  ListCardsResult,
  PreviewCardDeletionInput,
  PreviewCardDeletionResult,
  RuntimeRequestContext,
  StateDefinitionContent,
  StateDefinitionDraft,
  TimelineRuntimeContextContent,
  TextTransformRuleContent,
  UpdateCardInput,
  UpdateCardPromptResourcesInput,
  UpdateCardPromptResourcesResult,
  UpdateCardResult,
} from '../types.js'
import {
  applicationActor,
  narrativeWriteContext,
  promptResourceWriteContext,
  requireDocumentParticipant,
  requireNarratives,
  tombstoneExtensionStorageScope,
} from './context.js'

export function createCardsRuntimeMethods(ctx: ApplicationRuntimeContext) {
  return {
    createCard: async (input: CreateCardInput, requestContext?: RuntimeRequestContext): Promise<CreateCardResult> => {
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

    getCard: async (input: GetCardInput): Promise<GetCardResult> => {
      const card = await readDocument<CardSourceContent>(ctx.documents, input.cardId, applicationDocumentTypes.cardSource)
      return {
        card: toCardSource(card),
      }
    },

    listCards: async (input?: ListCardsInput): Promise<ListCardsResult> => {
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

    updateCard: async (input: UpdateCardInput, requestContext?: RuntimeRequestContext): Promise<UpdateCardResult> => {
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

    previewCardDeletion: async (input: PreviewCardDeletionInput): Promise<PreviewCardDeletionResult> => {
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

    deleteCard: async (input: DeleteCardInput, requestContext?: RuntimeRequestContext): Promise<DeleteCardResult> => {
      const card = await readDocument<CardSourceContent>(ctx.documents, input.cardId, applicationDocumentTypes.cardSource)
      const timelines = ctx.narratives ? await listAllCardTimelines(ctx, input.cardId) : []
      const ownedRules = (await listDocuments<TextTransformRuleContent>(ctx.documents, applicationDocumentTypes.textTransformRule))
        .filter(rule => rule.content.owner.kind === 'card' && rule.content.owner.cardId === input.cardId)

      const targetResources = input.includePromptResources
        ? (await Promise.all((card.content.promptResourceIds ?? []).map(id => ctx.promptResources.getResource(id))))
            .filter((resource): resource is NonNullable<typeof resource> => Boolean(resource && !resource.tombstoned))
        : []

      const deleteCascadeResources = async (
        dataTx: SqliteDataTransaction,
        documents: DocumentTransaction,
      ) => {
        if (!input.includePromptResources) return
        const resourceTx = ctx.promptResources.transaction(dataTx)
        for (const resource of targetResources) {
          resourceTx.deleteResource({ resourceId: resource.id, expectedVersion: resource.version })
        }
        for (const payloadId of card.content.portableExtensionPayloadIds ?? []) {
          const payloadDoc = await documents.get(payloadId)
          if (payloadDoc && !payloadDoc.meta.tombstone) {
            await documents.delete({ id: payloadDoc.id, expectedVersion: payloadDoc.version })
          }
        }
        if (card.content.importBundleId) {
          const bundleDoc = await documents.get(card.content.importBundleId)
          if (bundleDoc && !bundleDoc.meta.tombstone) {
            await documents.delete({ id: bundleDoc.id, expectedVersion: bundleDoc.version })
          }
        }
      }

      if (input.includePlayData && timelines.length > 0) {
        const narratives = requireNarratives(ctx)
        const documentParticipant = requireDocumentParticipant(ctx)
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
            await deleteCascadeResources(dataTx, documents)
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
        missingRuntimeContexts.push(await buildTimelineRuntimeContextInternal(ctx, {
          timelineId: timeline.id,
          card,
          cardContent,
          templates,
        }))
      }

      if (input.includePromptResources) {
        const documentParticipant = requireDocumentParticipant(ctx)
        const result = await ctx.dataEngine.transact(
          narrativeWriteContext(requestContext, 'application.deleteCard'),
          async dataTx => documentParticipant.participateTransaction(dataTx, async documents => {
            await deleteCascadeResources(dataTx, documents)
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
          }, { allowEmpty: true }),
        )
        return { deleted: true as const, mutation: { changesetId: result.commit.changesetId } }
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

    updateCardPromptResources: async (
      input: UpdateCardPromptResourcesInput,
      requestContext?: RuntimeRequestContext,
    ): Promise<UpdateCardPromptResourcesResult> => {
      if (new Set(input.promptResourceIds).size !== input.promptResourceIds.length) throw new Error('Duplicate prompt resource id')
      for (const resourceId of input.promptResourceIds) {
        if (!await ctx.promptResources.getResource(resourceId)) throw new Error(`Prompt resource not found: ${resourceId}`)
      }
      const documentParticipant = requireDocumentParticipant(ctx)
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

    importCardBundle: async (
      input: ImportCardBundleInput,
      requestContext?: RuntimeRequestContext,
    ): Promise<ImportCardBundleResult> => {
      const artifact = input.source ? parseCardBundleSource(input.source.text) : input.artifact
      await assertCardMedia(ctx, artifact.card.media)
      const storedSourceArtifact = ctx.sourceArtifacts && input.source
        ? await ctx.sourceArtifacts.preserve({
          source: new TextEncoder().encode(input.source.text),
          format: 'loom.cardBundle',
          originalFileName: input.source.originalFileName,
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
      return await importWorkspaceCardBundle({
        artifact,
        context: requestContext,
        documents: ctx.documents,
        promptResources: ctx.promptResources,
        dataEngine: ctx.dataEngine,
        now: ctx.now(),
        storedSourceArtifact,
      })
    },

    exportCardBundle: async (input: ExportCardBundleInput): Promise<ExportCardBundleResult> => {
      return {
        artifact: await exportCardArtifact({
          cardId: input.cardId,
          documents: ctx.documents,
          promptResources: ctx.promptResources,
        }),
      }
    },
  }
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

async function assertCardMedia(ctx: ApplicationRuntimeContext, media: CardMediaRefs | undefined): Promise<void> {
  const assetIds = [...new Set([media?.avatarAssetId, media?.coverAssetId].filter((value): value is string => Boolean(value)))]
  if (assetIds.length === 0) return
  if (!ctx.mediaAssets) throw new Error('Media Asset Store is not configured')
  for (const assetId of assetIds) {
    if (!await ctx.mediaAssets.get(assetId)) throw new Error(`Media Asset not found: ${assetId}`)
  }
}

async function listAllCardTimelines(
  ctx: ApplicationRuntimeContext,
  cardId: string,
): Promise<NarrativeTimeline[]> {
  const timelines: NarrativeTimeline[] = []
  let cursor: string | undefined
  do {
    const page = await ctx.narratives!.listTimelines({ createdFromCardId: cardId, ...(cursor ? { cursor } : {}), limit: 100 })
    timelines.push(...page.timelines)
    cursor = page.nextCursor
  } while (cursor)
  return timelines
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
    const entries = await listDocuments<JsonObject>(documents, type)
    for (const entry of entries) {
      if (hasCardExtensionStorageScope(entry.content, cardId)) counts.cardScoped[key] += 1
      if (hasTimelineExtensionStorageScope(entry.content, timelineIds)) {
        counts.timelineScoped[key] += 1
      }
    }
  }
  return counts
}

function hasCardExtensionStorageScope(content: JsonObject, cardId: string): boolean {
  const scope = content.scope as JsonObject | undefined
  return Boolean(scope && scope.kind === 'card' && scope.cardId === cardId)
}

function hasTimelineExtensionStorageScope(content: JsonObject, timelineIds: ReadonlySet<string>): boolean {
  const scope = content.scope as JsonObject | undefined
  return Boolean(
    scope
    && typeof scope === 'object'
    && !Array.isArray(scope)
    && scope.kind === 'timeline'
    && typeof scope.timelineId === 'string'
    && timelineIds.has(scope.timelineId),
  )
}

async function buildTimelineRuntimeContextInternal(
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
    .map(rule => ({ ...rule.content, id: rule.id, version: rule.version }))
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
