import type {
  DataCommitFact,
  DataCommitOperation,
} from '@loom-studio/data-engine'
import type {
  ActorRef,
  DeleteDocumentInput,
  DocumentSourceRef,
  ListDocumentsInput,
  RevertChangesetInput,
  WriteDocumentInput,
} from '@loom-studio/document-store'
import type {
  EventCapabilityCategory,
  ExtensionAssetCapability,
} from '@loom-studio/extension-sdk'
import type { LoomRunInput } from '@loom-studio/loom-runner'
import type { JsonValue } from '@loom-studio/shared'
import { nowIso, serializeError } from '@loom-studio/shared'
import type {
  CreateKernelOptions,
  EventBus,
  EventEmitOptions,
  ExtensionManagementService,
  ExtensionModuleCapabilityGrants,
  Kernel,
  KernelRpcContext,
  KernelRpcHandler,
} from './types.js'

export function registerStageOneHandlers(
  kernel: Kernel,
  options: CreateKernelOptions,
  eventBus: EventBus,
  versions: {
    studioVersion: string
    kernelVersion: string
    protocolVersion: string
  },
): void {
  const register = (method: string, handler: KernelRpcHandler) => kernel.registerKernelRpc(method, handler)

  register('system.ping', params => {
    return {
      ok: true,
      echo: isRecord(params) ? params.echo : undefined,
      serverTime: nowIso(),
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
    eventBus.emit('extensions.changed', {
      packageId: extensionPackage.packageId,
      version: extensionPackage.version,
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

  register('extensions.importPackageResources', async params => {
    const manager = requireExtensionManager(options)
    return await manager.importPackageResources(readString(params, 'packageId'))
  })

  register('extensions.removePackageResources', async params => {
    const manager = requireExtensionManager(options)
    return await manager.removePackageResources(readString(params, 'packageId'))
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

export function requireExtensionManager(options: CreateKernelOptions): ExtensionManagementService {
  if (!options.extensionManager) throw new Error('Extension management is not configured')
  return options.extensionManager
}

export function readExtensionCapabilityGrants(params: JsonValue | undefined): ExtensionModuleCapabilityGrants | undefined {
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

export function isRecord(value: unknown): value is Record<string, JsonValue> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function readString(params: JsonValue | undefined, key: string): string {
  if (!isRecord(params) || typeof params[key] !== 'string') {
    throw new Error(`Expected string param: ${key}`)
  }

  return params[key]
}

export function toWriteDocumentInput(params: Record<string, JsonValue>, context: KernelRpcContext): WriteDocumentInput {
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

export function toDeleteDocumentInput(params: Record<string, JsonValue>, context: KernelRpcContext): DeleteDocumentInput {
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

export function toRevertChangesetInput(params: Record<string, JsonValue>, context: KernelRpcContext): RevertChangesetInput {
  return {
    changesetId: readString(params, 'changesetId'),
    reason: typeof params.reason === 'string' ? params.reason : undefined,
    actor: actorFromContext(context),
    correlationId: context.correlationId,
    callId: context.callId,
    parentCallId: context.parentCallId,
  }
}

export function actorFromContext(context: KernelRpcContext): ActorRef {
  return context.clientId ? { kind: 'client', id: context.clientId } : { kind: 'kernel', id: 'kernel' }
}

export function readSafeDocumentMeta(params: Record<string, JsonValue>): WriteDocumentInput['meta'] {
  if (!isRecord(params.meta)) return undefined
  if (!isRecord(params.meta.source) || typeof params.meta.source.kind !== 'string') return undefined
  return { source: params.meta.source as DocumentSourceRef }
}

export function readExpectedVersion(params: Record<string, JsonValue>): WriteDocumentInput['expectedVersion'] {
  if (params.expectedVersion === 'new' || typeof params.expectedVersion === 'number') return params.expectedVersion
  return undefined
}

export function rejectForbiddenLoomRunFields(params: Record<string, JsonValue>): void {
  const forbidden = ['messages', 'model', 'temperature', 'tools', 'toolChoice', 'chatId', 'sessionId', 'provider']
  const found = forbidden.filter(field => field in params)
  if (found.length > 0) {
    throw new Error(`Forbidden loom.run fields: ${found.join(', ')}`)
  }
}

export function toLoomRunInput(params: Record<string, JsonValue>): LoomRunInput {
  if (!Array.isArray(params.fragments)) throw new Error('loom.run fragments must be an array')
  if (!Array.isArray(params.passes)) throw new Error('loom.run passes must be an array')
  return {
    fragments: params.fragments,
    passes: params.passes,
    options: params.options,
    trace: readTraceOptions(params.trace),
  }
}

export function readTraceOptions(value: JsonValue | undefined): LoomRunInput['trace'] {
  if (!isRecord(value)) return undefined
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : undefined,
    strictPersist: typeof value.strictPersist === 'boolean' ? value.strictPersist : undefined,
  }
}

export function summarizeDataCommit(commit: DataCommitFact): JsonValue {
  return {
    changesetId: commit.changesetId,
    operations: commit.operations.map(summarizeDataOperation),
  }
}

export function summarizeDocumentCommit(commit: DataCommitFact, operations = readDocumentOperations(commit)): JsonValue {
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

export function summarizeDataOperation(operation: DataCommitOperation): JsonValue {
  return {
    store: operation.store,
    kind: operation.kind,
    entityId: operation.entityId,
    entityType: operation.entityType,
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

export function readDocumentOperations(commit: DataCommitFact): DataCommitOperation[] {
  return commit.operations.filter(operation => operation.store === 'documents')
}

export function summarizeDocumentRollback(targetChangesetId: string, result: { commit: DataCommitFact }): JsonValue {
  return {
    targetChangesetId,
    ...summarizeDocumentCommit(result.commit) as Record<string, JsonValue>,
  }
}
