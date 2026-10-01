import type { Card, ContextAssetNode, PromptResource } from '../../entities/index.js'
import type { FileTreeNode } from '../../shared/ui/file-tree/file-tree-model.js'

export type CardResourceFolder = 'settings' | 'agents' | 'references' | 'rules' | 'scripts' | 'macros' | 'state' | 'extensions' | 'attachments'
export type CardResourceLocation = { folder?: CardResourceFolder; item?: string; nodeId?: string }
export type CardResourceEntry = { id: string; label: string; children?: CardResourceEntry[] }
export type CardResourceGroup = { key: CardResourceFolder; label: string; entries: CardResourceEntry[] }

export function classifyCardPromptResources(card: Card | undefined, resources: PromptResource[]) {
  const byId = new Map(resources.map(resource => [resource.id, resource]))
  const bound = (card?.promptResourceIds ?? []).map(id => byId.get(id)).filter((item): item is PromptResource => Boolean(item))
  const externalIds = new Set(card?.externalPromptResourceIds ?? [])
  return {
    ownedSettings: bound.filter(resource => resource.resourceKind === 'setting' && !externalIds.has(resource.id)
      && resource.origin?.kind !== 'extension-package' && Boolean(resource.sourceArtifactRef)),
    ownedPresets: bound.filter(resource => resource.resourceKind === 'preset' && !externalIds.has(resource.id)
      && resource.origin?.kind !== 'extension-package' && Boolean(resource.sourceArtifactRef)),
    references: bound.filter(resource => externalIds.has(resource.id) || (!resource.sourceArtifactRef && !resource.origin)),
    extensionResources: bound.filter(resource => resource.origin?.kind === 'extension-package'),
  }
}

export function buildCardResourceTree(groups: CardResourceGroup[], promptRoots: Map<string, ContextAssetNode>) {
  const targets = new Map<string, CardResourceLocation>()
  const promptNode = (group: CardResourceFolder, ownerId: string, asset: ContextAssetNode): FileTreeNode => {
    const id = `${group}:${ownerId}:${asset.id}`
    targets.set(id, { folder: group, item: ownerId, nodeId: asset.id })
    return {
      id, label: asset.label, kind: asset.children?.length ? 'folder' : 'entry',
      ...(asset.children?.length ? { children: asset.children.map(child => promptNode(group, ownerId, child)) } : {}),
    }
  }
  const entryNode = (group: CardResourceFolder, entry: CardResourceEntry): FileTreeNode => {
    const root = promptRoots.get(entry.id)
    if (root) return promptNode(group, entry.id, root)
    const id = `${group}:${entry.id}`
    targets.set(id, { folder: group, item: entry.id })
    return {
      id, label: entry.label, kind: entry.children?.length ? 'folder' : 'entry',
      ...(entry.children?.length ? { children: entry.children.map(child => entryNode(group, child)) } : {}),
    }
  }
  const nodes: FileTreeNode[] = groups.filter(group => group.entries.length).map(group => ({
    id: group.key, label: group.label, kind: 'folder', meta: String(group.entries.length),
    children: group.entries.map(entry => entryNode(group.key, entry)),
  }))
  return { nodes, targets }
}

export function readCardSettingTarget(
  treeId: string,
  targets: Map<string, CardResourceLocation>,
  resources: readonly PromptResource[],
): { resource: PromptResource; nodeId: string } | undefined {
  const target = targets.get(treeId)
  if (!target?.nodeId) return undefined
  const id = target.item?.startsWith('resource:') ? target.item.slice(9) : target.item
  const resource = resources.find(item => item.id === id && item.resourceKind === 'setting')
  return resource ? { resource, nodeId: target.nodeId } : undefined
}
