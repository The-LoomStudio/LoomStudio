import type { DiagnosticsRegistry } from '@loom-studio/diagnostics'
import type {
  DeleteDocumentInput,
  DocumentRecord,
  DocumentStore,
  ListDocumentsInput,
  WriteDocumentInput,
} from '@loom-studio/document-store'
import type { ExtensionHost } from '@loom-studio/extension-host'
import type { LoomRunner } from '@loom-studio/loom-runner'
import type { JsonValue } from '@loom-studio/shared'
import { createId, nowIso } from '@loom-studio/shared'
import type { StudioEvent } from '@loom-studio/transport'

export type KernelRpcContext = {
  correlationId?: string
  callId?: string
  clientId?: string
}

export type KernelRpcHandler = (params: JsonValue | undefined, context: KernelRpcContext) => Promise<JsonValue> | JsonValue

export type RegistrationHandle = {
  dispose(): void
}

export type EventHandler = (event: StudioEvent) => void

export type EventBus = {
  emit(name: string, payload: JsonValue, source?: string): StudioEvent
  subscribe(patterns: string[], handler: EventHandler): RegistrationHandle & { subscriptionId: string }
  unsubscribe(subscriptionId: string): boolean
  eventNames(): string[]
}

export type Kernel = {
  start(): Promise<void>
  stop(): Promise<void>
  registerKernelRpc(method: string, handler: KernelRpcHandler): RegistrationHandle
  callRpc<T = JsonValue>(method: string, params?: JsonValue, context?: KernelRpcContext): Promise<T>
  getPublicSurface(): KernelPublicSurface
  getEventBus(): EventBus
}

export type KernelPublicSurface = {
  namespaces: string[]
  methods: Array<{
    name: string
    owner: 'kernel'
  }>
  version: string
}

export type CreateKernelOptions = {
  documents: DocumentStore
  diagnostics: DiagnosticsRegistry
  extensionHost: ExtensionHost
  loomRunner: LoomRunner
  studioVersion?: string
  kernelVersion?: string
  protocolVersion?: string
  environment?: 'development' | 'production' | 'test'
}

const kernelNamespaces = ['system', 'events', 'docs', 'extensions', 'diagnostics', 'loom', 'trace', 'audit']

export function createEventBus(): EventBus {
  const subscriptions = new Map<string, { patterns: string[]; handler: EventHandler }>()
  const knownEvents = new Set<string>(['docs.changed', 'diagnostics.updated', 'extensions.changed', 'system.ready', 'system.stopping'])

  return {
    emit: (name, payload, source = 'kernel') => {
      knownEvents.add(name)
      const event: StudioEvent = {
        name,
        payload,
        meta: {
          eventId: createId('evt'),
          emittedAt: nowIso(),
          source,
        },
      }

      for (const subscription of subscriptions.values()) {
        if (subscription.patterns.some(pattern => matchesEventPattern(pattern, name))) {
          subscription.handler(event)
        }
      }

      return event
    },
    subscribe: (patterns, handler) => {
      const subscriptionId = createId('sub')
      subscriptions.set(subscriptionId, { patterns, handler })

      return {
        subscriptionId,
        dispose: () => {
          subscriptions.delete(subscriptionId)
        },
      }
    },
    unsubscribe: subscriptionId => subscriptions.delete(subscriptionId),
    eventNames: () => [...knownEvents].sort(),
  }
}

export function createKernel(options: CreateKernelOptions): Kernel {
  const handlers = new Map<string, KernelRpcHandler>()
  const eventBus = createEventBus()
  const studioVersion = options.studioVersion ?? '0.0.0'
  const kernelVersion = options.kernelVersion ?? '0.0.0'
  const protocolVersion = options.protocolVersion ?? '0.1.0'
  const environment = options.environment ?? 'development'
  let active = false

  const kernel: Kernel = {
    start: async () => {
      if (active) return
      registerStageOneHandlers(kernel, options, eventBus, { studioVersion, kernelVersion, protocolVersion, environment })
      active = true
      eventBus.emit('system.ready', {})
    },
    stop: async () => {
      if (!active) return
      eventBus.emit('system.stopping', {})
      active = false
    },
    registerKernelRpc: (method, handler) => {
      assertKernelNamespace(method)

      if (handlers.has(method)) {
        throw new Error(`Kernel RPC already registered: ${method}`)
      }

      handlers.set(method, handler)

      return {
        dispose: () => {
          handlers.delete(method)
        },
      }
    },
    callRpc: async (method, params, context = {}) => {
      const handler = handlers.get(method)

      if (!handler) {
        throw new Error(`RPC method not found: ${method}`)
      }

      return (await handler(params, context)) as JsonValue as never
    },
    getPublicSurface: () => ({
      namespaces: [...kernelNamespaces],
      methods: [...handlers.keys()].sort().map(name => ({ name, owner: 'kernel' })),
      version: kernelVersion,
    }),
    getEventBus: () => eventBus,
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
        loomRun: false,
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
      extensions: options.extensionHost.list().map(extension => ({
        id: extension.id,
        version: extension.version,
        active: extension.state === 'active',
      })),
      diagnostics: includeDiagnostics ? options.diagnostics.list() : undefined,
    } as JsonValue
  })

  register('events.subscribe', params => {
    const patterns = readStringArray(params, 'patterns')
    const subscription = eventBus.subscribe(patterns, () => {})

    return {
      subscriptionId: subscription.subscriptionId,
      patterns,
    } as JsonValue
  })

  register('events.unsubscribe', params => {
    const subscriptionId = readString(params, 'subscriptionId')

    return {
      subscriptionId,
      removed: eventBus.unsubscribe(subscriptionId),
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

  register('docs.write', async params => {
    if (!isRecord(params)) throw new Error('docs.write params must be an object')
    const result = await options.documents.write(params as WriteDocumentInput)
    eventBus.emit('docs.changed', summarizeDocuments(result.documents))
    return result as unknown as JsonValue
  })

  register('docs.delete', async params => {
    if (!isRecord(params)) throw new Error('docs.delete params must be an object')
    const result = await options.documents.delete(params as DeleteDocumentInput)
    eventBus.emit('docs.changed', summarizeDocuments(result.documents))
    return result as unknown as JsonValue
  })

  register('extensions.list', () => {
    return {
      items: options.extensionHost.list(),
    } as unknown as JsonValue
  })

  register('extensions.getDiagnostics', params => {
    const extensionId = isRecord(params) && typeof params.extensionId === 'string' ? params.extensionId : undefined
    return {
      diagnostics: options.extensionHost.diagnostics(extensionId),
    } as unknown as JsonValue
  })

  register('diagnostics.list', params => {
    const diagnostics = options.diagnostics.list(isRecord(params) ? params : undefined)
    return { diagnostics } as unknown as JsonValue
  })
}

function assertKernelNamespace(method: string): void {
  const namespace = method.split('.')[0]

  if (!kernelNamespaces.includes(namespace)) {
    throw new Error(`Not a Kernel namespace: ${method}`)
  }
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

function readStringArray(params: JsonValue | undefined, key: string): string[] {
  if (!isRecord(params) || !Array.isArray(params[key]) || !params[key].every(value => typeof value === 'string')) {
    throw new Error(`Expected string array param: ${key}`)
  }

  return params[key]
}

function summarizeDocuments(documents: DocumentRecord[]): JsonValue {
  return {
    documents: documents.map(document => ({
      id: document.id,
      type: document.type,
      version: document.version,
      tombstone: Boolean(document.meta.tombstone),
    })),
  }
}
