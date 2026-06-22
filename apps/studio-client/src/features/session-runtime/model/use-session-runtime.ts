import type { ClientJsonValue } from '@loom-studio/client-bridge'
import { useState, type FormEvent } from 'react'
import type { StudioApi } from '../../../shared/api/studio-api.js'
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
  api: StudioApi
  initialInput: string
  selectedCardId?: string
  selectedAgentRuntimeProfileId?: string
  runAction: (action: () => Promise<void>) => Promise<void>
  readProjectionOrderProfile(session: Session | undefined): ClientJsonValue | undefined
}

export function useSessionRuntime(input: UseSessionRuntimeInput) {
  const [session, setSession] = useState<Session>()
  const [branch, setBranch] = useState<Branch>()
  const [branches, setBranches] = useState<Branch[]>([])
  const [timeline, setTimeline] = useState<NarrativeEntry[]>([])
  const [agentTranscript, setAgentTranscript] = useState<AgentTranscriptEntry[]>([])
  const [runDetails, setRunDetails] = useState<RunDetails>()
  const [promptPreview, setPromptPreview] = useState<PromptPreview>()
  const [composerInput, setComposerInput] = useState(input.initialInput)

  async function createSessionFromCard() {
    if (!input.selectedCardId) return

    await input.runAction(async () => {
      const result = await input.api.sessions.createFromCard(jsonObject({
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
      await refreshAgentTranscript(result.session.id, result.branch.id)
      await refreshSession(result.session.id)
    })
  }

  async function submitTurn(event: FormEvent) {
    event.preventDefault()
    if (!session || composerInput.trim().length === 0) return

    await input.runAction(async () => {
      const result = await input.api.turns.submit(jsonObject({
        sessionId: session.id,
        branchId: branch?.id,
        agentRuntimeProfileId: input.selectedAgentRuntimeProfileId,
        input: composerInput,
        projectionOrderProfile: input.readProjectionOrderProfile(session),
      }))
      setBranch(result.branch)
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
      const result = await input.api.prompt.preview(jsonObject({
        sessionId: session.id,
        branchId: branch.id,
        input: composerInput,
        projectionOrderProfile: input.readProjectionOrderProfile(session),
      }))
      setPromptPreview(result)
    })
  }

  async function forkFromEntry(entry: NarrativeEntry) {
    if (!session) return

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
      await refreshAgentTranscript(result.session.id, result.branch.id)
      await refreshSession(result.session.id)
    })
  }

  async function switchBranch(nextBranch: Branch) {
    if (!session || nextBranch.id === branch?.id) return

    await input.runAction(async () => {
      setRunDetails(undefined)
      setPromptPreview(undefined)
      await refreshTimeline(session.id, nextBranch.id)
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

  async function refreshTimeline(sessionId: string, branchId?: string) {
    const result = await input.api.timeline.get(jsonObject({
      sessionId,
      branchId,
    }))
    setSession(result.session)
    setBranch(result.branch)
    setTimeline(result.entries)
  }

  async function refreshAgentTranscript(sessionId: string, branchId?: string) {
    const result = await input.api.agentTranscript.get(jsonObject({
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
    setInput: setComposerInput,
    createSessionFromCard,
    submitTurn,
    previewPrompt,
    forkFromEntry,
    switchBranch,
    switchBranchById,
    refreshSession,
    refreshTimeline,
    refreshAgentTranscript,
    refreshRun,
  }
}

export function readBranchById(branches: Branch[], branchId: string): Branch | undefined {
  return branches.find(branch => branch.id === branchId)
}

function jsonObject(value: Record<string, ClientJsonValue | undefined>): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as JsonObject
}
