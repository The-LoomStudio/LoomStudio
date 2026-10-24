import { createFrameRequestClient } from '@loom-studio/extension-sdk'
import type { ClientExtensionLogger, ExtensionRegistrationHandle, WorkerExtensionActivationContext } from '@loom-studio/extension-sdk'
import { isFrameRecord } from '../iframe-runtime/frame-channel.js'

export function createWorkerContext(port: MessagePort, extension: WorkerExtensionActivationContext['extension']) {
  const client = createFrameRequestClient(port)
  const controller = new AbortController()
  const subscriptions = new Map<string, { handler(value: unknown): void | Promise<void>; onError?(error: Error): void }>()
  const diagnostic = (error: unknown) => {
    if (!controller.signal.aborted) port.postMessage({ type: 'loom:worker.diagnostic', message: error instanceof Error ? error.message : String(error) })
  }
  function receive(event: MessageEvent) {
    const message: unknown = event.data
    if (!isFrameRecord(message)) return
    if (message.type === 'loom:ctx.disposed') { dispose(); return }
    if (message.type !== 'loom:worker.subscription' || typeof message.id !== 'string' || controller.signal.aborted) return
    const subscription = subscriptions.get(message.id)
    if (!subscription) return
    void Promise.resolve().then(() => {
      if (controller.signal.aborted || subscriptions.get(message.id as string) !== subscription) return
      if (typeof message.error === 'string') {
        const error = new Error(message.error)
        if (subscription.onError) subscription.onError(error)
        else diagnostic(error)
      } else return subscription.handler(message.value)
    }).catch(diagnostic)
  }
  port.addEventListener('message', receive)
  const request = <T>(method: string, params?: unknown) => client.request(method, params) as Promise<T>
  async function subscribe<T>(method: string, params: Record<string, unknown>, handler: (value: T) => void | Promise<void>, onError?: (error: Error) => void): Promise<ExtensionRegistrationHandle> {
    const id = crypto.randomUUID()
    subscriptions.set(id, { handler: value => handler(value as T), onError })
    try { await request(method, { ...params, id }) } catch (error) {
      subscriptions.delete(id)
      // A timed-out request may have registered before its reply was lost.
      if (!controller.signal.aborted) void request('subscription.dispose', id).catch(diagnostic)
      throw error
    }
    if (controller.signal.aborted) { subscriptions.delete(id); throw new Error('Worker context disposed') }
    return { dispose: async () => {
      if (!subscriptions.delete(id)) return
      await request('subscription.dispose', id)
    } }
  }
  function logger(namespaces: string[] = []): ClientExtensionLogger {
    const log: ClientExtensionLogger['log'] = (level, message, fields) => {
      void request('logger.log', { namespaces, level, message, fields }).catch(diagnostic)
    }
    return {
      child: name => logger([...namespaces, name]), log,
      debug: (message, data) => log('debug', message, { data }),
      info: (message, data) => log('info', message, { data }),
      warn: (message, data) => log('warn', message, { data }),
      error: (message, data) => log('error', message, { data }),
    }
  }
  const context: WorkerExtensionActivationContext = {
    extension, signal: controller.signal, logger: logger(),
    timeline: { getTarget: () => request('timeline.getTarget') },
    notifications: { show: input => request('notifications.show', input) },
    tokens: { countText: input => request('tokens.countText', input) },
    logs: { query: input => request('logs.query', input) },
    assets: { url: id => request('assets.url', id) },
    files: { url: path => request('files.url', path) },
    records: { list: input => request('records.list', input), get: id => request('records.get', id) },
    configs: {
      list: input => request('configs.list', input), get: input => request('configs.get', input),
      upsert: input => request('configs.upsert', input),
      subscribe: (input, handler) => subscribe('configs.subscribe', { input }, handler),
    },
    state: { get: target => request('state.get', target), subscribe: (target, handler, onError) => subscribe('state.subscribe', { target }, handler, onError) },
    history: { project: input => request('history.project', input), extract: input => request('history.extract', input) },
    rpc: { call: (method, params) => request('rpc.call', { method, params }) },
  }
  function dispose() {
    if (controller.signal.aborted) return
    controller.abort()
    subscriptions.clear()
    client.dispose()
    port.removeEventListener('message', receive)
  }
  return { context, dispose }
}
