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
  const [agentMessages, setAgentTranscriptEntries] = useState<AgentTranscriptEntry[]>([])
  const [agentComposerInput, setAgentComposerInput] = useState('')
  const [lastRun, setLastRun] = useState<InvokeAgentTurnResult>()
  const [promptPreview, setPromptPreview] = useState<PreviewAgentTurnResult>()
  const [composerInput, setComposerInput] = useState(input.initialInput)
  const composerDraftsRef = useRef(new Map([
    [readComposerDraftKey(undefined, undefined, input.selectedCardId), input.initialInput],
  ]))
  const agentSessionPromiseRef = useRef<Promise<AgentSession> | undefined>(undefined)
  const optimisticEntryIdRef = useRef(0)

  useEffect(() => {
    resetAgentSession()
  }, [input.selectedAgentProfileId])

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
  }, [])

  async function createTimelineFromCard() {
    if (!input.selectedCardId) return

    let activated: { branchId: string; timelineId: string } | undefined
    await input.runAction(async () => {
      const result = await input.api.narratives.create({ cardId: input.selectedCardId! })
      setTimeline(result.timeline)
      setBranch(result.branch)
      setBranches([result.branch])
      setNodes(result.nodes)
      setOlderCursor(undefined)
      resetAgentSession()
      setPromptPreview(undefined)
      setLastRun(undefined)
      activateComposerDraft(result.timeline, result.branch, composerInput)
      await refreshCardTimelines(input.selectedCardId!)
      activated = { branchId: result.branch.id, timelineId: result.timeline.id }
    })
    return activated
  }

  async function activateTimeline(timelineId: string, branchId?: string) {
    let activatedBranchId: string | undefined
    await input.runLatestAction(async context => {
      const details = await input.api.narratives.get(timelineId)
      const nextBranch = resolveNarrativeBranch(details.branches, details.timeline.activeBranchId, branchId)
      if (!nextBranch) throw new Error(`Narrative timeline ${timelineId} has no active branch`)
      const page = await input.api.narratives.getPage({ timelineId, branchId: nextBranch.id, limit: 100 })
      if (!context.isCurrent()) return
      setTimeline(page.timeline)
      setBranch(page.branch)
      setBranches(details.branches)
      setNodes(page.nodes)
      setOlderCursor(page.nextCursor)
      resetAgentSession()
      setPromptPreview(undefined)
      setLastRun(undefined)
      activateComposerDraft(page.timeline, page.branch)
      activatedBranchId = page.branch.id
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
    setPromptPreview(undefined)
    setLastRun(undefined)
    activateComposerDraft(undefined, undefined, composerInput)
  }

  async function submitTurn(event: FormEvent) {
    event.preventDefault()
    const content = composerInput.trim()
    if (content.length === 0) return undefined
    if (!timeline && !input.selectedCardId) return undefined

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
        resultActivated = { timelineId: created.timeline.id, branchId: created.branch.id }
      }

      const session = await ensureAgentSession()

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
        macroSelections: input.getMacroSelections?.(timeline?.id, branch?.id),
        narrativeTarget: {
          timelineId: currentTimeline.id,
          branchId: currentBranch.id,
          commit: true,
        },
      })
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
      setAgentSession(result.agentSession)
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
        setAgentSession(transcript.session)
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

    await input.runAgentAction(async () => {
      const session = await ensureAgentSession()
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

      setAgentSession(result.agentSession)
      setAgentTranscriptEntries(current => [
        ...current.filter(entry => entry.id !== optimisticId),
        result.entries.user,
        result.entries.assistant,
      ])
      setLastRun(result)

      try {
        const transcript = await loadTranscript(input.api, session.id)
        setAgentSession(transcript.session)
        setAgentTranscriptEntries(transcript.entries)
      } catch {
        // The persisted user and assistant entries above remain usable if the optional transcript refresh fails.
      }
    })
  }

  async function previewPrompt() {
    if (!timeline || !branch || composerInput.trim().length === 0) return

    await input.runAction(async () => {
      const session = await ensureAgentSession()
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
      setPromptPreview(result)
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

  async function ensureAgentSession(): Promise<AgentSession> {
    if (agentSession) return agentSession
    if (agentSessionPromiseRef.current) return agentSessionPromiseRef.current
    if (!input.selectedAgentProfileId) throw new Error('请先在 Agent 面板创建并选择 Agent Profile')
    const pending = (async () => {
      const created = await input.api.agentSessions.create({
        agentProfileId: input.selectedAgentProfileId!,
        timelineId: timeline?.id,
        title: input.selectedCard?.name ?? timeline?.title,
      })
      setAgentSession(created.session)
      return created.session
    })()
    agentSessionPromiseRef.current = pending
    try {
      return await pending
    } finally {
      agentSessionPromiseRef.current = undefined
    }
  }

  function resetAgentSession() {
    agentSessionPromiseRef.current = undefined
    setAgentSession(undefined)
    setAgentTranscriptEntries([])
    setAgentComposerInput('')
  }

  async function activateAgentSession(sessionOrId: AgentSession | string) {
    const sessionId = typeof sessionOrId === 'string' ? sessionOrId : sessionOrId.id
    try {
      const transcript = await loadTranscript(input.api, sessionId)
      setAgentSession(transcript.session)
      setAgentTranscriptEntries(transcript.entries)
      return transcript.session
    } catch {
      if (typeof sessionOrId !== 'string') {
        setAgentSession(sessionOrId)
        return sessionOrId
      }
      return undefined
    }
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
      if (agentSession?.id === agentSessionId) {
        resetAgentSession()
      }
    })
  }

  async function renameAgentSession(agentSessionId: string, title: string) {
    let updated: AgentSession | undefined
    await input.runAgentAction(async () => {
      const result = await input.api.agentSessions.update({ agentSessionId, title: title.trim() || undefined })
      updated = result.session
      if (agentSession?.id === agentSessionId) {
        setAgentSession(result.session)
      }
    })
    return updated
  }

  return {
    agentComposerInput,
    agentInput: agentComposerInput,
    agentMessages,
    agentSession,
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
