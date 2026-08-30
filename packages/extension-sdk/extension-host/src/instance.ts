import { realpathSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import type { DiagnosticInput, DiagnosticsRegistry } from '@loom-studio/diagnostics'
import type { ActorRef, WriteDocumentResult } from '@loom-studio/document-store'
import type {
  AiGatewayProviderRegistration,
  EventPublishIdentity,
  EventSubscriberIdentity,
  ExtensionActivationContext,
  ExtensionDocumentWriteInput,
  ExtensionRpcHandler,
  ServerExtensionModule,
} from '@loom-studio/extension-sdk'
import type { JsonObject, JsonValue } from '@loom-studio/shared'
import { serializeError } from '@loom-studio/shared'
import {
  kernelNamespaces,
  studioReservedNamespaces,
  type ExtensionHostLogger,
  type ExtensionHostOptions,
  type ExtensionInstance,
  type ExtensionInstanceState,
  type ExtensionModuleRecord,
  type ExtensionModuleSummary,
  type ExtensionScope,
  type ScopeEntry,
} from './types.js'
import {
  assertAssetCapability,
  assertDeclaredDocumentType,
  assertDocumentAccess,
  assertPortablePayloadOwner,
  assertScopeActive,
  createExtensionStorageContext,
  moduleKey,
  requirePortablePayloads,
} from './storage.js'

export async function loadServerModule(record: ExtensionModuleRecord, instanceId: string): Promise<ServerExtensionModule> {
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

export function createContext(
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
    ai: {
      registerProvider: registration => {
        assertScopeActive(instance)
        if (!options.aiCapabilities) throw new Error('AI Gateway capabilities are not available in this host')
        const providerId = registration.provider.id
        if (!providerId.startsWith(`${packageManifest.id}.`)) {
          throw new Error(`Extension AI provider must use package namespace: ${providerId}`)
        }
        const declared = moduleManifest.contributes?.aiProviders?.some(provider => provider.id === providerId)
        if (!declared) {
          if (options.mode === 'production') throw new Error(`AI provider ${providerId} is not declared in manifest contributes.aiProviders`)
          reportDiagnostic(options.diagnostics, record, instance.instanceId, {
            severity: 'warning',
            code: 'extension.ai_provider_not_declared',
            message: `AI provider ${providerId} is not declared in manifest contributes.aiProviders`,
            source: 'extension-host',
          })
        }
        const wrappedHandlers = Object.fromEntries(Object.entries(registration.handlers).map(([capabilityId, handler]) => [
          capabilityId,
          (input: Parameters<typeof handler>[0]) => instance.scope.run(() => handler({
            ...input,
            signal: input.signal
              ? AbortSignal.any([input.signal, instance.scope.signal])
              : instance.scope.signal,
          })),
        ])) as AiGatewayProviderRegistration['handlers']
        const handle = options.aiCapabilities.register({
          provider: registration.provider,
          handlers: wrappedHandlers,
        }, {
          kind: 'extension',
          packageId: packageManifest.id,
          moduleId: moduleManifest.id,
          instanceId: instance.instanceId,
        })
        instance.scope.track(`ai-provider:${providerId}`, handle)
        instance.registeredAiProviderIds.add(providerId)
        return handle
      },
      listProviders: () => {
        assertScopeActive(instance)
        return options.aiCapabilities?.list() ?? []
      },
      invoke: input => {
        assertScopeActive(instance)
        if (moduleManifest.capabilities?.['ai.invoke'] !== true) {
          throw new Error(`Extension module is not allowed to invoke AI capabilities: ${moduleKey(packageManifest.id, moduleManifest.id)}`)
        }
        if (!options.aiGateway) throw new Error('AI Gateway invocation is not available in this host')
        return options.aiGateway.invoke({
          ...input,
          signal: input.signal
            ? AbortSignal.any([input.signal, instance.scope.signal])
            : instance.scope.signal,
          caller: { kind: 'extension', id: packageManifest.id },
        })
      },
    },
    agentTools: {
      register: (toolId, handler) => {
        assertScopeActive(instance)
        const declared = moduleManifest.contributes?.agentToolHandlers?.some(item => item.toolId === toolId)
        if (!declared) {
          if (options.mode === 'production') throw new Error(`Agent Tool Handler ${toolId} is not declared in manifest contributes.agentToolHandlers`)
          reportDiagnostic(options.diagnostics, record, instance.instanceId, {
            severity: 'warning',
            code: 'extension.agent_tool_handler_not_declared',
            message: `Agent Tool Handler ${toolId} is not declared in manifest contributes.agentToolHandlers`,
            source: 'extension-host',
          })
        }
        if (!options.registerAgentToolHandler) throw new Error('Agent Tool Handler registration is not available in this host')
        const registration = options.registerAgentToolHandler(
          toolId,
          packageManifest.id,
          moduleManifest.id,
          instance.instanceId,
          (input, context) => instance.scope.run(() => handler(input, {
            signal: AbortSignal.any([context.signal, instance.scope.signal]),
          })),
        )
        instance.scope.track(`agent-tool:${toolId}`, registration)
        instance.registeredAgentToolIds.add(toolId)
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
    portablePayloads: {
      publish: async input => {
        assertScopeActive(instance)
        const portablePayloads = requirePortablePayloads(options)
        return await portablePayloads.create({
          packageId: packageManifest.id,
          artifactPayloadId: input.artifactPayloadId,
          payload: input.payload,
        })
      },
      listOwn: async () => {
        assertScopeActive(instance)
        return await requirePortablePayloads(options).list(packageManifest.id)
      },
      readOwn: async payloadId => {
        assertScopeActive(instance)
        const payload = await requirePortablePayloads(options).get(payloadId)
        assertPortablePayloadOwner(packageManifest.id, payload)
        return payload
      },
      updateOwn: async input => {
        assertScopeActive(instance)
        const portablePayloads = requirePortablePayloads(options)
        assertPortablePayloadOwner(packageManifest.id, await portablePayloads.get(input.payloadId))
        return await portablePayloads.update({
          packageId: packageManifest.id,
          payloadId: input.payloadId,
          expectedVersion: input.expectedVersion,
          payload: input.payload,
        })
      },
      deleteOwn: async input => {
        assertScopeActive(instance)
        const portablePayloads = requirePortablePayloads(options)
        assertPortablePayloadOwner(packageManifest.id, await portablePayloads.get(input.payloadId))
        await portablePayloads.delete({
          packageId: packageManifest.id,
          payloadId: input.payloadId,
          expectedVersion: input.expectedVersion,
        })
      },
      replaceOwnCardBindings: async input => {
        assertScopeActive(instance)
        const portablePayloads = requirePortablePayloads(options)
        for (const payloadId of input.payloadIds) {
          assertPortablePayloadOwner(packageManifest.id, await portablePayloads.get(payloadId))
        }
        return await portablePayloads.replaceCardBindings({
          packageId: packageManifest.id,
          cardId: input.cardId,
          expectedVersion: input.expectedVersion,
          payloadIds: input.payloadIds,
        })
      },
    },
    storage: createExtensionStorageContext(record, instance, options, extensionActor),
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

export function createExtensionLogger(
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

export function hasContributionMismatch(record: ExtensionModuleRecord, instance: ExtensionInstance, options: ExtensionHostOptions): boolean {
  const manifest = record.moduleManifest
  let mismatched = false
  const declaredRpcNames = new Set(manifest.contributes?.rpc?.map(rpc => rpc.name) ?? [])
  const declaredEventNames = new Set(manifest.contributes?.events?.map(event => event.name) ?? [])
  const declaredAiProviderIds = new Set(manifest.contributes?.aiProviders?.map(provider => provider.id) ?? [])
  const declaredAgentToolIds = new Set(manifest.contributes?.agentToolHandlers?.map(handler => handler.toolId) ?? [])

  for (const name of instance.registeredRpcNames) {
    if (!declaredRpcNames.has(name)) mismatched = true
  }
  for (const name of instance.registeredEventNames) {
    if (!declaredEventNames.has(name)) mismatched = true
  }
  for (const providerId of instance.registeredAiProviderIds) {
    if (!declaredAiProviderIds.has(providerId)) mismatched = true
  }
  for (const toolId of instance.registeredAgentToolIds) {
    if (!declaredAgentToolIds.has(toolId)) mismatched = true
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

  for (const providerId of declaredAiProviderIds) {
    if (instance.registeredAiProviderIds.has(providerId)) continue
    mismatched = true
    reportDiagnostic(options.diagnostics, record, instance.instanceId, {
      severity: 'warning',
      code: 'extension.ai_provider_declared_but_not_registered',
      message: `AI provider ${providerId} is declared in manifest contributes.aiProviders but was not registered during activation`,
      source: 'extension-host',
    })
  }

  for (const toolId of declaredAgentToolIds) {
    if (instance.registeredAgentToolIds.has(toolId)) continue
    mismatched = true
    reportDiagnostic(options.diagnostics, record, instance.instanceId, {
      severity: 'warning',
      code: 'extension.agent_tool_handler_declared_but_not_registered',
      message: `Agent Tool Handler ${toolId} is declared in manifest contributes.agentToolHandlers but was not registered during activation`,
      source: 'extension-host',
    })
  }

  return mismatched
}

export async function stopInstance(record: ExtensionModuleRecord, options: ExtensionHostOptions): Promise<void> {
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

export async function disposeFailedActivation(record: ExtensionModuleRecord, options: ExtensionHostOptions): Promise<void> {
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

export function createExtensionScope(instanceId: string): ExtensionScope {
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

export function isLiveInstance(state: ExtensionInstanceState): boolean {
  return state === 'created' || state === 'activating' || state === 'active' || state === 'degraded' || state === 'stopping'
}

export function toSummary(record: ExtensionModuleRecord): ExtensionModuleSummary {
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
      aiProviders: record.moduleManifest.contributes?.aiProviders?.map(item => item.id),
      agentToolHandlers: record.moduleManifest.contributes?.agentToolHandlers?.map(item => item.toolId),
    },
  }
}

export function reportDiagnostic(
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

export function isKernelNamespace(name: string): boolean {
  return kernelNamespaces.includes(name.split('.')[0] ?? '')
}

export function isStudioReservedNamespace(name: string): boolean {
  return studioReservedNamespaces.includes(name.split('.')[0] ?? '')
}
