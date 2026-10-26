import { useEffect, useState } from 'react'
import type { StudioApi } from '../../../shared/api/studio-api.js'
type Status = Awaited<ReturnType<StudioApi['agentSessions']['summaryStatus']>>

/** Poll only the small coordinator status, never rebuild the Session history on a timer. */
export function useSessionSummaryStatus(api: StudioApi, sessionId: string) {
  const [status, setStatus] = useState<Status>({ state: 'idle' })
  const [error, setError] = useState<string>()
  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      let delay = 5000
      try {
        const next = await api.agentSessions.summaryStatus(sessionId)
        if (stopped) return
        setStatus(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next)
        setError(undefined)
        if (next.state === 'preparing' || next.state === 'ready') delay = 1500
      } catch (cause) {
        if (!stopped) setError(cause instanceof Error ? cause.message : String(cause))
      }
      if (!stopped) timer = setTimeout(() => void poll(), delay)
    }
    void poll()
    return () => { stopped = true; clearTimeout(timer) }
  }, [api, sessionId])
  return { status, error }
}

