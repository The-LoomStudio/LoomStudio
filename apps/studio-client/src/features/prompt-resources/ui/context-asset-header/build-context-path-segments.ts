import type { ContextAssetNode } from '../../../../entities/index.js'
import { resolveVirtualDisplayName } from '../../model/context-asset-tree.js'
import type { ContextAssetPathSegment } from './context-asset-header.js'

export function buildContextPathSegments(
  pathNodes: ContextAssetNode[],
  onSelect: (id: string) => void,
): ContextAssetPathSegment[] {
  return pathNodes.slice(1).map((node, index) => ({
    id: node.id,
    label: resolveVirtualDisplayName(node.label, node.kind),
    options: (pathNodes[index]?.children ?? []).map(sibling => ({
      id: sibling.id,
      label: resolveVirtualDisplayName(sibling.label, sibling.kind),
    })),
    onSelect,
  }))
}
