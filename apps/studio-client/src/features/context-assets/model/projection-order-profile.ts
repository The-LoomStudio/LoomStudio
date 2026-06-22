import type { ClientJsonValue } from '@loom-studio/client-bridge'
import type { ContextAssetNode, Session } from '../../../entities/index.js'
import { flattenContextNodes } from './projection-order.js'

export function readDemoProjectionOrderProfile(nodes: ContextAssetNode[], session: Session | undefined): ClientJsonValue | undefined {
  const orderNode = flattenContextNodes(nodes).find(node => node.kind === 'order')
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
