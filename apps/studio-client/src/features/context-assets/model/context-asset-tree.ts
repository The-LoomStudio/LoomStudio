import type { ContextAssetNode } from '../../../entities/index.js'

export type ContextAssetNodeInfo = {
  category?: ContextAssetNode['category']
  node: ContextAssetNode
  parentId?: string
}

export function flattenContextAssetNodes(nodes: ContextAssetNode[]): ContextAssetNode[] {
  return nodes.flatMap(node => [node, ...flattenContextAssetNodes(node.children ?? [])])
}

export function findContextAssetNode(nodes: ContextAssetNode[], id: string | undefined): ContextAssetNode | undefined {
  if (!id) return undefined

  for (const node of nodes) {
    if (node.id === id) return node
    const child = findContextAssetNode(node.children ?? [], id)
    if (child) return child
  }

  return undefined
}

export function findContextAssetNodeInfo(
  nodes: ContextAssetNode[],
  id: string,
  parentId?: string,
  inheritedCategory?: ContextAssetNode['category'],
): ContextAssetNodeInfo | undefined {
  for (const node of nodes) {
    const category = node.category ?? inheritedCategory
    if (node.id === id) return { node, parentId, category }
    const child = findContextAssetNodeInfo(node.children ?? [], id, node.id, category)
    if (child) return child
  }

  return undefined
}
