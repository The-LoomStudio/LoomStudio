let source: EventSource | undefined
let reconnectTimer: ReturnType<typeof setTimeout> | undefined
const subscribers = new Set<(events?: EventSource) => void>()

function connect() {
  const events = source = new EventSource('/extensions/events')
  events.addEventListener('error', () => {
    // EventSource retries ordinary network interruptions itself. HTTP errors can close it permanently.
    if (source === events && events.readyState === EventSource.CLOSED) scheduleReconnect(events)
  })
  for (const bind of subscribers) bind(events)
}

function scheduleReconnect(closedSource: EventSource) {
  if (reconnectTimer !== undefined) return
  reconnectTimer = setTimeout(async () => {
    // The server may still be starting when the old connection closes.
    const response = await fetch('/auth/session', { method: 'POST', credentials: 'same-origin' }).catch(() => undefined)
    if (source !== closedSource) return
    reconnectTimer = undefined
    if (response?.ok) connect()
    else scheduleReconnect(closedSource)
  }, 3000)
}

function disconnect() {
  clearTimeout(reconnectTimer)
  reconnectTimer = undefined
  source?.close()
  source = undefined
}

/** One transport per page; each consumer owns only its listeners. */
export function subscribeExtensionEvents(options: {
  onConnected?: () => void
  onError?: () => void
  events?: Record<string, (event: MessageEvent) => void>
}): () => void {
  let detach: (() => void) | undefined
  const bind = (events?: EventSource) => {
    detach?.()
    detach = undefined
    if (!events) return
    const listeners: Array<[string, EventListener]> = []
    const listen = (name: string, listener: EventListener) => {
      events.addEventListener(name, listener)
      listeners.push([name, listener])
    }
    if (options.onConnected) listen('open', options.onConnected)
    if (options.onError) listen('error', options.onError)
    for (const [name, listener] of Object.entries(options.events ?? {})) {
      // Native EventTarget dispatch isolates exceptions between consumers.
      listen(name, listener as EventListener)
    }
    detach = () => {
      for (const [name, listener] of listeners) events.removeEventListener(name, listener)
    }
    if (events.readyState === EventSource.OPEN) {
      queueMicrotask(() => {
        if (subscribers.has(bind) && source === events && events.readyState === EventSource.OPEN) options.onConnected?.()
      })
    }
  }
  subscribers.add(bind)
  if (source) bind(source)
  else connect()
  return () => {
    if (!subscribers.delete(bind)) return
    bind()
    if (subscribers.size === 0) disconnect()
  }
}

if (import.meta.hot) import.meta.hot.dispose(() => {
  for (const bind of subscribers) bind()
  subscribers.clear()
  disconnect()
})
