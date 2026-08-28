import type {
  AiGatewayInvokeInput,
  AiGatewayInvokeResult,
  AiGatewayProviderRegistration,
  AiGatewayProviderRegistrationHandle,
  RegisteredAiGatewayProvider,
} from '@loom-studio/ai-gateway'
import type { DiagnosticInput } from '@loom-studio/diagnostics'
import type { DocumentRecord, ListDocumentsInput, WriteDocumentInput, WriteDocumentResult } from '@loom-studio/document-store'
import type { JsonObject, JsonValue } from '@loom-studio/shared'
import type { StudioEvent } from '@loom-studio/transport'

export type { JsonValue } from '@loom-studio/shared'
export type {
  AiGatewayCapabilityDefinition,
  AiGatewayCapabilityHandler,
  AiGatewayCapabilityRegistry,
  AiGatewayFieldDefinition,
  AiGatewayFieldType,
  AiGatewayInvokeInput,
  AiGatewayInvokeResult,
  AiGatewayProviderDefinition,
  AiGatewayProviderRegistration,
  AiGatewayProviderRegistrationHandle,
  ProfiledAiGateway,
  RegisteredAiGatewayProvider,
} from '@loom-studio/ai-gateway'

export type EventVisibility = 'public' | 'protected' | 'internal'

export type EventStability = 'experimental' | 'stable' | 'deprecated'

export type EventCapabilityCategory =
  | 'documents'
  | 'narrative'
  | 'agent'
  | 'diagnostics'
  | 'platform-data'
  | `extension:${string}`

export type ExtensionAssetCapability = 'assets.publish' | 'assets.read'

export type ExtensionMediaAsset = {
  id: string
  kind: string
  label?: string
  mediaType?: string
  sizeBytes: number
  width?: number
  height?: number
  ownerPackageId?: string
  createdAt: string
}

export type EventOwner =
  | { kind: 'kernel' }
  | { kind: 'application' }
  | { kind: 'extension'; packageId: string; moduleId: string }

export type EventDefinition<TPayload extends JsonValue = JsonValue> = {
  name: string
  owner: EventOwner
  version: number
  visibility: EventVisibility
  capability?: EventCapabilityCategory
  summary: string
  stability: EventStability
  maxPayloadBytes?: number
  parse?: (payload: unknown) => TPayload
}

export type ExtensionEventDefinition<TPayload extends JsonValue = JsonValue> = Omit<EventDefinition<TPayload>, 'owner' | 'visibility' | 'capability'> & {
  visibility: Exclude<EventVisibility, 'internal'>
}

export type EventDefinitionRegistrationOwner =
  | { kind: 'platform' }
  | {
      kind: 'extension'
      packageId: string
      moduleId: string
      instanceId: string
    }

export type RegisteredEventDefinition = {
  definition: EventDefinition
  registeredBy: EventDefinitionRegistrationOwner
}

export type EventSubscriberIdentity =
  | { kind: 'platform' }
  | {
      kind: 'extension'
      packageId: string
      moduleId: string
      instanceId: string
      capabilities: readonly EventCapabilityCategory[]
    }

export type EventPublishIdentity =
  | { kind: 'kernel' }
  | { kind: 'application' }
  | {
      kind: 'extension'
      packageId: string
      moduleId: string
      instanceId: string
    }

export type ExtensionModuleRuntime = 'server' | 'client'

export type ExtensionRuntimeContributions = {
  rpc?: Array<{ name: string }>
  documentTypes?: Array<{ type: string }>
  events?: Array<{
    name: string
    version: number
    visibility: Exclude<EventVisibility, 'internal'>
  }>
  panels?: Array<{ id: string }>
  aiProviders?: Array<{ id: string }>
}

export type ExtensionPackageContributions = {
  transformRules?: Array<{ source: string }>
}

export type ExtensionModuleManifest = {
  id: string
  runtime: ExtensionModuleRuntime
  entry: string
  capabilities?: {
    'events.subscribe'?: EventCapabilityCategory[]
    'assets.publish'?: boolean
    'assets.read'?: boolean
    'ai.invoke'?: boolean
    [key: string]: JsonValue | undefined
  }
  contributes?: ExtensionRuntimeContributions
}

export type ExtensionManifest = {
  manifestVersion: 2
  id: string
  version: string
  displayName: string
  description?: string
  icon?: string
  author?: string
  homepage?: string
  repository?: string
  tags?: string[]
  engines: {
    studio: string
    loom?: string
  }
  modules?: ExtensionModuleManifest[]
  contributes?: ExtensionPackageContributions
}

export type ExtensionPackageIdentity = {
  packageId: string
  version: string
  displayName: string
  directory: string
}

export type ExtensionModuleIdentity = {
  packageId: string
  moduleId: string
  runtime: ExtensionModuleRuntime
  entry: string
}

export type ExtensionInstanceIdentity = ExtensionPackageIdentity & ExtensionModuleIdentity & {
  instanceId: string
}

export type ExtensionRegistrationHandle = {
  dispose(): void | Promise<void>
}

export type ExtensionRpcHandler = (params: JsonValue | undefined, context: ExtensionRpcContext) => JsonValue | Promise<JsonValue>

export type ExtensionRpcContext = {
  packageId: string
  moduleId: string
  instanceId: string
  clientId?: string
  correlationId?: string
  callId?: string
  parentCallId?: string
}

export type ExtensionDocumentListInput = Omit<ListDocumentsInput, 'ownerExtensionId' | 'type'> & {
  type: string
}

export type ExtensionDocumentWriteInput = Omit<
  WriteDocumentInput,
  'actor' | 'correlationId' | 'callId' | 'parentCallId' | 'meta'
> & {
  meta?: Omit<NonNullable<WriteDocumentInput['meta']>,
    'ownerExtensionId' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy' | 'tombstone'
  >
}

export type ExtensionPortablePayloadDraft = {
  fileName: string
  format: string
  mediaType: string
  schemaVersion?: number
  requirement?: {
    versionRange?: string
  }
  metadata?: JsonObject
  content: string
}

export type ExtensionPortablePayload = ExtensionPortablePayloadDraft & {
  id: string
  artifactPayloadId: string
  packageId: string
  version: number
  createdAt: string
  updatedAt: string
}

export type ExtensionStorageScope =
  | { kind: 'global' }
  | { kind: 'timeline'; timelineId: string }
  | { kind: 'agent-session'; agentSessionId: string }

export type ExtensionEntityRef =
  | { kind: 'narrative-node'; timelineId: string; nodeId: string }
  | { kind: 'agent-message'; agentSessionId: string; messageId: string }
  | { kind: 'asset'; assetId: string }
  | { kind: 'state-path'; timelineId: string; path: string }

export type ExtensionConfigEntry = {
  id: string
  packageId: string
  scope: ExtensionStorageScope
  key: string
  value: JsonValue
  version: number
  createdAt: string
  updatedAt: string
}

export type ExtensionRecordEntry = {
  id: string
  packageId: string
  scope: ExtensionStorageScope
  recordType: string
  data: JsonValue
  bindings: ExtensionEntityRef[]
  version: number
  createdAt: string
  updatedAt: string
}

export type ExtensionActivationContext = {
  extension: {
    packageId: string
    moduleId: string
    instanceId: string
    runtime: 'server'
    version: string
    displayName: string
    directory: string
  }
  logger: {
    debug(message: string, data?: JsonObject): void
    info(message: string, data?: JsonObject): void
    warn(message: string, data?: JsonObject): void
    error(message: string, data?: JsonObject): void
  }
  permissions: {
    events: {
      subscribe: readonly EventCapabilityCategory[]
    }
    assets: readonly ExtensionAssetCapability[]
  }
  rpc: {
    register(name: string, handler: ExtensionRpcHandler): ExtensionRegistrationHandle
    call<T = JsonValue>(method: string, params?: JsonValue): Promise<T>
  }
  events: {
    define<TPayload extends JsonValue = JsonValue>(definition: ExtensionEventDefinition<TPayload>): ExtensionRegistrationHandle
    emit(name: string, payload: JsonValue): StudioEvent
    subscribe(patterns: string[], handler: (event: StudioEvent) => void | Promise<void>): ExtensionRegistrationHandle
  }
  ai: {
    registerProvider(registration: AiGatewayProviderRegistration): AiGatewayProviderRegistrationHandle
    listProviders(): RegisteredAiGatewayProvider[]
    invoke(input: Omit<AiGatewayInvokeInput, 'caller'>): Promise<AiGatewayInvokeResult>
  }
  documents: {
    get<T = JsonValue>(id: string): Promise<DocumentRecord<T> | null>
    list(query: ExtensionDocumentListInput): Promise<DocumentRecord[]>
    write(input: ExtensionDocumentWriteInput): Promise<WriteDocumentResult>
    delete(id: string, options?: { expectedVersion?: number; reason?: string }): Promise<WriteDocumentResult>
  }
  portablePayloads: {
    publish(input: { artifactPayloadId?: string; payload: ExtensionPortablePayloadDraft }): Promise<ExtensionPortablePayload>
    listOwn(): Promise<ExtensionPortablePayload[]>
    readOwn(payloadId: string): Promise<ExtensionPortablePayload>
    updateOwn(input: { payloadId: string; expectedVersion: number; payload: ExtensionPortablePayloadDraft }): Promise<ExtensionPortablePayload>
    deleteOwn(input: { payloadId: string; expectedVersion: number }): Promise<void>
    replaceOwnCardBindings(input: { cardId: string; expectedVersion: number; payloadIds: string[] }): Promise<{ cardVersion: number }>
  }
  storage: {
    configs: {
      list(input?: { scope?: ExtensionStorageScope }): Promise<ExtensionConfigEntry[]>
      get(input: { scope: ExtensionStorageScope; key: string }): Promise<ExtensionConfigEntry | null>
      upsert(input: {
        scope: ExtensionStorageScope
        key: string
        value: JsonValue
        expectedVersion?: number
      }): Promise<ExtensionConfigEntry>
      delete(input: { scope: ExtensionStorageScope; key: string; expectedVersion: number }): Promise<void>
    }
    records: {
      list(input?: {
        scope?: ExtensionStorageScope
        recordType?: string
        binding?: ExtensionEntityRef
      }): Promise<ExtensionRecordEntry[]>
      get(recordId: string): Promise<ExtensionRecordEntry | null>
      create(input: {
        scope: ExtensionStorageScope
        recordType: string
        data: JsonValue
        bindings?: ExtensionEntityRef[]
      }): Promise<ExtensionRecordEntry>
      update(input: {
        recordId: string
        expectedVersion: number
        scope: ExtensionStorageScope
        recordType: string
        data: JsonValue
        bindings?: ExtensionEntityRef[]
      }): Promise<ExtensionRecordEntry>
      delete(input: { recordId: string; expectedVersion: number }): Promise<void>
    }
  }
  assets: {
    publish(input: {
      bytes: Uint8Array
      kind: string
      label?: string
      mediaType?: string
      width?: number
      height?: number
    }): Promise<ExtensionMediaAsset>
    read(assetId: string, options?: { maxBytes?: number }): Promise<{
      asset: ExtensionMediaAsset
      bytes: Uint8Array
    }>
    materialize(assetId: string, options?: { fileExtension?: string; maxBytes?: number }): Promise<{
      asset: ExtensionMediaAsset
      path: string
    }>
  }
  diagnostics: {
    report(input: Omit<DiagnosticInput, 'packageId' | 'moduleId' | 'extensionId' | 'source'> & { source?: string }): void
  }
  lifecycle: {
    signal: AbortSignal
    onDispose(callback: () => void | Promise<void>): void
  }
}

export type ServerExtensionModule = {
  activate(ctx: ExtensionActivationContext): void | Promise<void>
}

export function defineServerExtension(module: ServerExtensionModule): ServerExtensionModule {
  return module
}
