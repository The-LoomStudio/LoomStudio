import type { ContextAssetNode, PromptResource, SettingMount } from '../../../entities/index.js'

const staticAnchors = new Set([
  '@preset.system', '@setting.stable', '@setting.lower', '@narrative.before',
  '@narrative.after', '@chat.session.post', '@prompt.tail',
])

export function buildPresetTokenProjection(input: {
  preset: PromptResource
  resources: PromptResource[]
  settingMounts: SettingMount[]
  timelinePromptResourceIds?: string[]
}) {
  const boundIds = new Set([
    ...input.settingMounts.filter(mount => mount.source.kind === 'manual').map(mount => mount.settingResourceId),
    ...(input.timelinePromptResourceIds ?? []),
  ])
  const settings = input.resources.filter(resource => boundIds.has(resource.id) && resource.resourceKind === 'setting')
  const incompleteIds = new Set<string>()
  const missing = [...boundIds].some(id => !input.resources.some(resource => resource.id === id))
  function project(node: ContextAssetNode): ContextAssetNode {
    const children = (node.children ?? []).map(project)
    let incomplete = children.some(child => incompleteIds.has(child.id))
    if (node.kind === 'virtual') {
      const anchorId = node.label.startsWith('@') ? node.label : node.capabilities?.targetAnchorId ?? node.label
      for (const resource of settings) {
        function select(source: ContextAssetNode): ContextAssetNode | undefined {
          if (source.kind === 'entry' && (source.capabilities?.targetAnchorId ?? '@setting.stable') !== anchorId) return undefined
          const nested = (source.children ?? []).map(select).filter((child): child is ContextAssetNode => child !== undefined)
          if (source.kind !== 'entry' && !nested.length) return undefined
          return { ...source, id: `${node.id}:${resource.id}:${source.id}`, children: nested }
        }
        const selected = select(resource.rootNode)
        if (selected) children.push(selected)
      }
      incomplete ||= missing || !staticAnchors.has(anchorId)
    }
    if (incomplete) incompleteIds.add(node.id)
    return { ...node, children }
  }
  return { root: project(input.preset.rootNode), incompleteIds }
}
