import type { DocumentRecord } from '@loom-studio/document-store'
import type { JsonObject } from '@loom-studio/shared'
import type { ApplicationRuntimeContext } from '../foundation/application-context.js'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import { listDocuments, readDocument, writeDocument } from '../foundation/document-store.js'
import { normalizeCardContent, readOpeningEntries } from '../cards/card.js'
import { composeStateContributions, createCardStateContribution, materializeStateContribution } from '../state/state-contribution.js'
import type { StateContributionSource } from '../state/state-contribution-registry.js'
import { createVariableRenderContext, type VariableRenderContext } from '../prompt/variables.js'
import { timelineRuntimeContextId } from '../narrative/timeline-runtime-context.js'
import type { NarrativePage } from '@loom-studio/narrative-store'
import type {
  CardSourceContent,
  MaterializedStateContribution,
  CreateNarrativeTimelineInput,
  CreateNarrativeTimelineResult,
  DeleteNarrativeTimelineInput,
  DeleteNarrativeTimelineResult,
  UpdateNarrativeTimelineInput,
  UpdateNarrativeTimelineResult,
  ForkNarrativeBranchInput,
  ForkNarrativeBranchResult,
  GetNarrativePageInput,
  GetNarrativeTimelineInput,
  GetNarrativeTimelineResult,
  ListNarrativeTimelinesInput,
  ListNarrativeTimelinesResult,
  RuntimeRequestContext,
  StateDefinitionContent,
  StateDefinitionDraft,
  SwitchNarrativeBranchInput,
  SwitchNarrativeBranchResult,
  TimelineRuntimeContextContent,
  TextTransformRuleContent,
} from '../types.js'
import {
  narrativeWriteContext,
  requireDocumentParticipant,
  requireNarratives,
  tombstoneExtensionStorageScope,
} from './context.js'

export function createNarrativeRuntimeMethods(ctx: ApplicationRuntimeContext) {
  return {
    createNarrativeTimeline: (input: CreateNarrativeTimelineInput, requestContext?: RuntimeRequestContext): Promise<CreateNarrativeTimelineResult> =>
      createTimelineFromCard(ctx, input, requestContext, 'application.createNarrativeTimeline'),

    getNarrativeTimeline: async (input: GetNarrativeTimelineInput): Promise<GetNarrativeTimelineResult> => {
      const timeline = await requireNarratives(ctx).getTimeline(input.timelineId)
      if (!timeline) throw new Error(`Narrative timeline not found: ${input.timelineId}`)
      return {
        timeline,
        branches: await requireNarratives(ctx).listBranches(timeline.id),
      }
    },

    listNarrativeTimelines: (input?: ListNarrativeTimelinesInput): Promise<ListNarrativeTimelinesResult> =>
      requireNarratives(ctx).listTimelines(input),

    getNarrativePage: (input: GetNarrativePageInput): Promise<NarrativePage> =>
      requireNarratives(ctx).getPage(input),

    forkNarrativeBranch: async (input: ForkNarrativeBranchInput, requestContext?: RuntimeRequestContext): Promise<ForkNarrativeBranchResult> => {
      const narratives = requireNarratives(ctx)
      const branches = await narratives.listBranches(input.timelineId)
      const sourceBranch = branches.find(branch => branch.id === input.fromBranchId)
      if (!sourceBranch) throw new Error(`Narrative branch not found: ${input.fromBranchId}`)
      const page = await narratives.getPage({ timelineId: input.timelineId, branchId: input.fromBranchId })
      const fromNode = page.nodes.find(node => node.id === input.fromNodeId)
      if (!fromNode) throw new Error(`Narrative node not found on branch: ${input.fromNodeId}`)
      const stateRevisionId = sourceBranch.headNodeId === fromNode.id
        ? sourceBranch.stateHeadRevisionId
        : fromNode.stateRevisionId
      const result = await requireNarratives(ctx).forkBranch({
        ...narrativeWriteContext(requestContext, 'application.forkNarrativeBranch'),
        ...input,
        stateRevisionId,
      })
      return { branch: result.branch, mutation: { changesetId: result.commit.changesetId } }
    },

    switchNarrativeBranch: async (input: SwitchNarrativeBranchInput, requestContext?: RuntimeRequestContext): Promise<SwitchNarrativeBranchResult> => {
      const result = await requireNarratives(ctx).switchBranch({
        ...narrativeWriteContext(requestContext, 'application.switchNarrativeBranch'),
        ...input,
      })
      return { timeline: result.timeline, mutation: { changesetId: result.commit.changesetId } }
    },

    deleteNarrativeTimeline: async (input: DeleteNarrativeTimelineInput, requestContext?: RuntimeRequestContext): Promise<DeleteNarrativeTimelineResult> => {
      const narratives = requireNarratives(ctx)
      const scope = await ctx.states.getScope({ kind: 'timeline', ownerId: input.timelineId })
      const documentParticipant = requireDocumentParticipant(ctx)
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

    updateNarrativeTimeline: async (input: UpdateNarrativeTimelineInput, requestContext?: RuntimeRequestContext): Promise<UpdateNarrativeTimelineResult> => {
      const result = await requireNarratives(ctx).updateTimeline({
        ...narrativeWriteContext(requestContext, 'application.updateNarrativeTimeline'),
        ...input,
      })
      return { timeline: result.timeline, mutation: { changesetId: result.commit.changesetId } }
    },
  }
}

export async function createTimelineFromCard(
  ctx: ApplicationRuntimeContext,
  input: { cardId: string; title?: string },
  requestContext: RuntimeRequestContext | undefined,
  reason: string,
) {
  const narratives = requireNarratives(ctx)
  const card = await readDocument<CardSourceContent>(ctx.documents, input.cardId, applicationDocumentTypes.cardSource)
  const cardContent = normalizeCardContent(card.content)
  const templates = new Map<string, Extract<StateDefinitionDraft, { kind: 'timeline-template' }>>()
  for (const template of cardContent.stateTemplates ?? []) {
    templates.set(template.id, {
      kind: 'timeline-template',
      templateVersion: template.templateVersion,
      schema: template.schema,
      initial: template.initial,
      ...(template.componentKey !== undefined ? { componentKey: template.componentKey } : {}),
      ...(template.targetEntityTypeIds !== undefined ? { targetEntityTypeIds: [...template.targetEntityTypeIds] } : {}),
      ...(template.label !== undefined ? { label: template.label } : {}),
    })
  }
  for (const definitionId of cardContent.stateDefinitionIds ?? []) {
    if (templates.has(definitionId)) continue
    try {
      const definition = await readDocument<StateDefinitionContent>(ctx.documents, definitionId, applicationDocumentTypes.stateDefinition)
      if (definition.content.kind === 'timeline-template') {
        templates.set(definition.id, definition.content)
      }
    } catch {
      // Global definition may be omitted if template is self-contained
    }
  }
  const contributionSources = (cardContent.stateContributionIds ?? []).map(contributionId => {
    const source = ctx.stateContributions.get(contributionId)
    if (!source) throw new Error(`Card State contribution is not registered: ${contributionId}`)
    return source
  })
  const composedContribution = composeStateContributions(`timeline:${card.id}`, [
    createCardStateContribution(card.id, cardContent, templates),
    ...contributionSources.map(source => source.contribution),
  ])
  templates.clear()
  for (const template of composedContribution.templates) {
    templates.set(template.id, {
      kind: 'timeline-template',
      templateVersion: template.templateVersion,
      schema: template.schema,
      initial: template.initial,
      ...(template.componentKey !== undefined ? { componentKey: template.componentKey } : {}),
      ...(template.targetEntityTypeIds !== undefined ? { targetEntityTypeIds: [...template.targetEntityTypeIds] } : {}),
      ...(template.label !== undefined ? { label: template.label } : {}),
    })
  }
  const materializedState = materializeStateContribution(composedContribution)
  const initialState = materializedState.snapshot
  const timelineId = ctx.createId('timeline')
  const branchId = ctx.createId('branch')
  const stateScopeId = ctx.createId('state-scope')
  const stateRevisionId = ctx.createId('state-revision')
  const runtimeContext = await buildTimelineRuntimeContext(ctx, {
    timelineId,
    card,
    cardContent,
    templates,
    materializedState,
    contributionSources,
  })
  const variables = await readAgentTurnVariables(ctx, runtimeContext.fallbackUserName, initialState, cardContent.name)
  const openingEntries = readOpeningEntries(cardContent, variables)
  const transaction = await ctx.dataEngine.transact(
    narrativeWriteContext(requestContext, reason),
    async dataTx => requireDocumentParticipant(ctx).participateTransaction(dataTx, async documents => {
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

export async function readAgentTurnVariables(
  ctx: ApplicationRuntimeContext,
  fallbackUserName: string | undefined,
  timeline?: JsonObject,
  characterName?: string,
): Promise<VariableRenderContext> {
  const globalSnapshot = await ctx.states.getGlobalSnapshot()
  const global = structuredClone(globalSnapshot?.revision.snapshot ?? {}) as JsonObject
  const fallbackUser = fallbackUserName?.trim() || 'User'
  const user = global.user as JsonObject | undefined
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
      ...(characterName ? {
        char: { name: characterName },
        bot: { name: characterName },
      } : {}),
    },
  })
}

export async function readLegacyCardUserName(
  ctx: ApplicationRuntimeContext,
  cardId: string | undefined,
): Promise<string | undefined> {
  if (!cardId) return undefined
  const card = await readDocument<CardSourceContent>(ctx.documents, cardId, applicationDocumentTypes.cardSource)
  return card.content.userName
}

export async function buildTimelineRuntimeContext(
  ctx: ApplicationRuntimeContext,
  input: {
    timelineId: string
    card: DocumentRecord<CardSourceContent>
    cardContent: CardSourceContent
    templates: Map<string, Extract<StateDefinitionDraft, { kind: 'timeline-template' }>>
    materializedState: MaterializedStateContribution
    contributionSources: StateContributionSource[]
  },
): Promise<TimelineRuntimeContextContent> {
  const textTransformRules = (await listDocuments<TextTransformRuleContent>(ctx.documents, applicationDocumentTypes.textTransformRule))
    .filter(rule => rule.content.owner.kind === 'card' && rule.content.owner.cardId === input.card.id)
    .map(rule => ({ ...rule.content, id: rule.id, version: rule.version }))
  return {
    timelineId: input.timelineId,
    sourceCardId: input.card.id,
    sourceCardVersion: input.card.version,
    cardName: input.cardContent.name,
    fallbackUserName: input.cardContent.userName?.trim() || 'User',
    ...(input.cardContent.macros !== undefined ? { macros: structuredClone(input.cardContent.macros) } : {}),
    stateEntityTypes: structuredClone(input.materializedState.entityTypes),
    stateEntities: structuredClone(input.materializedState.entities),
    stateComponents: structuredClone(input.materializedState.components),
    stateReferences: structuredClone(input.materializedState.references),
    stateContributionSources: input.contributionSources.map(source => ({
      contributionId: source.contributionId,
      packageId: source.packageId,
      moduleId: source.moduleId,
      packageVersion: source.packageVersion,
    })),
    stateBindings: input.materializedState.bindings.map(binding => {
      const template = input.templates.get(binding.templateId)
      if (!template) throw new Error(`Timeline State template not found: ${binding.templateId}`)
      return { path: binding.path, schema: structuredClone(template.schema) }
    }),
    textTransformRules,
    createdAt: ctx.now(),
  }
}
