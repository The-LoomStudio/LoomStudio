import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { AgentMessage, AgentSession } from '../../../entities/index.js'
import { toClientJsonObject } from '../../../shared/api/client-json-object.js'
import type { StudioApi } from '../../../shared/api/studio-api.js'

type UseAgentChatRuntimeInput = {
  api: StudioApi
  selectedAgentProfileId?: string
  selectedAgentProfileName?: string
  runAction(action: () => Promise<void>): Promise<void>
}

export function useAgentChatRuntime(input: UseAgentChatRuntimeInput) {
  const [session, setSession] = useState<AgentSession>()
  const [messages, setMessages] = useState<AgentMessage[]>([])
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
      const result = await input.api.agentSessions.invoke(toClientJsonObject({
        agentSessionId: activeSession.id,
        input: content,
      }))
      if (profileGenerationRef.current !== generation) return
      setSession(result.agentSession)
      setMessages(current => [...current, result.messages.user, result.messages.assistant])
      setComposerInput('')
    })
  }

  async function ensureSession(profileId: string, generation: number): Promise<AgentSession> {
    if (session?.agentProfileId === profileId) return session
    if (sessionPromiseRef.current?.profileId === profileId) return sessionPromiseRef.current.promise

    const promise = input.api.agentSessions.create(toClientJsonObject({
      agentProfileId: profileId,
      ...(input.selectedAgentProfileName ? { title: input.selectedAgentProfileName } : {}),
    })).then(result => {
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
