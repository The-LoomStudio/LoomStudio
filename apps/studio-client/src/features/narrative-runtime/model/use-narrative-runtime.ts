import type { ClientJsonValue } from '@loom-studio/client-bridge'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import type {
  AgentMessage,
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
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([])
  const [lastRun, setLastRun] = useState<InvokeAgentTurnResult>()
  const [promptPreview, setPromptPreview] = useState<PreviewAgentTurnResult>()
  const [composerInput, setComposerInput] = useState(input.initialInput)
  const composerDraftsRef = useRef(new Map([
    [readComposerDraftKey(undefined, undefined, input.selectedCardId), input.initialInput],
  ]))
  const agentSessionPromiseRef = useRef<Promise<AgentSession> | undefined>(undefined)

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
      const result = await input.api.narratives.createFromCard({ cardId: input.selectedCardId! })
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
      setNodes(current => [...current, result.narrative!.node])
      setAgentSession(result.agentSession)
      setAgentMessages(current => [...current, result.messages.user, result.messages.assistant])
      setLastRun(result)
      setPromptPreview(undefined)
      composerDraftsRef.current.delete(readComposerDraftKey(timeline, branch, input.selectedCardId))
      setComposerInput('')
      if (timeline.createdFrom?.cardId) await refreshCardTimelines(timeline.createdFrom.cardId)
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
    setAgentMessages([])
  }

  return {
    agentMessages,
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
    setInput: setComposerDraft,
    timeline,
    activateTimeline,
    createTimelineFromCard,
    forkFromNode,
    previewPrompt,
    refreshCardTimelines,
    submitTurn,
    switchBranch,
  }
}

export function readNarrativeBranchById(branches: NarrativeBranch[], branchId: string): NarrativeBranch | undefined {
  return branches.find(branch => branch.id === branchId)
}

export function resolveNarrativeBranch(branches: NarrativeBranch[], activeBranchId: string, requestedBranchId?: string): NarrativeBranch | undefined {
  return (requestedBranchId ? readNarrativeBranchById(branches, requestedBranchId) : undefined)
    ?? readNarrativeBranchById(branches, activeBranchId)
}

export function readComposerDraftKey(
  timeline: NarrativeTimeline | undefined,
  branch: NarrativeBranch | undefined,
  selectedCardId?: string,
): string {
  if (timeline) return `${timeline.id}:${branch?.id ?? 'unbound'}`
  return `card:${selectedCardId ?? 'unbound'}`
}
