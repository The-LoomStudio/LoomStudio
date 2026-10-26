import type { ContextAssetNode, PromptResource, LoreMount } from '../../../entities/index.js'

const staticAnchors = new Set([
  '@preset.system', '@lore.stable', '@lore.lower', '@narrative.before',
  '@narrative.after', '@chat.session.post', '@prompt.tail',
])

export function buildPresetTokenProjection(input: {
  preset: PromptResource
  resources: PromptResource[]
  loreMounts: LoreMount[]
  timelinePromptResourceIds?: string[]
}) {
  const boundIds = new Set([
    ...input.loreMounts.filter(mount => mount.source.kind === 'manual').map(mount => mount.loreResourceId),
    ...(input.timelinePromptResourceIds ?? []),
  ])
  const loreResources = input.resources.filter(resource => boundIds.has(resource.id) && resource.resourceKind === 'lore')
  const incompleteIds = new Set<string>()
  const missing = [...boundIds].some(id => !input.resources.some(resource => resource.id === id))
  function project(node: ContextAssetNode): ContextAssetNode {
    const children = (node.children ?? []).map(project)
    let incomplete = children.some(child => incompleteIds.has(child.id))
    if (node.kind === 'virtual') {
      const anchorId = node.capabilities?.targetAnchorId || (node.label.startsWith('@') ? node.label : node.label)
      for (const resource of loreResources) {
        function select(source: ContextAssetNode): ContextAssetNode | undefined {
          if (source.kind === 'entry' && (source.capabilities?.targetAnchorId ?? '@lore.stable') !== anchorId) return undefined
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
