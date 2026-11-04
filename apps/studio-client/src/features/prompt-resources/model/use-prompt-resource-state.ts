import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ListPromptResourcesResult, ListExtensionInstallationsResult, PresetToolMount, PromptResource, LoreMount } from '../../../entities/index.js'
import type { StudioApi } from '../../../shared/api/studio-api.js'

type PromptResourceStateInput = {
  api: StudioApi
  endpoint: string
}

const EMPTY_INVALID_RESOURCES: NonNullable<ListPromptResourcesResult['invalidResources']> = []
const EMPTY_PRESET_TOOL_MOUNTS: PresetToolMount[] = []
const EMPTY_PROMPT_RESOURCES: PromptResource[] = []
const EMPTY_LORE_MOUNTS: LoreMount[] = []
const EMPTY_INSTALLATIONS: ListExtensionInstallationsResult['installations'] = []

export function usePromptResourceState(input: PromptResourceStateInput) {
  const queryClient = useQueryClient()
  const resourcesKey = ['prompt-resources', input.endpoint, 'resources'] as const
  const installationsKey = ['prompt-resources', input.endpoint, 'installations'] as const
  const installationsQuery = useQuery({
    queryKey: installationsKey,
    queryFn: async () => (await input.api.extensionInstallations.list()).installations,
  })
  const loreMountsKey = ['prompt-resources', input.endpoint, 'lore-mounts'] as const
  const presetToolMountsKey = ['prompt-resources', input.endpoint, 'preset-tool-mounts'] as const
  const resourcesQuery = useQuery({
    queryKey: resourcesKey,
    retry: false,
    queryFn: ({ signal }) => input.api.promptResources.list(undefined, signal),
  })
  const loreMountsQuery = useQuery({
    queryKey: loreMountsKey,
    queryFn: async () => (await input.api.promptResources.listLoreMounts()).mounts,
  })
  const presetToolMountsQuery = useQuery({
    queryKey: presetToolMountsKey,
    queryFn: async () => (await input.api.promptResources.listPresetToolMounts()).mounts,
  })

  async function invalidate(areas: {
    bindings?: boolean
    presetToolMounts?: boolean
    resources?: boolean
    loreMounts?: boolean
  }): Promise<void> {
    const invalidations: Promise<unknown>[] = []
    if (areas.bindings || areas.resources || areas.loreMounts) {
      invalidations.push(queryClient.invalidateQueries({ queryKey: ['prompt-resources', input.endpoint, 'bindings'] }))
      invalidations.push(queryClient.invalidateQueries({ queryKey: ['global-search', input.endpoint] }))
    }
    if (areas.resources) invalidations.push(
      queryClient.invalidateQueries({ exact: true, queryKey: resourcesKey }),
      queryClient.invalidateQueries({ exact: true, queryKey: installationsKey }),
    )
    if (areas.loreMounts) invalidations.push(queryClient.invalidateQueries({ exact: true, queryKey: loreMountsKey }))
    if (areas.presetToolMounts) invalidations.push(queryClient.invalidateQueries({ exact: true, queryKey: presetToolMountsKey }))
    await Promise.all(invalidations)
  }

  return {
    error: resourcesQuery.error ?? installationsQuery.error ?? loreMountsQuery.error ?? presetToolMountsQuery.error,
    loading: resourcesQuery.isPending || installationsQuery.isPending || loreMountsQuery.isPending || presetToolMountsQuery.isPending,
    resourcesReady: resourcesQuery.isSuccess,
    resourcesError: resourcesQuery.error,
    readResources: () => queryClient.getQueryData<ListPromptResourcesResult>(resourcesKey)?.resources ?? EMPTY_PROMPT_RESOURCES,
    extensionInstallations: installationsQuery.data ?? EMPTY_INSTALLATIONS,
    presetToolMounts: presetToolMountsQuery.data ?? EMPTY_PRESET_TOOL_MOUNTS,
    promptResources: resourcesQuery.data?.resources ?? EMPTY_PROMPT_RESOURCES,
    invalidPromptResources: resourcesQuery.data?.invalidResources ?? EMPTY_INVALID_RESOURCES,
    loreMounts: loreMountsQuery.data ?? EMPTY_LORE_MOUNTS,
    invalidate,
    refreshPresetToolMounts: async () => readRefetchResult(await presetToolMountsQuery.refetch()),
    refreshPromptResourceLibrary: async () => {
      const [resources, installations] = await Promise.all([resourcesQuery.refetch(), installationsQuery.refetch()])
      readRefetchResult(installations)
      await invalidate({ bindings: true })
      if (resources.error) throw resources.error
      return resources.data?.resources ?? EMPTY_PROMPT_RESOURCES
    },
    refreshPromptResource: async (resourceId: string) => {
      const wasListed = queryClient.getQueryData<ListPromptResourcesResult>(resourcesKey)?.resources.some(item => item.id === resourceId)
      const { resource } = await input.api.promptResources.get(resourceId)
      void queryClient.cancelQueries({ exact: true, queryKey: resourcesKey })
      queryClient.setQueryData<ListPromptResourcesResult>(resourcesKey, current => ({
        resources: current?.resources.some(item => item.id === resource.id)
          ? current.resources.map(item => item.id === resource.id && item.version <= resource.version ? resource : item)
          : wasListed ? current?.resources ?? [] : [...(current?.resources ?? []), resource],
        invalidResources: current?.invalidResources?.filter(item => item.id !== resource.id),
      }))
      return queryClient.getQueryData<ListPromptResourcesResult>(resourcesKey)?.resources.find(item => item.id === resourceId)
    },
    refreshLoreMounts: async () => {
      const mounts = readRefetchResult(await loreMountsQuery.refetch())
      await queryClient.invalidateQueries({ queryKey: ['global-search', input.endpoint] })
      return mounts
    },
    setPresetToolMounts: (update: (current: PresetToolMount[]) => PresetToolMount[]) => {
      void queryClient.cancelQueries({ exact: true, queryKey: presetToolMountsKey })
      queryClient.setQueryData<PresetToolMount[]>(presetToolMountsKey, current => update(current ?? []))
    },
    setPromptResources: (update: (current: PromptResource[]) => PromptResource[]) => {
      void queryClient.cancelQueries({ exact: true, queryKey: resourcesKey })
      queryClient.setQueryData<ListPromptResourcesResult>(resourcesKey, current => ({ ...current, resources: update(current?.resources ?? []) }))
      void queryClient.invalidateQueries({ queryKey: ['global-search', input.endpoint] })
    },
    setLoreMounts: (update: (current: LoreMount[]) => LoreMount[]) => {
      void queryClient.cancelQueries({ exact: true, queryKey: loreMountsKey })
      queryClient.setQueryData<LoreMount[]>(loreMountsKey, current => update(current ?? []))
      void queryClient.invalidateQueries({ queryKey: ['global-search', input.endpoint] })
    },
  }
}

function readRefetchResult<T>(result: { data?: T[]; error: Error | null }): T[] {
  if (result.error) throw result.error
  return result.data ?? []
}
