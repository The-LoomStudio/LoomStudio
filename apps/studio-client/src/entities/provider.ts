import type { JsonObject } from './common.js'

export type ProviderProfile = {
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

export type ProviderAccount = ProviderProfile

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
  toolOverrides: Record<string, boolean>
  createdAt: string
  updatedAt: string
}

export type CreateProviderProfileResult = {
  providerProfile: ProviderProfile
}

export type CreateProviderAccountResult = CreateProviderProfileResult & {
  providerAccount: ProviderAccount
}

export type ListProviderProfilesResult = {
  providerProfiles: ProviderProfile[]
  nextCursor?: string
}

export type ListProviderAccountsResult = ListProviderProfilesResult & {
  providerAccounts: ProviderAccount[]
}

export type UpdateProviderProfileResult = {
  providerProfile: ProviderProfile
}

export type UpdateProviderAccountResult = UpdateProviderProfileResult & {
  providerAccount: ProviderAccount
}

export type DeleteProviderProfileResult = {
  deleted: true
  deletedProviderProfileId?: string
}

export type DeleteProviderAccountResult = DeleteProviderProfileResult

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
