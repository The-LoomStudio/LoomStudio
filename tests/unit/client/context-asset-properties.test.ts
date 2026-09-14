import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { ContextAssetNode } from '../../../apps/studio-client/src/entities/index.js'
import { flattenContextAssetNodes } from '../../../apps/studio-client/src/features/context-assets/model/context-asset-tree.js'
import {
  addContextAssetNode,
  deleteContextAssetNode,
  duplicateContextAssetNode,
  moveContextAssetNode,
} from '../../../apps/studio-client/src/features/context-assets/model/tree-ops.js'

type TreeOperation = {
  kind: 'add' | 'delete' | 'duplicate' | 'move'
  first: number
  second: number
  after: boolean
}

const operationArbitrary: fc.Arbitrary<TreeOperation> = fc.record({
  kind: fc.constantFrom('add', 'delete', 'duplicate', 'move'),
  first: fc.nat(),
  second: fc.nat(),
  after: fc.boolean(),
})

describe('context asset tree operation invariants', () => {
  it('preserves unique ids, live order references, and node counts across operation sequences', () => {
    fc.assert(fc.property(fc.array(operationArbitrary, { maxLength: 80 }), operations => {
      let nodes = baseTree()
      let idSequence = 0

      for (const operation of operations) {
        const before = flattenContextAssetNodes(nodes)
        if (operation.kind === 'add') {
          const containers = before.filter(node => node.kind === 'module' || node.kind === 'folder' || node.kind === 'message')
          const parent = pick(containers, operation.first)
          if (parent) {
            const result = addContextAssetNode(nodes, parent.id, () => `generated-${idSequence++}`)
            const expected = result.selectedId ? before.length + 1 : before.length
            nodes = result.nodes
            expect(flattenContextAssetNodes(nodes)).toHaveLength(expected)
          }
        } else if (operation.kind === 'duplicate') {
          const candidates = before.filter(node => node.kind !== 'module')
          const target = pick(candidates, operation.first)
          if (target) {
            const result = duplicateContextAssetNode(nodes, target.id, () => `generated-${idSequence++}`)
            const expected = result.selectedId ? before.length + flattenContextAssetNodes([target]).length : before.length
            nodes = result.nodes
            expect(flattenContextAssetNodes(nodes)).toHaveLength(expected)
          }
        } else if (operation.kind === 'delete') {
          const candidates = before.filter(node => node.kind !== 'module')
          const target = pick(candidates, operation.first)
          if (target) {
            const removedCount = flattenContextAssetNodes([target]).length
            const result = deleteContextAssetNode(nodes, target.id, target.id)
            nodes = result.nodes
            expect(flattenContextAssetNodes(nodes)).toHaveLength(before.length - removedCount)
          }
        } else {
          const dragged = pick(before.filter(node => node.kind !== 'module'), operation.first)
          const target = pick(before, operation.second)
          if (dragged && target) {
            const position = isContainer(target) ? 'inside' : operation.after ? 'after' : 'before'
            nodes = moveContextAssetNode(nodes, dragged.id, target.id, position)
            expect(flattenContextAssetNodes(nodes)).toHaveLength(before.length)
          }
        }

        expectTreeInvariants(nodes)
      }
    }), { numRuns: 200 })
  })
})

function expectTreeInvariants(nodes: ContextAssetNode[]): void {
  const flattened = flattenContextAssetNodes(nodes)
  const ids = flattened.map(node => node.id)
  const liveIds = new Set(ids)
  const liveSlotKeys = new Set(flattened.flatMap(node => node.projection?.slotKey ? [node.projection.slotKey] : []))

  expect(nodes.some(node => node.id === 'root')).toBe(true)
  expect(new Set(ids).size).toBe(ids.length)
  for (const node of flattened) {
    expect(node.orderList?.every(id => liveIds.has(id)) ?? true).toBe(true)
    expect(node.slotRanks?.every(rank => liveSlotKeys.has(rank.slotKey)) ?? true).toBe(true)
  }
}

function pick<T>(values: T[], index: number): T | undefined {
  return values.length === 0 ? undefined : values[index % values.length]
}

function isContainer(node: ContextAssetNode): boolean {
  return node.children !== undefined || node.kind === 'module' || node.kind === 'folder' || node.kind === 'message' || node.kind === 'slot'
}

function baseTree(): ContextAssetNode[] {
  return [{
    id: 'root',
    label: 'Setting Root',
    kind: 'module',
    category: 'setting',
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
      slotRanks: [{ slotKey: 'slot-a', rank: 10 }, { slotKey: 'slot-b', rank: 20 }],
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
      zoneId: 'setting.stable',
      slotKey,
      entryOrder,
      order: `entry: ${entryOrder}`,
      sourceKind: 'actual',
    },
  }
}
