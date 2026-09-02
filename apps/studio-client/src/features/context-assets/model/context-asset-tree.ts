import type { ContextAssetNode } from '../../../entities/index.js'

type ContextAssetNodeInfo = {
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

export function findContextAssetPath(nodes: ContextAssetNode[] | undefined, id: string | undefined): ContextAssetNode[] {
  if (!nodes || !Array.isArray(nodes) || !id) return []

  for (const node of nodes) {
    if (!node) continue
    if (node.id === id) return [node]
    const childPath = findContextAssetPath(node.children ?? [], id)
    if (childPath.length > 0) return [node, ...childPath]
  }

  return []
}

export function resolveVirtualExtension(kind: ContextAssetNode['kind']): string | undefined {
  switch (kind) {
    case 'entry':
      return '.md'
    case 'script':
      return '.js'
    case 'order':
    case 'virtual':
      return '.json'
    case 'folder':
    case 'module':
      return undefined
    default:
      return undefined
  }
}

export function resolveVirtualPath(node: Pick<ContextAssetNode, 'label' | 'kind'>): string {
  const extension = resolveVirtualExtension(node.kind)
  const safeName = node.label.replace(/[^a-zA-Z0-9_.\-\u4e00-\u9fa5]/g, '_')
  
  if (extension && !safeName.toLowerCase().endsWith(extension)) {
    return `/${safeName}${extension}`
  }
  
  return `/${safeName}`
}

export function findContextAssetByVirtualPath(nodes: ContextAssetNode[], path: string): ContextAssetNode | undefined {
  for (const node of flattenContextAssetNodes(nodes)) {
    if (resolveVirtualPath(node) === path) return node
  }
  return undefined
}
