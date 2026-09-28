import type { JsonObject } from './common.js'
export type {
  AiGatewayCapabilityDefinition,
  AiGatewayFieldDefinition,
  AiGatewayInvokeInput,
  AiGatewayInvokeResult,
  RegisteredAiGatewayProvider,
} from '@loom-studio/ai-gateway/contracts'

type ProviderProfile = {
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

export type AiCapabilityProfile = {
  id: string
  version: number
  providerProfileId: string
  providerExtensionId?: string
  capabilityId: string
  displayName: string
  config: JsonObject
  available: boolean
  unavailableReason?: 'provider-profile-missing' | 'provider-unavailable' | 'capability-unavailable'
  createdAt: string
  updatedAt: string
}

export type ListAiCapabilityProfilesResult = {
  profiles: AiCapabilityProfile[]
  nextCursor?: string
}

export type CreateAiCapabilityProfileResult = {
  profile: AiCapabilityProfile
}

export type UpdateAiCapabilityProfileResult = CreateAiCapabilityProfileResult

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

export type AgentPreset = import('./workspace.js').PromptResource

export type CreateProviderProfileResult = {
  providerProfile: ProviderProfile
}

export type ListProviderProfilesResult = {
  providerProfiles: ProviderProfile[]
  nextCursor?: string
}

export type UpdateProviderProfileResult = {
  providerProfile: ProviderProfile
}

export type DeleteProviderProfileResult = {
  deleted: true
  deletedProviderProfileId?: string
}

export type CreateAgentPresetResult = {
  agentPreset: AgentPreset
}

export type ListAgentPresetsResult = {
  agentPresets: AgentPreset[]
  nextCursor?: string
}

export type UpdateAgentPresetResult = {
  agentPreset: AgentPreset
}

export type DeleteAgentPresetResult = {
  deleted: true
}
