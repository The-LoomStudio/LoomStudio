import { describe, expect, it } from 'vitest'
import type { ContextAssetNode } from '../../../entities/index.js'
import { buildProjectionOrder } from './projection-order.js'
import { readProjectionOrderReorderUpdates } from './projection-workbench.js'

function entry(id: string, zoneId: string): ContextAssetNode {
  return {
    id,
    kind: 'entry',
    label: id,
    projection: {
      lifecycle: 'always',
      order: 'default',
      slotKey: `preset:root@${zoneId}`,
      sourceKind: 'actual',
      zoneId,
    },
  }
}

describe('projection workbench reorder updates', () => {
  it('moves an entry into the target zone as well as reordering it', () => {
    const dragged = entry('new-entry', 'setting.stable')
    const target = entry('assistant-entry', 'preset.system')
    const orderNode: ContextAssetNode = {
      id: 'order',
      kind: 'order',
      label: 'Order',
      orderList: [target.id, dragged.id],
    }
    const entries = buildProjectionOrder([dragged, target])

    expect(readProjectionOrderReorderUpdates({
      draggedId: dragged.id,
      orderedProjectionEntries: entries,
      orderNode,
      projectionEntries: entries,
      projectionOrderIds: [target.id, dragged.id],
      targetId: target.id,
    })).toEqual([
      {
        id: dragged.id,
        partial: {
          projection: expect.objectContaining({
            slotKey: 'preset:root@preset.system',
            zoneId: 'preset.system',
          }),
        },
      },
      {
        id: orderNode.id,
        partial: expect.objectContaining({ orderList: [dragged.id, target.id] }),
      },
    ])
  })
})
