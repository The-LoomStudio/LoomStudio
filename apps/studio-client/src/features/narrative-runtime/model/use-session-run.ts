import { useRef, useState } from 'react'
import type { AgentTranscriptEntry, InvokeAgentTurnResult } from '../../../entities/index.js'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import { runAgentTurn, type ActiveAgentRun, type ObservedRun, type RunRecovery } from './agent-run-observer.js'

type Input = {
  kind: 'timeline' | 'sidebar'
  api: StudioApi
  isCurrent(run: ObservedRun): boolean
  makeRun(runId: string, previous?: ObservedRun, action?: 'resume' | 'abandon'): ObservedRun | undefined
  updateEntries(run: ObservedRun, update: (entries: AgentTranscriptEntry[]) => AgentTranscriptEntry[]): void
  refresh(run: ObservedRun, recovery?: RunRecovery): Promise<ActiveAgentRun | void>
  completed(run: ObservedRun, result: InvokeAgentTurnResult): void
  reportFailure(error: unknown): void
  reportAcknowledgement(error: unknown): void
  abandonRejected?: string
  abandonNotSuspended?: string
}

/** One instance per independently observed Session; the host owns its selection and projections. */
export function useSessionRun(input: Input) {
  const [activeRun, setActiveRun] = useState<ActiveAgentRun>()
  const [recovery, setRecovery] = useState<RunRecovery>()
  const [busy, setBusy] = useState(false)
  const observed = useRef<ObservedRun | undefined>(undefined)
  const starting = useRef(false)
  const owns = (run: ObservedRun) => observed.current === run && input.isCurrent(run)

  async function refresh(run: ObservedRun, recovered?: RunRecovery, current = () => owns(run)) {
    if (!current()) return
    setRecovery(recovered)
    try {
      const authoritative = await input.refresh(run, recovered)
      if (!current()) return
      if (run.status === 'failed' && authoritative?.runId === run.runId) {
        run.status = authoritative.status
        setActiveRun(authoritative)
        recovered = authoritative.status === 'suspended'
          ? { target: run.target, status: 'suspended', error: authoritative.error ?? recovered?.error } : undefined
      }
      setRecovery(recovered)
    } catch (error) {
      if (current()) setRecovery({ ...recovered, target: run.target, status: recovered?.status ?? 'refresh-failed', refreshFailed: true,
        error: [recovered?.error, message(error)].filter(Boolean).join('\n') })
      throw error
    }
  }

  async function settle(run: ObservedRun, error?: unknown) {
    const terminal = run.status === 'failed' || run.status === 'cancelled' || run.status === 'suspended'
    const recovered: RunRecovery | undefined = terminal ? {
      target: run.target, status: run.status as 'failed' | 'cancelled' | 'suspended',
      input: run.target === 'agent' ? run.input : undefined,
      ...(error ? { error: message(error) } : {}),
    } : undefined
    try { await refresh(run, recovered) } catch { /* Refresh failure is retained separately from the execution outcome. */ }
  }

  async function observe(run: ObservedRun) {
    if (!input.isCurrent(run) || observed.current?.runId === run.runId && observed.current.observing) return
    observed.current = run
    run.observing = true
    setBusy(true)
    setActiveRun({ runId: run.runId, status: run.status })
    if (input.kind === 'timeline') setRecovery(undefined)
    try {
      let result: InvokeAgentTurnResult | undefined
      try {
        result = await runAgentTurn(run, () => owns(run), update => input.updateEntries(run, update), setActiveRun,
          () => setRecovery(current => input.kind === 'timeline' || current?.status === 'disconnected' ? undefined : current))
      } catch (error) {
        if (!owns(run)) return
        if (run.status === 'failed' || run.status === 'cancelled' || run.status === 'suspended') {
          if (input.kind === 'sidebar' && run.status !== 'cancelled') input.reportFailure(error)
          await settle(run, error)
        } else setRecovery({ target: run.target, status: 'disconnected', error: message(error) })
        throw error
      }
      if (!owns(run)) return
      if (result) input.completed(run, result)
      const acknowledge = () => { void run.api.agentSessions.acknowledgeRunCompletion(run.runId).catch(input.reportAcknowledgement) }
      if (result && input.kind === 'sidebar') acknowledge()
      if (input.kind === 'timeline' || run.status === 'cancelled') await settle(run)
      else {
        try { await refresh(run) } catch (error) { if (run.status !== 'completed') throw error }
      }
      if (result && input.kind === 'timeline') acknowledge()
    } finally {
      run.observing = false
      if (owns(run)) setBusy(false)
    }
  }

  async function reconnect() {
    const run = observed.current
    if (starting.current) return
    if (!run) {
      const snapshot = recovery?.refreshFailed ? input.makeRun('') : undefined
      if (snapshot) await refresh(snapshot, undefined, () => input.isCurrent(snapshot))
      return
    }
    if (!owns(run) || run.observing) return
    if (run.status === 'running' || input.kind === 'sidebar' && run.status === 'suspended') return observe(run)
    run.observing = true
    setBusy(true)
    try {
      if (run.status === 'completed') await refresh(run)
      else await settle(run)
    } finally {
      run.observing = false
      if (owns(run)) setBusy(false)
    }
  }

  async function pause() {
    if (!activeRun || input.kind === 'sidebar' && activeRun.status !== 'running') return
    const result = await input.api.agentSessions.pauseRun(activeRun.runId)
    if (input.kind === 'timeline' && !result.accepted) throw new Error('故事执行未能暂停')
    if (result.accepted) setActiveRun(current => current?.runId === activeRun.runId ? { ...current, status: result.state } : current)
  }

  async function resume() {
    if (starting.current || activeRun?.status !== 'suspended'
      || input.kind === 'sidebar' && (observed.current?.observing || recovery?.status === 'disconnected')) return
    const previous = observed.current && owns(observed.current) && observed.current.runId === activeRun.runId ? observed.current : undefined
    const run = input.makeRun(activeRun.runId, previous, 'resume')
    if (!run) return
    starting.current = true
    try {
      const result = await run.api.agentSessions.resumeRun({ runId: run.runId, agentSessionId: run.sessionId })
      if (!result.accepted || !input.isCurrent(run)) return
      const resumed = input.makeRun(result.runId, previous, 'resume')!
      setRecovery(undefined)
      if (input.kind === 'sidebar') input.updateEntries(resumed, entries => [...entries, streamingEntry(resumed, entries)])
      await observe(resumed)
    } finally { starting.current = false }
  }

  async function abandon() {
    if (starting.current || activeRun?.status !== 'suspended'
      || input.kind === 'sidebar' && (busy || observed.current && (!owns(observed.current) || observed.current.observing))) return
    const run = observed.current ?? input.makeRun(activeRun.runId, undefined, 'abandon')
    if (run && !observed.current) run.status = 'suspended'
    if (!run || !input.isCurrent(run)) return
    starting.current = true
    observed.current = run
    run.observing = true
    setBusy(true)
    let abandoned = false
    try {
      if (input.kind === 'sidebar') {
        const state = await run.api.agentSessions.runState(run.runId, run.sessionId)
        if (!owns(run)) return
        if (state.state !== 'suspended') {
          run.status = state.state
          setActiveRun({ runId: state.runId, status: state.state })
          if (state.state === 'running') {
            setRecovery(undefined)
            run.observing = false
            await observe(run)
            return
          }
          throw new Error(input.abandonNotSuspended ?? 'The run is not suspended')
        }
      }
      const result = await run.api.agentSessions.abandonRun(run.runId, run.sessionId)
      if (!result.accepted) throw new Error(input.kind === 'timeline' ? '故事执行未能放弃' : input.abandonRejected ?? 'The attempt could not be abandoned')
      if (!owns(run)) return
      abandoned = true
      run.status = 'cancelled'
      setActiveRun(undefined)
      if (input.kind === 'timeline') observed.current = undefined
      await refresh(run, undefined, () => input.isCurrent(run) && (input.kind === 'timeline' || owns(run)))
    } catch (error) {
      if (!abandoned && owns(run)) setRecovery({ target: run.target,
        status: run.status === 'suspended' ? 'suspended' : run.status === 'running' ? 'disconnected' : 'failed', error: message(error) })
      throw error
    } finally {
      starting.current = false
      run.observing = false
      if (input.isCurrent(run)) setBusy(false)
    }
  }

  async function approve(allow: boolean, reason?: string) {
    const approval = activeRun?.approval
    if (!activeRun || !approval) return false
    const result = await (approval.action ? input.api.agentSessions.approveHistoryRead : input.api.agentSessions.approveMutation)(activeRun.runId, approval.requestId, allow, reason)
    if (result.accepted) setActiveRun(current => current?.runId === activeRun.runId && current.approval?.requestId === approval.requestId
      ? { ...current, approval: undefined } : current)
    return result.accepted
  }

  return { activeRun, setActiveRun, recovery, setRecovery, busy, setBusy, observed, starting, owns, observe, reconnect, pause, resume, abandon, approve }
}

export function streamingEntry(run: ObservedRun, entries: AgentTranscriptEntry[]): AgentTranscriptEntry {
  return { id: run.streamingId, runId: run.runId, agentSessionId: run.sessionId, sequence: (entries.at(-1)?.sequence ?? 0) + 1,
    entry: { kind: 'message', role: 'assistant', content: '' }, createdAt: new Date().toISOString() }
}

function message(error: unknown) { return error instanceof Error ? error.message : String(error) }
