import type { ClientJsonValue } from '@loom-studio/client-bridge'

export type Run = {
  id: string
  status: string
  provider?: string
  model?: string
  agentProfileId?: string
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
