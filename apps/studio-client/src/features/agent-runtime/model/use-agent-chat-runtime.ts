import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { AgentTranscriptEntry, AgentSession } from '../../../entities/index.js'
import type { StudioApi } from '../../../shared/api/studio-api.js'

type UseAgentChatRuntimeInput = {
  api: StudioApi
  selectedAgentProfileId?: string
  selectedAgentProfileName?: string
  runAction(action: () => Promise<void>): Promise<void>
}

export function useAgentChatRuntime(input: UseAgentChatRuntimeInput) {
  const [session, setSession] = useState<AgentSession>()
  const [messages, setMessages] = useState<AgentTranscriptEntry[]>([])
  const [composerInput, setComposerInput] = useState('')
  const profileGenerationRef = useRef(0)
  const sessionPromiseRef = useRef<{ profileId: string; promise: Promise<AgentSession> } | undefined>(undefined)

  useEffect(() => {
    profileGenerationRef.current += 1
    sessionPromiseRef.current = undefined
    setSession(undefined)
    setMessages([])
    setComposerInput('')
  }, [input.selectedAgentProfileId])

  async function submitTurn(event: FormEvent) {
    event.preventDefault()
    const content = composerInput.trim()
    const profileId = input.selectedAgentProfileId
    if (!content || !profileId) return
    const generation = profileGenerationRef.current

    await input.runAction(async () => {
      const activeSession = await ensureSession(profileId, generation)
      await input.api.agentSessions.invoke({
        agentSessionId: activeSession.id,
        input: content,
      })
      if (profileGenerationRef.current !== generation) return
      const transcript = await loadTranscript(input.api, activeSession.id)
      if (profileGenerationRef.current !== generation) return
      setSession(transcript.session)
      setMessages(transcript.entries)
      setComposerInput('')
    })
  }

  async function ensureSession(profileId: string, generation: number): Promise<AgentSession> {
    if (session?.agentProfileId === profileId) return session
    if (sessionPromiseRef.current?.profileId === profileId) return sessionPromiseRef.current.promise

    const promise = input.api.agentSessions.create({
      agentProfileId: profileId,
      ...(input.selectedAgentProfileName ? { title: input.selectedAgentProfileName } : {}),
    }).then(result => {
      if (profileGenerationRef.current === generation) setSession(result.session)
      return result.session
    })
    sessionPromiseRef.current = { profileId, promise }
    try {
      return await promise
    } finally {
      if (sessionPromiseRef.current?.promise === promise) sessionPromiseRef.current = undefined
    }
  }

  return {
    input: composerInput,
    messages,
    session,
    setInput: setComposerInput,
    submitTurn,
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
