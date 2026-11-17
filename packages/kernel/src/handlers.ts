import type {
  DataCommitFact,
  DataCommitOperation,
} from './data-engine/index.js'
import { isJsonObject, nowIso, type JsonValue } from '@loom-studio/shared'
import type {
  CreateKernelOptions,
  EventBus,
  EventEmitOptions,
  Kernel,
  RegistrationHandle
} from './types.js'

function createBuiltinHandlers(kernel: Kernel,
  options: CreateKernelOptions,
  eventBus: EventBus,
  versions: {
    studioVersion: string
    kernelVersion: string
    protocolVersion: string
  }) {
  return {
    'system.ping': (params: JsonValue | undefined) => {
      return {
        ok: true,
        echo: isRecord(params) ? params.echo : undefined,
        serverTime: nowIso(),
      }
    },
    'system.introspect': (params: JsonValue | undefined) => {
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
      }
    },
  }
}

export type BuiltinHandlers = ReturnType<typeof createBuiltinHandlers>

export function registerStageOneHandlers(kernel: Kernel,
  options: CreateKernelOptions,
  eventBus: EventBus,
  versions: {
    studioVersion: string
    kernelVersion: string
    protocolVersion: string
  }): RegistrationHandle[] {
  const handlers = createBuiltinHandlers(kernel, options, eventBus, versions)
  return Object.entries(handlers).map(([method, handler]) => kernel.registerKernelRpc(method, async params => {
    // The dynamic extension registry transports JSON; concrete built-in outputs stay inferred above.
    return await handler(params) as unknown as JsonValue
  }))
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return isJsonObject(value)
}

export function summarizeDataCommit(commit: DataCommitFact): JsonValue {
  return {
    changesetId: commit.changesetId,
    operations: commit.operations.map(summarizeDataOperation),
  }
}

function summarizeDataOperation(operation: DataCommitOperation): JsonValue {
  return {
    store: operation.store,
    kind: operation.kind,
    entityId: operation.entityId,
    entityType: operation.entityType,
    ...(operation.scope ? { scope: operation.scope } : {}),
    ...(operation.fromVersion !== undefined ? { fromVersion: operation.fromVersion } : {}),
    ...(operation.toVersion !== undefined ? { toVersion: operation.toVersion } : {}),
  }
}

export function dataCommitEventOptions(commit: DataCommitFact): EventEmitOptions {
  const actor = commit.actor
  return {
    source: actor.kind === 'extension' ? `extension:${actor.id}` : 'kernel',
    clientId: actor.kind === 'client' ? actor.id : undefined,
    correlationId: commit.correlationId,
    callId: commit.callId,
    parentCallId: commit.parentCallId,
  }
}
