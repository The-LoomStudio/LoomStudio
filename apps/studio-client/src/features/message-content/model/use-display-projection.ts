import { useMemo } from 'react'
import { hashKey, useQuery } from '@tanstack/react-query'
import type { HistoryProjectionSnapshot, HistorySource } from '../../../entities/index.js'
import type { StudioApi } from '../../../shared/api/studio-api.js'

export type DisplayProjection = {
  entries: Map<string, HistoryProjectionSnapshot['entries'][number]>
  pending: boolean
  refreshing?: boolean
  error?: string
  warning?: string
  retry?(): void
}

export type OpeningDisplayProjection = {
  text?: string
  pending: boolean
  error?: string
  warning?: string
  retry(): void
}

export function useOpeningDisplayProjection(input: {
  api: StudioApi['textTransforms']
  endpoint: string
  opening?: { cardId: string; presetId?: string; text: string }
  refreshToken: number
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
    warning: query.data?.diagnostics.map(item => item.message).join('\n') || undefined,
    retry: () => { void query.refetch() },
  }
}

export function useDisplayProjection(input: {
  api: StudioApi['textTransforms']
  endpoint: string
  source?: HistorySource
  consumerAgentSessionId?: string
  entries: Array<{ id: string; text: string }>
  revision: unknown
  refreshToken: number
}): DisplayProjection | undefined {
  const queryKey = ['message-display', {
    endpoint: input.endpoint, source: input.source,
    consumerAgentSessionId: input.consumerAgentSessionId, revision: input.revision,
  }, input.entries, input.refreshToken]
  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const { snapshot } = await input.api.project({
        source: input.source!,
        phase: 'display',
        entryIds: input.entries.map(entry => entry.id),
        ...(input.consumerAgentSessionId ? { consumerAgentSessionId: input.consumerAgentSessionId } : {}),
      })
      const byId = new Map(snapshot.entries.map(entry => [entry.id, entry]))
      const unmatched = input.entries.find(entry => byId.get(entry.id)?.originalText !== entry.text)
      if (unmatched) throw new Error(`Display projection does not contain the current message: ${unmatched.id}`)
      return snapshot
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
    warning: query.data?.diagnostics.length ? query.data.diagnostics.map(item => item.message).join('\n') : undefined,
  }
}

export function displayText(projection: DisplayProjection | undefined, id: string, raw: string, streaming = false): string | undefined {
  if (!projection || streaming) return raw
  if (projection.pending || projection.error) return undefined
  const entry = projection.entries.get(id)
  // A stale response must not overwrite edited text, even if the entry ID survived.
  return entry?.originalText === raw ? entry.text : undefined
}

export function isTransientAgentEntryId(id: string): boolean {
  return id.startsWith('optimistic-agent-entry-') || id.startsWith('streaming-agent-entry-')
}
