import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { canonicalMacroName, type MacroSelection, type MacroSelectionMap } from '@loom-studio/shared'
import type { StudioApi } from '../../../shared/api/studio-api.js'

const EMPTY_SELECTIONS: MacroSelectionMap = {}
type Config = Awaited<ReturnType<StudioApi['macros']['getConfig']>>['config']

export function useMacroSelection(input: {
  api: StudioApi['macros']
  cardId?: string
  endpoint: string
  presetId?: string
  timelineId?: string
}) {
  const client = useQueryClient()
  const [draft, setDraft] = useState({ key: '', values: EMPTY_SELECTIONS })

  function targetKey(timelineId?: string, _branchId?: string): string {
    return JSON.stringify([input.endpoint, timelineId ?? input.cardId, input.presetId])
  }

  const key = targetKey(input.timelineId)
  const queryKey = ['timeline-preset-macros', key] as const
  const persistent = Boolean(input.timelineId && input.presetId)
  const query = useQuery({
    queryKey,
    enabled: persistent,
    retry: false,
    retryOnMount: false,
    queryFn: async () => (await input.api.getConfig({ timelineId: input.timelineId!, presetId: input.presetId! })).config,
  })
  const mutation = useMutation({
    mutationKey: queryKey,
    retry: false,
    mutationFn: (change: {
      key: string
      api: StudioApi['macros']
      request: Parameters<StudioApi['macros']['updateConfig']>[0]
    }) => change.api.updateConfig(change.request),
    onSuccess: async ({ config }, change) => {
      const savedKey = ['timeline-preset-macros', change.key]
      await client.cancelQueries({ exact: true, queryKey: savedKey })
      client.setQueryData<Config>(savedKey, current => current && current.version > config.version ? current : config)
    },
  })
  const values = persistent ? query.data?.macroSelections ?? EMPTY_SELECTIONS
    : draft.key === key ? draft.values : EMPTY_SELECTIONS

  async function selectSource(requestKey: string, name: string, selection: MacroSelection | undefined): Promise<void> {
    if (requestKey !== key || client.isMutating({ exact: true, mutationKey: queryKey })) return
    const config = client.getQueryData<Config>(queryKey)
    if (persistent && (!config || query.isFetching || query.error)) return
    const next = { ...(persistent ? config!.macroSelections : values) }
    const canonical = canonicalMacroName(name)
    if (selection === undefined) delete next[canonical]
    else Object.defineProperty(next, canonical, { value: selection, enumerable: true, configurable: true, writable: true })
    if (!persistent) {
      setDraft({ key, values: next })
      return
    }
    try {
      await mutation.mutateAsync({
        key, api: input.api,
        request: { timelineId: input.timelineId!, presetId: input.presetId!, expectedVersion: config!.version, macroSelections: next },
      })
    } catch {
      // Mutation errors stay visible in the inspector; failed writes never replace committed choices.
    }
  }

  const error = query.error ?? (mutation.variables?.key === key ? mutation.error : null)
  return {
    // Timeline runs resolve persisted choices on the server, never from a stale UI cache.
    getSelections: (timelineId?: string, branchId?: string): MacroSelectionMap | undefined => timelineId
      ? undefined : key === targetKey(timelineId, branchId) ? values : EMPTY_SELECTIONS,
    readSelections: (requestKey: string) => requestKey === key ? values : EMPTY_SELECTIONS,
    selectSource,
    targetKey,
    loading: query.isFetching || (mutation.variables?.key === key && mutation.isPending),
    readError: (requestKey: string) => requestKey === key ? error?.message : undefined,
    refresh: async () => {
      mutation.reset()
      if (persistent) await query.refetch()
    },
  }
}
