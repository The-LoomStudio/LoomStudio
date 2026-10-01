import type { ContextAssetNode, PromptResource } from '../../../entities/index.js'

// ponytail: Keep this classification aligned with default-preset.json until the template exposes its anchor IDs.
const defaultAnchorIds = new Set([
  '@chat.system', '@preset.system', '@chat.tools', '@runtime.skills',
  '@setting.stable', '@narrative.before', '@memory.narrative',
  '@chat.narrative', '@narrative.after', '@memory.session',
  '@chat.session', '@setting.lower', '@runtime.state',
  '@memory.recalled', '@chat.session.post', '@tools.dynamic',
  '@chat.input', '@prompt.tail', '@fresh.tail',
  '@runtime.workspace', '@runtime.notices',
])

export type PresetAnchorOption = {
  id: string
  label: string
  common: boolean
}

export function listPresetAnchorOptions(preset: PromptResource): PresetAnchorOption[] {
  const anchors = new Map<string, PresetAnchorOption>()

  function visit(node: ContextAssetNode) {
    if (node.kind === 'virtual') {
      const id = node.capabilities?.targetAnchorId ?? node.id
      if (!anchors.has(id)) anchors.set(id, { id, label: node.label, common: defaultAnchorIds.has(id) })
    }
    node.children?.forEach(visit)
  }

  visit(preset.rootNode)
  return [...anchors.values()]
}
