import { useEffect, useRef, useState } from 'react'
import type { AgentSession, AgentTranscriptEntry, InvokeAgentTurnResult } from '../../../entities/index.js'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import { notify } from '../../../shared/notifications/index.js'
import { subscribeDataCommits } from '../../../shared/api/data-commit-events.js'
import { loadTranscript, resolveSessionRun, retainRunPresentation, type ObservedRun } from './agent-run-observer.js'
import { useSessionRun, streamingEntry } from './use-session-run.js'

/** Timeline execution stays observed when the sidebar selects another Session. */
export function useTimelineSession(api: StudioApi, timelineId: string | undefined, branchId: string | undefined, runAction: (action: () => Promise<void>) => Promise<boolean>, refreshNarrative: () => Promise<void>, onCompleted?: (result: InvokeAgentTurnResult) => void) {
  const [session, setSession] = useState<AgentSession>()
  const [entries, setEntries] = useState<AgentTranscriptEntry[]>([])
  const source = useRef({ api, timelineId, branchId, selection: 0 })
  if (source.current.api !== api || source.current.timelineId !== timelineId || source.current.branchId !== branchId)
    source.current = { api, timelineId, branchId, selection: source.current.selection + 1 }
  const reading = useRef(0)
  const lifecycle = useSessionRun({
    kind: 'timeline', api,
    isCurrent: run => run.selection === source.current.selection && run.api === source.current.api,
    makeRun,
    updateEntries: (_run, update) => setEntries(update),
    refresh: async run => {
      const [transcript] = await Promise.all([refresh(), refreshNarrative()])
      if (lifecycle.owns(run) && run.status === 'failed' && transcript)
        return resolveSessionRun(api, run.sessionId, transcript.entries)
    },
    narrativeCommitted: async () => { await runAction(refreshNarrative) },
    completed: (_run, result) => onCompleted?.(result),
    reportFailure: error => notify.providerError(error),
    reportAcknowledgement: error => notify.providerError(error),
  })
  const { activeRun, setActiveRun, recovery, setRecovery, observed, starting, observe } = lifecycle

  function makeRun(runId: string): ObservedRun | undefined {
    const target = source.current
    if (!target.timelineId || !target.branchId) return
    return { api, selection: target.selection, sessionId: target.timelineId, runId, target: 'narrative',
      narrativeTarget: { timelineId: target.timelineId, branchId: target.branchId },
      streamingId: `streaming-timeline-${runId}`, cursor: 0, status: 'running', observing: false }
  }

  async function refresh() {
    const target = source.current
    if (!target.timelineId) return
    const request = ++reading.current
    const transcript = await loadTranscript(api, target.timelineId, true)
    if (target !== source.current) return
    if (request === reading.current) {
      setSession(transcript.session)
      // The Run observer owns in-flight deltas; a commit refresh must not erase them.
      if (!observed.current?.observing || observed.current.status !== 'running')
        setEntries(current => retainRunPresentation(current, transcript.entries))
      else setEntries(current => {
        const ids = new Set(current.map(item => item.id))
        return [...current, ...transcript.entries.filter(item => !ids.has(item.id) && (item.entry.kind === 'user-interjection' || item.entry.kind === 'interjection-applied' || item.entry.kind === 'interjection-discarded'))]
      })
    }
    // A newer read owns publication, but terminal recovery still needs this
    // snapshot to ask the server for the observed Run's authoritative state.
    return transcript
  }

  useEffect(() => {
    const target = source.current
    observed.current = undefined
    setSession(undefined)
    setEntries([])
    setActiveRun(undefined)
    setRecovery(undefined)
    if (!timelineId) return
    const restore = async () => {
      const transcript = await refresh()
      if (!transcript || target !== source.current) return
      const active = await resolveSessionRun(api, timelineId, transcript.entries)
      if (target !== source.current || observed.current) return
      setActiveRun(active)
      if (active?.status === 'running') follow(makeRun(active.runId)!)
      else if (active?.status === 'suspended') setRecovery({ target: 'narrative', status: 'suspended', error: active.error })
    }
    void runAction(restore)
    const unsubscribe = subscribeDataCommits(operations => {
      if (operations.some(item => item.entityId === timelineId || item.scope?.entityId === timelineId)) void runAction(async () => { await refresh() })
    }, () => { void runAction(async () => { await refresh() }) })
    return () => { unsubscribe(); reading.current++; if (source.current === target) source.current = { ...target, selection: target.selection + 1 } }
  }, [api, timelineId, branchId])

  async function execute(request: Parameters<StudioApi['agentSessions']['createRun']>[0], create: (request: Parameters<StudioApi['agentSessions']['createRun']>[0]) => ReturnType<StudioApi['agentSessions']['createRun']>, onStarted?: () => void) {
    if (starting.current || observed.current?.observing) throw new Error('请先结束当前故事执行')
    if (activeRun?.status === 'suspended' && !request.retry) await lifecycle.abandon()
    const target = source.current
    starting.current = true
    try {
      const started = await create(request)
      if (source.current !== target) return
      onStarted?.()
      await executeStarted(started.runId)

    } finally { starting.current = false }
  }

  function follow(run: ObservedRun) {
    void observe(run).catch(error => notify.providerError(error))
  }
  async function executeStarted(runId: string) {
    if (observed.current?.runId === runId && observed.current.observing) return
    const run = makeRun(runId)
    if (!run) return
    setEntries(current => [...current, streamingEntry(run, current)])
    follow(run)
  }
  async function configure(patch: { agentPresetId?: string; narrativeMode?: 'declared' | 'automatic' }) {
    if (!timelineId || activeRun?.status === 'running' || activeRun?.status === 'suspended' || starting.current) throw new Error('请先结束当前故事执行')
    const target = source.current
    const result = await api.agentSessions.update({ agentSessionId: timelineId, ...patch })
    if (source.current === target) setSession(result.session)
  }
  async function refreshTask() {
    const target = source.current
    const transcript = await refresh()
    if (!transcript || !target.timelineId || source.current !== target) return
    const active = await resolveSessionRun(api, target.timelineId, transcript.entries)
    if (source.current !== target) return
    setActiveRun(active)
    setRecovery(active?.status === 'suspended' ? { target: 'narrative', status: 'suspended', error: active.error } : undefined)
  }
  return { acceptEntry: (entry: AgentTranscriptEntry) => setEntries(current => current.some(item => item.id === entry.id) ? current.map(item => item.id === entry.id ? entry : item) : [...current, entry]), session: session?.id === timelineId ? session : undefined, entries, activeRun, recovery, execute, executeStarted,
    approve: lifecycle.approve, configure, refresh, refreshTask, reconnect: lifecycle.reconnect,
    pause: lifecycle.pause, resume: lifecycle.resume, abandon: lifecycle.abandon }
}
