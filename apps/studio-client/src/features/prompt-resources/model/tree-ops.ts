import { canPlacePromptNode, isPromptMessageSequence } from '@loom-studio/shared'
import type { ContextAssetNode } from '../../../entities/index.js'
import { createDefaultProjection } from './context-asset-default-projection.js'
import { normalizeContextAssets, writeProjectionCapability } from './context-asset-normalization.js'
import { findContextAssetNode, findContextAssetNodeInfo, flattenContextAssetNodes } from './context-asset-tree.js'

type ContextAssetCreation = {
  asset: ContextAssetNode
  targetAssetId: string
  position: 'inside' | 'after'
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
): ContextAssetCreation | undefined {
  const parentInfo = findContextAssetNodeInfo(nodes, parentId)
  const isPresetRoot = parentInfo?.category === 'preset' && parentInfo?.node.kind === 'module'
  if (!parentInfo || isPresetRoot || !canAddChild(parentInfo.node, parentInfo.category)) return undefined

  const id = makeId()
  const node: ContextAssetNode = {
    id,
    label: 'New Entry',
    meta: 'draft / entry',
    kind: 'entry',
    enabled: true,
    body: '',
    capabilities: writeProjectionCapability(undefined, createDefaultProjection(parentInfo.category, parentInfo.node.children ?? [])),
  }

  return {
    asset: normalizeContextAssets([node])[0]!,
    targetAssetId: parentId,
    position: 'inside',
  }
}

export function addContextAssetFolderNode(
  nodes: ContextAssetNode[],
  parentId: string,
  makeId: () => string = createContextAssetId,
): ContextAssetCreation | undefined {
  const parentInfo = findContextAssetNodeInfo(nodes, parentId)
  if (!parentInfo || !canAddChild(parentInfo.node, parentInfo.category)) return undefined

  const id = makeId()
  const node: ContextAssetNode = {
    id,
    label: 'New Folder',
    kind: 'folder',
    children: [],
  }

  return {
    asset: normalizeContextAssets([node])[0]!,
    targetAssetId: parentId,
    position: 'inside',
  }
}

export function addContextAssetAnchorNode(
  nodes: ContextAssetNode[],
  parentId: string,
  makeId: () => string = createContextAssetId,
): ContextAssetCreation | undefined {
  const parentInfo = findContextAssetNodeInfo(nodes, parentId)
  const isPresetRoot = parentInfo?.category === 'preset' && parentInfo?.node.kind === 'module'
  if (!parentInfo || isPresetRoot || !canAddChild(parentInfo.node, parentInfo.category)) return undefined

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
    asset: normalizeContextAssets([node])[0]!,
    targetAssetId: parentId,
    position: 'inside',
  }
}

export function addContextAssetMessageBlockNode(
  nodes: ContextAssetNode[],
  parentId: string,
  role: 'system' | 'user' | 'assistant' = 'system',
  makeId: () => string = createContextAssetId,
): ContextAssetCreation | undefined {
  const parentInfo = findContextAssetNodeInfo(nodes, parentId)
  if (!parentInfo) return undefined

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

  const placement = contextMessageUnitPlacement(nodes, parentId)
  if (!placement) return undefined
  return {
    asset: normalizeContextAssets([node])[0]!,
    ...placement,
  }
}

export function contextMessageUnitPlacement(nodes: ContextAssetNode[], targetId: string): {
  targetAssetId: string; position: 'after' | 'inside'
} | undefined {
  const info = findContextAssetNodeInfo(nodes, targetId)
  if (!info || info.category !== 'preset' || isReadOnlyContextNode(info.node, info.category)) return
  const path: ContextAssetNode[] = []
  let current = info
  while (current) {
    path.unshift(current.node)
    if (!current.parentId) break
    const parent = findContextAssetNodeInfo(nodes, current.parentId)
    if (!parent) break
    current = parent
  }
  const message = path.find(item => item.kind === 'message')
  return message ? { targetAssetId: message.id, position: 'after' }
    : ['module', 'folder'].includes(info.node.kind) ? { targetAssetId: targetId, position: 'inside' }
      : { targetAssetId: targetId, position: 'after' }
}

export function addContextAssetMessageSequenceNode(nodes: ContextAssetNode[], parentId: string,
  makeId: () => string = createContextAssetId): ContextAssetCreation | undefined {
  const root = nodes.find(node => findContextAssetNode([node], parentId))
  if (!root || flattenContextAssetNodes([root]).some(isPromptMessageSequence)) return undefined
  const placement = contextMessageUnitPlacement(nodes, parentId)
  if (!placement) return undefined
  const node: ContextAssetNode = { id: makeId(), kind: 'virtual', category: 'preset', label: '会话历史',
    capabilities: { targetAnchorId: '@chat.session' } }
  return { asset: node, ...placement }
}

export function addContextAssetInZoneNode(
  nodes: ContextAssetNode[],
  resourceId: string,
  zoneId: string,
  makeId: () => string = createContextAssetId,
): ContextAssetCreation | undefined {
  const rootNode = findContextAssetNode(nodes, resourceId) ?? nodes.find(n => n.id === resourceId) ?? nodes[0]
  if (!rootNode) return undefined

  const id = makeId()
  const isPreset = rootNode.category === 'preset'
  const slotKey = `${isPreset ? 'preset' : 'lore'}:${rootNode.id}@${zoneId}`
  const node: ContextAssetNode = {
    id,
    label: 'New Entry',
    meta: 'draft / entry',
    kind: 'entry',
    enabled: true,
    body: '',
    category: rootNode.category,
    capabilities: {
      lifecycle: { lifecycle: 'always' },
      projection: {
        zoneId,
        slotKey,
        entryOrderHint: 100,
        slotOrderHint: isPreset ? 100 : 200,
        order: 'entry: 100',
        sourceKind: 'actual',
      },
    },
  }

  return {
    asset: normalizeContextAssets([node])[0]!,
    targetAssetId: rootNode.id,
    position: 'inside',
  }
}

export function duplicateContextAssetNode(
  nodes: ContextAssetNode[],
  id: string,
  makeId: () => string = createContextAssetId,
): ContextAssetCreation | undefined {
  const targetInfo = findContextAssetNodeInfo(nodes, id)
  if (!targetInfo || !canDuplicateNode(targetInfo.node, targetInfo.category)) return undefined

  const copy = cloneContextAssetNode(normalizeContextAssets([targetInfo.node])[0]!, makeId, true)
  return {
    asset: normalizeContextAssets([copy])[0]!,
    targetAssetId: id,
    position: 'after',
  }
}

export function deleteContextAssetNode(
  nodes: ContextAssetNode[],
  id: string,
  selectedId?: string,
): { selectedId?: string } | undefined {
  const targetInfo = findContextAssetNodeInfo(nodes, id)
  if (!targetInfo || !canDeleteNode(targetInfo.node, targetInfo.category)) return undefined

  const selectedWasRemoved = Boolean(selectedId && findContextAssetNode([targetInfo.node], selectedId))
  return { selectedId: selectedWasRemoved ? targetInfo.parentId ?? nodes.find(node => node.id !== id)?.id : selectedId }
}

export function canMoveContextAssetNode(nodes: ContextAssetNode[], draggedId: string, targetId: string,
  position: 'before' | 'inside' | 'after' = 'inside'): boolean {
  const source = findContextAssetNodeInfo(nodes, draggedId)
  const target = findContextAssetNodeInfo(nodes, targetId)
  const root = nodes.find(node => findContextAssetNode([node], draggedId))
  const parentId = position === 'inside' ? targetId : target?.parentId
  return Boolean(source && target && root && parentId && source.node.kind !== 'module' && draggedId !== targetId
    && !isReadOnlyContextNode(source.node, source.category) && !isReadOnlyContextNode(target.node, target.category)
    && !findContextAssetNode(source.node.children ?? [], targetId)
    && findContextAssetNode([root], targetId) && canPlacePromptNode(root, parentId, source.node))
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

function cloneContextAssetNode(node: ContextAssetNode, makeId: () => string, isRoot: boolean): ContextAssetNode {
  const nextEntryOrder = typeof node.capabilities?.projection?.entryOrderHint === 'number'
    ? node.capabilities.projection.entryOrderHint + 1
    : node.capabilities?.projection?.entryOrderHint
  const projection = node.capabilities?.projection
    ? {
      ...node.capabilities.projection,
      entryOrderHint: nextEntryOrder,
      order: typeof nextEntryOrder === 'number' ? `entry: ${nextEntryOrder}` : node.capabilities.projection.order,
    }
    : undefined

  return {
    ...node,
    id: makeId(),
    label: isRoot ? `${node.label} Copy` : node.label,
    capabilities: projection ? { ...node.capabilities, projection } : node.capabilities,
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
