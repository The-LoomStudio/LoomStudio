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
  RegisteredEventDefinition,
} from '@loom-studio/extension-sdk'
import type { LoomRunner } from '@loom-studio/loom-runner'
import type { JsonValue } from '@loom-studio/shared'
import type { TraceAuditStore } from '@loom-studio/trace-audit'
import type { StudioEvent } from '@loom-studio/transport'

export type KernelRpcContext = {
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
  registerExtensionRpc(method: string, ownerPackageId: string, ownerModuleId: string, handler: ExtensionRpcHandler, instanceId: string): RegistrationHandle
  callRpc<T = JsonValue>(method: string, params?: JsonValue, context?: KernelRpcContext): Promise<T>
  getPublicSurface(): KernelPublicSurface
  getDocumentStore(): DocumentStore
  getExtensionHost(): ExtensionHost
  getDiagnostics(): DiagnosticsRegistry
  getEventBus(): EventBus
  getTraceAudit(): TraceAuditStore
  getLoomRunner(): LoomRunner
}

export type KernelPublicSurface = {
  namespaces: string[]
  methods: Array<{
    name: string
    owner: 'kernel' | `extension:${string}/${string}`
  }>
  version: string
}

export type ManagedExtensionPackage = Record<string, JsonValue> & {
  packageId: string
  version: string
}

export type ManagedExtensionModule = Record<string, JsonValue> & {
  packageId: string
  moduleId: string
}

export type RemovedExtensionPackage = Record<string, JsonValue> & {
  packageId: string
  version: string
  removed: true
}

export type ImportedExtensionPackageResources = Record<string, JsonValue> & {
  packageId: string
  version: string
}

export type RemovedExtensionPackageResources = Record<string, JsonValue> & {
  packageId: string
}

export type ExtensionManagementService = {
  listPackages(): ManagedExtensionPackage[]
  installPackage(sourceDirectory: string): Promise<ManagedExtensionPackage>
  uninstallPackage(packageId: string, version?: string): Promise<RemovedExtensionPackage>
  enableModule(packageId: string, moduleId: string, grants?: ExtensionModuleCapabilityGrants): Promise<ManagedExtensionModule>
  disableModule(packageId: string, moduleId: string): Promise<ManagedExtensionModule>
  reloadModule(packageId: string, moduleId: string): Promise<ManagedExtensionModule>
  importPackageResources(packageId: string): Promise<ImportedExtensionPackageResources>
  removePackageResources(packageId: string): Promise<RemovedExtensionPackageResources>
}

export type ExtensionModuleCapabilityGrants = {
  eventCapabilities?: EventCapabilityCategory[]
  assetCapabilities?: ExtensionAssetCapability[]
}

export type CreateKernelOptions = {
  documents: DocumentStore
  dataCommits: DataCommitSource
  diagnostics: DiagnosticsRegistry
  traceAudit: TraceAuditStore
  extensionHost: ExtensionHost
  extensionManager?: ExtensionManagementService
  loomRunner: LoomRunner
  studioVersion?: string
  kernelVersion?: string
  protocolVersion?: string
}

export const kernelNamespaces = ['system', 'events', 'docs', 'extensions', 'diagnostics', 'loom', 'trace', 'audit']

export type RpcRegistryEntry = {
  handler: KernelRpcHandler
  owner: 'kernel' | `extension:${string}/${string}`
}

export type CreateEventBusOptions = {
  onSubscriberError?: (input: { event: StudioEvent; subscriptionId: string; error: unknown }) => void
}
