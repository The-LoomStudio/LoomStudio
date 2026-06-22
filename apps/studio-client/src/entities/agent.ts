import type { Branch, Session } from './session.js'

export type AgentTranscriptEntry = {
  id: string
  version: number
  role: 'user' | 'assistant'
  content: string
  parentTranscriptEntryId?: string
  narrativeEntryId: string
  runId?: string
  source: string
}

export type AgentTranscript = {
  session: Session
  branch: Branch
  entries: AgentTranscriptEntry[]
}
