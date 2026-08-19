import type { PromptResource } from '../../../entities/index.js'

type ResolvePresetBuildContextResourcesInput = {
  preset?: PromptResource
  resources: PromptResource[]
  timelinePromptResourceIds?: string[]
}

export function resolvePresetBuildContextResources(
  input: ResolvePresetBuildContextResourcesInput,
): PromptResource[] {
  const resourcesById = new Map(input.resources.map(resource => [resource.id, resource]))
  const resourceIds = [
    ...(input.preset?.linkedSettingIds ?? []),
    ...(input.timelinePromptResourceIds ?? []),
  ]
  const seen = new Set<string>()
  const resolved: PromptResource[] = []

  for (const resourceId of resourceIds) {
    if (resourceId === input.preset?.id || seen.has(resourceId)) continue
    seen.add(resourceId)

    const resource = resourcesById.get(resourceId)
    if (resource?.resourceKind === 'setting') resolved.push(resource)
  }

  return resolved
}
