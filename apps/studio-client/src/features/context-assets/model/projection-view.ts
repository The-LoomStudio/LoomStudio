import type { ContextAssetNode } from '../../../entities/index.js'
import { flattenContextNodes, type ProjectionOrderEntry } from './projection-order.js'
import { isSettingLayerSlot, readSlotDisplayName, readSlotKey } from './projection-slot.js'

export function transformForProjectionView(
  moduleNode: ContextAssetNode,
  orderedEntries: ProjectionOrderEntry[],
  options: { groupSettingLayerSlots?: boolean } = {},
): ContextAssetNode {
  const orderByNodeId = new Map(orderedEntries.map((entry, index) => [entry.node.id, index]))
  const entries = flattenContextNodes(moduleNode.children ?? [])
    .filter(node => node.kind === 'entry' && node.projection)
    .sort((left, right) => (
      (orderByNodeId.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (orderByNodeId.get(right.id) ?? Number.MAX_SAFE_INTEGER)
      || (left.projection?.entryOrder ?? 500) - (right.projection?.entryOrder ?? 500)
      || left.id.localeCompare(right.id)
    ))

  const standardZones = ['preset.system', 'setting.stable', 'chat.history', 'setting.lower', 'chat.before', 'chat.inside', 'chat.after', 'fresh.tail']
  const customZones = new Set<string>()

  for (const entry of entries) {
    const zone = entry.projection?.zoneId
    if (zone && !standardZones.includes(zone)) customZones.add(zone)
  }

  const children = [...standardZones, ...Array.from(customZones)].flatMap(zone => {
    const zoneEntries = entries.filter(entry => entry.projection?.zoneId === zone)
    if (zoneEntries.length === 0) return []
    return [{
      id: `${moduleNode.id}-zone-${zone}`,
      label: zone,
      kind: 'folder',
      isSection: true,
      children: options.groupSettingLayerSlots
        ? buildProjectionViewChildren(moduleNode.id, zoneEntries)
        : zoneEntries.map(entry => ({ ...entry, meta: entry.meta || 'zone projection' })),
    } satisfies ContextAssetNode]
  })

  return {
    ...moduleNode,
    children,
  }
}

function buildProjectionViewChildren(moduleId: string, entries: ContextAssetNode[]): ContextAssetNode[] {
  const children: ContextAssetNode[] = []
  const seenSlots = new Set<string>()

  for (const entry of entries) {
    const slotKey = readSlotKey(entry)
    if (!slotKey || !isSettingLayerSlot(slotKey)) {
      children.push({ ...entry, meta: entry.meta || 'zone projection' })
      continue
    }
    if (seenSlots.has(slotKey)) continue
    seenSlots.add(slotKey)
    children.push({
      id: `${moduleId}-slot-${slotKey}`,
      label: readSlotDisplayName(slotKey),
      kind: 'folder',
      isSection: true,
      children: entries
        .filter(item => readSlotKey(item) === slotKey)
        .map(item => ({ ...item, meta: item.meta || 'zone projection' })),
    })
  }

  return children
}
