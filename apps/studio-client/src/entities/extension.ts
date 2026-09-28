import type { ClientJsonValue } from '@loom-studio/client-bridge'
import type {
  ClientActionPlacement,
  ClientCommandDeclaration,
  ExtensionAgentToolContribution,
  ExtensionPromptResourceContribution,
  ExtensionSettingContribution,
  ExtensionTextExtractorContribution,
  ExtensionTextTransformRuleContribution,
  RendererContributionDefinition,
} from '@loom-studio/extension-sdk'

export type ListExtensionInstallationsResult = {
  installations: Array<{
    id: string
    version: number
    packageId: string
    packageVersion: string
    target: import('@loom-studio/extension-sdk').ExtensionInstallationTarget
    createdAt: string
    updatedAt: string
  }>
}

export type ExtensionPackageResourceOrigin = {
  kind: 'extension-package'
  packageId: string
  packageVersion: string
  contributionId: string
  installationId?: string
}

export type ManagedExtensionModule = {
  packageId: string
  moduleId: string
  runtimeKind: 'server' | 'client'
  entryUrl?: string
  requestedCapabilities?: Record<string, ClientJsonValue>
  requestedEventCapabilities?: import('@loom-studio/extension-sdk').EventCapabilityCategory[]
  requestedAssetCapabilities?: Array<'assets.read' | 'assets.publish'>
  requestedUiCapabilities?: Array<'ui.notify'>
  desired: {
    enabled: boolean
    grants?: Record<string, ClientJsonValue> & {
      ui?: Array<'ui.notify'>
      'events.subscribe'?: import('@loom-studio/extension-sdk').EventCapabilityCategory[]
      assets?: Array<'assets.read' | 'assets.publish'>
    }
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
  archiveDigest?: string
  target?: import('@loom-studio/extension-sdk').ExtensionInstallationTarget
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
    settings?: ExtensionSettingContribution[]
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
