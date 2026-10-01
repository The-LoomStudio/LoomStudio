import type { AgentToolDefinition, PresetToolMount, PresetToolMountInput } from '../../../entities/index.js'

export function validPresetToolMounts(mounts: PresetToolMountInput[], tools: AgentToolDefinition[]): PresetToolMountInput[] {
  const structuredIds = new Set(tools.filter(tool => tool.input.kind === 'structured').map(tool => tool.id))
  return mounts.map(mount => {
    if (!structuredIds.has(mount.toolId) || mount.content === undefined) return mount
    const { content: _invalidContent, ...validMount } = mount
    return validMount
  })
}

export function togglePresetToolMount(mounts: PresetToolMount[], tool: AgentToolDefinition): PresetToolMountInput[] {
  const existing = mounts.find(mount => mount.toolId === tool.id)
  if (existing) {
    return mounts.map(mount => mount.toolId === tool.id
      ? { ...toPresetToolMountInput(mount), defaultEnabled: !mount.defaultEnabled }
      : toPresetToolMountInput(mount))
  }
  const nextOrder = Math.max(-1, ...mounts.map(mount => mount.orderIndex)) + 1
  return [...mounts.map(toPresetToolMountInput), createDefaultPresetToolMountInput(tool, nextOrder)]
}

export function createDefaultPresetToolMountInput(tool: AgentToolDefinition, orderIndex: number): PresetToolMountInput {
  return {
    toolId: tool.id,
    orderIndex,
    defaultEnabled: true,
    ...(tool.prompt?.activation ? { activation: structuredClone(tool.prompt.activation) } : {}),
    ...(tool.prompt?.provider ? { provider: { ...tool.prompt.provider } } : {}),
    ...(tool.input.kind === 'structured' || !tool.prompt?.content ? {} : { content: { ...tool.prompt.content } }),
  }
}

export function toPresetToolMountInput(mount: PresetToolMount): PresetToolMountInput {
  return {
    toolId: mount.toolId,
    orderIndex: mount.orderIndex,
    defaultEnabled: mount.defaultEnabled,
    ...(mount.activation ? { activation: structuredClone(mount.activation) } : {}),
    ...(mount.provider ? { provider: { ...mount.provider } } : {}),
    ...(mount.content ? { content: { ...mount.content } } : {}),
  }
}
