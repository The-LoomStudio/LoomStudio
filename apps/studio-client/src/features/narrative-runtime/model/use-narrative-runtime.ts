import type { ClientJsonValue } from '@loom-studio/client-bridge'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import type {
  AgentTranscriptEntry,
  AgentSession,
  Card,
  InvokeAgentTurnResult,
  NarrativeBranch,
  NarrativeNode,
  NarrativeTimeline,
  PreviewAgentTurnResult,
} from '../../../entities/index.js'
import type { AgentMutationApproval, StudioApi } from '../../../shared/api/studio-api.js'
import { subscribeDataCommits } from '../../../shared/api/data-commit-events.js'
import { safeLocalStorage } from '../../../shared/browser/safe-local-storage.js'
import type { LatestOperationContext } from '../../../shared/hooks/use-async-operations.js'

type AgentRunStatus = 'running' | 'suspended' | 'completed' | 'cancelled' | 'failed'
export type ActiveAgentRun = { runId: string; status: AgentRunStatus; approval?: AgentMutationApproval }
export type RunRecovery = {
  target: 'narrative' | 'agent'
  status: 'disconnected' | 'failed' | 'cancelled' | 'refresh-failed'
  error?: string
  refreshFailed?: boolean
  input?: string
}

type ObservedRun = {
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

type NarrativeSubmission = {
  api: StudioApi
  timelineId: string
  branchId: string
  nodeId: string
  expectedHeadNodeId: string | null
  content: string
  committed: boolean
  delivered: boolean
}

export function inspectSessionRunStatus(entries: AgentTranscriptEntry[]): { runId?: string; status: 'idle' | 'running' | 'suspended' } {
  if (!entries.length) return { status: 'idle' }
  const lastRunState = entries.slice().reverse().find(e => e.entry.kind === 'run-state')
  if (lastRunState && lastRunState.entry.kind === 'run-state') {
    if (lastRunState.entry.state === 'suspended' || lastRunState.entry.state === 'running') {
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

type JsonObject = { [key: string]: ClientJsonValue }

type UseNarrativeRuntimeInput = {
  getMacroSelections?: (timelineId?: string, branchId?: string) => import('@loom-studio/shared').MacroSelectionMap | undefined
  activationFacts?: JsonObject
  api: StudioApi
  storageScope: string
  initialInput: string
  initialNodes?: NarrativeNode[]
  selectedCard?: Card
  selectedCardId?: string
  onSelectCard(id: string): void
  selectedAgentPresetId?: string
  onSelectAgentPreset(id: string): void
  runAgentAction: (action: () => Promise<void>) => Promise<void>
  runAction: (action: () => Promise<void>) => Promise<boolean>
  runLatestAction: (action: (context: LatestOperationContext) => Promise<void>) => Promise<void>
}

export function useNarrativeRuntime(input: UseNarrativeRuntimeInput) {
  type CollectionSource = {
    api: StudioApi; timelineRead: number; sessionRead: number; timelineWrite: number; sessionWrite: number; disposed?: boolean
  }
  const collectionSourceRef = useRef<CollectionSource>({ api: input.api, timelineRead: 0, sessionRead: 0, timelineWrite: 0, sessionWrite: 0 })
  if (collectionSourceRef.current.api !== input.api) {
    collectionSourceRef.current = { api: input.api, timelineRead: 0, sessionRead: 0, timelineWrite: 0, sessionWrite: 0 }
  }
  const collectionSource = collectionSourceRef.current
  type CardSource = { api: StudioApi; cardId?: string; request?: Promise<NarrativeTimeline[]>; disposed?: boolean }
  const cardSourceRef = useRef<CardSource>({ api: input.api, cardId: input.selectedCardId })
  if (cardSourceRef.current.api !== input.api || cardSourceRef.current.cardId !== input.selectedCardId) {
    cardSourceRef.current = { api: input.api, cardId: input.selectedCardId }
  }
  const [timeline, setTimeline] = useState<NarrativeTimeline>()
  const [branch, setBranch] = useState<NarrativeBranch>()
  const [branches, setBranches] = useState<NarrativeBranch[]>([])
  const [nodes, setNodes] = useState<NarrativeNode[]>(() => input.initialNodes ?? [])
  const narrativeWriteRevisionRef = useRef(0)
  const displayedNarrativeRef = useRef({ timelineId: timeline?.id, branchId: branch?.id, api: input.api })
  displayedNarrativeRef.current = { timelineId: timeline?.id, branchId: branch?.id, api: input.api }
  const [olderCursor, setOlderCursor] = useState<string>()
  const olderCursorRef = useRef(olderCursor)
  olderCursorRef.current = olderCursor
  const olderPageRequestRef = useRef<{
    api: StudioApi; timelineId: string; branchId: string; cursor: string; request: Promise<void>
  } | undefined>(undefined)
  const olderWindowRef = useRef(false)
  const [cardTimelinePage, setCardTimelinePage] = useState<{ source: CardSource; timelines: NarrativeTimeline[] }>()
  const cardTimelines = cardTimelinePage?.source === cardSourceRef.current ? cardTimelinePage.timelines : []
  const [timelineCollection, setTimelineCollection] = useState<{ source: CollectionSource; items: NarrativeTimeline[] }>()
  const allTimelines = timelineCollection?.source === collectionSource ? timelineCollection.items : []
  const [agentSession, setAgentSession] = useState<AgentSession>()
  const [primarySession, setPrimarySession] = useState<AgentSession>()
  const [agentSessions, setAgentSessions] = useState<AgentSession[]>([])
  const [sessionCollection, setSessionCollection] = useState<{ source: CollectionSource; items: AgentSession[] }>()
  const allAgentSessions = sessionCollection?.source === collectionSource ? sessionCollection.items : []
  const [agentSessionReady, setAgentSessionReady] = useState(true)
  const [agentSessionLoading, setAgentSessionLoading] = useState(false)
  const [agentMessages, setAgentTranscriptEntries] = useState<AgentTranscriptEntry[]>([])
  const [agentComposerInput, setAgentComposerInput] = useState('')
  const [lastRun, setLastRun] = useState<InvokeAgentTurnResult>()
  const [activeAgentRun, setActiveAgentRun] = useState<ActiveAgentRun>()
  const observedRunRef = useRef<ObservedRun | undefined>(undefined)
  const startingRunRef = useRef(false)
  const narrativeSubmissionRef = useRef<NarrativeSubmission | undefined>(undefined)
  const [narrativeSubmission, setNarrativeSubmission] = useState<NarrativeSubmission>()
  const [runRecovery, setRunRecovery] = useState<RunRecovery>()
  const [runRecoveryBusy, setRunRecoveryBusy] = useState(false)
  const [promptPreview, setPromptPreview] = useState<PreviewAgentTurnResult>()
  const [composerInput, setComposerInput] = useState(input.initialInput)
  const composerInputsRef = useRef({ narrative: composerInput, agent: agentComposerInput })
  composerInputsRef.current = { narrative: composerInput, agent: agentComposerInput }
  const composerDraftsRef = useRef(new Map([
    [readComposerDraftKey(undefined, undefined, input.selectedCardId), input.initialInput],
  ]))
  const agentSessionPromiseRef = useRef<Promise<AgentSession> | undefined>(undefined)
  const agentSessionRef = useRef<AgentSession | undefined>(undefined)
  const primarySessionRef = useRef<AgentSession | undefined>(undefined)
  const agentSelectionRef = useRef(0)
  const agentSessionReadyRef = useRef(true)
  const optimisticEntryIdRef = useRef(0)

  useEffect(() => {
    collectionSource.disposed = false
    return () => {
      collectionSource.disposed = true
      collectionSource.timelineRead++
      collectionSource.sessionRead++
    }
  }, [collectionSource])

  useEffect(() => {
    if (!timeline || !branch || typeof EventSource === 'undefined') return
    const timelineId = timeline.id
    const branchId = branch.id
    let sequence = 0
    let disposed = false
    const refresh = () => {
      const request = ++sequence
      const writeRevision = narrativeWriteRevisionRef.current
      void input.runAction(async () => {
        const page = await input.api.narratives.getPage({ timelineId, branchId, limit: 100 })
        const displayed = displayedNarrativeRef.current
        if (disposed || request !== sequence || writeRevision !== narrativeWriteRevisionRef.current || displayed.api !== input.api
          || displayed.timelineId !== timelineId || displayed.branchId !== branchId) return
        setTimeline(page.timeline)
        setBranch(page.branch)
        setBranches(current => current.map(item => item.id === branchId ? page.branch : item))
        setNodes(current => reconcileNarrativeNodes(current, page.nodes))
        if (!olderWindowRef.current) {
          olderCursorRef.current = page.nextCursor
          setOlderCursor(page.nextCursor)
        }
        setPromptPreview(undefined)
      })
    }
    const unsubscribe = subscribeDataCommits(operations => {
      if (operations.some(item => (item.entityType === 'narrative.branch' && item.entityId === branchId)
        || (item.entityType === 'narrative.timeline' && item.entityId === timelineId))) refresh()
    }, refresh)
    return () => { disposed = true; sequence++; unsubscribe() }
  }, [input.api, timeline?.id, branch?.id])

  useEffect(() => {
    if (typeof EventSource === 'undefined') return
    const timelineId = timeline?.id
    let sequence = 0
    const sessionReads = new Map<string, number>()
    let disposed = false
    const refresh = () => {
      const request = ++sequence
      const revision = collectionSource.sessionWrite
      void input.runAction(async () => {
        const sessions = await listAgentSessions(timelineId)
        if (disposed || request !== sequence || !ownsCollectionSource()
          || displayedNarrativeRef.current.timelineId !== timelineId) return
        if (revision !== collectionSource.sessionWrite) {
          refresh()
          return
        }
        setAgentSessions(sessions)
        setAllAgentSessions(current => [
          ...current.filter(item => item.timelineId !== timelineId), ...sessions,
        ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id)))
        if (agentSessionRef.current?.timelineId === timelineId && agentSessionRef.current) {
          const selected = sessions.find(item => item.id === agentSessionRef.current?.id)
          if (selected) { agentSessionRef.current = selected; setAgentSession(selected) }
          else resetAgentSession()
        }
        if (primarySessionRef.current?.timelineId === timelineId && primarySessionRef.current) {
          const primary = sessions.find(item => item.id === primarySessionRef.current?.id)
          if (!primary && timelineId) safeLocalStorage.removeItem(primaryStorageKey(timelineId))
          publishPrimarySession(primary)
        }
      })
    }
    const unsubscribe = subscribeDataCommits(operations => {
      const relevant = operations.filter(item => item.entityType === 'agent.session'
        && (!item.scope || (item.scope.entityType === 'narrative.timeline' && item.scope.entityId === timelineId)))
      if (!relevant.length) return
      if (relevant.some(item => !item.scope || item.kind !== 'update')) {
        refresh()
        return
      }
      const request = sequence
      const reads = [...new Set(relevant.map(item => item.entityId))].map(id => {
        const generation = (sessionReads.get(id) ?? 0) + 1
        sessionReads.set(id, generation)
        return { id, generation }
      })
      void input.runAction(async () => {
        const results = await Promise.all(reads.map(async read => ({
          ...read, session: (await input.api.agentSessions.get(read.id)).session,
        })))
        if (disposed || request !== sequence || !ownsCollectionSource()
          || displayedNarrativeRef.current.timelineId !== timelineId) return
        const sessions = results.filter(read => sessionReads.get(read.id) === read.generation).map(read => read.session)
        setAgentSessions(current => current.map(item => sessions.find(session => session.id === item.id) ?? item)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id)))
        setAllAgentSessions(current => current.map(item => sessions.find(session => session.id === item.id) ?? item))
        const selected = sessions.find(item => item.id === agentSessionRef.current?.id)
        if (selected) { agentSessionRef.current = selected; setAgentSession(selected) }
        const primary = sessions.find(item => item.id === primarySessionRef.current?.id)
        if (primary) publishPrimarySession(primary)
      })
    }, refresh)
    return () => { disposed = true; sequence++; unsubscribe() }
  }, [input.api, timeline?.id])

  useEffect(() => () => {
    agentSelectionRef.current++
    cardSourceRef.current.disposed = true
  }, [])

  useEffect(() => {
    const source = cardSourceRef.current
    source.disposed = false
    if (input.selectedCardId) {
      void input.runAction(async () => { await refreshCardTimelines(input.selectedCardId!, true) })
    }
    return () => { source.disposed = true }
  }, [input.api, input.selectedCardId])

  function setComposerDraft(value: string) {
    composerInputsRef.current.narrative = value
    composerDraftsRef.current.set(readComposerDraftKey(timeline, branch, input.selectedCardId), value)
    setComposerInput(value)
  }

  function setAgentDraft(value: string) {
    composerInputsRef.current.agent = value
    setAgentComposerInput(value)
  }

  function activateComposerDraft(nextTimeline: NarrativeTimeline | undefined, nextBranch: NarrativeBranch | undefined, fallback = '') {
    olderWindowRef.current = false
    displayedNarrativeRef.current = { timelineId: nextTimeline?.id, branchId: nextBranch?.id, api: input.api }
    const run = observedRunRef.current
    if (run?.narrativeTarget && (run.narrativeTarget.timelineId !== nextTimeline?.id || run.narrativeTarget.branchId !== nextBranch?.id)) {
      observedRunRef.current = undefined
      setActiveAgentRun(undefined)
      setRunRecovery(undefined)
      setRunRecoveryBusy(false)
    }
    const key = readComposerDraftKey(nextTimeline, nextBranch, cardSourceRef.current.cardId)
    const value = composerDraftsRef.current.get(key) ?? fallback
    composerDraftsRef.current.set(key, value)
    setComposerInput(value)
  }

  function refreshCardTimelines(cardId: string, reusePending = false): Promise<NarrativeTimeline[]> {
    const source = cardSourceRef.current
    const belongsToSource = source.api === input.api && source.cardId === cardId
    if (belongsToSource && reusePending && source.request) return source.request
    const request = (async () => {
      const timelines: NarrativeTimeline[] = []
      let cursor: string | undefined
      do {
        const page = await input.api.narratives.list({ createdFromCardId: cardId, cursor, limit: 100 })
        timelines.push(...page.timelines)
        cursor = page.nextCursor
      } while (cursor)
      return timelines
    })()
    if (belongsToSource) source.request = request
    return request.then(timelines => {
      if (belongsToSource && !source.disposed && cardSourceRef.current === source && source.request === request) {
        setCardTimelinePage({ source, timelines })
      }
      return timelines
    }, error => {
      if (source.request === request) source.request = undefined
      throw error
    })
  }

  async function selectCardTimeline(cardId: string, createIfMissing = false) {
    const source: CardSource = { api: input.api, cardId }
    cardSourceRef.current = source
    input.onSelectCard(cardId)
    const selection = beginAgentSelection()
    let timelines: NarrativeTimeline[] = []
    const loaded = await input.runAction(async () => { timelines = await refreshCardTimelines(cardId, true) })
    if (!loaded) {
      if (selection === agentSelectionRef.current) {
        setAgentSessionLoading(false)
        markAgentSessionReady(true)
      }
      return
    }
    if (source.disposed || cardSourceRef.current !== source || selection !== agentSelectionRef.current) return
    const latest = [...timelines].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
    if (latest) {
      const branchId = await activateTimeline(latest.id)
      if (branchId && cardSourceRef.current === source && !source.disposed) return { timelineId: latest.id, branchId }
    } else if (createIfMissing) {
      return await createTimelineFromCard(cardId)
    } else {
      resetToDraftTimeline()
      return null
    }
  }

  async function refreshAllTimelines(): Promise<NarrativeTimeline[]> {
    if (!ownsCollectionSource()) return []
    const request = ++collectionSource.timelineRead
    const revision = collectionSource.timelineWrite
    const timelines: NarrativeTimeline[] = []
    let cursor: string | undefined
    do {
      const page = await input.api.narratives.list({ cursor, limit: 100 })
      timelines.push(...page.timelines)
      cursor = page.nextCursor
    } while (cursor)
    if (ownsCollectionSource() && request === collectionSource.timelineRead) {
      if (revision !== collectionSource.timelineWrite) return refreshAllTimelines()
      setTimelineCollection({ source: collectionSource, items: timelines })
    }
    return timelines
  }

  useEffect(() => {
    void input.runAction(async () => { await refreshAllTimelines() })
  }, [input.api])

  useEffect(() => {
    void refreshAgentSessions()
  }, [])

  async function createTimelineFromCard(cardId = input.selectedCardId) {
    if (!cardId) return

    let activated: { branchId: string; timelineId: string } | undefined
    let activatedSelection: number | undefined
    const source = cardSourceRef.current
    const selection = beginAgentSelection()
    await input.runAction(async () => {
      const result = await input.api.narratives.create({ cardId })
      if (source.disposed || cardSourceRef.current !== source || selection !== agentSelectionRef.current) return
      setTimeline(result.timeline)
      setAllTimelines(current => [result.timeline, ...current.filter(item => item.id !== result.timeline.id)])
      setBranch(result.branch)
      setBranches([result.branch])
      setNodes(result.nodes)
      setOlderCursor(undefined)
      resetAgentSession()
      setAgentSessions([])
      setPromptPreview(undefined)
      setLastRun(undefined)
      activateComposerDraft(result.timeline, result.branch, composerInput)
      activatedSelection = agentSelectionRef.current
      activated = { branchId: result.branch.id, timelineId: result.timeline.id }
      await refreshCardTimelines(cardId)
    })
    if (cardSourceRef.current === source && selection === agentSelectionRef.current) {
      setAgentSessionLoading(false)
      markAgentSessionReady(true)
    }
    if (!source.disposed && cardSourceRef.current === source && activatedSelection === agentSelectionRef.current) {
      return activated
    }
  }

  async function activateTimeline(timelineId: string, branchId?: string) {
    let activatedBranchId: string | undefined
    const selection = beginAgentSelection()
    publishPrimarySession(undefined)
    setAgentSessions([])
    await input.runLatestAction(async context => {
      try {
        const details = await input.api.narratives.get(timelineId)
        const nextBranch = resolveNarrativeBranch(details.branches, details.timeline.activeBranchId, branchId)
        if (!nextBranch) throw new Error(`Narrative timeline ${timelineId} has no active branch`)
        const page = await input.api.narratives.getPage({ timelineId, branchId: nextBranch.id, limit: 100 })
        if (!context.isCurrent() || selection !== agentSelectionRef.current || input.api !== cardSourceRef.current.api) return
        setTimeline(page.timeline)
        setBranch(page.branch)
        setBranches(details.branches)
        setNodes(page.nodes)
        setOlderCursor(page.nextCursor)
        setPromptPreview(undefined)
        setLastRun(undefined)
        activateComposerDraft(page.timeline, page.branch)
        activatedBranchId = page.branch.id
        await restoreAgentSession(timelineId, selection)
      } finally {
        if (selection === agentSelectionRef.current) setAgentSessionLoading(false)
      }
    })
    return input.api === cardSourceRef.current.api && selection === agentSelectionRef.current
      ? activatedBranchId
      : undefined
  }

  function resetToDraftTimeline() {
    setTimeline(undefined)
    setBranch(undefined)
    setBranches([])
    setNodes([])
    setOlderCursor(undefined)
    resetAgentSession()
    publishPrimarySession(undefined)
    setAgentSessions([])
    setPromptPreview(undefined)
    setLastRun(undefined)
    activateComposerDraft(undefined, undefined, composerInput)
  }

  async function submitTurn(event: FormEvent) {
    event.preventDefault()
    return sendNarrativeInput()
  }

  async function retryNarrativeInput() {
    const submission = narrativeSubmissionRef.current
    if (!submission || !ownsNarrativeSubmission(submission)) return
    await sendNarrativeInput(submission)
  }

  function ownsNarrativeSubmission(submission: NarrativeSubmission) {
    return submission.api === input.api && submission.api === cardSourceRef.current.api && !cardSourceRef.current.disposed
      && submission.timelineId === displayedNarrativeRef.current.timelineId
      && submission.branchId === displayedNarrativeRef.current.branchId
  }

  function publishNarrativeSubmission(submission: NarrativeSubmission) {
    narrativeSubmissionRef.current = submission
    setNarrativeSubmission(submission)
  }

  async function sendNarrativeInput(retry?: NarrativeSubmission) {
    const content = retry?.content ?? composerInput.trim()
    if (content.length === 0) return undefined
    if (!timeline && !input.selectedCardId) return undefined
    if (!agentSessionReadyRef.current) return undefined
    if (runRecovery?.target === 'narrative' && runRecovery.refreshFailed) return undefined
    if (startingRunRef.current || (observedRunRef.current?.target === 'narrative' && ownsRun(observedRunRef.current)
      && (observedRunRef.current.status === 'running' || observedRunRef.current.observing))) return undefined

    let resultActivated: { timelineId: string; branchId: string } | undefined
    const submissionSource = cardSourceRef.current
    startingRunRef.current = true
    try {
      await input.runAction(async () => {
        if (!primarySessionRef.current || primarySessionRef.current.timelineId !== timeline?.id) {
          throw new Error('请先新建并设置主写作对话')
        }
        let currentTimeline = timeline
        let currentBranch = branch
        if (!currentTimeline || !currentBranch) {
          const created = await input.api.narratives.create({ cardId: input.selectedCardId! })
          currentTimeline = created.timeline
          currentBranch = created.branch
          setTimeline(created.timeline)
          setBranch(created.branch)
          displayedNarrativeRef.current = { timelineId: created.timeline.id, branchId: created.branch.id, api: input.api }
          setBranches([created.branch])
          setNodes(created.nodes)
          setOlderCursor(undefined)
          resetAgentSession()
          setAgentSessions([])
          resultActivated = { timelineId: created.timeline.id, branchId: created.branch.id }
        }

        const selection = agentSelectionRef.current
        const previous = narrativeSubmissionRef.current
        let submission = retry ?? (previous && ownsNarrativeSubmission(previous)
          && !previous.delivered && previous.content === content ? previous : {
            api: input.api, timelineId: currentTimeline.id, branchId: currentBranch.id,
            nodeId: crypto.randomUUID(), expectedHeadNodeId: currentBranch.headNodeId ?? null,
            content, committed: false, delivered: false,
          })
        publishNarrativeSubmission(submission)
        if (!submission.committed) {
          const written = await input.api.narratives.appendInput({
            timelineId: submission.timelineId, branchId: submission.branchId,
            nodeId: submission.nodeId, expectedHeadNodeId: submission.expectedHeadNodeId,
            content: submission.content,
          })
          submission = { ...submission, committed: true }
          publishNarrativeSubmission(submission)
          if (!ownsNarrativeSubmission(submission)) return
          currentTimeline = written.timeline
          currentBranch = written.branch
          setTimeline(written.timeline)
          setBranch(written.branch)
          setBranches(current => current.map(item => item.id === written.branch.id ? written.branch : item))
          setNodes(current => current.some(node => node.id === written.node.id) ? current : [...current, written.node])
        }
        if (selection !== agentSelectionRef.current || input.api !== cardSourceRef.current.api
          || displayedNarrativeRef.current.timelineId !== currentTimeline.id || displayedNarrativeRef.current.branchId !== currentBranch.id) {
          resultActivated = undefined
          return
        }
        const session = primarySessionRef.current
        if (!session || session.timelineId !== currentTimeline.id) throw new Error('请先设置主写作对话')
        if (selection !== agentSelectionRef.current || !ownsNarrativeSubmission(submission)) return

        const started = await input.api.agentSessions.createRun({
          agentSessionId: session.id,
          input: content,
          activationFacts: input.activationFacts,
          macroSelections: input.getMacroSelections?.(currentTimeline.id, currentBranch.id),
          narrativeTarget: {
            timelineId: currentTimeline.id,
            branchId: currentBranch.id,
            inputNodeId: submission.nodeId,
          },
        })
        publishNarrativeSubmission({ ...submission, delivered: true })
        if (selection !== agentSelectionRef.current || input.api !== cardSourceRef.current.api
          || displayedNarrativeRef.current.timelineId !== currentTimeline.id || displayedNarrativeRef.current.branchId !== currentBranch.id) {
          resultActivated = undefined
          return
        }
        setRunRecovery(undefined)
        setActiveAgentRun({ runId: started.runId, status: 'running' })

        const optimisticEntryId = `optimistic-agent-entry-${++optimisticEntryIdRef.current}`

        if (agentSessionRef.current?.id === session.id) setAgentTranscriptEntries(current => {
          const lastEntry = current.at(-1)
          const optimisticEntry: AgentTranscriptEntry = {
            id: optimisticEntryId,
            agentSessionId: session.id,
            parentEntryId: lastEntry?.id,
            sequence: (lastEntry?.sequence ?? 0) + 1,
            entry: { kind: 'message', role: 'user', content },
            createdAt: new Date().toISOString(),
          }
          return [...current, optimisticEntry]
        })

        const draftKey = readComposerDraftKey(currentTimeline, currentBranch, input.selectedCardId)
        if (!retry) {
          if (composerDraftsRef.current.get(draftKey) === composerInput) composerDraftsRef.current.delete(draftKey)
          setComposerInput(current => current === composerInput ? '' : current)
        }

        const streamingId = `streaming-agent-entry-${++optimisticEntryIdRef.current}`
        if (agentSessionRef.current?.id === session.id) setAgentTranscriptEntries(current => [...current, {
          id: streamingId,
          agentSessionId: session.id,
          sequence: (current.at(-1)?.sequence ?? 0) + 1,
          entry: { kind: 'message', role: 'assistant', content: '' },
          createdAt: new Date().toISOString(),
        }])
        await observeRun({
          api: input.api, selection, runId: started.runId, sessionId: session.id,
          target: 'narrative', input: retry?.content ?? composerInput,
          narrativeTarget: { timelineId: currentTimeline.id, branchId: currentBranch.id },
          optimisticEntryId, streamingId, cursor: 0, status: 'running', observing: false,
        })
        if (selection !== agentSelectionRef.current) resultActivated = undefined
      })
      // Navigation follows the persisted Timeline, not the outcome of Session delivery.
      return submissionSource === cardSourceRef.current && input.api === cardSourceRef.current.api
        && resultActivated?.timelineId === displayedNarrativeRef.current.timelineId
        && resultActivated?.branchId === displayedNarrativeRef.current.branchId
        ? resultActivated : undefined
    } finally {
      startingRunRef.current = false
    }
  }

  async function submitAgentTurn(event: FormEvent) {
    event.preventDefault()
    const content = agentComposerInput.trim()
    if (!content || (!agentSessionRef.current && !input.selectedAgentPresetId)) return
    if (!agentSessionReadyRef.current) return
    if (startingRunRef.current || (observedRunRef.current && ownsRun(observedRunRef.current)
      && (observedRunRef.current.status === 'running' || observedRunRef.current.observing))) return
    startingRunRef.current = true
    try {
      await input.runAgentAction(async () => {
        const selection = agentSelectionRef.current
        const session = await ensureAgentSession()
        if (selection !== agentSelectionRef.current || input.api !== cardSourceRef.current.api) return
        const started = await input.api.agentSessions.createRun({
          agentSessionId: session.id,
          input: content,
          macroSelections: input.getMacroSelections?.(timeline?.id, branch?.id),
        })
        if (selection !== agentSelectionRef.current || input.api !== cardSourceRef.current.api) return
        setRunRecovery(undefined)
        setActiveAgentRun({ runId: started.runId, status: 'running' })
        const optimisticId = `optimistic-agent-entry-${++optimisticEntryIdRef.current}`
        setAgentTranscriptEntries(current => {
          const lastEntry = current.at(-1)
          const optimisticEntry: AgentTranscriptEntry = {
            id: optimisticId,
            agentSessionId: session.id,
            parentEntryId: lastEntry?.id,
            sequence: (lastEntry?.sequence ?? 0) + 1,
            entry: { kind: 'message', role: 'user', content },
            createdAt: new Date().toISOString(),
          }
          return [...current, optimisticEntry]
        })
        setAgentComposerInput(current => current === agentComposerInput ? '' : current)

        const streamingId = `streaming-agent-entry-${++optimisticEntryIdRef.current}`
        setAgentTranscriptEntries(current => [...current, {
          id: streamingId,
          agentSessionId: session.id,
          sequence: (current.at(-1)?.sequence ?? 0) + 1,
          entry: { kind: 'message', role: 'assistant', content: '' },
          createdAt: new Date().toISOString(),
        }])
        await observeRun({
          api: input.api, selection, runId: started.runId, sessionId: session.id,
          target: 'agent', input: agentComposerInput, optimisticEntryId: optimisticId,
          streamingId, cursor: 0, status: 'running', observing: false,
        })
      })
    } finally {
      startingRunRef.current = false
    }
  }

  async function pauseAgentRun() {
    const run = activeAgentRun
    if (!run || run.status !== 'running') return
    const result = await input.api.agentSessions.pauseRun(run.runId)
    if (result.accepted) setActiveAgentRun(current => current?.runId === run.runId ? { ...current, status: result.state } : current)
  }

  async function resumeAgentRun() {
    const run = activeAgentRun
    if (!run || run.status !== 'suspended') return
    if (startingRunRef.current || observedRunRef.current?.observing || runRecovery?.status === 'disconnected') return
    const selection = agentSelectionRef.current
    const session = agentSessionRef.current
    if (!session) return

    await input.runAgentAction(async () => {
      startingRunRef.current = true
      try {
        const result = await input.api.agentSessions.resumeRun({
          runId: run.runId,
          agentSessionId: session.id,
        })

        if (!result.accepted || selection !== agentSelectionRef.current || input.api !== cardSourceRef.current.api) {
          return
        }

        setRunRecovery(undefined)
        setActiveAgentRun({ runId: result.runId, status: 'running' })

        const streamingId = `streaming-agent-entry-${++optimisticEntryIdRef.current}`
        setAgentTranscriptEntries(current => [...current, {
          id: streamingId,
          agentSessionId: session.id,
          sequence: (current.at(-1)?.sequence ?? 0) + 1,
          entry: { kind: 'message', role: 'assistant', content: '' },
          createdAt: new Date().toISOString(),
        }])

        const candidate = observedRunRef.current
        const previous = candidate && ownsRun(candidate) && candidate.runId === run.runId ? candidate : undefined
        await observeRun({
          api: input.api, selection, runId: result.runId, sessionId: session.id,
          target: previous?.target ?? 'agent',
          input: previous?.input,
          narrativeTarget: previous?.narrativeTarget,
          streamingId, cursor: 0, status: 'running', observing: false,
        })
      } finally {
        startingRunRef.current = false
      }
    })
  }

  function ownsRun(run: ObservedRun) {
    return observedRunRef.current === run && run.selection === agentSelectionRef.current
      && run.api === cardSourceRef.current.api && !cardSourceRef.current.disposed
      && (!run.narrativeTarget || (run.narrativeTarget.timelineId === displayedNarrativeRef.current.timelineId
        && run.narrativeTarget.branchId === displayedNarrativeRef.current.branchId))
  }

  function clearRunPlaceholders(run: ObservedRun) {
    if (agentSessionRef.current?.id === run.sessionId)
      setAgentTranscriptEntries(current => current.filter(entry => entry.id !== run.optimisticEntryId && entry.id !== run.streamingId))
  }

  async function refreshRunState(run: ObservedRun) {
    const writeRevision = narrativeWriteRevisionRef.current
    const [transcript, page] = await Promise.all([
      loadTranscript(run.api, run.sessionId),
      run.narrativeTarget ? run.api.narratives.getPage({ ...run.narrativeTarget, limit: 100 }) : undefined,
    ])
    if (!ownsRun(run)) return
    if (agentSessionRef.current?.id === run.sessionId) {
      publishAgentSession(transcript.session)
      setAgentTranscriptEntries(transcript.entries)
    } else {
      setAllAgentSessions(current => current.map(item => item.id === run.sessionId ? transcript.session : item))
    }
    if (page && writeRevision === narrativeWriteRevisionRef.current) {
      setTimeline(page.timeline)
      setBranch(page.branch)
      setBranches(current => current.some(item => item.id === page.branch.id)
        ? current.map(item => item.id === page.branch.id ? page.branch : item)
        : [...current, page.branch])
      setNodes(current => reconcileNarrativeNodes(current, page.nodes))
      if (!olderWindowRef.current) {
        olderCursorRef.current = page.nextCursor
        setOlderCursor(page.nextCursor)
      }
    }
    setPromptPreview(undefined)
  }

  async function refreshTerminalRun(run: ObservedRun, error?: unknown) {
    if (!ownsRun(run) || (run.status !== 'failed' && run.status !== 'cancelled')) return
    clearRunPlaceholders(run)
    const recovery: RunRecovery = {
      target: run.target, status: run.status, input: run.target === 'agent' ? run.input : undefined,
      ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}),
    }
    setRunRecovery(recovery)
    try {
      await refreshRunState(run)
    } catch (refreshError) {
      if (ownsRun(run)) setRunRecovery({
        ...recovery, refreshFailed: true,
        error: [recovery.error, refreshError instanceof Error ? refreshError.message : String(refreshError)].filter(Boolean).join('\n'),
      })
    }
  }

  async function observeRun(run: ObservedRun) {
    if (run.observing || run.selection !== agentSelectionRef.current || run.api !== cardSourceRef.current.api) return
    observedRunRef.current = run
    run.observing = true
    setRunRecoveryBusy(true)
    try {
      let result: InvokeAgentTurnResult | undefined
      try {
        result = await runAgentTurn(run, () => ownsRun(run),
          update => {
            if (agentSessionRef.current?.id === run.sessionId) setAgentTranscriptEntries(update)
          }, setActiveAgentRun,
          () => setRunRecovery(current => current?.status === 'disconnected' ? undefined : current))
      } catch (error) {
        if (!ownsRun(run)) return
        if (run.status === 'failed' || run.status === 'cancelled') await refreshTerminalRun(run, error)
        else setRunRecovery({ target: run.target, status: 'disconnected', error: error instanceof Error ? error.message : String(error) })
        throw error
      }
      if (!ownsRun(run)) return
      if (!result) {
        if (run.status === 'cancelled') await refreshTerminalRun(run)
        else {
          setRunRecovery(undefined)
          try {
            await refreshRunState(run)
          } catch (error) {
            if (run.status !== 'completed') throw error
            if (ownsRun(run)) setRunRecovery({
              target: run.target, status: 'refresh-failed', refreshFailed: true,
              error: error instanceof Error ? error.message : String(error),
            })
          }
        }
        return
      }
      setRunRecovery(undefined)
      if (agentSessionRef.current?.id === run.sessionId) {
        publishAgentSession(result.agentSession)
        setAgentTranscriptEntries(current => [
          ...current.filter(entry => entry.id !== run.optimisticEntryId && entry.id !== run.streamingId
            && entry.id !== result.entries.user.id && entry.id !== result.entries.assistant.id),
          result.entries.user, result.entries.assistant,
        ])
      } else {
        setAllAgentSessions(current => current.map(item => item.id === run.sessionId ? result.agentSession : item))
      }
      setLastRun(result)
      setPromptPreview(undefined)
      void run.api.agentSessions.acknowledgeRunCompletion(run.runId).catch(error => {
        // The delivery expiry releases this result if acknowledgement is offline.
        console.warn('Agent completion acknowledgement failed; delivery expiry will release the result.', error)
      })
      try {
        await refreshRunState(run)
      } catch (error) {
        if (ownsRun(run)) setRunRecovery({
          target: run.target, status: 'refresh-failed', refreshFailed: true,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    } finally {
      run.observing = false
      if (ownsRun(run)) setRunRecoveryBusy(false)
    }
  }

  async function reconnectAgentRun() {
    const run = observedRunRef.current
    if (!run || !ownsRun(run) || run.observing || startingRunRef.current) return
    const reconnect = async () => {
      if (run.status === 'completed') {
        setRunRecoveryBusy(true)
        try {
          await refreshRunState(run)
          if (ownsRun(run)) setRunRecovery(undefined)
        } finally {
          if (ownsRun(run)) setRunRecoveryBusy(false)
        }
      } else if (run.status === 'failed' || run.status === 'cancelled') {
        run.observing = true
        setRunRecoveryBusy(true)
        try { await refreshTerminalRun(run) } finally {
          run.observing = false
          if (ownsRun(run)) setRunRecoveryBusy(false)
        }
      } else {
        await observeRun(run)
      }
    }
    if (run.target === 'narrative') await input.runAction(reconnect)
    else await input.runAgentAction(reconnect)
  }

  function restoreRunInput() {
    const run = observedRunRef.current
    if (!run || run.target === 'narrative' || !ownsRun(run) || run.observing || !run.input || (run.status !== 'failed' && run.status !== 'cancelled')) return
    if (composerInputsRef.current[run.target].length > 0) return
    const value = run.input
    run.input = undefined
    setAgentDraft(value)
    setRunRecovery(current => current ? { ...current, input: undefined } : undefined)
  }

  async function approveAgentMutation(allow: boolean, reason?: string) {
    const run = activeAgentRun
    const approval = run?.approval
    if (!run || !approval) return
    const result = await (approval.action
      ? input.api.agentSessions.approveHistoryRead
      : input.api.agentSessions.approveMutation)(run.runId, approval.requestId, allow, reason)
    if (result.accepted) {
      setActiveAgentRun(current => current?.approval?.requestId === approval.requestId
        ? { ...current, approval: undefined }
        : current)
    }
  }

  async function previewPrompt() {
    if (!timeline || !branch || composerInput.trim().length === 0) return
    if (!agentSessionReadyRef.current) return

    await input.runAction(async () => {
      const selection = agentSelectionRef.current
      const session = primarySessionRef.current
      if (!session || session.timelineId !== timeline.id) throw new Error('请先设置主写作对话')
      if (selection !== agentSelectionRef.current) return
      const result = await input.api.agentSessions.preview({
        agentSessionId: session.id,
        input: composerInput,
        activationFacts: input.activationFacts,
        macroSelections: input.getMacroSelections?.(timeline?.id, branch?.id),
        narrativeTarget: {
          timelineId: timeline.id,
          branchId: branch.id,
        },
      })
      if (selection === agentSelectionRef.current) setPromptPreview(result)
    })
  }

  async function forkFromNode(node: NarrativeNode) {
    if (!timeline || !branch) return

    const source = cardSourceRef.current
    const selection = agentSelectionRef.current
    let activated: { branchId: string; timelineId: string } | undefined
    await input.runAction(async () => {
      const forked = await input.api.narratives.fork({
        timelineId: timeline.id,
        fromBranchId: branch.id,
        fromNodeId: node.id,
        title: `Fork ${node.id.slice(0, 8)}`,
      })
      if (source.disposed || cardSourceRef.current !== source || selection !== agentSelectionRef.current) return
      const switched = await input.api.narratives.switch({
        timelineId: timeline.id,
        branchId: forked.branch.id,
        expectedActiveBranchId: timeline.activeBranchId,
      })
      if (source.disposed || cardSourceRef.current !== source || selection !== agentSelectionRef.current) return
      const page = await input.api.narratives.getPage({ timelineId: timeline.id, branchId: forked.branch.id, limit: 100 })
      if (source.disposed || cardSourceRef.current !== source || selection !== agentSelectionRef.current) return
      setTimeline(switched.timeline)
      setBranch(page.branch)
      setBranches(current => [...current, forked.branch])
      setNodes(page.nodes)
      setOlderCursor(page.nextCursor)
      setPromptPreview(undefined)
      setLastRun(undefined)
      activateComposerDraft(switched.timeline, page.branch)
      activated = { branchId: page.branch.id, timelineId: timeline.id }
    })
    return activated
  }

  async function switchBranch(nextBranch: NarrativeBranch) {
    if (!timeline || nextBranch.id === branch?.id) return

    const source = cardSourceRef.current
    const selection = agentSelectionRef.current
    await input.runAction(async () => {
      const switched = await input.api.narratives.switch({
        timelineId: timeline.id,
        branchId: nextBranch.id,
        expectedActiveBranchId: timeline.activeBranchId,
      })
      if (source.disposed || cardSourceRef.current !== source || selection !== agentSelectionRef.current) return
      const page = await input.api.narratives.getPage({ timelineId: timeline.id, branchId: nextBranch.id, limit: 100 })
      if (source.disposed || cardSourceRef.current !== source || selection !== agentSelectionRef.current) return
      setTimeline(switched.timeline)
      setBranch(page.branch)
      setNodes(page.nodes)
      setOlderCursor(page.nextCursor)
      setPromptPreview(undefined)
      setLastRun(undefined)
      activateComposerDraft(switched.timeline, page.branch)
    })
  }

  function loadOlderNodes(): Promise<void> {
    const cursor = olderCursorRef.current
    if (!timeline || !branch || !cursor) return Promise.resolve()
    const pending = olderPageRequestRef.current
    if (pending?.api === input.api && pending.timelineId === timeline.id
      && pending.branchId === branch.id && pending.cursor === cursor) return pending.request
    const selection = agentSelectionRef.current
    const writeRevision = narrativeWriteRevisionRef.current
    const request = input.runAction(async () => {
      const page = await input.api.narratives.getPage({
        timelineId: timeline.id,
        branchId: branch.id,
        cursor,
        limit: 100,
      })
      const displayed = displayedNarrativeRef.current
      if (displayed.api !== input.api || displayed.timelineId !== timeline.id || displayed.branchId !== branch.id
        || selection !== agentSelectionRef.current || writeRevision !== narrativeWriteRevisionRef.current
        || olderCursorRef.current !== cursor) return
      olderCursorRef.current = page.nextCursor
      olderWindowRef.current = true
      setNodes(current => [...page.nodes.filter(node => !current.some(item => item.id === node.id)), ...current])
      setOlderCursor(page.nextCursor)
    }).then(completed => {
      if (!completed) throw new Error('Could not load older Timeline nodes')
    }).finally(() => {
      if (olderPageRequestRef.current?.request === request) olderPageRequestRef.current = undefined
    })
    olderPageRequestRef.current = { api: input.api, timelineId: timeline.id, branchId: branch.id, cursor, request }
    return request
  }

  async function editNarrativeNode(nodeId: string, raw: string): Promise<void> {
    const original = nodes.find(node => node.id === nodeId)
    if (!timeline || !branch?.headNodeId || !original) throw new Error('Narrative editing target is unavailable')
    const result = await input.api.narratives.editNode({
      timelineId: timeline.id, branchId: branch.id, nodeId,
      expectedHeadNodeId: branch.headNodeId, expectedRaw: original.body.raw, raw,
    })
    const displayed = displayedNarrativeRef.current
    if (displayed.api !== input.api || displayed.timelineId !== timeline.id || displayed.branchId !== branch.id) return
    narrativeWriteRevisionRef.current++
    setTimeline(current => current?.id === result.timeline.id ? result.timeline : current)
    setBranch(current => current?.id === result.branch.id ? result.branch : current)
    setBranches(current => current.map(item => item.id === result.branch.id ? result.branch : item))
    const replacements = new Map(result.replacements.map(item => [item.previousNodeId, item.node]))
    setNodes(current => current.map(node => replacements.get(node.id) ?? node))
    setPromptPreview(undefined)
  }

  async function ensureAgentSession(targetTimeline = timeline): Promise<AgentSession> {
    if (!agentSessionReadyRef.current) throw new Error('Agent Session is not ready')
    const current = agentSessionRef.current
    if (current && current.timelineId === targetTimeline?.id) return current
    if (agentSessionPromiseRef.current) return agentSessionPromiseRef.current
    if (!input.selectedAgentPresetId) throw new Error('请先在 Agent 面板创建并选择 Agent Preset')
    const selection = agentSelectionRef.current
    const pending = (async () => {
      const created = await input.api.agentSessions.create({
        agentPresetId: input.selectedAgentPresetId!,
        timelineId: targetTimeline?.id,
        title: targetTimeline?.title ?? input.selectedCard?.name,
      })
      if (selection !== agentSelectionRef.current) throw new Error('Agent Session selection changed during creation')
      publishAgentSession(created.session)
      return created.session
    })()
    agentSessionPromiseRef.current = pending
    try {
      return await pending
    } finally {
      if (agentSessionPromiseRef.current === pending) agentSessionPromiseRef.current = undefined
    }
  }

  function primaryStorageKey(timelineId: string) {
    return `loom.studio.primarySession:${input.storageScope}:${timelineId}`
  }

  function publishPrimarySession(session: AgentSession | undefined) {
    primarySessionRef.current = session
    setPrimarySession(session)
  }

  async function setPrimaryAgentSession(session: AgentSession, targetTimeline = timeline) {
    if (!targetTimeline || session.timelineId !== targetTimeline.id) throw new Error('主写作对话必须属于当前时间线')
    if (primarySessionRef.current?.id === session.id) return
    if (startingRunRef.current || (agentSessionRef.current?.id === primarySessionRef.current?.id
      && activeAgentRun?.status === 'running')) throw new Error('生成期间不能切换主写作对话')
    const previous = primarySessionRef.current
    const source = cardSourceRef.current
    const selection = agentSelectionRef.current
    if (previous) await releasePrimaryRun(input.api, previous.id)
    if (source.disposed || cardSourceRef.current !== source || selection !== agentSelectionRef.current
      || displayedNarrativeRef.current.timelineId !== targetTimeline.id) return
    safeLocalStorage.setItem(primaryStorageKey(targetTimeline.id), session.id)
    publishPrimarySession(session)
    setPromptPreview(undefined)
    if (previous && previous.id !== session.id) {
      if (agentSessionRef.current?.id === previous.id) {
        agentSelectionRef.current++
        observedRunRef.current = undefined
        setActiveAgentRun(undefined)
      }
      setRunRecovery(undefined)
    }
  }

  async function createAgentSession(presetId: string, makeMain: boolean): Promise<AgentSession | undefined> {
    const source = cardSourceRef.current
    const selection = agentSelectionRef.current
    let targetTimeline = timeline
    const isCurrent = () => ownsCollectionSource() && !source.disposed && cardSourceRef.current === source
      && selection === agentSelectionRef.current && displayedNarrativeRef.current.timelineId === targetTimeline?.id
    if (makeMain && !targetTimeline) {
      if (!input.selectedCardId) throw new Error('请先选择角色')
      const created = await input.api.narratives.create({ cardId: input.selectedCardId })
      setAllTimelines(current => [created.timeline, ...current.filter(item => item.id !== created.timeline.id)])
      const publish = isCurrent()
      targetTimeline = created.timeline
      if (publish) {
        setTimeline(created.timeline)
        setBranch(created.branch)
        setBranches([created.branch])
        setNodes(created.nodes)
        setOlderCursor(undefined)
        displayedNarrativeRef.current = { timelineId: created.timeline.id, branchId: created.branch.id, api: input.api }
        composerDraftsRef.current.set(readComposerDraftKey(created.timeline, created.branch, input.selectedCardId), composerInput)
        activateComposerDraft(created.timeline, created.branch, composerInput)
      }
    }
    const created = await input.api.agentSessions.create({
      agentPresetId: presetId, ...(targetTimeline ? { timelineId: targetTimeline.id } : {}),
    })
    setAllAgentSessions(current => [created.session, ...current.filter(item => item.id !== created.session.id)])
    if (!isCurrent()) return undefined
    setAgentSessions(current => [created.session, ...current.filter(item => item.id !== created.session.id)])
    if (makeMain) {
      await setPrimaryAgentSession(created.session, targetTimeline)
      if (!ownsCollectionSource() || source.disposed || cardSourceRef.current !== source
        || displayedNarrativeRef.current.timelineId !== targetTimeline?.id
        || primarySessionRef.current?.id !== created.session.id) return undefined
    }
    return created.session
  }

  function publishAgentSession(session: AgentSession) {
    if (!ownsCollectionSource()) return
    agentSessionRef.current = session
    setAgentSession(session)
    setAgentSessions(current => [session, ...current.filter(item => item.id !== session.id)]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id)))
    setAllAgentSessions(current => [session, ...current.filter(item => item.id !== session.id)]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id)))
  }

  function ownsCollectionSource() {
    return collectionSourceRef.current === collectionSource && !collectionSource.disposed
  }

  function setAllTimelines(update: (current: NarrativeTimeline[]) => NarrativeTimeline[]) {
    if (!ownsCollectionSource()) return
    collectionSource.timelineWrite++
    setTimelineCollection(current => ({
      source: collectionSource,
      items: update(current?.source === collectionSource ? current.items : []),
    }))
  }

  function setAllAgentSessions(update: (current: AgentSession[]) => AgentSession[]) {
    if (!ownsCollectionSource()) return
    collectionSource.sessionWrite++
    setSessionCollection(current => ({
      source: collectionSource,
      items: update(current?.source === collectionSource ? current.items : []),
    }))
  }

  function markAgentSessionReady(ready: boolean) {
    agentSessionReadyRef.current = ready
    setAgentSessionReady(ready)
  }

  function resetAgentSession(preserveCurrent = false) {
    agentSelectionRef.current++
    observedRunRef.current = undefined
    setRunRecovery(undefined)
    setRunRecoveryBusy(false)
    agentSessionPromiseRef.current = undefined
    if (!preserveCurrent) {
      agentSessionRef.current = undefined
      setAgentSession(undefined)
      setAgentTranscriptEntries([])
    }
    setAgentComposerInput('')
    setAgentSessionLoading(false)
    markAgentSessionReady(true)
    setLastRun(undefined)
    setActiveAgentRun(undefined)
    setPromptPreview(undefined)
  }

  function selectAgentPreset(id: string) {
    if (id === (agentSessionRef.current?.agentPresetId ?? input.selectedAgentPresetId)) return
    if (startingRunRef.current || activeAgentRun?.status === 'running' || activeAgentRun?.status === 'suspended')
      throw new Error('Stop the active run before changing its preset')
    resetAgentSession()
    input.onSelectAgentPreset(id)
  }

  async function cancelAgentRun() {
    const run = activeAgentRun
    if (!run || run.status !== 'running') return
    const result = await input.api.agentSessions.cancelRun(run.runId, 'user-stop')
    setActiveAgentRun(current => current?.runId === run.runId ? { ...current, status: result.state } : current)
  }

  function beginAgentSelection(preserveCurrent = false) {
    resetAgentSession(preserveCurrent)
    markAgentSessionReady(false)
    setAgentSessionLoading(true)
    return agentSelectionRef.current
  }

  async function listAgentSessions(timelineId?: string) {
    const sessions: AgentSession[] = []
    let cursor: string | undefined
    do {
      const page = await input.api.agentSessions.list({
        ...(timelineId ? { timelineId } : { standalone: true }), cursor, limit: 100,
      })
      sessions.push(...page.sessions)
      cursor = page.nextCursor
    } while (cursor)
    return sessions
  }

  async function listAllAgentSessions() {
    const sessions: AgentSession[] = []
    let cursor: string | undefined
    do {
      const page = await input.api.agentSessions.list({ cursor, limit: 100 })
      sessions.push(...page.sessions)
      cursor = page.nextCursor
    } while (cursor)
    return sessions
  }

  async function restoreAgentSession(timelineId: string | undefined, selection: number, selectedId?: string) {
    const sessions = await listAgentSessions(timelineId)
    if (selection !== agentSelectionRef.current || input.api !== cardSourceRef.current.api) return
    setAgentSessions(sessions)
    publishPrimarySession(timelineId
      ? sessions.find(item => item.id === safeLocalStorage.getItem(primaryStorageKey(timelineId)))
      : undefined)
    const selected = sessions.find(item => item.id === selectedId) ?? sessions[0]
    if (selected) {
      const transcript = await loadTranscript(input.api, selected.id)
      if (selection !== agentSelectionRef.current || input.api !== cardSourceRef.current.api) return
      publishAgentSession(transcript.session)
      setAgentTranscriptEntries(transcript.entries)
      const inspected = inspectSessionRunStatus(transcript.entries)
      if (inspected.status === 'suspended') {
        setActiveAgentRun({ runId: inspected.runId ?? `session-run-${selected.id}`, status: 'suspended' })
      } else {
        setActiveAgentRun(undefined)
      }
    }
    markAgentSessionReady(true)
  }

  async function refreshAgentSessions(timelineId?: string) {
    const selectedId = agentSessionRef.current?.id
    const selection = beginAgentSelection()
    await input.runAgentAction(async () => {
      try {
        await restoreAgentSession(timelineId, selection, selectedId)
      } finally {
        if (selection === agentSelectionRef.current) setAgentSessionLoading(false)
      }
    })
  }

  async function refreshAllAgentSessions(): Promise<AgentSession[]> {
    if (!ownsCollectionSource()) return []
    const request = ++collectionSource.sessionRead
    const revision = collectionSource.sessionWrite
    const sessions = await listAllAgentSessions()
    if (ownsCollectionSource() && request === collectionSource.sessionRead) {
      if (revision !== collectionSource.sessionWrite) return refreshAllAgentSessions()
      setSessionCollection({ source: collectionSource, items: sessions })
    }
    return sessions
  }

  async function activateAgentSession(sessionOrId: AgentSession | string) {
    const sessionId = typeof sessionOrId === 'string' ? sessionOrId : sessionOrId.id
    const selection = beginAgentSelection(true)
    let activated: AgentSession | undefined
    await input.runAgentAction(async () => {
      try {
        const transcript = await loadTranscript(input.api, sessionId)
        const timelineId = transcript.session.timelineId
        const sameNarrative = timelineId === timeline?.id && (!timelineId || Boolean(branch))
        const details = !sameNarrative && timelineId ? await input.api.narratives.get(timelineId) : undefined
        const page = !sameNarrative && timelineId
          ? await input.api.narratives.getPage({ timelineId, branchId: details?.timeline.activeBranchId, limit: 100 })
          : undefined
        const sessions = await listAgentSessions(timelineId)
        if (selection !== agentSelectionRef.current) return
        if (!sameNarrative) {
          setTimeline(page?.timeline)
          setBranch(page?.branch)
          setBranches(details?.branches ?? [])
          setNodes(page?.nodes ?? [])
          setOlderCursor(page?.nextCursor)
          activateComposerDraft(page?.timeline, page?.branch)
        }
        setAgentSessions(sessions)
        publishAgentSession(transcript.session)
        setAgentTranscriptEntries(transcript.entries)
        const inspected = inspectSessionRunStatus(transcript.entries)
        if (inspected.status === 'suspended') {
          setActiveAgentRun({ runId: inspected.runId ?? `session-run-${sessionId}`, status: 'suspended' })
        } else {
          setActiveAgentRun(undefined)
        }
        markAgentSessionReady(true)
        activated = transcript.session
      } finally {
        if (selection === agentSelectionRef.current) setAgentSessionLoading(false)
      }
    })
    return activated
  }

  async function deleteTimeline(timelineId: string) {
    let deleted = false
    let previewCardId = input.selectedCardId
    await input.runAction(async () => {
      await input.api.narratives.delete(timelineId)
      if (!ownsCollectionSource()) return
      deleted = true
      setAllTimelines(current => current.filter(item => item.id !== timelineId))
      setAgentSessions(current => current.filter(item => item.timelineId !== timelineId))
      setAllAgentSessions(current => current.filter(item => item.timelineId !== timelineId))
      if (displayedNarrativeRef.current.timelineId === timelineId) {
        previewCardId = timeline?.createdFrom?.cardId ?? input.selectedCardId
        if (previewCardId !== cardSourceRef.current.cardId) {
          cardSourceRef.current = { api: input.api, cardId: previewCardId }
          if (previewCardId) input.onSelectCard(previewCardId)
        }
        resetToDraftTimeline()
      }
      await refreshAllTimelines()
      if (previewCardId) {
        await refreshCardTimelines(previewCardId)
      }
    })
    return deleted
  }

  async function renameTimeline(timelineId: string, title: string) {
    let updated: NarrativeTimeline | undefined
    await input.runAction(async () => {
      const result = await input.api.narratives.update({ timelineId, title: title.trim() || undefined })
      if (!ownsCollectionSource()) return
      updated = result.timeline
      setAllTimelines(current => current.map(item => item.id === timelineId ? result.timeline : item))
      setTimeline(current => current?.id === timelineId
        ? { ...current, title: result.timeline.title, updatedAt: result.timeline.updatedAt }
        : current)
      await refreshAllTimelines()
      if (input.selectedCardId) {
        await refreshCardTimelines(input.selectedCardId)
      }
    })
    return updated
  }

  async function deleteAgentSession(agentSessionId: string) {
    let deleted = false
    await input.runAgentAction(async () => {
      await input.api.agentSessions.delete(agentSessionId)
      if (!ownsCollectionSource()) return
      setAgentSessions(current => current.filter(item => item.id !== agentSessionId))
      setAllAgentSessions(current => current.filter(item => item.id !== agentSessionId))
      if (agentSessionRef.current?.id === agentSessionId) {
        resetAgentSession()
      }
      if (primarySessionRef.current?.id === agentSessionId) {
        if (timeline) safeLocalStorage.removeItem(primaryStorageKey(timeline.id))
        publishPrimarySession(undefined)
      }
      deleted = true
    })
    return deleted
  }

  async function renameAgentSession(agentSessionId: string, title: string) {
    let updated: AgentSession | undefined
    await input.runAgentAction(async () => {
      const result = await input.api.agentSessions.update({ agentSessionId, title: title.trim() || undefined })
      if (!ownsCollectionSource()) return
      updated = result.session
      if (agentSessionRef.current?.id === agentSessionId) {
        publishAgentSession(result.session)
      } else {
        setAgentSessions(current => current.map(item => item.id === agentSessionId ? result.session : item))
        setAllAgentSessions(current => current.map(item => item.id === agentSessionId ? result.session : item))
      }
    })
    return updated
  }

  return {
    selectAgentPreset,
    primarySession,
    createAgentSession,
    setPrimaryAgentSession,
    agentComposerInput,
    agentInput: agentComposerInput,
    agentMessages,
    agentSession,
    agentSessions,
    allAgentSessions,
    agentSessionReady,
    agentSessionLoading,
    activeAgentRun: observedRunRef.current && !ownsRun(observedRunRef.current) ? undefined : activeAgentRun,
    runRecovery: observedRunRef.current && ownsRun(observedRunRef.current) ? runRecovery : undefined,
    runRecoveryBusy: Boolean(observedRunRef.current && ownsRun(observedRunRef.current) && runRecoveryBusy),
    canRestoreRunInput: Boolean(observedRunRef.current && ownsRun(observedRunRef.current)
      && runRecovery?.input && !runRecoveryBusy && composerInputsRef.current[runRecovery.target].length === 0),
    reconnectAgentRun,
    restoreRunInput,
    retryNarrativeInput,
    canRetryNarrativeInput: Boolean(narrativeSubmission && ownsNarrativeSubmission(narrativeSubmission)
      && agentSessionReady && !startingRunRef.current && !runRecoveryBusy
      && !(observedRunRef.current && ownsRun(observedRunRef.current)
        && (observedRunRef.current.status === 'running' || observedRunRef.current.observing))),
    approveAgentMutation,
    cancelAgentRun,
    pauseAgentRun,
    resumeAgentRun,
    newAgentSession: resetAgentSession,
    refreshAgentSessions: () => refreshAgentSessions(timeline?.id),
    refreshAllAgentSessions,
    allTimelines,
    branch,
    branches,
    cardTimelines,
    composerInput,
    editNarrativeNode,
    hasOlderNarrativeNodes: Boolean(olderCursor),
    input: composerInput,
    lastRun,
    loadOlderNodes,
    nodes,
    olderCursor,
    promptPreview,
    setAgentInput: setAgentDraft,
    setInput: setComposerDraft,
    timeline,
    activateTimeline,
    selectCardTimeline,
    activateAgentSession,
    createTimelineFromCard,
    deleteTimeline,
    renameTimeline,
    deleteAgentSession,
    renameAgentSession,
    forkFromNode,
    previewPrompt,
    refreshCardTimelines,
    refreshAllTimelines,
    submitAgentTurn,
    submitTurn,
    switchBranch,
    resetToDraftTimeline,
  }
}

export function reconcileNarrativeNodes(current: NarrativeNode[], page: NarrativeNode[]): NarrativeNode[] {
  if (!page.length) return current.length ? [] : current
  const start = current.findIndex(node => node.id === page[0].id)
  if (start < 0) return page
  const prefix = current.slice(0, start)
  const merged = page.map((node, index) => {
    const previous = current[start + index]
    return previous?.id === node.id && previous.body.raw === node.body.raw ? previous : node
  })
  if (current.length === start + page.length
    && merged.every((node, index) => node === current[start + index])) return current
  return [...prefix, ...merged]
}

async function loadTranscript(api: StudioApi, agentSessionId: string) {
  const entries: AgentTranscriptEntry[] = []
  let cursor: string | undefined
  let session: AgentSession | undefined
  do {
    const page = await api.agentSessions.getTranscript({ agentSessionId, cursor, limit: 100 })
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

export function resolveNarrativeBranch(branches: NarrativeBranch[], activeBranchId: string, requestedBranchId?: string): NarrativeBranch | undefined {
  return branches.find(branch => branch.id === (requestedBranchId ?? activeBranchId))
}

export function readComposerDraftKey(
  timeline: NarrativeTimeline | undefined,
  branch: NarrativeBranch | undefined,
  selectedCardId?: string,
): string {
  if (timeline) return `${timeline.id}:${branch?.id ?? 'unbound'}`
  return `card:${selectedCardId ?? 'unbound'}`
}

async function runAgentTurn(
  run: ObservedRun,
  isCurrent: () => boolean,
  updateMessages: (update: (entries: AgentTranscriptEntry[]) => AgentTranscriptEntry[]) => void,
  updateRun: (run: ActiveAgentRun | undefined) => void,
  onConnected: () => void,
): Promise<InvokeAgentTurnResult | undefined> {
  const { api, runId, streamingId } = run
  while (isCurrent()) {
    let batch = await subscribeAgentRunWithRetry(api, runId, run.cursor, run.sessionId)
    if (!isCurrent()) return undefined
    const replayExpired = batch.replayExpired
    const pendingApprovals = replayExpired ? batch.pendingApprovals ?? [] : []
    if (batch.replayExpired) {
      const snapshot = batch
      const transcript = await loadTranscript(api, run.sessionId)
      if (!isCurrent()) return undefined
      if (!snapshot.done) {
        batch = await subscribeAgentRunWithRetry(api, runId, snapshot.nextCursor, run.sessionId)
        if (!isCurrent()) return undefined
        if (batch.replayExpired) {
          run.cursor = snapshot.nextCursor
          continue
        }
      }
      const committedDuringRead = batch !== snapshot && batch.events.some(event =>
        event.type === 'transcript-appended' && Array.isArray(event.entries)
        && (event.entries as unknown as AgentTranscriptEntry[]).some(entry =>
          entry.runId === runId && (entry.entry.kind === 'tool-invocation'
            || entry.entry.kind === 'message' && entry.entry.role === 'assistant')))
      updateMessages(current => {
        const committed = transcript.entries.filter(entry => entry.runId === runId)
        const committedIds = new Set(committed.map(entry => entry.id))
        const placeholder = current.find(entry => entry.id === streamingId)
        const entries = [
          ...current.filter(entry => entry.runId !== runId && entry.id !== streamingId
            && entry.id !== run.optimisticEntryId && !committedIds.has(entry.id)),
          ...committed,
        ].sort((a, b) => a.sequence - b.sequence)
        if (placeholder) entries.push({
          ...placeholder, sequence: (entries.at(-1)?.sequence ?? 0) + 1,
          entry: { kind: 'message', role: 'assistant', content: committedDuringRead ? '' : snapshot.partialText ?? '' },
        })
        return entries
      })
      updateRun({ runId, status: batch.state })
    }
    onConnected()
    run.cursor = batch.nextCursor
    for (const event of [...pendingApprovals, ...batch.events]) {
      if (event.type === 'transcript-appended' && Array.isArray(event.entries)) {
        const appended = event.entries as unknown as AgentTranscriptEntry[]
        updateMessages(current => mergeAgentRunEntries(current, appended, run))
      }
      if (event.type === 'text-delta' && typeof event.delta === 'string' && streamingId) {
        updateMessages(entries => entries.map(entry => entry.id === streamingId
          ? { ...entry, entry: { ...entry.entry, content: `${entry.entry.content ?? ''}${event.delta}` } }
          : entry))
      }
      if (event.type === 'mutation-approval-requested'
        && typeof event.requestId === 'string'
        && event.preview
        && typeof event.preview === 'object') {
        updateRun({
          runId,
          status: 'running',
          approval: {
            requestId: event.requestId,
            preview: event.preview as NonNullable<AgentMutationApproval['preview']>,
          },
        })
      }
      if (event.type === 'history-read-approval-requested'
        && typeof event.requestId === 'string' && event.action && typeof event.action === 'object') {
        updateRun({
          runId, status: 'running',
          approval: {
            requestId: event.requestId,
            action: event.action as NonNullable<AgentMutationApproval['action']>,
          },
        })
      }
      if (event.type === 'completed' && event.result && typeof event.result === 'object') {
        run.status = 'completed'
        updateRun({ runId, status: 'completed' })
        return event.result as unknown as InvokeAgentTurnResult
      }
      if (event.type === 'failed') {
        run.status = 'failed'
        updateRun({ runId, status: 'failed' })
        throw new Error(typeof event.error === 'object' && event.error && 'message' in event.error
          ? String(event.error.message)
          : 'Agent turn failed')
      }
      if (event.type === 'cancelled') {
        run.status = 'cancelled'
        updateRun({ runId, status: 'cancelled' })
        return undefined
      }
      if (event.type === 'suspended') {
        run.status = 'suspended'
        updateRun({ runId, status: 'suspended' })
        return undefined
      }
    }
    if (batch.done) {
      run.status = batch.state
      updateRun({ runId, status: batch.state })
      if (batch.state === 'cancelled' || batch.state === 'suspended') return undefined
      if (replayExpired && batch.state === 'completed') return undefined
      throw new Error(`Agent run ended without a completed result: ${runId}`)
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}

export function mergeAgentRunEntries(
  current: AgentTranscriptEntry[],
  appended: AgentTranscriptEntry[],
  run: Pick<ObservedRun, 'optimisticEntryId' | 'streamingId'>,
): AgentTranscriptEntry[] {
  const receivedIds = new Set(appended.map(entry => entry.id))
  const hasUser = appended.some(entry => entry.entry.kind === 'message' && entry.entry.role === 'user')
  const committedStep = appended.some(entry => entry.entry.kind === 'message' && entry.entry.role === 'assistant'
    || entry.entry.kind === 'tool-invocation')
  const placeholder = current.find(entry => entry.id === run.streamingId)
  const entries = [
    ...current.filter(entry => entry.id !== run.streamingId && !receivedIds.has(entry.id)
      && (!hasUser || entry.id !== run.optimisticEntryId)),
    ...appended,
  ].sort((a, b) => a.sequence - b.sequence)
  if (placeholder) {
    entries.push({
      ...placeholder,
      sequence: (entries.at(-1)?.sequence ?? 0) + 1,
      entry: committedStep ? { kind: 'message', role: 'assistant', content: '' } : placeholder.entry,
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
