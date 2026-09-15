import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  flattenTree,
  toTree,
  type PromptResourceTreeNode,
  type PromptResourceNodeKind,
  containerNodeKinds,
  nonContainerNodeKinds,
} from '../../../packages/application-data/src/prompt-resource/tree.js'

const validKinds: PromptResourceNodeKind[] = [
  'module',
  'folder',
  'message',
  'slot',
  'virtual',
  'entry',
  'script',
]

// 构造单节点生成器
function arbitraryLeaf(id: string): fc.Arbitrary<PromptResourceTreeNode> {
  return fc.record({
    id: fc.constant(id),
    kind: fc.constantFrom<PromptResourceNodeKind>('entry', 'script'),
    label: fc.string({ minLength: 1, maxLength: 30 }),
    body: fc.option(fc.string({ maxLength: 100 }), { nil: undefined }),
    enabled: fc.option(fc.boolean(), { nil: undefined }),
  })
}

// 递归构造随机深度与分支的 PromptResource 有序树
function arbitraryTree(idPrefix = 'node', depth = 3): fc.Arbitrary<PromptResourceTreeNode> {
  if (depth <= 0) {
    return arbitraryLeaf(`${idPrefix}-leaf`)
  }

  return fc.record({
    id: fc.constant(`${idPrefix}-container`),
    kind: fc.constantFrom<PromptResourceNodeKind>('module', 'folder', 'slot'),
    label: fc.string({ minLength: 1, maxLength: 30 }),
    enabled: fc.option(fc.boolean(), { nil: undefined }),
    children: fc.array(
      fc.nat(100).chain(n => arbitraryTree(`${idPrefix}-${n}`, depth - 1)),
      { minLength: 0, maxLength: 4 },
    ),
  })
}

describe('PromptResource tree fast-check property invariants', () => {
  it('preserves isomorphism across flattenTree and toTree', () => {
    let sequence = 0
    // 构造具有全局唯一 ID 的有效测试树
    const uniqueTreeArbitrary = fc.nat({ max: 4 }).chain(depth => {
      function generateUnique(depthRemaining: number): PromptResourceTreeNode {
        const id = `node-${++sequence}`
        if (depthRemaining <= 0) {
          return {
            id,
            kind: 'entry',
            label: `Leaf ${id}`,
            body: `Content for ${id}`,
          }
        }
        const childCount = Math.floor(Math.random() * 3)
        const children: PromptResourceTreeNode[] = []
        for (let i = 0; i < childCount; i++) {
          children.push(generateUnique(depthRemaining - 1))
        }
        return {
          id,
          kind: 'folder',
          label: `Folder ${id}`,
          ...(children.length > 0 ? { children } : {}),
        }
      }
      return fc.constant(generateUnique(depth))
    })

    fc.assert(
      fc.property(uniqueTreeArbitrary, root => {
        const resourceId = 'res-1'
        const timestamp = '2026-09-15T00:00:00.000Z'

        // 1. 展平树
        const flatMap = flattenTree(root, resourceId, timestamp)
        expect(flatMap.size).toBeGreaterThan(0)

        // 2. 根节点与所有子节点 ID 必须包含在 Map 中
        expect(flatMap.has(root.id)).toBe(true)

        // 3. 重构树必须与原始树 100% 同构等价
        const reconstructed = toTree(flatMap.get(root.id)!, flatMap)
        expect(reconstructed).toEqual(root)
      }),
      { numRuns: 100 },
    )
  })

  it('guarantees unique parent-child containment and no orphan nodes', () => {
    let sequence = 0
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 20 }), nodeCount => {
        const rootId = `root-${++sequence}`
        const root: PromptResourceTreeNode = {
          id: rootId,
          kind: 'module',
          label: 'Root',
          children: [],
        }

        // 随机挂载节点
        const allNodes: PromptResourceTreeNode[] = [root]
        for (let i = 0; i < nodeCount; i++) {
          const id = `child-${++sequence}`
          const isContainer = i % 2 === 0
          const node: PromptResourceTreeNode = {
            id,
            kind: isContainer ? 'folder' : 'entry',
            label: `Node ${id}`,
          }
          // 随机选择一个已有的容器挂载
          const containers = allNodes.filter(n => containerNodeKinds.has(n.kind))
          const parent = containers[Math.floor(Math.random() * containers.length)]!
          if (!parent.children) parent.children = []
          parent.children.push(node)
          if (isContainer) allNodes.push(node)
        }

        const flatMap = flattenTree(root, 'res-test', '2026-09-15T00:00:00.000Z')

        // 节点总数必须严格守恒
        let expectedCount = 0
        const count = (n: PromptResourceTreeNode) => {
          expectedCount++
          for (const c of n.children ?? []) count(c)
        }
        count(root)

        expect(flatMap.size).toBe(expectedCount)

        // 除了根节点，每个节点的 parentId 都必须指向已存在的节点
        for (const [id, stored] of flatMap) {
          if (id === root.id) {
            expect(stored.parentId).toBeUndefined()
          } else {
            expect(stored.parentId).toBeDefined()
            expect(flatMap.has(stored.parentId!)).toBe(true)
          }
        }
      }),
      { numRuns: 80 },
    )
  })
})
