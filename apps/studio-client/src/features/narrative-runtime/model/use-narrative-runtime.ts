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
import type { LatestOperationContext } from '../../../shared/hooks/use-async-operations.js'

type JsonObject = { [key: string]: ClientJsonValue }

type UseNarrativeRuntimeInput = {
  getMacroSelections?: (timelineId?: string, branchId?: string) => Record<string, string>
  activationFacts?: JsonObject
  api: StudioApi
  initialInput: string
  initialNodes?: NarrativeNode[]
  selectedCard?: Card
  selectedCardId?: string
  selectedAgentProfileId?: string
  onSelectAgentProfile(id: string): void
  runAgentAction: (action: () => Promise<void>) => Promise<void>
  runAction: (action: () => Promise<void>) => Promise<void>
  runLatestAction: (action: (context: LatestOperationContext) => Promise<void>) => Promise<void>
}

export function useNarrativeRuntime(input: UseNarrativeRuntimeInput) {
  const [timeline, setTimeline] = useState<NarrativeTimeline>()
  const [branch, setBranch] = useState<NarrativeBranch>()
  const [branches, setBranches] = useState<NarrativeBranch[]>([])
  const [nodes, setNodes] = useState<NarrativeNode[]>(() => input.initialNodes ?? [])
  const [olderCursor, setOlderCursor] = useState<string>()
  const [cardTimelines, setCardTimelines] = useState<NarrativeTimeline[]>([])
  const [allTimelines, setAllTimelines] = useState<NarrativeTimeline[]>([])
  const [agentSession, setAgentSession] = useState<AgentSession>()
  const [agentSessions, setAgentSessions] = useState<AgentSession[]>([])
  const [agentSessionReady, setAgentSessionReady] = useState(true)
  const [agentSessionLoading, setAgentSessionLoading] = useState(false)
  const [agentMessages, setAgentTranscriptEntries] = useState<AgentTranscriptEntry[]>([])
  const [agentComposerInput, setAgentComposerInput] = useState('')
  const [lastRun, setLastRun] = useState<InvokeAgentTurnResult>()
  const [promptPreview, setPromptPreview] = useState<PreviewAgentTurnResult>()
  const [composerInput, setComposerInput] = useState(input.initialInput)
  const composerDraftsRef = useRef(new Map([
    [readComposerDraftKey(undefined, undefined, input.selectedCardId), input.initialInput],
  ]))
  const agentSessionPromiseRef = useRef<Promise<AgentSession> | undefined>(undefined)
  const agentSessionRef = useRef<AgentSession | undefined>(undefined)
  const agentSelectionRef = useRef(0)
  const agentSessionReadyRef = useRef(true)
  const previousProfileIdRef = useRef(input.selectedAgentProfileId)
  const optimisticEntryIdRef = useRef(0)

  useEffect(() => {
    if (previousProfileIdRef.current === input.selectedAgentProfileId) return
    const hadProfile = previousProfileIdRef.current !== undefined
    previousProfileIdRef.current = input.selectedAgentProfileId
    if (hadProfile && agentSessionRef.current?.agentProfileId !== input.selectedAgentProfileId) resetAgentSession()
  }, [input.selectedAgentProfileId])

  useEffect(() => () => { agentSelectionRef.current++ }, [])

  function setComposerDraft(value: string) {
    composerDraftsRef.current.set(readComposerDraftKey(timeline, branch, input.selectedCardId), value)
    setComposerInput(value)
  }

  function activateComposerDraft(nextTimeline: NarrativeTimeline | undefined, nextBranch: NarrativeBranch | undefined, fallback = '') {
    const key = readComposerDraftKey(nextTimeline, nextBranch, input.selectedCardId)
    const value = composerDraftsRef.current.get(key) ?? fallback
    composerDraftsRef.current.set(key, value)
    setComposerInput(value)
  }

  async function refreshCardTimelines(cardId: string) {
    const timelines: NarrativeTimeline[] = []
    let cursor: string | undefined
    do {
      const page = await input.api.narratives.list({ createdFromCardId: cardId, cursor, limit: 100 })
      timelines.push(...page.timelines)
      cursor = page.nextCursor
    } while (cursor)
    setCardTimelines(timelines)
    return timelines
  }

  async function refreshAllTimelines() {
    const timelines: NarrativeTimeline[] = []
    let cursor: string | undefined
    do {
      const page = await input.api.narratives.list({ cursor, limit: 100 })
      timelines.push(...page.timelines)
      cursor = page.nextCursor
    } while (cursor)
    setAllTimelines(timelines)
    return timelines
  }

  useEffect(() => {
    void refreshAllTimelines()
    void refreshAgentSessions()
  }, [])

  async function createTimelineFromCard(cardId = input.selectedCardId) {
    if (!cardId) return

    let activated: { branchId: string; timelineId: string } | undefined
    await input.runAction(async () => {
      const result = await input.api.narratives.create({ cardId })
      setTimeline(result.timeline)
      setBranch(result.branch)
      setBranches([result.branch])
      setNodes(result.nodes)
      setOlderCursor(undefined)
      resetAgentSession()
      setAgentSessions([])
      setPromptPreview(undefined)
      setLastRun(undefined)
      activateComposerDraft(result.timeline, result.branch, composerInput)
      await refreshCardTimelines(cardId)
      activated = { branchId: result.branch.id, timelineId: result.timeline.id }
    })
    return activated
  }

  async function activateTimeline(timelineId: string, branchId?: string) {
    let activatedBranchId: string | undefined
    const selection = beginAgentSelection()
    setAgentSessions([])
    await input.runLatestAction(async context => {
      try {
        const details = await input.api.narratives.get(timelineId)
        const nextBranch = resolveNarrativeBranch(details.branches, details.timeline.activeBranchId, branchId)
        if (!nextBranch) throw new Error(`Narrative timeline ${timelineId} has no active branch`)
        const page = await input.api.narratives.getPage({ timelineId, branchId: nextBranch.id, limit: 100 })
        if (!context.isCurrent() || selection !== agentSelectionRef.current) return
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
    return activatedBranchId
  }

  function resetToDraftTimeline() {
    setTimeline(undefined)
    setBranch(undefined)
    setBranches([])
    setNodes([])
    setOlderCursor(undefined)
    resetAgentSession()
    setAgentSessions([])
    setPromptPreview(undefined)
    setLastRun(undefined)
    activateComposerDraft(undefined, undefined, composerInput)
    void refreshAgentSessions()
  }

  async function submitTurn(event: FormEvent) {
    event.preventDefault()
    const content = composerInput.trim()
    if (content.length === 0) return undefined
    if (!timeline && !input.selectedCardId) return undefined
    if (!agentSessionReadyRef.current) return undefined

    let resultActivated: { timelineId: string; branchId: string } | undefined
    await input.runAction(async () => {
      let currentTimeline = timeline
      let currentBranch = branch
      if (!currentTimeline || !currentBranch) {
        const created = await input.api.narratives.create({ cardId: input.selectedCardId! })
        currentTimeline = created.timeline
        currentBranch = created.branch
        setTimeline(created.timeline)
        setBranch(created.branch)
        setBranches([created.branch])
        setNodes(created.nodes)
        setOlderCursor(undefined)
        resetAgentSession()
        setAgentSessions([])
        resultActivated = { timelineId: created.timeline.id, branchId: created.branch.id }
      }

      const selection = agentSelectionRef.current
      const session = await ensureAgentSession(currentTimeline)
      if (selection !== agentSelectionRef.current) return

      const optimisticNodeId = `optimistic-narrative-node-${++optimisticEntryIdRef.current}`
      const optimisticEntryId = `optimistic-agent-entry-${++optimisticEntryIdRef.current}`

      setNodes(current => {
        const lastNode = current.at(-1)
        const optimisticNode: NarrativeNode = {
          id: optimisticNodeId,
          timelineId: currentTimeline.id,
          parentNodeId: currentBranch.headNodeId ?? lastNode?.id,
          body: {
            format: 'loom-markdown.v1',
            raw: content,
          },
          createdAt: new Date().toISOString(),
        }
        return [...current, optimisticNode]
      })

      setAgentTranscriptEntries(current => {
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

      composerDraftsRef.current.delete(readComposerDraftKey(currentTimeline, currentBranch, input.selectedCardId))
      setComposerInput('')

      const result = await input.api.agentSessions.invoke({
        agentSessionId: session.id,
        input: content,
        activationFacts: input.activationFacts,
        macroSelections: input.getMacroSelections?.(currentTimeline.id, currentBranch.id),
        narrativeTarget: {
          timelineId: currentTimeline.id,
          branchId: currentBranch.id,
          commit: true,
        },
      })
      if (selection !== agentSelectionRef.current) return
      if (!result.narrative) throw new Error('Agent turn did not commit a Narrative node')

      setTimeline(result.narrative.timeline)
      setBranch(result.narrative.branch)
      setBranches(current => {
        const exists = current.some(item => item.id === result.narrative!.branch.id)
        return exists
          ? current.map(item => item.id === result.narrative!.branch.id ? result.narrative!.branch : item)
          : [...current, result.narrative!.branch]
      })
      setNodes(current => [
        ...current.filter(item => item.id !== optimisticNodeId),
        ...result.narrative!.nodes,
      ])
      publishAgentSession(result.agentSession)
      setAgentTranscriptEntries(current => [
        ...current.filter(item => item.id !== optimisticEntryId),
        result.entries.user,
        result.entries.assistant,
      ])
      setLastRun(result)
      setPromptPreview(undefined)
      if (currentTimeline.createdFrom?.cardId) await refreshCardTimelines(currentTimeline.createdFrom.cardId)

      try {
        const transcript = await loadTranscript(input.api, session.id)
        if (selection !== agentSelectionRef.current) return
        publishAgentSession(transcript.session)
        setAgentTranscriptEntries(transcript.entries)
      } catch {
        // The persisted user and assistant entries above remain usable if the optional transcript refresh fails.
      }
    })
    return resultActivated
  }

  async function submitAgentTurn(event: FormEvent) {
    event.preventDefault()
    const content = agentComposerInput.trim()
    if (!content || !input.selectedAgentProfileId) return
    if (!agentSessionReadyRef.current) return

    await input.runAgentAction(async () => {
      const selection = agentSelectionRef.current
      const session = await ensureAgentSession()
      if (selection !== agentSelectionRef.current) return
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
      setAgentComposerInput('')

      const result = await input.api.agentSessions.invoke({
        agentSessionId: session.id,
        input: content,
        macroSelections: input.getMacroSelections?.(timeline?.id, branch?.id),
      })

      if (selection !== agentSelectionRef.current) return
      publishAgentSession(result.agentSession)
      setAgentTranscriptEntries(current => [
        ...current.filter(entry => entry.id !== optimisticId),
        result.entries.user,
        result.entries.assistant,
      ])
      setLastRun(result)

      try {
        const transcript = await loadTranscript(input.api, session.id)
        if (selection !== agentSelectionRef.current) return
        publishAgentSession(transcript.session)
        setAgentTranscriptEntries(transcript.entries)
      } catch {
        // The persisted user and assistant entries above remain usable if the optional transcript refresh fails.
      }
    })
  }

  async function previewPrompt() {
    if (!timeline || !branch || composerInput.trim().length === 0) return
    if (!agentSessionReadyRef.current) return

    await input.runAction(async () => {
      const selection = agentSelectionRef.current
      const session = await ensureAgentSession()
      if (selection !== agentSelectionRef.current) return
      const result = await input.api.agentSessions.preview({
        agentSessionId: session.id,
        input: composerInput,
        activationFacts: input.activationFacts,
        macroSelections: input.getMacroSelections?.(timeline?.id, branch?.id),
        narrativeTarget: {
          timelineId: timeline.id,
          branchId: branch.id,
          commit: false,
        },
      })
      if (selection === agentSelectionRef.current) setPromptPreview(result)
    })
  }

  async function forkFromNode(node: NarrativeNode) {
    if (!timeline || !branch) return

    let activated: { branchId: string; timelineId: string } | undefined
    await input.runAction(async () => {
      const forked = await input.api.narratives.fork({
        timelineId: timeline.id,
        fromBranchId: branch.id,
        fromNodeId: node.id,
        title: `Fork ${node.id.slice(0, 8)}`,
      })
      const switched = await input.api.narratives.switch({
        timelineId: timeline.id,
        branchId: forked.branch.id,
        expectedActiveBranchId: timeline.activeBranchId,
      })
      const page = await input.api.narratives.getPage({ timelineId: timeline.id, branchId: forked.branch.id, limit: 100 })
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

    await input.runAction(async () => {
      const switched = await input.api.narratives.switch({
        timelineId: timeline.id,
        branchId: nextBranch.id,
        expectedActiveBranchId: timeline.activeBranchId,
      })
      const page = await input.api.narratives.getPage({ timelineId: timeline.id, branchId: nextBranch.id, limit: 100 })
      setTimeline(switched.timeline)
      setBranch(page.branch)
      setNodes(page.nodes)
      setOlderCursor(page.nextCursor)
      setPromptPreview(undefined)
      setLastRun(undefined)
      activateComposerDraft(switched.timeline, page.branch)
    })
  }

  async function loadOlderNodes() {
    if (!timeline || !branch || !olderCursor) return
    await input.runAction(async () => {
      const page = await input.api.narratives.getPage({
        timelineId: timeline.id,
        branchId: branch.id,
        cursor: olderCursor,
        limit: 100,
      })
      setNodes(current => [...page.nodes, ...current])
      setOlderCursor(page.nextCursor)
    })
  }

  function editNarrativeNode(nodeId: string, raw: string) {
    // ponytail: Narrative Node 是 append-only；正式编辑需要先定义 replacement/fork 语义，当前仅保留未持久化的视觉草稿能力。
    setNodes(current => current.map(node => node.id === nodeId ? { ...node, body: { ...node.body, raw } } : node))
  }

  async function ensureAgentSession(targetTimeline = timeline): Promise<AgentSession> {
    if (!agentSessionReadyRef.current) throw new Error('Agent Session is not ready')
    const current = agentSessionRef.current
    if (current && current.timelineId === targetTimeline?.id && current.agentProfileId === input.selectedAgentProfileId) return current
    if (agentSessionPromiseRef.current) return agentSessionPromiseRef.current
    if (!input.selectedAgentProfileId) throw new Error('请先在 Agent 面板创建并选择 Agent Profile')
    const selection = agentSelectionRef.current
    const pending = (async () => {
      const created = await input.api.agentSessions.create({
        agentProfileId: input.selectedAgentProfileId!,
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

  function publishAgentSession(session: AgentSession) {
    agentSessionRef.current = session
    setAgentSession(session)
    setAgentSessions(current => [session, ...current.filter(item => item.id !== session.id)]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id)))
  }

  function markAgentSessionReady(ready: boolean) {
    agentSessionReadyRef.current = ready
    setAgentSessionReady(ready)
  }

  function resetAgentSession() {
    agentSelectionRef.current++
    agentSessionPromiseRef.current = undefined
    agentSessionRef.current = undefined
    setAgentSession(undefined)
    setAgentTranscriptEntries([])
    setAgentComposerInput('')
    setAgentSessionLoading(false)
    markAgentSessionReady(true)
    setLastRun(undefined)
    setPromptPreview(undefined)
  }

  function beginAgentSelection() {
    resetAgentSession()
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
    if (selection !== agentSelectionRef.current) return
    setAgentSessions(sessions)
    const selected = sessions.find(item => item.id === selectedId) ?? sessions[0]
    if (selected) {
      const transcript = await loadTranscript(input.api, selected.id)
      if (selection !== agentSelectionRef.current) return
      publishAgentSession(transcript.session)
      setAgentTranscriptEntries(transcript.entries)
      input.onSelectAgentProfile(transcript.session.agentProfileId)
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

  async function activateAgentSession(sessionOrId: AgentSession | string) {
    const sessionId = typeof sessionOrId === 'string' ? sessionOrId : sessionOrId.id
    const selection = beginAgentSelection()
    let activated: AgentSession | undefined
    await input.runAgentAction(async () => {
      try {
        const transcript = await loadTranscript(input.api, sessionId)
        const timelineId = transcript.session.timelineId
        const details = timelineId ? await input.api.narratives.get(timelineId) : undefined
        const targetBranchId = timelineId === timeline?.id ? branch?.id : details?.timeline.activeBranchId
        const page = timelineId ? await input.api.narratives.getPage({ timelineId, branchId: targetBranchId, limit: 100 }) : undefined
        const sessions = await listAgentSessions(timelineId)
        if (selection !== agentSelectionRef.current) return
        setTimeline(page?.timeline)
        setBranch(page?.branch)
        setBranches(details?.branches ?? [])
        setNodes(page?.nodes ?? [])
        setOlderCursor(page?.nextCursor)
        activateComposerDraft(page?.timeline, page?.branch)
        setAgentSessions(sessions)
        publishAgentSession(transcript.session)
        setAgentTranscriptEntries(transcript.entries)
        input.onSelectAgentProfile(transcript.session.agentProfileId)
        markAgentSessionReady(true)
        activated = transcript.session
      } finally {
        if (selection === agentSelectionRef.current) setAgentSessionLoading(false)
      }
    })
    return activated
  }

  async function deleteTimeline(timelineId: string) {
    await input.runAction(async () => {
      await input.api.narratives.delete(timelineId)
      if (timeline?.id === timelineId) {
        resetToDraftTimeline()
      }
      await refreshAllTimelines()
      if (input.selectedCardId) {
        await refreshCardTimelines(input.selectedCardId)
      }
    })
  }

  async function renameTimeline(timelineId: string, title: string) {
    let updated: NarrativeTimeline | undefined
    await input.runAction(async () => {
      const result = await input.api.narratives.update({ timelineId, title: title.trim() || undefined })
      updated = result.timeline
      if (timeline?.id === timelineId) {
        setTimeline(result.timeline)
      }
      await refreshAllTimelines()
      if (input.selectedCardId) {
        await refreshCardTimelines(input.selectedCardId)
      }
    })
    return updated
  }

  async function deleteAgentSession(agentSessionId: string) {
    await input.runAgentAction(async () => {
      await input.api.agentSessions.delete(agentSessionId)
      setAgentSessions(current => current.filter(item => item.id !== agentSessionId))
      if (agentSessionRef.current?.id === agentSessionId) {
        resetAgentSession()
      }
    })
  }

  async function renameAgentSession(agentSessionId: string, title: string) {
    let updated: AgentSession | undefined
    await input.runAgentAction(async () => {
      const result = await input.api.agentSessions.update({ agentSessionId, title: title.trim() || undefined })
      updated = result.session
      if (agentSessionRef.current?.id === agentSessionId) {
        publishAgentSession(result.session)
      } else {
        setAgentSessions(current => current.map(item => item.id === agentSessionId ? result.session : item))
      }
    })
    return updated
  }

  return {
    agentComposerInput,
    agentInput: agentComposerInput,
    agentMessages,
    agentSession,
    agentSessions,
    agentSessionReady,
    agentSessionLoading,
    newAgentSession: resetAgentSession,
    refreshAgentSessions: () => refreshAgentSessions(timeline?.id),
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
    setAgentInput: setAgentComposerInput,
    setInput: setComposerDraft,
    timeline,
    activateTimeline,
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

export function resolveNarrativeBranch(branches: NarrativeBranch[], activeBranchId: string, requestedBranchId?: string): NarrativeBranch | undefined {
  return (requestedBranchId ? branches.find(branch => branch.id === requestedBranchId) : undefined)
    ?? branches.find(branch => branch.id === activeBranchId)
}

export function readComposerDraftKey(
  timeline: NarrativeTimeline | undefined,
  branch: NarrativeBranch | undefined,
  selectedCardId?: string,
): string {
  if (timeline) return `${timeline.id}:${branch?.id ?? 'unbound'}`
  return `card:${selectedCardId ?? 'unbound'}`
}
