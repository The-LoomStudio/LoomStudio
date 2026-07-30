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
import { readSlotKey } from './projection-slot.js'

type MovePosition = 'before' | 'inside' | 'after'

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

export function readContextProjectionMoveUpdate(
  nodes: ContextAssetNode[],
  projectionEntries: ProjectionOrderEntry[],
  draggedId: string,
  targetId: string,
  position: MovePosition,
): ContextAssetUpdate | undefined {
  const draggedNode = findContextNode(nodes, draggedId)
  const targetNode = findContextNode(nodes, targetId)
  if (!draggedNode?.projection || !targetNode?.projection) return undefined
  if (readSlotKey(draggedNode) !== readSlotKey(targetNode)) return undefined

  return {
    id: draggedId,
    partial: {
      projection: {
        ...draggedNode.projection,
        entryOrder: readReorderedEntryOrder(projectionEntries, draggedNode.id, targetNode.id, position),
      },
    },
  }
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

  if (draggedEntry && targetEntry && draggedEntry.slotKey === targetEntry.slotKey) {
    return [{
      id: input.draggedId,
      partial: {
        projection: {
          ...draggedEntry.node.projection!,
          entryOrder: readReorderedEntryOrder(input.orderedProjectionEntries, input.draggedId, input.targetId, 'before'),
        },
      },
    }]
  }

  if (!input.orderNode) return []
  const newOrder = moveBefore(input.projectionOrderIds, input.draggedId, input.targetId)
  return [readProjectionOrderUpdate(input.orderNode, input.projectionEntries, newOrder)]
}

export function readPresetProjectionMoveUpdates(input: {
  draggedId: string
  nodes: ContextAssetNode[]
  orderedProjectionEntries: ProjectionOrderEntry[]
  orderNode: ContextAssetNode | undefined
  position: MovePosition
  projectionEntries: ProjectionOrderEntry[]
  projectionOrderIds: string[]
  targetId: string
}): ContextAssetUpdate[] {
  const draggedNode = findContextNode(input.nodes, input.draggedId)
  if (!draggedNode?.projection) return []

  const targetNode = findContextNode(input.nodes, input.targetId)
  const slotMove = targetNode?.projection && readSlotKey(draggedNode) === readSlotKey(targetNode)
  if (slotMove) {
    return [{
      id: input.draggedId,
      partial: {
        projection: {
          ...draggedNode.projection,
          entryOrder: readReorderedEntryOrder(
            input.orderedProjectionEntries,
            draggedNode.id,
            targetNode.id,
            input.position,
          ),
        },
      },
    }]
  }

  let newZoneId = draggedNode.projection.zoneId
  const newOrder = input.projectionOrderIds.filter(id => id !== input.draggedId)

  if (input.targetId.includes('-zone-')) {
    const zoneMatch = input.targetId.match(/-zone-(.+)$/)
    if (zoneMatch) newZoneId = zoneMatch[1]!
    newOrder.push(input.draggedId)
  } else {
    if (targetNode?.projection) newZoneId = targetNode.projection.zoneId
    const targetIndex = newOrder.indexOf(input.targetId)
    if (targetIndex >= 0) {
      newOrder.splice(input.position === 'after' ? targetIndex + 1 : targetIndex, 0, input.draggedId)
    } else {
      newOrder.push(input.draggedId)
    }
  }

  const updates: ContextAssetUpdate[] = []
  if (newZoneId !== draggedNode.projection.zoneId) {
    updates.push({ id: input.draggedId, partial: { projection: { ...draggedNode.projection, zoneId: newZoneId } } })
  }
  if (input.orderNode) updates.push(readProjectionOrderUpdate(input.orderNode, input.projectionEntries, newOrder))
  return updates
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
