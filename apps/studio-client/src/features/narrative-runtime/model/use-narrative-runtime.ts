import { createId } from '@loom-studio/shared'
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
import type { StudioApi } from '../../../shared/api/studio-api.js'
import { subscribeDataCommits } from '../../../shared/api/data-commit-events.js'
import {
  loadTranscript, releasePrimaryRun, resolveSessionRun, runAgentTurn,
  type ActiveAgentRun, type ObservedRun, type RunRecovery,
  retainToolPresentation,
} from './agent-run-observer.js'
export { inspectSessionRunStatus, releasePrimaryRun, mergeAgentRunEntries } from './agent-run-observer.js'
export type { ActiveAgentRun, RunRecovery } from './agent-run-observer.js'
import { useNarrativeCollections } from './use-narrative-collections.js'
import { safeLocalStorage } from '../../../shared/browser/safe-local-storage.js'
import type { LatestOperationContext } from '../../../shared/hooks/use-async-operations.js'
import { openingChoiceRequest, type OpeningChoice } from '../../cards/model/opening-choice.js'
import type { Translator } from '../../../shared/i18n/index.js'
import type { Logger } from '@loom-studio/logging'
import { notify } from '../../../shared/notifications/index.js'

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

type JsonObject = { [key: string]: ClientJsonValue }
export type NarrativeSwipeView = NonNullable<Awaited<ReturnType<StudioApi['narratives']['getSwipes']>>['swipe']>

type UseNarrativeRuntimeInput = {
  getMacroSelections?: (timelineId?: string, branchId?: string) => import('@loom-studio/shared').MacroSelectionMap | undefined
  activationFacts?: JsonObject
  api: StudioApi
  storageScope: string
  initialInput: string
  initialNodes?: NarrativeNode[]
  selectedCard?: Card
  selectedCardId?: string
  chooseStoryExtensions?: (cardId: string) => Promise<Array<{ packageId: string; target: 'global' | 'card' }> | undefined>
  onSelectCard(id: string): void
  selectedAgentPresetId?: string
  onSelectAgentPreset(id: string): void
  runAgentAction: (action: () => Promise<void>) => Promise<void>
  runAction: (action: () => Promise<void>) => Promise<boolean>
  runLatestAction: (action: (context: LatestOperationContext) => Promise<void>) => Promise<void>
  t?: Translator
  logger?: Logger
}

export function useNarrativeRuntime(input: UseNarrativeRuntimeInput) {
  const {
    allTimelines, allAgentSessions, setAllTimelines, setAllAgentSessions,
    refreshAllTimelines, refreshAllAgentSessions, ownsCollectionSource, sessionWriteRevision,
  } = useNarrativeCollections(input.api)
  type CardSource = { api: StudioApi; cardId?: string; request?: Promise<NarrativeTimeline[]>; disposed?: boolean }
  const cardSourceRef = useRef<CardSource>({ api: input.api, cardId: input.selectedCardId })
  if (cardSourceRef.current.api !== input.api || cardSourceRef.current.cardId !== input.selectedCardId) {
    cardSourceRef.current = { api: input.api, cardId: input.selectedCardId }
  }
  const [timeline, setTimeline] = useState<NarrativeTimeline>()
  const [openingSelection, setOpeningSelection] = useState<{ source: CardSource; timelineId?: string; choice: OpeningChoice }>()
  const pendingSends = useRef(new Map<string, { api: StudioApi; signature: string; requestId: string }>())
  async function createConfirmedRun(request: Parameters<StudioApi['agentSessions']['createRun']>[0]) {
    const signature = JSON.stringify(request)
    const previous = pendingSends.current.get(request.agentSessionId)
    const pending = previous?.api === input.api && previous.signature === signature ? previous
      : { api: input.api, signature, requestId: createId() }
    pendingSends.current.set(request.agentSessionId, pending)
    const started = await input.api.agentSessions.createRun({ ...request, requestId: pending.requestId })
    if (pendingSends.current.get(request.agentSessionId) === pending) pendingSends.current.delete(request.agentSessionId)
    return started
  }
  const creatingTimelineRef = useRef(false)
  const replacingOpeningRef = useRef(false)
  const [branch, setBranch] = useState<NarrativeBranch>()
  const [branches, setBranches] = useState<NarrativeBranch[]>([])
  const [nodes, setNodes] = useState<NarrativeNode[]>(() => input.initialNodes ?? [])
  const savedOpeningChoice: OpeningChoice = timeline?.opening
    ? timeline.opening.custom ? { kind: 'custom', content: nodes.find(node => node.id === timeline.opening!.nodeId)?.body.raw ?? '' }
      : timeline.opening.id !== undefined ? { kind: 'card', id: timeline.opening.id }
      : timeline.opening.nodeId ? { kind: 'custom', content: nodes.find(node => node.id === timeline.opening!.nodeId)?.body.raw ?? '' }
        : { kind: 'empty' }
    : input.selectedCard && input.selectedCard.id === input.selectedCardId ? { kind: 'card', id: input.selectedCard.opening.id } : { kind: 'empty' }
  const openingChoice = openingSelection?.source === cardSourceRef.current && openingSelection.timelineId === timeline?.id
    ? openingSelection.choice : savedOpeningChoice
  const openingChanged = Boolean(timeline?.opening && !timeline.opening.locked && JSON.stringify(openingChoiceRequest(openingChoice)) !== JSON.stringify(openingChoiceRequest(savedOpeningChoice)))
  function setOpeningChoice(choice: OpeningChoice) {
    setOpeningSelection({ source: cardSourceRef.current, timelineId: timeline?.id, choice })
  }
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
  const [agentSession, setAgentSession] = useState<AgentSession>()
  const [primarySession, setPrimarySession] = useState<AgentSession>()
  const [agentSessions, setAgentSessions] = useState<AgentSession[]>([])
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
  const [swipeResult, setSwipeResult] = useState<{ api: StudioApi; timelineId: string; branchId: string; swipe?: NarrativeSwipeView }>()
  const [swipeBusy, setSwipeBusy] = useState(false)
  const swipeOperationRef = useRef(false)
  const swipeReadRef = useRef(0)
  const [swipeDisplay, setSwipeDisplay] = useState<{ api: StudioApi; timelineId: string; branchId: string; inputNodeId: string; node: NarrativeNode }>()
  const transcriptProjectionRef = useRef('')
  const transcriptReadRef = useRef(0)
  const swipe = swipeResult?.api === input.api && swipeResult.timelineId === timeline?.id
    && swipeResult.branchId === branch?.id ? swipeResult.swipe : undefined

  async function refreshSwipe(timelineId: string, branchId: string) {
    const target = displayedNarrativeRef.current
    if (target.api !== input.api || target.timelineId !== timelineId || target.branchId !== branchId) return
    const request = ++swipeReadRef.current
    let result: Awaited<ReturnType<StudioApi['narratives']['getSwipes']>>
    try {
      result = await input.api.narratives.getSwipes({ timelineId, branchId })
    } catch (error) {
      const displayed = displayedNarrativeRef.current
      if (request !== swipeReadRef.current || displayed.api !== input.api
        || displayed.timelineId !== timelineId || displayed.branchId !== branchId) return
      throw error
    }
    const displayed = displayedNarrativeRef.current
    if (request !== swipeReadRef.current || displayed.api !== input.api
      || displayed.timelineId !== timelineId || displayed.branchId !== branchId) return
    setSwipeResult({ api: input.api, timelineId, branchId, swipe: result.swipe })
    const projectionKey = JSON.stringify([agentSessionRef.current?.id, timelineId, branchId,
      result.swipe?.id, result.swipe?.activeCandidateId, result.swipe?.selectedCandidateId])
    if (projectionKey !== transcriptProjectionRef.current) {
      transcriptProjectionRef.current = projectionKey
      await refreshDisplayedTranscript()
    }
  }

  async function refreshDisplayedTranscript() {
    const sessionId = agentSessionRef.current?.id
    if (!sessionId) return
    const selection = agentSelectionRef.current
    const request = ++transcriptReadRef.current
    const transcript = await loadTranscript(input.api, sessionId, true)
    if (request !== transcriptReadRef.current || selection !== agentSelectionRef.current
      || input.api !== cardSourceRef.current.api || cardSourceRef.current.disposed
      || sessionId !== agentSessionRef.current?.id) return
    setAgentTranscriptEntries(current => retainToolPresentation(current, transcript.entries))
  }

  async function selectSwipe(candidateId: string) {
    if (!swipe?.canSelect || swipe.active || swipe.suspended || !branch || swipeOperationRef.current) return
    const displayed = displayedNarrativeRef.current
    if (displayed.api !== input.api || displayed.timelineId !== swipe.timelineId || displayed.branchId !== swipe.branchId) return
    swipeOperationRef.current = true
    setSwipeBusy(true)
    try {
      await input.runAction(async () => {
        const result = await input.api.narratives.selectSwipe({
          timelineId: swipe.timelineId, branchId: swipe.branchId, groupId: swipe.id, candidateId,
          expectedRevision: swipe.revision, expectedHeadNodeId: branch.headNodeId ?? null,
        })
        const displayed = displayedNarrativeRef.current
        if (displayed.api !== input.api || displayed.timelineId !== swipe.timelineId || displayed.branchId !== swipe.branchId) return
        swipeReadRef.current++
        narrativeWriteRevisionRef.current++
        setTimeline(result.page.timeline)
        setBranch(result.page.branch)
        setBranches(current => current.map(item => item.id === result.page.branch.id ? result.page.branch : item))
        setNodes(current => reconcileNarrativeNodes(current, result.page.nodes))
        if (!olderWindowRef.current) setOlderCursor(result.page.nextCursor)
        setSwipeResult({ api: input.api, timelineId: swipe.timelineId, branchId: swipe.branchId, swipe: result.swipe })
        setPromptPreview(undefined)
        await refreshDisplayedTranscript()
      })
    } finally {
      swipeOperationRef.current = false
      setSwipeBusy(false)
    }
  }

  async function generateSwipe(mode: 'swipe' | 'regenerate' | 'retry', allowSessionChange = false, newInput?: string) {
    if (!swipe?.canGenerate || swipe.active || swipe.suspended || swipeOperationRef.current) return false
    const displayed = displayedNarrativeRef.current
    if (displayed.api !== input.api || displayed.timelineId !== swipe.timelineId || displayed.branchId !== swipe.branchId) return false
    swipeOperationRef.current = true
    setSwipeBusy(true)
    const previousNode = mode === 'swipe' && newInput === undefined
      ? nodes.find(node => node.id === swipe.candidates.find(candidate => candidate.id === swipe.selectedCandidateId)?.nodeId) : undefined
    const display = previousNode ? { api: input.api, timelineId: swipe.timelineId, branchId: swipe.branchId,
      inputNodeId: swipe.inputNodeId, node: previousNode } : undefined
    setSwipeDisplay(display)
    let accepted = false
    try {
      await input.runAction(async () => {
        const session = primarySessionRef.current
        if (!session || session.timelineId !== swipe.timelineId) throw new Error(input.t?.('swipe.noPrimary') ?? 'No primary writing session')
        if ((swipe.requiresRegeneration || session.id !== swipe.sourceAgentSessionId) && (!allowSessionChange || mode !== 'regenerate'))
          throw new Error(input.t?.('swipe.sessionChanged') ?? 'Primary writing session changed')
        const selection = agentSelectionRef.current
        const started = await createConfirmedRun({
          agentSessionId: session.id, input: '', activationFacts: input.activationFacts,
          macroSelections: input.getMacroSelections?.(swipe.timelineId, swipe.branchId),
          narrativeTarget: { timelineId: swipe.timelineId, branchId: swipe.branchId, inputNodeId: swipe.inputNodeId,
            swipe: { groupId: swipe.id, mode, expectedRevision: swipe.revision,
              ...(newInput !== undefined ? { input: newInput } : {}), ...(allowSessionChange ? { allowSessionChange: true } : {}) } },
        })
        accepted = true
        const displayed = displayedNarrativeRef.current
        if (selection !== agentSelectionRef.current || displayed.api !== input.api
          || displayed.timelineId !== swipe.timelineId || displayed.branchId !== swipe.branchId) return
        const run: ObservedRun = {
          api: input.api, selection, runId: started.runId, sessionId: session.id, target: 'narrative',
          narrativeTarget: { timelineId: swipe.timelineId, branchId: swipe.branchId },
          streamingId: '', cursor: 0, status: 'running', observing: false,
        }
        observedRunRef.current = run
        setRunRecovery(undefined)
        setActiveAgentRun({ runId: started.runId, status: 'running' })
        await input.runAction(() => refreshRunState(run))
        await observeRun(run)
      })
    } finally {
      setSwipeDisplay(current => current === display ? undefined : current)
      swipeOperationRef.current = false
      setSwipeBusy(false)
      if (swipe) await input.runAction(() => refreshSwipe(swipe.timelineId, swipe.branchId))
    }
    return accepted
  }

  useEffect(() => {
    if (!timeline || !branch) return
    const timelineId = timeline.id
    const branchId = branch.id
    let sequence = 0
    let disposed = false
    const refreshSwipes = () => { if (!disposed) void input.runAction(() => refreshSwipe(timelineId, branchId)) }
    refreshSwipes()
    const refresh = () => {
      if (disposed) return
      const request = ++sequence
      const writeRevision = narrativeWriteRevisionRef.current
      void input.runAction(async () => {
        let page: Awaited<ReturnType<StudioApi['narratives']['getPage']>>
        try {
          page = await input.api.narratives.getPage({ timelineId, branchId, limit: 100 })
        } catch (error) {
          const displayed = displayedNarrativeRef.current
          if (disposed || request !== sequence || displayed.api !== input.api
            || displayed.timelineId !== timelineId || displayed.branchId !== branchId) return
          throw error
        }
        const displayed = displayedNarrativeRef.current
        if (disposed || request !== sequence || writeRevision !== narrativeWriteRevisionRef.current || displayed.api !== input.api
          || displayed.timelineId !== timelineId || displayed.branchId !== branchId) return
        setTimeline(page.timeline)
        setBranch(page.branch)
        setBranches(current => current.map(item => item.id === branchId ? page.branch : item))
        setNodes(current => page.timeline.opening && !page.timeline.opening.locked ? page.nodes : reconcileNarrativeNodes(current, page.nodes))
        if (!olderWindowRef.current) {
          olderCursorRef.current = page.nextCursor
          setOlderCursor(page.nextCursor)
        }
        setPromptPreview(undefined)
      })
    }
    const unsubscribe = subscribeDataCommits(operations => {
      // Deletes invalidate this subscription; reading the removed branch is not a refresh.
      if (operations.some(item => item.kind === 'delete'
        && ((item.entityType === 'narrative.timeline' && item.entityId === timelineId)
          || (item.entityType === 'narrative.branch' && item.entityId === branchId)))) {
        disposed = true
        sequence++
        swipeReadRef.current++
        return
      }
      if (operations.some(item => (item.entityType === 'narrative.branch' && item.entityId === branchId)
        || (item.entityType === 'narrative.timeline' && item.entityId === timelineId))) refresh()
      if (operations.some(item => item.entityId === branchId || item.entityId === timelineId
        || item.entityType.startsWith('agent.') || item.entityType.startsWith('narrative.swipe'))) refreshSwipes()
    }, () => { refresh(); refreshSwipes() })
    return () => { disposed = true; sequence++; swipeReadRef.current++; unsubscribe() }
  }, [input.api, timeline?.id, branch?.id])

  useEffect(() => {
    if (typeof EventSource === 'undefined') return
    const timelineId = timeline?.id
    let sequence = 0
    const sessionReads = new Map<string, number>()
    let disposed = false
    const refresh = () => {
      const request = ++sequence
      const revision = sessionWriteRevision()
      void input.runAction(async () => {
        const sessions = await listAgentSessions(timelineId)
        if (disposed || request !== sequence || !ownsCollectionSource()
          || displayedNarrativeRef.current.timelineId !== timelineId) return
        if (revision !== sessionWriteRevision()) {
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
        }
        if (primarySessionRef.current?.timelineId === timelineId && primarySessionRef.current) {
          const primary = sessions.find(item => item.id === primarySessionRef.current?.id)
          if (primary) publishPrimarySession(primary)
        }
      })
    }
    const unsubscribe = subscribeDataCommits(operations => {
      const relevant = operations.filter(item => item.entityType === 'agent.session'
        && (!item.scope || (item.scope.entityType === 'narrative.timeline' && item.scope.entityId === timelineId)))
      if (!relevant.length) return
      for (const operation of relevant) {
        if (operation.kind !== 'delete') continue
        if (operation.entityId === agentSessionRef.current?.id) resetAgentSession()
        if (operation.entityId === primarySessionRef.current?.id) {
          if (timelineId) safeLocalStorage.removeItem(primaryStorageKey(timelineId))
          publishPrimarySession(undefined)
        }
      }
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
        const results = await Promise.all(reads.map(async read => {
          try { return { ...read, session: (await input.api.agentSessions.get(read.id)).session } }
          catch (error) {
            if (disposed || request !== sequence || sessionReads.get(read.id) !== read.generation
              || !ownsCollectionSource() || displayedNarrativeRef.current.timelineId !== timelineId) return undefined
            throw error
          }
        }))
        if (disposed || request !== sequence || !ownsCollectionSource()
          || displayedNarrativeRef.current.timelineId !== timelineId) return
        const sessions = results.flatMap(read => read && sessionReads.get(read.id) === read.generation ? [read.session] : [])
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

  async function selectCardTimeline(cardId: string) {
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
    } else {
      resetToDraftTimeline()
      return null
    }
  }

  useEffect(() => {
    void input.runAction(async () => { await refreshAllTimelines() })
  }, [input.api])

  useEffect(() => {
    // Existing Timeline navigation owns restoration, including after Fast Refresh.
    if (displayedNarrativeRef.current.timelineId || agentSessionRef.current) return
    void refreshAgentSessions()
  }, [])

  async function createTimelineFromCard(cardId = input.selectedCardId, choice?: OpeningChoice, cardVersion?: number) {
    if (!cardId || creatingTimelineRef.current) return
    creatingTimelineRef.current = true

    try {
      const requestedSource = cardSourceRef.current
      const extensionAdoptions = input.chooseStoryExtensions ? await input.chooseStoryExtensions(cardId) : undefined
      if (input.chooseStoryExtensions && extensionAdoptions === undefined) return
      if (requestedSource.disposed || cardSourceRef.current !== requestedSource) return
      let activated: { branchId: string; timelineId: string } | undefined
      let activatedSelection: number | undefined
      const source = cardSourceRef.current
      const selection = beginAgentSelection()
      await input.runAction(async () => {
        const selectedOpening = choice ?? (cardId === input.selectedCardId ? openingChoice
          : input.selectedCard && input.selectedCard.id === cardId ? { kind: 'card' as const, id: input.selectedCard.opening.id } : undefined)
        const result = await input.api.narratives.create({
          cardId, ...(selectedOpening ? openingChoiceRequest(selectedOpening) : {}),
          ...(extensionAdoptions !== undefined ? { extensionAdoptions } : {}),
          expectedCardVersion: cardVersion ?? (input.selectedCard?.id === cardId ? input.selectedCard.version : undefined),
        })
        if (source.disposed || cardSourceRef.current !== source || selection !== agentSelectionRef.current) return
        setTimeline(result.timeline)
        displayedNarrativeRef.current = { timelineId: result.timeline.id, branchId: result.branch.id, api: input.api }
        setAllTimelines(current => [result.timeline, ...current.filter(item => item.id !== result.timeline.id)])
        setBranch(result.branch)
        setBranches([result.branch])
        setNodes(result.nodes)
        setOlderCursor(undefined)
        resetAgentSession()
        publishPrimarySession(undefined)
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
    } finally {
      creatingTimelineRef.current = false
    }
  }

  async function replaceOpening(choice = openingChoice) {
    if (replacingOpeningRef.current || creatingTimelineRef.current || startingRunRef.current) return
    const source = cardSourceRef.current
    const timelineId = timeline?.id
    const branchId = branch?.id
    replacingOpeningRef.current = true
    try {
      await input.runAction(async () => {
        if (!timeline?.opening || timeline.opening.locked || !branch || !timelineId || !branchId) throw new Error('当前时间线已不能切换开场')
        if (displayedNarrativeRef.current.timelineId !== timelineId || displayedNarrativeRef.current.branchId !== branchId) return
        const result = await input.api.narratives.replaceOpening({
          timelineId, branchId, expectedHeadNodeId: branch.headNodeId ?? null,
          expectedCardVersion: input.selectedCard?.id === timeline.createdFrom?.cardId ? input.selectedCard?.version : undefined,
          ...openingChoiceRequest(choice),
        })
        if (source.disposed || cardSourceRef.current !== source || displayedNarrativeRef.current.timelineId !== timelineId
          || displayedNarrativeRef.current.branchId !== branchId) return
        narrativeWriteRevisionRef.current++
        setTimeline(result.timeline)
        setAllTimelines(current => current.map(item => item.id === timelineId ? result.timeline : item))
        setBranch(result.branch)
        setBranches(current => current.map(item => item.id === branchId ? result.branch : item))
        setNodes(result.nodes)
        setOpeningSelection(undefined)
        setOlderCursor(undefined)
        setPromptPreview(undefined)
      })
    } finally {
      replacingOpeningRef.current = false
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
        await restoreAgentSession(timelineId, selection)
        activatedBranchId = page.branch.id
      } finally {
        if (selection === agentSelectionRef.current) setAgentSessionLoading(false)
      }
    })
    return input.api === cardSourceRef.current.api && selection === agentSelectionRef.current
      ? activatedBranchId
      : undefined
  }

  function resetToDraftTimeline() {
    setOpeningSelection(undefined)
    displayedNarrativeRef.current = { timelineId: undefined, branchId: undefined, api: input.api }
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
    if (swipe) return generateSwipe('retry')
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

  async function sendNarrativeInput(retry?: NarrativeSubmission): Promise<void> {
    const content = retry?.content ?? composerInput.trim()
    if (content.length === 0) return undefined
    if (!timeline || !branch || displayedNarrativeRef.current.timelineId !== timeline.id || displayedNarrativeRef.current.branchId !== branch.id) {
      await input.runAction(async () => { throw new Error('请先点击“开始一个新故事”') })
      return undefined
    }
    if (replacingOpeningRef.current || openingChanged) return undefined
    if (!agentSessionReadyRef.current) return undefined
    if (runRecovery?.target === 'narrative' && runRecovery.refreshFailed) return undefined
    if (swipeOperationRef.current || startingRunRef.current || (observedRunRef.current?.target === 'narrative' && ownsRun(observedRunRef.current)
      && (observedRunRef.current.status === 'running' || observedRunRef.current.observing))) return undefined

    startingRunRef.current = true
    try {
      await input.runAction(async () => {
        if (!primarySessionRef.current || primarySessionRef.current.timelineId !== timeline?.id) {
          // ponytail: Reuse the existing client binding until backend writing configuration owns first-send creation.
          if (safeLocalStorage.getItem(primaryStorageKey(timeline.id))) {
            throw new Error('原主写作对话不可用，请重新选择主写作对话')
          }
          if (!input.selectedAgentPresetId) throw new Error('请先选择写作使用的 Agent 预设，无需手动创建对话')
          const source = cardSourceRef.current
          const selection = agentSelectionRef.current
          const created = await input.api.agentSessions.create({
            agentPresetId: input.selectedAgentPresetId, timelineId: timeline.id,
          })
          // Keep the binding on its originating Timeline even if navigation changed during creation.
          safeLocalStorage.setItem(primaryStorageKey(timeline.id), created.session.id)
          if (source.disposed || source !== cardSourceRef.current || selection !== agentSelectionRef.current
            || displayedNarrativeRef.current.timelineId !== timeline.id
            || displayedNarrativeRef.current.branchId !== branch.id) return
          publishPrimarySession(created.session)
          setAgentSessions(current => [created.session, ...current.filter(item => item.id !== created.session.id)])
          setAllAgentSessions(current => [created.session, ...current.filter(item => item.id !== created.session.id)])
          if (!agentSessionRef.current) publishAgentSession(created.session)
        }
        let currentTimeline = timeline
        let currentBranch = branch

        const selection = agentSelectionRef.current
        const previous = narrativeSubmissionRef.current
        let submission = retry ?? (previous && ownsNarrativeSubmission(previous)
          && !previous.delivered && previous.content === content ? previous : {
            api: input.api, timelineId: currentTimeline.id, branchId: currentBranch.id,
            nodeId: createId(), expectedHeadNodeId: currentBranch.headNodeId ?? null,
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
          return
        }
        const session = primarySessionRef.current
        if (!session || session.timelineId !== currentTimeline.id) throw new Error('请先设置主写作对话')
        if (selection !== agentSelectionRef.current || !ownsNarrativeSubmission(submission)) return

        const started = await createConfirmedRun({
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
      })
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
        const started = await createConfirmedRun({
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
    await input.runAgentAction(async () => {
      const result = await input.api.agentSessions.pauseRun(run.runId)
      if (result.accepted) setActiveAgentRun(current => current?.runId === run.runId ? { ...current, status: result.state } : current)
    })
  }

  async function resumeAgentRun() {
    const run = activeAgentRun
    if (!run || run.status !== 'suspended') return
    if (startingRunRef.current || observedRunRef.current?.observing || runRecovery?.status === 'disconnected') return
    const selection = agentSelectionRef.current
    const candidate = observedRunRef.current
    const previous = candidate && ownsRun(candidate) && candidate.runId === run.runId ? candidate : undefined
    const sessionId = previous?.sessionId ?? agentSessionRef.current?.id
    if (!sessionId) return

    await input.runAgentAction(async () => {
      startingRunRef.current = true
      try {
        const result = await input.api.agentSessions.resumeRun({
          runId: run.runId,
          agentSessionId: sessionId,
        })

        if (!result.accepted || selection !== agentSelectionRef.current || input.api !== cardSourceRef.current.api) {
          return
        }

        setRunRecovery(undefined)
        setActiveAgentRun({ runId: result.runId, status: 'running' })

        const streamingId = `streaming-agent-entry-${++optimisticEntryIdRef.current}`
        if (agentSessionRef.current?.id === sessionId) setAgentTranscriptEntries(current => [...current, {
          id: streamingId,
          agentSessionId: sessionId,
          sequence: (current.at(-1)?.sequence ?? 0) + 1,
          entry: { kind: 'message', role: 'assistant', content: '' },
          createdAt: new Date().toISOString(),
        }])

        await observeRun({
          api: input.api, selection, runId: result.runId, sessionId,
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
    // Reading Swipe settles discarded checkpoints before the page reads their restored baseline.
    if (run.narrativeTarget) await refreshSwipe(run.narrativeTarget.timelineId, run.narrativeTarget.branchId)
    if (!ownsRun(run)) return
    const writeRevision = narrativeWriteRevisionRef.current
    const [transcript, page] = await Promise.all([
      loadTranscript(run.api, run.sessionId, true),
      run.narrativeTarget ? run.api.narratives.getPage({ ...run.narrativeTarget, limit: 100 }) : undefined,
    ])
    if (!ownsRun(run)) return
    if (agentSessionRef.current?.id === run.sessionId) {
      publishAgentSession(transcript.session)
      setAgentTranscriptEntries(current => retainToolPresentation(current, transcript.entries))
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
    if (!ownsRun(run) || (run.status !== 'failed' && run.status !== 'cancelled' && run.status !== 'suspended')) return
    clearRunPlaceholders(run)
    if ((run.status === 'failed' || run.status === 'suspended') && error) {
      notify.providerError(error, input.t)
    }
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
        if (run.status === 'failed' || run.status === 'cancelled' || run.status === 'suspended') await refreshTerminalRun(run, error)
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
        input.logger?.warn('Agent completion acknowledgement failed; delivery expiry will release the result.', { error })
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

  function observeTaskRun(sessionId: string, runId: string) {
    if (input.api !== cardSourceRef.current.api || cardSourceRef.current.disposed
      || agentSessionRef.current?.id !== sessionId || startingRunRef.current) return
    followSessionRun(sessionId, runId)
  }

  function followSessionRun(sessionId: string, runId: string) {
    const session = agentSessionRef.current
    if (!session || session.id !== sessionId) return
    const previous = observedRunRef.current
    if (previous?.runId === runId && ownsRun(previous) && previous.observing) return
    const displayed = displayedNarrativeRef.current
    const narrativeTarget = session.timelineId === displayed.timelineId
      && displayed.timelineId && displayed.branchId
      ? { timelineId: displayed.timelineId, branchId: displayed.branchId } : undefined
    setRunRecovery(undefined)
    setActiveAgentRun({ runId, status: 'running' })
    const run: ObservedRun = {
      api: input.api, selection: agentSelectionRef.current, runId, sessionId,
      target: sessionId === primarySessionRef.current?.id ? 'narrative' : 'agent',
      narrativeTarget, streamingId: `streaming-agent-entry-${++optimisticEntryIdRef.current}`,
      cursor: 0, status: 'running', observing: false,
    }
    // Observation follows the selected Session; it does not launch or redirect execution.
    void input.runAgentAction(() => observeRun(run))
  }

  async function refreshTaskSession(sessionId: string) {
    if (input.api !== cardSourceRef.current.api || cardSourceRef.current.disposed
      || agentSessionRef.current?.id !== sessionId) return
    const run = observedRunRef.current
    if (startingRunRef.current) return
    if (run && ownsRun(run)) {
      if (run.observing) return
      // Summary status refresh must preserve the original run and its input recovery.
      await refreshRunState(run)
      return
    }
    const displayed = displayedNarrativeRef.current
    const snapshot: ObservedRun = {
      api: input.api, selection: agentSelectionRef.current, runId: '', sessionId,
      target: 'agent', streamingId: '', cursor: 0, status: 'cancelled', observing: false,
      ...(agentSessionRef.current.timelineId === displayed.timelineId && displayed.timelineId && displayed.branchId
        ? { narrativeTarget: { timelineId: displayed.timelineId, branchId: displayed.branchId } } : {}),
    }
    observedRunRef.current = snapshot
    await refreshRunState(snapshot)
    if (ownsRun(snapshot)) {
      setActiveAgentRun(undefined)
      setRunRecovery(undefined)
      observedRunRef.current = undefined
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

  async function abandonAgentRun() {
    const active = activeAgentRun
    const previous = observedRunRef.current
    if (!active || active.status !== 'suspended' || runRecoveryBusy || startingRunRef.current
      || (previous && (!ownsRun(previous) || previous.observing))) return
    const sessionId = previous?.sessionId ?? agentSessionRef.current?.id
    if (!sessionId) return
    const run: ObservedRun = previous ?? {
      api: input.api, selection: agentSelectionRef.current, runId: active.runId, sessionId,
      target: sessionId === primarySessionRef.current?.id ? 'narrative' : 'agent',
      ...(timeline && branch ? { narrativeTarget: { timelineId: timeline.id, branchId: branch.id } } : {}),
      streamingId: '', cursor: 0, status: 'suspended', observing: false,
    }
    observedRunRef.current = run
    run.observing = true
    setRunRecoveryBusy(true)
    const abandon = async () => {
      let abandoned = false
      try {
        const state = await run.api.agentSessions.runState(run.runId, run.sessionId)
        if (!ownsRun(run)) return
        if (state.state !== 'suspended') {
          run.status = state.state
          setActiveAgentRun({ runId: state.runId, status: state.state })
          if (state.state === 'running') {
            setRunRecovery(undefined)
            run.observing = false
            await observeRun(run)
            return
          }
          throw new Error(input.t?.('runRecovery.abandonNotSuspended') ?? 'The run is not suspended')
        }
        const result = await run.api.agentSessions.abandonRun(run.runId, run.sessionId)
        if (!result.accepted) throw new Error(input.t?.('runRecovery.abandonRejected') ?? 'The attempt could not be abandoned')
        abandoned = true
        run.status = 'cancelled'
        if (!ownsRun(run)) return
        setActiveAgentRun(undefined)
        setRunRecovery(undefined)
        clearRunPlaceholders(run)
        await refreshRunState(run)
      } catch (error) {
        if (ownsRun(run)) setRunRecovery({
          target: run.target, status: abandoned ? 'refresh-failed' : run.status === 'suspended' ? 'suspended' : run.status === 'running' ? 'disconnected' : 'failed',
          ...(abandoned ? { refreshFailed: true } : {}),
          error: error instanceof Error ? error.message : String(error),
        })
        throw error
      } finally {
        run.observing = false
        if (ownsRun(run)) setRunRecoveryBusy(false)
      }
    }
    if (run.target === 'narrative') await input.runAction(abandon)
    else await input.runAgentAction(abandon)
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
    if (!run || !approval) return false
    const result = await (approval.action
      ? input.api.agentSessions.approveHistoryRead
      : input.api.agentSessions.approveMutation)(run.runId, approval.requestId, allow, reason)
    if (result.accepted) {
      setActiveAgentRun(current => current?.runId === run.runId && current.approval?.requestId === approval.requestId
        ? { ...current, approval: undefined }
        : current)
    }
    return result.accepted
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
    let activated = false
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
      activated = true
    })
    return activated
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
    const targetTimeline = timeline
    const isCurrent = () => ownsCollectionSource() && !source.disposed && cardSourceRef.current === source
      && selection === agentSelectionRef.current && displayedNarrativeRef.current.timelineId === targetTimeline?.id
    if (makeMain && !targetTimeline) {
      throw new Error('请先点击“开始一个新故事”，再设置主写作对话')
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

  async function restoreAgentSession(timelineId: string | undefined, selection: number, selectedId?: string) {
    const sessions = await listAgentSessions(timelineId)
    if (selection !== agentSelectionRef.current || input.api !== cardSourceRef.current.api) return
    setAgentSessions(sessions)
    publishPrimarySession(timelineId
      ? sessions.find(item => item.id === safeLocalStorage.getItem(primaryStorageKey(timelineId)))
      : undefined)
    const selected = sessions.find(item => item.id === selectedId) ?? sessions[0]
    if (selected) {
      const transcript = await loadTranscript(input.api, selected.id, true)
      const restoredRun = await resolveSessionRun(input.api, selected.id, transcript.entries)
      if (selection !== agentSelectionRef.current || input.api !== cardSourceRef.current.api) return
      publishAgentSession(transcript.session)
      setAgentTranscriptEntries(current => retainToolPresentation(current, transcript.entries))
      setActiveAgentRun(restoredRun)
      if (restoredRun?.status === 'running') followSessionRun(selected.id, restoredRun.runId)
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

  async function activateAgentSession(sessionOrId: AgentSession | string, canActivate?: () => boolean) {
    if (canActivate && !canActivate()) return
    const sessionId = typeof sessionOrId === 'string' ? sessionOrId : sessionOrId.id
    const selection = beginAgentSelection(true)
    let activated: { session: AgentSession; branchId?: string } | undefined
    await input.runAgentAction(async () => {
      try {
        const transcript = await loadTranscript(input.api, sessionId, true)
        const timelineId = transcript.session.timelineId
        const sameNarrative = timelineId === timeline?.id && (!timelineId || Boolean(branch))
        const details = !sameNarrative && timelineId ? await input.api.narratives.get(timelineId) : undefined
        const page = !sameNarrative && timelineId
          ? await input.api.narratives.getPage({ timelineId, branchId: details?.timeline.activeBranchId, limit: 100 })
          : undefined
        const sessions = await listAgentSessions(timelineId)
        const restoredRun = await resolveSessionRun(input.api, sessionId, transcript.entries)
        if (selection !== agentSelectionRef.current || input.api !== cardSourceRef.current.api) return
        if (canActivate && !canActivate()) return
        if (!sameNarrative) {
          publishPrimarySession(timelineId
            ? sessions.find(item => item.id === safeLocalStorage.getItem(primaryStorageKey(timelineId)))
            : undefined)
          setTimeline(page?.timeline)
          setBranch(page?.branch)
          setBranches(details?.branches ?? [])
          setNodes(page?.nodes ?? [])
          setOlderCursor(page?.nextCursor)
          activateComposerDraft(page?.timeline, page?.branch)
        }
        setAgentSessions(sessions)
        publishAgentSession(transcript.session)
        setAgentTranscriptEntries(current => retainToolPresentation(current, transcript.entries))
        setActiveAgentRun(restoredRun)
        if (restoredRun?.status === 'running') followSessionRun(sessionId, restoredRun.runId)
        markAgentSessionReady(true)
        activated = { session: transcript.session, branchId: sameNarrative ? branch?.id : page?.branch.id }
      } finally {
        if (selection === agentSelectionRef.current) {
          setAgentSessionLoading(false)
          if (canActivate && !canActivate()) markAgentSessionReady(true)
        }
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
      if (input.t) notify.success(input.t('notify.success.deleted'))
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
      if (input.t) notify.success(input.t('notify.success.deleted'))
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

  const visibleActiveRun = observedRunRef.current && !ownsRun(observedRunRef.current) ? undefined : activeAgentRun
  const retainedNode = swipeDisplay?.api === input.api && swipeDisplay.timelineId === timeline?.id
    && swipeDisplay.branchId === branch?.id && nodes.at(-1)?.id === swipeDisplay.inputNodeId
    ? swipeDisplay.node : undefined
  const visibleRecovery: RunRecovery | undefined = visibleActiveRun?.status === 'suspended'
    ? { target: observedRunRef.current?.target ?? (agentSession?.id === primarySession?.id ? 'narrative' : 'agent'),
      status: 'suspended', error: visibleActiveRun.error ?? (runRecovery?.status === 'suspended' ? runRecovery.error : undefined) }
    : observedRunRef.current && ownsRun(observedRunRef.current) ? runRecovery : undefined

  return {
    swipe,
    swipeBusy: swipeBusy || Boolean(observedRunRef.current?.sessionId === primarySession?.id
      && observedRunRef.current?.observing),
    selectSwipe,
    generateSwipe,
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
    activeAgentRun: visibleActiveRun,
    runRecovery: visibleRecovery,
    runRecoveryBusy: Boolean(observedRunRef.current && ownsRun(observedRunRef.current) && runRecoveryBusy),
    canRestoreRunInput: Boolean(observedRunRef.current && ownsRun(observedRunRef.current)
      && runRecovery?.input && !runRecoveryBusy && composerInputsRef.current[runRecovery.target].length === 0),
    reconnectAgentRun,
    observeTaskRun,
    refreshTaskSession,
    abandonAgentRun,
    restoreRunInput,
    retryNarrativeInput,
    canRetryNarrativeInput: swipe ? Boolean(swipe.canGenerate && !swipe.active && !swipe.suspended && !swipeBusy
      && primarySessionRef.current && !runRecoveryBusy) : Boolean(narrativeSubmission && ownsNarrativeSubmission(narrativeSubmission)
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
    displayNodes: retainedNode ? [...nodes, retainedNode] : nodes,
    displayOnlyNodeId: retainedNode?.id,
    olderCursor,
    promptPreview,
    setAgentInput: setAgentDraft,
    setInput: setComposerDraft,
    timeline,
    activateTimeline,
    selectCardTimeline,
    activateAgentSession,
    createTimelineFromCard,
    openingChoice,
    setOpeningChoice,
    openingChanged,
    replaceOpening,
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
