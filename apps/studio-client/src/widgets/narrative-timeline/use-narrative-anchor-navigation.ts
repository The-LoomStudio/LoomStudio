import { useEffect, useLayoutEffect, useRef, useState } from 'react'

type AnchorSource = { timelineId?: string; nodeId?: string }
type PageAttempt = { source: AnchorSource; firstNodeId?: string; pending: boolean }

export function useNarrativeAnchorNavigation(input: {
  timelineId?: string
  nodeId?: string
  nodes: readonly { id: string }[]
  hasOlder: boolean
  busy: boolean
  onLoadOlder(): Promise<void>
  onLocate(nodeId: string): void
}): 'idle' | 'loading' | 'located' | 'unavailable' | 'failed' {
  const sourceRef = useRef<AnchorSource>({ timelineId: input.timelineId, nodeId: input.nodeId })
  if (sourceRef.current.timelineId !== input.timelineId || sourceRef.current.nodeId !== input.nodeId) {
    sourceRef.current = { timelineId: input.timelineId, nodeId: input.nodeId }
  }
  const source = sourceRef.current
  const attemptRef = useRef<PageAttempt | undefined>(undefined)
  const locatedRef = useRef<AnchorSource | undefined>(undefined)
  const mountedRef = useRef(false)
  const [completed, setCompleted] = useState(0)
  const firstNodeId = input.nodes[0]?.id
  const found = input.nodes.some(node => node.id === source.nodeId)
  const attempt = attemptRef.current
  const samePage = attempt?.source === source && attempt.firstNodeId === firstNodeId
  const status = !source.nodeId || !source.timelineId ? 'idle'
    : found ? 'located'
      : input.busy ? 'loading'
        : !input.hasOlder ? 'unavailable'
          : samePage && !attempt.pending ? 'failed' : 'loading'

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useLayoutEffect(() => {
    if (status !== 'located' || locatedRef.current === source) return
    locatedRef.current = source
    input.onLocate(source.nodeId!)
  }, [source, status, input.onLocate])

  useEffect(() => {
    if (status !== 'loading' || input.busy || !input.hasOlder) return
    const previous = attemptRef.current
    if (previous?.pending && previous.source.timelineId === source.timelineId) return
    if (previous?.source === source && previous.firstNodeId === firstNodeId) return
    const current: PageAttempt = { source, firstNodeId, pending: true }
    attemptRef.current = current
    void (async () => {
      try {
        await input.onLoadOlder()
      } catch {
        // The caller reports the read error; an unchanged page is not retried automatically.
      } finally {
        current.pending = false
        if (mountedRef.current && attemptRef.current === current) setCompleted(value => value + 1)
      }
    })()
  }, [source, firstNodeId, status, input.busy, input.hasOlder, input.onLoadOlder, completed])

  return status
}
