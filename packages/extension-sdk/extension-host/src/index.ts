import type { Diagnostic, DiagnosticInput, DiagnosticsRegistry } from '@loom-studio/diagnostics'
import type { ActorRef, DocumentStore, ListDocumentsInput, WriteDocumentInput, WriteDocumentResult } from '@loom-studio/document-store'
import type {
  EventCapabilityCategory,
  EventDefinitionRegistrationOwner,
  EventPublishIdentity,
  EventSubscriberIdentity,
  ExtensionActivationContext,
  ExtensionEventDefinition,
  ExtensionManifest,
  ExtensionRpcHandler,
  ServerExtensionModule,
} from '@loom-studio/extension-sdk'
export type { ExtensionRpcHandler } from '@loom-studio/extension-sdk'
export type { EventCapabilityCategory, ExtensionManifest } from '@loom-studio/extension-sdk'
import type { JsonObject, JsonValue } from '@loom-studio/shared'
import { createId, serializeError } from '@loom-studio/shared'
import type { StudioEvent } from '@loom-studio/transport'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

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

export type ExtensionSummary = {
  id: string
  version: string
  displayName?: string
  state: ExtensionState
  instance?: {
    instanceId: string
    state: ExtensionInstanceState
  }
  roles?: string[]
  contributions?: {
    rpc?: string[]
    documentTypes?: string[]
    events?: string[]
  }
}

export type ExtensionRpcContext = {
  extensionId: string
  instanceId: string
  clientId?: string
  correlationId?: string
  callId?: string
  parentCallId?: string
}

export type ExtensionRpcRegistration = {
  name: string
  ownerExtensionId: string
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
  grantEventCapabilities?(manifest: ExtensionManifest): readonly EventCapabilityCategory[]
  callRpc(method: string, params?: JsonValue, context?: ExtensionRpcContext): Promise<JsonValue>
  registerRpc(name: string, ownerExtensionId: string, handler: ExtensionRpcHandler, ownerInstanceId: string): ExtensionRpcRegistration
  registerEventDefinition?(definition: ExtensionEventDefinition & {
    owner: { kind: 'extension'; extensionId: string }
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
  discover(directory: string): Promise<ExtensionSummary>
  activate(extensionId: string): Promise<ExtensionSummary>
  activateAll(): Promise<ExtensionSummary[]>
  reload(extensionId: string): Promise<ExtensionSummary>
  dispose(extensionId: string): Promise<void>
  disposeAll(): Promise<void>
  list(): ExtensionSummary[]
  diagnostics(extensionId?: string): Diagnostic[]
}

type Disposable = {
  dispose(): void | Promise<void>
}

type ScopeEntry = {
  kind: string
  disposable: Disposable
}

type ExtensionScope = {
  readonly instanceId: string
  readonly signal: AbortSignal
  readonly active: boolean
  track(kind: string, disposable: Disposable): void
  run<T>(callback: () => T | Promise<T>): Promise<T>
  dispose(): Promise<void>
}

type ExtensionInstance = {
  instanceId: string
  state: ExtensionInstanceState
  scope: ExtensionScope
  registeredRpcNames: Set<string>
  registeredEventNames: Set<string>
  grantedEventCapabilities: readonly EventCapabilityCategory[]
}

type ExtensionRecord = {
  directory: string
  manifest?: ExtensionManifest
  state: ExtensionState
  instance?: ExtensionInstance
}

const kernelNamespaces = ['system', 'events', 'docs', 'extensions', 'diagnostics', 'loom', 'trace', 'audit']

export function createExtensionHost(options: ExtensionHostOptions): ExtensionHost {
  const records = new Map<string, ExtensionRecord>()

  return {
    discover: async directory => {
      const manifest = readManifest(directory)
      validateManifest(manifest)
      const previous = records.get(manifest.id)
      if (previous?.instance && isLiveInstance(previous.instance.state)) {
        throw new Error(`Cannot rediscover active extension: ${manifest.id}`)
      }
      const record: ExtensionRecord = {
        directory,
        manifest,
        state: 'manifestValidated',
        instance: previous?.instance,
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

    reload: async extensionId => {
      const record = records.get(extensionId)
      if (!record) throw new Error(`Extension not found: ${extensionId}`)
      await stopInstance(record, options)
      return activateRecord(extensionId, records, options)
    },

    dispose: async extensionId => {
      const record = records.get(extensionId)
      if (!record) return
      try {
        await stopInstance(record, options)
      } finally {
        record.state = 'disabled'
        options.logger?.info(`${extensionId} disposed`, {
          event: 'extension.disposed',
          data: {
            extensionId,
            ...(record.instance ? { instanceId: record.instance.instanceId } : {}),
            state: record.instance?.state ?? record.state,
          },
        })
      }
    },

    disposeAll: async () => {
      const errors: unknown[] = []
      for (const record of [...records.values()].reverse()) {
        if (!record.manifest || !record.instance || !isLiveInstance(record.instance.state)) continue
        try {
          await stopInstance(record, options)
        } catch (error) {
          errors.push(error)
        }
        record.state = 'disabled'
      }
      if (errors.length > 0) throw new AggregateError(errors, 'One or more extensions failed to dispose')
    },

    list: () => [...records.values()].map(toSummary),
    diagnostics: extensionId => options.diagnostics.list(extensionId ? { extensionId } : undefined),
  }
}

async function activateRecord(
  extensionId: string,
  records: Map<string, ExtensionRecord>,
  options: ExtensionHostOptions,
): Promise<ExtensionSummary> {
  const record = records.get(extensionId)
  if (!record?.manifest) throw new Error(`Extension not found: ${extensionId}`)
  if (record.instance && isLiveInstance(record.instance.state)) {
    throw new Error(`Extension already active: ${extensionId}`)
  }

  const startedAt = performance.now()
  const instanceId = createId('extinst')
  const instance: ExtensionInstance = {
    instanceId,
    state: 'created',
    scope: createExtensionScope(instanceId),
    registeredRpcNames: new Set(),
    registeredEventNames: new Set(),
    grantedEventCapabilities: [...new Set(options.grantEventCapabilities?.(record.manifest) ?? [])],
  }
  record.instance = instance
  record.state = 'activating'
  instance.state = 'activating'
  options.logger?.info(`${extensionId} activation started`, {
    event: 'extension.activation.started',
    data: { extensionId, instanceId, version: record.manifest.version, state: instance.state },
  })

  try {
    const module = await loadServerModule(record, instanceId)
    record.state = 'loaded'
    await instance.scope.run(() => module.activate(createContext(record, instance, options)))
    const mismatched = hasContributionMismatch(record, instance, options)
    instance.state = mismatched ? 'degraded' : 'active'
    record.state = instance.state
    const durationMs = elapsedMs(startedAt)
    options.logger?.info(`${extensionId} activated · ${record.state} · ${durationMs} ms`, {
      event: 'extension.activation.completed',
      data: {
        extensionId,
        instanceId,
        version: record.manifest.version,
        state: instance.state,
        durationMs,
        contributions: contributionCounts(record.manifest),
      },
    })
  } catch (error) {
    instance.state = 'activation_failed'
    record.state = 'disabled'
    reportDiagnostic(options.diagnostics, extensionId, instanceId, {
      severity: 'error',
      code: 'extension.activation_failed',
      message: error instanceof Error ? error.message : String(error),
      source: 'extension-host',
    })
    await disposeFailedActivation(record, options)
    const durationMs = elapsedMs(startedAt)
    options.logger?.error(`${extensionId} activation failed after ${durationMs} ms`, {
      event: 'extension.activation.failed',
      data: {
        extensionId,
        instanceId,
        version: record.manifest.version,
        state: instance.state,
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

  for (const event of manifest.contributes?.events ?? []) {
    if (!event.name.startsWith(`${manifest.id}.`)) throw new Error(`Manifest event must use extension namespace: ${event.name}`)
    if (!Number.isInteger(event.version) || event.version < 1) throw new Error(`Manifest event version must be positive: ${event.name}`)
    if (event.visibility !== 'public' && event.visibility !== 'protected') {
      throw new Error(`Manifest event visibility must be public or protected: ${event.name}`)
    }
  }

  const eventCapabilities = manifest.capabilities?.['events.subscribe']
  if (eventCapabilities !== undefined && (!Array.isArray(eventCapabilities) || !eventCapabilities.every(value => typeof value === 'string'))) {
    throw new Error('capabilities.events.subscribe must be a string array')
  }
}

async function loadServerModule(record: ExtensionRecord, instanceId: string): Promise<ServerExtensionModule> {
  const entry = record.manifest?.server?.entry
  if (!entry) throw new Error('server.entry is required')
  const directory = realpathSync(record.directory)
  const modulePath = realpathSync(resolve(directory, entry))
  const pathFromDirectory = relative(directory, modulePath)
  if (!pathFromDirectory || pathFromDirectory.startsWith('..') || isAbsolute(pathFromDirectory)) {
    throw new Error(`Extension server entry must stay inside its directory: ${entry}`)
  }
  const loaded = await import(`${pathToFileURL(modulePath).href}?instance=${encodeURIComponent(instanceId)}`) as Partial<ServerExtensionModule> & { default?: ServerExtensionModule }
  if (loaded.activate) return loaded as ServerExtensionModule
  if (loaded.default?.activate) return loaded.default
  throw new Error('Server extension must export activate(ctx)')
}

function createContext(
  record: ExtensionRecord,
  instance: ExtensionInstance,
  options: ExtensionHostOptions,
): ExtensionActivationContext {
  const manifest = record.manifest!
  const extensionActor: ActorRef = { kind: 'extension', id: manifest.id }
  const publisher: EventPublishIdentity = { kind: 'extension', extensionId: manifest.id, instanceId: instance.instanceId }
  const subscriber: EventSubscriberIdentity = {
    kind: 'extension',
    extensionId: manifest.id,
    instanceId: instance.instanceId,
    capabilities: instance.grantedEventCapabilities,
  }

  return {
    extension: {
      id: manifest.id,
      instanceId: instance.instanceId,
      version: manifest.version,
      displayName: manifest.displayName,
      directory: record.directory,
    },
    logger: createExtensionLogger(manifest.id, instance.instanceId, options.logger),
    permissions: {
      events: { subscribe: instance.grantedEventCapabilities },
    },
    rpc: {
      register: (name, handler) => {
        assertScopeActive(instance)
        if (isKernelNamespace(name)) throw new Error(`Extension cannot register Kernel namespace RPC: ${name}`)
        const wrapped: ExtensionRpcHandler = (params, context) => instance.scope.run(() => handler(params, context))
        const registration = options.registerRpc(name, manifest.id, wrapped, instance.instanceId)
        instance.scope.track(`rpc:${name}`, registration)
        instance.registeredRpcNames.add(name)
        if (!manifest.contributes?.rpc?.some(rpc => rpc.name === name)) {
          if (options.mode === 'production') throw new Error(`RPC ${name} is not declared in manifest contributes.rpc`)
          reportDiagnostic(options.diagnostics, manifest.id, instance.instanceId, {
            severity: 'warning',
            code: 'extension.rpc_not_declared',
            message: `RPC ${name} is not declared in manifest contributes.rpc`,
            source: 'extension-host',
          })
        }
        return registration
      },
      call: async <T = JsonValue>(method: string, params?: JsonValue) => options.callRpc(method, params, {
        extensionId: manifest.id,
        instanceId: instance.instanceId,
      }) as Promise<T>,
    },
    events: {
      define: definition => {
        assertScopeActive(instance)
        const declared = manifest.contributes?.events?.find(event => event.name === definition.name)
        if (!declared) {
          if (options.mode === 'production') throw new Error(`Event ${definition.name} is not declared in manifest contributes.events`)
          reportDiagnostic(options.diagnostics, manifest.id, instance.instanceId, {
            severity: 'warning',
            code: 'extension.event_not_declared',
            message: `Event ${definition.name} is not declared in manifest contributes.events`,
            source: 'extension-host',
          })
        } else if (declared.version !== definition.version || declared.visibility !== definition.visibility) {
          throw new Error(`Event ${definition.name} does not match manifest version/visibility`)
        }

        if (!options.registerEventDefinition) throw new Error('Extension event definitions are not available in this host')
        const registration = options.registerEventDefinition({
          ...definition,
          owner: { kind: 'extension', extensionId: manifest.id },
          capability: definition.visibility === 'protected' ? `extension:${manifest.id}` : undefined,
        }, {
          kind: 'extension',
          extensionId: manifest.id,
          instanceId: instance.instanceId,
        })
        instance.scope.track(`event-definition:${definition.name}`, registration)
        instance.registeredEventNames.add(definition.name)
        return registration
      },
      emit: (name, payload) => {
        assertScopeActive(instance)
        if (!options.emitEvent) throw new Error('Extension event publishing is not available in this host')
        return options.emitEvent(name, payload, publisher)
      },
      subscribe: (patterns, handler) => {
        assertScopeActive(instance)
        if (!options.subscribeEvents) throw new Error('Extension event subscriptions are not available in this host')
        const registration = options.subscribeEvents(patterns, event => instance.scope.run(() => handler(event)), subscriber)
        instance.scope.track(`event-subscription:${patterns.join(',')}`, registration)
        return registration
      },
    },
    documents: {
      get: id => options.documents.get(id) as never,
      list: async (query?: ListDocumentsInput) => (await options.documents.list(query)).items,
      write: async (input: Omit<WriteDocumentInput, 'actor' | 'correlationId' | 'callId' | 'parentCallId'>): Promise<WriteDocumentResult> => {
        assertScopeActive(instance)
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
        assertScopeActive(instance)
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
        reportDiagnostic(options.diagnostics, manifest.id, instance.instanceId, {
          ...input,
          source: input.source ?? 'extension',
        })
      },
    },
    lifecycle: {
      signal: instance.scope.signal,
      onDispose: callback => instance.scope.track('lifecycle-callback', { dispose: callback }),
    },
  }
}

function createExtensionLogger(
  extensionId: string,
  instanceId: string,
  logger: ExtensionHostLogger | undefined,
): ExtensionActivationContext['logger'] {
  const write = (level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: JsonObject) => {
    const fields = {
      event: 'extension.runtime.log',
      data: { extensionId, instanceId, ...data },
    }
    if (level === 'debug') logger?.debug?.(message, fields)
    else if (level === 'warn') (logger?.warn ?? logger?.info)?.(message, fields)
    else logger?.[level](message, fields)
  }

  return {
    debug: (message, data) => write('debug', message, data),
    info: (message, data) => write('info', message, data),
    warn: (message, data) => write('warn', message, data),
    error: (message, data) => write('error', message, data),
  }
}

function hasContributionMismatch(record: ExtensionRecord, instance: ExtensionInstance, options: ExtensionHostOptions): boolean {
  const manifest = record.manifest!
  let mismatched = false
  const declaredRpcNames = new Set(manifest.contributes?.rpc?.map(rpc => rpc.name) ?? [])
  const declaredEventNames = new Set(manifest.contributes?.events?.map(event => event.name) ?? [])

  for (const name of instance.registeredRpcNames) {
    if (!declaredRpcNames.has(name)) mismatched = true
  }
  for (const name of instance.registeredEventNames) {
    if (!declaredEventNames.has(name)) mismatched = true
  }

  for (const name of declaredRpcNames) {
    if (instance.registeredRpcNames.has(name)) continue
    mismatched = true
    reportDiagnostic(options.diagnostics, manifest.id, instance.instanceId, {
      severity: 'warning',
      code: 'extension.rpc_declared_but_not_registered',
      message: `RPC ${name} is declared in manifest contributes.rpc but was not registered during activation`,
      source: 'extension-host',
    })
  }

  for (const name of declaredEventNames) {
    if (instance.registeredEventNames.has(name)) continue
    mismatched = true
    reportDiagnostic(options.diagnostics, manifest.id, instance.instanceId, {
      severity: 'warning',
      code: 'extension.event_declared_but_not_registered',
      message: `Event ${name} is declared in manifest contributes.events but was not registered during activation`,
      source: 'extension-host',
    })
  }

  return mismatched
}

async function stopInstance(record: ExtensionRecord, options: ExtensionHostOptions): Promise<void> {
  const instance = record.instance
  if (!instance || !isLiveInstance(instance.state)) return
  instance.state = 'stopping'
  try {
    await instance.scope.dispose()
    instance.state = 'disposed'
  } catch (error) {
    instance.state = 'dispose_failed'
    reportDiagnostic(options.diagnostics, record.manifest?.id ?? 'unknown', instance.instanceId, {
      severity: 'error',
      code: 'extension.dispose_failed',
      message: `Extension dispose failed: ${record.manifest?.id ?? 'unknown'}`,
      source: 'extension-host',
      details: serializeError(error, 'extension.dispose_failed'),
    })
    throw error
  }
}

async function disposeFailedActivation(record: ExtensionRecord, options: ExtensionHostOptions): Promise<void> {
  const instance = record.instance
  if (!instance) return
  try {
    await instance.scope.dispose()
  } catch (error) {
    reportDiagnostic(options.diagnostics, record.manifest?.id ?? 'unknown', instance.instanceId, {
      severity: 'error',
      code: 'extension.activation_cleanup_failed',
      message: `Extension activation cleanup failed: ${record.manifest?.id ?? 'unknown'}`,
      source: 'extension-host',
      details: serializeError(error, 'extension.activation_cleanup_failed'),
    })
  }
}

function createExtensionScope(instanceId: string): ExtensionScope {
  const abortController = new AbortController()
  const entries: ScopeEntry[] = []
  const idleWaiters = new Set<() => void>()
  let accepting = true
  let disposePromise: Promise<void> | undefined
  let inFlight = 0

  const waitForIdle = async () => {
    if (inFlight === 0) return
    await new Promise<void>(resolve => idleWaiters.add(resolve))
  }

  const scope: ExtensionScope = {
    instanceId,
    signal: abortController.signal,
    get active() {
      return accepting
    },
    track: (kind, disposable) => {
      if (!accepting) {
        void Promise.resolve().then(() => disposable.dispose()).catch(() => {})
        throw new Error(`Extension scope is stopping: ${instanceId}`)
      }
      entries.push({ kind, disposable })
    },
    run: async callback => {
      if (!accepting) throw new Error(`Extension scope is stopping: ${instanceId}`)
      inFlight += 1
      try {
        return await callback()
      } finally {
        inFlight -= 1
        if (inFlight === 0) {
          for (const resolve of idleWaiters) resolve()
          idleWaiters.clear()
        }
      }
    },
    dispose: () => {
      if (disposePromise) return disposePromise
      accepting = false
      abortController.abort()
      disposePromise = (async () => {
        await waitForIdle()
        const errors: Array<{ kind: string; error: unknown }> = []
        for (const entry of entries.splice(0).reverse()) {
          try {
            await entry.disposable.dispose()
          } catch (error) {
            errors.push({ kind: entry.kind, error })
          }
        }
        if (errors.length > 0) {
          throw new AggregateError(errors.map(item => item.error), `Extension scope cleanup failed: ${errors.map(item => item.kind).join(', ')}`)
        }
      })()
      return disposePromise
    },
  }

  return scope
}

function assertScopeActive(instance: ExtensionInstance): void {
  if (!instance.scope.active) throw new Error(`Extension instance is stopping: ${instance.instanceId}`)
}

function isLiveInstance(state: ExtensionInstanceState): boolean {
  return state === 'created' || state === 'activating' || state === 'active' || state === 'degraded' || state === 'stopping'
}

function toSummary(record: ExtensionRecord): ExtensionSummary {
  return {
    id: record.manifest?.id ?? 'unknown',
    version: record.manifest?.version ?? '0.0.0',
    displayName: record.manifest?.displayName,
    state: record.state,
    instance: record.instance ? { instanceId: record.instance.instanceId, state: record.instance.state } : undefined,
    roles: record.manifest?.roles,
    contributions: {
      rpc: record.manifest?.contributes?.rpc?.map(rpc => rpc.name),
      documentTypes: record.manifest?.contributes?.documentTypes?.map(item => item.type),
      events: record.manifest?.contributes?.events?.map(item => item.name),
    },
  }
}

function reportDiagnostic(
  registry: DiagnosticsRegistry,
  extensionId: string,
  instanceId: string,
  input: Omit<DiagnosticInput, 'extensionId' | 'instanceId'>,
): void {
  registry.add({
    ...input,
    extensionId,
    instanceId,
  })
}

function isKernelNamespace(name: string): boolean {
  return kernelNamespaces.includes(name.split('.')[0] ?? '')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
