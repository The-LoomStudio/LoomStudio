import type { ContextAssetNode, ProjectionSlotRank } from '../../../entities/index.js'
import { isSettingLayerSlot, readSlotDisplayName } from './projection-slot.js'

export type ProjectionOrderEntry = {
  entryOrder: number
  node: ContextAssetNode
  position: number
  slotKey: string
  slotOrder: number
  sourceKind: 'actual' | 'virtual'
  zoneId: string
  zoneOrder: number
}

export type ProjectionOrderRow = {
  entries: ProjectionOrderEntry[]
  id: string
  label: string
  primary: ProjectionOrderEntry
  type: 'entry' | 'slot'
  zoneId: string
}

export function buildProjectionOrder(nodes: ContextAssetNode[]): ProjectionOrderEntry[] {
  return flattenContextNodes(nodes)
    .filter((node): node is ContextAssetNode & { projection: NonNullable<ContextAssetNode['projection']> } => Boolean(node.projection))
    .map(node => {
      return {
        entryOrder: node.projection.entryOrder ?? 500,
        node,
        position: 0,
        slotKey: node.projection.slotKey ?? `${node.id}@${node.projection.zoneId}`,
        slotOrder: node.projection.slotOrder ?? 500,
        sourceKind: node.projection.sourceKind ?? 'actual',
        zoneId: node.projection.zoneId,
        zoneOrder: readZoneOrder(node.projection.zoneId),
      }
    })
    .sort((left, right) => (
      left.zoneOrder - right.zoneOrder
      || left.slotOrder - right.slotOrder
      || left.entryOrder - right.entryOrder
      || left.slotKey.localeCompare(right.slotKey)
      || left.node.id.localeCompare(right.node.id)
    ))
    .map((entry, index) => ({ ...entry, position: index + 1 }))
}

export function orderProjectionEntries(entries: ProjectionOrderEntry[], orderNode: ContextAssetNode | undefined): ProjectionOrderEntry[] {
  const slotRank = new Map((orderNode?.slotRanks ?? []).map(rank => [rank.slotKey, rank.rankKey]))
  if (slotRank.size > 0) {
    return [...entries]
      .sort((left, right) => (
        (slotRank.get(left.slotKey) ?? 'zzzz').localeCompare(slotRank.get(right.slotKey) ?? 'zzzz')
        || left.zoneOrder - right.zoneOrder
        || left.slotOrder - right.slotOrder
        || left.entryOrder - right.entryOrder
        || left.node.id.localeCompare(right.node.id)
      ))
      .map((entry, index) => ({ ...entry, position: index + 1 }))
  }

  const orderIds = orderNode?.orderList ?? entries.map(entry => entry.node.id)
  const order = new Map(orderIds.map((id, index) => [id, index]))

  return [...entries]
    .sort((left, right) => (
      (order.get(left.node.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.node.id) ?? Number.MAX_SAFE_INTEGER)
      || left.position - right.position
    ))
    .map((entry, index) => ({ ...entry, position: index + 1 }))
}

export function readProjectionOrderIds(entries: ProjectionOrderEntry[], orderNode: ContextAssetNode | undefined): string[] {
  const slotRank = new Map((orderNode?.slotRanks ?? []).map(rank => [rank.slotKey, rank.rankKey]))
  if (slotRank.size === 0) return orderNode?.orderList ?? entries.map(entry => entry.node.id)

  return [...entries]
    .sort((left, right) => (
      (slotRank.get(left.slotKey) ?? 'zzzz').localeCompare(slotRank.get(right.slotKey) ?? 'zzzz')
      || left.position - right.position
    ))
    .map(entry => entry.node.id)
}

export function buildProjectionRows(entries: ProjectionOrderEntry[]): ProjectionOrderRow[] {
  const rows: ProjectionOrderRow[] = []
  const settingLayerEntries = new Map<string, ProjectionOrderEntry[]>()

  for (const entry of entries) {
    if (isSettingLayerSlot(entry.slotKey)) {
      settingLayerEntries.set(entry.slotKey, [...(settingLayerEntries.get(entry.slotKey) ?? []), entry])
    } else {
      rows.push({
        entries: [entry],
        id: entry.node.id,
        label: entry.node.label,
        primary: entry,
        type: 'entry',
        zoneId: entry.zoneId,
      })
    }
  }

  for (const slotEntries of settingLayerEntries.values()) {
    const sorted = [...slotEntries].sort((left, right) => left.entryOrder - right.entryOrder || left.node.id.localeCompare(right.node.id))
    const primary = sorted[0]
    if (!primary) continue
    rows.push({
      entries: sorted,
      id: primary.slotKey,
      label: readSlotDisplayName(primary.slotKey),
      primary,
      type: 'slot',
      zoneId: primary.zoneId,
    })
  }

  return rows.sort((left, right) => left.primary.position - right.primary.position)
}

export function buildSlotRanksFromOrder(entries: ProjectionOrderEntry[], orderedIds: string[]): ProjectionSlotRank[] {
  const entriesById = new Map(entries.map(entry => [entry.node.id, entry]))
  const seen = new Set<string>()
  const ranks: ProjectionSlotRank[] = []

  for (const id of orderedIds) {
    const entry = entriesById.get(id)
    if (!entry || seen.has(entry.slotKey)) continue
    seen.add(entry.slotKey)
    ranks.push({
      zoneId: entry.zoneId,
      slotKey: entry.slotKey,
      rankKey: makeRankKey(ranks.length),
    })
  }

  return ranks
}

export function readReorderedEntryOrder(entries: ProjectionOrderEntry[], draggedId: string, targetId: string, position: 'before' | 'inside' | 'after'): number {
  const byId = new Map(entries.map(entry => [entry.node.id, entry]))
  const slotEntries = entries
    .filter(entry => entry.slotKey === byId.get(draggedId)?.slotKey)
    .sort((left, right) => left.entryOrder - right.entryOrder || left.node.id.localeCompare(right.node.id))
  const ids = slotEntries.map(entry => entry.node.id).filter(id => id !== draggedId)
  const targetIndex = ids.indexOf(targetId)
  const insertIndex = targetIndex < 0 ? ids.length : position === 'after' ? targetIndex + 1 : targetIndex
  ids.splice(insertIndex, 0, draggedId)
  const currentIndex = ids.indexOf(draggedId)
  const previousOrder = currentIndex > 0 ? byId.get(ids[currentIndex - 1] ?? '')?.entryOrder : undefined
  const nextOrder = currentIndex < ids.length - 1 ? byId.get(ids[currentIndex + 1] ?? '')?.entryOrder : undefined

  if (previousOrder !== undefined && nextOrder !== undefined) return (previousOrder + nextOrder) / 2
  if (previousOrder !== undefined) return previousOrder + 10
  if (nextOrder !== undefined) return nextOrder - 10
  return byId.get(draggedId)?.entryOrder ?? 10
}

export function moveBefore(ids: string[], draggedId: string, targetId: string): string[] {
  const current = ids.filter(id => id !== draggedId)
  const targetIndex = current.indexOf(targetId)
  if (targetIndex < 0) return ids
  return [...current.slice(0, targetIndex), draggedId, ...current.slice(targetIndex)]
}

export function flattenContextNodes(nodes: ContextAssetNode[]): ContextAssetNode[] {
  return nodes.flatMap(node => [node, ...flattenContextNodes(node.children ?? [])])
}

export function findContextNode(nodes: ContextAssetNode[], id: string | undefined): ContextAssetNode | undefined {
  if (!id) return undefined

  for (const node of nodes) {
    if (node.id === id) return node
    const child = findContextNode(node.children ?? [], id)
    if (child) return child
  }

  return undefined
}

function makeRankKey(index: number): string {
  return String(index).padStart(4, '0')
}

function readZoneOrder(zone: string): number {
  if (zone === 'preset.system') return 100
  if (zone === 'setting.stable') return 200
  if (zone === 'chat.history') return 300
  if (zone === 'setting.lower') return 400
  if (zone === 'chat.before') return 500
  if (zone === 'chat.inside') return 600
  if (zone === 'chat.after') return 700
  if (zone === 'fresh.tail') return 800
  return 900
}
