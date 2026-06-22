import type { JsonObject } from './common.js'

export type ProviderAccount = {
  id: string
  version: number
  providerExtensionId: string
  displayName: string
  config: JsonObject
  secretRefs: Record<string, string>
  createdAt: string
  updatedAt: string
}

export type ModelProfile = {
  id: string
  version: number
  providerAccountId: string
  capability: string
  displayName: string
  providerModelId: string
  config: JsonObject
  createdAt: string
  updatedAt: string
}

export type AgentRuntimeProfile = {
  id: string
  version: number
  name: string
  purpose: string
  presetId?: string
  modelProfileId?: string
  createdAt: string
  updatedAt: string
}

export type CreateProviderAccountResult = {
  providerAccount: ProviderAccount
}

export type ListProviderAccountsResult = {
  providerAccounts: ProviderAccount[]
  nextCursor?: string
}

export type UpdateProviderAccountResult = {
  providerAccount: ProviderAccount
}

export type DeleteProviderAccountResult = {
  deleted: true
}

export type CreateModelProfileResult = {
  modelProfile: ModelProfile
}

export type ListModelProfilesResult = {
  modelProfiles: ModelProfile[]
  nextCursor?: string
}

export type UpdateModelProfileResult = {
  modelProfile: ModelProfile
}

export type DeleteModelProfileResult = {
  deleted: true
}

export type CreateAgentRuntimeProfileResult = {
  agentRuntimeProfile: AgentRuntimeProfile
}

export type ListAgentRuntimeProfilesResult = {
  agentRuntimeProfiles: AgentRuntimeProfile[]
  nextCursor?: string
}

export type UpdateAgentRuntimeProfileResult = {
  agentRuntimeProfile: AgentRuntimeProfile
}

export type DeleteAgentRuntimeProfileResult = {
  deleted: true
}
