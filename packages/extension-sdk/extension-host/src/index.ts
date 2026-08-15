import type { Diagnostic, DiagnosticInput, DiagnosticsRegistry } from '@loom-studio/diagnostics'
import type { ActorRef, DocumentRecord, DocumentStore, WriteDocumentResult } from '@loom-studio/document-store'
import type {
  EventCapabilityCategory,
  EventDefinitionRegistrationOwner,
  EventPublishIdentity,
  EventSubscriberIdentity,
  ExtensionAssetCapability,
  ExtensionActivationContext,
  ExtensionDocumentWriteInput,
  ExtensionEventDefinition,
  ExtensionManifest,
  ExtensionModuleManifest,
  ExtensionMediaAsset,
  ExtensionRpcHandler,
  ServerExtensionModule,
} from '@loom-studio/extension-sdk'
export type { ExtensionRpcHandler } from '@loom-studio/extension-sdk'
export type { EventCapabilityCategory, ExtensionAssetCapability, ExtensionManifest, ExtensionModuleManifest } from '@loom-studio/extension-sdk'
import type { JsonObject, JsonValue } from '@loom-studio/shared'
import { createId, serializeError } from '@loom-studio/shared'
import type { StudioEvent } from '@loom-studio/transport'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
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
  disposeAll(): Promise<void>
  list(): ExtensionModuleSummary[]
  diagnostics(packageId?: string, moduleId?: string): Diagnostic[]
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
  grantedAssetCapabilities: readonly ExtensionAssetCapability[]
}

type ExtensionModuleRecord = {
  directory: string
  packageManifest: ExtensionManifest
  moduleManifest: ExtensionModuleManifest & { runtime: 'server' }
  state: ExtensionState
  instance?: ExtensionInstance
}

const kernelNamespaces = ['system', 'events', 'docs', 'extensions', 'diagnostics', 'loom', 'trace', 'audit']
const studioReservedNamespaces = [...kernelNamespaces, 'application', 'logs', 'studio']

export function createExtensionHost(options: ExtensionHostOptions): ExtensionHost {
  const records = new Map<string, ExtensionModuleRecord>()

  return {
    discover: async directory => {
      const manifest = readManifest(directory)
      const summaries: ExtensionModuleSummary[] = []
      for (const moduleManifest of serverModules(manifest)) {
        const key = moduleKey(manifest.id, moduleManifest.id)
        const previous = records.get(key)
        if (previous?.instance && isLiveInstance(previous.instance.state)) {
          throw new Error(`Cannot rediscover active extension module: ${key}`)
        }
        const record: ExtensionModuleRecord = {
          directory,
          packageManifest: manifest,
          moduleManifest,
          state: 'manifestValidated',
          instance: previous?.instance,
        }
        records.set(key, record)
        summaries.push(toSummary(record))
      }
      options.logger?.info(`${manifest.id} discovered · v${manifest.version}`, {
        event: 'extension.discovered',
        data: {
          packageId: manifest.id,
          version: manifest.version,
          serverModuleCount: summaries.length,
        },
      })
      return summaries
    },

    activate: (packageId, moduleId) => activateRecord(packageId, moduleId, records, options),

    activateAll: async () => {
      const summaries: ExtensionModuleSummary[] = []
      for (const record of [...records.values()].sort(compareRecords)) {
        summaries.push(await activateRecord(record.packageManifest.id, record.moduleManifest.id, records, options))
      }
      return summaries
    },

    reload: async (packageId, moduleId) => {
      const record = records.get(moduleKey(packageId, moduleId))
      if (!record) throw new Error(`Extension module not found: ${moduleKey(packageId, moduleId)}`)
      await stopInstance(record, options)
      return activateRecord(packageId, moduleId, records, options)
    },

    dispose: async (packageId, moduleId) => {
      const key = moduleKey(packageId, moduleId)
      const record = records.get(key)
      if (!record) return
      try {
        await stopInstance(record, options)
      } finally {
        record.state = 'disabled'
        options.logger?.info(`${key} disposed`, {
          event: 'extension.disposed',
          data: {
            packageId,
            moduleId,
            ...(record.instance ? { instanceId: record.instance.instanceId } : {}),
            state: record.instance?.state ?? record.state,
          },
        })
      }
    },

    disposeAll: async () => {
      const errors: unknown[] = []
      for (const record of [...records.values()].reverse()) {
        if (!record.instance || !isLiveInstance(record.instance.state)) continue
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
    diagnostics: (packageId, moduleId) => options.diagnostics.list({ packageId, moduleId }),
  }
}

async function activateRecord(
  packageId: string,
  moduleId: string,
  records: Map<string, ExtensionModuleRecord>,
  options: ExtensionHostOptions,
): Promise<ExtensionModuleSummary> {
  const key = moduleKey(packageId, moduleId)
  const record = records.get(key)
  if (!record) throw new Error(`Extension module not found: ${key}`)
  if (record.instance && isLiveInstance(record.instance.state)) {
    throw new Error(`Extension module already active: ${key}`)
  }

  const startedAt = performance.now()
  const instanceId = createId('extinst')
  const instance: ExtensionInstance = {
    instanceId,
    state: 'created',
    scope: createExtensionScope(instanceId),
    registeredRpcNames: new Set(),
    registeredEventNames: new Set(),
    grantedEventCapabilities: [...new Set(options.grantEventCapabilities?.(record.packageManifest, record.moduleManifest) ?? [])],
    grantedAssetCapabilities: [...new Set(options.grantAssetCapabilities?.(record.packageManifest, record.moduleManifest) ?? [])],
  }
  record.instance = instance
  record.state = 'activating'
  instance.state = 'activating'
  options.logger?.info(`${key} activation started`, {
    event: 'extension.activation.started',
    data: { packageId, moduleId, instanceId, version: record.packageManifest.version, state: instance.state },
  })

  try {
    const module = await loadServerModule(record, instanceId)
    record.state = 'loaded'
    await instance.scope.run(() => module.activate(createContext(record, instance, options)))
    const mismatched = hasContributionMismatch(record, instance, options)
    instance.state = mismatched ? 'degraded' : 'active'
    record.state = instance.state
    const durationMs = elapsedMs(startedAt)
    options.logger?.info(`${key} activated · ${record.state} · ${durationMs} ms`, {
      event: 'extension.activation.completed',
      data: {
        packageId,
        moduleId,
        instanceId,
        version: record.packageManifest.version,
        state: instance.state,
        durationMs,
        contributions: contributionCounts(record.moduleManifest),
      },
    })
  } catch (error) {
    instance.state = 'activation_failed'
    record.state = 'disabled'
    reportDiagnostic(options.diagnostics, record, instanceId, {
      severity: 'error',
      code: 'extension.activation_failed',
      message: error instanceof Error ? error.message : String(error),
      source: 'extension-host',
    })
    await disposeFailedActivation(record, options)
    const durationMs = elapsedMs(startedAt)
    options.logger?.error(`${key} activation failed after ${durationMs} ms`, {
      event: 'extension.activation.failed',
      data: {
        packageId,
        moduleId,
        instanceId,
        version: record.packageManifest.version,
        state: instance.state,
        durationMs,
        failureType: error instanceof Error ? error.name : typeof error,
        ...errorCode(error),
      },
    })
  }

  return toSummary(record)
}

function contributionCounts(manifest: ExtensionModuleManifest): { rpc: number; documentTypes: number; events: number } {
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
  if (manifest.manifestVersion !== 2) throw new Error('manifestVersion must be 2')
  if (!manifest.id) throw new Error('Manifest id is required')
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(manifest.id)) throw new Error('Manifest id is invalid')
  if (studioReservedNamespaces.includes(manifest.id.split('.')[0] ?? '')) throw new Error(`Manifest id uses a reserved Studio namespace: ${manifest.id}`)
  if (!manifest.version) throw new Error('Manifest version is required')
  if (!manifest.displayName) throw new Error('Manifest displayName is required')
  if ('roles' in manifest) throw new Error('Manifest roles is obsolete; use tags')
  assertOptionalManifestText(manifest.description, 'description', 4_096)
  assertOptionalManifestText(manifest.author, 'author', 255)
  assertOptionalManifestUrl(manifest.homepage, 'homepage')
  assertOptionalManifestUrl(manifest.repository, 'repository')
  if (manifest.icon !== undefined) {
    assertOptionalManifestText(manifest.icon, 'icon', 1_024)
    if (isAbsolute(manifest.icon)) throw new Error('Manifest icon must be relative to the Package directory')
    if (!/\.(png|jpe?g|webp|gif)$/i.test(manifest.icon)) {
      throw new Error('Manifest icon must be PNG, JPEG, WebP, or GIF')
    }
  }
  if (manifest.tags !== undefined) {
    if (!Array.isArray(manifest.tags) || manifest.tags.length > 32) throw new Error('Manifest tags must be an array with at most 32 entries')
    const tags = new Set<string>()
    for (const tag of manifest.tags) {
      if (typeof tag !== 'string' || tag.length > 64 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(tag)) {
        throw new Error(`Manifest tag is invalid: ${String(tag)}`)
      }
      if (tags.has(tag)) throw new Error(`Manifest tag must be unique: ${tag}`)
      tags.add(tag)
    }
  }
  if (!manifest.engines?.studio) throw new Error('engines.studio is required')
  const moduleIds = new Set<string>()
  for (const moduleManifest of manifest.modules ?? []) {
    if (!moduleManifest.id || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(moduleManifest.id)) throw new Error('Manifest module id is invalid')
    if (moduleIds.has(moduleManifest.id)) throw new Error(`Manifest module id must be unique: ${moduleManifest.id}`)
    moduleIds.add(moduleManifest.id)
    if (moduleManifest.runtime !== 'server' && moduleManifest.runtime !== 'client') throw new Error(`Manifest module runtime is invalid: ${moduleManifest.id}`)
    if (!moduleManifest.entry) throw new Error(`Manifest module entry is required: ${moduleManifest.id}`)
    for (const event of moduleManifest.contributes?.events ?? []) {
      if (!event.name.startsWith(`${manifest.id}.`)) throw new Error(`Manifest event must use package namespace: ${event.name}`)
      if (!Number.isInteger(event.version) || event.version < 1) throw new Error(`Manifest event version must be positive: ${event.name}`)
      if (event.visibility !== 'public' && event.visibility !== 'protected') {
        throw new Error(`Manifest event visibility must be public or protected: ${event.name}`)
      }
    }
    for (const rpc of moduleManifest.contributes?.rpc ?? []) {
      if (!rpc.name.startsWith(`${manifest.id}.`)) throw new Error(`Manifest RPC must use package namespace: ${rpc.name}`)
    }
    const documentTypes = new Set<string>()
    for (const documentType of moduleManifest.contributes?.documentTypes ?? []) {
      if (!documentType.type.startsWith(`${manifest.id}.`)) throw new Error(`Manifest document type must use package namespace: ${documentType.type}`)
      if (documentTypes.has(documentType.type)) throw new Error(`Manifest document type must be unique within a module: ${documentType.type}`)
      documentTypes.add(documentType.type)
    }
    const eventCapabilities = moduleManifest.capabilities?.['events.subscribe']
    if (eventCapabilities !== undefined && (!Array.isArray(eventCapabilities) || !eventCapabilities.every(value => typeof value === 'string'))) {
      throw new Error(`Module capabilities.events.subscribe must be a string array: ${moduleManifest.id}`)
    }
    for (const capability of ['assets.publish', 'assets.read'] as const) {
      const requested = moduleManifest.capabilities?.[capability]
      if (requested !== undefined && typeof requested !== 'boolean') {
        throw new Error(`Module capabilities.${capability} must be a boolean: ${moduleManifest.id}`)
      }
    }
  }
  for (const rule of manifest.contributes?.transformRules ?? []) {
    if (!rule.source) throw new Error('Transform rule source is required')
  }
}

function assertOptionalManifestText(value: unknown, field: string, maxLength: number): void {
  if (value === undefined) return
  if (typeof value !== 'string' || !value.trim() || value !== value.trim() || value.length > maxLength || value.includes('\0')) {
    throw new Error(`Manifest ${field} is invalid`)
  }
}

function assertOptionalManifestUrl(value: unknown, field: string): void {
  if (value === undefined) return
  assertOptionalManifestText(value, field, 2_048)
  let parsed: URL
  try {
    parsed = new URL(value as string)
  } catch {
    throw new Error(`Manifest ${field} must be an absolute HTTP(S) URL`)
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`Manifest ${field} must be an absolute HTTP(S) URL`)
  }
}

async function loadServerModule(record: ExtensionModuleRecord, instanceId: string): Promise<ServerExtensionModule> {
  const entry = record.moduleManifest.entry
  const directory = realpathSync(record.directory)
  const modulePath = realpathSync(resolve(directory, entry))
  const pathFromDirectory = relative(directory, modulePath)
  if (!pathFromDirectory || pathFromDirectory.startsWith('..') || isAbsolute(pathFromDirectory)) {
    throw new Error(`Extension module entry must stay inside its package directory: ${entry}`)
  }
  const loaded = await import(`${pathToFileURL(modulePath).href}?instance=${encodeURIComponent(instanceId)}`) as Partial<ServerExtensionModule> & { default?: ServerExtensionModule }
  if (loaded.activate) return loaded as ServerExtensionModule
  if (loaded.default?.activate) return loaded.default
  throw new Error('Server extension must export activate(ctx)')
}

function createContext(
  record: ExtensionModuleRecord,
  instance: ExtensionInstance,
  options: ExtensionHostOptions,
): ExtensionActivationContext {
  const packageManifest = record.packageManifest
  const moduleManifest = record.moduleManifest
  const extensionActor: ActorRef = { kind: 'extension', id: packageManifest.id }
  const publisher: EventPublishIdentity = {
    kind: 'extension',
    packageId: packageManifest.id,
    moduleId: moduleManifest.id,
    instanceId: instance.instanceId,
  }
  const subscriber: EventSubscriberIdentity = {
    kind: 'extension',
    packageId: packageManifest.id,
    moduleId: moduleManifest.id,
    instanceId: instance.instanceId,
    capabilities: instance.grantedEventCapabilities,
  }
  let scratchTracked = false

  return {
    extension: {
      packageId: packageManifest.id,
      moduleId: moduleManifest.id,
      instanceId: instance.instanceId,
      runtime: 'server',
      version: packageManifest.version,
      displayName: packageManifest.displayName,
      directory: record.directory,
    },
    logger: createExtensionLogger(packageManifest.id, moduleManifest.id, instance.instanceId, options.logger),
    permissions: {
      events: { subscribe: instance.grantedEventCapabilities },
      assets: instance.grantedAssetCapabilities,
    },
    rpc: {
      register: (name, handler) => {
        assertScopeActive(instance)
        if (isKernelNamespace(name)) throw new Error(`Extension cannot register Kernel namespace RPC: ${name}`)
        if (isStudioReservedNamespace(name)) throw new Error(`Extension cannot register reserved Studio namespace RPC: ${name}`)
        if (!name.startsWith(`${packageManifest.id}.`)) throw new Error(`Extension RPC must use package namespace: ${name}`)
        const wrapped: ExtensionRpcHandler = (params, context) => instance.scope.run(() => handler(params, context))
        const registration = options.registerRpc(name, packageManifest.id, moduleManifest.id, wrapped, instance.instanceId)
        instance.scope.track(`rpc:${name}`, registration)
        instance.registeredRpcNames.add(name)
        if (!moduleManifest.contributes?.rpc?.some(rpc => rpc.name === name)) {
          if (options.mode === 'production') throw new Error(`RPC ${name} is not declared in manifest contributes.rpc`)
          reportDiagnostic(options.diagnostics, record, instance.instanceId, {
            severity: 'warning',
            code: 'extension.rpc_not_declared',
            message: `RPC ${name} is not declared in manifest contributes.rpc`,
            source: 'extension-host',
          })
        }
        return registration
      },
      call: async <T = JsonValue>(method: string, params?: JsonValue) => {
        assertScopeActive(instance)
        if (isKernelNamespace(method)) throw new Error(`Extension cannot call Kernel namespace RPC through ctx.rpc: ${method}`)
        if (isStudioReservedNamespace(method)) throw new Error(`Extension cannot call reserved Studio namespace RPC through ctx.rpc: ${method}`)
        return options.callRpc(method, params, {
          packageId: packageManifest.id,
          moduleId: moduleManifest.id,
          instanceId: instance.instanceId,
        }) as Promise<T>
      },
    },
    events: {
      define: definition => {
        assertScopeActive(instance)
        const declared = moduleManifest.contributes?.events?.find(event => event.name === definition.name)
        if (!declared) {
          if (options.mode === 'production') throw new Error(`Event ${definition.name} is not declared in manifest contributes.events`)
          reportDiagnostic(options.diagnostics, record, instance.instanceId, {
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
          owner: { kind: 'extension', packageId: packageManifest.id, moduleId: moduleManifest.id },
          capability: definition.visibility === 'protected' ? `extension:${packageManifest.id}` : undefined,
        }, {
          kind: 'extension',
          packageId: packageManifest.id,
          moduleId: moduleManifest.id,
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
      get: async id => {
        assertScopeActive(instance)
        const document = await options.documents.get(id)
        if (document) assertDocumentAccess(record, document, 'read')
        return document as never
      },
      list: async query => {
        assertScopeActive(instance)
        assertDeclaredDocumentType(record, query?.type)
        return (await options.documents.list({
          ...query,
          type: query.type,
          ownerExtensionId: packageManifest.id,
        })).items
      },
      write: async (input: ExtensionDocumentWriteInput): Promise<WriteDocumentResult> => {
        assertScopeActive(instance)
        assertDeclaredDocumentType(record, input.type)
        if (input.id) {
          const existing = await options.documents.get(input.id, { includeTombstone: true })
          if (existing) assertDocumentAccess(record, existing, 'write')
        }
        const result = await options.documents.write({
          ...input,
          meta: {
            ...input.meta,
            ownerExtensionId: packageManifest.id,
          },
          actor: extensionActor,
        })
        return result
      },
      delete: async (id, deleteOptions) => {
        assertScopeActive(instance)
        const existing = await options.documents.get(id, { includeTombstone: true })
        if (!existing) throw new Error(`Extension document not found: ${id}`)
        assertDocumentAccess(record, existing, 'delete')
        const result = await options.documents.delete({
          id,
          expectedVersion: deleteOptions?.expectedVersion,
          reason: deleteOptions?.reason,
          actor: extensionActor,
        })
        return result
      },
    },
    assets: {
      publish: async input => {
        assertScopeActive(instance)
        assertAssetCapability(instance, 'assets.publish')
        if (!options.assets) throw new Error('Extension Media Assets are not available in this host')
        return await options.assets.publish({
          ...input,
          bytes: new Uint8Array(input.bytes),
          ownerPackageId: packageManifest.id,
          actor: { kind: 'extension', id: packageManifest.id },
        })
      },
      read: async (assetId, readOptions) => {
        assertScopeActive(instance)
        if (!options.assets) throw new Error('Extension Media Assets are not available in this host')
        const asset = await options.assets.get(assetId)
        if (!asset) throw new Error(`Media Asset not found: ${assetId}`)
        if (asset.ownerPackageId !== packageManifest.id) assertAssetCapability(instance, 'assets.read')
        return {
          asset,
          bytes: new Uint8Array(await options.assets.read(assetId, readOptions)),
        }
      },
      materialize: async (assetId, materializeOptions) => {
        assertScopeActive(instance)
        if (!options.assets || !options.assetScratchRoot) throw new Error('Extension Asset materialization is not available in this host')
        const asset = await options.assets.get(assetId)
        if (!asset) throw new Error(`Media Asset not found: ${assetId}`)
        if (asset.ownerPackageId !== packageManifest.id) assertAssetCapability(instance, 'assets.read')
        const fileExtension = materializeOptions?.fileExtension ?? ''
        if (fileExtension && !/^\.[A-Za-z0-9]{1,16}$/.test(fileExtension)) {
          throw new Error('Materialized Asset fileExtension must be a short dot-prefixed alphanumeric extension')
        }
        const scratchDirectory = join(options.assetScratchRoot, packageManifest.id, instance.instanceId)
        await mkdir(scratchDirectory, { recursive: true, mode: 0o700 })
        if (!scratchTracked) {
          instance.scope.track('asset-scratch', {
            dispose: () => rm(scratchDirectory, { recursive: true, force: true }),
          })
          scratchTracked = true
        }
        const path = join(scratchDirectory, `asset-${randomUUID()}${fileExtension}`)
        await writeFile(path, await options.assets.read(assetId, { maxBytes: materializeOptions?.maxBytes }), { mode: 0o600 })
        return { asset, path }
      },
    },
    diagnostics: {
      report: input => {
        reportDiagnostic(options.diagnostics, record, instance.instanceId, {
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

function assertDeclaredDocumentType(record: ExtensionModuleRecord, type: unknown): asserts type is string {
  if (typeof type !== 'string' || !record.moduleManifest.contributes?.documentTypes?.some(item => item.type === type)) {
    throw new Error(`Extension module ${moduleKey(record.packageManifest.id, record.moduleManifest.id)} did not declare document type: ${String(type)}`)
  }
}

function assertAssetCapability(instance: ExtensionInstance, capability: ExtensionAssetCapability): void {
  if (!instance.grantedAssetCapabilities.includes(capability)) {
    throw new Error(`Extension instance ${instance.instanceId} was not granted ${capability}`)
  }
}

function assertDocumentAccess(
  record: ExtensionModuleRecord,
  document: DocumentRecord,
  operation: 'read' | 'write' | 'delete',
): void {
  if (document.meta.ownerExtensionId !== record.packageManifest.id) {
    throw new Error(`Extension module ${moduleKey(record.packageManifest.id, record.moduleManifest.id)} cannot ${operation} document owned by another package: ${document.id}`)
  }
  assertDeclaredDocumentType(record, document.type)
}

function createExtensionLogger(
  packageId: string,
  moduleId: string,
  instanceId: string,
  logger: ExtensionHostLogger | undefined,
): ExtensionActivationContext['logger'] {
  const write = (level: 'debug' | 'info' | 'warn' | 'error', message: string, data?: JsonObject) => {
    const fields = {
      event: 'extension.runtime.log',
      data: { packageId, moduleId, instanceId, ...data },
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

function hasContributionMismatch(record: ExtensionModuleRecord, instance: ExtensionInstance, options: ExtensionHostOptions): boolean {
  const manifest = record.moduleManifest
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
    reportDiagnostic(options.diagnostics, record, instance.instanceId, {
      severity: 'warning',
      code: 'extension.rpc_declared_but_not_registered',
      message: `RPC ${name} is declared in manifest contributes.rpc but was not registered during activation`,
      source: 'extension-host',
    })
  }

  for (const name of declaredEventNames) {
    if (instance.registeredEventNames.has(name)) continue
    mismatched = true
    reportDiagnostic(options.diagnostics, record, instance.instanceId, {
      severity: 'warning',
      code: 'extension.event_declared_but_not_registered',
      message: `Event ${name} is declared in manifest contributes.events but was not registered during activation`,
      source: 'extension-host',
    })
  }

  return mismatched
}

async function stopInstance(record: ExtensionModuleRecord, options: ExtensionHostOptions): Promise<void> {
  const instance = record.instance
  if (!instance || !isLiveInstance(instance.state)) return
  instance.state = 'stopping'
  try {
    await instance.scope.dispose()
    instance.state = 'disposed'
  } catch (error) {
    instance.state = 'dispose_failed'
    reportDiagnostic(options.diagnostics, record, instance.instanceId, {
      severity: 'error',
      code: 'extension.dispose_failed',
      message: `Extension module dispose failed: ${moduleKey(record.packageManifest.id, record.moduleManifest.id)}`,
      source: 'extension-host',
      details: serializeError(error, 'extension.dispose_failed'),
    })
    throw error
  }
}

async function disposeFailedActivation(record: ExtensionModuleRecord, options: ExtensionHostOptions): Promise<void> {
  const instance = record.instance
  if (!instance) return
  try {
    await instance.scope.dispose()
  } catch (error) {
    reportDiagnostic(options.diagnostics, record, instance.instanceId, {
      severity: 'error',
      code: 'extension.activation_cleanup_failed',
      message: `Extension module activation cleanup failed: ${moduleKey(record.packageManifest.id, record.moduleManifest.id)}`,
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

function toSummary(record: ExtensionModuleRecord): ExtensionModuleSummary {
  return {
    packageId: record.packageManifest.id,
    moduleId: record.moduleManifest.id,
    runtime: 'server',
    version: record.packageManifest.version,
    displayName: record.packageManifest.displayName,
    state: record.state,
    instance: record.instance ? { instanceId: record.instance.instanceId, state: record.instance.state } : undefined,
    tags: record.packageManifest.tags,
    contributions: {
      rpc: record.moduleManifest.contributes?.rpc?.map(rpc => rpc.name),
      documentTypes: record.moduleManifest.contributes?.documentTypes?.map(item => item.type),
      events: record.moduleManifest.contributes?.events?.map(item => item.name),
    },
  }
}

function reportDiagnostic(
  registry: DiagnosticsRegistry,
  record: ExtensionModuleRecord,
  instanceId: string,
  input: Omit<DiagnosticInput, 'packageId' | 'moduleId' | 'extensionId' | 'instanceId'>,
): void {
  registry.add({
    ...input,
    packageId: record.packageManifest.id,
    moduleId: record.moduleManifest.id,
    extensionId: record.packageManifest.id,
    instanceId,
  })
}

function serverModules(manifest: ExtensionManifest): Array<ExtensionModuleManifest & { runtime: 'server' }> {
  return (manifest.modules ?? []).filter((moduleManifest): moduleManifest is ExtensionModuleManifest & { runtime: 'server' } => (
    moduleManifest.runtime === 'server'
  ))
}

function moduleKey(packageId: string, moduleId: string): string {
  return `${packageId}/${moduleId}`
}

function compareRecords(left: ExtensionModuleRecord, right: ExtensionModuleRecord): number {
  return moduleKey(left.packageManifest.id, left.moduleManifest.id)
    .localeCompare(moduleKey(right.packageManifest.id, right.moduleManifest.id))
}

function isKernelNamespace(name: string): boolean {
  return kernelNamespaces.includes(name.split('.')[0] ?? '')
}

function isStudioReservedNamespace(name: string): boolean {
  return studioReservedNamespaces.includes(name.split('.')[0] ?? '')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
