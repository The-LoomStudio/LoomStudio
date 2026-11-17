import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { flattenTree, toTree } from '../../../packages/application-runtime/src/data/prompt-resource/tree.js'
import type { PromptResourceTreeNode } from '../../../packages/application-runtime/src/data/prompt-resource/types.js'

const treeArbitrary = fc.array(fc.record({
  kind: fc.constantFrom('folder', 'module', 'message', 'slot', 'virtual', 'entry', 'script'),
  label: fc.string({ minLength: 1, maxLength: 30 }),
  body: fc.option(fc.string({ maxLength: 100 }), { nil: undefined }),
  enabled: fc.option(fc.boolean(), { nil: undefined }),
  parent: fc.nat(),
}), { maxLength: 40 }).map(drafts => {
  const root: PromptResourceTreeNode = { id: 'root', kind: 'module', label: 'Root' }
  const containers = [root]
  for (const [index, { parent, ...draft }] of drafts.entries()) {
    const node: PromptResourceTreeNode = { ...draft, id: `node-${index}` }
    const owner = containers[parent % containers.length]!
    ;(owner.children ??= []).push(node)
    if (node.kind !== 'entry' && node.kind !== 'script') containers.push(node)
  }
  return { root, nodeCount: drafts.length + 1 }
})

describe('PromptResource tree invariants', () => {
  it('round-trips content and preserves every node, parent and sibling position', () => {
    fc.assert(fc.property(treeArbitrary, ({ root, nodeCount }) => {
      const timestamp = '2026-10-05T00:00:00.000Z'
      const nodes = flattenTree(root, 'resource', timestamp)
      expect(nodes.size).toBe(nodeCount)
      expect(toTree(nodes.get(root.id)!, nodes)).toEqual(root)

      function check(node: PromptResourceTreeNode, parentId: string | undefined, orderIndex: number): void {
        const stored = nodes.get(node.id)!
        expect(stored).toMatchObject({
          id: node.id, resourceId: 'resource', orderIndex,
          createdAt: timestamp, updatedAt: timestamp,
        })
        expect(stored.parentId).toBe(parentId)
        expect(stored).not.toHaveProperty('children')
        node.children?.forEach((child, index) => check(child, node.id, index))
      }
      check(root, undefined, 0)
    }), { numRuns: 100 })
  })
})
