import type { ClientJsonValue } from '@loom-studio/client-bridge'
import type { Branch } from './session.js'
import type { NarrativeEntry } from './narrative.js'

export type Run = {
  id: string
  status: string
  provider?: string
  model?: string
  agentRuntimeProfileId?: string
  modelProfileId?: string
  acceptedEntryId?: string
}

export type RuntimeEntry = {
  id: string
  kind: string
  content: ClientJsonValue
}

export type CommitCandidate = {
  id: string
  status: string
  content: string
  acceptedEntryId?: string
}

export type RunDetails = {
  run: Run
  runtimeEntries: RuntimeEntry[]
  commitCandidates: CommitCandidate[]
}

export type SubmitTurnResult = {
  run: Run
  branch: Branch
  entries: {
    user: NarrativeEntry
    assistant: NarrativeEntry
  }
}
