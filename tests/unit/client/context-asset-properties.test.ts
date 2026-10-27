import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { ContextAssetNode } from '../../../apps/studio-client/src/entities/index.js'
import { flattenContextAssetNodes } from '../../../apps/studio-client/src/features/prompt-resources/model/context-asset-tree.js'
import {
  addContextAssetNode,
  deleteContextAssetNode,
  duplicateContextAssetNode,
  updateContextAssetNode,
} from '../../../apps/studio-client/src/features/prompt-resources/model/tree-ops.js'

describe('context asset tree operation invariants', () => {
  it('builds additions and subtree copies with fresh IDs without mutating the source', () => {
    const nodes = baseTree()
    const original = structuredClone(nodes)
    const before = flattenContextAssetNodes(nodes)
    const allocated = new Set(before.map(node => node.id))
    let idSequence = 0
    const makeId = () => `generated-${idSequence++}`
    for (const parentId of ['root', 'folder']) {
      const creation = addContextAssetNode(nodes, parentId, makeId)!
      expect(creation).toMatchObject({ targetAssetId: parentId, position: 'inside' })
      expect(allocated.has(creation.asset.id)).toBe(false)
      allocated.add(creation.asset.id)
      expect(flattenContextAssetNodes([creation.asset])).toHaveLength(1)
    }
    for (const target of before.filter(node => node.kind !== 'module')) {
      const creation = duplicateContextAssetNode(nodes, target.id, makeId)!
      const copied = flattenContextAssetNodes([creation.asset])
      expect(creation).toMatchObject({ targetAssetId: target.id, position: 'after' })
      expect(copied).toHaveLength(flattenContextAssetNodes([target]).length)
      for (const copy of copied) {
        expect(allocated.has(copy.id)).toBe(false)
        allocated.add(copy.id)
      }
      expect(creation.asset.label).toBe(`${target.label} Copy`)
      expect(deleteContextAssetNode(nodes, target.id, target.id)?.selectedId)
        .toBe(target.kind === 'entry' ? 'folder' : 'root')
    }
    expect(nodes).toEqual(original)
  })

  it('keeps only live order references when applying draft updates', () => {
    fc.assert(fc.property(fc.array(fc.constantFrom('entry-a', 'entry-b', 'missing')), references => {
      const nodes = baseTree()
      const updated = updateContextAssetNode(nodes, 'order', { orderList: references,
        slotRanks: [...nodes[0]!.children![1]!.slotRanks!, { zoneId: 'lore.stable', slotKey: 'missing', rankKey: 'a2' }] })
      const flattened = flattenContextAssetNodes(updated)
      expect(new Set(flattened.map(node => node.id)).size).toBe(flattened.length)
      expect(flattened.find(node => node.id === 'order')?.orderList).toEqual(references.filter(id => id !== 'missing'))
      expect(flattened.find(node => node.id === 'order')?.slotRanks?.map(rank => rank.slotKey)).toEqual(['slot-a', 'slot-b'])
      expect(flattenContextAssetNodes(nodes).find(node => node.id === 'order')?.orderList).toEqual(['entry-a', 'entry-b'])
    }), { numRuns: 100 })
  })
})

function baseTree(): ContextAssetNode[] {
  return [{
    id: 'root',
    label: 'Setting Root',
    kind: 'module',
    category: 'lore',
    children: [{
      id: 'folder',
      label: 'Entries',
      kind: 'folder',
      children: [entry('entry-a', 'slot-a', 10), entry('entry-b', 'slot-b', 20)],
    }, {
      id: 'order',
      label: 'Order',
      kind: 'order',
      orderList: ['entry-a', 'entry-b'],
      slotRanks: [{ zoneId: 'lore.stable', slotKey: 'slot-a', rankKey: 'a0' }, { zoneId: 'lore.stable', slotKey: 'slot-b', rankKey: 'a1' }],
    }],
  }]
}

function entry(id: string, slotKey: string, entryOrder: number): ContextAssetNode {
  return {
    id,
    label: id,
    kind: 'entry',
    enabled: true,
    body: '',
    projection: {
      zoneId: 'lore.stable',
      lifecycle: 'always',
      slotKey,
      entryOrder,
      order: `entry: ${entryOrder}`,
      sourceKind: 'actual',
    },
  }
}
