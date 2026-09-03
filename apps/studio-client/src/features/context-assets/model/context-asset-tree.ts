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
    case 'virtual':
    case 'folder':
    case 'module':
    case 'message':
    case 'slot':
      return undefined
    default:
      return undefined
  }
}

export function resolveVirtualDisplayName(label: string, kind: ContextAssetNode['kind'] | string | undefined): string {
  const extension = resolveVirtualExtension(kind as ContextAssetNode['kind'])
  if (!extension) return label
  if (label.toLowerCase().endsWith(extension.toLowerCase())) return label
  return `${label}${extension}`
}

export function resolveVirtualPath(node: Pick<ContextAssetNode, 'label' | 'kind'>): string {
  const extension = resolveVirtualExtension(node.kind)
  const safeName = node.label.replace(/[^a-zA-Z0-9_.\-\u4e00-\u9fa5]/g, '_')
  
  if (extension && !safeName.toLowerCase().endsWith(extension)) {
    return `/${safeName}${extension}`
  }
  
  return `/${safeName}`
}

export function resolveContextAssetUri(node: ContextAssetNode, pathNodes?: ContextAssetNode[]): string {
  if (!pathNodes || pathNodes.length === 0) {
    const virtualName = resolveVirtualDisplayName(node.label, node.kind)
    return `@/${virtualName}`
  }

  const anchorIdx = pathNodes.findIndex(item => item.label.startsWith('@'))
  if (anchorIdx !== -1) {
    const relevant = pathNodes.slice(anchorIdx)
    const segments = relevant.map((item, idx) => {
      if (idx === relevant.length - 1) {
        return resolveVirtualDisplayName(item.label, item.kind)
      }
      return item.label
    })
    return segments.join('/')
  }

  const segments = (pathNodes.length > 1 ? pathNodes.slice(1) : pathNodes).map((item, idx, arr) => {
    if (idx === arr.length - 1) {
      return resolveVirtualDisplayName(item.label, item.kind)
    }
    return item.label
  })
  return `@/${segments.join('/')}`
}

export function findContextAssetByVirtualPath(nodes: ContextAssetNode[], path: string): ContextAssetNode | undefined {
  const flat = flattenContextAssetNodes(nodes)
  const normalized = path.replace(/^@/, '').replace(/^\//, '')

  for (const node of flat) {
    if (resolveVirtualPath(node) === path || resolveVirtualPath(node) === `/${normalized}`) return node
    const displayName = resolveVirtualDisplayName(node.label, node.kind)
    if (displayName === normalized || node.label === normalized) return node
  }

  for (const node of flat) {
    const displayName = resolveVirtualDisplayName(node.label, node.kind)
    if (normalized.endsWith(`/${displayName}`) || normalized.endsWith(`/${node.label}`)) return node
  }

  return undefined
}
