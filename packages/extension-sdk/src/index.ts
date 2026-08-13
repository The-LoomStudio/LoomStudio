import type { DiagnosticInput } from '@loom-studio/diagnostics'
import type { DocumentRecord, ListDocumentsInput, WriteDocumentInput, WriteDocumentResult } from '@loom-studio/document-store'
import type { JsonObject, JsonValue } from '@loom-studio/shared'
import type { StudioEvent } from '@loom-studio/transport'

export type { JsonValue } from '@loom-studio/shared'

export type EventVisibility = 'public' | 'protected' | 'internal'

export type EventStability = 'experimental' | 'stable' | 'deprecated'

export type EventCapabilityCategory =
  | 'documents'
  | 'narrative'
  | 'agent'
  | 'diagnostics'
  | 'platform-data'
  | `extension:${string}`

export type EventOwner =
  | { kind: 'kernel' }
  | { kind: 'application' }
  | { kind: 'extension'; extensionId: string }

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
      extensionId: string
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
      extensionId: string
      instanceId: string
      capabilities: readonly EventCapabilityCategory[]
    }

export type EventPublishIdentity =
  | { kind: 'kernel' }
  | { kind: 'application' }
  | {
      kind: 'extension'
      extensionId: string
      instanceId: string
    }

export type ExtensionManifest = {
  manifestVersion: 1
  id: string
  version: string
  displayName: string
  engines: {
    studio: string
    loom?: string
  }
  server?: {
    entry: string
  }
  client?: {
    entry: string
  }
  roles?: string[]
  capabilities?: {
    'events.subscribe'?: EventCapabilityCategory[]
    [key: string]: JsonValue | undefined
  }
  contributes?: {
    rpc?: Array<{ name: string }>
    documentTypes?: Array<{ type: string }>
    events?: Array<{
      name: string
      version: number
      visibility: Exclude<EventVisibility, 'internal'>
    }>
  }
}

export type ExtensionRegistrationHandle = {
  dispose(): void | Promise<void>
}

export type ExtensionRpcHandler = (params: JsonValue | undefined, context: ExtensionRpcContext) => JsonValue | Promise<JsonValue>

export type ExtensionRpcContext = {
  extensionId: string
  instanceId: string
  clientId?: string
  correlationId?: string
  callId?: string
  parentCallId?: string
}

export type ExtensionActivationContext = {
  extension: {
    id: string
    instanceId: string
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
  documents: {
    get<T = JsonValue>(id: string): Promise<DocumentRecord<T> | null>
    list(query?: ListDocumentsInput): Promise<DocumentRecord[]>
    write(input: Omit<WriteDocumentInput, 'actor' | 'correlationId' | 'callId' | 'parentCallId'>): Promise<WriteDocumentResult>
    delete(id: string, options?: { expectedVersion?: number; reason?: string }): Promise<WriteDocumentResult>
  }
  diagnostics: {
    report(input: Omit<DiagnosticInput, 'extensionId' | 'source'> & { source?: string }): void
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
