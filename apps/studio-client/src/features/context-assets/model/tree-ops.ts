import type { ContextAssetNode } from '../../../entities/index.js'
import { createDefaultProjection } from './context-asset-default-projection.js'
import { normalizeContextAssets } from './context-asset-normalization.js'
import { findContextAssetNode, findContextAssetNodeInfo, flattenContextAssetNodes } from './context-asset-tree.js'

type ContextAssetMutation = {
  nodes: ContextAssetNode[]
  selectedId?: string
}

let contextAssetIdSequence = 0

function createContextAssetId(): string {
  contextAssetIdSequence += 1
  return `context-node-${Date.now().toString(36)}-${contextAssetIdSequence}`
}

export function updateContextAssetNode(nodes: ContextAssetNode[], id: string, partial: Partial<ContextAssetNode>): ContextAssetNode[] {
  return normalizeProjectionOrderNodes(normalizeContextAssets(updateContextAssetNodeInner(nodes, id, partial)))
}

function updateContextAssetNodeInner(nodes: ContextAssetNode[], id: string, partial: Partial<ContextAssetNode>): ContextAssetNode[] {
  return nodes.map(node => {
    if (node.id === id) return { ...node, ...partial }
    if (!node.children) return node
    return { ...node, children: updateContextAssetNodeInner(node.children, id, partial) }
  })
}

export function addContextAssetNode(
  nodes: ContextAssetNode[],
  parentId: string,
  makeId: () => string = createContextAssetId,
): ContextAssetMutation {
  const parentInfo = findContextAssetNodeInfo(nodes, parentId)
  if (!parentInfo || !canAddChild(parentInfo.node, parentInfo.category)) return { nodes }

  const id = makeId()
  const node: ContextAssetNode = {
    id,
    label: 'New Entry',
    meta: 'draft / entry',
    kind: 'entry',
    enabled: true,
    body: '',
    projection: createDefaultProjection(parentInfo.category, parentInfo.node.children ?? []),
  }

  return {
    nodes: normalizeContextAssets(insertContextAssetChild(nodes, parentId, node)),
    selectedId: id,
  }
}

export function addContextAssetFolderNode(
  nodes: ContextAssetNode[],
  parentId: string,
  makeId: () => string = createContextAssetId,
): ContextAssetMutation {
  const parentInfo = findContextAssetNodeInfo(nodes, parentId)
  if (!parentInfo || !canAddChild(parentInfo.node, parentInfo.category)) return { nodes }

  const id = makeId()
  const node: ContextAssetNode = {
    id,
    label: 'New Folder',
    kind: 'folder',
    children: [],
  }

  return {
    nodes: normalizeContextAssets(insertContextAssetChild(nodes, parentId, node)),
    selectedId: id,
  }
}

export function addContextAssetAnchorNode(
  nodes: ContextAssetNode[],
  parentId: string,
  makeId: () => string = createContextAssetId,
): ContextAssetMutation {
  const parentInfo = findContextAssetNodeInfo(nodes, parentId)
  if (!parentInfo || !canAddChild(parentInfo.node, parentInfo.category)) return { nodes }

  const id = makeId()
  const node: ContextAssetNode = {
    id,
    label: '@new.anchor',
    meta: 'preset.virtual',
    kind: 'virtual',
    category: 'preset',
    capabilities: {
      targetAnchorId: '@new.anchor',
    },
  }

  return {
    nodes: normalizeContextAssets(insertContextAssetChild(nodes, parentId, node)),
    selectedId: id,
  }
}

export function addContextAssetMessageBlockNode(
  nodes: ContextAssetNode[],
  parentId: string,
  role: 'system' | 'user' | 'assistant' = 'system',
  makeId: () => string = createContextAssetId,
): ContextAssetMutation {
  const parentInfo = findContextAssetNodeInfo(nodes, parentId)
  if (!parentInfo) return { nodes }

  const id = makeId()
  const roleTitle = role.charAt(0).toUpperCase() + role.slice(1)
  const node: ContextAssetNode = {
    id,
    label: `${roleTitle} Message`,
    meta: `message.${role}`,
    kind: 'message',
    category: 'preset',
    children: [],
    capabilities: {
      roleHint: role,
    },
  }

  if (parentInfo.node.kind === 'message' || parentInfo.node.kind === 'entry' || parentInfo.node.kind === 'virtual' || parentInfo.node.kind === 'slot') {
    return {
      nodes: normalizeContextAssets(insertContextAssetSiblingAfter(nodes, parentInfo.node.id, node)),
      selectedId: id,
    }
  }

  return {
    nodes: normalizeContextAssets(insertContextAssetChild(nodes, parentId, node)),
    selectedId: id,
  }
}

export function addContextAssetInZoneNode(
  nodes: ContextAssetNode[],
  resourceId: string,
  zoneId: string,
  makeId: () => string = createContextAssetId,
): ContextAssetMutation {
  const rootNode = findContextAssetNode(nodes, resourceId) ?? nodes.find(n => n.id === resourceId) ?? nodes[0]
  if (!rootNode) return { nodes }

  const id = makeId()
  const isPreset = rootNode.category === 'preset'
  const slotKey = `${isPreset ? 'preset' : 'setting-layer'}:${rootNode.id}@${zoneId}`
  const node: ContextAssetNode = {
    id,
    label: 'New Entry',
    meta: 'draft / entry',
    kind: 'entry',
    enabled: true,
    body: '',
    category: rootNode.category,
    projection: {
      zoneId,
      slotKey,
      lifecycle: 'always',
      order: 'entry: 100',
      entryOrder: 100,
      slotOrder: isPreset ? 100 : 200,
      sourceKind: 'actual',
    },
    capabilities: {
      lifecycle: { lifecycle: 'always' },
      projection: {
        zoneId,
        slotKey,
        entryOrderHint: 100,
        slotOrderHint: isPreset ? 100 : 200,
      },
    },
  }

  return {
    nodes: normalizeContextAssets(insertContextAssetChild(nodes, rootNode.id, node)),
    selectedId: id,
  }
}

export function duplicateContextAssetNode(
  nodes: ContextAssetNode[],
  id: string,
  makeId: () => string = createContextAssetId,
): ContextAssetMutation {
  const targetInfo = findContextAssetNodeInfo(nodes, id)
  if (!targetInfo || !canDuplicateNode(targetInfo.node, targetInfo.category)) return { nodes }

  const copy = cloneContextAssetNode(targetInfo.node, makeId, true)
  return {
    nodes: normalizeContextAssets(insertContextAssetSiblingAfter(nodes, id, copy)),
    selectedId: copy.id,
  }
}

export function deleteContextAssetNode(
  nodes: ContextAssetNode[],
  id: string,
  selectedId?: string,
): ContextAssetMutation {
  const targetInfo = findContextAssetNodeInfo(nodes, id)
  if (!targetInfo || !canDeleteNode(targetInfo.node, targetInfo.category)) return { nodes }

  const selectedWasRemoved = Boolean(selectedId && findContextAssetNode([targetInfo.node], selectedId))
  const nextNodes = normalizeProjectionOrderNodes(removeContextAssetNode(nodes, id))
  return {
    nodes: nextNodes,
    selectedId: selectedWasRemoved ? targetInfo.parentId ?? nextNodes[0]?.id : selectedId,
  }
}

export function moveContextAssetNode(
  nodes: ContextAssetNode[],
  draggedId: string,
  targetId: string,
  position: 'before' | 'inside' | 'after',
): ContextAssetNode[] {
  let draggedNode: ContextAssetNode | undefined

  function removeNode(currentNodes: ContextAssetNode[]): ContextAssetNode[] {
    return currentNodes.flatMap(node => {
      if (node.id === draggedId) {
        draggedNode = node
        return []
      }
      if (!node.children) return [node]
      return [{ ...node, children: removeNode(node.children) }]
    })
  }

  function insertNode(currentNodes: ContextAssetNode[]): ContextAssetNode[] {
    return currentNodes.flatMap(node => {
      if (node.id === targetId && draggedNode) {
        if (position === 'before') return [draggedNode, node]
        if (position === 'after') return [node, draggedNode]
        return [{ ...node, children: [...(node.children ?? []), draggedNode] }]
      }
      if (!node.children) return [node]
      return [{ ...node, children: insertNode(node.children) }]
    })
  }

  const removed = removeNode(nodes)
  if (!draggedNode) return nodes

  return normalizeProjectionOrderNodes(normalizeContextAssets(insertNode(removed)))
}

function canAddChild(node: ContextAssetNode, inheritedCategory?: ContextAssetNode['category']): boolean {
  return (node.kind === 'module' || node.kind === 'folder' || node.kind === 'message') && !isReadOnlyContextNode(node, inheritedCategory)
}

function canDuplicateNode(node: ContextAssetNode, inheritedCategory?: ContextAssetNode['category']): boolean {
  return node.kind !== 'module' && !isReadOnlyContextNode(node, inheritedCategory)
}

function canDeleteNode(node: ContextAssetNode, inheritedCategory?: ContextAssetNode['category']): boolean {
  return node.kind !== 'module' && !isReadOnlyContextNode(node, inheritedCategory)
}

function isReadOnlyContextNode(node: ContextAssetNode, inheritedCategory?: ContextAssetNode['category']): boolean {
  const category = node.category ?? inheritedCategory
  return node.readOnly === true
    || category === 'runtime'
    || category === 'history'
    || node.projection?.sourceKind === 'virtual'
}

function insertContextAssetChild(nodes: ContextAssetNode[], parentId: string, child: ContextAssetNode): ContextAssetNode[] {
  return nodes.map(node => {
    if (node.id === parentId) return { ...node, children: [...(node.children ?? []), child] }
    if (!node.children) return node
    return { ...node, children: insertContextAssetChild(node.children, parentId, child) }
  })
}

function insertContextAssetSiblingAfter(nodes: ContextAssetNode[], targetId: string, sibling: ContextAssetNode): ContextAssetNode[] {
  return nodes.flatMap(node => {
    if (node.id === targetId) return [node, sibling]
    if (!node.children) return [node]
    return [{ ...node, children: insertContextAssetSiblingAfter(node.children, targetId, sibling) }]
  })
}

function removeContextAssetNode(nodes: ContextAssetNode[], id: string): ContextAssetNode[] {
  return nodes.flatMap(node => {
    if (node.id === id) return []
    if (!node.children) return [node]
    return [{ ...node, children: removeContextAssetNode(node.children, id) }]
  })
}

function cloneContextAssetNode(node: ContextAssetNode, makeId: () => string, isRoot: boolean): ContextAssetNode {
  const nextEntryOrder = typeof node.projection?.entryOrder === 'number'
    ? node.projection.entryOrder + 1
    : node.projection?.entryOrder
  const projection = node.projection
    ? {
      ...node.projection,
      entryOrder: nextEntryOrder,
      order: typeof nextEntryOrder === 'number' ? `entry: ${nextEntryOrder}` : node.projection.order,
    }
    : undefined

  return {
    ...node,
    id: makeId(),
    label: isRoot ? `${node.label} Copy` : node.label,
    projection,
    children: node.children?.map(child => cloneContextAssetNode(child, makeId, false)),
  }
}

function normalizeProjectionOrderNodes(nodes: ContextAssetNode[]): ContextAssetNode[] {
  const liveNodes = flattenContextAssetNodes(nodes)
  const liveIds = new Set(liveNodes.map(node => node.id))
  const liveSlotKeys = new Set(liveNodes.map(node => node.projection?.slotKey).filter((slotKey): slotKey is string => Boolean(slotKey)))

  return normalizeProjectionOrderNodesInner(nodes, liveIds, liveSlotKeys)
}

function normalizeProjectionOrderNodesInner(
  nodes: ContextAssetNode[],
  liveIds: Set<string>,
  liveSlotKeys: Set<string>,
): ContextAssetNode[] {
  return nodes.map(node => {
    const children = node.children ? normalizeProjectionOrderNodesInner(node.children, liveIds, liveSlotKeys) : undefined
    if (node.kind !== 'order') return children ? { ...node, children } : node

    return {
      ...node,
      ...(children ? { children } : {}),
      orderList: node.orderList?.filter(id => liveIds.has(id)),
      slotRanks: node.slotRanks?.filter(rank => liveSlotKeys.has(rank.slotKey)),
    }
  })
}
