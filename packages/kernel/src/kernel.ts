import type { DataCommitSubscription } from '@loom-studio/data-engine'
import type { JsonValue } from '@loom-studio/shared'
import { createId, serializeError } from '@loom-studio/shared'
import { createEventBus, registerBuiltinEventDefinitions } from './events.js'
import {
  dataCommitEventOptions,
  readDocumentOperations,
  registerStageOneHandlers,
  summarizeDataCommit,
  summarizeDocumentCommit,
} from './handlers.js'
import {
  kernelNamespaces,
  type CreateKernelOptions,
  type Kernel,
  type KernelRpcContext,
  type RpcRegistryEntry,
} from './types.js'

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
  let active = false
  let dataCommitSubscription: DataCommitSubscription | undefined

  const kernel: Kernel = {
    start: async () => {
      if (active) return
      registerStageOneHandlers(kernel, options, eventBus, { studioVersion, kernelVersion, protocolVersion })
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
    registerExtensionRpc: (method, ownerPackageId, ownerModuleId, handler, instanceId) => {
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

export function normalizeContext(context: KernelRpcContext): Required<Pick<KernelRpcContext, 'correlationId' | 'callId'>> & KernelRpcContext {
  return {
    ...context,
    correlationId: context.correlationId ?? createId('corr'),
    callId: context.callId ?? createId('call'),
  }
}

export function assertKernelNamespace(method: string): void {
  if (!isKernelNamespace(method)) {
    throw new Error(`Not a Kernel namespace: ${method}`)
  }
}

export function isKernelNamespace(method: string): boolean {
  return kernelNamespaces.includes(method.split('.')[0] ?? '')
}
