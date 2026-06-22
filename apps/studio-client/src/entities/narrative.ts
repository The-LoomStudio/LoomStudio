import type { Branch, Session } from './session.js'

export type NarrativeEntry = {
  id: string
  version: number
  role: 'user' | 'assistant'
  content: string
  branchId: string
  parentEntryId?: string
  runId?: string
}

export type Timeline = {
  session: Session
  branch: Branch
  entries: NarrativeEntry[]
}
