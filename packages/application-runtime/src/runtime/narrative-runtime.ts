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
import { snapshotLoomScriptMounts } from '../scripts/loom-script-resolution.js'
import type { NarrativePage } from '@loom-studio/narrative-store'
import { parseTimelineArchive, timelineArchivePendingId, type TimelineArchive, type TimelineArchiveIdMap, type TimelineArchivePendingContent } from '../archive/timeline-archive.js'
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
  TextExtractorContent,
  TextTransformRuleContent,
} from '../types.js'
import {
  narrativeWriteContext,
  requireDocumentParticipant,
  requireNarratives,
  tombstoneExtensionStorageScope,
} from './context.js'
import { executeDocumentMutation } from '../foundation/mutation.js'

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

    exportTimelineArchive: async (input: { timelineId: string }): Promise<{ archive: TimelineArchive }> => {
      const narratives = requireNarratives(ctx)
      const timeline = await narratives.getTimeline(input.timelineId)
      if (!timeline) throw new Error(`Narrative timeline not found: ${input.timelineId}`)
      const branches = await narratives.listBranches(timeline.id)
      const nodes = await narratives.listNodes(timeline.id)
      const scope = await ctx.states.getScope({ kind: 'timeline', ownerId: timeline.id })
      if (!scope) throw new Error(`Timeline State scope not found: ${timeline.id}`)
      const revisions = await ctx.states.listRevisions(scope.id)
      const participants = await ctx.timelineArchiveParticipants.exportParticipants({
        timelineId: timeline.id,
        branchIds: branches.map(branch => branch.id),
        nodeIds: nodes.map(node => node.id),
        stateRevisionIds: revisions.map(revision => revision.id),
      })
      return { archive: {
        format: 'loom-timeline-archive.v1',
        exportedAt: ctx.now(),
        timeline,
        branches,
        nodes,
        state: { scope, revisions },
        participants,
      } }
    },

    importTimelineArchive: async (input: { source: string }) => {
      const archive = parseTimelineArchive(input.source)
      const narratives = requireNarratives(ctx)
      const timelineId = ctx.createId('timeline')
      const idMap: TimelineArchiveIdMap = {
        timelineId,
        branchIds: Object.fromEntries(archive.branches.map(branch => [branch.id, ctx.createId('branch')])),
        nodeIds: Object.fromEntries(archive.nodes.map(node => [node.id, ctx.createId('node')])),
        stateRevisionIds: Object.fromEntries(archive.state.revisions.map(revision => [revision.id, ctx.createId('state-revision')])),
      }
      const revisions = orderArchiveItems(archive.state.revisions, item => item.parentRevisionId)
      const branches = orderArchiveItems(archive.branches, item => item.parentBranchId)
      const roots = branches.filter(branch => !branch.parentBranchId)
      const root = roots[0]
      if (!root || roots.length !== 1) throw new Error('Timeline archive must have one root branch')
      const nodes = new Map(archive.nodes.map(node => [node.id, node]))
      const result = await ctx.dataEngine.transact(
        narrativeWriteContext(undefined, 'application.importTimelineArchive'),
        async dataTx => {
          const stateTx = ctx.states.transaction(dataTx)
          const narrativeTx = narratives.transaction(dataTx)
          const scope = stateTx.createScope({ kind: 'timeline', ownerId: timelineId })
          for (const revision of revisions) stateTx.createRevision({
            id: idMap.stateRevisionIds[revision.id], scopeId: scope.id,
            parentRevisionId: revision.parentRevisionId ? idMap.stateRevisionIds[revision.parentRevisionId] : undefined,
            snapshot: revision.snapshot, operations: revision.operations,
          })
          narrativeTx.createTimeline({
            id: timelineId, primaryBranchId: idMap.branchIds[root.id], title: archive.timeline.title,
            primaryBranchTitle: root.title, stateRevisionId: idMap.stateRevisionIds[root.stateHeadRevisionId]!,
          })
          const inserted = new Set<string>()
          for (const branch of branches) {
            let head = branch.forkedFromNodeId
            if (branch.parentBranchId) {
              if (!head) throw new Error('Timeline archive fork point is missing')
              narrativeTx.forkBranch({ timelineId, branchId: idMap.branchIds[branch.id],
                fromBranchId: idMap.branchIds[branch.parentBranchId]!, fromNodeId: idMap.nodeIds[head]!,
                stateRevisionId: idMap.stateRevisionIds[branch.stateHeadRevisionId]!, title: branch.title,
              })
            }
            const path = []
            let nodeId = branch.headNodeId
            const visited = new Set<string>()
            while (nodeId && nodeId !== head) {
              if (visited.has(nodeId)) throw new Error('Timeline archive node cycle')
              visited.add(nodeId)
              const node = nodes.get(nodeId)
              if (!node) throw new Error('Timeline archive node parent is missing')
              path.unshift(node)
              nodeId = node.parentNodeId
            }
            if (path.length > 0 && head && nodeId !== head) throw new Error('Timeline archive fork point is outside its branch')
            for (const node of path) {
              if (inserted.has(node.id)) throw new Error('Timeline archive branch shares nodes beyond its fork point')
              narrativeTx.appendNode({ timelineId, branchId: idMap.branchIds[branch.id]!,
                expectedHeadNodeId: head ? idMap.nodeIds[head]! : null, nodeId: idMap.nodeIds[node.id],
                body: node.body, stateRevisionId: idMap.stateRevisionIds[node.stateRevisionId]!,
              })
              inserted.add(node.id)
              head = node.id
            }
            narrativeTx.setBranchStateHead({
              timelineId,
              branchId: idMap.branchIds[branch.id]!,
              expectedStateHeadRevisionId: idMap.stateRevisionIds[path.at(-1)?.stateRevisionId ?? (branch.parentBranchId ? branch.stateHeadRevisionId : root.stateHeadRevisionId)]!,
              stateRevisionId: idMap.stateRevisionIds[branch.stateHeadRevisionId]!,
            })
          }
          if (inserted.size !== archive.nodes.length) throw new Error('Timeline archive contains unreachable nodes')
          narrativeTx.switchBranch({ timelineId, branchId: idMap.branchIds[archive.timeline.activeBranchId]! })
        },
      )
      const participantResult = await ctx.timelineArchiveParticipants.importParticipants({
        timelineId,
        idMap,
        blocks: archive.participants,
      })
      if (participantResult.unknownNamespaces.length > 0 || participantResult.failures.length > 0) {
        const pendingBlocks = archive.participants.filter(block => participantResult.unknownNamespaces.includes(block.namespace))
        await executeDocumentMutation(ctx.documents, undefined, 'application.importTimelineArchive.pendingParticipants', async documents => {
          const id = timelineArchivePendingId(timelineId)
          const existing = await documents.get(id)
          const timestamp = ctx.now()
          const content: TimelineArchivePendingContent = {
            timelineId,
            blocks: pendingBlocks,
            failures: participantResult.failures,
            createdAt: existing?.content && typeof existing.content === 'object' && !Array.isArray(existing.content) && typeof (existing.content as { createdAt?: unknown }).createdAt === 'string'
              ? (existing.content as { createdAt: string }).createdAt
              : timestamp,
            updatedAt: timestamp,
          }
          await documents.write({
            id,
            type: applicationDocumentTypes.timelineArchivePending,
            content,
            expectedVersion: existing?.version ?? 'new',
          })
        })
      }
      return { timelineId, idMap, unknownParticipantNamespaces: participantResult.unknownNamespaces, participantFailures: participantResult.failures, mutation: { changesetId: result.commit.changesetId } }
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

function orderArchiveItems<T extends { id: string }>(items: T[], parentId: (item: T) => string | undefined): T[] {
  const remaining = new Map(items.map(item => [item.id, item]))
  if (remaining.size !== items.length) throw new Error('Timeline archive contains duplicate IDs')
  const ordered: T[] = []
  const known = new Set<string>()
  while (remaining.size) {
    const before = remaining.size
    for (const [id, item] of remaining) {
      const parent = parentId(item)
      if (parent && !known.has(parent)) continue
      ordered.push(item)
      known.add(id)
      remaining.delete(id)
    }
    if (remaining.size === before) throw new Error('Timeline archive contains a cycle or missing parent')
  }
  return ordered
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
  const textExtractors = (await listDocuments<TextExtractorContent>(ctx.documents, applicationDocumentTypes.textExtractor))
    .filter(extractor => extractor.content.owner.kind === 'card' && extractor.content.owner.cardId === input.card.id)
    .map(extractor => ({ ...extractor.content, id: extractor.id, version: extractor.version }))
  const loomScriptMounts = await snapshotLoomScriptMounts(ctx, { kind: 'card', cardId: input.card.id })
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
    textExtractors,
    loomScriptMounts,
    createdAt: ctx.now(),
  }
}
