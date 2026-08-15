import type { JsonObject } from './common.js'

export type ProviderAccount = {
  id: string
  version: number
  providerExtensionId: string
  displayName: string
  config: JsonObject
  enabledModelIds: string[]
  credential: {
    configured: boolean
    updatedAt?: string
  }
  createdAt: string
  updatedAt: string
}

export type ModelProfile = {
  id: string
  version: number
  providerAccountId: string
  displayName: string
  providerModelId: string
}

export type ProviderModelSelection = {
  providerProfileId: string
  modelId: string
}

export type AgentProfile = {
  id: string
  version: number
  name: string
  presetId: string
  model: ProviderModelSelection
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

export type CreateAgentProfileResult = {
  agentProfile: AgentProfile
}

export type ListAgentProfilesResult = {
  agentProfiles: AgentProfile[]
  nextCursor?: string
}

export type UpdateAgentProfileResult = {
  agentProfile: AgentProfile
}

export type DeleteAgentProfileResult = {
  deleted: true
}
