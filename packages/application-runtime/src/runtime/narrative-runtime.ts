import { readUserProfiles, resolveCurrentUserProfile } from '../profiles/user-profiles.js'
import { workspaceBinaryLimit } from './workspace-runtime.js'
import type { DocumentRecord } from '@loom-studio/document-store'
import type { JsonObject } from '@loom-studio/shared'
import type { ApplicationRuntimeContext } from '../foundation/application-context.js'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import { listDocuments, readDocument, writeDocument } from '../foundation/document-store.js'
import { normalizeCardContent, parseCardExtensionAdoptions, readOpening } from '../cards/card.js'
import { composeStateContributions, createCardStateContribution, materializeStateContribution } from '../state/state-contribution.js'
import { expandTimelineStateBindings } from '../state/state-definition.js'
import type { StateContributionSource } from '../state/state-contribution-registry.js'
import { createVariableRenderContext, renderVariableMacros, type VariableRenderContext } from '../prompt/variables.js'
import { fromStoredResource } from '../prompt/prompt-resource-mapper.js'
import type { PromptResourceNode } from '../cards/workspace-types.js'
import { readAvailableExtensionInstallations, isExtensionResourceAvailable } from './extension-resource-access.js'
import type { ExtensionStateInitializationContext } from '@loom-studio/extension-sdk'
import { extensionInstallationId } from '@loom-studio/extension-sdk'
import { timelineExtensionParticipationId } from '../extensions/timeline-participation.js'
import { timelineRuntimeContextId } from '../narrative/timeline-runtime-context.js'
import { deleteTimelinePresetConfigs, listTimelinePresetConfigs, timelinePresetConfigId } from '../prompt/timeline-preset-config.js'
import { normalizeMacroSelections } from '@loom-studio/shared'
import type { NarrativeNode, NarrativePage } from '@loom-studio/application-data'
import { createNarrativeSampler } from '../narrative/sampling.js'
import { composeTimelineArchiveIdMap, parseTimelineArchive, timelineArchivePendingId, type TimelineArchive, type TimelineArchiveIdMap, type TimelineArchivePendingContent } from '../archive/timeline-archive.js'
import type {
  AppendNarrativeInput,
  AppendNarrativeInputResult,
  CardSourceContent,
  MaterializedStateContribution,
  CreateNarrativeTimelineInput,
  CreateNarrativeTimelineResult,
  ImportNarrativeHistoryInput,
  ReplaceNarrativeOpeningInput,
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
  ExtensionInstallationContent,
  TimelineExtensionParticipationContent,
} from '../types.js'
import {
  narrativeWriteContext,
  requireDocumentParticipant,
  requireNarratives,
  tombstoneExtensionStorageScope,
} from './context.js'
import { executeDocumentMutation } from '../foundation/mutation.js'

type NarrativeRuntimeContext = Pick<ApplicationRuntimeContext,
  'workspaces' | 'blobs' | 'agents' | 'createId' | 'dataEngine' | 'documents' | 'narratives' | 'narrativeActivity' | 'narrativeContext' | 'now' | 'promptResources' | 'stateContributions' | 'states' | 'timelineArchiveParticipants'
>

export function createNarrativeRuntimeMethods(ctx: NarrativeRuntimeContext) {
  return {
    createNarrativeTimeline: (input: CreateNarrativeTimelineInput, requestContext?: RuntimeRequestContext): Promise<CreateNarrativeTimelineResult> =>
      createTimelineFromCard(ctx, input, requestContext, 'application.createNarrativeTimeline'),

    importNarrativeHistory: (input: ImportNarrativeHistoryInput, requestContext?: RuntimeRequestContext): Promise<CreateNarrativeTimelineResult> =>
      createTimelineFromCard(ctx, { cardId: input.cardId, title: input.title, openingContent: '' }, requestContext,
        'application.importNarrativeHistory', input.messages),

    replaceNarrativeOpening: async (input: ReplaceNarrativeOpeningInput, requestContext?: RuntimeRequestContext): Promise<CreateNarrativeTimelineResult> => {
      if (input.openingId !== undefined && input.openingContent !== undefined)
        throw new Error('Choose an opening ID or custom opening content, not both')
      const narratives = requireNarratives(ctx)
      const timeline = await narratives.getTimeline(input.timelineId)
      if (!timeline?.opening || timeline.opening.locked || !timeline.createdFrom) throw new Error('Narrative opening is locked')
      const branch = await narratives.getBranch(input.branchId)
      if (!branch || branch.timelineId !== timeline.id) throw new Error('Narrative branch not found')
      const card = await readDocument<CardSourceContent>(ctx.documents, timeline.createdFrom.cardId, applicationDocumentTypes.cardSource)
      if (input.expectedCardVersion !== undefined && input.expectedCardVersion !== card.version)
        throw new Error('Card changed while choosing an opening; reload the Card before starting')
      const content = normalizeCardContent(card.content)
      const revision = await ctx.states.getRevision(branch.stateHeadRevisionId)
      if (!revision) throw new Error('Narrative State revision not found')
      const variables = await readAgentTurnVariables(ctx, revision.snapshot, content.name)
      const selected = input.openingContent === undefined ? readOpening(content, variables, input.openingId) : undefined
      const openingContent = input.openingContent ?? selected!.content
      requestContext?.abortSignal?.throwIfAborted()
      const result = await ctx.dataEngine.transact(
        narrativeWriteContext(requestContext, 'application.replaceNarrativeOpening'),
        async dataTx => requireDocumentParticipant(ctx).participateTransaction(dataTx, async documents => {
          const currentCard = await readDocument<CardSourceContent>(documents, card.id, applicationDocumentTypes.cardSource)
          if (currentCard.version !== card.version) throw new Error('Card changed while choosing an opening')
          return narratives.transaction(dataTx).replaceOpening({
            timelineId: input.timelineId, branchId: input.branchId, expectedHeadNodeId: input.expectedHeadNodeId,
            expectedStateHeadRevisionId: branch.stateHeadRevisionId,
            openingId: selected?.id,
            openingNode: openingContent.trim() ? { body: { format: 'loom-markdown.v1', raw: openingContent } } : undefined,
          })
        }, { allowEmpty: true }),
      )
      return { ...result.value.value, mutation: { changesetId: result.commit.changesetId } }
    },

    getNarrativeTimeline: async (input: GetNarrativeTimelineInput): Promise<GetNarrativeTimelineResult> => {
      const timeline = await requireNarratives(ctx).getTimeline(input.timelineId)
      if (!timeline) throw new Error(`Narrative timeline not found: ${input.timelineId}`)
      return {
        timeline,
        branches: await requireNarratives(ctx).listBranches(timeline.id),
      }
    },

    exportTimelineArchive: async (input: { timelineId: string }): Promise<{ archive: TimelineArchive }> => ctx.dataEngine.readSnapshot(async () => {
      const narratives = requireNarratives(ctx)
      const timeline = await narratives.getTimeline(input.timelineId)
      if (!timeline) throw new Error(`Narrative timeline not found: ${input.timelineId}`)
      const branches = await narratives.listBranches(timeline.id)
      const nodes = await narratives.listNodes(timeline.id)
      const scope = await ctx.states.getScope({ kind: 'timeline', ownerId: timeline.id })
      if (!scope) throw new Error(`Timeline State scope not found: ${timeline.id}`)
      const revisions = await ctx.states.listRevisions(scope.id)
      const workspaceRevisions = await ctx.workspaces.list(timeline.id)
      const blobIds = new Map<string, string | undefined>()
      for (const revision of workspaceRevisions) for (const entry of revision.entries)
        if (entry.kind === 'file' && 'blobId' in entry.content) blobIds.set(entry.content.blobId, entry.content.mediaType)
      const workspaceBlobs = await Promise.all([...blobIds].map(async ([id, mediaType]) => {
        if (!ctx.blobs) throw new Error('Blob Storage is required to export Workspace files')
        return { id, mediaType, base64: Buffer.from(await ctx.blobs.read(id)).toString('base64') }
      }))
      // Export participants must only read: their store reads share this snapshot and writes fail fast.
      const participants = await ctx.timelineArchiveParticipants.exportParticipants({
        timelineId: timeline.id,
        branchIds: branches.map(branch => branch.id),
        nodeIds: nodes.map(node => node.id),
        stateRevisionIds: revisions.map(revision => revision.id),
      })
      const pendingDocument = await ctx.documents.get(timelineArchivePendingId(timeline.id))
      const pending = pendingDocument?.content as TimelineArchivePendingContent | undefined
      for (const block of pending?.blocks ?? []) {
        const activeIndex = participants.findIndex(active => active.namespace === block.namespace)
        if (activeIndex >= 0) throw new Error(`Unresolved archived participant conflicts with current data: ${block.namespace}`)
        participants.push(block)
      }
      return { archive: {
        format: 'loom-timeline-archive.v1',
        exportedAt: ctx.now(),
        timeline,
        branches,
        nodes,
        recoveryPoints: await narratives.listRecoveryPoints(timeline.id),
        state: { scope, revisions },
        workspace: { revisions: workspaceRevisions, blobs: workspaceBlobs },
        participants,
        macroConfigurations: (await listTimelinePresetConfigs(ctx.documents, timeline.id)).map(record => ({
          presetId: record.content.presetId, macroSelections: record.content.macroSelections,
        })),
      } }
    }),

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
      const workspaceIds = Object.fromEntries((archive.workspace?.revisions ?? []).map(revision => [revision.id, ctx.createId('workspace-revision')]))
      const workspaceBlobs = new Map(await Promise.all((archive.workspace?.blobs ?? []).map(async blob => {
        if (!ctx.blobs) throw new Error('Blob Storage is required to import Workspace files')
        return [blob.id, await ctx.blobs.prepareWrite({ source: Buffer.from(blob.base64, 'base64'), mediaType: blob.mediaType, maxBytes: workspaceBinaryLimit })] as const
      })))
      const revisions = orderArchiveItems(archive.state.revisions, item => item.parentRevisionId)
      const branches = orderArchiveItems(archive.branches, item => item.parentBranchId)
      const roots = branches.filter(branch => !branch.parentBranchId)
      const root = roots[0]
      if (!root || roots.length !== 1) throw new Error('Timeline archive must have one root branch')
      const nodes = orderArchiveItems(archive.nodes, node => node.parentNodeId)
      const result = await ctx.dataEngine.transact(
        narrativeWriteContext(undefined, 'application.importTimelineArchive'),
        async dataTx => requireDocumentParticipant(ctx).participateTransaction(dataTx, async documents => {
          const stateTx = ctx.states.transaction(dataTx)
          const narrativeTx = narratives.transaction(dataTx)
          const scope = stateTx.createScope({ kind: 'timeline', ownerId: timelineId })
          for (const revision of revisions) stateTx.createRevision({
            id: idMap.stateRevisionIds[revision.id], scopeId: scope.id,
            parentRevisionId: revision.parentRevisionId ? idMap.stateRevisionIds[revision.parentRevisionId] : undefined,
            snapshot: revision.snapshot, operations: revision.operations,
          })
          for (const blob of workspaceBlobs.values()) ctx.blobs!.participateWrite(dataTx, blob)
          for (const revision of orderArchiveItems(archive.workspace?.revisions ?? [], item => item.parentRevisionId)) {
            ctx.workspaces.transaction(dataTx).create({ id: workspaceIds[revision.id], timelineId,
              parentRevisionId: revision.parentRevisionId ? workspaceIds[revision.parentRevisionId] : undefined,
              entries: revision.entries.map(entry => entry.kind === 'file' && 'blobId' in entry.content
                ? { ...entry, content: { ...entry.content, blobId: workspaceBlobs.get(entry.content.blobId)!.blob.id } } : entry),
            })
          }
          const initial = narrativeTx.createTimeline({
            // Imported histories stay locked, even when the archive carries an opening window.
            id: timelineId, primaryBranchId: idMap.branchIds[root.id], title: archive.timeline.title,
            primaryBranchTitle: root.title, stateRevisionId: idMap.stateRevisionIds[root.stateHeadRevisionId]!,
            opening: archive.timeline.opening ? { ...archive.timeline.opening, locked: true,
              nodeId: archive.timeline.opening.nodeId ? idMap.nodeIds[archive.timeline.opening.nodeId] : undefined } : undefined,
          })
          narrativeTx.restoreArchivePaths({
            timelineId,
            recoveryPoints: archive.recoveryPoints?.map(point => ({ branchId: idMap.branchIds[point.branchId]!, nodeId: idMap.nodeIds[point.nodeId]!, stateRevisionId: idMap.stateRevisionIds[point.stateRevisionId]!, workspaceRevisionId: workspaceIds[point.workspaceRevisionId]! })),
            nodes: nodes.map(node => ({
              id: idMap.nodeIds[node.id]!, timelineId,
              parentNodeId: node.parentNodeId ? idMap.nodeIds[node.parentNodeId] : undefined,
              kind: node.kind, floor: node.floor, workspaceRevisionId: workspaceIds[node.workspaceRevisionId] ?? initial.branch.workspaceHeadRevisionId, body: node.body, stateRevisionId: idMap.stateRevisionIds[node.stateRevisionId]!,
              createdAt: node.createdAt,
            })),
            branches: branches.map(branch => ({
              ...branch, id: idMap.branchIds[branch.id]!, timelineId,
              headNodeId: branch.headNodeId ? idMap.nodeIds[branch.headNodeId] : undefined,
              parentBranchId: branch.parentBranchId ? idMap.branchIds[branch.parentBranchId] : undefined,
              forkedFromNodeId: branch.forkedFromNodeId ? idMap.nodeIds[branch.forkedFromNodeId] : undefined,
              stateHeadRevisionId: idMap.stateRevisionIds[branch.stateHeadRevisionId]!,
              workspaceHeadRevisionId: workspaceIds[branch.workspaceHeadRevisionId] ?? initial.branch.workspaceHeadRevisionId,
            })),
          })
          narrativeTx.switchBranch({ timelineId, branchId: idMap.branchIds[archive.timeline.activeBranchId]! })
          for (const config of archive.macroConfigurations ?? []) {
            await documents.write({
              id: timelinePresetConfigId(timelineId, config.presetId),
              type: applicationDocumentTypes.timelinePresetConfig,
              content: { timelineId, presetId: config.presetId, macroSelections: normalizeMacroSelections(config.macroSelections) },
              expectedVersion: 'new',
            })
          }
        }, { allowEmpty: true }),
      )
      const participantResult = await ctx.timelineArchiveParticipants.importParticipants({
        timelineId,
        idMap,
        blocks: archive.participants,
      })
      if (participantResult.unknownNamespaces.length > 0 || participantResult.failures.length > 0) {
        const pendingNamespaces = new Set([...participantResult.unknownNamespaces, ...participantResult.failures.map(failure => failure.namespace)])
        const pendingBlocks = archive.participants.filter(block => pendingNamespaces.has(block.namespace))
          .map(block => ({ ...block, idMap: composeTimelineArchiveIdMap(block.idMap, idMap) }))
        await executeDocumentMutation(ctx.documents, undefined, 'application.importTimelineArchive.pendingParticipants', async documents => {
          const id = timelineArchivePendingId(timelineId)
          const existing = await documents.get(id)
          const timestamp = ctx.now()
          const content: TimelineArchivePendingContent = {
            timelineId,
            blocks: pendingBlocks,
            idMap,
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

    getEffectiveNarrativePreview: async (input: { timelineId: string; branchId: string }) => {
      const store = requireNarratives(ctx)
      const page = await store.getPage({ ...input, limit: 1 })
      if (page.branch.id !== input.branchId) throw new Error('Narrative branch does not match the requested branch')
      const context = await ctx.narrativeContext.resolve({
        ...input, cardId: page.timeline.createdFrom?.cardId,
      })
      const rawThroughNodeId = context ? context.rawThroughNodeId : page.branch.headNodeId ?? null
      const coveredThroughNodeId = context?.memory?.coveredThroughNodeId
      const sample = rawThroughNodeId === null ? undefined : await createNarrativeSampler(store).sample({
        ...input,
        selection: context
          ? { kind: 'range', ...(coveredThroughNodeId ? { afterNodeId: coveredThroughNodeId } : {}), throughNodeId: rawThroughNodeId }
          : { kind: 'tail', count: 100, throughNodeId: rawThroughNodeId },
        maxNodes: 40,
        maxCharacters: 100_000,
      })
      return {
        timelineId: input.timelineId,
        branchId: input.branchId,
        sourceId: context?.sourceId ?? 'runtime.recent-100',
        version: context?.version,
        coveredThroughNodeId: coveredThroughNodeId ?? null,
        rawThroughNodeId,
        memory: context?.memory?.entries ?? [],
        nodes: sample?.nodes.map(node => ({ id: node.id, text: node.text })) ?? [],
        complete: sample?.complete ?? true,
      }
    },

    appendNarrativeInput: async (input: AppendNarrativeInput, requestContext?: RuntimeRequestContext): Promise<AppendNarrativeInputResult> => {
      if (!input.content.trim()) throw new Error('Narrative input content cannot be empty')
      const result = await requireNarratives(ctx).appendInput({
        ...narrativeWriteContext(requestContext, 'application.appendNarrativeInput'),
        timelineId: input.timelineId,
        branchId: input.branchId,
        nodeId: input.nodeId,
        expectedHeadNodeId: input.expectedHeadNodeId,
        body: { format: 'loom-markdown.v1', raw: input.content },
      })
      ctx.narrativeActivity.emit({ kind: 'input', timelineId: input.timelineId, branchId: input.branchId, nodeId: result.node.id })
      return { timeline: result.timeline, branch: result.branch, node: result.node, mutation: { changesetId: result.commit.changesetId } }
    },

    editNarrativeNode: async (input: { timelineId: string; branchId: string; nodeId: string; expectedHeadNodeId: string; expectedRaw: string; raw: string }, requestContext?: RuntimeRequestContext) => {
      const result = await requireNarratives(ctx).editBranchNode({
        ...narrativeWriteContext(requestContext, 'application.editNarrativeNode'),
        timelineId: input.timelineId, branchId: input.branchId, nodeId: input.nodeId,
        expectedHeadNodeId: input.expectedHeadNodeId,
        expectedBody: { format: 'loom-markdown.v1', raw: input.expectedRaw },
        body: { format: 'loom-markdown.v1', raw: input.raw },
      })
      return { timeline: result.timeline, branch: result.branch, replacements: result.replacements, mutation: { changesetId: result.commit.changesetId } }
    },

    forkNarrativeBranch: async (input: ForkNarrativeBranchInput, requestContext?: RuntimeRequestContext): Promise<ForkNarrativeBranchResult> => {
      const result = await requireNarratives(ctx).forkBranch({
        ...narrativeWriteContext(requestContext, 'application.forkNarrativeBranch'),
        ...input,
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
          if (ctx.agents) {
            const agents = ctx.agents.transaction(dataTx)
            let page
            do {
              // Deleted sessions invalidate cursors; read the first live page again.
              page = agents.listSessions({ timelineId: input.timelineId, limit: 100 })
              for (const session of page.sessions) {
                agents.deleteSession({ agentSessionId: session.id })
                await tombstoneExtensionStorageScope(documents, {
                  kind: 'agent-session',
                  agentSessionId: session.id,
                })
              }
            } while (page.nextCursor)
          }
          if (scope) ctx.states.transaction(dataTx).tombstoneScope({ scopeId: scope.id })
          const runtimeContext = await documents.get(timelineRuntimeContextId(input.timelineId))
          if (runtimeContext && !runtimeContext.meta.tombstone) {
            await documents.delete({ id: runtimeContext.id, expectedVersion: runtimeContext.version })
          }
          await deleteTimelinePresetConfigs(documents, input.timelineId)
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

async function createTimelineFromCard(
  ctx: NarrativeRuntimeContext,
  input: CreateNarrativeTimelineInput,
  requestContext: RuntimeRequestContext | undefined,
  reason: string,
  history?: ImportNarrativeHistoryInput['messages'],
) {
  const narratives = requireNarratives(ctx)
  const card = await readDocument<CardSourceContent>(ctx.documents, input.cardId, applicationDocumentTypes.cardSource)
  if (input.expectedCardVersion !== undefined && input.expectedCardVersion !== card.version) {
    throw new Error('Card changed while choosing an opening; reload the Card before starting')
  }
  const cardContent = normalizeCardContent(card.content)
  const extensionAdoptions = input.extensionAdoptions === undefined
    ? cardContent.extensionAdoptions ?? [] : parseCardExtensionAdoptions(input.extensionAdoptions)
  const adoptedInstallations = await Promise.all(extensionAdoptions.map(async reference => {
    const target = reference.target === 'card' ? { kind: 'card' as const, cardId: card.id } : { kind: 'global' as const }
    const installation = await readDocument<ExtensionInstallationContent>(
      ctx.documents, extensionInstallationId(reference.packageId, target), applicationDocumentTypes.extensionInstallation,
    )
    if (installation.content.participation !== 'timeline') throw new Error(`Extension does not declare Timeline participation: ${reference.packageId}`)
    if (extensionInstallationId(installation.content.packageId, installation.content.target) !== installation.id) {
      throw new Error('Extension installation identity does not match its content')
    }
    return installation
  }))
  const adoptedIds = new Set(adoptedInstallations.map(installation => installation.id))
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
  const contributionIds = new Set([
    ...(cardContent.stateContributionIds ?? []),
    ...ctx.stateContributions.list().filter(source => adoptedIds.has(source.installationId)).map(source => source.contributionId),
  ])
  const contributionSources = [...contributionIds].map(contributionId => {
    const source = ctx.stateContributions.get(contributionId)
    if (!source) throw new Error(`Card State contribution is not registered: ${contributionId}`)
    if (source.target.kind === 'card' && source.target.cardId !== card.id) {
      throw new Error(`State contribution is not available for this Card: ${contributionId}`)
    }
    return source
  })
  for (const source of contributionSources) {
    const installation = await ctx.documents.get(source.installationId)
    if (!installation) continue
    const content = installation.content as ExtensionInstallationContent
    if (content.participation === 'timeline' && !adoptedIds.has(source.installationId)) {
      throw new Error(`State contribution requires explicit Timeline adoption: ${source.contributionId}`)
    }
    if (adoptedIds.has(source.installationId) && content.packageVersion !== source.packageVersion) {
      throw new Error(`State contribution does not match the installed extension version: ${source.contributionId}`)
    }
  }
  if (input.openingId !== undefined && input.openingContent !== undefined)
    throw new Error('Choose an opening ID or custom opening content, not both')
  const baseContribution = createCardStateContribution(card.id, cardContent, templates)
  const baseState = materializeStateContribution(composeStateContributions(`initial:${card.id}`, [
    baseContribution, ...contributionSources.map(source => source.contribution),
  ])).snapshot
  const variables = await readAgentTurnVariables(ctx, baseState, cardContent.name)
  const selectedOpening = input.openingContent === undefined ? readOpening(cardContent, variables, input.openingId) : undefined
  const initialOpening = input.openingContent !== undefined ? renderVariableMacros(input.openingContent, variables) : selectedOpening!.content
  const initializationInstallations = new Map(await readAvailableExtensionInstallations(ctx.documents, card.id, null))
  for (const installation of adoptedInstallations) initializationInstallations.set(installation.id, installation.content.packageId)
  const initializationResources = contributionSources.length
    ? await readStateInitializationResources(ctx, initializationInstallations, cardContent.promptResourceIds ?? [], variables)
    : []
  const initializedContributions = []
  for (const source of contributionSources) {
    initializedContributions.push(await ctx.stateContributions.initialize(source.contributionId, {
      cardId: card.id,
      characterName: cardContent.name,
      opening: initialOpening,
      openingId: selectedOpening?.id,
      resources: initializationResources,
      signal: requestContext?.abortSignal ?? new AbortController().signal,
    }))
  }
  const composedContribution = composeStateContributions(`timeline:${card.id}`, [
    baseContribution,
    ...initializedContributions,
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
  const openingVariables = createVariableRenderContext({ ...variables.snapshot, timeline: initialState })
  const openingContent = input.openingContent ?? readOpening(cardContent, openingVariables, input.openingId).content
  requestContext?.abortSignal?.throwIfAborted()
  const transaction = await ctx.dataEngine.transact(
    narrativeWriteContext(requestContext, reason),
    async dataTx => requireDocumentParticipant(ctx).participateTransaction(dataTx, async documents => {
      const currentCard = await readDocument<CardSourceContent>(documents, card.id, applicationDocumentTypes.cardSource)
      if (currentCard.version !== card.version) throw new Error('Card changed during Timeline initialization')
      for (const installation of adoptedInstallations) {
        const current = await documents.get(installation.id)
        if (!current || current.version !== installation.version) throw new Error('Extension installation changed during Timeline initialization')
      }
      for (const source of contributionSources) {
        if (ctx.stateContributions.get(source.contributionId)?.instanceId !== source.instanceId) {
          throw new Error(`State contribution changed during Timeline initialization: ${source.contributionId}`)
        }
      }
      const stateTx = ctx.states.transaction(dataTx)
      const narrativeTx = narratives.transaction(dataTx)
      await writeDocument<TimelineRuntimeContextContent>(documents, {
        id: timelineRuntimeContextId(timelineId),
        type: applicationDocumentTypes.timelineRuntimeContext,
        content: runtimeContext,
        expectedVersion: 'new',
      })
      await writeDocument<TimelineExtensionParticipationContent>(documents, {
        id: timelineExtensionParticipationId(timelineId),
        type: applicationDocumentTypes.timelineExtensionParticipation,
        content: {
          timelineId,
          entries: adoptedInstallations.map(installation => ({
            installationId: installation.id,
            packageId: installation.content.packageId,
            packageVersion: installation.content.packageVersion,
            installationVersion: installation.version,
            ...(installation.content.source ? { source: structuredClone(installation.content.source) } : {}),
            enabled: true,
            generation: ctx.createId('extension-participation'),
          })),
        },
        expectedVersion: 'new',
      })
      stateTx.createScope({ id: stateScopeId, kind: 'timeline', ownerId: timelineId })
      stateTx.createRevision({
        id: stateRevisionId,
        scopeId: stateScopeId,
        snapshot: initialState,
        operations: [],
      })
      const created = narrativeTx.createTimeline({
        id: timelineId,
        primaryBranchId: branchId,
        stateRevisionId,
        title: input.title ?? cardContent.name,
        createdFrom: { cardId: card.id, cardVersion: card.version },
        promptResourceIds: cardContent.promptResourceIds ?? [],
        opening: { id: selectedOpening?.id, locked: history !== undefined },
        openingNode: openingContent.trim() ? { body: { format: 'loom-markdown.v1', raw: openingContent } } : undefined,
      })
      if (history === undefined) return created
      const nodes: NarrativeNode[] = []
      for (const message of history) {
        nodes.push({
          id: ctx.createId('node'), kind: 'narrative', timelineId, floor: nodes.length + 1, parentNodeId: nodes.at(-1)?.id,
          stateRevisionId, workspaceRevisionId: created.branch.workspaceHeadRevisionId, body: { format: 'loom-markdown.v1', raw: message.content },
          createdAt: message.createdAt ?? ctx.now(),
        })
      }
      const branch = { ...created.branch, headNodeId: nodes.at(-1)?.id }
      narrativeTx.restoreArchivePaths({ timelineId, nodes, branches: [branch] })
      return { timeline: narrativeTx.getTimeline(timelineId)!, nodes, branch }
    }),
  )
  return {
    ...transaction.value.value,
    mutation: { changesetId: transaction.commit.changesetId },
  }
}

export async function readStateInitializationResources(
  ctx: Pick<ApplicationRuntimeContext, 'documents' | 'promptResources'>,
  installations: ReadonlyMap<string, string>,
  resourceIds: string[],
  variables: VariableRenderContext,
): Promise<ExtensionStateInitializationContext['resources']> {
  const resources: Array<ExtensionStateInitializationContext['resources'][number]> = []
  for (const id of new Set(resourceIds)) {
    const resource = await ctx.promptResources.getResource(id)
    if (!resource || resource.resourceKind !== 'lore') continue
    if (!isExtensionResourceAvailable(resource.metadata.origin, installations))
      throw new Error(`State initialization resource is unavailable: ${id}`)
    const root = fromStoredResource(resource).rootNode
    const entries: Array<ExtensionStateInitializationContext['resources'][number]['entries'][number]> = []
    const visit = (node: PromptResourceNode, parentEnabled: boolean) => {
      const enabled = parentEnabled && node.enabled !== false
      if (node.kind === 'entry' && typeof node.body === 'string') entries.push({
        id: node.id, label: node.label, content: renderVariableMacros(node.body, variables), enabled,
      })
      for (const child of node.children ?? []) visit(child, enabled)
    }
    visit(root, true)
    resources.push({ id, name: root.label, ...(root.extra ? { metadata: structuredClone(root.extra) } : {}), entries })
  }
  return resources
}

export async function readAgentTurnVariables(
  ctx: Pick<ApplicationRuntimeContext, 'now' | 'states' | 'documents'>,
  timeline?: JsonObject,
  characterName?: string,
): Promise<VariableRenderContext> {
  const globalSnapshot = await ctx.states.getGlobalSnapshot()
  const global = structuredClone(globalSnapshot?.revision.snapshot ?? {}) as JsonObject
  const user = resolveCurrentUserProfile(await readUserProfiles(ctx.documents))
  return createVariableRenderContext({
    global,
    ...(timeline ? { timeline } : {}),
    computed: {
      user: { name: user.name, description: user.description },
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

async function buildTimelineRuntimeContext(
  ctx: Pick<ApplicationRuntimeContext, 'documents' | 'now'>,
  input: {
    timelineId: string
    card: DocumentRecord<CardSourceContent>
    cardContent: CardSourceContent
    templates: Map<string, Extract<StateDefinitionDraft, { kind: 'timeline-template' }>>
    materializedState: MaterializedStateContribution
    contributionSources: StateContributionSource[]
  },
): Promise<TimelineRuntimeContextContent> {
  // Ownership follows the mount/binding declaration, not the reusable template's author.
  const bindingOwners = new Map<string, string>()
  for (const source of input.contributionSources) {
    for (const binding of expandTimelineStateBindings(source.contribution.bindings, input.materializedState.snapshot)) {
      bindingOwners.set(binding.path, source.installationId)
    }
    for (const mount of source.contribution.componentMounts) {
      const target = mount.target
      const entities = target.kind === 'entity' ? [target.entity]
        : input.materializedState.entities.filter(entity => entity.typeId === target.typeId)
      for (const entity of entities) {
        const type = input.materializedState.entityTypes.find(candidate => candidate.id === entity.typeId)!
        bindingOwners.set(`${type.collectionPath}.${entity.entityId}.components.${mount.componentKey}`, source.installationId)
      }
    }
  }
  return {
    timelineId: input.timelineId,
    sourceCardId: input.card.id,
    sourceCardVersion: input.card.version,
    cardName: input.cardContent.name,
    fallbackUserName: input.cardContent.userName?.trim() || 'User',
    stateEntityTypes: structuredClone(input.materializedState.entityTypes),
    stateEntities: structuredClone(input.materializedState.entities),
    stateComponents: structuredClone(input.materializedState.components),
    stateReferences: structuredClone(input.materializedState.references),
    stateContributionSources: input.contributionSources.map(source => ({
      installationId: source.installationId,
      contributionId: source.contributionId,
      packageId: source.packageId,
      moduleId: source.moduleId,
      packageVersion: source.packageVersion,
      declaration: structuredClone(source.contribution),
    })),
    stateBindings: input.materializedState.bindings.map(binding => {
      const template = input.templates.get(binding.templateId)
      if (!template) throw new Error(`Timeline State template not found: ${binding.templateId}`)
      const installationId = bindingOwners.get(binding.path)
      return { path: binding.path, schema: structuredClone(template.schema), ...(installationId ? { installationId } : {}) }
    }),
    createdAt: ctx.now(),
  }
}
