import { createExtensionLogWriter, readLogFailure, type ExtensionHostLogWriter, type ExtensionLogQuery, type ExtensionLogPage } from '@loom-studio/logging'
import { countText } from '../../../shared/tokenizer/client.js'
import type {
  ClientActionSurface,
  ClientCommandHandler,
  ClientCommandInvocationContext,
  ClientHistorySource,
  ClientNotification,
  ClientExtensionActivationContext,
  ClientExtensionLogger,
  ClientExtensionModule,
  ClientRenderer,
  ClientRendererScope,
  ClientStateSnapshot,
  ClientStateTarget,
  ExtensionEntityRef,
  ExtensionConfigEntry,
  ExtensionRecordEntry,
  ExtensionRegistrationHandle,
  ExtensionStorageScope,
  ExtensionInstallationTarget,
  JsonValue,
  RendererContributionDefinition,
  RegisteredClientBackground,
} from '@loom-studio/extension-sdk'
import type { ManagedClientExtensionModule, ManagedClientExtensionPackage } from '../../../entities/index.js'
import { extensionInstallationId } from '@loom-studio/extension-sdk'
import type { ClientRendererHost } from '../../../shared/extension-renderer-runtime/client-renderer-host.js'
import type { RendererSessionHost } from './renderer-session.js'
import { rendererContributionKey } from '../../../shared/extension-renderer-runtime/renderer-registry.js'
import { clientCommandKey, clientModuleKey as moduleKey, matchesClientActionCondition } from './client-actions.js'
import { readClientNotification } from '../../../shared/extension-renderer-runtime/renderer-notifications.js'

export type { ManagedClientExtensionPackage } from '../../../entities/index.js'

type ClientExtensionDiagnostic = {
  target?: ExtensionInstallationTarget
  code:
    | 'client-extension.activation_failed'
    | 'client-extension.disposal_failed'
    | 'client-extension.renderer_not_registered'
    | 'client-extension.command_not_registered'
    | 'client-extension.command_execution_failed'
  message: string
  packageId: string
  moduleId: string
  commandId?: string
}

type ClientExtensionModuleSummary = {
  target?: ExtensionInstallationTarget
  packageId: string
  moduleId: string
  instanceId?: string
  state: 'inactive' | 'activating' | 'active' | 'degraded'
  error?: string
}

export type ClientExtensionHost = {
  reconcile(packages: readonly ManagedClientExtensionPackage[], options?: { reload?: readonly string[] }): Promise<void>
  executeCommand(input: {
    target?: ExtensionInstallationTarget
    packageId: string
    moduleId: string
    commandId: string
    sourceSurface: ClientActionSurface
  }): Promise<ClientCommandExecutionResult>
  dispose(): Promise<void>
  commandRegistrations(): ClientCommandRegistrationSummary[]
  backgrounds(): RegisteredClientBackground[]
  summaries(): ClientExtensionModuleSummary[]
  diagnostics(): readonly ClientExtensionDiagnostic[]
  subscribe(listener: () => void): () => void
  revision(): number
  notifyConfigsChanged(): Promise<void>
}

type ClientCommandExecutionResult =
  | { status: 'completed' }
  | { status: 'failed'; code: 'command.not_found' | 'command.placement_not_found' | 'command.disabled' | 'command.activation_failed' | 'command.handler_missing' | 'command.execution_failed'; message: string }

type ClientCommandRegistrationSummary = {
  target?: ExtensionInstallationTarget
  commandKey: string
  packageId: string
  moduleId: string
  commandId: string
  instanceId: string
}

export type ClientExtensionDataApi = {
  configs: {
    list(packageId: string, input?: { scope?: ExtensionStorageScope }, target?: ExtensionInstallationTarget): Promise<ExtensionConfigEntry[]>
    get(packageId: string, input: { scope: ExtensionStorageScope; key: string }, target?: ExtensionInstallationTarget): Promise<ExtensionConfigEntry | null>
    upsert(packageId: string, input: { scope: ExtensionStorageScope; key: string; value: JsonValue; expectedVersion?: number }, target?: ExtensionInstallationTarget): Promise<ExtensionConfigEntry>
  }
  records: {
    list(packageId: string, input?: { scope?: ExtensionStorageScope; recordType?: string; binding?: ExtensionEntityRef }, target?: ExtensionInstallationTarget): Promise<ExtensionRecordEntry[]>
    get(packageId: string, recordId: string, target?: ExtensionInstallationTarget): Promise<ExtensionRecordEntry | null>
  }
  state: {
    get(target: ClientStateTarget, extensionTarget?: ExtensionInstallationTarget): Promise<ClientStateSnapshot>
  }
  history: {
    project(input: { source: ClientHistorySource; phase: 'classify' | 'prompt' | 'display' }, extensionTarget?: ExtensionInstallationTarget): Promise<JsonValue>
    extract(input: { source: ClientHistorySource; phase?: 'classify' | 'prompt' | 'display'; extractorId: string }, extensionTarget?: ExtensionInstallationTarget): Promise<JsonValue>
  }
  rpc: {
    call(method: string, params?: JsonValue, owner?: { packageId: string; target: ExtensionInstallationTarget }): Promise<JsonValue>
  }
  assets: {
    url(assetId: string, owner?: { packageId: string; moduleId: string; target: ExtensionInstallationTarget }): string
  }
}

type ActiveClientModule = {
  key: string
  entryUrl: string
  packageVersion: string
  reloadId?: string
  permissions: string
  abortController: AbortController
  handles: ExtensionRegistrationHandle[]
  registeredCommandIds: Set<string>
  registeredRendererIds: Set<string>
  summary: ClientExtensionModuleSummary
}

type LoadedClientModule = Partial<ClientExtensionModule> & { default?: ClientExtensionModule }

type ClientExtensionAppearance = {
  setBackground(background: { id: string; image: string } | null): void
  scoped?: {
    set(background: { id: string; image: string; cardId: string; ownerKey: string }): void
    clear(ownerKey: string, backgroundId?: string): void
  }
}

type ClientConfigSubscription = {
  target?: ExtensionInstallationTarget
  packageId: string
  input: { scope?: ExtensionStorageScope }
  handler(entries: ExtensionConfigEntry[]): void | Promise<void>
  signature?: string
}

export function createClientExtensionHost(options: {
  rendererHost: ClientRendererHost
  data?: ClientExtensionDataApi
  sessionHost?: RendererSessionHost
  loadModule?: (entryUrl: string, instanceId: string) => Promise<LoadedClientModule>
  logger?: ExtensionHostLogWriter
  queryLogs?(packageId: string, input: ExtensionLogQuery, installationId?: string): Promise<ExtensionLogPage>
  appearance?: ClientExtensionAppearance
  notify?(owner: string, input: ClientNotification): void
}): ClientExtensionHost {
  const active = new Map<string, ActiveClientModule>()
  const catalog = new Map<string, { extensionPackage: ManagedClientExtensionPackage; module: ManagedClientExtensionModule }>()
  const commandHandlers = new Map<string, { handler: ClientCommandHandler; summary: ClientCommandRegistrationSummary }>()
  const summaries = new Map<string, ClientExtensionModuleSummary>()
  const diagnostics: ClientExtensionDiagnostic[] = []
  const backgrounds = new Map<string, RegisteredClientBackground>()
  const configSubscriptions = new Map<number, ClientConfigSubscription>()
  const listeners = new Set<() => void>()
  const loadModule = options.loadModule ?? importClientModule
  const logger = options.logger ?? consoleClientExtensionLogger
  const data = options.data ?? unavailableClientExtensionDataApi
  const appearance = options.appearance
  let currentRevision = 0
  let nextConfigSubscriptionId = 1
  let queue = Promise.resolve()

  function emit(): void {
    currentRevision += 1
    for (const listener of listeners) listener()
  }

  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = queue.then(operation, operation)
    queue = result.then(() => undefined, () => undefined)
    return result
  }

  function registerConfigSubscription(
    packageId: string,
    input: { scope?: ExtensionStorageScope },
    handler: ClientConfigSubscription['handler'],
    target?: ExtensionInstallationTarget,
  ): number {
    const id = nextConfigSubscriptionId
    nextConfigSubscriptionId += 1
    configSubscriptions.set(id, {
      packageId,
      target: target ? structuredClone(target) : undefined,
      input: structuredClone(input),
      handler,
    })
    return id
  }

  function disposeConfigSubscription(id: number): void {
    configSubscriptions.delete(id)
  }

  async function refreshConfigSubscriptions(): Promise<void> {
    await Promise.all([...configSubscriptions.entries()].map(async ([id, subscription]) => {
      try {
        const entries = await data.configs.list(subscription.packageId, subscription.input, subscription.target)
        if (!configSubscriptions.has(id)) return
        const signature = entries.map(entry => `${entry.id}:${entry.version}`).join('|')
        if (signature === subscription.signature) return
        subscription.signature = signature
        await subscription.handler(entries.map(entry => structuredClone(entry)))
      } catch (error) {
        logger.error('Client Extension Config subscription failed', {
          extension: { packageId: subscription.packageId, runtime: 'client',
            ...(subscription.target?.kind === 'card' ? { installationId: extensionInstallationId(subscription.packageId, subscription.target) } : {}) },
          event: 'extension.config.subscription.failed',
          data: readLogFailure(error),
        })
      }
    }))
  }

  async function stop(record: ActiveClientModule): Promise<void> {
    record.abortController.abort()
    appearance?.scoped?.clear(record.key)
    const errors: unknown[] = []
    for (const handle of record.handles.splice(0).reverse()) {
      try {
        await handle.dispose()
      } catch (error) {
        errors.push(error)
      }
    }
    active.delete(record.key)
    const extension = { packageId: record.summary.packageId, moduleId: record.summary.moduleId, instanceId: record.summary.instanceId, runtime: 'client' as const,
      ...(record.summary.target?.kind === 'card' ? { installationId: extensionInstallationId(record.summary.packageId, record.summary.target) } : {}) }
    const message = errors.length ? errors.map(error => error instanceof Error ? error.message : String(error)).join('; ') : undefined
    summaries.set(record.key, {
      packageId: record.summary.packageId,
      moduleId: record.summary.moduleId,
      target: record.summary.target,
      state: 'inactive',
      ...(message !== undefined ? { error: message } : {}),
    })
    if (message !== undefined) {
      diagnostics.push({
        code: 'client-extension.disposal_failed',
        target: record.summary.target,
        message,
        packageId: record.summary.packageId,
        moduleId: record.summary.moduleId,
      })
      logger.error('Client extension disposal failed', {
        extension,
        event: 'extension.disposal.failed',
        data: readLogFailure(new AggregateError(errors, message)),
      })
    } else {
      logger.info('Client extension disposed', { extension, event: 'extension.disposed' })
    }
  }

  async function activate(extensionPackage: ManagedClientExtensionPackage, module: ManagedClientExtensionModule): Promise<void> {
    const key = moduleKey(extensionPackage.packageId, module.moduleId, extensionPackage.target)
    clearModuleDiagnostics(diagnostics, extensionPackage.packageId, module.moduleId, extensionPackage.target)
    const instanceId = createClientInstanceId(extensionPackage.packageId, module.moduleId)
    const extension = { packageId: extensionPackage.packageId, moduleId: module.moduleId, instanceId, runtime: 'client' as const,
      ...(extensionPackage.target?.kind === 'card' ? { installationId: extensionInstallationId(extensionPackage.packageId, extensionPackage.target) } : {}) }
    logger.info('Client extension activation started', { extension, event: 'extension.activation.started' })
    const record: ActiveClientModule = {
      key,
      entryUrl: module.entryUrl,
      packageVersion: extensionPackage.version,
      reloadId: module.reloadId,
      permissions: permissionFingerprint(module),
      abortController: new AbortController(),
      handles: [],
      registeredCommandIds: new Set(),
      registeredRendererIds: new Set(),
      summary: { packageId: extensionPackage.packageId, moduleId: module.moduleId, target: extensionPackage.target, instanceId, state: 'activating' },
    }
    active.set(key, record)
    summaries.set(key, record.summary)
    emit()

    try {
      if (extensionPackage.target?.kind === 'card' && extensionPackage.target.cardId !== options.rendererHost.scopeSnapshot().cardId) throw new Error('Client module Card is not active')
      const loaded = await loadModule(module.entryUrl, instanceId)
      if (extensionPackage.target?.kind === 'card' && extensionPackage.target.cardId !== options.rendererHost.scopeSnapshot().cardId) throw new Error('Client module Card changed while loading')
      const extensionModule = loaded.activate ? loaded as ClientExtensionModule : loaded.default
      if (!extensionModule?.activate) throw new Error('Client extension must export activate(ctx)')
      const context = createActivationContext({
        extensionPackage,
        module,
        record,
        rendererHost: options.rendererHost,
        sessionHost: options.sessionHost,
        data,
        logger: createExtensionLogWriter(logger, extension),
        queryLogs: options.queryLogs,
        registerCommand,
        registerConfigSubscription,
        disposeConfigSubscription,
        backgrounds,
        appearance,
        notify: options.notify,
        emit,
      })
      const returnedHandle = await extensionModule.activate(context)
      if (returnedHandle) record.handles.push(returnedHandle)
      for (const declared of module.contributions.renderers ?? []) {
        if (record.registeredRendererIds.has(declared.id)) continue
        diagnostics.push({
          code: 'client-extension.renderer_not_registered',
          target: extensionPackage.target,
          message: `Renderer ${declared.id} is declared but was not registered during activation`,
          packageId: extensionPackage.packageId,
          moduleId: module.moduleId,
        })
      }
      for (const declared of module.contributions.commands ?? []) {
        if (record.registeredCommandIds.has(declared.id)) continue
        diagnostics.push({
          code: 'client-extension.command_not_registered',
          target: extensionPackage.target,
          message: `Client Command ${declared.id} is declared but its Handler was not registered during activation`,
          packageId: extensionPackage.packageId,
          moduleId: module.moduleId,
          commandId: declared.id,
        })
      }
      record.summary = {
        target: extensionPackage.target,
        packageId: extensionPackage.packageId,
        moduleId: module.moduleId,
        instanceId,
        state: diagnostics.some(diagnostic => moduleKey(diagnostic.packageId, diagnostic.moduleId, diagnostic.target) === key)
          ? 'degraded'
          : 'active',
      }
      summaries.set(key, record.summary)
      logger.info('Client extension activation completed', { extension, event: 'extension.activation.completed', data: { outcome: record.summary.state } })
    } catch (error) {
      logger.error('Client extension activation failed', { extension, event: 'extension.activation.failed', data: readLogFailure(error) })
      const message = error instanceof Error ? error.message : String(error)
      diagnostics.push({
        code: 'client-extension.activation_failed',
        target: extensionPackage.target,
        message,
        packageId: extensionPackage.packageId,
        moduleId: module.moduleId,
      })
      await stop(record)
      summaries.set(key, { packageId: extensionPackage.packageId, moduleId: module.moduleId, target: extensionPackage.target, state: 'degraded', error: message })
    }
    emit()
  }

  function registerCommand(
    extensionPackage: ManagedClientExtensionPackage,
    module: ManagedClientExtensionModule,
    record: ActiveClientModule,
    commandId: string,
    handler: ClientCommandHandler,
  ): ExtensionRegistrationHandle {
    const declared = module.contributions.commands?.find(command => command.id === commandId)
    if (!declared) throw new Error(`Client Command ${commandId} is not declared in manifest contributes.commands`)
    const key = clientCommandKey(extensionPackage.packageId, module.moduleId, commandId, extensionPackage.target)
    if (commandHandlers.has(key)) throw new Error(`Client Command Handler is already registered: ${key}`)
    commandHandlers.set(key, {
      handler,
      summary: {
        commandKey: key, packageId: extensionPackage.packageId, moduleId: module.moduleId, commandId,
        instanceId: record.summary.instanceId!,
        ...(extensionPackage.target?.kind === 'card' ? { target: structuredClone(extensionPackage.target) } : {}),
      },
    })
    record.registeredCommandIds.add(commandId)
    emit()
    let disposed = false
    const handle = {
      dispose: () => {
        if (disposed) return
        disposed = true
        const current = commandHandlers.get(key)
        if (current?.summary.instanceId === record.summary.instanceId) commandHandlers.delete(key)
        emit()
      },
    }
    record.handles.push(handle)
    return handle
  }

  return {
    reconcile: (packages, reconcileOptions) => serialize(async () => {
      const reload = new Set(reconcileOptions?.reload ?? [])
      const desired = new Map<string, { extensionPackage: ManagedClientExtensionPackage; module: ManagedClientExtensionModule }>()
      catalog.clear()
      for (const extensionPackage of packages) {
        if (extensionPackage.target?.kind === 'card' && extensionPackage.target.cardId !== options.rendererHost.scopeSnapshot().cardId) continue
        for (const module of extensionPackage.modules) {
          if (module.runtimeKind !== 'client' || !module.entryUrl) continue
          const key = moduleKey(extensionPackage.packageId, module.moduleId, extensionPackage.target)
          catalog.set(key, { extensionPackage, module })
          if (!summaries.has(key)) summaries.set(key, { packageId: extensionPackage.packageId, moduleId: module.moduleId, target: extensionPackage.target, state: 'inactive' })
          if (!module.desired.enabled) continue
          if ((module.contributions.renderers?.length ?? 0) > 0 || (module.contributions.commands?.length ?? 0) === 0 || active.has(key)) {
            desired.set(key, { extensionPackage, module })
          }
        }
      }

      for (const [key, record] of active) {
        const next = desired.get(key)
        if (!next || reload.has(key) || next.module.entryUrl !== record.entryUrl || next.extensionPackage.version !== record.packageVersion
          || next.module.reloadId !== record.reloadId
          || permissionFingerprint(next.module) !== record.permissions) {
          await stop(record)
        }
      }
      for (const [key, next] of desired) {
        if (!active.has(key)) await activate(next.extensionPackage, next.module)
      }
      for (const key of summaries.keys()) {
        if (!catalog.has(key) && !active.has(key)) summaries.delete(key)
      }
      emit()
    }),
    executeCommand: async input => {
      input = structuredClone(input)
      const scopes = options.rendererHost.scopeSnapshot()
      const context: ClientCommandInvocationContext = {
        sourceSurface: input.sourceSurface,
        workspaceId: scopes.workspace,
        ...(scopes.cardId ? { cardId: scopes.cardId } : {}),
        ...(scopes.timelineId ? { timelineId: scopes.timelineId } : {}),
        ...(scopes.agentSessionId ? { agentSessionId: scopes.agentSessionId } : {}),
      }
      const resolved = await serialize(async () => {
        if (input.target?.kind === 'card' && options.rendererHost.scopeSnapshot().cardId !== input.target.cardId) {
          return commandFailure('command.disabled', 'Client Command belongs to a different Card')
        }
        const key = moduleKey(input.packageId, input.moduleId, input.target)
        const catalogEntry = catalog.get(key)
        const command = catalogEntry?.module.contributions.commands?.find(candidate => candidate.id === input.commandId)
        if (!catalogEntry || !command) {
          return commandFailure('command.not_found', `Client Command is not declared: ${clientCommandKey(input.packageId, input.moduleId, input.commandId)}`)
        }
        const placement = catalogEntry.module.contributions.actions?.find(action => action.commandId === input.commandId
          && action.surface === input.sourceSurface
          && matchesClientActionCondition(action, context))
        if (!placement) {
          return commandFailure('command.placement_not_found', `Client Command has no active Action Placement on ${input.sourceSurface}: ${input.commandId}`)
        }
        if (!catalogEntry.module.desired.enabled) {
          return commandFailure('command.disabled', `Client Command module is disabled: ${key}`)
        }
        if (!active.has(key)) await activate(catalogEntry.extensionPackage, catalogEntry.module)
        const record = active.get(key)
        if (!record) {
          return commandFailure('command.activation_failed', summaries.get(key)?.error ?? `Client Command module could not be activated: ${key}`)
        }
        const registration = commandHandlers.get(clientCommandKey(input.packageId, input.moduleId, input.commandId, input.target))
        if (!registration) {
          return commandFailure('command.handler_missing', `Client Command Handler is not registered: ${input.commandId}`)
        }
        return { registration, signal: record.abortController.signal }
      })
      if ('status' in resolved) return resolved
      if (resolved.signal.aborted) return commandFailure('command.activation_failed', `Client Command module was unloaded before execution: ${input.moduleId}`)
      if (input.target?.kind === 'card' && options.rendererHost.scopeSnapshot().cardId !== input.target.cardId) {
        return commandFailure('command.disabled', 'Client Command Card changed before execution')
      }
      try {
        await resolved.registration.handler(structuredClone(context))
        return { status: 'completed' }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const diagnostic: ClientExtensionDiagnostic = {
          code: 'client-extension.command_execution_failed',
          message,
          packageId: input.packageId,
          moduleId: input.moduleId,
          commandId: input.commandId,
          ...(input.target?.kind === 'card' ? { target: structuredClone(input.target) } : {}),
        }
        if (!diagnostics.some(current => current.code === diagnostic.code
          && current.packageId === diagnostic.packageId
          && current.moduleId === diagnostic.moduleId
          && moduleKey(current.packageId, current.moduleId, current.target) === moduleKey(diagnostic.packageId, diagnostic.moduleId, diagnostic.target)
          && current.commandId === diagnostic.commandId
          && current.message === diagnostic.message)) diagnostics.push(diagnostic)
        emit()
        return commandFailure('command.execution_failed', message)
      }
    },
    dispose: () => serialize(async () => {
      for (const record of [...active.values()].reverse()) await stop(record)
      catalog.clear()
      emit()
    }),
    commandRegistrations: () => [...commandHandlers.values()].map(registration => structuredClone(registration.summary))
      .sort((left, right) => left.commandKey.localeCompare(right.commandKey)),
    backgrounds: () => [...backgrounds.values()]
      .filter(value => value.target?.kind !== 'card' || value.target.cardId === options.rendererHost.scopeSnapshot().cardId)
      .map(value => structuredClone(value)),
    summaries: () => [...summaries.values()].sort((left, right) => moduleKey(left.packageId, left.moduleId, left.target).localeCompare(moduleKey(right.packageId, right.moduleId, right.target))),
    diagnostics: () => diagnostics,
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    revision: () => currentRevision,
    notifyConfigsChanged: refreshConfigSubscriptions,
  }
}

function clearModuleDiagnostics(
  diagnostics: ClientExtensionDiagnostic[],
  packageId: string,
  moduleId: string,
  target?: ExtensionInstallationTarget,
): void {
  for (let index = diagnostics.length - 1; index >= 0; index -= 1) {
    const diagnostic = diagnostics[index]
    if (diagnostic && moduleKey(diagnostic.packageId, diagnostic.moduleId, diagnostic.target) === moduleKey(packageId, moduleId, target)) diagnostics.splice(index, 1)
  }
}

function createActivationContext(input: {
  extensionPackage: ManagedClientExtensionPackage
  module: ManagedClientExtensionModule
  record: ActiveClientModule
  rendererHost: ClientRendererHost
  data: ClientExtensionDataApi
  sessionHost?: RendererSessionHost
  logger: ClientExtensionLogger
  queryLogs?(packageId: string, input: ExtensionLogQuery, installationId?: string): Promise<ExtensionLogPage>
  backgrounds: Map<string, RegisteredClientBackground>
  appearance?: ClientExtensionAppearance
  notify?(owner: string, input: ClientNotification): void
  emit(): void
  registerCommand(
    extensionPackage: ManagedClientExtensionPackage,
    module: ManagedClientExtensionModule,
    record: ActiveClientModule,
    commandId: string,
    handler: ClientCommandHandler,
  ): ExtensionRegistrationHandle
  registerConfigSubscription(
    packageId: string,
    input: { scope?: ExtensionStorageScope },
    handler: ClientConfigSubscription['handler'],
    target?: ExtensionInstallationTarget,
  ): number
  disposeConfigSubscription(id: number): void
}): ClientExtensionActivationContext {
  const installationTarget = structuredClone(input.extensionPackage.target ?? { kind: 'global' as const })
  const notifications = {
    async show(value: ClientNotification): Promise<void> {
      input.record.abortController.signal.throwIfAborted()
      if (!input.module.requestedUiCapabilities?.includes('ui.notify') || !input.module.desired.grants?.ui?.includes('ui.notify')) {
        throw Object.assign(new Error('Capability ui.notify is not granted'), { code: 'capability.denied' })
      }
      const notification = readClientNotification(value)
      if (!input.notify) throw new Error('Notification host is unavailable')
      input.notify(`extension:${input.record.key}`, notification)
    },
  }
  return {
    notifications,
    extension: {
      packageId: input.extensionPackage.packageId,
      moduleId: input.module.moduleId,
      instanceId: input.record.summary.instanceId!,
      version: input.extensionPackage.version,
      displayName: input.extensionPackage.displayName,
    },
    signal: input.record.abortController.signal,
    tokens: { countText: value => countText(value, input.record.abortController.signal) },
    logger: input.logger,
    logs: {
      query: query => {
        input.record.abortController.signal.throwIfAborted()
        if (!input.queryLogs) return Promise.reject(new Error('Extension logs are not available'))
        return input.queryLogs(input.extensionPackage.packageId, query,
          installationTarget.kind === 'card' ? extensionInstallationId(input.extensionPackage.packageId, installationTarget) : undefined)
      },
    },
    commands: {
      register: (commandId, handler) => input.registerCommand(input.extensionPackage, input.module, input.record, commandId, handler),
    },
    renderers: {
      register: (definition: RendererContributionDefinition, renderer: ClientRenderer) => {
        input.record.abortController.signal.throwIfAborted()
        const declared = input.module.contributions.renderers?.find(candidate => candidate.id === definition.id)
        if (!declared) throw new Error(`Renderer ${definition.id} is not declared in manifest contributes.renderers`)
        if (declared.surface !== definition.surface || declared.instanceScope !== definition.instanceScope || declared.adapter !== definition.adapter) {
          throw new Error(`Renderer ${definition.id} does not match its manifest surface/scope`)
        }
        if ((definition.surface === 'narrative.entry.inline' || definition.surface === 'agent.message.inline') && !renderer.projectNode) {
          throw new Error(`Inline Renderer ${definition.id} must provide projectNode(context)`)
        }
        const handle = input.rendererHost.register({
          owner: {
            kind: 'extension',
            packageId: input.extensionPackage.packageId,
            moduleId: input.module.moduleId,
            ...(installationTarget.kind === 'card' ? { target: installationTarget } : {}),
          },
          definition,
          mount: renderer.mount,
          ...(renderer.update ? { update: renderer.update } : {}),
          ...(renderer.projectNode ? { projectNode: renderer.projectNode } : {}),
          ...(renderer.frame ? { frame: renderer.frame } : {}),
          frameNotifications: { ...notifications, signal: input.record.abortController.signal },
        })
        input.record.registeredRendererIds.add(definition.id)
        input.record.handles.push(handle)
        return handle
      },
      open: (contributionId, options) => {
        const registration = requireOwnRenderer(input, contributionId)
        const scope = options?.scope ?? resolveRendererScope(input.rendererHost, registration.definition.instanceScope)
        if (!scope) return false
        return input.rendererHost.claim(
          registration.definition.surface,
          scope.key,
          rendererContributionKey(registration),
          { replace: options?.replace },
        ).accepted
      },
      close: (contributionId, requestedScope) => {
        const registration = requireOwnRenderer(input, contributionId)
        const scope = requestedScope ?? resolveRendererScope(input.rendererHost, registration.definition.instanceScope)
        if (!scope) return
        input.rendererHost.release(registration.definition.surface, scope.key, rendererContributionKey(registration))
      },
      openStandalone: (contributionId, options) => {
        if (!input.sessionHost) throw new Error('Standalone Renderer sessions are unavailable')
        const registration = requireOwnRenderer(input, contributionId)
        const scope = options?.scope ?? resolveRendererScope(input.rendererHost, registration.definition.instanceScope)
        if (!scope) throw new Error(`No active Renderer scope is available for ${registration.definition.instanceScope}`)
        const handle = input.sessionHost.open(registration, scope)
        input.record.handles.push(handle)
        return handle
      },
    },
    records: {
      list: query => input.data.records.list(input.extensionPackage.packageId, query, installationTarget),
      get: recordId => input.data.records.get(input.extensionPackage.packageId, recordId, installationTarget),
    },
    configs: {
      list: query => input.data.configs.list(input.extensionPackage.packageId, query, installationTarget),
      get: query => input.data.configs.get(input.extensionPackage.packageId, query, installationTarget),
      upsert: query => input.data.configs.upsert(input.extensionPackage.packageId, query, installationTarget),
      subscribe: (query, handler) => {
        if (input.record.abortController.signal.aborted) throw new Error('Cannot subscribe to Config changes from an unloaded extension')
        const id = input.registerConfigSubscription(input.extensionPackage.packageId, query, handler, installationTarget)
        const handle = { dispose: () => input.disposeConfigSubscription(id) }
        input.record.handles.push(handle)
        return handle
      },
    },
    state: {
      get: target => input.data.state.get(target, installationTarget),
    },
    history: {
      project: query => input.data.history.project(query, installationTarget),
      extract: query => input.data.history.extract(query, installationTarget),
    },
    rpc: {
      call: async (method, params) => {
        if (!method.startsWith(`${input.extensionPackage.packageId}.`)) {
          throw new Error(`Client extension RPC must use package namespace ${input.extensionPackage.packageId}.*`)
        }
        return await input.data.rpc.call(method, params, { packageId: input.extensionPackage.packageId, target: installationTarget }) as never
      },
    },
    assets: {
      url: assetId => input.data.assets.url(assetId, { packageId: input.extensionPackage.packageId, moduleId: input.module.moduleId, target: installationTarget }),
    },
    files: {
      url: path => extensionFileUrl(input.extensionPackage.packageId, input.extensionPackage.version, path, installationTarget, input.extensionPackage.archiveDigest),
    },
    backgrounds: {
      register: background => {
        if (input.record.abortController.signal.aborted) throw new Error('Cannot register a background from an unloaded extension')
        for (const field of ['id', 'name', 'description', 'image'] as const) {
          if (typeof background[field] !== 'string' || !background[field].trim()) throw new Error(`Background ${field} is required`)
        }
        if (!/^[a-zA-Z0-9._-]+$/.test(background.id)) throw new Error('Background id must be a local identifier')
        if (!background.image.startsWith('/') || background.image.startsWith('//') || background.image.includes('\\')) {
          throw new Error('Background image must use a host asset or package file URL')
        }
        if (background.source !== undefined && typeof background.source !== 'string') throw new Error('Background source must be text')
        const key = clientCommandKey(input.extensionPackage.packageId, input.module.moduleId, background.id, installationTarget)
        if (input.backgrounds.has(key)) throw new Error(`Background already registered: ${key}`)
        const value = { id: background.id, name: background.name, description: background.description, image: background.image,
          ...(background.source !== undefined ? { source: background.source } : {}),
          key, packageId: input.extensionPackage.packageId, moduleId: input.module.moduleId,
          ...(installationTarget.kind === 'card' ? { target: structuredClone(installationTarget) } : {}) }
        input.backgrounds.set(key, value)
        const handle = { dispose: () => {
          if (input.backgrounds.get(key) !== value) return
          input.backgrounds.delete(key)
          input.appearance?.scoped?.clear(input.record.key, key)
          input.emit()
        } }
        input.record.handles.push(handle)
        input.emit()
        return handle
      },
      list: () => [...input.backgrounds.values()]
        .filter(value => value.target?.kind !== 'card'
          || value.target.cardId === (installationTarget.kind === 'card' ? installationTarget.cardId : input.rendererHost.scopeSnapshot().cardId))
        .map(value => structuredClone(value)),
      activate: id => {
        input.record.abortController.signal.throwIfAborted()
        const currentCardId = input.rendererHost.scopeSnapshot().cardId
        if (installationTarget.kind === 'card' && installationTarget.cardId !== currentCardId) return false
        const candidates = [...input.backgrounds.values()].filter(value => value.target?.kind !== 'card' || value.target.cardId === currentCardId)
        const ownKey = clientCommandKey(input.extensionPackage.packageId, input.module.moduleId, id, installationTarget)
        const value = candidates.find(item => item.key === id || item.key === ownKey) ?? candidates.find(item => item.id === id)
        if (!value) return false
        const cardId = installationTarget.kind === 'card' ? installationTarget.cardId : value.target?.kind === 'card' ? value.target.cardId : undefined
        if (cardId) {
          if (!input.appearance?.scoped) throw new Error('Scoped background host is unavailable')
          const ownerKey = installationTarget.kind === 'card' ? input.record.key : moduleKey(value.packageId, value.moduleId, value.target)
          input.appearance.scoped.set({ id: value.key, image: value.image, cardId, ownerKey })
        } else {
          input.appearance?.setBackground({ id: value.key, image: value.image })
        }
        return true
      },
    },
  }
}

function permissionFingerprint(module: ManagedClientExtensionModule): string {
  return JSON.stringify([module.requestedUiCapabilities ?? [], module.desired.grants?.ui ?? []])
}

function commandFailure(
  code: Extract<ClientCommandExecutionResult, { status: 'failed' }>['code'],
  message: string,
): ClientCommandExecutionResult {
  return { status: 'failed', code, message }
}

function requireOwnRenderer(
  input: Pick<Parameters<typeof createActivationContext>[0], 'extensionPackage' | 'module' | 'rendererHost'>,
  contributionId: string,
) {
  const key = rendererContributionKey({
    owner: {
      kind: 'extension',
      packageId: input.extensionPackage.packageId,
      moduleId: input.module.moduleId,
      target: input.extensionPackage.target,
    },
    contributionId,
  })
  const registration = input.rendererHost.find(key)
  if (!registration) throw new Error(`Renderer contribution is not registered: ${key}`)
  return registration
}

function resolveRendererScope(host: ClientRendererHost, kind: ClientRendererScope['kind']): ClientRendererScope | undefined {
  const current = host.scopeSnapshot()
  if (kind === 'workspace') return { kind, key: current.workspace }
  if (kind === 'timeline' && current.timelineId) return { kind, key: current.timelineId }
  if (kind === 'agent-session' && current.agentSessionId) return { kind, key: current.agentSessionId }
  return undefined
}

function extensionFileUrl(packageId: string, version: string, path: string, target?: ExtensionInstallationTarget, archiveDigest?: string): string {
  if (target?.kind === 'card' && !archiveDigest) throw new Error('Card package archive digest is required')
  const segments = path.split('/').filter(Boolean)
  if (segments.length === 0 || segments.some(segment => segment === '.' || segment === '..')) {
    throw new Error(`Extension file path is invalid: ${path}`)
  }
  const prefix = target?.kind === 'card' ? `/card-extensions/${encodeURIComponent(target.cardId)}` : '/extensions'
  return `${prefix}/${encodeURIComponent(packageId)}/${encodeURIComponent(version)}${target?.kind === 'card' ? `/${archiveDigest}` : ''}/files/${segments.map(encodeURIComponent).join('/')}`
}

async function importClientModule(entryUrl: string, instanceId: string): Promise<LoadedClientModule> {
  const separator = entryUrl.includes('?') ? '&' : '?'
  return await import(/* @vite-ignore */ `${entryUrl}${separator}loomClientInstance=${encodeURIComponent(instanceId)}`) as LoadedClientModule
}

function createClientInstanceId(packageId: string, moduleId: string): string {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `client-${packageId}-${moduleId}-${suffix}`
}


const consoleClientExtensionLogger: ExtensionHostLogWriter = {
  debug: (message, data) => console.debug(message, data),
  info: (message, data) => console.info(message, data),
  warn: (message, data) => console.warn(message, data),
  error: (message, data) => console.error(message, data),
}

const unavailableClientExtensionDataApi: ClientExtensionDataApi = {
  configs: {
    list: () => Promise.reject(new Error('Client extension Config API is unavailable')),
    get: () => Promise.reject(new Error('Client extension Config API is unavailable')),
    upsert: () => Promise.reject(new Error('Client extension Config API is unavailable')),
  },
  records: {
    list: () => Promise.reject(new Error('Client extension Record API is unavailable')),
    get: () => Promise.reject(new Error('Client extension Record API is unavailable')),
  },
  state: {
    get: () => Promise.reject(new Error('Client extension State API is unavailable')),
  },
  history: {
    project: () => Promise.reject(new Error('Client extension History API is unavailable')),
    extract: () => Promise.reject(new Error('Client extension History API is unavailable')),
  },
  rpc: {
    call: () => Promise.reject(new Error('Client extension RPC API is unavailable')),
  },
  assets: {
    url: assetId => `/assets/${encodeURIComponent(assetId)}`,
  },
}
