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

  async function submitTurn(event: FormEvent) {
    event.preventDefault()
    if (!timeline || !branch || composerInput.trim().length === 0) return

    await input.runAction(async () => {
      const session = await ensureAgentSession()
      const result = await input.api.agentSessions.invoke({
        agentSessionId: session.id,
        input: composerInput,
        activationFacts: input.activationFacts,
        narrativeTarget: {
          timelineId: timeline.id,
          branchId: branch.id,
          commit: true,
        },
      })
      if (!result.narrative) throw new Error('Agent turn did not commit a Narrative node')
      setTimeline(result.narrative.timeline)
      setBranch(result.narrative.branch)
      setBranches(current => current.map(item => item.id === result.narrative!.branch.id ? result.narrative!.branch : item))
      setNodes(current => [...current, ...result.narrative!.nodes])
      setAgentSession(result.agentSession)
      setAgentTranscriptEntries(current => [...current, result.entries.user, result.entries.assistant])
      setLastRun(result)
      setPromptPreview(undefined)
      composerDraftsRef.current.delete(readComposerDraftKey(timeline, branch, input.selectedCardId))
      setComposerInput('')
      if (timeline.createdFrom?.cardId) await refreshCardTimelines(timeline.createdFrom.cardId)
    })
  }

  async function submitAgentTurn(event: FormEvent) {
    event.preventDefault()
    const content = agentComposerInput.trim()
    if (!content || !input.selectedAgentProfileId) return

    await input.runAgentAction(async () => {
      const session = await ensureAgentSession()
      const optimisticId = `optimistic-agent-entry-${++optimisticEntryIdRef.current}`
      const optimisticEntry: AgentTranscriptEntry = {
        id: optimisticId,
        agentSessionId: session.id,
        parentEntryId: agentMessages.at(-1)?.id,
        sequence: (agentMessages.at(-1)?.sequence ?? 0) + 1,
        entry: { kind: 'message', role: 'user', content },
        createdAt: new Date().toISOString(),
      }
      setAgentTranscriptEntries(current => [...current, optimisticEntry])
      setAgentComposerInput('')

      let result: InvokeAgentTurnResult
      try {
        result = await input.api.agentSessions.invoke({
          agentSessionId: session.id,
          input: content,
        })
      } catch (error) {
        setAgentTranscriptEntries(current => current.filter(entry => entry.id !== optimisticId))
        setAgentComposerInput(current => current || content)
        throw error
      }

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

  return {
    agentMessages,
    agentInput: agentComposerInput,
    agentSession,
    branch,
    branches,
    cardTimelines,
    editNarrativeNode,
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
    createTimelineFromCard,
    forkFromNode,
    previewPrompt,
    refreshCardTimelines,
    submitAgentTurn,
    submitTurn,
    switchBranch,
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
