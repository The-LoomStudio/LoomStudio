import type { AgentToolDefinition, ContextAssetNode, PresetToolMount } from '../../../entities/index.js'
import type { ProjectionZoneDefinition } from './projection-order.js'

export type ProviderToolSurfaceItem = {
  description: string
  inputKind: AgentToolDefinition['input']['kind']
  name: string
  order: number
  toolId: string
}

export type PresetToolProjection = {
  contentNodes: ContextAssetNode[]
  providerTools: ProviderToolSurfaceItem[]
  toolIdByNodeId: Map<string, string>
  zoneDefinitions: ProjectionZoneDefinition[]
}

export function buildPresetToolProjection(input: {
  mounts: PresetToolMount[]
  presetId?: string
  tools: AgentToolDefinition[]
}): PresetToolProjection {
  if (!input.presetId) return emptyProjection()

  const toolsById = new Map(input.tools.map(tool => [tool.id, tool]))
  const mounted = input.mounts
    .filter(mount => mount.presetResourceId === input.presetId && mount.defaultEnabled)
    .map(mount => ({ mount, tool: toolsById.get(mount.toolId) }))
    .filter((item): item is { mount: PresetToolMount; tool: AgentToolDefinition } => Boolean(item.tool))

  const providerTools = mounted
    .map(({ mount, tool }) => ({
      description: tool.description,
      inputKind: tool.input.kind,
      name: tool.name,
      order: mount.provider?.order ?? tool.prompt?.provider?.order ?? mount.orderIndex,
      toolId: tool.id,
    }))
    .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name))

  const slots = new Map<string, Array<{ mount: PresetToolMount; tool: AgentToolDefinition }>>()
  for (const item of mounted) {
    if (item.tool.input.kind === 'structured') continue
    const zone = item.mount.content?.zone ?? item.tool.prompt?.content?.zone ?? 'tools'
    const slot = item.mount.content?.slot ?? item.tool.prompt?.content?.slot ?? `${item.tool.owner.namespace}-tools`
    const key = `${zone}\u0000${slot}`
    slots.set(key, [...(slots.get(key) ?? []), item])
  }

  const contentNodes: ContextAssetNode[] = []
  const toolIdByNodeId = new Map<string, string>()
  const zoneIds = new Set<string>()
  for (const [key, items] of slots) {
    const [zoneId, slotKey] = key.split('\u0000') as [string, string]
    const sorted = [...items].sort((left, right) => (
      (left.mount.content?.orderHint ?? left.tool.prompt?.content?.orderHint ?? left.mount.orderIndex)
      - (right.mount.content?.orderHint ?? right.tool.prompt?.content?.orderHint ?? right.mount.orderIndex)
      || left.tool.name.localeCompare(right.tool.name)
    ))
    const first = sorted[0]!
    const nodeId = `preset-tool-slot:${encodeURIComponent(zoneId)}:${encodeURIComponent(slotKey)}`
    zoneIds.add(zoneId)
    toolIdByNodeId.set(nodeId, first.tool.id)
    contentNodes.push({
      body: sorted.map(item => item.tool.description).filter(Boolean).join('\n\n'),
      category: 'runtime',
      configRows: sorted.map(item => ({ label: item.tool.name, value: item.tool.input.kind })),
      id: nodeId,
      kind: 'virtual',
      label: slotKey,
      meta: sorted.map(item => item.tool.name).join(', '),
      readOnly: true,
      projection: {
        entryOrder: first.mount.content?.orderHint ?? first.tool.prompt?.content?.orderHint ?? first.mount.orderIndex,
        lifecycle: 'preset-default',
        order: first.mount.content?.rankKey ?? first.tool.prompt?.content?.rankKey ?? 'default',
        slotKey: `content-tool:${slotKey}@${zoneId}`,
        slotOrder: first.mount.content?.orderHint ?? first.tool.prompt?.content?.orderHint ?? first.mount.orderIndex,
        sourceKind: 'virtual',
        zoneId,
      },
    })
  }

  return {
    contentNodes,
    providerTools,
    toolIdByNodeId,
    zoneDefinitions: [...zoneIds].map(id => ({
      id,
      displayName: id === 'tools' ? 'Content Tools' : id,
    })),
  }
}

function emptyProjection(): PresetToolProjection {
  return {
    contentNodes: [],
    providerTools: [],
    toolIdByNodeId: new Map(),
    zoneDefinitions: [],
  }
}
