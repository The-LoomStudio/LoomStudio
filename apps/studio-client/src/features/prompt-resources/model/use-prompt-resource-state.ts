import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { PresetToolMount, PromptResource, SettingMount } from '../../../entities/index.js'
import type { StudioApi } from '../../../shared/api/studio-api.js'

type PromptResourceStateInput = {
  api: StudioApi
  endpoint: string
}

const EMPTY_PRESET_TOOL_MOUNTS: PresetToolMount[] = []
const EMPTY_PROMPT_RESOURCES: PromptResource[] = []
const EMPTY_SETTING_MOUNTS: SettingMount[] = []

export function usePromptResourceState(input: PromptResourceStateInput) {
  const queryClient = useQueryClient()
  const resourcesKey = ['prompt-resources', input.endpoint, 'resources'] as const
  const settingMountsKey = ['prompt-resources', input.endpoint, 'setting-mounts'] as const
  const presetToolMountsKey = ['prompt-resources', input.endpoint, 'preset-tool-mounts'] as const
  const resourcesQuery = useQuery({
    queryKey: resourcesKey,
    queryFn: async () => (await input.api.promptResources.list()).resources,
  })
  const settingMountsQuery = useQuery({
    queryKey: settingMountsKey,
    queryFn: async () => (await input.api.promptResources.listSettingMounts()).mounts,
  })
  const presetToolMountsQuery = useQuery({
    queryKey: presetToolMountsKey,
    queryFn: async () => (await input.api.promptResources.listPresetToolMounts()).mounts,
  })

  async function invalidate(areas: {
    presetToolMounts?: boolean
    resources?: boolean
    settingMounts?: boolean
  }): Promise<void> {
    const invalidations: Promise<unknown>[] = []
    if (areas.resources) invalidations.push(queryClient.invalidateQueries({ exact: true, queryKey: resourcesKey }))
    if (areas.settingMounts) invalidations.push(queryClient.invalidateQueries({ exact: true, queryKey: settingMountsKey }))
    if (areas.presetToolMounts) invalidations.push(queryClient.invalidateQueries({ exact: true, queryKey: presetToolMountsKey }))
    await Promise.all(invalidations)
  }

  return {
    error: resourcesQuery.error ?? settingMountsQuery.error ?? presetToolMountsQuery.error,
    loading: resourcesQuery.isPending || settingMountsQuery.isPending || presetToolMountsQuery.isPending,
    presetToolMounts: presetToolMountsQuery.data ?? EMPTY_PRESET_TOOL_MOUNTS,
    promptResources: resourcesQuery.data ?? EMPTY_PROMPT_RESOURCES,
    settingMounts: settingMountsQuery.data ?? EMPTY_SETTING_MOUNTS,
    invalidate,
    refreshPresetToolMounts: async () => readRefetchResult(await presetToolMountsQuery.refetch()),
    refreshPromptResourceLibrary: async () => readRefetchResult(await resourcesQuery.refetch()),
    refreshSettingMounts: async () => readRefetchResult(await settingMountsQuery.refetch()),
    setPresetToolMounts: (update: (current: PresetToolMount[]) => PresetToolMount[]) => {
      queryClient.setQueryData<PresetToolMount[]>(presetToolMountsKey, current => update(current ?? []))
    },
    setPromptResources: (update: (current: PromptResource[]) => PromptResource[]) => {
      queryClient.setQueryData<PromptResource[]>(resourcesKey, current => update(current ?? []))
    },
    setSettingMounts: (update: (current: SettingMount[]) => SettingMount[]) => {
      queryClient.setQueryData<SettingMount[]>(settingMountsKey, current => update(current ?? []))
    },
  }
}

function readRefetchResult<T>(result: { data?: T[]; error: Error | null }): T[] {
  if (result.error) throw result.error
  return result.data ?? []
}
