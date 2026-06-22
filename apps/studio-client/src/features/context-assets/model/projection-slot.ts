import type { ContextAssetNode } from '../../../entities/index.js'
import type { ProjectionOrderEntry } from './projection-order.js'

export function readSlotKey(node: ContextAssetNode): string | undefined {
  return node.projection?.slotKey ?? (node.projection ? `${node.projection.group}@${node.projection.zone}` : undefined)
}

export function isSettingLayerSlot(slotKey: string): boolean {
  return slotKey.startsWith('setting-layer:')
}

export function readSlotDisplayName(slotKey: string): string {
  const sourceId = slotKey.slice(slotKey.indexOf(':') + 1, slotKey.lastIndexOf('@'))
  if (sourceId === 'city-layers-main') return 'from Loom City'
  return `from ${sourceId.replace(/-main$/, '').split('-').map(capitalize).join(' ')}`
}

export function readSlotEntrySummary(entries: ProjectionOrderEntry[]): string {
  return `${entries.length} entries`
}

function capitalize(value: string): string {
  return value ? `${value[0]?.toUpperCase()}${value.slice(1)}` : value
}
