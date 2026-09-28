import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ListExtensionInstallationsResult, PresetToolMount, PromptResource, SettingMount } from '../../../entities/index.js'
import type { StudioApi } from '../../../shared/api/studio-api.js'

type PromptResourceStateInput = {
  api: StudioApi
  endpoint: string
}

const EMPTY_PRESET_TOOL_MOUNTS: PresetToolMount[] = []
const EMPTY_PROMPT_RESOURCES: PromptResource[] = []
const EMPTY_SETTING_MOUNTS: SettingMount[] = []
const EMPTY_INSTALLATIONS: ListExtensionInstallationsResult['installations'] = []

export function usePromptResourceState(input: PromptResourceStateInput) {
  const queryClient = useQueryClient()
  const resourcesKey = ['prompt-resources', input.endpoint, 'resources'] as const
  const installationsKey = ['prompt-resources', input.endpoint, 'installations'] as const
  const installationsQuery = useQuery({
    queryKey: installationsKey,
    queryFn: async () => (await input.api.extensionInstallations.list()).installations,
  })
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
    bindings?: boolean
    presetToolMounts?: boolean
    resources?: boolean
    settingMounts?: boolean
  }): Promise<void> {
    const invalidations: Promise<unknown>[] = []
    if (areas.bindings || areas.resources || areas.settingMounts) {
      invalidations.push(queryClient.invalidateQueries({ queryKey: ['prompt-resources', input.endpoint, 'bindings'] }))
    }
    if (areas.resources) invalidations.push(
      queryClient.invalidateQueries({ exact: true, queryKey: resourcesKey }),
      queryClient.invalidateQueries({ exact: true, queryKey: installationsKey }),
    )
    if (areas.settingMounts) invalidations.push(queryClient.invalidateQueries({ exact: true, queryKey: settingMountsKey }))
    if (areas.presetToolMounts) invalidations.push(queryClient.invalidateQueries({ exact: true, queryKey: presetToolMountsKey }))
    await Promise.all(invalidations)
  }

  return {
    error: resourcesQuery.error ?? installationsQuery.error ?? settingMountsQuery.error ?? presetToolMountsQuery.error,
    loading: resourcesQuery.isPending || installationsQuery.isPending || settingMountsQuery.isPending || presetToolMountsQuery.isPending,
    extensionInstallations: installationsQuery.data ?? EMPTY_INSTALLATIONS,
    presetToolMounts: presetToolMountsQuery.data ?? EMPTY_PRESET_TOOL_MOUNTS,
    promptResources: resourcesQuery.data ?? EMPTY_PROMPT_RESOURCES,
    settingMounts: settingMountsQuery.data ?? EMPTY_SETTING_MOUNTS,
    invalidate,
    refreshPresetToolMounts: async () => readRefetchResult(await presetToolMountsQuery.refetch()),
    refreshPromptResourceLibrary: async () => {
      const [resources, installations] = await Promise.all([resourcesQuery.refetch(), installationsQuery.refetch()])
      readRefetchResult(installations)
      await queryClient.invalidateQueries({ queryKey: ['prompt-resources', input.endpoint, 'bindings'] })
      return readRefetchResult(resources)
    },
    refreshPromptResource: async (resourceId: string) => {
      const { resource } = await input.api.promptResources.get(resourceId)
      void queryClient.cancelQueries({ exact: true, queryKey: resourcesKey })
      queryClient.setQueryData<PromptResource[]>(resourcesKey, current => (current ?? []).map(item =>
        item.id === resource.id && item.version <= resource.version ? resource : item,
      ))
      return queryClient.getQueryData<PromptResource[]>(resourcesKey)?.find(item => item.id === resourceId)
    },
    refreshSettingMounts: async () => readRefetchResult(await settingMountsQuery.refetch()),
    setPresetToolMounts: (update: (current: PresetToolMount[]) => PresetToolMount[]) => {
      void queryClient.cancelQueries({ exact: true, queryKey: presetToolMountsKey })
      queryClient.setQueryData<PresetToolMount[]>(presetToolMountsKey, current => update(current ?? []))
    },
    setPromptResources: (update: (current: PromptResource[]) => PromptResource[]) => {
      void queryClient.cancelQueries({ exact: true, queryKey: resourcesKey })
      queryClient.setQueryData<PromptResource[]>(resourcesKey, current => update(current ?? []))
    },
    setSettingMounts: (update: (current: SettingMount[]) => SettingMount[]) => {
      void queryClient.cancelQueries({ exact: true, queryKey: settingMountsKey })
      queryClient.setQueryData<SettingMount[]>(settingMountsKey, current => update(current ?? []))
    },
  }
}

function readRefetchResult<T>(result: { data?: T[]; error: Error | null }): T[] {
  if (result.error) throw result.error
  return result.data ?? []
}
