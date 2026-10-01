import type { ContextAssetNode } from '../../../entities/index.js'
import { useRef } from 'react'
import { useTokenCounts } from '../../../shared/tokenizer/use-token-counts.js'
import { aggregateTokenCounts, collectTokenEntries } from './resource-token-counts.js'
import { useTokenDisplaySettings } from '../../../shared/tokenizer/settings.js'

export function useResourceTokenCounts(roots: readonly ContextAssetNode[], scope: string, overrideMultiplier?: number) {
  const displayMultiplier = useTokenDisplaySettings(state => state.multiplier)
  const multiplier = overrideMultiplier ?? displayMultiplier
  const previous = useRef<{ scope: string; multiplier: number; summary: ReturnType<typeof aggregateTokenCounts> } | undefined>(undefined)
  const entries = collectTokenEntries(roots)
  const result = useTokenCounts(entries.map(entry => entry.body), scope)
  // Never associate counts from an older draft with the new tree.
  const summary = !result.pending && result.counts
    ? aggregateTokenCounts(roots, new Map(entries.map((entry, index) => [entry.id, result.counts![index]!])), multiplier)
    : undefined
  if (summary) previous.current = { scope, multiplier, summary }
  return {
    ...result,
    summary,
    previousSummary: previous.current?.scope === scope && previous.current.multiplier === multiplier
      ? previous.current.summary : undefined,
  }
}
