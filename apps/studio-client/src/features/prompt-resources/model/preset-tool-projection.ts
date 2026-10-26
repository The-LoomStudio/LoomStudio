import type { AgentToolDefinition, ContextAssetNode, PresetToolMount } from '../../../entities/index.js'

type ProviderToolSurfaceItem = {
  description: string
  inputKind: AgentToolDefinition['input']['kind']
  name: string
  order: number
  toolId: string
}

export type PresetToolProjection = {
  unavailableMounts: PresetToolMount[]
  contentNodes: ContextAssetNode[]
  providerTools: ProviderToolSurfaceItem[]
  toolIdByNodeId: Map<string, string>
  zoneDefinitions: Array<{ id: string; displayName: string }>
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
    const anchor = item.mount.content?.targetAnchorId ?? '@chat.tools'
    const depth = item.mount.content?.localDepth ?? 0
    const key = JSON.stringify([anchor, depth])
    slots.set(key, [...(slots.get(key) ?? []), item])
  }

  const contentNodes: ContextAssetNode[] = []
  const toolIdByNodeId = new Map<string, string>()
  const zoneIds = new Set<string>()
  for (const [key, items] of slots) {
    const zoneId = items[0]!.mount.content?.targetAnchorId ?? '@chat.tools'
    const depth = items[0]!.mount.content?.localDepth ?? 0
    const slotKey = `${zoneId} · ${depth}`
    const sorted = [...items].sort((left, right) => (
      left.mount.orderIndex - right.mount.orderIndex
      || left.tool.name.localeCompare(right.tool.name)
    ))
    const first = sorted[0]!
    const nodeId = `preset-tool-slot:${encodeURIComponent(key)}`
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
        entryOrder: depth,
        lifecycle: 'preset-default',
        order: 'default',
        slotKey: `content-tool:${slotKey}@${zoneId}`,
        slotOrder: depth,
        sourceKind: 'virtual',
        zoneId,
      },
    })
  }

  return {
    unavailableMounts: input.mounts.filter(mount => mount.presetResourceId === input.presetId && !toolsById.has(mount.toolId)),
    contentNodes,
    providerTools,
    toolIdByNodeId,
    zoneDefinitions: [...zoneIds].map(id => ({
      id,
      displayName: id === '@chat.tools' ? 'Content Tools' : id,
    })),
  }
}

function emptyProjection(): PresetToolProjection {
  return {
    unavailableMounts: [],
    contentNodes: [],
    providerTools: [],
    toolIdByNodeId: new Map(),
    zoneDefinitions: [],
  }
}
