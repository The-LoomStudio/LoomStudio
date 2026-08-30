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

export type RendererSurface =
  | 'shell.background'
  | 'narrative.entry.inline'
  | 'narrative.timeline.tail'
  | 'agent.message.inline'
  | 'agent.session.tail'
  | 'composer.sheet'
  | 'shell.workspace-panel'
  | 'shell.focus-surface'
  | 'standalone.page'

export type RendererInstanceScope = 'workspace' | 'timeline' | 'agent-session' | 'node' | 'message'

export type RendererConflictPolicy = 'collection' | 'exclusive' | 'navigation' | 'anchored-projection'

export type RendererFallback = 'json' | 'text' | 'hidden'
export type RendererMountAdapter = 'direct' | 'shadow' | 'sandbox-iframe'

export type ClientActionSurface = 'composer.quick-actions' | 'extension.workbench.actions'

export type ClientHostIconName = 'image' | 'refresh' | 'settings' | 'sparkles'

export type ClientCommandDeclaration = {
  id: string
  title: string
  icon?: ClientHostIconName
}

export type ClientActionCondition = {
  active?: 'timeline' | 'agent-session'
}

export type ClientActionPlacement = {
  commandId: string
  surface: ClientActionSurface
  group?: string
  suggestedOrder?: number
  when?: ClientActionCondition
}

export type ClientCommandInvocationContext = {
  sourceSurface: ClientActionSurface
  workspaceId: string
  timelineId?: string
  agentSessionId?: string
}

export type ClientCommandHandler = (context: ClientCommandInvocationContext) => void | Promise<void>

export type RendererContributionDefinition = {
  id: string
  name: string
  surface: RendererSurface
  instanceScope: RendererInstanceScope
  suggestedOrder?: number
  artifactType?: string
  fallback?: RendererFallback
  adapter?: RendererMountAdapter
}

export type RendererContributionIdentity = {
  packageId: string
  moduleId: string
  contributionId: string
}

export type RendererInstanceIdentity = RendererContributionIdentity & {
  scopeKey: string
}

export type ClientRendererScope = {
  kind: RendererInstanceScope
  key: string
  entity?: ExtensionEntityRef
}

export type ClientDisplayPart =
  | { type: 'text'; content: string }
  | { type: 'artifact'; artifactType: string; content: JsonValue }

export type ClientTextSelector =
  | { kind: 'literal'; value: string }
  | { kind: 'match-ref'; matchId: string }
  | { kind: 'marker'; markerId: string }

export type ClientNodeRenderMount = {
  key: string
  target:
    | { slot: 'node.before' }
    | { slot: 'node.after' }
    | { slot: 'node.inline'; selector: ClientTextSelector; placement: 'before' | 'after' | 'replace' }
  part: ClientDisplayPart
}

export type ClientNodeDisplayProjectionContext =
  | {
      nodeId: string
      timelineId: string
      rawText: string
      displayText: string
      surface: 'narrative'
      signal: AbortSignal
    }
  | {
      messageId: string
      agentSessionId: string
      rawText: string
      displayText: string
      surface: 'agent-message'
      signal: AbortSignal
    }

export type ClientRendererContext = {
  identity: RendererContributionIdentity
  surface: RendererSurface
  scope: ClientRendererScope
  part?: ClientDisplayPart
  host: {
    compact: boolean
    prefersReducedMotion: boolean
    theme: 'inherit'
  }
  signal: AbortSignal
  close(): void
}

export type ClientRenderer = {
  mount(root: HTMLElement, context: ClientRendererContext): void | ExtensionRegistrationHandle | Promise<void | ExtensionRegistrationHandle>
  update?(context: ClientRendererContext): void | Promise<void>
  projectNode?(context: ClientNodeDisplayProjectionContext): readonly ClientNodeRenderMount[] | Promise<readonly ClientNodeRenderMount[]>
  frame?: { src: string; title?: string }
}

export type ClientRendererSessionHandle = ExtensionRegistrationHandle & {
  sessionId: string
  state(): 'opening' | 'connected' | 'disconnected' | 'revoked'
}

export type ClientStateTarget =
  | { scope: 'global' }
  | { scope: 'timeline'; timelineId: string; branchId: string }

export type ClientStateSnapshot = {
  scopeId: string
  target: ClientStateTarget
  revisionId: string
  value: JsonObject
  createdAt: string
}

export type ClientHistorySource =
  | { kind: 'narrative'; timelineId: string; branchId: string }
  | { kind: 'agent-session'; sessionId: string; headEntryId?: string }

export type ClientExtensionLogger = {
  debug(message: string, data?: JsonObject): void
  info(message: string, data?: JsonObject): void
  warn(message: string, data?: JsonObject): void
  error(message: string, data?: JsonObject): void
}

export type ClientExtensionActivationContext = {
  extension: {
    packageId: string
    moduleId: string
    instanceId: string
    version: string
    displayName: string
  }
  signal: AbortSignal
  logger: ClientExtensionLogger
  commands: {
    register(commandId: string, handler: ClientCommandHandler): ExtensionRegistrationHandle
  }
  renderers: {
    register(definition: RendererContributionDefinition, renderer: ClientRenderer): ExtensionRegistrationHandle
    open(contributionId: string, options?: { scope?: ClientRendererScope; replace?: boolean }): boolean
    close(contributionId: string, scope?: ClientRendererScope): void
    openStandalone(contributionId: string, options?: { scope?: ClientRendererScope }): ClientRendererSessionHandle
  }
  records: {
    list(input?: { scope?: ExtensionStorageScope; recordType?: string; binding?: ExtensionEntityRef }): Promise<ExtensionRecordEntry[]>
    get(recordId: string): Promise<ExtensionRecordEntry | null>
  }
  state: {
    get(target: ClientStateTarget): Promise<ClientStateSnapshot>
  }
  history: {
    project(input: { source: ClientHistorySource; phase: 'classify' | 'prompt' | 'display' }): Promise<JsonValue>
    extract(input: { source: ClientHistorySource; phase?: 'classify' | 'prompt' | 'display'; extractorId: string }): Promise<JsonValue>
  }
  rpc: {
    call<T extends JsonValue = JsonValue>(method: string, params?: JsonValue): Promise<T>
  }
  assets: {
    url(assetId: string): string
  }
  files: {
    url(path: string): string
  }
}

export type ClientExtensionModule = {
  activate(context: ClientExtensionActivationContext): void | ExtensionRegistrationHandle | Promise<void | ExtensionRegistrationHandle>
}

export type ExtensionRuntimeContributions = {
  rpc?: Array<{ name: string }>
  documentTypes?: Array<{ type: string }>
  events?: Array<{
    name: string
    version: number
    visibility: Exclude<EventVisibility, 'internal'>
  }>
  renderers?: RendererContributionDefinition[]
  commands?: ClientCommandDeclaration[]
  actions?: ClientActionPlacement[]
  aiProviders?: Array<{ id: string }>
  agentToolHandlers?: Array<{ toolId: string }>
}

export type ExtensionPromptResourceKind = 'preset' | 'setting' | 'logic' | 'runtime' | 'history' | 'prompt'

export type ExtensionPromptResourceContribution = {
  id: string
  resourceKind: ExtensionPromptResourceKind
  source: string
  settingMounts?: Array<{
    resourceId: string
    orderIndex?: number
  }>
  toolMounts?: Array<{
    toolId: string
    orderIndex?: number
    defaultEnabled?: boolean
    activation?: JsonObject
    provider?: { order?: number }
    content?: { zone?: string; slot?: string; rankKey?: string; orderHint?: number }
  }>
}

export type ExtensionAgentToolContribution = {
  id: string
  source: string
}

export type ExtensionPackageContributions = {
  transformRules?: Array<{ source: string }>
  promptResources?: ExtensionPromptResourceContribution[]
  agentTools?: ExtensionAgentToolContribution[]
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
  | { kind: 'card'; cardId: string }
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
  agentTools: {
    register(toolId: string, handler: ExtensionAgentToolHandler): ExtensionRegistrationHandle
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

export type ExtensionAgentToolHandlerInput = {
  arguments?: JsonObject
  rawInput?: string
  transport?: 'native-function' | 'provider-custom' | 'content'
}

export type ExtensionAgentToolHandlerContext = {
  signal: AbortSignal
}

export type ExtensionAgentToolHandler = (
  input: ExtensionAgentToolHandlerInput,
  context: ExtensionAgentToolHandlerContext,
) => JsonValue | Promise<JsonValue>

export type ServerExtensionModule = {
  activate(ctx: ExtensionActivationContext): void | Promise<void>
}

export function defineServerExtension(module: ServerExtensionModule): ServerExtensionModule {
  return module
}
