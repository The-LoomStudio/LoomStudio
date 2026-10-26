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
  ExtensionInstallationTarget,
} from '@loom-studio/extension-sdk'
import { isJsonObject, nowIso, serializeError, type JsonValue } from '@loom-studio/shared'
import type {
  CreateKernelOptions,
  EventBus,
  EventEmitOptions,
  ExtensionManagementService,
  ExtensionModuleCapabilityGrants,
  Kernel,
  KernelRpcContext,
  RegistrationHandle
} from './types.js'

export function createBuiltinHandlers(kernel: Kernel,
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
    'docs.get': async (params: JsonValue | undefined) => {
      const id = readString(params, 'id')
      const document = await options.documents.get(id, {
        includeTombstone: isRecord(params) && params.includeTombstone === true,
        version: isRecord(params) && typeof params.version === 'number' ? params.version : undefined,
      })

      return { document: document }
    },
    'docs.list': async (params: JsonValue | undefined) => {
      const result = await options.documents.list((isRecord(params) ? params : {}) as ListDocumentsInput)
      return result
    },
    'docs.getChangeset': async (params: JsonValue | undefined) => {
      const changeset = await options.documents.getChangeset(readString(params, 'changesetId'))
      return { changeset }
    },
    'docs.write': async (params: JsonValue | undefined, context: KernelRpcContext) => {
      if (!isRecord(params)) throw new Error('docs.write params must be an object')
      return await options.documents.write(toWriteDocumentInput(params, context))
    },
    'docs.delete': async (params: JsonValue | undefined, context: KernelRpcContext) => {
      if (!isRecord(params)) throw new Error('docs.delete params must be an object')
      return await options.documents.delete(toDeleteDocumentInput(params, context))
    },
    'docs.revertChangeset': async (params: JsonValue | undefined, context: KernelRpcContext) => {
      if (!isRecord(params)) throw new Error('docs.revertChangeset params must be an object')
      const targetChangesetId = readString(params, 'changesetId')

      try {
        const result = await options.documents.revertChangeset(toRevertChangesetInput(params, context))
        eventBus.emit('docs.rollback.completed', summarizeDocumentRollback(targetChangesetId, result), context)
        return result
      } catch (error) {
        eventBus.emit('docs.rollback.failed', {
          targetChangesetId,
          error: serializeError(error, 'document.revert_failed'),
        }, context)
        throw error
      }
    },
    'extensions.listPackages': (params: JsonValue | undefined) => {
      const target = readOptionalExtensionTarget(params)
      return {
        items: target ? requireExtensionManager(options).listPackages(target)
          : options.extensionManager?.listPackages() ?? options.extensionHost.list(),
      }
    },
    'extensions.installCardPackage': async (params: JsonValue | undefined, context: KernelRpcContext) => {
      const version = isRecord(params) ? params.expectedCardVersion : undefined
      if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) throw new Error('expectedCardVersion must be a positive integer')
      const cardId = readString(params, 'cardId')
      const extensionPackage = await requireExtensionManager(options).installCardPackage({
        cardId, packageId: readString(params, 'packageId'), expectedCardVersion: version,
      })
      eventBus.emit('extensions.changed', {
        packageId: extensionPackage.packageId, target: { kind: 'card', cardId }, action: 'installed',
      }, context)
      return { package: extensionPackage }
    },
    'extensions.uninstallCardPackage': async (params: JsonValue | undefined, context: KernelRpcContext) => {
      const version = isRecord(params) ? params.expectedInstallationVersion : undefined
      if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) throw new Error('expectedInstallationVersion must be a positive integer')
      const cardId = readString(params, 'cardId')
      const extensionPackage = await requireExtensionManager(options).uninstallCardPackage({
        cardId, packageId: readString(params, 'packageId'), expectedInstallationVersion: version,
      })
      eventBus.emit('extensions.changed', {
        packageId: extensionPackage.packageId, target: { kind: 'card', cardId }, action: 'uninstalled',
      }, context)
      return { package: extensionPackage }
    },
    'extensions.updateCardPackage': async (params: JsonValue | undefined, context: KernelRpcContext) => {
      const cardVersion = isRecord(params) ? params.expectedCardVersion : undefined
      const installationVersion = isRecord(params) ? params.expectedInstallationVersion : undefined
      if (typeof cardVersion !== 'number' || !Number.isSafeInteger(cardVersion) || cardVersion < 1
        || typeof installationVersion !== 'number' || !Number.isSafeInteger(installationVersion) || installationVersion < 1) {
        throw new Error('Card and installation versions must be positive integers')
      }
      const cardId = readString(params, 'cardId')
      const extensionPackage = await requireExtensionManager(options).updateCardPackage({
        cardId, packageId: readString(params, 'packageId'), packageVersion: readString(params, 'packageVersion'),
        expectedCardVersion: cardVersion, expectedInstallationVersion: installationVersion,
      })
      eventBus.emit('extensions.changed', {
        packageId: extensionPackage.packageId, target: { kind: 'card', cardId }, action: 'updated',
      }, context)
      return { package: extensionPackage }
    },
    'extensions.installPackage': async (params: JsonValue | undefined, context: KernelRpcContext) => {
      const manager = requireExtensionManager(options)
      const sourceDirectory = readString(params, 'sourceDirectory')
      const extensionPackage = await manager.installPackage(sourceDirectory)
      eventBus.emit('extensions.changed', {
        packageId: extensionPackage.packageId,
        version: extensionPackage.version,
        action: 'installed',
      }, context)
      return { package: extensionPackage }
    },
    'extensions.installPackageZip': async (params: JsonValue | undefined, context: KernelRpcContext) => {
      const manager = requireExtensionManager(options)
      if (!isRecord(params) || typeof params.base64 !== 'string') throw new Error('extensions.installPackageZip requires base64')
      const extensionPackage = await manager.installPackageZip(new Uint8Array(Buffer.from(params.base64, 'base64')))
      eventBus.emit('extensions.changed', {
        packageId: extensionPackage.packageId,
        version: extensionPackage.version,
        action: 'installed',
      }, context)
      return { package: extensionPackage }
    },
    'extensions.previewRemoteInstall': async (params: JsonValue | undefined) => {
      const manager = requireExtensionManager(options)
      if (!manager.previewRemoteInstall) throw new Error('Remote extension installation is unavailable')
      return manager.previewRemoteInstall(params)
    },
    'extensions.previewPackageZip': async (params: JsonValue | undefined) => {
      const manager = requireExtensionManager(options)
      if (!manager.previewPackageZip || !isRecord(params) || typeof params.base64 !== 'string') throw new Error('ZIP preview requires package bytes')
      return manager.previewPackageZip(new Uint8Array(Buffer.from(params.base64, 'base64')))
    },
    'extensions.officialSetup': async () => {
      const manager = requireExtensionManager(options)
      if (!manager.officialSetup) throw new Error('Official extension selection is unavailable')
      return manager.officialSetup()
    },
    'extensions.finishOfficialSetup': async () => {
      const manager = requireExtensionManager(options)
      if (!manager.finishOfficialSetup) throw new Error('Official extension selection is unavailable')
      return manager.finishOfficialSetup()
    },
    'extensions.previewRemoteChange': async (params: JsonValue | undefined) => {
      const manager = requireExtensionManager(options)
      if (!manager.previewRemoteChange) throw new Error('Remote extension replacement is unavailable')
      return manager.previewRemoteChange(params)
    },
    'extensions.checkRemoteUpdate': async (params: JsonValue | undefined) => {
      const manager = requireExtensionManager(options)
      if (!manager.checkRemoteUpdate) throw new Error('Remote extension updates are unavailable')
      return manager.checkRemoteUpdate(readString(params, 'packageId'))
    },
    'extensions.commitRemoteInstall': async (params: JsonValue | undefined, context: KernelRpcContext) => {
      const manager = requireExtensionManager(options)
      if (!manager.commitRemoteInstall) throw new Error('Remote extension installation is unavailable')
      const result = await manager.commitRemoteInstall(readString(params, 'token'))
      eventBus.emit('extensions.changed', { action: 'installed' }, context)
      return result
    },
    'extensions.uninstallPackage': async (params: JsonValue | undefined, context: KernelRpcContext) => {
      if (readOptionalExtensionTarget(params)?.kind === 'card') throw new Error('Use extensions.uninstallCardPackage for a Card installation')
      const manager = requireExtensionManager(options)
      const packageId = readString(params, 'packageId')
      const version = isRecord(params) && typeof params.version === 'string' ? params.version : undefined
      if (isRecord(params) && params.deleteData !== undefined && typeof params.deleteData !== 'boolean') throw new Error('deleteData must be boolean')
      const extensionPackage = await manager.uninstallPackage(packageId, version, isRecord(params) && params.deleteData === true)
      eventBus.emit('extensions.changed', {
        packageId,
        ...(version ? { version } : {}),
        action: 'uninstalled',
      }, context)
      return { package: extensionPackage }
    },
    'extensions.enableModule': async (params: JsonValue | undefined, context: KernelRpcContext) => {
      const manager = requireExtensionManager(options)
      const packageId = readString(params, 'packageId')
      const moduleId = readString(params, 'moduleId')
      const grants = readExtensionCapabilityGrants(params)
      const target = readOptionalExtensionTarget(params)
      const module = await manager.enableModule(packageId, moduleId, grants, target)
      eventBus.emit('extensions.changed', { packageId, moduleId, ...(target ? { target } : {}), action: 'enabled' }, context)
      return { module }
    },
    'extensions.disableModule': async (params: JsonValue | undefined, context: KernelRpcContext) => {
      const manager = requireExtensionManager(options)
      const packageId = readString(params, 'packageId')
      const moduleId = readString(params, 'moduleId')
      const target = readOptionalExtensionTarget(params)
      const module = await manager.disableModule(packageId, moduleId, target)
      eventBus.emit('extensions.changed', { packageId, moduleId, ...(target ? { target } : {}), action: 'disabled' }, context)
      return { module }
    },
    'extensions.reloadModule': async (params: JsonValue | undefined, context: KernelRpcContext) => {
      const manager = requireExtensionManager(options)
      const packageId = readString(params, 'packageId')
      const moduleId = readString(params, 'moduleId')
      const target = readOptionalExtensionTarget(params)
      const module = await manager.reloadModule(packageId, moduleId, target)
      eventBus.emit('extensions.changed', { packageId, moduleId, ...(target ? { target } : {}), action: 'reloaded' }, context)
      return { module }
    },
    'extensions.importPackageResources': async (params: JsonValue | undefined) => {
      if (isRecord(params) && params.target !== undefined) throw new Error('Extension installation targets are not exposed by this endpoint yet')
      const manager = requireExtensionManager(options)
      return await manager.importPackageResources(readString(params, 'packageId'))
    },
    'extensions.removePackageResources': async (params: JsonValue | undefined) => {
      if (isRecord(params) && params.target !== undefined) throw new Error('Extension installation targets are not exposed by this endpoint yet')
      const manager = requireExtensionManager(options)
      return await manager.removePackageResources(readString(params, 'packageId'))
    },
    'extensions.updatePackageResources': async (params: JsonValue | undefined) => {
      if (isRecord(params) && params.target !== undefined) throw new Error('Extension installation targets are not exposed by this endpoint yet')
      const expectedInstallationVersion = isRecord(params) ? params.expectedInstallationVersion : undefined
      if (typeof expectedInstallationVersion !== 'number' || !Number.isSafeInteger(expectedInstallationVersion) || expectedInstallationVersion < 1) {
        throw new Error('expectedInstallationVersion must be a positive integer')
      }
      return await requireExtensionManager(options).updatePackageResources({
        packageId: readString(params, 'packageId'),
        packageVersion: readString(params, 'packageVersion'),
        expectedInstallationVersion,
      })
    },
    'extensions.exportPackage': async (params: JsonValue | undefined) => {
      return await requireExtensionManager(options).exportPackage({
        packageId: readString(params, 'packageId'),
        version: readString(params, 'version'),
      })
    },
    'extensions.callPackageRpc': async (params: JsonValue | undefined, context: KernelRpcContext) => {
      const packageId = readString(params, 'packageId')
      const method = readString(params, 'method')
      if (!method.startsWith(`${packageId}.`)) throw new Error('Client extension RPC must use its package namespace')
      const target = readOptionalExtensionTarget(params)
      if (!target) throw new Error('Invalid Extension installation target')
      return await kernel.callRpc(method, isRecord(params) ? params.params : undefined, {
        ...context, callId: undefined, parentCallId: context.callId,
        extensionTarget: target, expectedExtensionPackageId: packageId,
      })
    },
    'extensions.importCardPackageResources': async (params: JsonValue | undefined) => {
      const version = isRecord(params) ? params.expectedCardVersion : undefined
      if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) throw new Error('expectedCardVersion must be a positive integer')
      return await requireExtensionManager(options).importCardPackageResources({
        cardId: readString(params, 'cardId'), packageId: readString(params, 'packageId'), expectedCardVersion: version,
      })
    },
    'extensions.updateCardPackageResources': async (params: JsonValue | undefined) => {
      const cardVersion = isRecord(params) ? params.expectedCardVersion : undefined
      const installationVersion = isRecord(params) ? params.expectedInstallationVersion : undefined
      if (typeof cardVersion !== 'number' || !Number.isSafeInteger(cardVersion) || cardVersion < 1
        || typeof installationVersion !== 'number' || !Number.isSafeInteger(installationVersion) || installationVersion < 1) {
        throw new Error('Card and installation versions must be positive integers')
      }
      return await requireExtensionManager(options).importCardPackageResources({
        cardId: readString(params, 'cardId'), packageId: readString(params, 'packageId'), expectedCardVersion: cardVersion,
        update: { packageVersion: readString(params, 'packageVersion'), expectedInstallationVersion: installationVersion },
      })
    },
    'extensions.removeCardPackageResources': async (params: JsonValue | undefined) => {
      const version = isRecord(params) ? params.expectedInstallationVersion : undefined
      if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) throw new Error('expectedInstallationVersion must be a positive integer')
      return await requireExtensionManager(options).removeCardPackageResources({
        cardId: readString(params, 'cardId'), packageId: readString(params, 'packageId'), expectedInstallationVersion: version,
      })
    },
    'extensions.getDiagnostics': (params: JsonValue | undefined) => {
      const packageId = isRecord(params) && typeof params.packageId === 'string' ? params.packageId : undefined
      const moduleId = isRecord(params) && typeof params.moduleId === 'string' ? params.moduleId : undefined
      return {
        diagnostics: options.extensionHost.diagnostics(packageId, moduleId),
      }
    },
    'diagnostics.list': (params: JsonValue | undefined) => {
      const diagnostics = options.diagnostics.list(isRecord(params) ? params : undefined)
      return { items: diagnostics }
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
  return Object.entries(handlers).map(([method, handler]) => kernel.registerKernelRpc(method, async (params, context) => {
    // The dynamic extension registry transports JSON; concrete built-in outputs stay inferred above.
    return await handler(params, context) as unknown as JsonValue
  }))
}

function requireExtensionManager(options: CreateKernelOptions): ExtensionManagementService {
  if (!options.extensionManager) throw new Error('Extension management is not configured')
  return options.extensionManager
}

function readOptionalExtensionTarget(params: JsonValue | undefined): ExtensionInstallationTarget | undefined {
  const value = isRecord(params) ? params.target : undefined
  if (value === undefined) return undefined
  if (isRecord(value) && value.kind === 'global') return { kind: 'global' }
  if (isRecord(value) && value.kind === 'card' && typeof value.cardId === 'string' && value.cardId.trim()) {
    return { kind: 'card', cardId: value.cardId }
  }
  throw new Error('Invalid Extension installation target')
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
  const ui = params.grants.ui
  if (ui !== undefined && (!Array.isArray(ui) || !ui.every(value => value === 'ui.notify'))) {
    throw new Error('extensions.enableModule grants.ui must contain ui.notify')
  }
  return {
    uiCapabilities: ui as Array<'ui.notify'> | undefined,
    eventCapabilities: subscriptions as EventCapabilityCategory[] | undefined,
    assetCapabilities: assets as ExtensionAssetCapability[] | undefined,
  }
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return isJsonObject(value)
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

export function readDocumentOperations(commit: DataCommitFact): DataCommitOperation[] {
  return commit.operations.filter(operation => operation.store === 'documents')
}

function summarizeDocumentRollback(targetChangesetId: string, result: { commit: DataCommitFact }): JsonValue {
  return {
    targetChangesetId,
    ...summarizeDocumentCommit(result.commit) as Record<string, JsonValue>,
  }
}
