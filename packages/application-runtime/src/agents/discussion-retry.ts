import type { AgentTranscriptEntry, NarrativeBranch } from '@loom-studio/application-data'
import type { SqliteDataTransaction } from '@loom-studio/data-engine'
import type { ApplicationRuntimeContext } from '../foundation/application-context.js'
import type { InvokeAgentTurnInput, RuntimeRequestContext } from '../types.js'
import { requireAgents, requireNarratives } from '../runtime/context.js'
import { parseAgentRunMaterialBaseline, type AgentRunMaterialBaseline } from './run-recovery.js'

type RetryContext = Pick<ApplicationRuntimeContext, 'agents' | 'narratives'>

function retryError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code: `agent.retry_${code}` })
}

export type DiscussionRetry = {
  user: AgentTranscriptEntry
  baseline: AgentRunMaterialBaseline
  branch: NarrativeBranch
  entryCount: number
}

async function readLegacyProviderFailureBaseline(
  ctx: RetryContext, user: AgentTranscriptEntry, latestUser: AgentTranscriptEntry | undefined,
  afterUser: AgentTranscriptEntry[], branch: NarrativeBranch, entryCount: number,
): Promise<AgentRunMaterialBaseline> {
  const checkpoint = afterUser.find(entry => entry.entry.kind === 'run-state' && entry.entry.recovery)
  const recovery = checkpoint?.entry.kind === 'run-state' ? checkpoint.entry.recovery : undefined
  const latestState = afterUser.find(entry => entry.entry.kind === 'run-state')
  const output = recovery?.narrativeOutput
  if (latestUser?.id !== user.id || !recovery || recovery.userEntryId !== user.id
    || recovery.phase !== 'provider' || recovery.nextProviderStep !== 1
    || recovery.acceptedContent !== undefined || recovery.partialEntryId !== undefined || recovery.pendingAssistantContent !== undefined
    || output !== undefined && (typeof output !== 'object' || output === null || Array.isArray(output) || output.declared !== false
      || output.logicalId !== undefined || output.consumedEntryId !== undefined)
    || latestState?.entry.kind !== 'run-state' || !['failed', 'aborted', 'discarded'].includes(latestState.entry.state)
    || afterUser.some(entry => entry.runId !== user.runId || !['run-state', 'request-measurement', 'reasoning'].includes(entry.entry.kind)))
    throw retryError('baseline_missing', 'This older input has no baseline and its failed first Provider request cannot be proven free of tool or assistant effects')
  const narratives = requireNarratives(ctx)
  const node = branch.headNodeId ? await narratives.getNode(branch.headNodeId) : undefined
  let found = !branch.headNodeId
  let cursor = user.parentEntryId
  while (!found && cursor) {
    const prefix = await requireAgents(ctx).getEntryPage({ agentSessionId: user.agentSessionId, cursor, limit: 100 })
    if (prefix.session.entryCount !== entryCount || prefix.session.headEntryId !== branch.headEntryId)
      throw retryError('conflict', 'Agent history changed while checking the older input')
    found = Boolean(node?.entryId && prefix.entries.some(entry => entry.id === node.entryId))
    cursor = prefix.nextCursor
  }
  if (!found) throw retryError('baseline_missing', 'Narrative changed after this older input; its original material baseline is unavailable')
  return {
    timelineId: branch.timelineId, branchId: branch.id,
    headNodeId: branch.headNodeId ?? null, headEntryId: user.parentEntryId ?? null,
    stateRevisionId: branch.stateHeadRevisionId, workspaceRevisionId: branch.workspaceHeadRevisionId,
  }
}

export async function readDiscussionRetry(ctx: RetryContext, input: InvokeAgentTurnInput, request?: RuntimeRequestContext, allowSuspended = false): Promise<DiscussionRetry | undefined> {
  if (!input.retry) return undefined
  if (input.contextMode === 'isolated' || input.resume || request?.agentRun?.continuation || input.narrativeTarget?.inputNodeId || input.narrativeTarget?.swipe)
    throw retryError('invalid_target', 'Discussion retry cannot be combined with continuation or story generation')
  if (!input.input.trim() && !input.attachments?.length) throw retryError('empty_input', 'Retry input cannot be empty')
  const agents = requireAgents(ctx)
  const session = await agents.getSession(input.agentSessionId)
  if (session?.kind !== 'timeline') throw retryError('invalid_target', 'Discussion retry requires the Timeline Session')
  const page = await requireNarratives(ctx).getPage({ timelineId: session.id, branchId: input.narrativeTarget?.branchId, limit: 1 })
  if (page.timeline.activeBranchId !== page.branch.id || input.narrativeTarget && input.narrativeTarget.timelineId !== session.id)
    throw retryError('invalid_target', 'Retry requires the currently adopted Timeline branch')
  let cursor: string | undefined
  let latestUser: AgentTranscriptEntry | undefined
  const afterUser: AgentTranscriptEntry[] = []
  const states = new Map<string, string>()
  do {
    const history = await agents.getEntryPage({ agentSessionId: session.id, cursor, limit: 100 })
    if (history.session.entryCount !== session.entryCount || history.session.headEntryId !== session.headEntryId)
      throw retryError('conflict', 'Agent history changed while preparing retry')
    for (const entry of [...history.entries].reverse()) {
      if (entry.runId && entry.entry.kind === 'run-state' && !states.has(entry.runId)) states.set(entry.runId, entry.entry.state)
      if (entry.entry.kind === 'run-state' && entry.entry.sourceRunId && !states.has(entry.entry.sourceRunId)) states.set(entry.entry.sourceRunId, 'transferred')
      if (entry.entry.kind === 'message' && entry.entry.role === 'user') { latestUser = entry; break }
      afterUser.push(entry)
    }
    cursor = history.nextCursor
  } while (!latestUser && cursor)
  const user = await agents.getEntry(input.retry.entryId)
  if (!user || user.agentSessionId !== session.id || user.entry.kind !== 'message' || user.entry.role !== 'user' || user.entry.purpose === 'narrative' || !user.runId)
    throw retryError('superseded', 'Only the latest adopted discussion input can be retried')
  if ([...states.values()].some(state => (allowSuspended ? ['created', 'running'] : ['created', 'running', 'suspended']).includes(state)))
    throw retryError('unfinished', 'Finish or abandon the interrupted Run before retrying')
  const checkpoint = await agents.findRunCheckpoint({ agentSessionId: session.id, runId: user.runId })
  const recovery = checkpoint?.entry.kind === 'run-state' ? checkpoint.entry.recovery : undefined
  if (!user.entry.editBaseline && recovery?.materialBaseline && recovery.userEntryId !== user.id)
    throw retryError('baseline_missing', 'The saved material baseline does not identify this user input')
  const baseline = user.entry.editBaseline ? parseAgentRunMaterialBaseline(user.entry.editBaseline) : recovery?.materialBaseline
    ? parseAgentRunMaterialBaseline(recovery.materialBaseline)
    : await readLegacyProviderFailureBaseline(ctx, user, latestUser, afterUser, page.branch, session.entryCount)
  if (baseline.timelineId !== session.id || baseline.branchId !== page.branch.id || baseline.headEntryId !== (user.parentEntryId ?? null))
    throw retryError('invalid_target', 'The original discussion baseline does not match this branch')
  if (latestUser?.id !== user.id) {
    const raw = await agents.listEntries(session.id)
    const latestRawUser = raw.findLast(entry => entry.entry.kind === 'message' && entry.entry.role === 'user')
    const state = raw.findLast(entry => entry.entry.kind === 'run-state')
    const abandonedCheckpoint = raw.findLast(entry => entry.runId === state?.runId && entry.entry.kind === 'run-state' && entry.entry.recovery)
    const abandonedUserId = abandonedCheckpoint?.entry.kind === 'run-state' ? abandonedCheckpoint.entry.recovery?.userEntryId : undefined
    const branch = page.branch
    if (latestRawUser?.id !== user.id || state?.entry.kind !== 'run-state' || state.entry.state !== 'discarded' || abandonedUserId !== user.id
      || (branch.headEntryId ?? null) !== baseline.headEntryId || (branch.headNodeId ?? null) !== baseline.headNodeId
      || branch.stateHeadRevisionId !== baseline.stateRevisionId || branch.workspaceHeadRevisionId !== baseline.workspaceRevisionId)
      throw retryError('superseded', 'Only the latest adopted or just-abandoned discussion input can be retried')
  }
  input.narrativeTarget = { timelineId: session.id, branchId: page.branch.id }
  return { user, baseline, branch: page.branch, entryCount: session.entryCount }
}

export function restoreDiscussionRetryInTransaction(ctx: RetryContext, retry: DiscussionRetry, tx: SqliteDataTransaction): NarrativeBranch {
  const { baseline, branch } = retry
  const agents = requireAgents(ctx).transaction(tx)
  const session = agents.getSession(baseline.timelineId)
  const narratives = requireNarratives(ctx).transaction(tx)
  const current = narratives.getBranch(branch.id)
  if (!session || session.entryCount !== retry.entryCount || session.headEntryId !== branch.headEntryId
    || !current || current.headEntryId !== branch.headEntryId)
    throw retryError('conflict', 'Agent history changed before retrying')
  return narratives.restoreBranch({
    timelineId: baseline.timelineId, branchId: branch.id,
    expectedHeadNodeId: branch.headNodeId ?? null, expectedStateHeadRevisionId: branch.stateHeadRevisionId,
    expectedWorkspaceHeadRevisionId: branch.workspaceHeadRevisionId,
    headNodeId: baseline.headNodeId, headEntryId: baseline.headEntryId,
    stateRevisionId: baseline.stateRevisionId, workspaceRevisionId: baseline.workspaceRevisionId,
  })
}
