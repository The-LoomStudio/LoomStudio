import type { ExtensionBackgroundContribution, ExtensionStyleContribution } from '@loom-studio/extension-sdk'
import type { ExtensionTextTransformRuleContribution, ExtensionTextExtractorContribution, ExtensionPromptResourceContribution, ExtensionAgentToolContribution, ExtensionSettingContribution } from '@loom-studio/extension-sdk'
import type { DiagnosticsRegistry } from '@loom-studio/diagnostics'
import type {
  DataCommitSource,
} from '@loom-studio/data-engine'
import type {
  DocumentStore,
} from '@loom-studio/document-store'
import type { ExtensionHost, ExtensionRpcHandler } from '@loom-studio/extension-host'
import type {
  EventCapabilityCategory,
  EventDefinition,
  EventDefinitionRegistrationOwner,
  EventPublishIdentity,
  EventSubscriberIdentity,
  ExtensionAssetCapability,
  ExtensionInstallationTarget,
  RegisteredEventDefinition,
} from '@loom-studio/extension-sdk'
import type { JsonValue } from '@loom-studio/shared'
import type { StudioEvent } from '@loom-studio/extension-sdk'

export type KernelRpcContext = {
  expectedExtensionPackageId?: string
  extensionTarget?: ExtensionInstallationTarget
  correlationId?: string
  callId?: string
  parentCallId?: string
  clientId?: string
}

export type KernelRpcHandler = (params: JsonValue | undefined, context: KernelRpcContext) => Promise<JsonValue> | JsonValue

export type RegistrationHandle = {
  dispose(): void
}

export type EventHandler = (event: StudioEvent) => void | Promise<void>

export type EventEmitOptions = {
  publisher?: EventPublishIdentity
  source?: string
  clientId?: string
  correlationId?: string
  callId?: string
  parentCallId?: string
}

export type EventSubscribeOptions = {
  subscriber?: EventSubscriberIdentity
}

export type EventBus = {
  registerDefinition(definition: EventDefinition, registeredBy?: EventDefinitionRegistrationOwner): RegistrationHandle
  emit(name: string, payload: JsonValue, options?: EventEmitOptions): StudioEvent
  subscribe(patterns: string[], handler: EventHandler, options?: EventSubscribeOptions): RegistrationHandle & { subscriptionId: string }
  unsubscribe(subscriptionId: string): boolean
  definitions(): RegisteredEventDefinition[]
  eventNames(): string[]
}

export type Kernel = {
  start(): Promise<void>
  stop(): Promise<void>
  registerKernelRpc(method: string, handler: KernelRpcHandler): RegistrationHandle
  registerExtensionRpc(method: string, ownerPackageId: string, ownerModuleId: string, handler: ExtensionRpcHandler, instanceId: string, target?: ExtensionInstallationTarget): RegistrationHandle
  callRpc<T = JsonValue>(method: string, params?: JsonValue, context?: KernelRpcContext): Promise<T>
  getPublicSurface(): KernelPublicSurface
  getDocumentStore(): DocumentStore
  getExtensionHost(): ExtensionHost
  getDiagnostics(): DiagnosticsRegistry
  getEventBus(): EventBus
}

export type KernelPublicSurface = {
  namespaces: string[]
  methods: Array<{
    name: string
    owner: 'kernel' | `extension:${string}/${string}`
  }>
  version: string
}

export type ManagedExtensionModule = {
  packageId: string
  moduleId: string
  runtimeKind: import('@loom-studio/extension-sdk').ExtensionModuleRuntime
  entryUrl?: string
  reloadId?: string
  requestedCapabilities?: Record<string, JsonValue>
  requestedEventCapabilities?: import('@loom-studio/extension-sdk').EventCapabilityCategory[]
  requestedAssetCapabilities?: Array<'assets.read' | 'assets.publish'>
  requestedUiCapabilities?: Array<'ui.notify'>
  desired: {
    enabled: boolean
    grants?: Record<string, JsonValue> & {
      ui?: Array<'ui.notify'>
      'events.subscribe'?: import('@loom-studio/extension-sdk').EventCapabilityCategory[]
      assets?: Array<'assets.read' | 'assets.publish'>
    }
    updatedAt?: string
  }
  contributions: NonNullable<import('@loom-studio/extension-sdk').ExtensionModuleManifest['contributes']>
  runtime?: JsonValue
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

export type RemovedExtensionPackage = { packageId: string; version: string; removed: true }
export type ImportedExtensionPackageResources = ExtensionPackageResourceImportResult
export type RemovedExtensionPackageResources = ExtensionPackageResourceRemovalResult
export type RemoteInstallPreview = { token: string; packages: Array<{ packageId: string; version: string; displayName: string; source?: import('@loom-studio/extension-sdk').ExtensionDownloadSource; commit?: string; replacing: boolean; modules?: Array<{ id: string; runtime: import('@loom-studio/extension-sdk').ExtensionModuleRuntime; capabilities: import('@loom-studio/extension-sdk').ExtensionModuleManifest['capabilities'] }> }> }
export type RemoteInstallResult = { installed: Array<{ packageId: string; version: string }>; failed?: { packageId: string; message: string; stage?: string; codeCommitted?: boolean; recovery?: { recordPath: string; backupDirectory: string; historyDirectory: string } } }
export type ExtensionManagementService = {
  previewRemoteInstall?(input: unknown): Promise<RemoteInstallPreview>
  previewPackageZip?(source: Uint8Array): Promise<RemoteInstallPreview>
  commitRemoteInstall?(token: string): Promise<RemoteInstallResult>
  checkRemoteUpdate?(packageId: string): Promise<{ changed: boolean; commit?: string; locked: boolean }>
  previewRemoteChange?(input: unknown): Promise<RemoteInstallPreview>
  officialSetup?(): Promise<{ completed: boolean; items: Array<{ id: string; name: string; source: import('@loom-studio/extension-sdk').ExtensionDownloadSource }> }>
  finishOfficialSetup?(): Promise<{ completed: true }>
  listPackages(target?: ExtensionInstallationTarget): ManagedExtensionPackage[]
  installCardPackage(input: { cardId: string; packageId: string; expectedCardVersion: number }): Promise<ManagedExtensionPackage>
  updateCardPackage(input: { cardId: string; packageId: string; expectedCardVersion: number; packageVersion: string; expectedInstallationVersion: number }): Promise<ManagedExtensionPackage>
  uninstallCardPackage(input: { cardId: string; packageId: string; expectedInstallationVersion: number }): Promise<RemovedExtensionPackage>
  installPackage(sourceDirectory: string): Promise<ManagedExtensionPackage>
  installPackageZip(source: Uint8Array): Promise<ManagedExtensionPackage>
  uninstallPackage(packageId: string, version?: string, deleteData?: boolean): Promise<RemovedExtensionPackage>
  enableModule(packageId: string, moduleId: string, grants?: ExtensionModuleCapabilityGrants, target?: ExtensionInstallationTarget): Promise<ManagedExtensionModule>
  disableModule(packageId: string, moduleId: string, target?: ExtensionInstallationTarget): Promise<ManagedExtensionModule>
  reloadModule(packageId: string, moduleId: string, target?: ExtensionInstallationTarget): Promise<ManagedExtensionModule>
  importPackageResources(packageId: string): Promise<ImportedExtensionPackageResources>
  exportPackage(input: { packageId: string; version: string }): Promise<{ packageId: string; version: string; archiveBase64: string }>
  importCardPackageResources(input: { cardId: string; packageId: string; expectedCardVersion: number; update?: { packageVersion: string; expectedInstallationVersion: number } }): Promise<ImportedExtensionPackageResources>
  removeCardPackageResources(input: { cardId: string; packageId: string; expectedInstallationVersion: number }): Promise<RemovedExtensionPackageResources>
  updatePackageResources(input: { packageId: string; packageVersion: string; expectedInstallationVersion: number }): Promise<ImportedExtensionPackageResources>
  removePackageResources(packageId: string): Promise<RemovedExtensionPackageResources>
}

export type ExtensionModuleCapabilityGrants = {
  uiCapabilities?: Array<'ui.notify'>
  eventCapabilities?: EventCapabilityCategory[]
  assetCapabilities?: ExtensionAssetCapability[]
}

export type CreateKernelOptions = {
  documents: DocumentStore
  dataCommits: DataCommitSource
  diagnostics: DiagnosticsRegistry
  extensionHost: ExtensionHost
  extensionManager?: ExtensionManagementService
  studioVersion?: string
  kernelVersion?: string
  protocolVersion?: string
}

export const kernelNamespaces = ['system', 'events', 'docs', 'extensions', 'diagnostics']

export type RpcRegistryEntry = {
  handler: KernelRpcHandler
  owner: 'kernel' | `extension:${string}/${string}`
}

export type CreateEventBusOptions = {
  onSubscriberError?: (input: { event: StudioEvent; subscriptionId: string; error: unknown }) => void
}
