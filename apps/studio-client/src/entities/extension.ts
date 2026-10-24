import type { ExtensionBackgroundContribution, ExtensionStyleContribution } from '@loom-studio/extension-sdk'
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
    participation?: 'timeline'
    source?: ExtensionInstallationSource
    target: import('@loom-studio/extension-sdk').ExtensionInstallationTarget
    createdAt: string
    updatedAt: string
  }>
}

export type ExtensionInstallationSource =
  | { kind: 'git' | 'zip'; url: string }
  | { kind: 'local'; directory: string }
  | { kind: 'card' }

export type TimelineExtensionParticipation = {
  timelineId: string
  version: number
  entries: Array<{
    installationId: string
    packageId: string
    packageVersion: string
    installationVersion: number
    source?: ExtensionInstallationSource
    enabled: boolean
    generation: string
  }>
}

export type TimelineExtensionResourceInspection = {
  timelineId: string
  installationId: string
  resources: Array<{ id: string; kind: string; label: string; contributionId: string; packageId: string; eligible: boolean }>
}

export type TimelineExtensionAdoptionPreview = {
  timelineId: string
  branchId: string
  installationId: string
  packageId: string
  packageVersion: string
  source: ExtensionInstallationSource
  expectedVersion: number
  expectedInstallationVersion: number
  expectedStateRevisionId: string
  expectedRuntimeContextVersion: number
  contributionInstances: Array<{ contributionId: string; instanceId: string }>
  paths: string[]
}

export type TimelineExtensionRecoveryPreview = {
  timelineId: string
  installationId: string
  packageId: string
  packageVersion: string
  expectedVersion: number
  expectedInstallationVersion: number
  source: ExtensionInstallationSource
  previousSource: ExtensionInstallationSource
  sourceChanged: boolean
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
  runtimeKind: import('@loom-studio/extension-sdk').ExtensionModuleRuntime
  entryUrl?: string
  reloadId?: string
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
  participation?: 'timeline'
  remote?: { source: import('@loom-studio/extension-sdk').ExtensionDownloadSource; commit?: string; canRollback: boolean }
  archiveDigest?: string
  fileRevision?: string
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
    backgrounds?: ExtensionBackgroundContribution[]
    themes?: ExtensionStyleContribution[]
    styles?: ExtensionStyleContribution[]
    transformRules?: ExtensionTextTransformRuleContribution[]
    textExtractors?: ExtensionTextExtractorContribution[]
    promptResources?: ExtensionPromptResourceContribution[]
    agentTools?: ExtensionAgentToolContribution[]
    settings?: ExtensionSettingContribution[]
    loomScripts?: Array<{ id: string; source: string }>
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
  runtimeKind: 'client' | 'client-worker'
  entryUrl: string
}

export type ManagedClientExtensionPackage = Omit<ManagedExtensionPackage, 'modules'> & {
  modules: ManagedClientExtensionModule[]
}
