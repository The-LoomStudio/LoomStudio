import { forgetDeletedSessionSummaries } from '../agents/session-summary.js'
import { validateMessageAttachments } from '../agents/message-attachments.js'
import { withCardFramework } from '../cards/card-framework.js'
import { assertAgentSessionNotExecuting } from '../agents/session-execution.js'
import { readAgentTurnVariables } from '../prompt/agent-turn-variables.js'
import { readUserProfiles, resolveCurrentUserProfile, validateProfileAvatar } from '../profiles/user-profiles.js'
import { createPlayerStateContribution, hasPlayerProfile } from '../profiles/player-state.js'
import { workspaceBinaryLimit } from './workspace-runtime.js'
import type { DocumentRecord } from '@loom-studio/document-store'
import type { JsonObject } from '@loom-studio/shared'
import type { ApplicationRuntimeContext } from '../foundation/application-context.js'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import { readDocument, writeDocument } from '../foundation/document-store.js'
import { normalizeCardContent, parseCardExtensionAdoptions, readOpening } from '../cards/card.js'
import { composeStateContributions, createCardStateContribution, materializeStateContribution } from '../state/state-contribution.js'
import { expandTimelineStateBindings } from '../state/state-definition.js'
import type { StateContributionSource } from '../state/state-contribution-registry.js'
import { createVariableRenderContext, renderVariableMacros, type VariableRenderContext } from '../prompt/variables.js'
import { fromStoredResource } from '../prompt/prompt-resource-mapper.js'
import type { PromptResourceNode } from '../prompt/prompt-resource-types.js'
import { readAvailableExtensionInstallations, isExtensionResourceAvailable } from './extension-resource-access.js'
import type { ExtensionStateInitializationContext } from '@loom-studio/extension-sdk'
import { extensionInstallationId } from '@loom-studio/extension-sdk'
import { timelineExtensionParticipationId } from '../extensions/timeline-participation.js'
import { readTimelineRuntimeContext, timelineRuntimeContextId } from '../narrative/timeline-runtime-context.js'
import { deleteTimelinePresetConfigs, listTimelinePresetConfigs, timelinePresetConfigId } from '../prompt/timeline-preset-config.js'
import { isRecord, normalizeMacroSelections } from '@loom-studio/shared'
import { createAgentStore, type AgentTranscriptEntryData, type NarrativeSwipeGroup } from '@loom-studio/application-data'
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
  'swipes' | 'workspaces' | 'blobs' | 'mediaAssets' | 'agents' | 'createId' | 'dataEngine' | 'documents' | 'narratives' | 'narrativeActivity' | 'narrativeContext' | 'now' | 'promptResources' | 'stateContributions' | 'states' | 'timelineArchiveParticipants'
>

export function createNarrativeRuntimeMethods(ctx: NarrativeRuntimeContext) {
  const agents = ctx.agents ?? createAgentStore({ engine: ctx.dataEngine, createId: ctx.createId, now: ctx.now })
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
      const runtime = await readTimelineRuntimeContext(ctx, timeline.id)
      const variables = await readAgentTurnVariables(ctx, revision.snapshot, content.name, hasPlayerProfile(runtime))
      const selected = input.openingContent === undefined ? readOpening(content, variables, input.openingId) : undefined
      const openingContent = input.openingContent !== undefined ? renderVariableMacros(input.openingContent, variables) : selected!.content
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
      const runtimeContext = await readTimelineRuntimeContext(ctx, timeline.id)
      if (!runtimeContext) throw new Error('Timeline Runtime Context is missing')
      return { archive: {
        format: 'loom-timeline-archive.v2',
        agent: { session: (await agents.getSession(timeline.id))!, entries: await agents.listEntries(timeline.id), swipeGroups: await ctx.swipes.listForSession(timeline.id) },
        exportedAt: ctx.now(),
        timeline,
        branches,
        nodes,
        recoveryPoints: await narratives.listRecoveryPoints(timeline.id),
        state: { scope, revisions },
        workspace: { revisions: workspaceRevisions, blobs: workspaceBlobs },
        participants,
        runtimeContext,
        macroConfigurations: (await listTimelinePresetConfigs(ctx.documents, timeline.id)).map(record => ({
          presetId: record.content.presetId, macroSelections: record.content.macroSelections,
        })),
      } }
    }),

    importTimelineArchive: async (input: { source: string }) => {
      const archive = parseTimelineArchive(input.source)
      const archivedAgent = archive.agent
      const narratives = requireNarratives(ctx)
      const timelineId = ctx.createId('timeline')
      const idMap: TimelineArchiveIdMap = {
        timelineId,
        branchIds: Object.fromEntries(archive.branches.map(branch => [branch.id, ctx.createId('branch')])),
        nodeIds: Object.fromEntries(archive.nodes.map(node => [node.id, ctx.createId('node')])),
        stateRevisionIds: Object.fromEntries(archive.state.revisions.map(revision => [revision.id, ctx.createId('state-revision')])),
      }
      const entryIds = Object.fromEntries(archivedAgent.entries.map(entry => [entry.id, ctx.createId('agent-entry')]))
      const narrativeIds: Record<string, string> = {}
      const runIds: Record<string, string> = {}
      const invocationIds: Record<string, string> = {}
      const groupIds = Object.fromEntries(archivedAgent.swipeGroups.map(group => [group.id, entryIds[group.id] ?? ctx.createId('swipe-group')]))
      const candidateIds = Object.fromEntries(archivedAgent.swipeGroups.flatMap(group => group.candidates.map(candidate => [candidate.id, ctx.createId('swipe-candidate')])))
      for (const entry of archivedAgent.entries) {
        if (entry.entry.kind === 'message' && entry.entry.narrativeId) narrativeIds[entry.entry.narrativeId] ??= idMap.nodeIds[entry.entry.narrativeId] ?? ctx.createId('narrative-message')
        if (entry.runId) runIds[entry.runId] ??= ctx.createId('agent-run')
        if (entry.entry.kind === 'run-state' && entry.entry.sourceRunId) runIds[entry.entry.sourceRunId] ??= ctx.createId('agent-run')
        if (entry.entry.kind === 'tool-invocation') invocationIds[entry.entry.invocationId] ??= ctx.createId('tool-invocation')
      }
      for (const group of archivedAgent.swipeGroups) {
        for (const id of [...group.candidates.flatMap(candidate => candidate.runIds), ...(group.excludedRunIds ?? []), ...(group.activeRunId ? [group.activeRunId] : [])])
          runIds[id] ??= ctx.createId('agent-run')
      }
      const archivedPresetId = archivedAgent.session.agentPresetId
      const preset = archivedPresetId ? await ctx.promptResources.getResource(archivedPresetId) : undefined
      const workspaceIds = Object.fromEntries((archive.workspace.revisions).map(revision => [revision.id, ctx.createId('workspace-revision')]))
      const remapReference = (value: string, field: string): string => {
        if (['narrativeId', 'logicalId'].includes(field)) return narrativeIds[value] ?? value
        if (['timelineId', 'agentSessionId'].includes(field) && value === archive.timeline.id) return timelineId
        if (['branchId', 'fromBranchId', 'parentBranchId', 'activeBranchId'].includes(field)) return idMap.branchIds[value] ?? value
        if (['nodeId', 'inputNodeId', 'headNodeId', 'cursorNodeId', 'rawThroughNodeId', 'coveredThroughNodeId', 'forkedFromNodeId', 'narrativeId'].includes(field)) return idMap.nodeIds[value] ?? value
        if (['entryId', 'headEntryId', 'baseEntryId', 'parentEntryId', 'userEntryId', 'partialEntryId', 'consumedEntryId', 'continuesEntryId', 'agentMessageId'].includes(field)) return entryIds[value] ?? value
        if (['runId', 'sourceRunId', 'activeRunId', 'runIds', 'excludedRunIds'].includes(field)) return runIds[value] ?? value
        if (['groupId', 'roundId'].includes(field)) return groupIds[value] ?? entryIds[value] ?? value
        if (['candidateId', 'activeCandidateId', 'selectedCandidateId', 'replacesCandidateId'].includes(field)) return candidateIds[value] ?? value
        if (['stateRevisionId', 'stateHeadRevisionId', 'baselineStateRevisionId'].includes(field)) return idMap.stateRevisionIds[value] ?? value
        if (['workspaceRevisionId', 'workspaceHeadRevisionId', 'baselineWorkspaceRevisionId', 'adoptedWorkspaceRevisionId'].includes(field)) return workspaceIds[value] ?? value
        if (field === 'invocationId') return invocationIds[value] ?? value
        return value
      }
      // Only host-owned reference fields change; tool arguments, text and provider evidence remain original facts.
      const remap = <T>(value: T, field = ''): T => {
        if (typeof value === 'string') return remapReference(value, field) as T
        if (Array.isArray(value)) return value.map(item => remap(item, field)) as T
        if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) =>
          [key, ['arguments', 'rawInput', 'content', 'messages', 'processedPrompt', 'providerResult', 'toolContract'].includes(key) ? item : remap(item, key)])) as T
        return value
      }
      const workspaceBlobs = new Map(await Promise.all((archive.workspace.blobs).map(async blob => {
        if (!ctx.blobs) throw new Error('Blob Storage is required to import Workspace files')
        return [blob.id, await ctx.blobs.prepareWrite({ source: Buffer.from(blob.base64, 'base64'), mediaType: blob.mediaType, maxBytes: workspaceBinaryLimit })] as const
      })))
      const revisions = orderArchiveItems(archive.state.revisions, item => item.parentRevisionId)
      const branches = orderArchiveItems(archive.branches, item => item.parentBranchId)
      const roots = branches.filter(branch => !branch.parentBranchId)
      const root = roots[0]
      if (!root || roots.length !== 1) throw new Error('Timeline archive must have one root branch')
      const nodes = orderArchiveItems(archive.nodes, node => node.parentNodeId)
      const retainedBlocks = archive.participants.map(block => ({
        ...block, idMap: composeTimelineArchiveIdMap(block.idMap, idMap),
      }))
      const pendingId = timelineArchivePendingId(timelineId)
      const receivedAt = ctx.now()
      const result = await ctx.dataEngine.transact(
        narrativeWriteContext(undefined, 'application.importTimelineArchive'),
        async dataTx => requireDocumentParticipant(ctx).participateTransaction(dataTx, async documents => {
          // Receive opaque data with the core Timeline before any external participant runs.
          if (retainedBlocks.length) await documents.write({
            id: pendingId, type: applicationDocumentTypes.timelineArchivePending,
            content: { timelineId, blocks: retainedBlocks, idMap, failures: [], createdAt: receivedAt, updatedAt: receivedAt } satisfies TimelineArchivePendingContent,
            expectedVersion: 'new',
          })
          const stateTx = ctx.states.transaction(dataTx)
          const narrativeTx = narratives.transaction(dataTx)
          const scope = stateTx.createScope({ kind: 'timeline', ownerId: timelineId })
          for (const revision of revisions) stateTx.createRevision({
            id: idMap.stateRevisionIds[revision.id], scopeId: scope.id,
            parentRevisionId: revision.parentRevisionId ? idMap.stateRevisionIds[revision.parentRevisionId] : undefined,
            snapshot: revision.snapshot, operations: revision.operations,
          })
          for (const blob of workspaceBlobs.values()) ctx.blobs!.participateWrite(dataTx, blob)
          for (const revision of orderArchiveItems(archive.workspace.revisions, item => item.parentRevisionId)) {
            ctx.workspaces.transaction(dataTx).create({ id: workspaceIds[revision.id], timelineId,
              parentRevisionId: revision.parentRevisionId ? workspaceIds[revision.parentRevisionId] : undefined,
              entries: revision.entries.map(entry => entry.kind === 'file' && 'blobId' in entry.content
                ? { ...entry, content: { ...entry.content, blobId: workspaceBlobs.get(entry.content.blobId)!.blob.id } } : entry),
            })
          }
          narrativeTx.createTimeline({
            // Imported histories stay locked, even when the archive carries an opening window.
            id: timelineId, primaryBranchId: idMap.branchIds[root.id], title: archive.timeline.title,
            promptResourceIds: archive.timeline.promptResourceIds,
            primaryBranchTitle: root.title, stateRevisionId: idMap.stateRevisionIds[root.stateHeadRevisionId]!,
            opening: archive.timeline.opening ? { ...archive.timeline.opening, locked: true,
              nodeId: archive.timeline.opening.nodeId ? idMap.nodeIds[archive.timeline.opening.nodeId] : undefined } : undefined,
          })
          if (archive.runtimeContext) {
            await writeDocument<TimelineRuntimeContextContent>(documents, {
              id: timelineRuntimeContextId(timelineId), type: applicationDocumentTypes.timelineRuntimeContext,
              content: { ...structuredClone(archive.runtimeContext), timelineId }, expectedVersion: 'new',
            })
          }
          const agentTx = agents.transaction(dataTx)
          if (archivedAgent) {
            agentTx.updateSession({ agentSessionId: timelineId, ...(preset?.resourceKind === 'preset' ? { agentPresetId: preset.id } : {}),
              narrativeMode: archivedAgent.session.narrativeMode, summaryPolicy: archivedAgent.session.summaryPolicy })
            agentTx.restoreTimelineEntries({ agentSessionId: timelineId, entryCount: archivedAgent.session.entryCount,
              headEntryId: archivedAgent.session.headEntryId ? entryIds[archivedAgent.session.headEntryId] : undefined,
              entries: archivedAgent.entries.map(entry => ({ ...remap(entry), id: entryIds[entry.id]!, agentSessionId: timelineId,
                entry: remap(entry.entry) as AgentTranscriptEntryData })),
            })
          }
          narrativeTx.restoreArchivePaths({
            timelineId,
            recoveryPoints: archive.recoveryPoints?.map(point => ({ headEntryId: point.headEntryId ? entryIds[point.headEntryId] : undefined, branchId: idMap.branchIds[point.branchId]!, nodeId: idMap.nodeIds[point.nodeId]!, stateRevisionId: idMap.stateRevisionIds[point.stateRevisionId]!, workspaceRevisionId: workspaceIds[point.workspaceRevisionId]! })),
            nodes: nodes.map(node => ({
              id: idMap.nodeIds[node.id]!, timelineId,
              entryId: node.entryId ? entryIds[node.entryId] : undefined,
              source: node.source ? { ...remap(node.source), changesetId: dataTx.changesetId } : undefined,
              parentNodeId: node.parentNodeId ? idMap.nodeIds[node.parentNodeId] : undefined,
              kind: node.kind, floor: node.floor, workspaceRevisionId: workspaceIds[node.workspaceRevisionId]!, body: node.body, stateRevisionId: idMap.stateRevisionIds[node.stateRevisionId]!,
              createdAt: node.createdAt,
            })),
            branches: branches.map(branch => ({
              ...branch, id: idMap.branchIds[branch.id]!, timelineId,
              headEntryId: branch.headEntryId ? entryIds[branch.headEntryId] : undefined,
              headNodeId: branch.headNodeId ? idMap.nodeIds[branch.headNodeId] : undefined,
              parentBranchId: branch.parentBranchId ? idMap.branchIds[branch.parentBranchId] : undefined,
              forkedFromNodeId: branch.forkedFromNodeId ? idMap.nodeIds[branch.forkedFromNodeId] : undefined,
              stateHeadRevisionId: idMap.stateRevisionIds[branch.stateHeadRevisionId]!,
              workspaceHeadRevisionId: workspaceIds[branch.workspaceHeadRevisionId]!,
            })),
          })
          for (const group of archivedAgent.swipeGroups) {
            ctx.swipes.transaction(dataTx).save({ ...remap(group), id: groupIds[group.id]!, timelineId, agentSessionId: timelineId,
              candidates: group.candidates.map(candidate => ({ ...remap(candidate), id: candidateIds[candidate.id]!, agentSessionId: timelineId })),
            } as NarrativeSwipeGroup)
          }
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
      if (retainedBlocks.length) {
        const pendingNamespaces = new Set([...participantResult.unknownNamespaces, ...participantResult.failures.map(failure => failure.namespace)])
        try {
          await executeDocumentMutation(ctx.documents, undefined, 'application.importTimelineArchive.pendingParticipants', async documents => {
            const existing = await readDocument<TimelineArchivePendingContent>(documents, pendingId, applicationDocumentTypes.timelineArchivePending)
            const blocks = retainedBlocks.filter(block => pendingNamespaces.has(block.namespace))
            if (!blocks.length) {
              await documents.delete({ id: pendingId, expectedVersion: existing.version })
            } else {
              await documents.write({
                id: pendingId, type: applicationDocumentTypes.timelineArchivePending,
                content: { ...existing.content, blocks, failures: participantResult.failures, updatedAt: ctx.now() } satisfies TimelineArchivePendingContent,
                expectedVersion: existing.version,
              })
            }
          })
        } catch (error) {
          // Core import and participant effects already happened. Keep the original blocks;
          // a failed receipt update must not suggest repeating those effects is safe.
          participantResult.failures.push(...retainedBlocks.map(block => ({
            namespace: block.namespace,
            message: `Timeline imported; archived data retained but participant completion could not be recorded. Do not repeat the import: ${error instanceof Error ? error.message : String(error)}`,
          })))
        }
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
      const attachments = await validateMessageAttachments(ctx.mediaAssets, input.attachments)
      if (!input.content.trim() && !attachments.length) throw new Error('Narrative input content cannot be empty')
      const result = await requireNarratives(ctx).appendInput({
        ...narrativeWriteContext(requestContext, 'application.appendNarrativeInput'),
        attachments,
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
      const result = await ctx.dataEngine.withTransactionGuard(async tx => {
        assertAgentSessionNotExecuting(ctx, input.timelineId)
        const session = ctx.agents?.transaction(tx).getSession(input.timelineId)
        const activeBranchId = requireNarratives(ctx).transaction(tx).getTimeline(input.timelineId)?.activeBranchId
        let cursor = session?.headEntryId
        while (cursor) {
          const entry = ctx.agents!.transaction(tx).getEntry(cursor)!
          if (entry.entry.kind === 'run-state') {
            const source = entry.entry.recovery?.narrativeSource
            const belongs = !isRecord(source) || source.branchId === activeBranchId
            if (belongs && (['created', 'running', 'suspended'].includes(entry.entry.state)
              || entry.entry.state === 'failed' && entry.entry.recovery))
              throw new Error('Continue or abandon the suspended Timeline Run before switching branches')
            break
          }
          cursor = entry.parentEntryId
        }
      }, () => requireNarratives(ctx).switchBranch({
        ...narrativeWriteContext(requestContext, 'application.switchNarrativeBranch'),
        ...input,
      }))
      return { timeline: result.timeline, mutation: { changesetId: result.commit.changesetId } }
    },

    deleteNarrativeTimeline: async (input: DeleteNarrativeTimelineInput, requestContext?: RuntimeRequestContext): Promise<DeleteNarrativeTimelineResult> => {
      const deletedSessionIds = new Set<string>()
      const narratives = requireNarratives(ctx)
      const scope = await ctx.states.getScope({ kind: 'timeline', ownerId: input.timelineId })
      const documentParticipant = requireDocumentParticipant(ctx)
      const result = await ctx.dataEngine.transact(
        narrativeWriteContext(requestContext, 'application.deleteNarrativeTimeline'),
        async dataTx => documentParticipant.participateTransaction(dataTx, async documents => {
          const timeline = narratives.transaction(dataTx).deleteTimeline(input)
          deletedSessionIds.add(input.timelineId)
          await tombstoneExtensionStorageScope(documents, { kind: 'agent-session', agentSessionId: input.timelineId })
          if (ctx.agents) {
            const agents = ctx.agents.transaction(dataTx)
            let page
            do {
              // Deleted sessions invalidate cursors; read the first live page again.
              page = agents.listSessions({ timelineId: input.timelineId, limit: 100 })
              for (const session of page.sessions) {
                agents.deleteSession({ agentSessionId: session.id })
                deletedSessionIds.add(session.id)
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
      forgetDeletedSessionSummaries(ctx.agents, deletedSessionIds)
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
  if (input.agentPresetId !== undefined) {
    const preset = await ctx.promptResources.getResource(input.agentPresetId)
    if (!preset || preset.resourceKind !== 'preset') throw new Error('Selected Agent Preset is unavailable')
  }
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
  const selectedProfile = input.playerProfile ?? resolveCurrentUserProfile(await readUserProfiles(ctx.documents))
  if (selectedProfile.avatarAssetId !== undefined) await validateProfileAvatar(ctx, selectedProfile.avatarAssetId)
  const playerContribution = createPlayerStateContribution({ name: selectedProfile.name, description: selectedProfile.description,
    ...(selectedProfile.avatarAssetId !== undefined ? { avatarAssetId: selectedProfile.avatarAssetId } : {}) })
  const baseState = materializeStateContribution(composeStateContributions(`initial:${card.id}`, [
    playerContribution, baseContribution, ...contributionSources.map(source => source.contribution),
  ])).snapshot
  const variables = await readAgentTurnVariables(ctx, baseState, cardContent.name, true)
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
    playerContribution,
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
  const openingContent = input.openingContent !== undefined ? renderVariableMacros(input.openingContent, openingVariables)
    : readOpening(cardContent, openingVariables, input.openingId).content
  requestContext?.abortSignal?.throwIfAborted()
  const transaction = await withCardFramework(ctx, cardContent, framework => ctx.dataEngine.transact(
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
      const agentPresetId = input.agentPresetId ?? framework.presetId
      if (agentPresetId) {
        if (!ctx.agents) throw new Error('Agent store is unavailable')
        ctx.agents.transaction(dataTx).updateSession({ agentSessionId: timelineId, agentPresetId })
      }
      if (history === undefined) return created
      const nodes: NarrativeNode[] = []
      for (const message of history) {
        nodes.push({
          id: ctx.createId('node'), kind: message.role === 'user' ? 'user-input' : 'narrative', timelineId, floor: nodes.length + 1, parentNodeId: nodes.at(-1)?.id,
          stateRevisionId, workspaceRevisionId: created.branch.workspaceHeadRevisionId, body: { format: 'loom-markdown.v1', raw: message.content },
          createdAt: message.createdAt ?? ctx.now(),
        })
      }
      const branch = { ...created.branch, headNodeId: nodes.at(-1)?.id }
      narrativeTx.restoreArchivePaths({ timelineId, nodes, branches: [branch] })
      return { timeline: narrativeTx.getTimeline(timelineId)!, nodes: nodes.map(node => narrativeTx.getNode(node.id)!), branch: narrativeTx.getBranch(branchId)! }
    }),
  ))
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
