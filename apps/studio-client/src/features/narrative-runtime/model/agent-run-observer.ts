import type { AgentSession, AgentTranscriptEntry, InvokeAgentTurnResult } from '../../../entities/index.js'
import type { AgentMutationApproval, StudioApi } from '../../../shared/api/studio-api.js'

export type AgentRunStatus = 'running' | 'suspended' | 'completed' | 'cancelled' | 'failed'
export type ActiveAgentRun = { runId: string; status: AgentRunStatus; error?: string; approval?: AgentMutationApproval }
export type RunRecovery = {
  target: 'narrative' | 'agent'
  status: 'disconnected' | 'failed' | 'cancelled' | 'refresh-failed' | 'suspended'
  error?: string
  refreshFailed?: boolean
  input?: string
}

export type ObservedRun = {
  api: StudioApi
  selection: number
  runId: string
  sessionId: string
  target: RunRecovery['target']
  input?: string
  narrativeTarget?: { timelineId: string; branchId: string }
  optimisticEntryId?: string
  streamingId: string
  cursor: number
  status: AgentRunStatus
  observing: boolean
}

export function inspectSessionRunStatus(entries: AgentTranscriptEntry[]): { runId?: string; status: 'idle' | 'running' | 'suspended' } {
  if (!entries.length) return { status: 'idle' }
  const lastRunState = entries.slice().reverse().find(e => e.entry.kind === 'run-state')
  if (lastRunState && lastRunState.entry.kind === 'run-state') {
    if (lastRunState.entry.state === 'suspended' || lastRunState.entry.state === 'running') {
      return { runId: lastRunState.runId, status: lastRunState.entry.state }
    }
    // Provider failures can retain a continuation checkpoint; the server decides
    // whether that persisted checkpoint is still resumable.
    if (lastRunState.entry.state === 'failed' && lastRunState.entry.recovery) {
      return { runId: lastRunState.runId, status: 'suspended' }
    }
    if (lastRunState.entry.state === 'completed' || lastRunState.entry.state === 'failed' || lastRunState.entry.state === 'aborted' || lastRunState.entry.state === 'discarded') {
      return { status: 'idle' }
    }
  }

  const lastUser = entries.slice().reverse().find(e => e.entry.kind === 'message' && e.entry.role === 'user')
  if (lastUser) {
    const userIdx = entries.indexOf(lastUser)
    const laterEntries = entries.slice(userIdx + 1)
    const hasCompletedAssistant = laterEntries.some(
      e => e.entry.kind === 'message' && e.entry.role === 'assistant' && e.entry.state !== 'partial' && typeof e.entry.content === 'string' && Boolean(e.entry.content.trim())
    )
    const hasCompletedRun = laterEntries.some(
      e => e.entry.kind === 'run-state' && e.entry.state === 'completed'
    )
    if (!hasCompletedAssistant || !hasCompletedRun) {
      return { runId: lastUser.runId, status: 'suspended' }
    }
  }

  return { status: 'idle' }
}

export async function resolveSessionRun(api: StudioApi, sessionId: string, entries: AgentTranscriptEntry[]): Promise<ActiveAgentRun | undefined> {
  const inspected = inspectSessionRunStatus(entries)
  if (!inspected.runId || inspected.status === 'idle') return undefined
  // Transcript records may describe an interrupted process or a still-running live task.
  const state = await api.agentSessions.runState(inspected.runId, sessionId)
  return state.state === 'running' || state.state === 'suspended'
    ? { runId: state.runId, status: state.state, error: state.state === 'suspended' && state.reason !== 'user-pause' ? state.reason : undefined } : undefined
}

export async function loadTranscript(api: StudioApi, agentSessionId: string, selectedCandidates = false) {
  const entries: AgentTranscriptEntry[] = []
  let cursor: string | undefined
  let session: AgentSession | undefined
  do {
    const page = await api.agentSessions.getTranscript({ agentSessionId, cursor, limit: 100, ...(selectedCandidates ? { selectedCandidates: true } : {}) })
    session = page.session
    entries.unshift(...page.entries)
    cursor = page.nextCursor
  } while (cursor)
  if (!session) throw new Error(`Agent session not found: ${agentSessionId}`)
  return { entries, session }
}

export async function releasePrimaryRun(api: StudioApi, sessionId: string): Promise<void> {
  const transcript = await loadTranscript(api, sessionId)
  const inspected = inspectSessionRunStatus(transcript.entries)
  if (!inspected.runId) return
  const run = await api.agentSessions.runState(inspected.runId)
  if (run.state === 'running') throw new Error('生成期间不能切换主写作对话')
  if (run.state !== 'suspended') return
  const abandoned = await api.agentSessions.abandonRun(run.runId)
  if (!abandoned.accepted) throw new Error('旧任务放弃失败，主写作对话未切换')
}

export async function runAgentTurn(
  run: ObservedRun,
  isCurrent: () => boolean,
  updateMessages: (update: (entries: AgentTranscriptEntry[]) => AgentTranscriptEntry[]) => void,
  updateRun: (run: ActiveAgentRun | undefined) => void,
  onConnected: () => void,
  onNarrativeCommitted?: () => Promise<void>,
): Promise<InvokeAgentTurnResult | undefined> {
  const { api, runId, streamingId } = run
  let lastApprovalId: string | undefined
  while (isCurrent()) {
    let batch = await subscribeAgentRunWithRetry(api, runId, run.cursor, run.sessionId)
    if (!isCurrent()) return undefined
    const replayExpired = batch.replayExpired
    if (batch.replayExpired) {
      const snapshot = batch
      const transcript = await loadTranscript(api, run.sessionId, true)
      if (!isCurrent()) return undefined
      if (!snapshot.done) {
        batch = await subscribeAgentRunWithRetry(api, runId, snapshot.nextCursor, run.sessionId)
        if (!isCurrent()) return undefined
        if (batch.replayExpired) {
          run.cursor = snapshot.nextCursor
          continue
        }
      }
      updateMessages(current => retainRunPresentation(current, transcript.entries))
      // Reuse the live event path, including identity, purpose and insertion boundary.
      // A commit received after this snapshot will replace its matching streamId.
      const committedStreams = new Set(transcript.entries.map(item => item.entry.streamId).filter(Boolean))
      batch = { ...batch, events: [...(snapshot.partialEvents ?? []).filter(event => !committedStreams.has(event.streamId)), ...batch.events] }
      updateRun({ runId, status: batch.state })
    }
    onConnected()
    run.cursor = batch.nextCursor
    const pendingApprovals = batch.pendingApprovals
    for (const event of [...batch.events, ...(pendingApprovals ?? [])]) {
      if (event.type === 'tool-input-delta') {
        updateMessages(entries => appendToolInput(settleReasoning(entries, runId), event, run))
      }
      if (event.type === 'completed' || event.type === 'failed' || event.type === 'cancelled' || event.type === 'suspended') {
        updateMessages(entries => interruptToolInputs(entries, runId))
      }
      if (event.type === 'transcript-appended') {
        const appended = event.entries
        updateMessages(current => mergeAgentRunEntries(current, appended, run))
        if (appended.some(item => item.entry.kind === 'message' && item.entry.purpose === 'narrative' && item.entry.state !== 'partial')) {
          await onNarrativeCommitted?.()
          if (!isCurrent()) return undefined
        }
      }
      if (event.type === 'reasoning-delta' && streamingId) {
        const id = event.streamId ? `streaming-reasoning-${event.streamId}` : `streaming-reasoning-${runId}:${event.providerRunId}:${event.reasoningId}`
        updateMessages(entries => {
          const existing = entries.find(entry => entry.id === id)
          if (existing) return entries.map(entry => entry === existing && entry.entry.kind === 'reasoning'
            ? { ...entry, id, presentationId: entry.presentationId ?? id, entry: { ...entry.entry, content: `${entry.entry.content ?? ''}${event.delta}`, state: 'partial' } } : entry)
          const placeholder = entries.find(entry => entry.id === streamingId && entry.entry.kind === 'message' && !entry.entry.content)
          const before = entries.filter(entry => entry !== placeholder)
          return [...before, { id, presentationId: `${id}:${event.providerRunId}`, agentSessionId: run.sessionId, runId,
            sequence: 0, streamAfterSequence: event.afterSequence, createdAt: new Date().toISOString(), roundId: event.roundId, candidateId: event.candidateId, timelinePosition: event.timelinePosition,
            entry: { streamId: event.streamId, kind: 'reasoning', content: event.delta, source: 'provider-native', visibility: 'collapsed', replay: 'omit' } },
            ...(placeholder ? [placeholder] : [])]
        })
      }
      if (event.type === 'text-delta' && streamingId) {
        updateMessages(current => {
          const entries = settleReasoning(current, runId)
          const placeholder = entries.find(entry => entry.id === streamingId)
          const entry: AgentTranscriptEntry = {
            id: streamingId, runId, agentSessionId: run.sessionId, roundId: event.roundId, candidateId: event.candidateId, timelinePosition: event.timelinePosition,
            sequence: 0, streamAfterSequence: event.afterSequence,
            createdAt: placeholder?.createdAt ?? new Date().toISOString(),
            presentationId: placeholder?.presentationId ?? `${streamingId}:${event.providerRunId}`,
            entry: { streamId: event.streamId, purpose: event.purpose, kind: 'message', role: 'assistant', state: 'partial', content: `${placeholder?.entry.kind === 'message' ? placeholder.entry.content : ''}${event.delta}` },
          }
          return placeholder ? entries.map(item => item.id === streamingId ? entry : item) : [...entries, entry]
        })
      }
      if (event.type === 'mutation-approval-requested'
        && (!pendingApprovals || pendingApprovals[0] && pendingApprovals[0].requestId === event.requestId)
        && event.requestId !== lastApprovalId) {
        lastApprovalId = event.requestId
        updateRun({
          runId,
          status: 'running',
          approval: {
            requestId: event.requestId,
            preview: event.preview,
          },
        })
      }
      if (event.type === 'history-read-approval-requested'
        && (!pendingApprovals || pendingApprovals[0] && pendingApprovals[0].requestId === event.requestId)
        && event.requestId !== lastApprovalId) {
        lastApprovalId = event.requestId
        updateRun({
          runId, status: 'running',
          approval: {
            requestId: event.requestId,
            action: event.action,
          },
        })
      }
      if (event.type === 'completed') {
        run.status = 'completed'
        updateRun({ runId, status: 'completed' })
        return event.result
      }
      if (event.type === 'failed') {
        run.status = 'failed'
        updateRun({ runId, status: 'failed' })
        throw new Error(event.error.message)
      }
      if (event.type === 'cancelled') {
        run.status = 'cancelled'
        updateRun({ runId, status: 'cancelled' })
        return undefined
      }
      if (event.type === 'suspended') {
        run.status = 'suspended'
        const error = event.reason && event.reason !== 'user-pause' ? event.reason : undefined
        updateRun({ runId, status: 'suspended', error })
        if (error) throw new Error(error)
        return undefined
      }
    }
    if (pendingApprovals?.length === 0 && lastApprovalId) {
      lastApprovalId = undefined
      updateRun({ runId, status: batch.state })
    }
    if (batch.done) {
      updateMessages(entries => interruptToolInputs(entries, runId))
      run.status = batch.state
      const error = batch.reason && batch.reason !== 'user-pause' ? batch.reason : undefined
      updateRun({ runId, status: batch.state, error })
      if (error && (batch.state === 'suspended' || batch.state === 'failed')) throw new Error(error)
      if (batch.state === 'cancelled' || batch.state === 'suspended') return undefined
      if (replayExpired && batch.state === 'completed') return undefined
      throw new Error(`Agent run ended without a completed result: ${runId}`)
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}

type ToolInput = Extract<Awaited<ReturnType<StudioApi['agentSessions']['subscribeRun']>>['events'][number], { type: 'tool-input-delta' }>

function appendToolInput(entries: AgentTranscriptEntry[], input: ToolInput, run: Pick<ObservedRun, 'runId' | 'sessionId'>): AgentTranscriptEntry[] {
  const id = `streaming-tool-${JSON.stringify([run.runId, input.providerRunId, input.toolCallId])}`
  const existing = entries.find(entry => entry.id === id)
  if (existing) return entries.map(entry => entry.id === id && entry.entry.kind === 'tool-input' ? {
    ...entry, entry: { ...entry.entry, rawInput: `${entry.entry.rawInput ?? ''}${input.delta}`,
      exposedName: input.toolName ?? entry.entry.exposedName },
  } : entry)
  return [...entries, {
    id, agentSessionId: run.sessionId, runId: run.runId, roundId: input.roundId, candidateId: input.candidateId, timelinePosition: input.timelinePosition,
    sequence: 0, streamAfterSequence: input.afterSequence, createdAt: new Date().toISOString(),
    entry: { streamId: input.streamId, kind: 'tool-input', providerItemId: input.toolCallId, exposedName: input.toolName,
      rawInput: input.delta, status: 'preparing' },
  }]
}

function settleReasoning(entries: AgentTranscriptEntry[], runId: string): AgentTranscriptEntry[] {
  return entries.map(entry => entry.runId === runId && entry.entry.kind === 'reasoning' && entry.id.startsWith('streaming-reasoning-')
    ? { ...entry, entry: { ...entry.entry, state: 'completed' } } : entry)
}

function interruptToolInputs(entries: AgentTranscriptEntry[], runId: string): AgentTranscriptEntry[] {
  return entries.map(entry => entry.runId === runId && entry.entry.kind === 'tool-input'
    ? { ...entry, entry: { ...entry.entry, status: 'interrupted' } } : entry)
}

export function retainRunPresentation(current: AgentTranscriptEntry[], incoming: AgentTranscriptEntry[]): AgentTranscriptEntry[] {
  const byId = new Map(current.map(entry => [entry.id, entry]))
  return incoming.map(entry => {
    const previous = byId.get(entry.id)
    const data = entry.entry
    const live = data.streamId ? current.find(item => item.entry.streamId === data.streamId) : undefined
    const presentationId = previous?.presentationId ?? live?.presentationId ?? live?.id
    return presentationId ? { ...entry, presentationId } : entry
  })
}

export function mergeAgentRunEntries(
  current: AgentTranscriptEntry[],
  appended: AgentTranscriptEntry[],
  run: Pick<ObservedRun, 'optimisticEntryId' | 'streamingId'>,
): AgentTranscriptEntry[] {
  const receivedIds = new Set(appended.map(entry => entry.id))
  const hasUser = appended.some(entry => entry.entry.kind === 'message' && entry.entry.role === 'user')
  const placeholder = current.find(entry => entry.id === run.streamingId)
  const committedStep = appended.some(entry => entry.entry.kind === 'message' && entry.entry.role === 'assistant'
    && (entry.entry.purpose !== 'narrative' || placeholder?.entry.streamId !== undefined && entry.entry.streamId === placeholder.entry.streamId)
    || entry.entry.kind === 'tool-invocation')
  const committedStreams = new Set(appended.map(entry => entry.entry.streamId).filter(Boolean))
  const entries = [
    ...current.filter(entry => entry.id !== run.streamingId && !receivedIds.has(entry.id)
      && !(entry.entry.streamId && committedStreams.has(entry.entry.streamId))
      && (!hasUser || entry.id !== run.optimisticEntryId)),
    ...retainRunPresentation(current, appended),
  ].sort((a, b) => (a.streamAfterSequence ?? a.sequence) - (b.streamAfterSequence ?? b.sequence))
  if (placeholder) {
    entries.push({
      ...placeholder,
      entry: committedStep ? { kind: 'message', role: 'assistant', content: '', state: 'partial' } : placeholder.entry,
      presentationId: committedStep ? undefined : placeholder.presentationId,
    })
  }
  return entries
}

async function subscribeAgentRunWithRetry(
  api: StudioApi,
  runId: string,
  cursor: number,
  agentSessionId: string,
) {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await api.agentSessions.subscribeRun(runId, cursor, agentSessionId)
    } catch (error) {
      lastError = error
      if (attempt < 2) {
        await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)))
      }
    }
  }
  throw lastError
}
