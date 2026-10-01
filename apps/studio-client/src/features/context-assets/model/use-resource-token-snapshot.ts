import { useEffect, useRef, useState } from 'react'
import type { ContextAssetNode } from '../../../entities/index.js'
import { countTexts } from '../../../shared/tokenizer/client.js'
import { useTokenDisplaySettings } from '../../../shared/tokenizer/settings.js'
import { aggregateTokenCounts, collectTokenEntries } from './resource-token-counts.js'

export type ResourceTokenSnapshot = {
  summary?: ReturnType<typeof aggregateTokenCounts>
  pending: boolean
  error?: string
  multiplier?: number
  refresh(): void
}

export function useResourceTokenSnapshot(roots: readonly ContextAssetNode[], scope: string): ResourceTokenSnapshot {
  const multiplier = useTokenDisplaySettings(state => state.multiplier)
  const [result, setResult] = useState<{
    scope: string; summary?: ReturnType<typeof aggregateTokenCounts>; pending: boolean; error?: string; multiplier: number
  }>()
  const task = useRef<AbortController | undefined>(undefined)
  useEffect(() => () => { task.current?.abort() }, [scope])
  function refresh() {
    task.current?.abort()
    const abort = new AbortController()
    task.current = abort
    const entries = collectTokenEntries(roots)
    setResult(previous => ({
      scope, multiplier, pending: true,
      ...(previous?.scope === scope ? { summary: previous.summary } : {}),
    }))
    void countTexts(entries.map(entry => entry.body), abort.signal).then(counts => {
      if (abort.signal.aborted) return
      const summary = aggregateTokenCounts(roots, new Map(entries.map((entry, index) => [entry.id, counts[index]!])), multiplier)
      setResult({ scope, summary, multiplier, pending: false })
    }, error => {
      if (!abort.signal.aborted) setResult({ scope, multiplier, pending: false, error: String(error) })
    })
  }
  return {
    summary: result?.scope === scope ? result.summary : undefined,
    pending: result?.scope === scope && result.pending,
    error: result?.scope === scope ? result.error : undefined,
    multiplier: result?.scope === scope ? result.multiplier : undefined,
    refresh,
  }
}
