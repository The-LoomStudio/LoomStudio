import type { ClientJsonValue } from '@loom-studio/client-bridge'
import type {
  ClientActionPlacement,
  ClientCommandDeclaration,
  ExtensionAgentToolContribution,
  ExtensionPromptResourceContribution,
  ExtensionTextExtractorContribution,
  ExtensionTextTransformRuleContribution,
  RendererContributionDefinition,
} from '@loom-studio/extension-sdk'

export type ManagedExtensionModule = {
  packageId: string
  moduleId: string
  runtimeKind: 'server' | 'client'
  entryUrl?: string
  desired: {
    enabled: boolean
    grants?: Record<string, ClientJsonValue>
    updatedAt?: string
  }
  contributions: {
    renderers?: RendererContributionDefinition[]
    commands?: ClientCommandDeclaration[]
    actions?: ClientActionPlacement[]
    [key: string]: unknown
  }
  runtime?: ClientJsonValue
}

export type ManagedExtensionPackage = {
  packageId: string
  version: string
  displayName: string
  description?: string
  author?: string
  iconUrl?: string
  tags: string[]
  available: boolean
  sourceKinds: string[]
  modules: ManagedExtensionModule[]
  resources?: {
    transformRules?: ExtensionTextTransformRuleContribution[]
    textExtractors?: ExtensionTextExtractorContribution[]
    promptResources?: ExtensionPromptResourceContribution[]
    agentTools?: ExtensionAgentToolContribution[]
    [key: string]: ClientJsonValue | undefined
  }
  importedResources?: {
    transformRuleContributionIds: string[]
    textExtractorContributionIds: string[]
  }
}

export type ExtensionPackageResourceImportResult = {
  packageId: string
  version: string
  promptResources: Array<{ contributionId: string; resourceId: string; resourceKind: string }>
  agentTools: Array<{ contributionId: string; toolId: string }>
  transformRules: Array<{ contributionId: string; ruleId: string }>
  textExtractors: Array<{ contributionId: string; extractorId: string }>
  mutation?: { changesetId: string }
}

export type ExtensionPackageResourceRemovalResult = {
  packageId: string
  promptResourceIds: string[]
  agentToolIds: string[]
  textTransformRuleIds: string[]
  textExtractorIds: string[]
  detachedReferences: {
    cards: number
    timelines: number
    agentProfiles: number
    presetToolMounts: number
  }
  mutation?: { changesetId: string }
}

export type ManagedClientExtensionModule = ManagedExtensionModule & {
  runtimeKind: 'client'
  entryUrl: string
}

export type ManagedClientExtensionPackage = Omit<ManagedExtensionPackage, 'modules'> & {
  modules: ManagedClientExtensionModule[]
}
