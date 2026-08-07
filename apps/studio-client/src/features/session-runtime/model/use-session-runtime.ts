import type { ClientJsonValue } from '@loom-studio/client-bridge'
import { useRef, useState, type FormEvent } from 'react'
import { toClientJsonObject } from '../../../shared/api/client-json-object.js'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import type { LatestOperationContext } from '../../../shared/hooks/use-async-operations.js'
import type {
  AgentTranscriptEntry,
  Branch,
  NarrativeEntry,
  PromptPreview,
  RunDetails,
  Session,
} from '../../../entities/index.js'

type JsonObject = { [key: string]: ClientJsonValue }

type UseSessionRuntimeInput = {
  activationFacts?: JsonObject
  api: StudioApi
  initialInput: string
  initialTimeline?: NarrativeEntry[]
  selectedCardId?: string
  selectedAgentRuntimeProfileId?: string
  runAction: (action: () => Promise<void>) => Promise<void>
  runLatestAction: (action: (context: LatestOperationContext) => Promise<void>) => Promise<void>
  readProjectionOrderProfile(session: Session | undefined): ClientJsonValue | undefined
}

export function useSessionRuntime(input: UseSessionRuntimeInput) {
  const [session, setSession] = useState<Session>()
  const [branch, setBranch] = useState<Branch>()
  const [branches, setBranches] = useState<Branch[]>([])
  const [timeline, setTimeline] = useState<NarrativeEntry[]>(() => input.initialTimeline ?? [])
  const [agentTranscript, setAgentTranscript] = useState<AgentTranscriptEntry[]>([])
  const [runDetails, setRunDetails] = useState<RunDetails>()
  const [promptPreview, setPromptPreview] = useState<PromptPreview>()
  const [composerInput, setComposerInput] = useState(input.initialInput)
  const composerDraftsRef = useRef(new Map([
    [readComposerDraftKey(undefined, undefined, input.selectedCardId), input.initialInput],
  ]))

  function setComposerDraft(value: string) {
    composerDraftsRef.current.set(readComposerDraftKey(session, branch, input.selectedCardId), value)
    setComposerInput(value)
  }

  function activateComposerDraft(nextSession: Session | undefined, nextBranch: Branch | undefined, fallback = '') {
    const key = readComposerDraftKey(nextSession, nextBranch, input.selectedCardId)
    const value = composerDraftsRef.current.get(key) ?? fallback
    composerDraftsRef.current.set(key, value)
    setComposerInput(value)
  }

  async function createSessionFromCard() {
    if (!input.selectedCardId) return

    let activated: { branchId: string; sessionId: string } | undefined
    await input.runAction(async () => {
      const result = await input.api.sessions.createFromCard(toClientJsonObject({
        cardId: input.selectedCardId,
        agentRuntimeProfileId: input.selectedAgentRuntimeProfileId,
      }))
      setSession(result.session)
      setBranch(result.branch)
      setBranches([result.branch])
      setTimeline([])
      setAgentTranscript([])
      setRunDetails(undefined)
      setPromptPreview(undefined)
      await refreshTimeline(result.session.id, result.branch.id)
      activateComposerDraft(result.session, result.branch, composerInput)
      await refreshAgentTranscript(result.session.id, result.branch.id)
      await refreshSession(result.session.id)
      activated = { branchId: result.branch.id, sessionId: result.session.id }
    })
    return activated
  }

  async function submitTurn(event: FormEvent) {
    event.preventDefault()
    if (!session || composerInput.trim().length === 0) return

    await input.runAction(async () => {
      const result = await input.api.turns.submit(toClientJsonObject({
        sessionId: session.id,
        branchId: branch?.id,
        agentRuntimeProfileId: input.selectedAgentRuntimeProfileId,
        input: composerInput,
        projectionOrderProfile: input.readProjectionOrderProfile(session),
        activationFacts: input.activationFacts,
      }))
      setBranch(result.branch)
      composerDraftsRef.current.delete(readComposerDraftKey(session, branch, input.selectedCardId))
      composerDraftsRef.current.delete(readComposerDraftKey(session, result.branch, input.selectedCardId))
      setComposerInput('')
      setPromptPreview(undefined)
      await refreshTimeline(session.id, result.branch.id)
      await refreshAgentTranscript(session.id, result.branch.id)
      await refreshSession(session.id)
      await refreshRun(result.run.id)
    })
  }

  async function previewPrompt() {
    if (!session || !branch || composerInput.trim().length === 0) return

    await input.runAction(async () => {
      const result = await input.api.prompt.preview(toClientJsonObject({
        sessionId: session.id,
        branchId: branch.id,
        agentRuntimeProfileId: input.selectedAgentRuntimeProfileId,
        input: composerInput,
        projectionOrderProfile: input.readProjectionOrderProfile(session),
        activationFacts: input.activationFacts,
      }))
      setPromptPreview(result)
    })
  }

  async function forkFromEntry(entry: NarrativeEntry) {
    if (!session) return

    let activated: { branchId: string; sessionId: string } | undefined
    await input.runAction(async () => {
      const result = await input.api.sessions.fork({
        sessionId: session.id,
        fromEntryId: entry.id,
        title: `Fork ${entry.id.slice(0, 8)}`,
      })
      setSession(result.session)
      setBranch(result.branch)
      setRunDetails(undefined)
      setPromptPreview(undefined)
      await refreshTimeline(result.session.id, result.branch.id)
      activateComposerDraft(result.session, result.branch)
      await refreshAgentTranscript(result.session.id, result.branch.id)
      await refreshSession(result.session.id)
      activated = { branchId: result.branch.id, sessionId: result.session.id }
    })
    return activated
  }

  async function switchBranch(nextBranch: Branch) {
    if (!session || nextBranch.id === branch?.id) return

    await input.runAction(async () => {
      setRunDetails(undefined)
      setPromptPreview(undefined)
      await refreshTimeline(session.id, nextBranch.id)
      activateComposerDraft(session, nextBranch)
      await refreshAgentTranscript(session.id, nextBranch.id)
      await refreshSession(session.id)
    })
  }

  async function switchBranchById(branchId: string) {
    const nextBranch = readBranchById(branches, branchId)
    if (!nextBranch) return
    await switchBranch(nextBranch)
  }

  async function refreshSession(sessionId: string) {
    const result = await input.api.sessions.get(sessionId)
    setSession(result.session)
    setBranches(result.branches)
  }

  async function activateSession(sessionId: string, branchId?: string) {
    let activatedBranchId: string | undefined
    await input.runLatestAction(async context => {
      const details = await input.api.sessions.get(sessionId)
      const nextBranch = resolveSessionBranch(details.branches, details.session.activeBranchId, branchId)
      if (!nextBranch) throw new Error(`Session ${sessionId} has no active branch`)

      const [nextTimeline, nextTranscript] = await Promise.all([
        input.api.timeline.get(toClientJsonObject({ sessionId, branchId: nextBranch.id })),
        input.api.agentTranscript.get(toClientJsonObject({ sessionId, branchId: nextBranch.id })),
      ])
      if (!context.isCurrent()) return

      setSession(nextTimeline.session)
      setBranch(nextTimeline.branch)
      setBranches(details.branches)
      setTimeline(nextTimeline.entries)
      setAgentTranscript(nextTranscript.entries)
      setRunDetails(undefined)
      setPromptPreview(undefined)
      activateComposerDraft(details.session, nextBranch)
      activatedBranchId = nextBranch.id
    })
    return activatedBranchId
  }

  async function refreshTimeline(sessionId: string, branchId?: string) {
    const result = await input.api.timeline.get(toClientJsonObject({
      sessionId,
      branchId,
    }))
    setSession(result.session)
    setBranch(result.branch)
    setTimeline(result.entries)
  }

  function editTimelineEntry(entryId: string, content: string) {
    // ponytail: 后端尚未提供 NarrativeEntry update RPC；当前只支持会话内编辑，RPC 落地后在此提交并刷新 timeline。
    setTimeline(current => current.map(entry => entry.id === entryId ? { ...entry, content } : entry))
  }

  async function refreshAgentTranscript(sessionId: string, branchId?: string) {
    const result = await input.api.agentTranscript.get(toClientJsonObject({
      sessionId,
      branchId,
    }))
    setAgentTranscript(result.entries)
  }

  async function refreshRun(runId: string) {
    const result = await input.api.runs.get(runId)
    setRunDetails(result)
  }

  return {
    session,
    branch,
    branches,
    timeline,
    agentTranscript,
    runDetails,
    promptPreview,
    input: composerInput,
    setInput: setComposerDraft,
    createSessionFromCard,
    activateSession,
    submitTurn,
    previewPrompt,
    forkFromEntry,
    switchBranch,
    switchBranchById,
    refreshSession,
    refreshTimeline,
    editTimelineEntry,
    refreshAgentTranscript,
    refreshRun,
  }
}

export function readBranchById(branches: Branch[], branchId: string): Branch | undefined {
  return branches.find(branch => branch.id === branchId)
}

export function resolveSessionBranch(branches: Branch[], activeBranchId: string, requestedBranchId?: string): Branch | undefined {
  return (requestedBranchId ? readBranchById(branches, requestedBranchId) : undefined)
    ?? readBranchById(branches, activeBranchId)
}

export function readComposerDraftKey(session: Session | undefined, branch: Branch | undefined, selectedCardId?: string): string {
  if (session) return `${session.id}:${branch?.id ?? 'unbound'}`
  return `card:${selectedCardId ?? 'unbound'}`
}
