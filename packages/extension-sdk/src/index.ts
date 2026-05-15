import type { DiagnosticInput } from '@loom-studio/diagnostics'
import type { DocumentRecord, ListDocumentsInput, WriteDocumentInput, WriteDocumentResult } from '@loom-studio/document-store'
import type { JsonValue } from '@loom-studio/shared'

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
  capabilities?: Record<string, JsonValue>
  contributes?: {
    rpc?: Array<{ name: string }>
    documentTypes?: Array<{ type: string }>
    events?: Array<{ name: string }>
  }
}

export type ExtensionRegistrationHandle = {
  dispose(): void | Promise<void>
}

export type ExtensionRpcHandler = (params: JsonValue | undefined, context: ExtensionRpcContext) => JsonValue | Promise<JsonValue>

export type ExtensionRpcContext = {
  extensionId: string
  clientId?: string
  correlationId?: string
  callId?: string
  parentCallId?: string
}

export type ExtensionActivationContext = {
  extension: {
    id: string
    version: string
    displayName: string
    directory: string
  }
  rpc: {
    register(name: string, handler: ExtensionRpcHandler): ExtensionRegistrationHandle
    call<T = JsonValue>(method: string, params?: JsonValue): Promise<T>
  }
  events: {
    emit(name: string, payload: JsonValue): void
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
    onDispose(callback: () => void | Promise<void>): void
  }
}

export type ServerExtensionModule = {
  activate(ctx: ExtensionActivationContext): void | Promise<void>
}

export function defineServerExtension(module: ServerExtensionModule): ServerExtensionModule {
  return module
}
