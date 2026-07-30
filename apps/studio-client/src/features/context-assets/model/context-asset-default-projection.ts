import type { ContextAssetNode } from '../../../entities/index.js'
import { flattenContextAssetNodes } from './context-asset-tree.js'

export function createDefaultProjection(
  category: ContextAssetNode['category'],
  siblings: ContextAssetNode[],
): NonNullable<ContextAssetNode['projection']> {
  const inherited = flattenContextAssetNodes(siblings).find(node => node.projection?.sourceKind !== 'virtual')?.projection
  if (inherited) {
    const slotKey = inherited.slotKey ?? `${inherited.zoneId}@${inherited.zoneId}`
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
  const zoneId = preset ? 'preset.system' : 'setting.stable'
  const slotKey = preset ? 'preset:default-airp-preset@preset.system' : 'setting-layer:city-layers-main@setting.stable'
  const entryOrder = readNextEntryOrder(siblings, slotKey)

  return {
    entryOrder,
    zoneId,
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
