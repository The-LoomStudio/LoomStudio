export type ClientNotification = {
  message: string
  level?: 'info' | 'success' | 'warning' | 'error'
}

export type IframeRequestResult =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: string; message: string } }

export type IframeContext = {
  notifications: { show(input: ClientNotification): Promise<void> }
  close(): void
  dispose(): void
}

// Keep this function self-contained: Loom Script embeds the same client in its
// bootstrap rather than maintaining a second request/timeout implementation.
export function createFrameRequestClient(port: MessagePort) {
  const pending = new Map<string, {
    resolve(value: unknown): void
    reject(reason: Error): void
    timer: ReturnType<typeof setTimeout>
  }>()
  let disposed = false
  function receive(event: MessageEvent) {
    const message = event.data
    if (message?.type === 'loom:ctx.disposed') { dispose(); return }
    if (!message || message.type !== 'loom:ctx.result' || typeof message.requestId !== 'string') return
    const task = pending.get(message.requestId)
    if (!task) return
    const result = message.result
    if (!result || typeof result.ok !== 'boolean' || (!result.ok
      && (typeof result.error?.code !== 'string' || typeof result.error?.message !== 'string'))) return
    pending.delete(message.requestId)
    clearTimeout(task.timer)
    if (result.ok) task.resolve(result.value)
    else task.reject(Object.assign(new Error(result.error.message), { code: result.error.code }))
  }
  port.addEventListener('message', receive)
  port.start()
  function dispose() {
    if (disposed) return
    disposed = true
    port.removeEventListener('message', receive)
    for (const task of pending.values()) {
      clearTimeout(task.timer)
      task.reject(Object.assign(new Error('Iframe context disposed'), { code: 'ctx.disposed' }))
    }
    pending.clear()
  }
  return {
    request(method: string, params: unknown): Promise<unknown> {
      if (disposed) return Promise.reject(Object.assign(new Error('Iframe context is disposed'), { code: 'ctx.disposed' }))
      if (pending.size >= 32) return Promise.reject(Object.assign(new Error('Too many pending iframe requests'), { code: 'ctx.busy' }))
      const requestId = crypto.randomUUID()
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(requestId)
          reject(Object.assign(new Error('Iframe request timed out'), { code: 'ctx.timeout' }))
        }, 15_000)
        pending.set(requestId, { resolve, reject, timer })
        try {
          port.postMessage({ type: 'loom:ctx.request', requestId, method, params })
        } catch (error) {
          pending.delete(requestId)
          clearTimeout(timer)
          reject(error)
        }
      })
    },
    dispose,
  }
}

/** Connect from an extension iframe; no capability is granted by connecting. */
export function connectIframeContext(): Promise<IframeContext> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      window.removeEventListener('message', connect)
      reject(new Error('Iframe host connection timed out'))
    }, 10_000)
    function connect(event: MessageEvent) {
      if (event.source !== window.parent || event.data?.type !== 'loom:ctx.connect'
        || event.data.protocolVersion !== 1 || typeof event.data.instanceId !== 'string'
        || !event.ports[0]) return
      clearTimeout(timeout)
      window.removeEventListener('message', connect)
      const port = event.ports[0]
      const client = createFrameRequestClient(port)
      let disposed = false
      const dispose = () => {
        if (disposed) return
        disposed = true
        window.removeEventListener('pagehide', dispose)
        client.dispose()
        port.close()
      }
      window.addEventListener('pagehide', dispose, { once: true })
      port.postMessage({ type: 'loom:ctx.ready', instanceId: event.data.instanceId })
      resolve({
        notifications: { show: async input => { await client.request('notifications.show', input) } },
        close: () => { if (!disposed) port.postMessage({ type: 'loom:ctx.close' }) },
        dispose,
      })
    }
    window.addEventListener('message', connect)
  })
}
