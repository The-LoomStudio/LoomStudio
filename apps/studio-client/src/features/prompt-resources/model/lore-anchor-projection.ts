import type { ContextAssetNode } from '../../../entities/index.js'

export type LoreAnchorEntry = {
  node: ContextAssetNode
  path: string
  enabled: boolean
  conditional: boolean
}

/** Navigation groups follow first appearance; only order inside each group describes injection. */
export function groupLoreByAnchor(root: ContextAssetNode) {
  const groups = new Map<string | undefined, LoreAnchorEntry[]>()
  function visit(node: ContextAssetNode, parents: string[], parentEnabled: boolean, parentConditional: boolean) {
    const enabled = parentEnabled && node.enabled !== false
    const conditional = parentConditional || Boolean(node.capabilities?.activation && node.capabilities.activation.kind !== 'always')
    const path = [...parents, node.label]
    if (node.kind === 'entry') {
      const anchorId = node.capabilities?.targetAnchorId || undefined
      const entries = groups.get(anchorId) ?? []
      entries.push({ node, path: path.join(' / '), enabled, conditional })
      groups.set(anchorId, entries)
    }
    node.children?.forEach(child => visit(child, path, enabled, conditional))
  }
  visit(root, [], true, false)
  return [...groups].map(([anchorId, entries]) => ({ anchorId, entries }))
}
