import { realpathSync } from 'node:fs'
import { AsyncLocalStorage } from 'node:async_hooks'
import { createTextTokenCounter } from '@loom-studio/tokenizer/async'
import { cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import type { DiagnosticInput, DiagnosticsRegistry } from '@loom-studio/diagnostics'
import { DocumentStoreError, type ActorRef, type WriteDocumentResult } from '@loom-studio/document-store'
import { createExtensionLogWriter } from '@loom-studio/logging'
import { extensionInstallationId, installedExtensionContributionId } from '@loom-studio/extension-sdk'
import type {
  AiGatewayProviderRegistration,
  EventPublishIdentity,
  EventSubscriberIdentity,
  ExtensionActivationContext,
  ExtensionTimelineExecution,
  ExtensionTimelineLease,
  ExtensionTimelineTarget,
  ExtensionDocumentWriteInput,
  ExtensionMediaAsset,
  ExtensionRpcHandler,
  ServerExtensionModule,
} from '@loom-studio/extension-sdk'
import type { JsonValue } from '@loom-studio/shared'
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
  storageInstallationId,
} from './storage.js'

export async function loadServerModule(record: ExtensionModuleRecord, instanceId: string, options?: ExtensionHostOptions): Promise<ServerExtensionModule> {
  if (record.load) {
    const loaded = await record.load(instanceId)
    if (typeof loaded.activate !== 'function') throw new Error('Server extension must export activate(ctx)')
    return loaded
  }
  const entry = record.moduleManifest.entry
  const directory = realpathSync(record.directory)
  const modulePath = realpathSync(resolve(directory, entry))
  const pathFromDirectory = relative(directory, modulePath)
  if (!pathFromDirectory || pathFromDirectory.startsWith('..') || isAbsolute(pathFromDirectory)) {
    throw new Error(`Extension module entry must stay inside its package directory: ${entry}`)
  }
  let runtimePath = modulePath
  if (options?.serverModuleSnapshotRoot) {
    const snapshot = join(options.serverModuleSnapshotRoot, instanceId)
    record.instance!.scope.track('server-module-snapshot', { dispose: () => rm(snapshot, { recursive: true, force: true }) })
    await mkdir(options.serverModuleSnapshotRoot, { recursive: true })
    await cp(directory, snapshot, {
      recursive: true,
      filter: path => !['.git', '.loom-source.json', 'node_modules'].includes(relative(directory, path).split(/[\\/]/)[0] ?? ''),
    })
    runtimePath = resolve(snapshot, pathFromDirectory)
    // ponytail: Node ESM cannot evict old module graphs; snapshots refresh relative imports, while process restart releases cached modules.
  }
  const loaded = await import(`${pathToFileURL(runtimePath).href}?instance=${encodeURIComponent(instanceId)}`) as Partial<ServerExtensionModule> & { default?: ServerExtensionModule }
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
    target: structuredClone(record.target),
  }
  const subscriber: EventSubscriberIdentity = {
    kind: 'extension',
    packageId: packageManifest.id,
    moduleId: moduleManifest.id,
    instanceId: instance.instanceId,
    target: structuredClone(record.target),
    capabilities: instance.grantedEventCapabilities,
  }
  let scratchTracked = false
  const assertAssetAccess = async (asset: ExtensionMediaAsset): Promise<void> => {
    const ownerInstallationId = record.target.kind === 'card' ? extensionInstallationId(packageManifest.id, record.target) : undefined
    if (asset.ownerPackageId === packageManifest.id && asset.ownerInstallationId === ownerInstallationId) return
    assertAssetCapability(instance, 'assets.read')
    if (record.target.kind === 'card' && asset.ownerInstallationId) {
      if (!options.canAccessAsset || !await options.canAccessAsset(asset, structuredClone(record.target))) {
        throw new Error('Media Asset is outside this Card installation scope')
      }
      assertScopeActive(instance)
    }
  }
  const canAccessState = async (target: import('@loom-studio/extension-sdk').ExtensionStateTarget): Promise<boolean> => {
    if (packageManifest.participation === 'timeline') {
      const execution = timelineWork.getStore()
      if (!execution || target.scope !== 'timeline' || target.timelineId !== execution.target.timelineId
        || target.branchId !== execution.target.branchId) return false
      execution.signal.throwIfAborted()
      if (!options.assertTimelineWork) throw new Error('Timeline execution checks are unavailable')
      await options.assertTimelineWork(execution.lease)
    }
    if (record.target.kind === 'global') return true
    if (target.scope === 'global') return false
    if (!options.canAccessState) throw new Error('Card State access validation is not available in this host')
    return options.canAccessState(target, structuredClone(record.target))
  }
  const observationContext = new AsyncLocalStorage<import('./types.js').ExtensionObservationContext>()
  const observationOwner = () => ({ moduleId: moduleManifest.id, instanceId: instance.instanceId, ...observationContext.getStore() })
  const timelineWork = new AsyncLocalStorage<ExtensionTimelineExecution & { lease: ExtensionTimelineLease }>()
  const initializationWork = new AsyncLocalStorage<AbortSignal>()
  const executionSignal = async (): Promise<AbortSignal> => {
    if (packageManifest.participation !== 'timeline') return instance.scope.signal
    const execution = timelineWork.getStore()
    if (execution) {
      execution.signal.throwIfAborted()
      if (!options.assertTimelineWork) throw new Error('Timeline execution checks are unavailable')
      await options.assertTimelineWork(execution.lease)
      return execution.signal
    }
    const initialization = initializationWork.getStore()
    if (initialization) {
      initialization.throwIfAborted()
      return initialization
    }
    throw new Error('Timeline extension work must run inside ctx.timeline.run')
  }
  const runTimeline = async <T>(target: ExtensionTimelineTarget, work: (execution: ExtensionTimelineExecution) => Promise<T>, signal?: AbortSignal): Promise<T> => {
    assertScopeActive(instance)
    if (packageManifest.participation !== 'timeline') throw new Error('Extension must declare Timeline participation')
    if (target.scope !== 'timeline' || typeof target.timelineId !== 'string' || !target.timelineId.trim()
      || typeof target.branchId !== 'string' || !target.branchId.trim()) throw new Error('Timeline work requires an explicit Timeline and Branch target')
    const current = timelineWork.getStore()
    if (current) {
      if (target.timelineId !== current.target.timelineId || target.branchId !== current.target.branchId) {
        throw new Error('Nested Timeline work cannot change its target')
      }
      current.signal.throwIfAborted()
      if (!options.assertTimelineWork) throw new Error('Timeline execution checks are unavailable')
      await options.assertTimelineWork(current.lease)
      return work({ target: current.target, signal: current.signal, narrativeSource: current.narrativeSource })
    }
    if (!options.runTimelineWork) throw new Error('Timeline execution is unavailable')
    const frozenTarget = Object.freeze(structuredClone(target))
    return instance.scope.run(() => options.runTimelineWork!({
      timelineId: frozenTarget.timelineId,
      branchId: frozenTarget.branchId,
      installationId: extensionInstallationId(packageManifest.id, record.target),
      packageVersion: packageManifest.version,
      signal: signal ? AbortSignal.any([signal, instance.scope.signal]) : instance.scope.signal,
    }, execution => timelineWork.run({ ...execution, target: frozenTarget }, () =>
      work({ target: frozenTarget, signal: execution.signal, narrativeSource: execution.narrativeSource }))))
  }
  const isTimelineAvailable = async (timelineId?: string): Promise<boolean> => {
    if (!timelineId) return false
    if (!options.canRunTimelineWork) throw new Error('Timeline eligibility checks are unavailable')
    return options.canRunTimelineWork({ timelineId, installationId: extensionInstallationId(packageManifest.id, record.target) })
  }
  const subscribeEvents = (patterns: string[], handler: (event: import('@loom-studio/extension-sdk').StudioEvent) => void | Promise<void>) => {
    if (!options.subscribeEvents) throw new Error('Extension event subscriptions are not available in this host')
    let active = true
    const registration = options.subscribeEvents(patterns, async event => {
      const deliver = () => observationContext.run({ eventId: event.meta.eventId, eventName: event.name,
        correlationId: event.meta.correlationId, parentCallId: event.meta.callId ?? event.meta.parentCallId }, () => handler(event))
      if (!active || !instance.scope.active) return
      if (packageManifest.participation === 'timeline' && event.name !== 'system.ready' && event.name !== 'system.stopping') {
        if (event.name !== 'state.changed') return
        const payload = event.payload as Partial<import('@loom-studio/extension-sdk').ExtensionStateChangeEvent>
        if (payload?.target?.scope !== 'timeline') return
        if (!options.canRunTimelineWork) throw new Error('Timeline event eligibility checks are unavailable')
        if (!await options.canRunTimelineWork({
          timelineId: payload.target.timelineId,
          installationId: extensionInstallationId(packageManifest.id, record.target),
        })) return
        if (!active || !instance.scope.active) return
        return runTimeline(payload.target, async () => { await deliver() })
      }
      if (record.target.kind === 'card' && event.name === 'state.changed') {
        const payload = event.payload as Partial<import('@loom-studio/extension-sdk').ExtensionStateChangeEvent>
        if (!payload?.target) return
        return canAccessState(payload.target).then(allowed => {
          if (allowed && active && instance.scope.active) return deliver()
        })
      }
      return deliver()
    }, subscriber)
    return { dispose: () => { active = false; return registration.dispose() } }
  }


  const requireTimelineCapability = async (capability: 'narrative.read' | 'agent.tasks' | 'vfs.provide') => {
    assertScopeActive(instance)
    if (moduleManifest.capabilities?.[capability] !== true) throw new Error(`Extension module requires ${capability}`)
    const execution = timelineWork.getStore()
    if (!execution) throw new Error('This capability requires ctx.timeline.run')
    await executionSignal()
    return execution
  }
  const taskOwner = { packageId: packageManifest.id, installationId: extensionInstallationId(packageManifest.id, record.target) }
  const withTask = async <T>(work: (service: NonNullable<ExtensionHostOptions['extensionAgentTasks']>, execution: NonNullable<ReturnType<typeof timelineWork.getStore>>) => Promise<T>) => {
    const execution = await requireTimelineCapability('agent.tasks')
    if (!options.extensionAgentTasks) throw new Error('Extension Agent tasks are unavailable')
    const result = await work(options.extensionAgentTasks, execution)
    await executionSignal()
    return result
  }

  return {
    archives: {
      registerRecords: adapter => {
        assertScopeActive(instance)
        if (packageManifest.participation !== 'timeline') throw new Error('Record archives require Timeline participation')
        if (!adapter.id.startsWith(`${packageManifest.id}.`)) throw new Error('Archive adapter must use package namespace')
        if (!options.registerRecordArchive) throw new Error('Record archives are unavailable')
        const handle = options.registerRecordArchive({ ...adapter,
          remap: input => instance.scope.run(() => Promise.resolve(adapter.remap(input))),
        }, { ...taskOwner, target: structuredClone(record.target) })
        instance.scope.track(`record-archive:${adapter.id}`, handle)
        return handle
      },
    },
    narrative: {
      read: async input => {
        const execution = await requireTimelineCapability('narrative.read')
        if (!options.readExtensionNarrative) throw new Error('Narrative reading is unavailable')
        const result = await options.readExtensionNarrative(execution.target, input, execution.signal)
        await executionSignal()
        return result
      },
      validate: async source => {
        const execution = await requireTimelineCapability('narrative.read')
        if (!options.validateExtensionNarrative) throw new Error('Narrative validation is unavailable')
        const result = await options.validateExtensionNarrative(execution.target, source, execution.signal)
        await executionSignal()
        return result
      },
      subscribe: handler => {
        assertScopeActive(instance)
        if (moduleManifest.capabilities?.['narrative.read'] !== true || packageManifest.participation !== 'timeline')
          throw new Error('Narrative activity requires narrative.read and Timeline participation')
        if (!options.subscribeNarrativeActivity) throw new Error('Narrative activity is unavailable')
        let active = true
        const registration = options.subscribeNarrativeActivity(event => {
          void (async () => {
            if (!active || !instance.scope.active || !await isTimelineAvailable(event.timelineId)) return
            await runTimeline({ scope: 'timeline', timelineId: event.timelineId, branchId: event.branchId }, async () => {
              if (active) await handler(event)
            })
          })().catch(error => reportDiagnostic(options.diagnostics, record, instance.instanceId, {
            severity: 'error', code: 'extension.narrative_listener_failed', source: 'extension-host',
            message: error instanceof Error ? error.message : String(error),
          }))
        })
        const handle = { dispose() { active = false; registration.dispose() } }
        instance.scope.track('narrative-activity', handle)
        return handle
      },
    },
    agentTasks: {
      subscribe: input => withTask((service, execution) => service.subscribe(taskOwner, execution.target, input, execution.signal)),
      acknowledge: sessionId => withTask((service, execution) => service.acknowledge(taskOwner, execution.target, sessionId, execution.signal)),
      create: input => withTask((service, execution) => service.create(taskOwner, execution.target, input, execution.signal)),
      invoke: input => withTask((service, execution) => service.invoke(taskOwner, execution.target, input, execution.signal, observationOwner())),
      read: sessionId => withTask((service, execution) => service.read(taskOwner, execution.target, sessionId, execution.signal)),
      cancel: sessionId => withTask(async (service, execution) => { await service.cancel(taskOwner, execution.target, sessionId, execution.signal) }),
      dispose: sessionId => withTask(async (service, execution) => { await service.dispose(taskOwner, execution.target, sessionId, execution.signal) }),
    },
    vfs: {
      register: provider => {
        assertScopeActive(instance)
        if (moduleManifest.capabilities?.['vfs.provide'] !== true || packageManifest.participation !== 'timeline')
          throw new Error('Readonly files require vfs.provide and Timeline participation')
        if (!provider.id.startsWith(`${packageManifest.id}.`)) throw new Error('Readonly file provider must use package namespace')
        if (!options.registerReadonlyFiles) throw new Error('Readonly file providers are unavailable')
        const handle = options.registerReadonlyFiles({ ...provider,
          id: installedExtensionContributionId(packageManifest.id, record.target, provider.id),
          resolve: target => runTimeline({ scope: 'timeline', ...target }, () => provider.resolve(target)),
        }, { target: structuredClone(record.target), isAvailable: target => isTimelineAvailable(target.timelineId) })
        instance.scope.track(`readonly-files:${provider.id}`, handle)
        return handle
      },
    },
    timeline: {
      run: runTimeline,
      subscribe: listener => {
        assertScopeActive(instance)
        if (packageManifest.participation !== 'timeline') throw new Error('Extension must declare Timeline participation')
        if (!options.subscribeTimelineTargets) throw new Error('Timeline target subscriptions are unavailable')
        let active = true
        const registration = options.subscribeTimelineTargets({
          installationId: extensionInstallationId(packageManifest.id, record.target),
        }, () => {
          if (!active || !instance.scope.active) return
          void instance.scope.run(listener).catch(error => reportDiagnostic(options.diagnostics, record, instance.instanceId, {
            severity: 'error', code: 'extension.timeline_listener_failed', source: 'extension-host',
            message: error instanceof Error ? error.message : String(error),
          }))
        })
        const handle = { dispose() { active = false; registration.dispose() } }
        instance.scope.track('timeline-targets', handle)
        return handle
      },
      list: async () => {
        assertScopeActive(instance)
        if (packageManifest.participation !== 'timeline') throw new Error('Extension must declare Timeline participation')
        if (!options.listTimelineTargets) throw new Error('Timeline execution targets are unavailable')
        return options.listTimelineTargets({ installationId: extensionInstallationId(packageManifest.id, record.target) })
      },
    },
    extension: {
      packageId: packageManifest.id,
      moduleId: moduleManifest.id,
      instanceId: instance.instanceId,
      runtime: 'server',
      version: packageManifest.version,
      displayName: packageManifest.displayName,
      directory: record.directory,
    },
    tokens: createTextTokenCounter(instance.scope.signal),
    logger: createExtensionLogger(packageManifest.id, moduleManifest.id, instance.instanceId, options.logger,
      record.target.kind === 'card' ? extensionInstallationId(packageManifest.id, record.target) : undefined),
    logs: {
      query: async input => {
        assertScopeActive(instance)
        if (!options.queryLogs) throw new Error('Extension log queries are not available in this host')
        return options.queryLogs(packageManifest.id, input,
          record.target.kind === 'card' ? extensionInstallationId(packageManifest.id, record.target) : undefined)
      },
    },
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
        const wrapped: ExtensionRpcHandler = (params, context) => observationContext.run({
          correlationId: context.correlationId, parentCallId: context.callId ?? context.parentCallId,
        }, () => instance.scope.run(() => handler(params, context)))
        const registration = options.registerRpc(name, packageManifest.id, moduleManifest.id, wrapped, instance.instanceId, structuredClone(record.target))
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
      call: async <T = JsonValue>(method: string, params?: JsonValue, callOptions?: { scope?: 'installation' | 'global' }) => {
        assertScopeActive(instance)
        if (callOptions?.scope !== undefined && callOptions.scope !== 'installation' && callOptions.scope !== 'global') {
          throw new Error('Extension RPC scope must be installation or global')
        }
        if (isKernelNamespace(method)) throw new Error(`Extension cannot call Kernel namespace RPC through ctx.rpc: ${method}`)
        if (isStudioReservedNamespace(method)) throw new Error(`Extension cannot call reserved Studio namespace RPC through ctx.rpc: ${method}`)
        return options.callRpc(method, params, {
          packageId: packageManifest.id,
          moduleId: moduleManifest.id,
          instanceId: instance.instanceId,
          extensionTarget: callOptions?.scope === 'global' ? { kind: 'global' } : structuredClone(record.target),
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
          target: structuredClone(record.target),
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
        const registration = subscribeEvents(patterns, event => instance.scope.run(() => handler(event)))
        instance.scope.track(`event-subscription:${patterns.join(',')}`, registration)
        return registration
      },
    },
    macros: {
      register: provider => {
        assertScopeActive(instance)
        if (moduleManifest.capabilities?.['macros.provide'] !== true) {
          throw new Error(`Extension module is not allowed to provide macros: ${moduleKey(packageManifest.id, moduleManifest.id)}`)
        }
        if (!provider.id.startsWith(`${packageManifest.id}.`)) {
          throw new Error(`Extension macro provider must use package namespace: ${provider.id}`)
        }
        if (!options.registerMacroProvider) throw new Error('Macro providers are not available in this host')
        const handle = options.registerMacroProvider({
          id: installedExtensionContributionId(packageManifest.id, record.target, provider.id),
          name: provider.name,
          resolve: context => {
            if (packageManifest.participation !== 'timeline') return instance.scope.run(() => provider.resolve(context))
            if (!context.timelineTarget) throw new Error('Timeline macro requires an explicit Timeline and Branch target')
            return runTimeline({ scope: 'timeline', ...context.timelineTarget }, async () => provider.resolve(context))
          },
        }, {
          packageId: packageManifest.id,
          moduleId: moduleManifest.id,
          instanceId: instance.instanceId,
          target: structuredClone(record.target),
          ...(packageManifest.participation === 'timeline' ? {
            isAvailable: (context: import('@loom-studio/extension-sdk').ExtensionMacroContext) => isTimelineAvailable(context.timelineTarget?.timelineId),
          } : {}),
        })
        instance.scope.track(`macro-provider:${provider.id}`, handle)
        return handle
      },
    },
    narrativeContext: {
      register: provider => {
        assertScopeActive(instance)
        if (moduleManifest.capabilities?.['narrative.context.provide'] !== true) {
          throw new Error(`Extension module is not allowed to provide Narrative context: ${moduleKey(packageManifest.id, moduleManifest.id)}`)
        }
        if (!provider.id.startsWith(`${packageManifest.id}.`)) {
          throw new Error(`Narrative context provider must use package namespace: ${provider.id}`)
        }
        if (!options.registerNarrativeContextProvider) throw new Error('Narrative context providers are not available in this host')
        const handle = options.registerNarrativeContextProvider({
          id: installedExtensionContributionId(packageManifest.id, record.target, provider.id),
          resolve: context => packageManifest.participation === 'timeline'
            ? runTimeline({ scope: 'timeline', timelineId: context.timelineId, branchId: context.branchId }, () => provider.resolve(context))
            : instance.scope.run(() => provider.resolve(context)),
          ...(provider.onSessionHandoff ? {
            onSessionHandoff: context => packageManifest.participation === 'timeline'
              ? runTimeline({ scope: 'timeline', timelineId: context.timelineId, branchId: context.branchId }, () => provider.onSessionHandoff!(context))
              : instance.scope.run(() => provider.onSessionHandoff!(context)),
          } : {}),
        }, {
          packageId: packageManifest.id, moduleId: moduleManifest.id, instanceId: instance.instanceId,
          target: structuredClone(record.target),
          ...(packageManifest.participation === 'timeline' ? {
            isAvailable: (context: { timelineId: string }) => isTimelineAvailable(context.timelineId),
          } : {}),
        })
        instance.scope.track(`narrative-context:${provider.id}`, handle)
        return handle
      },
    },
    state: {
      registerContentHandler: handler => {
        assertScopeActive(instance)
        for (const capability of ['state.processContent', 'state.read', 'state.write'] as const) {
          if (moduleManifest.capabilities?.[capability] !== true)
            throw new Error(`State content handler requires ${capability}`)
        }
        if (!handler.id.startsWith(`${packageManifest.id}/`) || !handler.contributionId.startsWith(`${packageManifest.id}.`))
          throw new Error('State content handler must use its package namespace')
        if (!options.registerStateContentHandler) throw new Error('State content handlers are unavailable')
        const handle = options.registerStateContentHandler({
          ...handler,
          process: input => {
            if (packageManifest.participation !== 'timeline') return instance.scope.run(() => handler.process({
              ...input, signal: AbortSignal.any([input.signal, instance.scope.signal]),
            }))
            if (!input.target) throw new Error('State content requires an explicit Timeline and Branch target')
            return runTimeline(input.target, ({ signal }) => handler.process({ ...input, signal }), input.signal)
          },
        }, {
          packageId: packageManifest.id, target: structuredClone(record.target),
          ...(packageManifest.participation === 'timeline' ? {
            isAvailable: (target: ExtensionTimelineTarget | undefined) => isTimelineAvailable(target?.timelineId),
          } : {}),
        })
        instance.scope.track(`state-content:${handler.id}`, handle)
        return handle
      },
      contribute: (contribution, initialization) => {
        assertScopeActive(instance)
        if (moduleManifest.capabilities?.['state.contribute'] !== true) {
          throw new Error(`Extension module is not allowed to contribute State: ${moduleKey(packageManifest.id, moduleManifest.id)}`)
        }
        if (!contribution.id.startsWith(`${packageManifest.id}.`)) {
          throw new Error(`Extension State contribution must use package namespace: ${contribution.id}`)
        }
        if (!options.registerStateContribution) throw new Error('State contributions are not available in this host')
        const handle = options.registerStateContribution(contribution, {
          packageId: packageManifest.id,
          moduleId: moduleManifest.id,
          instanceId: instance.instanceId,
          packageVersion: packageManifest.version,
          target: structuredClone(record.target),
        }, initialization?.initialize ? context => instance.scope.run(() => {
          const signal = AbortSignal.any([context.signal, instance.scope.signal])
          return initializationWork.run(signal, () => initialization.initialize!({ ...context, signal }))
        }) : undefined)
        instance.scope.track(`state-contribution:${contribution.id}`, handle)
        return handle
      },
      read: target => {
        assertScopeActive(instance)
        if (moduleManifest.capabilities?.['state.read'] !== true) {
          throw new Error(`Extension module is not allowed to read State: ${moduleKey(packageManifest.id, moduleManifest.id)}`)
        }
        if (!options.readState) throw new Error('State reads are not available in this host')
        const requestedTarget = structuredClone(target)
        return instance.scope.run(async () => {
          if (!await canAccessState(requestedTarget)) throw new Error('State target is outside the extension Card installation')
          return options.readState!(requestedTarget, {
            packageId: packageManifest.id,
            moduleId: moduleManifest.id,
            instanceId: instance.instanceId,
            ...(timelineWork.getStore() ? { lease: timelineWork.getStore()!.lease } : {}),
          })
        })
      },
      write: input => {
        assertScopeActive(instance)
        if (moduleManifest.capabilities?.['state.write'] !== true) {
          throw new Error(`Extension module is not allowed to write State: ${moduleKey(packageManifest.id, moduleManifest.id)}`)
        }
        if (!options.writeState) throw new Error('State writes are not available in this host')
        const request = structuredClone(input)
        return instance.scope.run(async () => {
          if (!await canAccessState(request.target)) throw new Error('State target is outside the extension Card installation')
          return options.writeState!(request, {
            packageId: packageManifest.id,
            moduleId: moduleManifest.id,
            instanceId: instance.instanceId,
            ...(timelineWork.getStore() ? { lease: timelineWork.getStore()!.lease } : {}),
          })
        })
      },
      subscribe: (input, handler) => {
        assertScopeActive(instance)
        if (!instance.grantedEventCapabilities.includes('state')) throw new Error(`Extension module is not allowed to subscribe to State changes: ${moduleKey(packageManifest.id, moduleManifest.id)}`)
        if (!options.subscribeEvents) throw new Error('Extension event subscriptions are not available in this host')
        if (input?.signal?.aborted) return { dispose() {} }
        const target = input?.target
        const paths = input?.paths
        const registration = subscribeEvents(['state.changed'], event => {
          const payload = event.payload as Partial<import('@loom-studio/extension-sdk').ExtensionStateChangeEvent>
          if (!payload || !payload.target || typeof payload.revisionId !== 'string') return
          if (target && (target.scope !== payload.target.scope
            || (target.scope === 'timeline' && payload.target.scope === 'timeline'
              && (target.timelineId !== payload.target.timelineId || target.branchId !== payload.target.branchId)))) return
          if (paths?.length && !(payload.paths ?? []).some(path => paths.some(prefix =>
            path === '' || prefix === '' || path === prefix || path.startsWith(`${prefix}/`) || prefix.startsWith(`${path}/`)))) return
          return handler(payload as import('@loom-studio/extension-sdk').ExtensionStateChangeEvent)
        })
        const onAbort = () => { void handle.dispose() }
        const handle = {
          dispose: () => {
            input?.signal?.removeEventListener('abort', onAbort)
            return registration.dispose()
          },
        }
        instance.scope.track('state-subscription', handle)
        input?.signal?.addEventListener('abort', onAbort, { once: true })
        return handle
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
      invoke: async input => {
        assertScopeActive(instance)
        if (moduleManifest.capabilities?.['ai.invoke'] !== true) {
          throw new Error(`Extension module is not allowed to invoke AI capabilities: ${moduleKey(packageManifest.id, moduleManifest.id)}`)
        }
        if (!options.aiGateway) throw new Error('AI Gateway invocation is not available in this host')
        const workSignal = await executionSignal()
        const signal = input.signal ? AbortSignal.any([input.signal, workSignal]) : workSignal
        signal.throwIfAborted()
        const result = await options.aiGateway.invoke({
          ...input,
          signal,
          caller: { kind: 'extension', id: packageManifest.id },
        })
        signal.throwIfAborted()
        await executionSignal()
        return result
      },
      invokeModel: async input => {
        assertScopeActive(instance)
        if (moduleManifest.capabilities?.['ai.invoke'] !== true)
          throw new Error(`Extension module is not allowed to invoke AI capabilities: ${moduleKey(packageManifest.id, moduleManifest.id)}`)
        if (!options.invokeModel) throw new Error('AI model invocation is not available in this host')
        const workSignal = await executionSignal()
        const signal = input.signal ? AbortSignal.any([input.signal, workSignal]) : workSignal
        signal.throwIfAborted()
        return instance.scope.run(async () => {
          const result = await options.invokeModel!({ ...input, signal }, {
            packageId: packageManifest.id, installationId: extensionInstallationId(packageManifest.id, record.target), ...observationOwner(), moduleId: moduleManifest.id,
            timelineId: timelineWork.getStore()?.lease.timelineId,
          })
          signal.throwIfAborted()
          await executionSignal()
          return result
        })
      },
    },
    prompt: {
      registerProcessor: processor => {
        assertScopeActive(instance)
        if (moduleManifest.capabilities?.['prompt.process'] !== true)
          throw new Error(`Extension module is not allowed to process prompts: ${moduleKey(packageManifest.id, moduleManifest.id)}`)
        if (!processor.id.startsWith(`${packageManifest.id}/`))
          throw new Error(`Prompt processor must use package namespace: ${processor.id}`)
        if (!options.registerPromptProcessor) throw new Error('Prompt processors are not available in this host')
        const handle = options.registerPromptProcessor({
          id: processor.id,
          create: context => instance.scope.run(async () => {
            const { timeline, ...baseContext } = context
            const requestedSignal = AbortSignal.any([context.signal, instance.scope.signal])
            const target = timeline ? Object.freeze({
              scope: 'timeline' as const, timelineId: timeline.timelineId, branchId: timeline.branchId,
            }) : undefined
            if (packageManifest.participation === 'timeline' && (!target || !options.beginTimelineWork || !options.assertTimelineWork)) {
              throw new Error('Timeline Prompt processor requires a target and managed execution')
            }
            const work = packageManifest.participation === 'timeline' ? await options.beginTimelineWork!({
              timelineId: target!.timelineId,
              installationId: extensionInstallationId(packageManifest.id, record.target),
              packageVersion: packageManifest.version, signal: requestedSignal,
            }) : undefined
            const signal = work?.signal ?? requestedSignal
            const execution = work ? { target: target!, lease: work.lease, signal } : undefined
            const run = async <T>(callback: () => T | Promise<T>): Promise<T> => instance.scope.run(async () => {
              signal.throwIfAborted()
              if (work) await options.assertTimelineWork!(work.lease)
              const value = await (execution ? work!.run(() => timelineWork.run(execution, callback)) : callback())
              signal.throwIfAborted()
              if (work) await options.assertTimelineWork!(work.lease)
              return value
            })
            let session: import('@loom-studio/extension-sdk').ExtensionPromptProcessingSession | undefined
            let disposing: Promise<void> | undefined
            const dispose = () => disposing ??= (async () => {
              work?.dispose()
              await session?.dispose?.()
            })()
            try {
              await run(async () => {
                session = await processor.create({
                  ...baseContext, signal,
                  ...(moduleManifest.capabilities?.['state.read'] === true && timeline ? { timeline } : {}),
                })
              })
              return {
                ...(session!.prepare ? { prepare: (entries: readonly import('@loom-studio/extension-sdk').ExtensionPromptEntry[]) => run(() => session!.prepare!(entries)) } : {}),
                render: (entry: import('@loom-studio/extension-sdk').ExtensionPromptEntry) => run(() => session!.render(entry)),
                dispose,
              }
            } catch (error) {
              try { await dispose() } catch (cleanupError) {
                throw new AggregateError([error, cleanupError], 'Prompt processor creation and cleanup failed')
              }
              throw error
            }
          }),
        }, {
          packageId: packageManifest.id,
          moduleId: moduleManifest.id,
          instanceId: instance.instanceId,
          target: structuredClone(record.target),
        })
        instance.scope.track(`prompt-processor:${processor.id}`, handle)
        return handle
      },
      build: async input => {
        assertScopeActive(instance)
        if (!options.buildPrompt) throw new Error('Prompt build is not available in this host')
        const workSignal = await executionSignal()
        return instance.scope.run(() => options.buildPrompt!({
          ...input,
          signal: input.signal ? AbortSignal.any([input.signal, workSignal]) : workSignal,
        }, record.target, packageManifest.id, timelineWork.getStore()?.lease, observationOwner()))
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
          installedExtensionContributionId(packageManifest.id, record.target, toolId),
          packageManifest.id,
          moduleManifest.id,
          instance.instanceId,
          (input, context) => {
            if (packageManifest.participation === 'timeline') {
              if (!context.narrativeTarget) throw new Error('Timeline extension tool requires a Narrative target')
              return runTimeline(context.narrativeTarget, execution => Promise.resolve(handler(input, {
                ...context, signal: AbortSignal.any([context.signal, execution.signal]),
              })), context.signal)
            }
            return instance.scope.run(() => handler(input, {
              ...context,
              signal: AbortSignal.any([context.signal, instance.scope.signal]),
            }))
          },
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
          ownerInstallationId: storageInstallationId(record) ?? null,
        })).items
      },
      write: async (input: ExtensionDocumentWriteInput): Promise<WriteDocumentResult> => {
        assertScopeActive(instance)
        const write = {
          ...input,
          meta: {
            ...input.meta,
            ownerExtensionId: packageManifest.id,
            ownerInstallationId: storageInstallationId(record),
          },
          actor: extensionActor,
        }
        assertDeclaredDocumentType(record, write.type)
        const result = await options.documents.transact({ actor: extensionActor, reason: write.reason }, async tx => {
          const existing = write.id !== undefined ? await tx.get(write.id, { includeTombstone: true }) : null
          if (existing && (existing.meta.ownerExtensionId !== packageManifest.id || existing.type !== write.type)) {
            throw new DocumentStoreError('document.conflict', `Document ownership or type conflict: ${write.id}`)
          }
          if (existing) assertDocumentAccess(record, existing, 'write')
          return tx.write({
            ...write,
            expectedVersion: write.expectedVersion ?? (existing ? undefined : 'new'),
          })
        })
        return result.value
      },
      delete: async (id, deleteOptions) => {
        assertScopeActive(instance)
        const { expectedVersion, reason } = deleteOptions ?? {}
        const result = await options.documents.transact({ actor: extensionActor, reason }, async tx => {
          const existing = await tx.get(id, { includeTombstone: true })
          if (!existing) throw new Error(`Extension document not found: ${id}`)
          assertDocumentAccess(record, existing, 'delete')
          return tx.delete({
            id,
            expectedVersion: expectedVersion ?? existing.version,
            reason,
            actor: extensionActor,
          })
        })
        return result.value
      },
    },
    portablePayloads: {
      publish: async input => {
        input = structuredClone(input)
        assertScopeActive(instance)
        const portablePayloads = requirePortablePayloads(options)
        return await portablePayloads.create({
          ownerInstallationId: storageInstallationId(record),
          packageId: packageManifest.id,
          artifactPayloadId: input.artifactPayloadId,
          payload: input.payload,
        })
      },
      listOwn: async () => {
        assertScopeActive(instance)
        return await requirePortablePayloads(options).list(packageManifest.id, storageInstallationId(record))
      },
      readOwn: async payloadId => {
        assertScopeActive(instance)
        const payload = await requirePortablePayloads(options).get(payloadId)
        assertPortablePayloadOwner(packageManifest.id, payload, storageInstallationId(record))
        return payload
      },
      updateOwn: async input => {
        input = structuredClone(input)
        assertScopeActive(instance)
        const portablePayloads = requirePortablePayloads(options)
        assertPortablePayloadOwner(packageManifest.id, await portablePayloads.get(input.payloadId), storageInstallationId(record))
        return await portablePayloads.update({
          packageId: packageManifest.id,
          payloadId: input.payloadId,
          expectedVersion: input.expectedVersion,
          payload: input.payload,
        })
      },
      deleteOwn: async input => {
        input = structuredClone(input)
        assertScopeActive(instance)
        const portablePayloads = requirePortablePayloads(options)
        assertPortablePayloadOwner(packageManifest.id, await portablePayloads.get(input.payloadId), storageInstallationId(record))
        await portablePayloads.delete({
          packageId: packageManifest.id,
          payloadId: input.payloadId,
          expectedVersion: input.expectedVersion,
        })
      },
      replaceOwnCardBindings: async input => {
        input = structuredClone(input)
        assertScopeActive(instance)
        if (record.target.kind === 'card' && input.cardId !== record.target.cardId) throw new Error('Portable Payload bindings are outside this Card installation scope')
        const portablePayloads = requirePortablePayloads(options)
        for (const payloadId of input.payloadIds) {
          assertPortablePayloadOwner(packageManifest.id, await portablePayloads.get(payloadId), storageInstallationId(record))
        }
        return await portablePayloads.replaceCardBindings({
          ownerInstallationId: storageInstallationId(record),
          packageId: packageManifest.id,
          cardId: input.cardId,
          expectedVersion: input.expectedVersion,
          payloadIds: input.payloadIds,
        })
      },
    },
    storage: createExtensionStorageContext(record, instance, {
      ...options,
      validateStorageScope: async (scope, target) => {
        const storyScope = scope.kind === 'timeline' || scope.kind === 'agent-session'
        if (packageManifest.participation === 'timeline' && storyScope) {
          await executionSignal()
          const execution = timelineWork.getStore()
          if (!execution) throw new Error('Story storage requires ctx.timeline.run')
          if (scope.kind === 'timeline' && scope.timelineId !== execution.target.timelineId) {
            throw new Error('Storage scope is outside the current Timeline')
          }
          if (!options.validateStorageScope) throw new Error('Extension Storage Scope validation is not available in this host')
          return options.validateStorageScope(scope, target, execution.target)
        }
        if (scope.kind !== 'global' && !options.validateStorageScope) throw new Error('Extension Storage Scope validation is not available in this host')
        await options.validateStorageScope?.(scope, target)
      },
      validateEntityRef: async (ref, target) => {
        if (!options.validateEntityRef) throw new Error('Extension Entity Ref validation is not available in this host')
        if (packageManifest.participation === 'timeline' && ref.kind !== 'asset') {
          await executionSignal()
          const execution = timelineWork.getStore()
          if (!execution) throw new Error('Story references require ctx.timeline.run')
          if (ref.kind !== 'agent-message' && ref.timelineId !== execution.target.timelineId) {
            throw new Error('Entity reference is outside the current Timeline')
          }
          return options.validateEntityRef(ref, target, execution.target)
        }
        await options.validateEntityRef(ref, target)
      },
    }, extensionActor),
    assets: {
      publish: async input => {
        assertScopeActive(instance)
        assertAssetCapability(instance, 'assets.publish')
        if (!options.assets) throw new Error('Extension Media Assets are not available in this host')
        return await options.assets.publish({
          ...input,
          bytes: new Uint8Array(input.bytes),
          ownerPackageId: packageManifest.id,
          ownerInstallationId: record.target.kind === 'card' ? extensionInstallationId(packageManifest.id, record.target) : undefined,
          actor: { kind: 'extension', id: packageManifest.id },
        })
      },
      read: async (assetId, readOptions) => {
        assertScopeActive(instance)
        if (!options.assets) throw new Error('Extension Media Assets are not available in this host')
        const asset = await options.assets.get(assetId)
        if (!asset) throw new Error(`Media Asset not found: ${assetId}`)
        await assertAssetAccess(asset)
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
        await assertAssetAccess(asset)
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

function createExtensionLogger(
  packageId: string,
  moduleId: string,
  instanceId: string,
  logger: ExtensionHostLogger | undefined,
  installationId?: string,
): ExtensionActivationContext['logger'] {
  return createExtensionLogWriter(logger, { packageId, moduleId, instanceId, runtime: 'server', ...(installationId ? { installationId } : {}) })
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
    installationId: extensionInstallationId(record.packageManifest.id, record.target),
    target: structuredClone(record.target),
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

function isKernelNamespace(name: string): boolean {
  return kernelNamespaces.includes(name.split('.')[0] ?? '')
}

function isStudioReservedNamespace(name: string): boolean {
  return studioReservedNamespaces.includes(name.split('.')[0] ?? '')
}
