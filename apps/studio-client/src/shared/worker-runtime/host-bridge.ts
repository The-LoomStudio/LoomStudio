import type {
  ClientExtensionActivationContext, ClientHistorySource, ClientStateTarget, ExtensionEntityRef,
  ExtensionLogFields, ExtensionLogQuery, ExtensionRegistrationHandle, ExtensionStorageScope, JsonValue,
} from '@loom-studio/extension-sdk'
import { isFrameRecord, serveFrameRequests } from '../iframe-runtime/frame-channel.js'

const invalid = () => Object.assign(new Error('Invalid Worker context parameters'), { code: 'ctx.invalid' })
const disposedError = () => Object.assign(new Error('Worker context disposed'), { code: 'ctx.disposed' })
function record(value: unknown): Record<string, unknown> {
  if (!isFrameRecord(value)) throw invalid()
  return value
}
function string(value: unknown): string {
  if (typeof value !== 'string' || !value) throw invalid()
  return value
}
function optionalString(value: unknown): string | undefined { return value === undefined ? undefined : string(value) }
function json(value: unknown, ancestors = new Set<object>()): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'object' || ancestors.has(value)) throw invalid()
  ancestors.add(value)
  try {
    if (Array.isArray(value)) return value.map(item => json(item, ancestors))
    if (!isFrameRecord(value) || Object.getPrototypeOf(value) !== Object.prototype) throw invalid()
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, json(item, ancestors)]))
  } finally { ancestors.delete(value) }
}
function scope(value: unknown): ExtensionStorageScope {
  const input = record(value)
  switch (input.kind) {
    case 'global': return { kind: 'global' }
    case 'card': return { kind: 'card', cardId: string(input.cardId) }
    case 'timeline': return { kind: 'timeline', timelineId: string(input.timelineId) }
    case 'agent-session': return { kind: 'agent-session', agentSessionId: string(input.agentSessionId) }
    default: throw invalid()
  }
}
function target(value: unknown): ClientStateTarget {
  const input = record(value)
  if (input.scope === 'global') return { scope: 'global' }
  if (input.scope === 'timeline') return { scope: 'timeline', timelineId: string(input.timelineId), branchId: string(input.branchId) }
  throw invalid()
}
function source(value: unknown): ClientHistorySource {
  const input = record(value)
  if (input.kind === 'narrative') return { kind: 'narrative', timelineId: string(input.timelineId), branchId: string(input.branchId) }
  if (input.kind === 'agent-session') return { kind: 'agent-session', sessionId: string(input.sessionId), headEntryId: optionalString(input.headEntryId) }
  throw invalid()
}
function binding(value: unknown): ExtensionEntityRef {
  const input = record(value)
  switch (input.kind) {
    case 'asset': return { kind: 'asset', assetId: string(input.assetId) }
    case 'narrative-node': return { kind: 'narrative-node', timelineId: string(input.timelineId), nodeId: string(input.nodeId) }
    case 'agent-message': return { kind: 'agent-message', agentSessionId: string(input.agentSessionId), messageId: string(input.messageId) }
    case 'state-path': return { kind: 'state-path', timelineId: string(input.timelineId), path: string(input.path) }
    default: throw invalid()
  }
}
function phase(value: unknown): 'classify' | 'prompt' | 'display' {
  if (value !== 'classify' && value !== 'prompt' && value !== 'display') throw invalid()
  return value
}
function level(value: unknown): 'debug' | 'info' | 'warn' | 'error' {
  if (value !== 'debug' && value !== 'info' && value !== 'warn' && value !== 'error') throw invalid()
  return value
}

/** Explicit capability dispatch. The supplied host context remains the permission authority. */
export function createWorkerHostBridge(port: MessagePort, context: ClientExtensionActivationContext) {
  let disposed = false
  const subscriptions = new Map<string, ExtensionRegistrationHandle>()
  const diagnostic = (error: unknown) => context.logger.error('Worker context bridge failed', { error: error instanceof Error ? error.message : String(error) })
  function active() { if (disposed || context.signal.aborted) throw disposedError() }
  function emit(id: string, value: unknown, error?: string) {
    if (disposed || context.signal.aborted) return
    try { port.postMessage({ type: 'loom:worker.subscription', id, value, error }) } catch (error) { diagnostic(error) }
  }
  async function release(id: string) {
    const handle = subscriptions.get(id)
    subscriptions.delete(id)
    await handle?.dispose()
  }
  function subscribe(id: string, create: () => ExtensionRegistrationHandle) {
    if (subscriptions.has(id) || subscriptions.size >= 128) throw invalid()
    const handle = create()
    if (disposed || context.signal.aborted) {
      void Promise.resolve().then(() => handle.dispose()).catch(diagnostic)
      throw disposedError()
    }
    subscriptions.set(id, handle)
  }
  async function dispatch(method: string, raw: unknown): Promise<unknown> {
    active()
    switch (method) {
      case 'timeline.getTarget': return context.timeline.target
      case 'assets.url': return context.assets.url(string(raw))
      case 'files.url': return context.files.url(string(raw))
      case 'notifications.show': {
        const p = record(raw)
        const notificationLevel = p.level
        if (notificationLevel !== undefined && (typeof notificationLevel !== 'string' || !['info', 'success', 'warning', 'error'].includes(notificationLevel))) throw invalid()
        return context.notifications.show({ message: string(p.message), level: notificationLevel as 'info' | 'success' | 'warning' | 'error' | undefined })
      }
      case 'tokens.countText': {
        const p = record(raw)
        if (typeof p.text !== 'string' || (p.multiplier !== undefined && (typeof p.multiplier !== 'number' || !Number.isFinite(p.multiplier) || p.multiplier <= 0))) throw invalid()
        return context.tokens.countText({ text: p.text, multiplier: p.multiplier as number | undefined })
      }
      case 'logger.log': {
        const p = record(raw)
        if (!Array.isArray(p.namespaces) || p.namespaces.length > 32) throw invalid()
        let logger = context.logger
        for (const name of p.namespaces) logger = logger.child(string(name))
        const f = p.fields === undefined ? {} : record(p.fields)
        const fields: ExtensionLogFields = {
          event: optionalString(f.event), correlationId: optionalString(f.correlationId),
          callId: optionalString(f.callId), parentCallId: optionalString(f.parentCallId),
        }
        if (f.data !== undefined) { record(f.data); fields.data = json(f.data) as NonNullable<ExtensionLogFields['data']> }
        return logger.log(level(p.level), string(p.message), fields)
      }
      case 'logs.query': {
        const p = record(raw)
        if (typeof p.limit !== 'number' || !Number.isInteger(p.limit) || p.limit <= 0) throw invalid()
        if (p.source !== undefined && p.source !== 'current' && p.source !== 'history') throw invalid()
        if (p.levels !== undefined && !Array.isArray(p.levels)) throw invalid()
        const input: ExtensionLogQuery = { limit: p.limit, source: p.source, levels: (p.levels as unknown[] | undefined)?.map(level) }
        for (const key of ['cursor', 'namespacePrefix', 'since', 'until', 'text', 'event', 'runId', 'moduleId'] as const) input[key] = optionalString(p[key])
        return context.logs.query(input)
      }
      case 'records.get': return context.records.get(string(raw))
      case 'records.list': {
        const p = raw === undefined ? {} : record(raw)
        return context.records.list({ scope: p.scope === undefined ? undefined : scope(p.scope), recordType: optionalString(p.recordType), binding: p.binding === undefined ? undefined : binding(p.binding) })
      }
      case 'configs.list': {
        const p = raw === undefined ? {} : record(raw)
        return context.configs.list({ scope: p.scope === undefined ? undefined : scope(p.scope) })
      }
      case 'configs.get': {
        const p = record(raw)
        return context.configs.get({ scope: scope(p.scope), key: string(p.key) })
      }
      case 'configs.upsert': {
        const p = record(raw)
        if (p.expectedVersion !== undefined && (typeof p.expectedVersion !== 'number' || !Number.isInteger(p.expectedVersion) || p.expectedVersion < 0)) throw invalid()
        return context.configs.upsert({ scope: scope(p.scope), key: string(p.key), value: json(p.value), expectedVersion: p.expectedVersion as number | undefined })
      }
      case 'state.get': return context.state.get(target(raw))
      case 'state.subscribe': {
        const p = record(raw), id = string(p.id), stateTarget = target(p.target)
        subscribe(id, () => context.state.subscribe(stateTarget, value => emit(id, value), error => emit(id, undefined, error.message)))
        return undefined
      }
      case 'configs.subscribe': {
        const p = record(raw), id = string(p.id), input = record(p.input)
        const configScope = input.scope === undefined ? undefined : scope(input.scope)
        subscribe(id, () => context.configs.subscribe({ scope: configScope }, value => emit(id, value)))
        return undefined
      }
      case 'subscription.dispose': return release(string(raw))
      case 'history.project': {
        const p = record(raw)
        return context.history.project({ source: source(p.source), phase: phase(p.phase) })
      }
      case 'history.extract': {
        const p = record(raw)
        return context.history.extract({ source: source(p.source), phase: p.phase === undefined ? undefined : phase(p.phase), extractorId: string(p.extractorId) })
      }
      case 'rpc.call': {
        const p = record(raw)
        return context.rpc.call(string(p.method), p.params === undefined ? undefined : json(p.params))
      }
      default: throw Object.assign(new Error(`Worker context method is not available: ${method}`), { code: 'ctx.denied' })
    }
  }
  const server = serveFrameRequests(port, {
    handle: async (method, params) => {
      const result = await dispatch(method, params)
      active()
      return result
    },
    onInvalidMessage: () => diagnostic(new Error('Invalid Worker request envelope')),
  })
  function dispose() {
    if (disposed) return
    disposed = true
    server.dispose()
    context.signal.removeEventListener('abort', dispose)
    // Revoke future/queued bridge work immediately. Already-issued host side effects cannot be undone.
    try { port.postMessage({ type: 'loom:ctx.disposed' }) } catch (error) { diagnostic(error) }
    for (const id of subscriptions.keys()) void release(id).catch(diagnostic)
  }
  context.signal.addEventListener('abort', dispose, { once: true })
  if (context.signal.aborted) dispose()
  return { dispose }
}
