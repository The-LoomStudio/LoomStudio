export type ExtensionObservationContext = {
  moduleId?: string; instanceId?: string; eventId?: string; eventName?: string
  correlationId?: string; callId?: string; parentCallId?: string
}

import type { Diagnostic, DiagnosticsRegistry } from '@loom-studio/diagnostics'
import type { DocumentStore } from '@loom-studio/document-store'
import type { ExtensionHostLogWriter, ExtensionLogPage, ExtensionLogQuery } from '@loom-studio/logging'
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
  ExtensionInstallationTarget,
  ExtensionMediaAsset,
  ExtensionModuleManifest,
  ExtensionMacroProvider,
  NarrativeContextProvider,
  ExtensionPortablePayload,
  ExtensionPortablePayloadDraft,
  ExtensionRpcHandler,
  ExtensionStorageScope,
  ExtensionStateMutationInput,
  ExtensionStateMutationResult,
  ExtensionStateSnapshot,
  ExtensionStateTarget,
  ProfiledAiGateway,
} from '@loom-studio/extension-sdk'
import { extensionStorageTokenPattern } from '@loom-studio/extension-sdk'
import type { JsonValue, StateContribution } from '@loom-studio/shared'
import type { StudioEvent } from '@loom-studio/extension-sdk'

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
  installationId: string
  target: ExtensionInstallationTarget
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
  extensionTarget?: ExtensionInstallationTarget
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

export type ExtensionHostLogger = ExtensionHostLogWriter

export type ExtensionEventRegistration = {
  dispose(): void | Promise<void>
}

export type ExtensionHostOptions = {
  registerRecordArchive?(adapter: import('@loom-studio/extension-sdk').ExtensionRecordArchive, owner: { packageId: string; installationId: string; target: ExtensionInstallationTarget }): Disposable
  readExtensionNarrative?(target: import('@loom-studio/extension-sdk').ExtensionTimelineTarget, input: import('@loom-studio/extension-sdk').ExtensionNarrativeRead, signal: AbortSignal): Promise<import('@loom-studio/extension-sdk').ExtensionNarrativeSnapshot>
  validateExtensionNarrative?(target: import('@loom-studio/extension-sdk').ExtensionTimelineTarget, source: import('@loom-studio/extension-sdk').ExtensionNarrativeSource, signal: AbortSignal): Promise<boolean>
  subscribeNarrativeActivity?(handler: (event: import('@loom-studio/extension-sdk').ExtensionNarrativeActivity) => void): Disposable
  registerReadonlyFiles?(provider: import('@loom-studio/extension-sdk').ExtensionReadonlyFiles, owner: { target: ExtensionInstallationTarget; isAvailable(target: { timelineId: string; branchId: string }): Promise<boolean> }): Disposable
  extensionAgentTasks?: {
    create(owner: { packageId: string; installationId: string }, target: { timelineId: string; branchId: string }, input: import('@loom-studio/extension-sdk').ExtensionAgentTaskCreate, signal: AbortSignal): Promise<{ sessionId: string }>
    invoke(owner: { packageId: string; installationId: string }, target: { timelineId: string; branchId: string }, input: import('@loom-studio/extension-sdk').ExtensionAgentTaskInvoke, signal: AbortSignal, observation?: ExtensionObservationContext): Promise<import('@loom-studio/extension-sdk').ExtensionAgentTaskResult>
    read(owner: { packageId: string; installationId: string }, target: { timelineId: string; branchId: string }, sessionId: string, signal: AbortSignal): Promise<import('@loom-studio/extension-sdk').ExtensionAgentTaskSnapshot>
    subscribe(owner: { packageId: string; installationId: string }, target: { timelineId: string; branchId: string }, input: { sessionId: string; cursor?: number }, signal: AbortSignal): Promise<import('@loom-studio/extension-sdk').ExtensionAgentTaskProgress>
    acknowledge(owner: { packageId: string; installationId: string }, target: { timelineId: string; branchId: string }, sessionId: string, signal: AbortSignal): Promise<void>
    cancel(owner: { packageId: string; installationId: string }, target: { timelineId: string; branchId: string }, sessionId: string, signal: AbortSignal): Promise<unknown>
    dispose(owner: { packageId: string; installationId: string }, target: { timelineId: string; branchId: string }, sessionId: string, signal: AbortSignal): Promise<unknown>
  }

  documents: DocumentStore
  diagnostics: DiagnosticsRegistry
  logger?: ExtensionHostLogWriter
  queryLogs?(packageId: string, input: ExtensionLogQuery, installationId?: string): Promise<ExtensionLogPage>
  mode?: 'development' | 'production' | 'test'
  grantEventCapabilities?(packageManifest: ExtensionManifest, moduleManifest: ExtensionModuleManifest, target: ExtensionInstallationTarget): readonly EventCapabilityCategory[]
  grantAssetCapabilities?(packageManifest: ExtensionManifest, moduleManifest: ExtensionModuleManifest, target: ExtensionInstallationTarget): readonly ExtensionAssetCapability[]
  canAccessAsset?(asset: ExtensionMediaAsset, target: ExtensionInstallationTarget): boolean | Promise<boolean>
  assets?: {
    publish(input: {
      bytes: Uint8Array
      kind: string
      label?: string
      mediaType?: string
      width?: number
      height?: number
      ownerPackageId: string
      ownerInstallationId?: string
      actor: { kind: 'extension'; id: string }
    }): Promise<ExtensionMediaAsset>
    get(assetId: string): Promise<ExtensionMediaAsset | undefined>
    read(assetId: string, options?: { maxBytes?: number }): Promise<Uint8Array>
  }
  portablePayloads?: {
    create(input: {
      ownerInstallationId?: string
      packageId: string
      artifactPayloadId?: string
      payload: ExtensionPortablePayloadDraft
    }): Promise<ExtensionPortablePayload>
    list(packageId: string, ownerInstallationId?: string): Promise<ExtensionPortablePayload[]>
    get(payloadId: string): Promise<ExtensionPortablePayload>
    update(input: {
      packageId: string
      payloadId: string
      expectedVersion: number
      payload: ExtensionPortablePayloadDraft
    }): Promise<ExtensionPortablePayload>
    delete(input: { packageId: string; payloadId: string; expectedVersion: number }): Promise<void>
    replaceCardBindings(input: {
      ownerInstallationId?: string
      packageId: string
      cardId: string
      expectedVersion: number
      payloadIds: string[]
    }): Promise<{ cardVersion: number }>
  }
  aiCapabilities?: AiGatewayCapabilityRegistry
  aiGateway?: ProfiledAiGateway
  invokeModel?: (input: Parameters<import('@loom-studio/extension-sdk').ExtensionActivationContext['ai']['invokeModel']>[0], owner?: { packageId: string; installationId: string; moduleId: string; timelineId?: string } & ExtensionObservationContext) =>
    ReturnType<import('@loom-studio/extension-sdk').ExtensionActivationContext['ai']['invokeModel']>
  buildPrompt?: (input: import('@loom-studio/extension-sdk').ExtensionPromptBuildInput, target: ExtensionInstallationTarget, packageId: string, lease?: import('@loom-studio/extension-sdk').ExtensionTimelineLease, observation?: ExtensionObservationContext) =>
    Promise<import('@loom-studio/extension-sdk').ExtensionPromptBuildResult>
  registerPromptProcessor?(processor: import('@loom-studio/extension-sdk').ExtensionPromptProcessor, owner: {
    packageId: string
    moduleId: string
    instanceId: string
    target: ExtensionInstallationTarget
  }): Disposable
  registerStateContentHandler?(handler: import('@loom-studio/extension-sdk').ExtensionStateContentHandler, owner: {
    packageId: string
    target: ExtensionInstallationTarget
    isAvailable?(target: import('@loom-studio/extension-sdk').ExtensionTimelineTarget | undefined): Promise<boolean>
  }): Disposable
  registerMacroProvider?(provider: ExtensionMacroProvider, owner: {
    isAvailable?(context: Parameters<ExtensionMacroProvider['resolve']>[0]): Promise<boolean>
    packageId: string
    moduleId: string
    instanceId: string
    target: ExtensionInstallationTarget
  }): Disposable
  registerNarrativeContextProvider?(provider: NarrativeContextProvider, owner: {
    isAvailable?(context: Parameters<NarrativeContextProvider['resolve']>[0]): Promise<boolean>
    packageId: string
    moduleId: string
    instanceId: string
    target: ExtensionInstallationTarget
  }): Disposable
  registerStateContribution?(contribution: StateContribution, owner: {
    packageId: string
    moduleId: string
    instanceId: string
    packageVersion: string
    target: ExtensionInstallationTarget
  }, initialize?: import('@loom-studio/extension-sdk').ExtensionStateInitializer): Disposable
  runTimelineWork?<T>(
    input: { timelineId: string; branchId: string; installationId: string; packageVersion: string; signal?: AbortSignal },
    work: (execution: { lease: import('@loom-studio/extension-sdk').ExtensionTimelineLease; signal: AbortSignal;
      narrativeSource?: import('@loom-studio/extension-sdk').ExtensionTimelineExecution['narrativeSource'] }) => Promise<T>,
  ): Promise<T>
  beginTimelineWork?(
    input: { timelineId: string; installationId: string; packageVersion: string; signal?: AbortSignal },
  ): Promise<{ lease: import('@loom-studio/extension-sdk').ExtensionTimelineLease; signal: AbortSignal; dispose(): void; run<T>(work: () => T): T }>
  assertTimelineWork?(lease: import('@loom-studio/extension-sdk').ExtensionTimelineLease): Promise<void>
  canRunTimelineWork?(input: { timelineId: string; installationId: string }): Promise<boolean>
  listTimelineTargets?(input: { installationId: string }): Promise<import('@loom-studio/extension-sdk').ExtensionTimelineTarget[]>
  subscribeTimelineTargets?(input: { installationId: string }, listener: () => void): { dispose(): void }
  readState?(target: ExtensionStateTarget, owner: { packageId: string; moduleId: string; instanceId: string; lease?: import('@loom-studio/extension-sdk').ExtensionTimelineLease }): Promise<ExtensionStateSnapshot>
  writeState?(input: ExtensionStateMutationInput, owner: { packageId: string; moduleId: string; instanceId: string; lease?: import('@loom-studio/extension-sdk').ExtensionTimelineLease }): Promise<ExtensionStateMutationResult>
  canAccessState?(target: ExtensionStateTarget, installation: ExtensionInstallationTarget): Promise<boolean>
  registerAgentToolHandler?(
    toolId: string,
    ownerPackageId: string,
    ownerModuleId: string,
    ownerInstanceId: string,
    handler: ExtensionAgentToolHandler,
  ): Disposable
  validateStorageScope?(scope: ExtensionStorageScope, target: ExtensionInstallationTarget, execution?: import('@loom-studio/extension-sdk').ExtensionTimelineTarget): Promise<void>
  validateEntityRef?(ref: ExtensionEntityRef, target: ExtensionInstallationTarget, execution?: import('@loom-studio/extension-sdk').ExtensionTimelineTarget): Promise<void>
  assetScratchRoot?: string
  resolveFileDataDirectory?(packageId: string, target: ExtensionInstallationTarget): Promise<string>
  serverModuleSnapshotRoot?: string
  callRpc(method: string, params?: JsonValue, context?: ExtensionRpcContext): Promise<JsonValue>
  registerRpc(name: string, ownerPackageId: string, ownerModuleId: string, handler: ExtensionRpcHandler, ownerInstanceId: string, target: ExtensionInstallationTarget): ExtensionRpcRegistration
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
  /** Registers an already prepared server module without an installed package directory. */
  registerModule?(input: {
    manifest: ExtensionManifest
    moduleId: string
    target?: ExtensionInstallationTarget
    load(instanceId: string): Promise<import('@loom-studio/extension-sdk').ServerExtensionModule>
  }): ExtensionModuleSummary
  discover(directory: string, target?: ExtensionInstallationTarget): Promise<ExtensionModuleSummary[]>
  activate(packageId: string, moduleId: string, target?: ExtensionInstallationTarget): Promise<ExtensionModuleSummary>
  activateAll(): Promise<ExtensionModuleSummary[]>
  reload(packageId: string, moduleId: string, target?: ExtensionInstallationTarget): Promise<ExtensionModuleSummary>
  dispose(packageId: string, moduleId: string, target?: ExtensionInstallationTarget): Promise<void>
  forget(packageId: string, moduleId: string, target?: ExtensionInstallationTarget): Promise<void>
  disposeAll(): Promise<void>
  list(): ExtensionModuleSummary[]
  diagnostics(packageId?: string, moduleId?: string): Diagnostic[]
}

type Disposable = {
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
  target: ExtensionInstallationTarget
  directory: string
  packageManifest: ExtensionManifest
  moduleManifest: ExtensionModuleManifest & { runtime: 'server' }
  state: ExtensionState
  instance?: ExtensionInstance
  load?: (instanceId: string) => Promise<import('@loom-studio/extension-sdk').ServerExtensionModule>
}

export const kernelNamespaces = ['system', 'events', 'docs', 'extensions', 'diagnostics']
export const studioReservedNamespaces = [...kernelNamespaces, 'application', 'logs', 'studio']
export const extensionConfigDocumentType = 'airp.extensionConfig'
export const extensionRecordDocumentType = 'airp.extensionRecord'
export { extensionStorageTokenPattern }

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
