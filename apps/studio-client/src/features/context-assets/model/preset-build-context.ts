import type { PromptResource, SettingMount } from '../../../entities/index.js'

type ResolvePresetBuildContextResourcesInput = {
  preset?: PromptResource
  resources: PromptResource[]
  settingMounts: SettingMount[]
  timelinePromptResourceIds?: string[]
}

export function resolvePresetBuildContextResources(
  input: ResolvePresetBuildContextResourcesInput,
): { resources: PromptResource[]; unavailableResourceIds: string[] } {
  const resourcesById = new Map(input.resources.map(resource => [resource.id, resource]))
  const resourceIds = [
    ...input.settingMounts
      .filter(mount => mount.source.kind === 'manual')
      .sort((left, right) => left.orderIndex - right.orderIndex || left.id.localeCompare(right.id))
      .map(mount => mount.settingResourceId),
    ...(input.timelinePromptResourceIds ?? []),
  ]
  const seen = new Set<string>()
  const resolved: PromptResource[] = []
  const unavailableResourceIds: string[] = []

  for (const resourceId of resourceIds) {
    if (resourceId === input.preset?.id || seen.has(resourceId)) continue
    seen.add(resourceId)

    const resource = resourcesById.get(resourceId)
    if (!resource) unavailableResourceIds.push(resourceId)
    if (resource?.resourceKind === 'setting') resolved.push(resource)
  }

  for (const mount of input.settingMounts) {
    if (mount.source.kind !== 'preset' || mount.source.id !== input.preset?.id
      || seen.has(mount.settingResourceId) || resourcesById.has(mount.settingResourceId)) continue
    seen.add(mount.settingResourceId)
    unavailableResourceIds.push(mount.settingResourceId)
  }

  return { resources: resolved, unavailableResourceIds }
}
