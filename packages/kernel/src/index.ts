import type { DiagnosticsRegistry } from '@loom-studio/diagnostics'
import type {
  DataCommitFact,
  DataCommitOperation,
  DataCommitSource,
  DataCommitSubscription,
} from '@loom-studio/data-engine'
import type {
  ActorRef,
  DocumentSourceRef,
  DeleteDocumentInput,
  DocumentStore,
  ListDocumentsInput,
  RevertChangesetInput,
  WriteDocumentInput,
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
import type { LoomRunInput, LoomRunner } from '@loom-studio/loom-runner'
import type { JsonValue } from '@loom-studio/shared'
import { createId, nowIso, serializeError } from '@loom-studio/shared'
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
  registerExtensionRpc(method: string, ownerPackageId: string, ownerModuleId: string, handler: ExtensionRpcHandler, instanceId?: string): RegistrationHandle
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

export type ExtensionManagementService = {
  listPackages(): JsonValue[]
  installPackage(sourceDirectory: string): Promise<JsonValue>
  uninstallPackage(packageId: string, version?: string): Promise<JsonValue>
  enableModule(packageId: string, moduleId: string, grants?: ExtensionModuleCapabilityGrants): Promise<JsonValue>
  disableModule(packageId: string, moduleId: string): Promise<JsonValue>
  reloadModule(packageId: string, moduleId: string): Promise<JsonValue>
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
  environment?: 'development' | 'production' | 'test'
}

const kernelNamespaces = ['system', 'events', 'docs', 'extensions', 'diagnostics', 'loom', 'trace', 'audit']

type RpcRegistryEntry = {
  handler: KernelRpcHandler
  owner: 'kernel' | `extension:${string}/${string}`
}

export type CreateEventBusOptions = {
  onSubscriberError?: (input: { event: StudioEvent; subscriptionId: string; error: unknown }) => void
}

export function createEventBus(options: CreateEventBusOptions = {}): EventBus {
  const definitions = new Map<string, RegisteredEventDefinition>()
  const subscriptions = new Map<string, {
    patterns: string[]
    handler: EventHandler
    subscriber: EventSubscriberIdentity
  }>()

  return {
    registerDefinition: (definition, registeredBy = { kind: 'platform' }) => {
      validateEventDefinition(definition, registeredBy)
      if (definitions.has(definition.name)) {
        throw new Error(`Event definition already registered: ${definition.name}`)
      }
      const registered = { definition, registeredBy } satisfies RegisteredEventDefinition
      definitions.set(definition.name, registered)

      return {
        dispose: () => {
          if (definitions.get(definition.name) === registered) definitions.delete(definition.name)
        },
      }
    },
    emit: (name, payload, emitOptions = {}) => {
      const registered = definitions.get(name)
      if (!registered) throw new Error(`Event definition not registered: ${name}`)
      assertCanPublish(registered, emitOptions.publisher ?? { kind: 'kernel' })
      const parsedPayload = registered.definition.parse?.(payload) ?? payload
      assertJsonValue(parsedPayload, `Event payload must be JSON-compatible: ${name}`)
      assertPayloadSize(registered.definition, parsedPayload)
      const event: StudioEvent = {
        name,
        payload: parsedPayload,
        meta: {
          eventId: createId('evt'),
          definitionVersion: registered.definition.version,
          emittedAt: nowIso(),
          source: emitOptions.source ?? 'kernel',
          clientId: emitOptions.clientId,
          correlationId: emitOptions.correlationId,
          callId: emitOptions.callId,
          parentCallId: emitOptions.parentCallId,
        },
      }

      for (const subscription of subscriptions.values()) {
        if (!subscription.patterns.some(pattern => matchesEventPattern(pattern, name))) continue
        if (!canSubscribe(registered.definition, subscription.subscriber)) continue
        try {
          const result = subscription.handler(event)
          if (isPromiseLike(result)) {
            void result.catch(error => options.onSubscriberError?.({
              event,
              subscriptionId: findSubscriptionId(subscriptions, subscription),
              error,
            }))
          }
        } catch (error) {
          options.onSubscriberError?.({
            event,
            subscriptionId: findSubscriptionId(subscriptions, subscription),
            error,
          })
        }
      }

      return event
    },
    subscribe: (patterns, handler, subscribeOptions = {}) => {
      if (patterns.length === 0) throw new Error('Event subscription requires at least one pattern')
      const subscriber = subscribeOptions.subscriber ?? { kind: 'platform' }
      assertCanSubscribePatterns(patterns, definitions, subscriber)
      const subscriptionId = createId('sub')
      subscriptions.set(subscriptionId, { patterns: [...patterns], handler, subscriber })

      return {
        subscriptionId,
        dispose: () => {
          subscriptions.delete(subscriptionId)
        },
      }
    },
    unsubscribe: subscriptionId => subscriptions.delete(subscriptionId),
    definitions: () => [...definitions.values()].sort((left, right) => left.definition.name.localeCompare(right.definition.name)),
    eventNames: () => [...definitions.keys()].sort(),
  }
}

export function createKernel(options: CreateKernelOptions): Kernel {
  const handlers = new Map<string, RpcRegistryEntry>()
  const eventBus = createEventBus({
    onSubscriberError: ({ event, subscriptionId, error }) => {
      options.diagnostics.add({
        severity: 'error',
        code: 'event.subscriber_failed',
        message: `Event subscriber failed: ${event.name}`,
        source: 'event-hub',
        details: {
          eventName: event.name,
          eventId: event.meta.eventId,
          subscriptionId,
          error: serializeError(error, 'event.subscriber_failed'),
        },
      })
    },
  })
  registerBuiltinEventDefinitions(eventBus)
  const studioVersion = options.studioVersion ?? '0.0.0'
  const kernelVersion = options.kernelVersion ?? '0.0.0'
  const protocolVersion = options.protocolVersion ?? '0.1.0'
  const environment = options.environment ?? 'development'
  let active = false
  let dataCommitSubscription: DataCommitSubscription | undefined

  const kernel: Kernel = {
    start: async () => {
      if (active) return
      registerStageOneHandlers(kernel, options, eventBus, { studioVersion, kernelVersion, protocolVersion, environment })
      dataCommitSubscription = options.dataCommits.subscribeCommits(commit => {
        const eventOptions = dataCommitEventOptions(commit)
        eventBus.emit('data.changed', summarizeDataCommit(commit), eventOptions)
        const documentOperations = readDocumentOperations(commit)
        if (documentOperations.length > 0) {
          eventBus.emit('docs.changed', summarizeDocumentCommit(commit, documentOperations), eventOptions)
        }
      })
      active = true
      eventBus.emit('system.ready', {}, { publisher: { kind: 'kernel' } })
    },
    stop: async () => {
      if (!active) return
      eventBus.emit('system.stopping', {}, { publisher: { kind: 'kernel' } })
      dataCommitSubscription?.dispose()
      dataCommitSubscription = undefined
      try {
        await options.extensionHost.disposeAll()
      } finally {
        active = false
      }
    },
    registerKernelRpc: (method, handler) => {
      assertKernelNamespace(method)

      if (handlers.has(method)) {
        throw new Error(`Kernel RPC already registered: ${method}`)
      }

      handlers.set(method, { handler, owner: 'kernel' })

      return {
        dispose: () => {
          handlers.delete(method)
        },
      }
    },
    registerExtensionRpc: (method, ownerPackageId, ownerModuleId, handler, instanceId = `legacy:${ownerPackageId}/${ownerModuleId}`) => {
      if (isKernelNamespace(method)) {
        throw new Error(`Extension cannot register Kernel namespace RPC: ${method}`)
      }

      if (handlers.has(method)) {
        throw new Error(`RPC already registered: ${method}`)
      }

      const entry: RpcRegistryEntry = {
        handler: (params, context) => handler(params, {
          ...context,
          packageId: ownerPackageId,
          moduleId: ownerModuleId,
          instanceId,
        }),
        owner: `extension:${ownerPackageId}/${ownerModuleId}`,
      }
      handlers.set(method, entry)

      return {
        dispose: () => {
          if (handlers.get(method) === entry) handlers.delete(method)
        },
      }
    },
    callRpc: async (method, params, context = {}) => {
      const entry = handlers.get(method)

      if (!entry) {
        throw new Error(`RPC method not found: ${method}`)
      }

      const rpcContext = normalizeContext(context)

      return (await entry.handler(params, rpcContext)) as JsonValue as never
    },
    getPublicSurface: () => ({
      namespaces: [...kernelNamespaces],
      methods: [...handlers.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([name, entry]) => ({ name, owner: entry.owner })),
      version: kernelVersion,
    }),
    getDocumentStore: () => options.documents,
    getExtensionHost: () => options.extensionHost,
    getDiagnostics: () => options.diagnostics,
    getEventBus: () => eventBus,
    getTraceAudit: () => options.traceAudit,
    getLoomRunner: () => options.loomRunner,
  }

  return kernel
}

function registerStageOneHandlers(
  kernel: Kernel,
  options: CreateKernelOptions,
  eventBus: EventBus,
  versions: {
    studioVersion: string
    kernelVersion: string
    protocolVersion: string
    environment: 'development' | 'production' | 'test'
  },
): void {
  void options.loomRunner

  const register = (method: string, handler: KernelRpcHandler) => {
    try {
      kernel.registerKernelRpc(method, handler)
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('already registered')) {
        throw error
      }
    }
  }

  register('system.ping', params => {
    return {
      ok: true,
      echo: isRecord(params) ? params.echo : undefined,
      serverTime: nowIso(),
    } as JsonValue
  })

  register('system.getInfo', () => {
    return {
      studioVersion: versions.studioVersion,
      kernelVersion: versions.kernelVersion,
      protocolVersion: versions.protocolVersion,
      environment: versions.environment,
      capabilities: {
        documents: true,
        extensions: true,
        loomRun: true,
        traceAudit: true,
      },
    } as JsonValue
  })

  register('system.introspect', params => {
    const includeDiagnostics = isRecord(params) && params.includeDiagnostics === true

    return {
      kernel: {
        studioVersion: versions.studioVersion,
        kernelVersion: versions.kernelVersion,
        protocolVersion: versions.protocolVersion,
      },
      namespaces: kernel.getPublicSurface().namespaces,
      methods: kernel.getPublicSurface().methods,
      events: eventBus.eventNames(),
      documentTypes: [],
      extensions: options.extensionManager?.listPackages() ?? options.extensionHost.list().map(module => ({
        packageId: module.packageId,
        moduleId: module.moduleId,
        version: module.version,
        active: module.state === 'active',
      })),
      diagnostics: includeDiagnostics ? options.diagnostics.list() : undefined,
    } as JsonValue
  })

  register('docs.get', async params => {
    const id = readString(params, 'id')
    const document = await options.documents.get(id, {
      includeTombstone: isRecord(params) && params.includeTombstone === true,
      version: isRecord(params) && typeof params.version === 'number' ? params.version : undefined,
    })

    return { document: document as JsonValue | null } as JsonValue
  })

  register('docs.list', async params => {
    const result = await options.documents.list((isRecord(params) ? params : {}) as ListDocumentsInput)
    return result as unknown as JsonValue
  })

  register('docs.getChangeset', async params => {
    const changeset = await options.documents.getChangeset(readString(params, 'changesetId'))
    return { changeset } as unknown as JsonValue
  })

  register('docs.write', async (params, context) => {
    if (!isRecord(params)) throw new Error('docs.write params must be an object')
    return await options.documents.write(toWriteDocumentInput(params, context)) as unknown as JsonValue
  })

  register('docs.delete', async (params, context) => {
    if (!isRecord(params)) throw new Error('docs.delete params must be an object')
    return await options.documents.delete(toDeleteDocumentInput(params, context)) as unknown as JsonValue
  })

  register('docs.revertChangeset', async (params, context) => {
    if (!isRecord(params)) throw new Error('docs.revertChangeset params must be an object')
    const targetChangesetId = readString(params, 'changesetId')

    try {
      const result = await options.documents.revertChangeset(toRevertChangesetInput(params, context))
      eventBus.emit('docs.rollback.completed', summarizeDocumentRollback(targetChangesetId, result), context)
      return result as unknown as JsonValue
    } catch (error) {
      eventBus.emit('docs.rollback.failed', {
        targetChangesetId,
        error: serializeError(error, 'document.revert_failed'),
      }, context)
      throw error
    }
  })

  register('extensions.listPackages', () => {
    return {
      items: options.extensionManager?.listPackages() ?? options.extensionHost.list(),
    } as unknown as JsonValue
  })

  register('extensions.installPackage', async (params, context) => {
    const manager = requireExtensionManager(options)
    const sourceDirectory = readString(params, 'sourceDirectory')
    const extensionPackage = await manager.installPackage(sourceDirectory)
    if (!isRecord(extensionPackage) || typeof extensionPackage.packageId !== 'string') {
      throw new Error('Extension manager returned an invalid installed Package summary')
    }
    eventBus.emit('extensions.changed', {
      packageId: extensionPackage.packageId,
      ...(typeof extensionPackage.version === 'string' ? { version: extensionPackage.version } : {}),
      action: 'installed',
    }, context)
    return { package: extensionPackage }
  })

  register('extensions.uninstallPackage', async (params, context) => {
    const manager = requireExtensionManager(options)
    const packageId = readString(params, 'packageId')
    const version = isRecord(params) && typeof params.version === 'string' ? params.version : undefined
    const extensionPackage = await manager.uninstallPackage(packageId, version)
    eventBus.emit('extensions.changed', {
      packageId,
      ...(version ? { version } : {}),
      action: 'uninstalled',
    }, context)
    return { package: extensionPackage }
  })

  register('extensions.enableModule', async (params, context) => {
    const manager = requireExtensionManager(options)
    const packageId = readString(params, 'packageId')
    const moduleId = readString(params, 'moduleId')
    const grants = readExtensionCapabilityGrants(params)
    const module = await manager.enableModule(packageId, moduleId, grants)
    eventBus.emit('extensions.changed', { packageId, moduleId, action: 'enabled' }, context)
    return { module }
  })

  register('extensions.disableModule', async (params, context) => {
    const manager = requireExtensionManager(options)
    const packageId = readString(params, 'packageId')
    const moduleId = readString(params, 'moduleId')
    const module = await manager.disableModule(packageId, moduleId)
    eventBus.emit('extensions.changed', { packageId, moduleId, action: 'disabled' }, context)
    return { module }
  })

  register('extensions.reloadModule', async (params, context) => {
    const manager = requireExtensionManager(options)
    const packageId = readString(params, 'packageId')
    const moduleId = readString(params, 'moduleId')
    const module = await manager.reloadModule(packageId, moduleId)
    eventBus.emit('extensions.changed', { packageId, moduleId, action: 'reloaded' }, context)
    return { module }
  })

  register('extensions.getDiagnostics', params => {
    const packageId = isRecord(params) && typeof params.packageId === 'string' ? params.packageId : undefined
    const moduleId = isRecord(params) && typeof params.moduleId === 'string' ? params.moduleId : undefined
    return {
      diagnostics: options.extensionHost.diagnostics(packageId, moduleId),
    } as unknown as JsonValue
  })

  register('diagnostics.list', params => {
    const diagnostics = options.diagnostics.list(isRecord(params) ? params : undefined)
    return { items: diagnostics } as unknown as JsonValue
  })

  register('trace.list', () => {
    return { items: options.traceAudit.listTraces() } as unknown as JsonValue
  })

  register('audit.list', () => {
    return { items: options.traceAudit.listAudit() } as unknown as JsonValue
  })

  register('loom.run', async (params, context) => {
    if (!isRecord(params)) throw new Error('loom.run params must be an object')
    rejectForbiddenLoomRunFields(params)

    const result = await options.loomRunner.run(toLoomRunInput(params))
    for (const diagnostic of result.diagnostics ?? []) {
      options.diagnostics.add(diagnostic)
    }
    if ((result.diagnostics?.length ?? 0) > 0) {
      eventBus.emit('diagnostics.updated', { count: result.diagnostics?.length ?? 0 }, context)
    }

    return result as unknown as JsonValue
  })
}

function requireExtensionManager(options: CreateKernelOptions): ExtensionManagementService {
  if (!options.extensionManager) throw new Error('Extension management is not configured')
  return options.extensionManager
}

function readExtensionCapabilityGrants(params: JsonValue | undefined): ExtensionModuleCapabilityGrants | undefined {
  if (!isRecord(params) || params.grants === undefined) return undefined
  if (!isRecord(params.grants)) throw new Error('extensions.enableModule grants must be an object')
  const subscriptions = params.grants['events.subscribe']
  if (subscriptions !== undefined && (!Array.isArray(subscriptions) || !subscriptions.every(value => typeof value === 'string'))) {
    throw new Error('extensions.enableModule grants.events.subscribe must be a string array')
  }
  const assets = params.grants.assets
  if (assets !== undefined && (!Array.isArray(assets) || !assets.every(value => value === 'assets.publish' || value === 'assets.read'))) {
    throw new Error('extensions.enableModule grants.assets must contain assets.publish/assets.read')
  }
  return {
    eventCapabilities: subscriptions as EventCapabilityCategory[] | undefined,
    assetCapabilities: assets as ExtensionAssetCapability[] | undefined,
  }
}

function normalizeContext(context: KernelRpcContext): Required<Pick<KernelRpcContext, 'correlationId' | 'callId'>> & KernelRpcContext {
  return {
    ...context,
    correlationId: context.correlationId ?? createId('corr'),
    callId: context.callId ?? createId('call'),
  }
}

function assertKernelNamespace(method: string): void {
  if (!isKernelNamespace(method)) {
    throw new Error(`Not a Kernel namespace: ${method}`)
  }
}

function isKernelNamespace(method: string): boolean {
  return kernelNamespaces.includes(method.split('.')[0] ?? '')
}

function registerBuiltinEventDefinitions(eventBus: EventBus): void {
  const definitions: EventDefinition[] = [
    platformEvent('data.changed', 'Low-level platform data commit completed', 'protected', 'platform-data'),
    platformEvent('docs.changed', 'Document Store commit completed', 'protected', 'documents'),
    platformEvent('docs.rollback.completed', 'Document changeset rollback completed', 'protected', 'documents'),
    platformEvent('docs.rollback.failed', 'Document changeset rollback failed', 'protected', 'documents'),
    platformEvent('diagnostics.updated', 'Diagnostics registry changed', 'protected', 'diagnostics'),
    platformEvent('extensions.changed', 'Extension runtime state changed', 'public'),
    platformEvent('system.ready', 'Kernel completed startup', 'public'),
    platformEvent('system.stopping', 'Kernel shutdown started', 'public'),
  ]

  for (const definition of definitions) eventBus.registerDefinition(definition)
}

function platformEvent(
  name: string,
  summary: string,
  visibility: EventDefinition['visibility'],
  capability?: EventDefinition['capability'],
): EventDefinition {
  return {
    name,
    owner: { kind: 'kernel' },
    version: 1,
    visibility,
    capability,
    summary,
    stability: 'experimental',
    maxPayloadBytes: 64 * 1024,
  }
}

function validateEventDefinition(definition: EventDefinition, registeredBy: EventDefinitionRegistrationOwner): void {
  if (!/^[a-z][a-z0-9]*(?:[.-][A-Za-z0-9]+)+$/.test(definition.name)) {
    throw new Error(`Invalid event name: ${definition.name}`)
  }
  if (!Number.isInteger(definition.version) || definition.version < 1) {
    throw new Error(`Event definition version must be a positive integer: ${definition.name}`)
  }
  if (!definition.summary.trim()) throw new Error(`Event definition summary is required: ${definition.name}`)
  if (definition.maxPayloadBytes !== undefined && (!Number.isInteger(definition.maxPayloadBytes) || definition.maxPayloadBytes < 1)) {
    throw new Error(`Event maxPayloadBytes must be a positive integer: ${definition.name}`)
  }
  if (definition.visibility === 'protected' && !definition.capability) {
    throw new Error(`Protected event requires a capability: ${definition.name}`)
  }
  if (definition.visibility !== 'protected' && definition.capability) {
    throw new Error(`Only protected events may declare a capability: ${definition.name}`)
  }

  if (registeredBy.kind !== 'extension') return
  if (
    definition.owner.kind !== 'extension'
    || definition.owner.packageId !== registeredBy.packageId
    || definition.owner.moduleId !== registeredBy.moduleId
  ) {
    throw new Error(`Extension event owner mismatch: ${definition.name}`)
  }
  if (!definition.name.startsWith(`${registeredBy.packageId}.`)) {
    throw new Error(`Extension event must use its package namespace: ${definition.name}`)
  }
  if (definition.visibility === 'internal') {
    throw new Error(`Extension cannot register internal event: ${definition.name}`)
  }
  if (definition.visibility === 'protected' && definition.capability !== `extension:${registeredBy.packageId}`) {
    throw new Error(`Extension protected event must use its extension capability: ${definition.name}`)
  }
}

function assertCanPublish(registered: RegisteredEventDefinition, publisher: EventPublishIdentity): void {
  const owner = registered.definition.owner
  if (owner.kind === 'extension') {
    if (
      publisher.kind === 'extension'
      && publisher.packageId === owner.packageId
      && publisher.moduleId === owner.moduleId
    ) return
    throw new Error(`Event publisher does not own definition: ${registered.definition.name}`)
  }
  if (publisher.kind !== owner.kind) {
    throw new Error(`Event publisher does not own definition: ${registered.definition.name}`)
  }
}

function assertCanSubscribePatterns(
  patterns: string[],
  definitions: Map<string, RegisteredEventDefinition>,
  subscriber: EventSubscriberIdentity,
): void {
  if (subscriber.kind === 'platform') return
  for (const registered of definitions.values()) {
    if (!patterns.some(pattern => matchesEventPattern(pattern, registered.definition.name))) continue
    if (!canSubscribe(registered.definition, subscriber)) {
      throw new Error(`Extension is not allowed to subscribe to event: ${registered.definition.name}`)
    }
  }
}

function canSubscribe(definition: EventDefinition, subscriber: EventSubscriberIdentity): boolean {
  if (subscriber.kind === 'platform') return true
  if (definition.visibility === 'internal') return false
  if (definition.visibility === 'public') return true
  return Boolean(definition.capability && subscriber.capabilities.includes(definition.capability))
}

function assertPayloadSize(definition: EventDefinition, payload: JsonValue): void {
  if (!definition.maxPayloadBytes) return
  const size = Buffer.byteLength(JSON.stringify(payload), 'utf8')
  if (size > definition.maxPayloadBytes) {
    throw new Error(`Event payload exceeds ${definition.maxPayloadBytes} bytes: ${definition.name}`)
  }
}

function assertJsonValue(value: unknown, message: string): asserts value is JsonValue {
  if (!isJsonValue(value, new Set())) throw new Error(message)
}

function isJsonValue(value: unknown, ancestors: Set<object>): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object') return false
  if (ancestors.has(value)) return false

  ancestors.add(value)
  const valid = Array.isArray(value)
    ? value.every(item => isJsonValue(item, ancestors))
    : (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
      && Object.values(value).every(item => isJsonValue(item, ancestors))
  ancestors.delete(value)
  return valid
}

function isPromiseLike(value: unknown): value is Promise<void> {
  return value !== null && typeof value === 'object' && 'then' in value && typeof value.then === 'function'
}

function findSubscriptionId(
  subscriptions: Map<string, { patterns: string[]; handler: EventHandler; subscriber: EventSubscriberIdentity }>,
  target: { patterns: string[]; handler: EventHandler; subscriber: EventSubscriberIdentity },
): string {
  for (const [subscriptionId, subscription] of subscriptions) {
    if (subscription === target) return subscriptionId
  }
  return 'unknown'
}

function matchesEventPattern(pattern: string, name: string): boolean {
  if (pattern.endsWith('.*')) {
    return name.startsWith(pattern.slice(0, -1))
  }

  return pattern === name
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readString(params: JsonValue | undefined, key: string): string {
  if (!isRecord(params) || typeof params[key] !== 'string') {
    throw new Error(`Expected string param: ${key}`)
  }

  return params[key]
}

function toWriteDocumentInput(params: Record<string, JsonValue>, context: KernelRpcContext): WriteDocumentInput {
  return {
    id: typeof params.id === 'string' ? params.id : undefined,
    type: readString(params, 'type'),
    content: params.content ?? null,
    meta: readSafeDocumentMeta(params),
    expectedVersion: readExpectedVersion(params),
    reason: typeof params.reason === 'string' ? params.reason : undefined,
    actor: actorFromContext(context),
    correlationId: context.correlationId,
    callId: context.callId,
    parentCallId: context.parentCallId,
  }
}

function toDeleteDocumentInput(params: Record<string, JsonValue>, context: KernelRpcContext): DeleteDocumentInput {
  return {
    id: readString(params, 'id'),
    expectedVersion: typeof params.expectedVersion === 'number' ? params.expectedVersion : undefined,
    reason: typeof params.reason === 'string' ? params.reason : undefined,
    actor: actorFromContext(context),
    correlationId: context.correlationId,
    callId: context.callId,
    parentCallId: context.parentCallId,
  }
}

function toRevertChangesetInput(params: Record<string, JsonValue>, context: KernelRpcContext): RevertChangesetInput {
  return {
    changesetId: readString(params, 'changesetId'),
    reason: typeof params.reason === 'string' ? params.reason : undefined,
    actor: actorFromContext(context),
    correlationId: context.correlationId,
    callId: context.callId,
    parentCallId: context.parentCallId,
  }
}

function actorFromContext(context: KernelRpcContext): ActorRef {
  return context.clientId ? { kind: 'client', id: context.clientId } : { kind: 'kernel', id: 'kernel' }
}

function readSafeDocumentMeta(params: Record<string, JsonValue>): WriteDocumentInput['meta'] {
  if (!isRecord(params.meta)) return undefined
  if (!isRecord(params.meta.source) || typeof params.meta.source.kind !== 'string') return undefined
  return { source: params.meta.source as DocumentSourceRef }
}

function readExpectedVersion(params: Record<string, JsonValue>): WriteDocumentInput['expectedVersion'] {
  if (params.expectedVersion === 'new' || typeof params.expectedVersion === 'number') return params.expectedVersion
  return undefined
}

function rejectForbiddenLoomRunFields(params: Record<string, JsonValue>): void {
  const forbidden = ['messages', 'model', 'temperature', 'tools', 'toolChoice', 'chatId', 'sessionId', 'provider']
  const found = forbidden.filter(field => field in params)
  if (found.length > 0) {
    throw new Error(`Forbidden loom.run fields: ${found.join(', ')}`)
  }
}

function toLoomRunInput(params: Record<string, JsonValue>): LoomRunInput {
  if (!Array.isArray(params.fragments)) throw new Error('loom.run fragments must be an array')
  if (!Array.isArray(params.passes)) throw new Error('loom.run passes must be an array')
  return {
    fragments: params.fragments,
    passes: params.passes,
    options: params.options,
    trace: readTraceOptions(params.trace),
  }
}

function readTraceOptions(value: JsonValue | undefined): LoomRunInput['trace'] {
  if (!isRecord(value)) return undefined
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : undefined,
    strictPersist: typeof value.strictPersist === 'boolean' ? value.strictPersist : undefined,
  }
}

function summarizeDataCommit(commit: DataCommitFact): JsonValue {
  return {
    changesetId: commit.changesetId,
    operations: commit.operations.map(summarizeDataOperation),
  }
}

function summarizeDocumentCommit(commit: DataCommitFact, operations = readDocumentOperations(commit)): JsonValue {
  return {
    changesetId: commit.changesetId,
    operations: operations.map(operation => ({
      kind: operation.kind,
      documentId: operation.entityId,
      type: operation.entityType,
      ...(operation.fromVersion !== undefined ? { fromVersion: operation.fromVersion } : {}),
      ...(operation.toVersion !== undefined ? { toVersion: operation.toVersion } : {}),
    })),
    documents: operations.map(operation => ({
      id: operation.entityId,
      type: operation.entityType,
      ...(operation.toVersion !== undefined ? { version: operation.toVersion } : {}),
      tombstoned: operation.kind === 'delete',
    })),
  }
}

function summarizeDataOperation(operation: DataCommitOperation): JsonValue {
  return {
    store: operation.store,
    kind: operation.kind,
    entityId: operation.entityId,
    entityType: operation.entityType,
    ...(operation.fromVersion !== undefined ? { fromVersion: operation.fromVersion } : {}),
    ...(operation.toVersion !== undefined ? { toVersion: operation.toVersion } : {}),
  }
}

function dataCommitEventOptions(commit: DataCommitFact): EventEmitOptions {
  const actor = commit.actor
  return {
    source: actor.kind === 'extension' ? `extension:${actor.id}` : 'kernel',
    clientId: actor.kind === 'client' ? actor.id : undefined,
    correlationId: commit.correlationId,
    callId: commit.callId,
    parentCallId: commit.parentCallId,
  }
}

function readDocumentOperations(commit: DataCommitFact): DataCommitOperation[] {
  return commit.operations.filter(operation => operation.store === 'documents')
}

function summarizeDocumentRollback(targetChangesetId: string, result: { commit: DataCommitFact }): JsonValue {
  return {
    targetChangesetId,
    ...summarizeDocumentCommit(result.commit) as Record<string, JsonValue>,
  }
}
