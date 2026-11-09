let source: EventSource | undefined
let reconnectTimer: ReturnType<typeof setTimeout> | undefined
let reconnectAttempts = 0
const subscribers = new Set<(events?: EventSource) => void>()

function connect() {
  if (source && source.readyState !== EventSource.CLOSED) {
    source.close()
  }
  const events = source = new EventSource('/extensions/events')
  events.addEventListener('open', () => {
    reconnectAttempts = 0
  })
  events.addEventListener('error', () => {
    // EventSource retries ordinary network interruptions itself. HTTP errors can close it permanently.
    if (source === events && events.readyState === EventSource.CLOSED) scheduleReconnect()
  })
  for (const bind of subscribers) bind(events)
}

function scheduleReconnect() {
  if (reconnectTimer !== undefined) return
  const delay = Math.min(1000 * Math.pow(1.5, reconnectAttempts), 10000)
  reconnectAttempts++
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = undefined
    // Probe server availability before recreating EventSource
    const response = await fetch('/auth/session', { method: 'POST', credentials: 'same-origin' }).catch(() => undefined)
    if (response?.ok) connect()
    else scheduleReconnect()
  }, delay)
}

function handleWakeOrOnline() {
  if (subscribers.size === 0) return
  if (!source || source.readyState === EventSource.CLOSED) {
    clearTimeout(reconnectTimer)
    reconnectTimer = undefined
    connect()
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', handleWakeOrOnline)
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') handleWakeOrOnline()
  })
}

function disconnect() {
  clearTimeout(reconnectTimer)
  reconnectTimer = undefined
  reconnectAttempts = 0
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
