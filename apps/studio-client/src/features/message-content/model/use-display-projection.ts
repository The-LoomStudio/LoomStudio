import { useEffect, useMemo, useRef, useState } from 'react'
import { hashKey, useQuery } from '@tanstack/react-query'
import type { HistoryProjectionSnapshot, HistorySource } from '../../../entities/index.js'
import type { StudioApi } from '../../../shared/api/studio-api.js'

export type DisplayProjection = {
  entries: Map<string, HistoryProjectionSnapshot['entries'][number]>
  pending: boolean
  refreshing?: boolean
  error?: string
  warning?: string
  diagnostics?: HistoryProjectionSnapshot['diagnostics']
  inspect?(): void
  retry?(): void
}

export type OpeningDisplayProjection = {
  text?: string
  pending: boolean
  error?: string
  warning?: string
  diagnostics?: HistoryProjectionSnapshot['diagnostics']
  inspect?(): void
  retry(): void
}

export function useOpeningDisplayProjection(input: {
  api: StudioApi['textTransforms']
  endpoint: string
  opening?: { cardId: string; presetId?: string; text: string }
  refreshToken: number
  onInspect?(diagnostics: HistoryProjectionSnapshot['diagnostics']): void
}): OpeningDisplayProjection | undefined {
  const queryKey = ['opening-display', input.endpoint, input.opening, input.refreshToken]
  const query = useQuery({
    queryKey,
    enabled: Boolean(input.opening),
    queryFn: async () => {
      const result = await input.api.previewCardOpening(input.opening!)
      if (result.originalText !== input.opening!.text) throw new Error('Opening preview does not match the current text')
      return result
    },
    placeholderData: (previous, previousQuery) => previousQuery
      && hashKey(previousQuery.queryKey.slice(0, 3)) === hashKey(queryKey.slice(0, 3)) ? previous : undefined,
    retry: false,
    retryOnMount: false,
    gcTime: 0,
  })
  if (!input.opening) return undefined
  return {
    text: query.error ? undefined : query.data?.text,
    pending: query.isPending,
    error: query.error?.message,
    diagnostics: query.data?.diagnostics,
    inspect: input.onInspect ? () => input.onInspect!(query.data?.diagnostics ?? []) : undefined,
    warning: query.data?.diagnostics.map(item => item.message).join('\n') || undefined,
    retry: () => { void query.refetch() },
  }
}

export function useDisplayProjection(input: {
  api: StudioApi['textTransforms']
  endpoint: string
  source?: HistorySource
  consumerAgentSessionId?: string
  entries: Array<{ id: string; text: string; streaming?: boolean; role?: 'user' | 'assistant' }>
  revision: unknown
  refreshToken: number
  onInspect?(diagnostics: HistoryProjectionSnapshot['diagnostics']): void
}): DisplayProjection | undefined {
  // Bound streaming projection requests without waiting for a quiet period.
  // A completed snapshot and scope changes bypass the cadence immediately.
  const scopeKey = hashKey([input.endpoint, input.source, input.consumerAgentSessionId, input.revision, input.refreshToken])
  const entriesKey = hashKey(input.entries)
  const latest = useRef(input.entries)
  latest.current = input.entries
  const lastIssued = useRef(0)
  const [sample, setSample] = useState({ scopeKey, entries: input.entries })
  const isStreaming = input.entries.some(entry => entry.streaming)
  useEffect(() => {
    if (!isStreaming) return
    const timer = setTimeout(() => {
      lastIssued.current = Date.now()
      setSample({ scopeKey, entries: latest.current })
    }, Math.max(0, 100 - (Date.now() - lastIssued.current)))
    return () => clearTimeout(timer)
  }, [scopeKey, entriesKey, isStreaming])
  const projectionEntries = isStreaming && sample.scopeKey === scopeKey ? sample.entries : input.entries
  const queryKey = ['message-display', {
    endpoint: input.endpoint, source: input.source,
    consumerAgentSessionId: input.consumerAgentSessionId, revision: input.revision,
  }, projectionEntries, input.refreshToken]
  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const { snapshot } = await input.api.project({
        source: input.source!,
        phase: 'display',
        entryIds: projectionEntries.map(entry => entry.id),
        ...(projectionEntries.some(entry => entry.streaming) ? { streamingEntries: projectionEntries.filter(entry => entry.streaming).map(({ id, text, role }) => ({ id, text, role })) } : {}),
        ...(input.consumerAgentSessionId ? { consumerAgentSessionId: input.consumerAgentSessionId } : {}),
      })
      const byId = new Map(snapshot.entries.map(entry => [entry.id, entry]))
      const unmatched = projectionEntries.filter(entry => byId.get(entry.id)?.originalText !== entry.text)
      if (!unmatched.length) return snapshot
      const invalidIds = new Set(unmatched.map(entry => entry.id))
      return { ...snapshot,
        entries: snapshot.entries.filter(entry => !invalidIds.has(entry.id)),
        matches: snapshot.matches.filter(match => !invalidIds.has(match.entryId)),
        diagnostics: [...snapshot.diagnostics, ...unmatched.map(entry => ({
          code: 'display.entry.stale', entryId: entry.id, message: `Display projection does not contain the current message: ${entry.id}`,
        }))],
      }
    },
    enabled: Boolean(input.source),
    // Keep unchanged iframe instances during same-source recomputation. Never
    // carry a previous endpoint, branch, consumer, or preset into another scope.
    placeholderData: (previous, previousQuery) => previousQuery
      && hashKey(previousQuery.queryKey.slice(0, 2)) === hashKey(queryKey.slice(0, 2)) ? previous : undefined,
    retry: false,
    retryOnMount: false,
    gcTime: 0,
  })
  const entries = useMemo(() => new Map(query.data?.entries.map(entry => [entry.id, entry])), [query.data])
  if (!input.source) return undefined
  return {
    entries,
    pending: query.isPending,
    refreshing: query.isFetching,
    retry: () => { void query.refetch() },
    error: query.error?.message,
    diagnostics: query.data?.diagnostics,
    inspect: input.onInspect ? () => input.onInspect!(query.data?.diagnostics ?? []) : undefined,
    warning: query.data?.diagnostics.length ? query.data.diagnostics.map(item => item.message).join('\n') : undefined,
  }
}

export function displayText(projection: DisplayProjection | undefined, id: string, raw: string, streaming = false): string | undefined {
  if (!projection) return raw
  if (projection.pending || projection.error) return streaming ? raw : undefined
  const entry = projection.entries.get(id)
  // Completed/edited messages require exact input identity. During a live stream,
  // retain the last projected snapshot until the next one arrives instead of flashing raw HTML.
  return entry?.originalText === raw || streaming && entry ? entry!.text : streaming ? raw : undefined
}

export function isTransientAgentEntryId(id: string): boolean {
  return id.startsWith('optimistic-agent-entry-') || id.startsWith('streaming-agent-entry-')
}
