import type {
  ClientActionSurface,
  ClientCommandHandler,
  ClientCommandInvocationContext,
  ClientHistorySource,
  ClientExtensionActivationContext,
  ClientExtensionLogger,
  ClientExtensionModule,
  ClientRenderer,
  ClientRendererScope,
  ClientStateSnapshot,
  ClientStateTarget,
  ExtensionEntityRef,
  ExtensionRecordEntry,
  ExtensionRegistrationHandle,
  ExtensionStorageScope,
  JsonValue,
  RendererContributionDefinition,
} from '@loom-studio/extension-sdk'
import type { ManagedClientExtensionModule, ManagedClientExtensionPackage } from '../../../entities/index.js'
import type { ClientRendererHost } from './client-renderer-host.js'
import type { RendererSessionHost } from './renderer-session.js'
import { rendererContributionKey } from './renderer-registry.js'
import { clientCommandKey, matchesClientActionCondition } from './client-actions.js'

export type { ManagedClientExtensionModule, ManagedClientExtensionPackage } from '../../../entities/index.js'

export type ClientExtensionDiagnostic = {
  code:
    | 'client-extension.activation_failed'
    | 'client-extension.renderer_not_registered'
    | 'client-extension.command_not_registered'
    | 'client-extension.command_execution_failed'
  message: string
  packageId: string
  moduleId: string
  commandId?: string
}

export type ClientExtensionModuleSummary = {
  packageId: string
  moduleId: string
  instanceId?: string
  state: 'inactive' | 'activating' | 'active' | 'degraded'
  error?: string
}

export type ClientExtensionHost = {
  reconcile(packages: readonly ManagedClientExtensionPackage[], options?: { reload?: readonly string[] }): Promise<void>
  executeCommand(input: {
    packageId: string
    moduleId: string
    commandId: string
    sourceSurface: ClientActionSurface
  }): Promise<ClientCommandExecutionResult>
  dispose(): Promise<void>
  commandRegistrations(): ClientCommandRegistrationSummary[]
  summaries(): ClientExtensionModuleSummary[]
  diagnostics(): readonly ClientExtensionDiagnostic[]
  subscribe(listener: () => void): () => void
  revision(): number
}

export type ClientCommandExecutionResult =
  | { status: 'completed' }
  | { status: 'failed'; code: 'command.not_found' | 'command.placement_not_found' | 'command.disabled' | 'command.activation_failed' | 'command.handler_missing' | 'command.execution_failed'; message: string }

export type ClientCommandRegistrationSummary = {
  commandKey: string
  packageId: string
  moduleId: string
  commandId: string
  instanceId: string
}

export type ClientExtensionDataApi = {
  records: {
    list(packageId: string, input?: { scope?: ExtensionStorageScope; recordType?: string; binding?: ExtensionEntityRef }): Promise<ExtensionRecordEntry[]>
    get(packageId: string, recordId: string): Promise<ExtensionRecordEntry | null>
  }
  state: {
    get(target: ClientStateTarget): Promise<ClientStateSnapshot>
  }
  history: {
    project(input: { source: ClientHistorySource; phase: 'classify' | 'prompt' | 'display' }): Promise<JsonValue>
    extract(input: { source: ClientHistorySource; phase?: 'classify' | 'prompt' | 'display'; extractorId: string }): Promise<JsonValue>
  }
  rpc: {
    call(method: string, params?: JsonValue): Promise<JsonValue>
  }
  assets: {
    url(assetId: string): string
  }
}

type ActiveClientModule = {
  key: string
  entryUrl: string
  packageVersion: string
  abortController: AbortController
  handles: ExtensionRegistrationHandle[]
  registeredCommandIds: Set<string>
  registeredRendererIds: Set<string>
  summary: ClientExtensionModuleSummary
}

type LoadedClientModule = Partial<ClientExtensionModule> & { default?: ClientExtensionModule }

export function createClientExtensionHost(options: {
  rendererHost: ClientRendererHost
  data?: ClientExtensionDataApi
  sessionHost?: RendererSessionHost
  loadModule?: (entryUrl: string, instanceId: string) => Promise<LoadedClientModule>
  logger?: ClientExtensionLogger
}): ClientExtensionHost {
  const active = new Map<string, ActiveClientModule>()
  const catalog = new Map<string, { extensionPackage: ManagedClientExtensionPackage; module: ManagedClientExtensionModule }>()
  const commandHandlers = new Map<string, { handler: ClientCommandHandler; instanceId: string }>()
  const summaries = new Map<string, ClientExtensionModuleSummary>()
  const diagnostics: ClientExtensionDiagnostic[] = []
  const listeners = new Set<() => void>()
  const loadModule = options.loadModule ?? importClientModule
  const logger = options.logger ?? consoleClientExtensionLogger
  const data = options.data ?? unavailableClientExtensionDataApi
  let currentRevision = 0
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

  async function stop(record: ActiveClientModule): Promise<void> {
    active.delete(record.key)
    record.abortController.abort()
    for (const handle of [...record.handles].reverse()) await handle.dispose()
    summaries.set(record.key, {
      packageId: record.summary.packageId,
      moduleId: record.summary.moduleId,
      state: 'inactive',
    })
  }

  async function activate(extensionPackage: ManagedClientExtensionPackage, module: ManagedClientExtensionModule): Promise<void> {
    const key = moduleKey(extensionPackage.packageId, module.moduleId)
    clearModuleDiagnostics(diagnostics, extensionPackage.packageId, module.moduleId)
    const instanceId = createClientInstanceId(extensionPackage.packageId, module.moduleId)
    const record: ActiveClientModule = {
      key,
      entryUrl: module.entryUrl,
      packageVersion: extensionPackage.version,
      abortController: new AbortController(),
      handles: [],
      registeredCommandIds: new Set(),
      registeredRendererIds: new Set(),
      summary: { packageId: extensionPackage.packageId, moduleId: module.moduleId, instanceId, state: 'activating' },
    }
    active.set(key, record)
    summaries.set(key, record.summary)
    emit()

    try {
      const loaded = await loadModule(module.entryUrl, instanceId)
      const extensionModule = loaded.activate ? loaded as ClientExtensionModule : loaded.default
      if (!extensionModule?.activate) throw new Error('Client extension must export activate(ctx)')
      const context = createActivationContext({
        extensionPackage,
        module,
        record,
        rendererHost: options.rendererHost,
        sessionHost: options.sessionHost,
        data,
        logger,
        registerCommand,
      })
      const returnedHandle = await extensionModule.activate(context)
      if (returnedHandle) record.handles.push(returnedHandle)
      for (const declared of module.contributions.renderers ?? []) {
        if (record.registeredRendererIds.has(declared.id)) continue
        diagnostics.push({
          code: 'client-extension.renderer_not_registered',
          message: `Renderer ${declared.id} is declared but was not registered during activation`,
          packageId: extensionPackage.packageId,
          moduleId: module.moduleId,
        })
      }
      for (const declared of module.contributions.commands ?? []) {
        if (record.registeredCommandIds.has(declared.id)) continue
        diagnostics.push({
          code: 'client-extension.command_not_registered',
          message: `Client Command ${declared.id} is declared but its Handler was not registered during activation`,
          packageId: extensionPackage.packageId,
          moduleId: module.moduleId,
          commandId: declared.id,
        })
      }
      record.summary = {
        packageId: extensionPackage.packageId,
        moduleId: module.moduleId,
        instanceId,
        state: diagnostics.some(diagnostic => diagnostic.packageId === extensionPackage.packageId && diagnostic.moduleId === module.moduleId)
          ? 'degraded'
          : 'active',
      }
      summaries.set(key, record.summary)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      diagnostics.push({
        code: 'client-extension.activation_failed',
        message,
        packageId: extensionPackage.packageId,
        moduleId: module.moduleId,
      })
      await stop(record)
      summaries.set(key, { packageId: extensionPackage.packageId, moduleId: module.moduleId, state: 'degraded', error: message })
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
    const key = clientCommandKey(extensionPackage.packageId, module.moduleId, commandId)
    if (commandHandlers.has(key)) throw new Error(`Client Command Handler is already registered: ${key}`)
    commandHandlers.set(key, { handler, instanceId: record.summary.instanceId! })
    record.registeredCommandIds.add(commandId)
    emit()
    let disposed = false
    const handle = {
      dispose: () => {
        if (disposed) return
        disposed = true
        const current = commandHandlers.get(key)
        if (current?.instanceId === record.summary.instanceId) commandHandlers.delete(key)
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
        for (const module of extensionPackage.modules) {
          if (module.runtimeKind !== 'client' || !module.entryUrl) continue
          const key = moduleKey(extensionPackage.packageId, module.moduleId)
          catalog.set(key, { extensionPackage, module })
          if (!summaries.has(key)) summaries.set(key, { packageId: extensionPackage.packageId, moduleId: module.moduleId, state: 'inactive' })
          if (!module.desired.enabled) continue
          if ((module.contributions.renderers?.length ?? 0) > 0 || active.has(key)) {
            desired.set(key, { extensionPackage, module })
          }
        }
      }

      for (const key of summaries.keys()) {
        if (!catalog.has(key) && !active.has(key)) summaries.delete(key)
      }

      for (const [key, record] of active) {
        const next = desired.get(key)
        if (!next || reload.has(key) || next.module.entryUrl !== record.entryUrl || next.extensionPackage.version !== record.packageVersion) {
          await stop(record)
        }
      }
      for (const [key, next] of desired) {
        if (!active.has(key)) await activate(next.extensionPackage, next.module)
      }
      emit()
    }),
    executeCommand: async input => {
      const scopes = options.rendererHost.scopeSnapshot()
      const context: ClientCommandInvocationContext = {
        sourceSurface: input.sourceSurface,
        workspaceId: scopes.workspace,
        ...(scopes.timelineId ? { timelineId: scopes.timelineId } : {}),
        ...(scopes.agentSessionId ? { agentSessionId: scopes.agentSessionId } : {}),
      }
      const resolved = await serialize(async () => {
        const key = moduleKey(input.packageId, input.moduleId)
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
        const registration = commandHandlers.get(clientCommandKey(input.packageId, input.moduleId, input.commandId))
        if (!registration) {
          return commandFailure('command.handler_missing', `Client Command Handler is not registered: ${input.commandId}`)
        }
        return { registration, signal: record.abortController.signal }
      })
      if ('status' in resolved) return resolved
      if (resolved.signal.aborted) return commandFailure('command.activation_failed', `Client Command module was unloaded before execution: ${input.moduleId}`)
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
        }
        if (!diagnostics.some(current => current.code === diagnostic.code
          && current.packageId === diagnostic.packageId
          && current.moduleId === diagnostic.moduleId
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
    commandRegistrations: () => [...commandHandlers.entries()].map(([commandKey, registration]) => {
      const [packageId = '', moduleId = '', commandId = ''] = commandKey.split('/')
      return { commandKey, packageId, moduleId, commandId, instanceId: registration.instanceId }
    }).sort((left, right) => left.commandKey.localeCompare(right.commandKey)),
    summaries: () => [...summaries.values()].sort((left, right) => moduleKey(left.packageId, left.moduleId).localeCompare(moduleKey(right.packageId, right.moduleId))),
    diagnostics: () => diagnostics,
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    revision: () => currentRevision,
  }
}

function clearModuleDiagnostics(
  diagnostics: ClientExtensionDiagnostic[],
  packageId: string,
  moduleId: string,
): void {
  for (let index = diagnostics.length - 1; index >= 0; index -= 1) {
    const diagnostic = diagnostics[index]
    if (diagnostic?.packageId === packageId && diagnostic.moduleId === moduleId) diagnostics.splice(index, 1)
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
  registerCommand(
    extensionPackage: ManagedClientExtensionPackage,
    module: ManagedClientExtensionModule,
    record: ActiveClientModule,
    commandId: string,
    handler: ClientCommandHandler,
  ): ExtensionRegistrationHandle
}): ClientExtensionActivationContext {
  return {
    extension: {
      packageId: input.extensionPackage.packageId,
      moduleId: input.module.moduleId,
      instanceId: input.record.summary.instanceId!,
      version: input.extensionPackage.version,
      displayName: input.extensionPackage.displayName,
    },
    signal: input.record.abortController.signal,
    logger: input.logger,
    commands: {
      register: (commandId, handler) => input.registerCommand(input.extensionPackage, input.module, input.record, commandId, handler),
    },
    renderers: {
      register: (definition: RendererContributionDefinition, renderer: ClientRenderer) => {
        const declared = input.module.contributions.renderers?.find(candidate => candidate.id === definition.id)
        if (!declared) throw new Error(`Renderer ${definition.id} is not declared in manifest contributes.renderers`)
        if (declared.surface !== definition.surface || declared.instanceScope !== definition.instanceScope || declared.adapter !== definition.adapter) {
          throw new Error(`Renderer ${definition.id} does not match its manifest surface/scope`)
        }
        if ((definition.surface === 'narrative.entry.inline' || definition.surface === 'agent.message.inline') && !renderer.projectNode) {
          throw new Error(`Inline Renderer ${definition.id} must provide projectNode(context)`)
        }
        const handle = input.rendererHost.register({
          packageId: input.extensionPackage.packageId,
          moduleId: input.module.moduleId,
          definition,
          mount: renderer.mount,
          ...(renderer.update ? { update: renderer.update } : {}),
          ...(renderer.projectNode ? { projectNode: renderer.projectNode } : {}),
          ...(renderer.frame ? { frame: renderer.frame } : {}),
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
        return input.sessionHost.open(registration, scope)
      },
    },
    records: {
      list: query => input.data.records.list(input.extensionPackage.packageId, query),
      get: recordId => input.data.records.get(input.extensionPackage.packageId, recordId),
    },
    state: {
      get: target => input.data.state.get(target),
    },
    history: {
      project: query => input.data.history.project(query),
      extract: query => input.data.history.extract(query),
    },
    rpc: {
      call: async (method, params) => {
        if (!method.startsWith(`${input.extensionPackage.packageId}.`)) {
          throw new Error(`Client extension RPC must use package namespace ${input.extensionPackage.packageId}.*`)
        }
        return await input.data.rpc.call(method, params) as never
      },
    },
    assets: {
      url: assetId => input.data.assets.url(assetId),
    },
    files: {
      url: path => extensionFileUrl(input.extensionPackage.packageId, input.extensionPackage.version, path),
    },
  }
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
  const key = `${input.extensionPackage.packageId}/${input.module.moduleId}/${contributionId}`
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

function extensionFileUrl(packageId: string, version: string, path: string): string {
  const segments = path.split('/').filter(Boolean)
  if (segments.length === 0 || segments.some(segment => segment === '.' || segment === '..')) {
    throw new Error(`Extension file path is invalid: ${path}`)
  }
  return `/extensions/${encodeURIComponent(packageId)}/${encodeURIComponent(version)}/files/${segments.map(encodeURIComponent).join('/')}`
}

async function importClientModule(entryUrl: string, instanceId: string): Promise<LoadedClientModule> {
  const separator = entryUrl.includes('?') ? '&' : '?'
  return await import(/* @vite-ignore */ `${entryUrl}${separator}loomClientInstance=${encodeURIComponent(instanceId)}`) as LoadedClientModule
}

function createClientInstanceId(packageId: string, moduleId: string): string {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `client-${packageId}-${moduleId}-${suffix}`
}

function moduleKey(packageId: string, moduleId: string): string {
  return `${packageId}/${moduleId}`
}

const consoleClientExtensionLogger: ClientExtensionLogger = {
  debug: (message, data) => console.debug(message, data),
  info: (message, data) => console.info(message, data),
  warn: (message, data) => console.warn(message, data),
  error: (message, data) => console.error(message, data),
}

const unavailableClientExtensionDataApi: ClientExtensionDataApi = {
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
