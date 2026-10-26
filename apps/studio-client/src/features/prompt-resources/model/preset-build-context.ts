import type { PromptResource, LoreMount } from '../../../entities/index.js'

type ResolvePresetBuildContextResourcesInput = {
  preset?: PromptResource
  resources: PromptResource[]
  loreMounts: LoreMount[]
  timelinePromptResourceIds?: string[]
}

export function resolvePresetBuildContextResources(
  input: ResolvePresetBuildContextResourcesInput,
): { resources: PromptResource[]; unavailableResourceIds: string[] } {
  const resourcesById = new Map(input.resources.map(resource => [resource.id, resource]))
  const resourceIds = [
    ...input.loreMounts
      .filter(mount => mount.source.kind === 'manual')
      .sort((left, right) => left.orderIndex - right.orderIndex || left.id.localeCompare(right.id))
      .map(mount => mount.loreResourceId),
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
    if (resource?.resourceKind === 'lore') resolved.push(resource)
  }

  for (const mount of input.loreMounts) {
    if (mount.source.kind !== 'preset' || mount.source.id !== input.preset?.id
      || seen.has(mount.loreResourceId) || resourcesById.has(mount.loreResourceId)) continue
    seen.add(mount.loreResourceId)
    unavailableResourceIds.push(mount.loreResourceId)
  }

  return { resources: resolved, unavailableResourceIds }
}
