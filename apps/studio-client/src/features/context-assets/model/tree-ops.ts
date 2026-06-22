import type { ClientJsonValue } from '@loom-studio/client-bridge'
import type { ContextAssetNode, Session } from '../../../entities/index.js'

type ContextAssetMutation = {
  nodes: ContextAssetNode[]
  selectedId?: string
}

let contextAssetIdSequence = 0

function createContextAssetId(): string {
  contextAssetIdSequence += 1
  return `demo-node-${Date.now().toString(36)}-${contextAssetIdSequence}`
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

export function readDemoProjectionOrderProfile(nodes: ContextAssetNode[], session: Session | undefined): ClientJsonValue | undefined {
  const orderNode = flattenContextAssetNodes(nodes).find(node => node.kind === 'order')
  if (!orderNode?.slotRanks?.length) return undefined

  return {
    id: orderNode.id,
    scope: 'session',
    ...(orderNode.skeletonPatch ? { skeletonPatch: orderNode.skeletonPatch as unknown as ClientJsonValue } : {}),
    slotRanks: orderNode.slotRanks.map(rank => ({
      injectionGroupKey: rank.injectionGroupKey,
      ...(rank.anchor ? { anchor: rank.anchor } : {}),
      slotKey: toM0SlotKey(rank.slotKey, session),
      rankKey: rank.rankKey,
    })),
  }
}

function toM0SlotKey(slotKey: string, session: Session | undefined): string {
  const injectionGroupKey = slotKey.includes('@') ? slotKey.slice(slotKey.lastIndexOf('@') + 1) : ''
  if (slotKey.startsWith('preset:')) return `preset:m0-card-preset@${injectionGroupKey}`
  if (slotKey.startsWith('setting-layer:')) return `setting-layer:m0-card-setting-layer@${injectionGroupKey}`
  if (slotKey.startsWith('narrative-chat:')) {
    const cardId = typeof session?.cardSnapshot.id === 'string' ? session.cardSnapshot.id : 'unknown'
    return `narrative-chat:session:${cardId}@${injectionGroupKey}`
  }
  return slotKey
}

export function normalizeContextAssets(nodes: ContextAssetNode[]): ContextAssetNode[] {
  return nodes.map(node => normalizeContextAssetNode(node))
}

function normalizeContextAssetNode(node: ContextAssetNode): ContextAssetNode {
  const children = node.children ? normalizeContextAssets(node.children) : undefined
  const projection = node.projection ?? readProjectionFromCapabilities(node.capabilities)
  const capabilities = projection ? writeProjectionCapability(node.capabilities, projection) : node.capabilities

  return {
    ...node,
    ...(children ? { children } : {}),
    ...(projection ? { projection } : {}),
    ...(capabilities ? { capabilities } : {}),
  }
}

function readProjectionFromCapabilities(capabilities: ContextAssetNode['capabilities']): ContextAssetNode['projection'] | undefined {
  const projection = capabilities?.projection
  if (!projection) return undefined

  return {
    anchor: readProjectionAnchor(projection.anchor),
    entryOrder: projection.entryOrderHint,
    zone: projection.zone,
    group: projection.injectionGroupKey,
    lifecycle: capabilities.lifecycle?.lifecycle ?? 'always',
    order: projection.order ?? (typeof projection.entryOrderHint === 'number' ? `entry: ${projection.entryOrderHint}` : 'entry: 500'),
    reason: projection.reason,
    slotKey: projection.slotKey,
    slotOrder: projection.slotOrderHint,
    sourceKind: projection.sourceKind,
  }
}

function writeProjectionCapability(
  capabilities: ContextAssetNode['capabilities'],
  projection: NonNullable<ContextAssetNode['projection']>,
): ContextAssetNode['capabilities'] {
  return {
    ...capabilities,
    lifecycle: { lifecycle: projection.lifecycle },
    projection: {
      ...capabilities?.projection,
      anchor: readProjectionAnchor(projection.anchor),
      entryOrderHint: projection.entryOrder,
      zone: projection.zone,
      injectionGroupKey: projection.group,
      order: projection.order,
      reason: projection.reason,
      slotKey: projection.slotKey,
      slotOrderHint: projection.slotOrder,
      sourceKind: projection.sourceKind,
    },
  }
}

function readProjectionAnchor(anchor: unknown): 'before' | 'inside' | 'after' | undefined {
  if (anchor === 'before' || anchor === 'inside' || anchor === 'after') return anchor
  return undefined
}

function findContextAssetNode(nodes: ContextAssetNode[], id: string | undefined): ContextAssetNode | undefined {
  if (!id) return undefined

  for (const node of nodes) {
    if (node.id === id) return node
    const child = findContextAssetNode(node.children ?? [], id)
    if (child) return child
  }

  return undefined
}

function findContextAssetNodeInfo(
  nodes: ContextAssetNode[],
  id: string,
  parentId?: string,
  inheritedCategory?: ContextAssetNode['category'],
): { node: ContextAssetNode; parentId?: string; category?: ContextAssetNode['category'] } | undefined {
  for (const node of nodes) {
    const category = node.category ?? inheritedCategory
    if (node.id === id) return { node, parentId, category }
    const child = findContextAssetNodeInfo(node.children ?? [], id, node.id, category)
    if (child) return child
  }

  return undefined
}

function canAddChild(node: ContextAssetNode, inheritedCategory?: ContextAssetNode['category']): boolean {
  return (node.kind === 'module' || node.kind === 'folder') && !isReadOnlyContextNode(node, inheritedCategory)
}

function canDuplicateNode(node: ContextAssetNode, inheritedCategory?: ContextAssetNode['category']): boolean {
  return node.kind !== 'module' && node.kind !== 'order' && !isReadOnlyContextNode(node, inheritedCategory)
}

function canDeleteNode(node: ContextAssetNode, inheritedCategory?: ContextAssetNode['category']): boolean {
  return node.kind !== 'module' && node.kind !== 'order' && !isReadOnlyContextNode(node, inheritedCategory)
}

function isReadOnlyContextNode(node: ContextAssetNode, inheritedCategory?: ContextAssetNode['category']): boolean {
  const category = node.category ?? inheritedCategory
  return category === 'runtime'
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

function createDefaultProjection(category: ContextAssetNode['category'], siblings: ContextAssetNode[]): NonNullable<ContextAssetNode['projection']> {
  const inherited = flattenContextAssetNodes(siblings).find(node => node.projection?.sourceKind !== 'virtual')?.projection
  if (inherited) {
    const slotKey = inherited.slotKey ?? `${inherited.group}@${inherited.zone}`
    const entryOrder = readNextEntryOrder(siblings, slotKey)

    return {
      ...inherited,
      entryOrder,
      order: `entry: ${entryOrder}`,
      reason: 'Demo entry: manually added',
      sourceKind: 'actual',
    }
  }

  const preset = category === 'preset'
  const group = preset ? 'preset.system' : 'setting.stable'
  const slotKey = preset ? 'preset:default-airp-preset@preset.system' : 'setting-layer:city-layers-main@setting.stable'
  const entryOrder = readNextEntryOrder(siblings, slotKey)

  return {
    anchor: 'inside',
    entryOrder,
    zone: 'StablePrefix',
    group,
    lifecycle: 'always',
    order: `entry: ${entryOrder}`,
    reason: 'Demo entry: manually added',
    slotKey,
    slotOrder: preset ? 100 : 200,
    sourceKind: 'actual',
  }
}

function readNextEntryOrder(siblings: ContextAssetNode[], slotKey: string): number {
  const orders = flattenContextAssetNodes(siblings)
    .filter(node => node.projection?.slotKey === slotKey)
    .map(node => node.projection?.entryOrder)
    .filter((order): order is number => typeof order === 'number')

  return orders.length ? Math.max(...orders) + 10 : 10
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

function flattenContextAssetNodes(nodes: ContextAssetNode[]): ContextAssetNode[] {
  return nodes.flatMap(node => [node, ...flattenContextAssetNodes(node.children ?? [])])
}
