import type { JsonObject } from './common.js'

export type Session = {
  id: string
  version: number
  title?: string
  agentRuntimeProfileId?: string
  workspaceId?: string
  activeBranchId: string
  cardSourceVersionId: string
  cardSnapshot: JsonObject
}

export type Branch = {
  id: string
  version: number
  title?: string
  headEntryId?: string
  forkedFromEntryId?: string
}

export type SessionDetails = {
  session: Session
  branches: Branch[]
}

export type CreateSessionResult = {
  session: Session
  branch: Branch
}

export type ForkBranchResult = {
  branch: Branch
  session: Session
}
