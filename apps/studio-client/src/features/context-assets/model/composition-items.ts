import type {
  ContextAssetNode,
  PromptCompositionEntry,
  PromptCompositionItem,
  PromptCompositionSlot,
  PromptCompositionZone,
  PromptMessageBlock,
  PromptProviderRole,
} from '../../../entities/index.js'

export function readCompositionItems(orderNode: ContextAssetNode | undefined): PromptCompositionItem[] {
  return orderNode?.skeletonPatch?.items ?? []
}

export function findCompositionItem(items: PromptCompositionItem[], id: string | undefined): PromptCompositionItem | undefined {
  if (!id) return undefined
  for (const item of items) {
    if (item.id === id) return item
    if (item.kind === 'message') {
      const child = item.items.find(candidate => candidate.id === id)
      if (child) return child
    }
  }
  return undefined
}

export function findCompositionBlock(items: PromptCompositionItem[], id: string | undefined): PromptMessageBlock | undefined {
  const item = items.find(candidate => candidate.kind === 'message' && candidate.id === id)
  return item?.kind === 'message' ? item : undefined
}

export function createMessageBlock(
  items: PromptCompositionItem[],
  role: PromptProviderRole = 'system',
): PromptMessageBlock {
  return {
    id: createCompositionId('message'),
    kind: 'message',
    displayName: role === 'developer' ? 'Developer' : role[0]!.toUpperCase() + role.slice(1),
    orderIndex: nextOrderIndex(items),
    role,
    items: [],
  }
}

export function createCompositionZone(
  items: PromptCompositionItem[],
  displayName = 'New Zone',
): PromptCompositionZone {
  return {
    id: createCompositionId('zone'),
    kind: 'zone',
    displayName,
    parentId: 'zone.root',
    band: 'current-turn',
    orderIndex: nextOrderIndex(items),
  }
}

export function createCompositionSlot(
  items: PromptCompositionItem[],
  zoneId?: string,
): PromptCompositionSlot {
  const id = createCompositionId('slot')
  return {
    id,
    kind: 'slot',
    displayName: 'New Context Slot',
    bindingId: `custom.${id}`,
    ...(zoneId ? { zoneId } : {}),
    messageMode: 'context',
    slotKey: id,
    orderIndex: nextOrderIndex(items),
  }
}

export function createCompositionEntry(
  items: PromptCompositionItem[],
  nodeId: string,
): PromptCompositionEntry {
  return {
    id: createCompositionId('entry'),
    kind: 'entry',
    displayName: 'Direct Entry',
    orderIndex: nextOrderIndex(items),
    source: { kind: 'preset', nodeId },
  }
}

export function appendCompositionItem(
  items: PromptCompositionItem[],
  item: PromptCompositionItem,
  parentId?: string,
): PromptCompositionItem[] {
  if (!parentId) return [...items, item]
  if (item.kind === 'message') return items
  return items.map(candidate => candidate.kind === 'message' && candidate.id === parentId
    ? { ...candidate, items: [...candidate.items, item] }
    : candidate)
}

export function removeCompositionItem(items: PromptCompositionItem[], id: string): PromptCompositionItem[] {
  return items
    .filter(item => item.id !== id)
    .map(item => item.kind === 'message'
      ? { ...item, items: item.items.filter(child => child.id !== id) }
      : item)
}

export function updateCompositionItem(
  items: PromptCompositionItem[],
  id: string,
  update: (item: PromptCompositionItem) => PromptCompositionItem,
): PromptCompositionItem[] {
  return items.map(item => {
    if (item.id === id) return update(item)
    if (item.kind !== 'message') return item
    return {
      ...item,
      items: item.items.map(child => child.id === id ? update(child) as Exclude<PromptCompositionItem, PromptMessageBlock> : child),
    }
  })
}

export function moveCompositionItem(items: PromptCompositionItem[], id: string, direction: 'up' | 'down'): PromptCompositionItem[] {
  const orderedItems = [...items].sort(compareOrder)
  const rootIndex = orderedItems.findIndex(item => item.id === id)
  if (rootIndex >= 0) return swapCompositionItems(orderedItems, rootIndex, direction)

  return items.map(item => {
    if (item.kind !== 'message') return item
    const orderedChildren = [...item.items].sort(compareOrder)
    const childIndex = orderedChildren.findIndex(child => child.id === id)
    return childIndex >= 0 ? { ...item, items: swapCompositionItems(orderedChildren, childIndex, direction) } : item
  })
}

export function createCompositionId(kind: string): string {
  return `composition.${kind}.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 7)}`
}

function nextOrderIndex(items: PromptCompositionItem[]): number {
  return Math.max(0, ...items.map(item => item.orderIndex)) + 10
}

function swapCompositionItems<T extends { orderIndex: number }>(items: T[], index: number, direction: 'up' | 'down'): T[] {
  const target = direction === 'up' ? index - 1 : index + 1
  if (target < 0 || target >= items.length) return items
  const next = [...items]
  const current = next[index]!
  next[index] = next[target]!
  next[target] = current
  const orderIndex = next[index]!.orderIndex
  next[index] = { ...next[index]!, orderIndex: next[target]!.orderIndex }
  next[target] = { ...next[target]!, orderIndex }
  return next
}

function compareOrder(left: { orderIndex: number }, right: { orderIndex: number }): number {
  return left.orderIndex - right.orderIndex
}
