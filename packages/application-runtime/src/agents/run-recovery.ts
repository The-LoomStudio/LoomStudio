import { isRecord, type ChatMessage, type JsonObject } from '@loom-studio/shared'
import type { AgentStore, AgentTranscriptEntry, AgentTranscriptEntryData } from '@loom-studio/application-data'
import type { InvokeAgentTurnInput, ProviderModelSelection, ApplyStateMutationInput, GatewayChatResult, TimelineExtensionLease } from '../types.js'
import type { ProcessedPromptSnapshot } from '../prompt/process-prompt.js'
import type { NarrativeExecutionSource } from '../runtime/swipe-runtime.js'

export type AgentRunRecoveryCheckpoint = {
  version: 1
  phase: 'provider' | 'tools' | 'content'
  executor: { pid: number; id: string }
  request: InvokeAgentTurnInput
  sendRequestDigest?: string
  narrativeSource?: NarrativeExecutionSource
  materialBaseline?: AgentRunMaterialBaseline
  model: ProviderModelSelection
  toolContract: string
  messages: ChatMessage[]
  userEntryId: string
  nextProviderStep: number
  partialEntryId?: string
  processedPrompt?: ProcessedPromptSnapshot
  promptExtensionLeases: TimelineExtensionLease[]
  narrativeOutput?: { declared: boolean; logicalId?: string; consumedEntryId?: string }
  pendingAssistantContent?: string
  acceptedContent?: {
    mutation: ApplyStateMutationInput
    extensionLeases: TimelineExtensionLease[]
    entries: AgentTranscriptEntryData[]
    providerResult: GatewayChatResult
    diagnostics?: string[]
    continueAfter?: boolean
  }
}

export type AgentRunMaterialBaseline = {
  timelineId: string
  branchId: string
  headNodeId: string | null
  headEntryId: string | null
  stateRevisionId: string
  workspaceRevisionId: string
}

export function parseAgentRunMaterialBaseline(value: unknown): AgentRunMaterialBaseline {
  if (!isRecord(value) || !['timelineId', 'branchId', 'stateRevisionId', 'workspaceRevisionId'].every(key => typeof value[key] === 'string' && value[key])
    || !['headNodeId', 'headEntryId'].every(key => value[key] === null || typeof value[key] === 'string' && value[key]))
    throw recoveryError('checkpoint_invalid', 'Agent material baseline is invalid')
  return value as AgentRunMaterialBaseline
}

export type AgentRunRecovery = {
  request: InvokeAgentTurnInput
  continuation: {
    sourceRunId: string
    messages: ChatMessage[]
    userEntry: AgentTranscriptEntry
    partialEntryId?: string
    recovery: AgentRunRecoveryCheckpoint
    expectedEntryCount: number
  }
}

const activeExecutors = new Set<string>()

export function registerAgentExecutor(id: string): () => void {
  activeExecutors.add(id)
  return () => { activeExecutors.delete(id) }
}

export function encodeRunRecovery(checkpoint: AgentRunRecoveryCheckpoint): JsonObject {
  // Persist only JSON fields; optional request properties can contain undefined in memory.
  return JSON.parse(JSON.stringify(checkpoint)) as JsonObject
}

function recoveryError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code: `agent.recovery_${code}` })
}

function assertExecutorStopped(executor: AgentRunRecoveryCheckpoint['executor']): void {
  if (executor.pid === process.pid) {
    if (activeExecutors.has(executor.id)) throw recoveryError('executor_active', 'The original Agent executor is still active')
    return
  }
  try {
    process.kill(executor.pid, 0)
  } catch (error) {
    if (isRecord(error) && error.code === 'ESRCH') return
    throw recoveryError('executor_unknown', 'Cannot confirm that the original Agent executor has stopped')
  }
  throw recoveryError('executor_active', 'The original Agent process is still alive')
}

function parseCheckpoint(value: JsonObject): AgentRunRecoveryCheckpoint {
  if (!isRecord(value) || value.version !== 1 || !['provider', 'tools', 'content'].includes(String(value.phase))
    || !isRecord(value.executor) || !Number.isSafeInteger(value.executor.pid) || Number(value.executor.pid) <= 0
    || typeof value.executor.id !== 'string' || !value.executor.id
    || !isRecord(value.request) || typeof value.request.agentSessionId !== 'string' || typeof value.request.input !== 'string'
    || !isRecord(value.model) || typeof value.model.providerProfileId !== 'string' || typeof value.model.modelId !== 'string'
    || (value.sendRequestDigest !== undefined && (typeof value.sendRequestDigest !== 'string' || !/^[a-f0-9]{64}$/.test(value.sendRequestDigest)))
    || typeof value.toolContract !== 'string' || typeof value.userEntryId !== 'string'
    || !Number.isSafeInteger(value.nextProviderStep) || Number(value.nextProviderStep) < 1
    || !Array.isArray(value.messages) || !value.messages.length || !value.messages.every(message => isRecord(message)
      && ['system', 'developer', 'user', 'assistant', 'tool'].includes(String(message.role))
      && (message.content === undefined || message.content === null || typeof message.content === 'string' || Array.isArray(message.content)))
    || (value.partialEntryId !== undefined && typeof value.partialEntryId !== 'string')) {
    throw recoveryError('checkpoint_invalid', 'Agent recovery checkpoint is incomplete or unsupported')
  }
  const target = value.request.narrativeTarget
  if (value.materialBaseline !== undefined) {
    const baseline = parseAgentRunMaterialBaseline(value.materialBaseline)
    if (!isRecord(target) || baseline.timelineId !== target.timelineId || baseline.branchId !== target.branchId)
      throw recoveryError('checkpoint_invalid', 'Agent material baseline does not match its target')
  }
  if (value.narrativeSource !== undefined) {
    const source = value.narrativeSource
    if (!isRecord(source) || typeof source.timelineId !== 'string' || typeof source.branchId !== 'string'
      || !isRecord(target) || source.timelineId !== target.timelineId || source.branchId !== target.branchId
      || !['groupId', 'candidateId', 'nodeId', 'cursorNodeId'].every(key => source[key] === undefined || typeof source[key] === 'string')
      || (source.generation !== undefined && (!Number.isSafeInteger(source.generation) || Number(source.generation) < 0))) {
      throw recoveryError('checkpoint_invalid', 'Narrative execution source is invalid or does not match the original target')
    }
  }
  if (!Array.isArray(value.promptExtensionLeases) || !value.promptExtensionLeases.every(lease =>
    isRecord(lease) && isRecord(target) && lease.timelineId === target.timelineId
    && typeof lease.installationId === 'string' && lease.installationId.length > 0
    && typeof lease.generation === 'string' && lease.generation.length > 0
    && Number.isSafeInteger(lease.installationVersion) && Number(lease.installationVersion) > 0)) {
    throw recoveryError('checkpoint_invalid', 'Invalid Prompt extension dependencies')
  }
  if (value.narrativeOutput !== undefined && (!isRecord(value.narrativeOutput)
    || typeof value.narrativeOutput.declared !== 'boolean'
    || value.narrativeOutput.logicalId !== undefined && typeof value.narrativeOutput.logicalId !== 'string'
    || value.narrativeOutput.consumedEntryId !== undefined && typeof value.narrativeOutput.consumedEntryId !== 'string'))
    throw recoveryError('checkpoint_invalid', 'Narrative output checkpoint is invalid')
  if (value.pendingAssistantContent !== undefined && typeof value.pendingAssistantContent !== 'string')
    throw recoveryError('checkpoint_invalid', 'Pending assistant content must be text')
  if (value.phase === 'content') {
    const accepted = value.acceptedContent
    if (!isRecord(accepted) || !isRecord(accepted.mutation)
      || !isRecord(accepted.mutation.target) || accepted.mutation.target.scope !== 'timeline'
      || !isRecord(target) || accepted.mutation.target.timelineId !== target.timelineId
      || accepted.mutation.target.branchId !== target.branchId
      || typeof accepted.mutation.expectedRevisionId !== 'string'
      || typeof accepted.mutation.idempotencyKey !== 'string'
      || !Array.isArray(accepted.extensionLeases) || !accepted.extensionLeases.every(lease =>
        isRecord(lease) && lease.timelineId === target.timelineId
        && typeof lease.installationId === 'string' && lease.installationId.length > 0
        && typeof lease.generation === 'string' && lease.generation.length > 0
        && Number.isSafeInteger(lease.installationVersion) && Number(lease.installationVersion) > 0)
      || !Array.isArray(accepted.mutation.operations) || !accepted.mutation.operations.length
      || !accepted.mutation.operations.every(op => isRecord(op) && op.op === 'set'
        && typeof op.path === 'string' && op.path.startsWith('/') && op.path !== '/' && isRecord(op.value))
      || !Array.isArray(accepted.entries) || !accepted.entries.some(entry => isRecord(entry) && entry.kind === 'message')
      || !accepted.entries.every(entry => isRecord(entry) && typeof entry.content === 'string'
        && (entry.kind === 'reasoning' || entry.kind === 'message' && entry.role === 'assistant'))
      || (accepted.continueAfter !== undefined && typeof accepted.continueAfter !== 'boolean')
      || !isRecord(accepted.providerResult) || !isRecord(accepted.providerResult.message)
      || (accepted.diagnostics !== undefined && (!Array.isArray(accepted.diagnostics)
        || !accepted.diagnostics.every(message => typeof message === 'string')))
      || accepted.providerResult.message.role !== 'assistant') {
      throw recoveryError('checkpoint_invalid', 'Accepted content checkpoint is invalid')
    }
  } else if (value.acceptedContent !== undefined) {
    throw recoveryError('checkpoint_invalid', 'Accepted content requires the content recovery phase')
  }
  if (value.processedPrompt !== undefined) {
    const snapshot = value.processedPrompt
    if (!isRecord(snapshot) || !Array.isArray(snapshot.sourceNodes) || !Array.isArray(snapshot.contributions)
      || !isRecord(snapshot.projection) || !Array.isArray(snapshot.projection.messages)
      || !snapshot.sourceNodes.every(node => isRecord(node) && typeof node.id === 'string'
        && typeof node.sourceId === 'string' && typeof node.kind === 'string' && typeof node.displayName === 'string')
      || !snapshot.contributions.every(entry => isRecord(entry) && typeof entry.id === 'string'
        && typeof entry.content === 'string' && isRecord(entry.capabilities) && isRecord(entry.sourceRef)
        && typeof entry.sourceRef.kind === 'string' && typeof entry.sourceRef.sourceId === 'string'
        && typeof entry.sourceRef.sourceNodeId === 'string')
      || !snapshot.projection.messages.every(message => isRecord(message) && typeof message.content === 'string'
        && Array.isArray(message.fragmentIds) && message.fragmentIds.every(id => typeof id === 'string'))) {
      throw recoveryError('checkpoint_invalid', 'Processed Prompt recovery snapshot is invalid')
    }
  }
  if (target !== undefined && (!isRecord(target) || typeof target.timelineId !== 'string'
    || typeof target.branchId !== 'string' || (target.inputNodeId !== undefined && typeof target.inputNodeId !== 'string'))) {
    throw recoveryError('checkpoint_invalid', 'The original Narrative target is incomplete')
  }
  return value as unknown as AgentRunRecoveryCheckpoint
}

async function readRecoveryTranscript(agents: AgentStore, agentSessionId: string) {
  const entries: AgentTranscriptEntry[] = []
  let cursor: string | undefined
  let entryCount = 0
  do {
    const page = await agents.getEntryPage({ agentSessionId, cursor, limit: 100 })
    if (cursor && page.session.entryCount !== entryCount) throw recoveryError('conflict', 'Agent transcript changed while reading its checkpoint')
    entryCount = page.session.entryCount
    entries.push(...page.entries)
    cursor = page.nextCursor
  } while (cursor)
  entries.sort((left, right) => left.sequence - right.sequence)
  return { entries, entryCount }
}

export async function readAgentRunState(agents: AgentStore, input: { agentSessionId: string; runId: string; adoptedBranchId?: string }): Promise<{
  runId: string; state: 'running' | 'suspended' | 'completed' | 'failed' | 'cancelled'; entryCount: number; reason?: string
}> {
  const { entries, entryCount } = await readRecoveryTranscript(agents, input.agentSessionId)
  const newest = [...entries].reverse()
  const latest = newest.find(item => item.entry.kind === 'run-state')
  if (!latest || latest.entry.kind !== 'run-state' || latest.runId !== input.runId)
    throw recoveryError('superseded', 'This is no longer the latest Agent Run')
  if (activeExecutors.has(input.runId)) return { runId: input.runId, state: 'running', entryCount }
  const state = latest.entry.state
  const source = newest.find(item => item.runId === input.runId && item.entry.kind === 'run-state' && item.entry.recovery)?.entry
  if (source && isHistoricalRunPrefix({ ...latest, entry: source }, input.adoptedBranchId)) return {
    runId: input.runId, state: 'cancelled', entryCount,
    reason: 'The adopted branch contains a historical execution prefix, not a resumable Run',
  }
  const checkpoint = newest.find(item => item.runId === input.runId && item.entry.kind === 'run-state' && item.entry.recovery)?.entry
  if (state === 'completed' || state === 'failed' && !checkpoint) return { runId: input.runId, state, entryCount, ...(latest.entry.reason ? { reason: latest.entry.reason } : {}) }
  if (state === 'discarded' || state === 'aborted') return { runId: input.runId, state: 'cancelled', entryCount }
  const executor = checkpoint?.kind === 'run-state' && isRecord(checkpoint.recovery) ? checkpoint.recovery.executor : undefined
  if (isRecord(executor) && Number.isSafeInteger(executor.pid) && typeof executor.id === 'string') {
    try { assertExecutorStopped({ pid: Number(executor.pid), id: executor.id }) }
    catch (error) {
      if (isRecord(error) && error.code === 'agent.recovery_executor_active') return { runId: input.runId, state: 'running', entryCount }
      throw error
    }
  }
  // Inspecting or abandoning stopped work does not replay tools and needs no complete resume checkpoint.
  return { runId: input.runId, state: 'suspended', entryCount, ...(latest.entry.reason ? { reason: latest.entry.reason } : {}) }
}

/** Reconcile durable execution markers only after their executor is known to have stopped.
 * This does not resume work or replay tools. The caller must compare entryCount when writing.
 */
export async function readInterruptedAgentRuns(agents: AgentStore, agentSessionId: string, currentRunId: string) {
  // Execution ownership is Session-wide, including histories outside the adopted branch.
  const session = await agents.getSession(agentSessionId)
  if (!session) throw new Error('Agent Session not found')
  const entries = await agents.listEntries(agentSessionId)
  const entryCount = session.entryCount
  if ((await agents.getSession(agentSessionId))?.entryCount !== entryCount)
    throw recoveryError('conflict', 'Agent transcript changed while checking execution ownership')
  const latest = new Map<string, AgentTranscriptEntry>()
  const checkpoints = new Map<string, AgentTranscriptEntry>()
  for (const item of entries) {
    if (!item.runId || item.runId === currentRunId || item.entry.kind !== 'run-state') continue
    latest.set(item.runId, item)
    if (item.entry.recovery) checkpoints.set(item.runId, item)
  }
  const interrupted: string[] = []
  for (const [runId, item] of latest) {
    if (item.entry.kind !== 'run-state' || !['created', 'running'].includes(item.entry.state)) continue
    if (activeExecutors.has(runId)) throw Object.assign(new Error('Agent Session already has an executing Run'), { code: 'agent.session_busy', runId })
    const checkpoint = checkpoints.get(runId)?.entry
    const executor = checkpoint?.kind === 'run-state' ? checkpoint.recovery?.executor : undefined
    if (isRecord(executor) && Number.isSafeInteger(executor.pid) && typeof executor.id === 'string') {
      assertExecutorStopped({ pid: Number(executor.pid), id: executor.id })
    }
    interrupted.push(runId)
  }
  return { interrupted, entryCount }
}

export async function readAgentRunRecovery(
  agents: AgentStore,
  input: { agentSessionId: string; runId?: string },
): Promise<AgentRunRecovery | undefined> {
  const { entries, entryCount } = await readRecoveryTranscript(agents, input.agentSessionId)
  const newestFirst = [...entries].reverse()
  const latestState = newestFirst.find(item => item.entry.kind === 'run-state')
  if (!latestState || latestState.entry.kind !== 'run-state') return undefined
  if (input.runId && input.runId !== latestState.runId) throw recoveryError('superseded', 'This Run was superseded by a later Run')
  if (latestState.entry.state === 'completed' || latestState.entry.state === 'discarded' || latestState.entry.state === 'aborted') return undefined
  const checkpointEntry = newestFirst.find(item => item.runId === latestState.runId && item.entry.kind === 'run-state' && item.entry.recovery)
  if (!checkpointEntry || checkpointEntry.entry.kind !== 'run-state' || !checkpointEntry.entry.recovery) {
    throw recoveryError('checkpoint_missing', 'This Run has no durable checkpoint; it cannot be resumed without reconstructing its missing context')
  }
  const checkpoint = parseCheckpoint(checkpointEntry.entry.recovery)
  if (checkpoint.request.agentSessionId !== input.agentSessionId || checkpoint.executor.id !== latestState.runId) {
    throw recoveryError('checkpoint_invalid', 'Agent checkpoint identity does not match the Run')
  }
  assertExecutorStopped(checkpoint.executor)
  if (checkpoint.phase === 'tools' || entries.some(item => item.sequence > checkpointEntry.sequence
    && item.runId === latestState.runId && (item.entry.kind === 'tool-invocation' || item.entry.kind === 'tool-result'))) {
    throw recoveryError('tool_outcome_unknown', 'The interrupted tool step has no complete recovery checkpoint; completed side effects will not be repeated')
  }
  const userEntry = entries.find(item => item.id === checkpoint.userEntryId)
  if (!userEntry || userEntry.entry.kind !== 'message' || userEntry.entry.role !== 'user') {
    throw recoveryError('checkpoint_invalid', 'The original Agent user entry is missing')
  }
  if (entries.some(item => item.sequence > checkpointEntry.sequence && (item.entry.kind === 'work-summary'
    || item.entry.kind === 'message' && item.entry.role === 'user'))) {
    throw recoveryError('superseded', 'New input or a work summary superseded this checkpoint')
  }
  return {
    request: checkpoint.request,
    continuation: {
      sourceRunId: latestState.runId!,
      messages: checkpoint.messages, userEntry,
      ...(checkpoint.partialEntryId ? { partialEntryId: checkpoint.partialEntryId } : {}),
      recovery: checkpoint, expectedEntryCount: entryCount,
    },
  }
}

/** A branch cut keeps facts without reviving the executor from the original branch. */
export function isHistoricalRunPrefix(entry: AgentTranscriptEntry, adoptedBranchId?: string): boolean {
  if (!adoptedBranchId || entry.entry.kind !== 'run-state') return false
  const source = entry.entry.recovery?.narrativeSource
  return isRecord(source) && typeof source.branchId === 'string' && source.branchId !== adoptedBranchId
}
