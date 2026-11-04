import { assertAgentSessionNotExecuting } from '../agents/session-execution.js'
import { summaryRetiredThrough } from '../agents/session-history.js'
import type { AgentTranscriptEntry, NarrativeBranch, NarrativeNode, NarrativeSwipeCandidate, NarrativeSwipeGroup } from '@loom-studio/application-data'
import type { SqliteDataTransaction } from '@loom-studio/data-engine'
import type { ApplicationRuntimeContext } from '../foundation/application-context.js'
import type { ApplicationRuntime, InvokeAgentTurnInput, NarrativeSwipeView, RuntimeRequestContext } from '../types.js'
import { notifyStateChange } from '../state/state.js'
import { readAgentRunRecovery } from '../agents/run-recovery.js'
import { restoreDiscussionRetryInTransaction, type DiscussionRetry } from '../agents/discussion-retry.js'
import { narrativeWriteContext, requireAgents, requireNarratives } from './context.js'

type SwipeContext = Pick<ApplicationRuntimeContext, 'agents' | 'narratives' | 'swipes' | 'dataEngine' | 'states' | 'createId' | 'now' | 'onStateChanged' | 'logger'>

export type NarrativeExecutionSource = {
  timelineId: string
  branchId: string
  groupId?: string
  candidateId?: string
  generation?: number
  nodeId?: string
  cursorNodeId?: string
}

export type SwipeExecution = {
  groupId: string
  candidateId: string
  runId: string
  generation: number
  editing: boolean
  communicationInput?: string
}

function swipeError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code: `narrative.swipe_${code}` })
}

function currentCandidate(group: NarrativeSwipeGroup) {
  return group.candidates.find(item => item.id === (group.activeCandidateId ?? group.selectedCandidateId))
}

function rememberInputSelection(group: NarrativeSwipeGroup) {
  const input = group.inputs?.find(item => item.nodeId === group.inputNodeId)
  if (input) input.selectedCandidateId = group.selectedCandidateId
}

function isCandidateHead(group: NarrativeSwipeGroup, candidate: NarrativeSwipeCandidate, node: NarrativeNode | null): boolean {
  if (candidate.status === 'failed') return node?.id === group.inputNodeId
  return node?.id === candidate.headNodeId || Boolean(node?.source?.runId && candidate.runIds.includes(node.source.runId))
}

function baselineEntryId(group: NarrativeSwipeGroup, tx: SqliteDataTransaction, ctx: SwipeContext): string | null {
  return group.inputKind === 'communication' ? group.baseEntryId ?? null
    : group.inputNodeId ? requireNarratives(ctx).transaction(tx).getNode(group.inputNodeId)?.entryId ?? null : null
}

async function readRunState(ctx: SwipeContext, sessionId: string, runId: string) {
  if (!await ctx.agents?.getSession(sessionId)) return undefined
  let cursor: string | undefined
  do {
    const page = await ctx.agents!.getEntryPage({ agentSessionId: sessionId, cursor, limit: 100 })
    const state = [...page.entries].reverse().find(item => item.runId === runId && item.entry.kind === 'run-state')
    if (state?.entry.kind === 'run-state') return state.entry
    cursor = page.nextCursor
  } while (cursor)
  return undefined
}

async function settleDiscarded(ctx: SwipeContext, group: NarrativeSwipeGroup, request?: RuntimeRequestContext): Promise<NarrativeSwipeGroup> {
  const candidate = currentCandidate(group)
  if (!candidate || !group.activeRunId) return group
  const state = await readRunState(ctx, candidate.agentSessionId, group.activeRunId)
  if (state?.state !== 'discarded') return group
  try {
    await finishNarrativeSwipeRun(ctx, {
      groupId: group.id, candidateId: candidate.id, runId: group.activeRunId,
      generation: group.generation, editing: candidate.editBaseRunCount !== undefined,
    }, 'discarded', request)
  } catch (error) {
    // A commit subscriber may settle the same discarded Run before its caller does.
    if (error instanceof Error && 'code' in error && error.code === 'narrative.swipe_execution_stale') {
      const settled = await ctx.swipes.get(group.id)
      if (settled && settled.activeRunId !== group.activeRunId) return settled
    }
    throw error
  }
  return (await ctx.swipes.get(group.id))!
}

export async function settleDiscardedNarrativeRuns(ctx: SwipeContext, sessionId: string, runIds: string[], request?: RuntimeRequestContext) {
  if (!ctx.narratives || !runIds.length) return
  for (const group of await ctx.swipes.listForSession(sessionId)) {
    if (!group.closed && group.activeRunId && runIds.includes(group.activeRunId))
      await settleDiscarded(ctx, group, request)
  }
}

async function view(ctx: SwipeContext, group: NarrativeSwipeGroup): Promise<NarrativeSwipeView> {
  const branch = await requireNarratives(ctx).getBranch(group.branchId)
  if (!branch || branch.timelineId !== group.timelineId) throw swipeError('target_missing', 'Swipe target no longer exists')
  const selected = group.candidates.find(item => item.id === group.selectedCandidateId)
  const active = currentCandidate(group)
  const head = branch.headNodeId ? await requireNarratives(ctx).getNode(branch.headNodeId) : null
  const matches = selected ? isCandidateHead(group, selected, head) : branch.headNodeId === group.inputNodeId
  const busy = Boolean(group.activeRunId && active?.status === 'running')
  const suspended = Boolean(group.activeRunId && active?.status === 'suspended')
  const originalSession = await ctx.agents?.getSession(group.agentSessionId)
  const summary = originalSession ? await ctx.agents!.getLatestWorkSummary(originalSession.id) : undefined
  const requiresRegeneration = !originalSession || Boolean(originalSession.kind !== 'timeline' && summary && summaryRetiredThrough(summary) > group.baseEntryCount)
  const reason = group.closed ? 'This reply is no longer the latest selectable reply.'
    : busy ? 'The writing Agent is still working on this reply.'
    : suspended ? 'Continue or abandon the suspended writing run first.'
    : !matches ? 'The current round no longer matches this Swipe candidate.' : undefined
  return {
    id: group.id, timelineId: group.timelineId, branchId: group.branchId,
    revision: group.revision, inputNodeId: group.inputNodeId, inputKind: group.inputKind, sourceAgentSessionId: group.agentSessionId,
    inputs: (group.inputKind === 'communication' ? [] : group.inputs ?? [{ nodeId: group.inputNodeId!, input: group.input, selectedCandidateId: group.selectedCandidateId }])
      .filter(input => group.candidates.some(candidate => (candidate.inputNodeId ?? group.inputNodeId) === input.nodeId && candidate.status !== 'discarded'))
      .map(input => ({ nodeId: input.nodeId, input: input.input,
        selectedCandidateId: input.nodeId === group.inputNodeId ? group.selectedCandidateId : input.selectedCandidateId })),
    selectedCandidateId: group.selectedCandidateId, activeCandidateId: group.activeCandidateId,
    selectedAgentSessionId: selected?.agentSessionId,
    active: busy, suspended, canSelect: !reason && Boolean(selected), canGenerate: !reason, reason,
    ...(requiresRegeneration ? { requiresRegeneration: true } : {}),
    candidates: await Promise.all(group.candidates.map(async candidate => {
      const node = candidate.status === 'failed' ? null : candidate.id === group.selectedCandidateId && matches ? head
        : candidate.headNodeId ? await requireNarratives(ctx).getNode(candidate.headNodeId) : null
      return { id: candidate.id, inputNodeId: candidate.inputNodeId ?? group.inputNodeId, nodeId: node?.id, preview: node?.body.raw.slice(0, 240) ?? '', status: candidate.status }
    })),
  }
}

function notifyRestored(ctx: SwipeContext, branch: NarrativeBranch, changesetId: string) {
  notifyStateChange(ctx, {
    target: { scope: 'timeline', timelineId: branch.timelineId, branchId: branch.id },
    revisionId: branch.stateHeadRevisionId, changesetId, paths: [''],
  })
}

export function createSwipeRuntimeMethods(ctx: SwipeContext) {
  return {
    getNarrativeSwipes: async (input: { timelineId: string; branchId: string }): Promise<{ swipe?: NarrativeSwipeView }> => {
      const branch = await requireNarratives(ctx).getBranch(input.branchId)
      if (!branch || branch.timelineId !== input.timelineId) throw swipeError('target_missing', 'Narrative branch not found')
      const group = await ctx.swipes.getLatest(input.branchId)
      if (!group || group.closed) return {}
      return { swipe: await view(ctx, await settleDiscarded(ctx, group)) }
    },
    selectNarrativeSwipe: async (input: Parameters<ApplicationRuntime['selectNarrativeSwipe']>[0], request?: RuntimeRequestContext) => {
      const existing = await ctx.swipes.get(input.groupId)
      if (!existing || existing.branchId !== input.branchId || existing.timelineId !== input.timelineId)
        throw swipeError('target_missing', 'Swipe selection group not found')
      const group = await settleDiscarded(ctx, existing)
      const availability = await view(ctx, group)
      if (!availability.canSelect) throw swipeError('unavailable', availability.reason ?? 'Swipe is unavailable')
      const result = await ctx.dataEngine.transact(narrativeWriteContext(request, 'application.selectNarrativeSwipe'), async tx => {
        const store = ctx.swipes.transaction(tx)
        const current = store.get(group.id)
        if (!current || current.revision !== input.expectedRevision || current.closed || current.activeRunId)
          throw swipeError('conflict', 'Swipe selection changed; refresh before selecting')
        assertAgentSessionNotExecuting(ctx, current.agentSessionId)
        const narratives = requireNarratives(ctx).transaction(tx)
        const branch = narratives.getBranch(current.branchId)
        if (!branch) throw swipeError('target_missing', 'Narrative branch no longer exists')
        const old = current.candidates.find(item => item.id === current.selectedCandidateId)!
        const node = branch.headNodeId ? narratives.getNode(branch.headNodeId) : null
        if ((branch.headNodeId ?? null) !== input.expectedHeadNodeId || !isCandidateHead(current, old, node))
          throw swipeError('conflict', 'Narrative head changed before selecting a candidate')
        if (old.status === 'completed') {
          old.headNodeId = branch.headNodeId
          old.headEntryId = branch.headEntryId
          old.stateRevisionId = branch.stateHeadRevisionId
          old.workspaceRevisionId = branch.workspaceHeadRevisionId
        }
        const next = current.candidates.find(item => item.id === input.candidateId && (item.status === 'completed' || item.status === 'failed'))
        if (!next) throw swipeError('candidate_missing', 'Selectable candidate not found')
        rememberInputSelection(current)
        if (next.inputNodeId && next.inputNodeId !== current.inputNodeId) {
          const nextInput = current.inputs!.find(item => item.nodeId === next.inputNodeId)!
          current.inputNodeId = nextInput.nodeId
          current.input = nextInput.input
          current.baselineStateRevisionId = nextInput.baselineStateRevisionId
          current.baselineWorkspaceRevisionId = nextInput.baselineWorkspaceRevisionId
        }
        const updated = narratives.restoreBranch({
          timelineId: current.timelineId, branchId: current.branchId,
          expectedHeadNodeId: branch.headNodeId ?? null, expectedStateHeadRevisionId: branch.stateHeadRevisionId,
          headNodeId: (next.status === 'failed' ? current.inputNodeId : next.headNodeId) ?? null,
          ...(originalTimelineSession(tx, ctx, current.timelineId) ? { headEntryId: next.status === 'failed'
            ? baselineEntryId(current, tx, ctx) : next.headEntryId ?? null } : {}),
          stateRevisionId: next.status === 'failed' ? current.baselineStateRevisionId : next.stateRevisionId,
          workspaceRevisionId: next.status === 'failed' ? current.baselineWorkspaceRevisionId : next.workspaceRevisionId,
        })
        current.selectedCandidateId = next.id
        rememberInputSelection(current)
        current.generation += 1
        return { branch: updated, group: store.save(current, { expectedRevision: current.revision }) }
      })
      notifyRestored(ctx, result.value.branch, result.commit.changesetId)
      return { page: await requireNarratives(ctx).getPage({ ...input, limit: 100 }), swipe: await view(ctx, result.value.group) }
    },
  }
}

export async function beginNarrativeSwipeRun(
  ctx: SwipeContext, input: InvokeAgentTurnInput, runId: string, request?: RuntimeRequestContext,
  discussionRetry?: DiscussionRetry,
): Promise<SwipeExecution | undefined> {
  const session = await requireAgents(ctx).getSession(input.agentSessionId)
  if (!session) throw swipeError('session_missing', 'Agent Session not found')
  const target = input.narrativeTarget
  const timelineId = target?.timelineId ?? session.timelineId
  if (!timelineId || !ctx.narratives) return undefined
  if (session.timelineId && timelineId !== session.timelineId) throw swipeError('target_mismatch', 'Narrative target does not match the Agent Session timeline binding')
  const page = await ctx.narratives.getPage({ timelineId, branchId: target?.branchId, limit: 1 })
  let existing = await ctx.swipes.getLatest(page.branch.id)
  if (existing) existing = await settleDiscarded(ctx, existing)
  const continuation = request?.agentRun?.continuation
  const command = !continuation ? target?.swipe : undefined
  if (command && (!existing || existing.id !== command.groupId || existing.closed))
    throw swipeError('target_missing', 'Latest Swipe group not found')
  if (session.kind !== 'timeline' && !command && !continuation && target?.inputNodeId === existing?.inputNodeId
    && existing?.agentSessionId !== session.id) return undefined
  const resumedCandidate = continuation && existing?.candidates.find(candidate => candidate.runIds.includes(continuation.sourceRunId))
  const editCandidate = !target?.inputNodeId && !command && !continuation && existing && !existing.closed
    && existing.candidates.find(candidate => candidate.id === existing!.selectedCandidateId && candidate.agentSessionId === session.id
      && (candidate.status === 'completed' || input.retry && candidate.status === 'failed'))
  const retryEntry = input.retry ? await requireAgents(ctx).getEntry(input.retry.entryId) : undefined
  const retryFailed = Boolean(input.retry && existing?.inputKind === 'communication' && editCandidate && editCandidate.status === 'failed')
  const communication = session.kind === 'timeline' && !target?.inputNodeId
  if (!command && !resumedCandidate && !editCandidate && !target?.inputNodeId && !communication) return undefined
  if (continuation && !resumedCandidate) return undefined
  // A stopped executor can leave its durable candidate marked running after a crash.
  const coldRecovery = continuation && resumedCandidate?.status === 'running'
    ? await readAgentRunRecovery(requireAgents(ctx), { agentSessionId: session.id, runId: continuation.sourceRunId })
    : undefined
  if (continuation && resumedCandidate?.status === 'running' && !coldRecovery)
    throw swipeError('continuation_stale', 'The interrupted writing Run has no recoverable checkpoint')
  if (command) {
    if (command.input !== undefined && existing!.inputKind === 'communication')
      throw swipeError('invalid_input', 'Edit communication input through the Run retry entry point')
    if (command.input !== undefined && (command.mode !== 'swipe' || !command.input.trim()))
      throw swipeError('invalid_input', 'A new input candidate requires nonempty text and Swipe mode')
    const availability = await view(ctx, existing!)
    if (!availability.canGenerate) throw swipeError('unavailable', availability.reason ?? 'Swipe is unavailable')
    if (existing!.revision !== command.expectedRevision) throw swipeError('conflict', 'Swipe group changed; refresh before generating')
    const summary = await requireAgents(ctx).getLatestWorkSummary(session.id)
    const originalContext = session.id === existing!.agentSessionId && (!summary || summaryRetiredThrough(summary) <= existing!.baseEntryCount)
    if (!originalContext && !command.allowSessionChange)
      throw swipeError('session_changed', 'The original writing context is unavailable. Confirm regeneration with the current writing Session.')
    if (!originalContext && command.mode !== 'regenerate')
      throw swipeError('session_changed', 'Use regeneration when the original writing context is unavailable')
  }
  const result = await ctx.dataEngine.transact(narrativeWriteContext(request, 'application.beginNarrativeSwipeRun'), async tx => {
    const store = ctx.swipes.transaction(tx)
    const narratives = ctx.narratives!.transaction(tx)
    const branch = narratives.getBranch(page.branch.id)
    if (!branch || branch.timelineId !== timelineId) throw swipeError('target_missing', 'Narrative branch no longer exists')
    let group = store.getLatest(branch.id)
    const node = branch.headNodeId ? narratives.getNode(branch.headNodeId) : null
    if (resumedCandidate && continuation) {
      const candidate = group?.candidates.find(item => item.id === resumedCandidate.id)
      if (!group || !candidate || group.id !== existing?.id || group.closed || group.activeCandidateId !== candidate.id
        || group.activeRunId !== continuation.sourceRunId || candidate.agentSessionId !== session.id
        || (candidate.status !== 'suspended' && !(candidate.status === 'running' && coldRecovery)))
        throw swipeError('continuation_stale', 'This candidate can no longer be continued')
      if (coldRecovery && requireAgents(ctx).transaction(tx).getSession(session.id)?.entryCount !== coldRecovery.continuation.expectedEntryCount)
        throw swipeError('continuation_stale', 'The interrupted Run transcript changed before continuation')
      candidate.runIds.push(runId)
      candidate.status = 'running'
      group.activeRunId = runId
      const saved = store.save(group, { expectedRevision: group.revision })
      return { group: saved, candidate, editing: candidate.editBaseRunCount !== undefined, restored: undefined }
    }
    if (group?.activeRunId) throw swipeError('busy', 'The writing attempt is still running or suspended')
    if (editCandidate) {
      const candidate = group?.candidates.find(item => item.id === editCandidate.id)
      if (!group || !candidate || group.id !== existing?.id || group.revision !== existing?.revision || group.closed
        || group.selectedCandidateId !== candidate.id || (candidate.status !== 'completed' && !(retryFailed && candidate.status === 'failed'))
        || !isCandidateHead(group, candidate, node))
        throw swipeError('conflict', 'The selected candidate changed before editing')
      if (!retryFailed) {
        candidate.headNodeId = branch.headNodeId
        candidate.headEntryId = branch.headEntryId
        candidate.stateRevisionId = branch.stateHeadRevisionId
        candidate.workspaceRevisionId = branch.workspaceHeadRevisionId
        candidate.editBaseRunCount = candidate.runIds.length
        candidate.runIds.push(runId)
        candidate.status = 'running'
        group.activeRunId = runId
        group.activeCandidateId = candidate.id
        const restored = discussionRetry ? restoreDiscussionRetryInTransaction(ctx, discussionRetry, tx) : undefined
        const saved = store.save(group, { expectedRevision: group.revision })
        return { group: saved, candidate, editing: true, restored }
      }
    }
    if (!command && !retryFailed) {
      if (!communication && (!target?.inputNodeId || node?.id !== target.inputNodeId))
        throw swipeError('input_not_latest', 'The writing input must be the latest Narrative node')
      if (!communication && group && !group.closed && group.inputNodeId === target?.inputNodeId)
        throw swipeError('retry_required', 'This input already has an attempt; use retry or continue')
      if (group && !group.closed) store.closeLatest(branch.id)
      group = {
        id: discussionRetry?.user.roundId ?? (!communication && session.kind === 'timeline' && node?.entryId
          ? requireAgents(ctx).transaction(tx).getEntry(node.entryId)?.roundId ?? ctx.createId('swipe') : ctx.createId('swipe')),
        timelineId, branchId: branch.id,
        inputNodeId: discussionRetry ? discussionRetry.baseline.headNodeId ?? undefined : node?.id,
        input: communication ? input.input : node!.body.raw,
        ...(communication ? { inputKind: 'communication' as const } : {}),
        baselineStateRevisionId: discussionRetry?.baseline.stateRevisionId ?? branch.stateHeadRevisionId,
        baselineWorkspaceRevisionId: discussionRetry?.baseline.workspaceRevisionId ?? branch.workspaceHeadRevisionId, agentSessionId: session.id,
        baseEntryCount: discussionRetry ? discussionRetry.user.sequence - 1 : session.entryCount,
        baseEntryId: discussionRetry ? discussionRetry.baseline.headEntryId ?? undefined : session.headEntryId,
        candidates: [], generation: 0, revision: 0,
        closed: false, createdAt: ctx.now(), updatedAt: ctx.now(),
      }
    } else {
      if (!group || group.id !== (command?.groupId ?? existing?.id)
        || group.revision !== (command?.expectedRevision ?? existing?.revision) || group.closed)
        throw swipeError('conflict', 'Swipe changed before regeneration')
      const selected = group.candidates.find(item => item.id === group!.selectedCandidateId)
      if (selected) {
        if (!isCandidateHead(group, selected, node)) throw swipeError('conflict', 'The candidate head changed')
        if (selected.status === 'completed') {
          selected.headNodeId = branch.headNodeId
          selected.headEntryId = branch.headEntryId
          selected.stateRevisionId = branch.stateHeadRevisionId
          selected.workspaceRevisionId = branch.workspaceHeadRevisionId
        }
      } else if (branch.headNodeId !== group.inputNodeId) {
        throw swipeError('conflict', 'The input baseline changed')
      }
    }
    const previousRevision = group.revision || undefined
    rememberInputSelection(group)
    let restored: NarrativeBranch | undefined
    if (command?.input !== undefined) {
      if (!group.inputs) {
        group.inputs = [{ nodeId: group.inputNodeId!, input: group.input,
          baselineStateRevisionId: group.baselineStateRevisionId, baselineWorkspaceRevisionId: group.baselineWorkspaceRevisionId, selectedCandidateId: group.selectedCandidateId }]
        for (const previous of group.candidates) previous.inputNodeId = group.inputNodeId
      }
      const original = narratives.getNode(group.inputs[0]!.nodeId)
      if (!original) throw swipeError('target_missing', 'Original input baseline is missing')
      const baseline = narratives.restoreBranch({
        timelineId, branchId: branch.id, expectedHeadNodeId: branch.headNodeId ?? null,
        expectedStateHeadRevisionId: branch.stateHeadRevisionId,
        headNodeId: original.parentNodeId ?? null, stateRevisionId: original.stateRevisionId, workspaceRevisionId: original.workspaceRevisionId,
      })
      const originalEntry = original.entryId ? ctx.agents!.transaction(tx).getEntry(original.entryId)?.entry : undefined
      const appended = narratives.appendNode({
        attachments: originalEntry?.kind === 'message' ? originalEntry.attachments : undefined,
        kind: 'user-input',
        timelineId, branchId: branch.id, expectedHeadNodeId: baseline.headNodeId ?? null,
        stateRevisionId: original.stateRevisionId, body: { format: 'loom-markdown.v1', raw: command.input },
      })
      restored = appended.branch
      group.inputNodeId = appended.node.id
      group.baseEntryId = appended.node.entryId
      group.input = command.input
      group.baselineStateRevisionId = original.stateRevisionId
      group.baselineWorkspaceRevisionId = original.workspaceRevisionId
      group.selectedCandidateId = undefined
      group.inputs.push({ nodeId: group.inputNodeId, input: group.input, baselineStateRevisionId: group.baselineStateRevisionId, baselineWorkspaceRevisionId: group.baselineWorkspaceRevisionId })
    }
    if (command && command.mode !== 'swipe') {
      for (const previous of group.candidates) previous.status = 'discarded'
      group.selectedCandidateId = undefined
      for (const input of group.inputs ?? []) input.selectedCandidateId = undefined
    }
    const candidate: NarrativeSwipeCandidate = {
      id: ctx.createId('candidate'), inputNodeId: group.inputNodeId, agentSessionId: session.id, runIds: [runId],
      workspaceRevisionId: group.baselineWorkspaceRevisionId, stateRevisionId: group.baselineStateRevisionId, status: 'running', mode: command?.mode ?? (retryFailed ? 'retry' : 'initial'),
      replacesCandidateId: command?.mode === 'regenerate' ? group.selectedCandidateId : undefined, createdAt: ctx.now(),
    }
    if (command && command.input === undefined) restored = narratives.restoreBranch({
      timelineId, branchId: branch.id, expectedHeadNodeId: branch.headNodeId ?? null,
      expectedStateHeadRevisionId: branch.stateHeadRevisionId,
      headNodeId: group.inputNodeId ?? null,
      ...(session.kind === 'timeline' ? { headEntryId: baselineEntryId(group, tx, ctx) } : {}), stateRevisionId: group.baselineStateRevisionId, workspaceRevisionId: group.baselineWorkspaceRevisionId,
    })
    group.candidates.push(candidate)
    group.activeCandidateId = candidate.id
    group.activeRunId = runId
    group.generation += 1
    if (discussionRetry) restored = restoreDiscussionRetryInTransaction(ctx, discussionRetry, tx)
    return { group: store.save(group, { expectedRevision: previousRevision }), candidate, editing: false, restored }
  })
  const { group, candidate, editing, restored } = result.value
  if (restored) notifyRestored(ctx, restored, result.commit.changesetId)
  // Always re-read current resources in PromptBuild; only the user's story input is reused.
  if (command) {
    input.input = group.input
    input.narrativeTarget = { ...input.narrativeTarget, timelineId: group.timelineId, branchId: group.branchId,
      inputNodeId: group.inputKind === 'communication' ? undefined : group.inputNodeId }
  }
  return { groupId: group.id, candidateId: candidate.id, runId, generation: group.generation, editing,
    ...(group.inputKind === 'communication' && retryEntry?.parentEntryId === group.baseEntryId && input.retry
      ? { communicationInput: input.input } : {}),
  }
}

export async function finishNarrativeSwipeRun(
  ctx: SwipeContext, execution: SwipeExecution | undefined, outcome: 'completed' | 'suspended' | 'failed' | 'preparation-failed' | 'discarded', request?: RuntimeRequestContext,
) {
  if (!execution) return
  const result = await ctx.dataEngine.transact(narrativeWriteContext(request, 'application.finishNarrativeSwipeRun'), async tx => {
    const store = ctx.swipes.transaction(tx)
    const group = store.get(execution.groupId)
    if (!group || group.closed || group.activeRunId !== execution.runId || group.activeCandidateId !== execution.candidateId
      || group.generation !== execution.generation)
      throw swipeError('execution_stale', 'The writing attempt is no longer active')
    const candidate = group.candidates.find(item => item.id === execution.candidateId)!
    const narratives = requireNarratives(ctx).transaction(tx)
    const branch = narratives.getBranch(group.branchId)
    if (!branch) throw swipeError('target_missing', 'Narrative branch no longer exists')
    let restored: NarrativeBranch | undefined
    if (outcome === 'preparation-failed') {
      group.activeRunId = request!.agentRun!.continuation!.sourceRunId
      candidate.runIds = candidate.runIds.filter(id => id !== execution.runId)
      candidate.status = 'suspended'
    } else if (outcome === 'suspended') {
      candidate.status = 'suspended'
    } else {
      group.activeCandidateId = undefined
      group.activeRunId = undefined
      if (outcome === 'completed' && (branch.headNodeId !== group.inputNodeId || group.agentSessionId === group.timelineId)) {
        if (execution.communicationInput !== undefined) group.input = execution.communicationInput
        candidate.status = 'completed'
        candidate.headNodeId = branch.headNodeId
        candidate.headEntryId = branch.headEntryId
        candidate.stateRevisionId = branch.stateHeadRevisionId
        candidate.workspaceRevisionId = branch.workspaceHeadRevisionId
        candidate.editBaseRunCount = undefined
        group.selectedCandidateId = candidate.id
        if (candidate.replacesCandidateId) {
          const replaced = group.candidates.find(item => item.id === candidate.replacesCandidateId)
          if (replaced) replaced.status = 'discarded'
        }
      } else {
        const prior = group.candidates.find(item => item.id === group.selectedCandidateId)
        const editing = candidate.editBaseRunCount !== undefined && prior?.id === candidate.id
        // A failed discussion must not rewind accepted input when it changed no narrative material.
        const preserveCommunication = (outcome === 'discarded' || outcome === 'failed')
          && branch.headNodeId === (editing ? prior.headNodeId : group.inputNodeId)
          && branch.stateHeadRevisionId === (editing ? prior.stateRevisionId : group.baselineStateRevisionId)
          && branch.workspaceHeadRevisionId === (editing ? prior.workspaceRevisionId : group.baselineWorkspaceRevisionId)
        if (!preserveCommunication) restored = narratives.restoreBranch({
          timelineId: group.timelineId, branchId: group.branchId,
          expectedHeadNodeId: branch.headNodeId ?? null, expectedStateHeadRevisionId: branch.stateHeadRevisionId,
          headNodeId: (editing ? prior.headNodeId : group.inputNodeId) ?? null,
          ...(originalTimelineSession(tx, ctx, group.timelineId) ? { headEntryId: editing ? prior.headEntryId ?? null
            : baselineEntryId(group, tx, ctx) } : {}),
          stateRevisionId: editing ? prior.stateRevisionId : group.baselineStateRevisionId,
          workspaceRevisionId: editing ? prior.workspaceRevisionId : group.baselineWorkspaceRevisionId,
        })
        if (candidate.editBaseRunCount !== undefined && prior?.id === candidate.id) {
          candidate.status = 'completed'
          if (!preserveCommunication) group.excludedRunIds = [...(group.excludedRunIds ?? []), ...candidate.runIds.slice(candidate.editBaseRunCount)]
          else candidate.headEntryId = branch.headEntryId
          candidate.editBaseRunCount = undefined
        } else {
          candidate.status = 'failed'
          candidate.headNodeId = undefined
          candidate.stateRevisionId = group.baselineStateRevisionId
          candidate.workspaceRevisionId = group.baselineWorkspaceRevisionId
          group.selectedCandidateId = candidate.id
        }
        group.generation += 1
      }
    }
    rememberInputSelection(group)
    store.save(group, { expectedRevision: group.revision })
    return restored
  })
  if (result.value) notifyRestored(ctx, result.value, result.commit.changesetId)
}

export async function projectSwipeSessionHistory(ctx: Pick<SwipeContext, 'swipes'>, sessionId: string, entries: AgentTranscriptEntry[], includeFailed = false) {
  const groups = await ctx.swipes.listForSession(sessionId)
  const excluded = new Set<string>()
  for (const group of groups) {
    const adopted = group.activeCandidateId ?? group.selectedCandidateId
    for (const candidate of group.candidates) {
      if (candidate.id !== adopted || candidate.status === 'discarded' || (!includeFailed && candidate.status === 'failed'))
        candidate.runIds.forEach(id => excluded.add(id))
    }
    group.excludedRunIds?.forEach(id => excluded.add(id))
  }
  return entries.filter(entry => !entry.runId || !excluded.has(entry.runId))
}

export async function captureNarrativeExecutionSource(
  ctx: Pick<SwipeContext, 'swipes' | 'narratives'>, target: { timelineId: string; branchId: string; sourceNodeId?: string },
): Promise<NarrativeExecutionSource> {
  const group = await ctx.swipes.getLatest(target.branchId)
  const branch = await requireNarratives(ctx).getBranch(target.branchId)
  if (!branch || branch.timelineId !== target.timelineId) throw swipeError('target_missing', 'Narrative source no longer exists')
  if (target.sourceNodeId && branch.headNodeId !== target.sourceNodeId)
    throw swipeError('source_changed', 'The requested source is no longer the latest reply')
  return {
    timelineId: target.timelineId, branchId: target.branchId, nodeId: target.sourceNodeId ?? branch.headNodeId,
    cursorNodeId: branch.headNodeId,
    groupId: group?.id, candidateId: group?.activeCandidateId ?? group?.selectedCandidateId, generation: group?.generation,
  }
}

function assertSourceGroup(source: NarrativeExecutionSource, group: NarrativeSwipeGroup | null | undefined) {
  if (source.groupId !== group?.id || source.generation !== group?.generation)
    throw swipeError('source_changed', 'The writing source changed. Keep generated assets, but do not attach them to the new reply.')
}

export async function assertNarrativeExecutionSource(ctx: Pick<SwipeContext, 'swipes' | 'narratives'>, source: NarrativeExecutionSource) {
  const branch = await requireNarratives(ctx).getBranch(source.branchId)
  if (!branch || branch.timelineId !== source.timelineId) throw swipeError('target_missing', 'Narrative source was deleted')
  assertSourceGroup(source, await ctx.swipes.getLatest(source.branchId))
  if (branch.headNodeId !== source.cursorNodeId)
    throw swipeError('source_changed', 'The Narrative head changed after this task started')
}

export function guardNarrativeWrite<T>(
  ctx: Pick<SwipeContext, 'swipes' | 'narratives' | 'dataEngine'>, source: NarrativeExecutionSource, work: () => T,
): T {
  const checked = new WeakSet<SqliteDataTransaction>()
  return ctx.dataEngine.withTransactionGuard(async (tx: SqliteDataTransaction) => {
    const branch = requireNarratives(ctx).transaction(tx).getBranch(source.branchId)
    if (!branch || branch.timelineId !== source.timelineId) throw swipeError('target_missing', 'Narrative source was deleted')
    assertSourceGroup(source, ctx.swipes.transaction(tx).getLatest(source.branchId))
    // The transaction itself may advance the head. Its precondition is checked before writes.
    if (!checked.has(tx) && branch.headNodeId !== source.cursorNodeId)
      throw swipeError('source_changed', 'The Narrative head changed after this task started')
    checked.add(tx)
  }, work)
}

function originalTimelineSession(tx: SqliteDataTransaction, ctx: SwipeContext, timelineId: string): boolean {
  return ctx.agents?.transaction(tx).getSession(timelineId)?.kind === 'timeline'
}
