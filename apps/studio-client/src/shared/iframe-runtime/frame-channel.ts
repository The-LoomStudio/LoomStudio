import type { IframeRequestResult } from '@loom-studio/extension-sdk'

export function isFrameRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Private MessagePort, bounded requests, no method reflection or business API. */
export function serveFrameRequests(port: MessagePort, options: {
  handle(method: string, params: unknown): Promise<unknown>
  onInvalidMessage(): void
}) {
  const pending = new Map<string, ReturnType<typeof setTimeout>>()
  let disposed = false
  function respond(requestId: string, result: IframeRequestResult) {
    if (!disposed) port.postMessage({ type: 'loom:ctx.result', requestId, result })
  }
  function receive(event: MessageEvent) {
    const message: unknown = event.data
    if (disposed || !isFrameRecord(message) || message.type !== 'loom:ctx.request') return
    const { requestId, method, params } = message
    if (typeof requestId !== 'string' || !requestId || requestId.length > 128
      || typeof method !== 'string' || !method || method.length > 64) {
      options.onInvalidMessage()
      return
    }
    if (pending.has(requestId)) { options.onInvalidMessage(); return }
    if (pending.size >= 32) {
      respond(requestId, { ok: false, error: { code: 'ctx.busy', message: 'Too many pending iframe requests' } })
      return
    }
    const timer = setTimeout(() => {
      pending.delete(requestId)
      respond(requestId, { ok: false, error: { code: 'ctx.timeout', message: 'Host request timed out' } })
    }, 10_000)
    pending.set(requestId, timer)
    void Promise.resolve().then(() => {
      if (disposed) throw new Error('Iframe context disposed')
      return options.handle(method, params)
    }).then(value => finish({ ok: true, value }), error => finish({
      ok: false,
      error: {
        code: isFrameRecord(error) && typeof error.code === 'string' ? error.code : 'ctx.failed',
        message: error instanceof Error ? error.message : String(error),
      },
    }))
    function finish(result: IframeRequestResult) {
      if (pending.get(requestId as string) !== timer) return
      clearTimeout(timer)
      pending.delete(requestId as string)
      respond(requestId as string, result)
    }
  }
  port.addEventListener('message', receive)
  port.start()
  return {
    dispose() {
      if (disposed) return
      disposed = true
      port.removeEventListener('message', receive)
      for (const timer of pending.values()) clearTimeout(timer)
      pending.clear()
    },
  }
}
