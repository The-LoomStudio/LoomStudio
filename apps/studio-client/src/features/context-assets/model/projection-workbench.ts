import type { ContextAssetNode } from '../../../entities/index.js'
import {
  buildSlotRanksFromOrder,
  buildProjectionOrder,
  findContextNode,
  flattenContextNodes,
  moveBefore,
  orderProjectionEntries,
  readProjectionOrderIds,
  readReorderedEntryOrder,
  type ProjectionOrderEntry,
} from './projection-order.js'

export type ContextAssetUpdate = {
  id: string
  partial: Partial<ContextAssetNode>
}

export function buildProjectionWorkbenchModel(nodes: ContextAssetNode[]) {
  const projectionEntries = buildProjectionOrder(nodes)
  const orderNode = flattenContextNodes(nodes).find(node => node.kind === 'order')
  const projectionOrderIds = readProjectionOrderIds(projectionEntries, orderNode)
  const orderedProjectionEntries = orderProjectionEntries(projectionEntries, orderNode)

  return {
    projectionEntries,
    orderNode,
    projectionOrderIds,
    orderedProjectionEntries,
  }
}

export function findRootContextModule(nodes: ContextAssetNode[], id: string): ContextAssetNode | undefined {
  return nodes.find(node => Boolean(findContextNode([node], id)))
}

export function readProjectionOrderReorderUpdates(input: {
  draggedId: string
  orderedProjectionEntries: ProjectionOrderEntry[]
  orderNode: ContextAssetNode | undefined
  projectionEntries: ProjectionOrderEntry[]
  projectionOrderIds: string[]
  targetId: string
}): ContextAssetUpdate[] {
  const draggedEntry = input.orderedProjectionEntries.find(entry => entry.node.id === input.draggedId)
  const targetEntry = input.orderedProjectionEntries.find(entry => entry.node.id === input.targetId)

  if (!draggedEntry || !targetEntry || draggedEntry.sourceKind === 'virtual' || targetEntry.sourceKind === 'virtual') return []

  if (draggedEntry && targetEntry && draggedEntry.slotKey === targetEntry.slotKey) {
    const draggedIndex = input.orderedProjectionEntries.findIndex(entry => entry.node.id === input.draggedId)
    const targetIndex = input.orderedProjectionEntries.findIndex(entry => entry.node.id === input.targetId)
    return [{
      id: input.draggedId,
      partial: {
        projection: {
          ...draggedEntry.node.projection!,
          entryOrder: readReorderedEntryOrder(input.orderedProjectionEntries, input.draggedId, input.targetId, draggedIndex < targetIndex ? 'after' : 'before'),
        },
      },
    }]
  }

  const draggedIndex = input.projectionOrderIds.indexOf(input.draggedId)
  const targetIndex = input.projectionOrderIds.indexOf(input.targetId)
  const newOrder = draggedIndex >= 0 && draggedIndex < targetIndex
    ? moveAfter(input.projectionOrderIds, input.draggedId, input.targetId)
    : moveBefore(input.projectionOrderIds, input.draggedId, input.targetId)
  const updates: ContextAssetUpdate[] = []
  let projectionEntries = input.projectionEntries

  if (draggedEntry.zoneId !== targetEntry.zoneId) {
    const slotKey = moveSlotKeyToZone(draggedEntry.slotKey, targetEntry.zoneId)
    updates.push({
      id: input.draggedId,
      partial: {
        projection: {
          ...draggedEntry.node.projection!,
          slotKey,
          zoneId: targetEntry.zoneId,
        },
      },
    })
    projectionEntries = input.projectionEntries.map(entry => entry.node.id === input.draggedId
      ? { ...entry, slotKey, zoneId: targetEntry.zoneId }
      : entry)
  }

  if (input.orderNode) updates.push(readProjectionOrderUpdate(input.orderNode, projectionEntries, newOrder))
  return updates
}

function moveSlotKeyToZone(slotKey: string, zoneId: string): string {
  const separator = slotKey.lastIndexOf('@')
  return separator < 0 ? `${slotKey}@${zoneId}` : `${slotKey.slice(0, separator)}@${zoneId}`
}

function moveAfter(ids: string[], draggedId: string, targetId: string): string[] {
  const current = ids.filter(id => id !== draggedId)
  const targetIndex = current.indexOf(targetId)
  if (targetIndex < 0) return ids
  return [...current.slice(0, targetIndex + 1), draggedId, ...current.slice(targetIndex + 1)]
}

function readProjectionOrderUpdate(
  orderNode: ContextAssetNode,
  projectionEntries: ProjectionOrderEntry[],
  newOrder: string[],
): ContextAssetUpdate {
  return {
    id: orderNode.id,
    partial: {
      orderList: newOrder,
      slotRanks: buildSlotRanksFromOrder(projectionEntries, newOrder),
    },
  }
}
