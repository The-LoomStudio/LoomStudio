import type { Diagnostic, DiagnosticInput, DiagnosticsRegistry } from '@loom-studio/diagnostics'
import type { ActorRef, DocumentStore, ListDocumentsInput, WriteDocumentInput, WriteDocumentResult } from '@loom-studio/document-store'
import type { ExtensionActivationContext, ExtensionManifest, ExtensionRpcHandler, ServerExtensionModule } from '@loom-studio/extension-sdk'
export type { ExtensionRpcHandler } from '@loom-studio/extension-sdk'
import type { JsonObject, JsonValue } from '@loom-studio/shared'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export type ExtensionState = 'discovered' | 'manifestLoaded' | 'manifestValidated' | 'loaded' | 'activating' | 'active' | 'degraded' | 'disabled'

export type ExtensionSummary = {
  id: string
  version: string
  displayName?: string
  state: ExtensionState
  roles?: string[]
  contributions?: {
    rpc?: string[]
    documentTypes?: string[]
    events?: string[]
  }
}

export type ExtensionRpcContext = {
  extensionId: string
  clientId?: string
  correlationId?: string
  callId?: string
  parentCallId?: string
}

export type ExtensionRpcRegistration = {
  name: string
  ownerExtensionId: string
  handler: ExtensionRpcHandler
  dispose(): void
}

export type ExtensionHostLogger = {
  info(message: string, fields?: { event?: string; data?: JsonObject }): void
  error(message: string, fields?: { event?: string; data?: JsonObject }): void
}

export type ExtensionHostOptions = {
  documents: DocumentStore
  diagnostics: DiagnosticsRegistry
  logger?: ExtensionHostLogger
  callRpc(method: string, params?: JsonValue, context?: ExtensionRpcContext): Promise<JsonValue>
  registerRpc(name: string, ownerExtensionId: string, handler: ExtensionRpcHandler): ExtensionRpcRegistration
  emitEvent(name: string, payload: JsonValue, ownerExtensionId: string): void
}

export type ExtensionHost = {
  discover(directory: string): Promise<ExtensionSummary>
  activate(extensionId: string): Promise<ExtensionSummary>
  activateAll(): Promise<ExtensionSummary[]>
  dispose(extensionId: string): Promise<void>
  list(): ExtensionSummary[]
  diagnostics(extensionId?: string): Diagnostic[]
}

type ExtensionRecord = {
  directory: string
  manifest?: ExtensionManifest
  state: ExtensionState
  registrations: ExtensionRpcRegistration[]
  disposeCallbacks: Array<() => void | Promise<void>>
}

const kernelNamespaces = ['system', 'events', 'docs', 'extensions', 'diagnostics', 'loom', 'trace', 'audit']

export function createExtensionHost(options: ExtensionHostOptions): ExtensionHost {
  const records = new Map<string, ExtensionRecord>()

  return {
    discover: async directory => {
      const manifest = readManifest(directory)
      validateManifest(manifest)
      const record: ExtensionRecord = {
        directory,
        manifest,
        state: 'manifestValidated',
        registrations: [],
        disposeCallbacks: [],
      }
      records.set(manifest.id, record)
      options.logger?.info(`${manifest.id} discovered · v${manifest.version}`, {
        event: 'extension.discovered',
        data: {
          extensionId: manifest.id,
          version: manifest.version,
          state: record.state,
          contributions: contributionCounts(manifest),
        },
      })
      return toSummary(record)
    },

    activate: extensionId => activateRecord(extensionId, records, options),

    activateAll: async () => {
      const summaries: ExtensionSummary[] = []
      for (const id of [...records.keys()].sort()) {
        summaries.push(await activateRecord(id, records, options))
      }
      return summaries
    },

    dispose: async extensionId => {
      const record = records.get(extensionId)
      if (!record) return
      await disposeRecord(record)
      record.state = 'disabled'
      options.logger?.info(`${extensionId} disposed`, {
        event: 'extension.disposed',
        data: { extensionId, state: record.state },
      })
    },

    list: () => [...records.values()].map(toSummary),
    diagnostics: extensionId => options.diagnostics.list(extensionId ? { extensionId } : undefined),
  }
}

async function activateRecord(extensionId: string, records: Map<string, ExtensionRecord>, options: ExtensionHostOptions): Promise<ExtensionSummary> {
  const record = records.get(extensionId)
  if (!record?.manifest) throw new Error(`Extension not found: ${extensionId}`)
  const startedAt = performance.now()
  record.state = 'activating'
  options.logger?.info(`${extensionId} activation started`, {
    event: 'extension.activation.started',
    data: { extensionId, version: record.manifest.version, state: record.state },
  })

  try {
    const module = await loadServerModule(record)
    record.state = 'loaded'
    await module.activate(createContext(record, options))
    record.state = hasContributionMismatch(record, options) ? 'degraded' : 'active'
    const durationMs = elapsedMs(startedAt)
    options.logger?.info(`${extensionId} activated · ${record.state} · ${durationMs} ms`, {
      event: 'extension.activation.completed',
      data: {
        extensionId,
        version: record.manifest.version,
        state: record.state,
        durationMs,
        contributions: contributionCounts(record.manifest),
      },
    })
  } catch (error) {
    record.state = 'disabled'
    reportDiagnostic(options.diagnostics, extensionId, {
      severity: 'error',
      code: 'extension.activation_failed',
      message: error instanceof Error ? error.message : String(error),
      source: 'extension-host',
    })
    await disposeRecord(record)
    const durationMs = elapsedMs(startedAt)
    options.logger?.error(`${extensionId} activation failed after ${durationMs} ms`, {
      event: 'extension.activation.failed',
      data: {
        extensionId,
        version: record.manifest.version,
        state: record.state,
        durationMs,
        failureType: error instanceof Error ? error.name : typeof error,
        ...errorCode(error),
      },
    })
  }

  return toSummary(record)
}

function contributionCounts(manifest: ExtensionManifest): { rpc: number; documentTypes: number; events: number } {
  return {
    rpc: manifest.contributes?.rpc?.length ?? 0,
    documentTypes: manifest.contributes?.documentTypes?.length ?? 0,
    events: manifest.contributes?.events?.length ?? 0,
  }
}

function elapsedMs(startedAt: number): number {
  return Number((performance.now() - startedAt).toFixed(2))
}

function errorCode(error: unknown): { errorCode?: string } {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? { errorCode: error.code }
    : {}
}

export function parseExtensionManifest(value: unknown): ExtensionManifest {
  if (!isRecord(value)) throw new Error('Manifest must be an object')
  const manifest = value as Partial<ExtensionManifest>
  validateManifest(manifest)
  return manifest as ExtensionManifest
}

function readManifest(directory: string): ExtensionManifest {
  const manifestPath = resolve(directory, 'manifest.json')
  if (!existsSync(manifestPath)) throw new Error(`Manifest not found: ${manifestPath}`)
  return parseExtensionManifest(JSON.parse(readFileSync(manifestPath, 'utf8')))
}

function validateManifest(manifest: Partial<ExtensionManifest>): void {
  if (manifest.manifestVersion !== 1) throw new Error('manifestVersion must be 1')
  if (!manifest.id) throw new Error('Manifest id is required')
  if (!manifest.version) throw new Error('Manifest version is required')
  if (!manifest.displayName) throw new Error('Manifest displayName is required')
  if (!manifest.engines?.studio) throw new Error('engines.studio is required')
  if (!manifest.server?.entry) throw new Error('server.entry is required')
}

async function loadServerModule(record: ExtensionRecord): Promise<ServerExtensionModule> {
  const entry = record.manifest?.server?.entry
  if (!entry) throw new Error('server.entry is required')
  const modulePath = resolve(record.directory, entry)
  const loaded = await import(`${pathToFileURL(modulePath).href}?v=${Date.now()}`) as Partial<ServerExtensionModule> & { default?: ServerExtensionModule }
  if (loaded.activate) return loaded as ServerExtensionModule
  if (loaded.default?.activate) return loaded.default
  throw new Error('Server extension must export activate(ctx)')
}

function createContext(record: ExtensionRecord, options: ExtensionHostOptions): ExtensionActivationContext {
  const manifest = record.manifest!
  const extensionActor: ActorRef = { kind: 'extension', id: manifest.id }

  return {
    extension: {
      id: manifest.id,
      version: manifest.version,
      displayName: manifest.displayName,
      directory: record.directory,
    },
    rpc: {
      register: (name, handler) => {
        if (isKernelNamespace(name)) throw new Error(`Extension cannot register Kernel namespace RPC: ${name}`)
        const registration = options.registerRpc(name, manifest.id, handler)
        record.registrations.push(registration)
        if (!manifest.contributes?.rpc?.some(rpc => rpc.name === name)) {
          reportDiagnostic(options.diagnostics, manifest.id, {
            severity: 'warning',
            code: 'extension.rpc_not_declared',
            message: `RPC ${name} is not declared in manifest contributes.rpc`,
            source: 'extension-host',
          })
        }
        return registration
      },
      call: async <T = JsonValue>(method: string, params?: JsonValue) => options.callRpc(method, params) as Promise<T>,
    },
    events: {
      emit: (name, payload) => options.emitEvent(name, payload, manifest.id),
    },
    documents: {
      get: id => options.documents.get(id) as never,
      list: async (query?: ListDocumentsInput) => (await options.documents.list(query)).items,
      write: async (input: Omit<WriteDocumentInput, 'actor' | 'correlationId' | 'callId' | 'parentCallId'>): Promise<WriteDocumentResult> => {
        const result = await options.documents.write({
          ...input,
          meta: {
            ...input.meta,
            ownerExtensionId: manifest.id,
          },
          actor: extensionActor,
        })
        return result
      },
      delete: async (id, deleteOptions) => {
        const result = await options.documents.delete({
          id,
          expectedVersion: deleteOptions?.expectedVersion,
          reason: deleteOptions?.reason,
          actor: extensionActor,
        })
        return result
      },
    },
    diagnostics: {
      report: input => {
        reportDiagnostic(options.diagnostics, manifest.id, {
          ...input,
          source: input.source ?? 'extension',
        })
      },
    },
    lifecycle: {
      onDispose: callback => record.disposeCallbacks.push(callback),
    },
  }
}

function hasContributionMismatch(record: ExtensionRecord, options: ExtensionHostOptions): boolean {
  const declared = new Set(record.manifest?.contributes?.rpc?.map(rpc => rpc.name) ?? [])
  const registered = new Set(record.registrations.map(registration => registration.name))
  let mismatched = false

  for (const registration of record.registrations) {
    if (!declared.has(registration.name)) mismatched = true
  }

  for (const name of declared) {
    if (registered.has(name)) continue
    mismatched = true
    reportDiagnostic(options.diagnostics, record.manifest!.id, {
      severity: 'warning',
      code: 'extension.rpc_declared_but_not_registered',
      message: `RPC ${name} is declared in manifest contributes.rpc but was not registered during activation`,
      source: 'extension-host',
    })
  }

  return mismatched
}

async function disposeRecord(record: ExtensionRecord): Promise<void> {
  for (const registration of record.registrations.splice(0)) {
    registration.dispose()
  }
  for (const callback of record.disposeCallbacks.splice(0)) {
    await callback()
  }
}

function toSummary(record: ExtensionRecord): ExtensionSummary {
  return {
    id: record.manifest?.id ?? 'unknown',
    version: record.manifest?.version ?? '0.0.0',
    displayName: record.manifest?.displayName,
    state: record.state,
    roles: record.manifest?.roles,
    contributions: {
      rpc: record.manifest?.contributes?.rpc?.map(rpc => rpc.name),
      documentTypes: record.manifest?.contributes?.documentTypes?.map(item => item.type),
      events: record.manifest?.contributes?.events?.map(item => item.name),
    },
  }
}

function reportDiagnostic(registry: DiagnosticsRegistry, extensionId: string, input: Omit<DiagnosticInput, 'extensionId'>): void {
  registry.add({
    ...input,
    extensionId,
  })
}

function isKernelNamespace(name: string): boolean {
  return kernelNamespaces.includes(name.split('.')[0] ?? '')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
