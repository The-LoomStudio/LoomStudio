import { useEffect, useState } from 'react'

export function useRenderingLabMessages() {
  const [renderingEvents, setRenderingEvents] = useState<string[]>([])

  useEffect(() => {
    const listener = (event: MessageEvent<unknown>) => {
      const label = formatRenderingLabMessageEvent(event.data, new Date())
      if (!label) return
      setRenderingEvents(current => [label, ...current].slice(0, 5))
    }

    window.addEventListener('message', listener)
    return () => {
      window.removeEventListener('message', listener)
    }
  }, [])

  return {
    renderingEvents,
    setRenderingEvents,
  }
}

export function formatRenderingLabMessageEvent(data: unknown, time: Date): string | undefined {
  if (!isObject(data) || data.source !== 'loom-rendering-lab') return undefined
  const type = typeof data.type === 'string' ? data.type : 'unknown'
  const value = typeof data.value === 'string' ? data.value : '-'
  return `${time.toLocaleTimeString()} ${type}: ${value}`
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
