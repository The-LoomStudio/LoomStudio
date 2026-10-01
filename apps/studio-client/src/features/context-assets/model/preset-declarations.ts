import type { ContextAssetNode, PromptResource, SettingMount } from '../../../entities/index.js'
import type { FileTreeNode } from '../../../shared/ui/file-tree/file-tree-model.js'

export type PresetDeclaration = {
  resource: PromptResource
  node: ContextAssetNode
  source: 'timeline' | 'global' | 'extension' | 'builtin'
  enabled: boolean
}

export function presetAnchorDeclarations(input: {
  anchor: ContextAssetNode
  presetId: string
  resources: PromptResource[]
  settingMounts: SettingMount[]
  timelinePromptResourceIds?: string[]
}): { nodes: FileTreeNode[]; targets: Map<string, PresetDeclaration> } {
  const anchorId = input.anchor.label.startsWith('@') ? input.anchor.label : (input.anchor.capabilities?.targetAnchorId ?? input.anchor.label)
  const resources = new Map(input.resources.map(resource => [resource.id, resource]))
  const ids = [
    ...input.settingMounts.filter(mount => mount.source.kind === 'manual').map(mount => mount.settingResourceId),
    ...(input.timelinePromptResourceIds ?? []),
  ]
  const targets = new Map<string, PresetDeclaration>()
  const groups = new Map<PresetDeclaration['source'], FileTreeNode[]>()
  for (const id of new Set(ids)) {
    if (id === input.presetId) continue
    const resource = resources.get(id)
    if (!resource || resource.resourceKind !== 'setting') continue
    const settingResource = resource
    const source = resource.origin?.kind === 'extension-package' ? 'extension'
      : resource.origin?.kind === 'builtin' ? 'builtin'
        : input.timelinePromptResourceIds?.includes(id) ? 'timeline' : 'global'
    function collect(nodes: ContextAssetNode[], parentEnabled = true): FileTreeNode[] {
      return nodes.flatMap(node => {
        const enabled = parentEnabled && node.enabled !== false
        if (node.kind === 'entry') {
          if ((node.capabilities?.targetAnchorId ?? '@setting.stable') !== anchorId) return []
          const key = `${id}:${node.id}`
          targets.set(key, { resource: settingResource, node, source, enabled })
          return [{ id: key, label: node.label }]
        }
        const children = collect(node.children ?? [], enabled)
        return children.length ? [{ id: `${id}:${node.id}`, label: node.label, children }] : []
      })
    }
    const children = collect(resource.rootNode.children ?? [])
    if (!children.length) continue
    const list = groups.get(source) ?? []
    list.push({ id: `resource:${id}`, label: resource.rootNode.label, children })
    groups.set(source, list)
  }
  return { nodes: [...groups].map(([source, children]) => ({ id: `source:${source}`, label: source, children })), targets }
}
