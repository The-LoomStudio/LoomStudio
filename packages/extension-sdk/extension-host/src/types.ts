import type { Diagnostic, DiagnosticsRegistry } from '@loom-studio/diagnostics'
import type { DocumentStore } from '@loom-studio/document-store'
import type {
  AiGatewayCapabilityRegistry,
  EventCapabilityCategory,
  EventDefinitionRegistrationOwner,
  EventPublishIdentity,
  EventSubscriberIdentity,
  ExtensionAgentToolHandler,
  ExtensionAssetCapability,
  ExtensionEntityRef,
  ExtensionEventDefinition,
  ExtensionManifest,
  ExtensionMediaAsset,
  ExtensionModuleManifest,
  ExtensionPortablePayload,
  ExtensionPortablePayloadDraft,
  ExtensionRpcHandler,
  ExtensionStorageScope,
  ProfiledAiGateway,
} from '@loom-studio/extension-sdk'
import type { JsonObject, JsonValue } from '@loom-studio/shared'
import type { StudioEvent } from '@loom-studio/transport'

export type { ExtensionRpcHandler } from '@loom-studio/extension-sdk'
export type {
  EventCapabilityCategory,
  ExtensionAgentToolContribution,
  ExtensionAssetCapability,
  ExtensionEntityRef,
  ExtensionManifest,
  ExtensionModuleManifest,
  ExtensionPromptResourceContribution,
  ExtensionStorageScope,
} from '@loom-studio/extension-sdk'

export type ExtensionState = 'discovered' | 'manifestLoaded' | 'manifestValidated' | 'loaded' | 'activating' | 'active' | 'degraded' | 'disabled'

export type ExtensionInstanceState =
  | 'created'
  | 'activating'
  | 'active'
  | 'degraded'
  | 'activation_failed'
  | 'stopping'
  | 'disposed'
  | 'dispose_failed'

export type ExtensionModuleSummary = {
  packageId: string
  moduleId: string
  runtime: 'server'
  version: string
  displayName?: string
  tags?: string[]
  state: ExtensionState
  instance?: {
    instanceId: string
    state: ExtensionInstanceState
  }
  contributions?: {
    rpc?: string[]
    documentTypes?: string[]
    events?: string[]
    aiProviders?: string[]
    agentToolHandlers?: string[]
  }
}

export type ExtensionRpcContext = {
  packageId: string
  moduleId: string
  instanceId: string
  clientId?: string
  correlationId?: string
  callId?: string
  parentCallId?: string
}

export type ExtensionRpcRegistration = {
  name: string
  ownerPackageId: string
  ownerModuleId: string
  ownerInstanceId?: string
  handler: ExtensionRpcHandler
  dispose(): void
}

export type ExtensionHostLogger = {
  debug?(message: string, fields?: { event?: string; data?: JsonObject }): void
  info(message: string, fields?: { event?: string; data?: JsonObject }): void
  warn?(message: string, fields?: { event?: string; data?: JsonObject }): void
  error(message: string, fields?: { event?: string; data?: JsonObject }): void
}

export type ExtensionEventRegistration = {
  dispose(): void | Promise<void>
}

export type ExtensionHostOptions = {
  documents: DocumentStore
  diagnostics: DiagnosticsRegistry
  logger?: ExtensionHostLogger
  mode?: 'development' | 'production' | 'test'
  grantEventCapabilities?(packageManifest: ExtensionManifest, moduleManifest: ExtensionModuleManifest): readonly EventCapabilityCategory[]
  grantAssetCapabilities?(packageManifest: ExtensionManifest, moduleManifest: ExtensionModuleManifest): readonly ExtensionAssetCapability[]
  assets?: {
    publish(input: {
      bytes: Uint8Array
      kind: string
      label?: string
      mediaType?: string
      width?: number
      height?: number
      ownerPackageId: string
      actor: { kind: 'extension'; id: string }
    }): Promise<ExtensionMediaAsset>
    get(assetId: string): Promise<ExtensionMediaAsset | undefined>
    read(assetId: string, options?: { maxBytes?: number }): Promise<Uint8Array>
  }
  portablePayloads?: {
    create(input: {
      packageId: string
      artifactPayloadId?: string
      payload: ExtensionPortablePayloadDraft
    }): Promise<ExtensionPortablePayload>
    list(packageId: string): Promise<ExtensionPortablePayload[]>
    get(payloadId: string): Promise<ExtensionPortablePayload>
    update(input: {
      packageId: string
      payloadId: string
      expectedVersion: number
      payload: ExtensionPortablePayloadDraft
    }): Promise<ExtensionPortablePayload>
    delete(input: { packageId: string; payloadId: string; expectedVersion: number }): Promise<void>
    replaceCardBindings(input: {
      packageId: string
      cardId: string
      expectedVersion: number
      payloadIds: string[]
    }): Promise<{ cardVersion: number }>
  }
  aiCapabilities?: AiGatewayCapabilityRegistry
  aiGateway?: ProfiledAiGateway
  registerAgentToolHandler?(
    toolId: string,
    ownerPackageId: string,
    ownerModuleId: string,
    ownerInstanceId: string,
    handler: ExtensionAgentToolHandler,
  ): Disposable
  validateStorageScope?(scope: ExtensionStorageScope): Promise<void>
  validateEntityRef?(ref: ExtensionEntityRef): Promise<void>
  assetScratchRoot?: string
  callRpc(method: string, params?: JsonValue, context?: ExtensionRpcContext): Promise<JsonValue>
  registerRpc(name: string, ownerPackageId: string, ownerModuleId: string, handler: ExtensionRpcHandler, ownerInstanceId: string): ExtensionRpcRegistration
  registerEventDefinition?(definition: ExtensionEventDefinition & {
    owner: { kind: 'extension'; packageId: string; moduleId: string }
    capability?: `extension:${string}`
  }, registeredBy: EventDefinitionRegistrationOwner): ExtensionEventRegistration
  emitEvent?(name: string, payload: JsonValue, publisher: EventPublishIdentity): StudioEvent
  subscribeEvents?(
    patterns: string[],
    handler: (event: StudioEvent) => void | Promise<void>,
    subscriber: EventSubscriberIdentity,
  ): ExtensionEventRegistration
}

export type ExtensionHost = {
  discover(directory: string): Promise<ExtensionModuleSummary[]>
  activate(packageId: string, moduleId: string): Promise<ExtensionModuleSummary>
  activateAll(): Promise<ExtensionModuleSummary[]>
  reload(packageId: string, moduleId: string): Promise<ExtensionModuleSummary>
  dispose(packageId: string, moduleId: string): Promise<void>
  forget(packageId: string, moduleId: string): Promise<void>
  disposeAll(): Promise<void>
  list(): ExtensionModuleSummary[]
  diagnostics(packageId?: string, moduleId?: string): Diagnostic[]
}

export type Disposable = {
  dispose(): void | Promise<void>
}

export type ScopeEntry = {
  kind: string
  disposable: Disposable
}

export type ExtensionScope = {
  readonly instanceId: string
  readonly signal: AbortSignal
  readonly active: boolean
  track(kind: string, disposable: Disposable): void
  run<T>(callback: () => T | Promise<T>): Promise<T>
  dispose(): Promise<void>
}

export type ExtensionInstance = {
  instanceId: string
  state: ExtensionInstanceState
  scope: ExtensionScope
  registeredRpcNames: Set<string>
  registeredEventNames: Set<string>
  registeredAiProviderIds: Set<string>
  registeredAgentToolIds: Set<string>
  grantedEventCapabilities: readonly EventCapabilityCategory[]
  grantedAssetCapabilities: readonly ExtensionAssetCapability[]
}

export type ExtensionModuleRecord = {
  directory: string
  packageManifest: ExtensionManifest
  moduleManifest: ExtensionModuleManifest & { runtime: 'server' }
  state: ExtensionState
  instance?: ExtensionInstance
}

export const kernelNamespaces = ['system', 'events', 'docs', 'extensions', 'diagnostics', 'loom', 'trace', 'audit']
export const studioReservedNamespaces = [...kernelNamespaces, 'application', 'logs', 'studio']
export const extensionConfigDocumentType = 'airp.extensionConfig'
export const extensionRecordDocumentType = 'airp.extensionRecord'
export const extensionStorageTokenPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

export type ExtensionConfigContent = {
  scope: ExtensionStorageScope
  key: string
  value: JsonValue
  createdAt: string
  updatedAt: string
}

export type ExtensionRecordContent = {
  scope: ExtensionStorageScope
  recordType: string
  data: JsonValue
  bindings: ExtensionEntityRef[]
  createdAt: string
  updatedAt: string
}
