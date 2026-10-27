import { createSqliteDataEngine } from '@loom-studio/data-engine'
import {
  createPromptResourceStore,
  type PromptResourceMutation,
  type PromptResourceTreeNode,
} from '@loom-studio/application-data'
import { createId, nowIso } from '@loom-studio/shared'
import { describe, expect, it } from 'vitest'

const actor = { kind: 'system' as const, id: 'write-result-contract' }

function createStore() {
  const engine = createSqliteDataEngine({ filename: ':memory:', createId, now: nowIso })
  return { engine, store: createPromptResourceStore({ engine }) }
}

function createTree(): PromptResourceTreeNode {
  return {
    id: 'root', kind: 'module', label: 'Root', extra: {},
    children: [
      {
        id: 'folder', kind: 'folder', label: 'Folder',
        children: [
          {
            id: 'entry-a', kind: 'entry', label: 'A', category: 'lore',
            body: '', enabled: false, meta: '',
            capabilities: { projection: { order: 0 }, custom: [null, false, ''] },
            extra: { custom: { value: 0 } },
          },
          { id: 'entry-b', kind: 'entry', label: 'B', body: 'B' },
        ],
      },
      { id: 'destination', kind: 'folder', label: 'Destination', children: [] },
    ],
  }
}

const edits: { name: string; mutations: PromptResourceMutation[]; check: (root: PromptResourceTreeNode) => void }[] = [
  {
    name: 'create with explicit sibling order',
    mutations: [{ kind: 'node.create', parentId: 'folder', node: { id: 'entry-c', kind: 'entry', label: 'C', orderIndex: 0, extra: {} } }],
    check: root => expect(root.children![0].children!.map(node => node.id)).toEqual(['entry-a', 'entry-c', 'entry-b']),
  },
  {
    name: 'clear optional fields without losing valid falsy values elsewhere',
    mutations: [{ kind: 'node.update', nodeId: 'entry-a', patch: { category: null, body: null, meta: null, enabled: null, capabilities: null, extra: null } }],
    check: root => expect(root.children![0].children![0]).toEqual({ id: 'entry-a', kind: 'entry', label: 'A' }),
  },
  {
    name: 'move into an empty folder',
    mutations: [{ kind: 'node.move', nodeId: 'entry-a', parentId: 'destination', orderIndex: 0 }],
    check: root => {
      expect(root.children![0].children!.map(node => node.id)).toEqual(['entry-b'])
      expect(root.children![1].children![0]).toMatchObject({ id: 'entry-a', enabled: false, body: '', meta: '' })
    },
  },
  {
    name: 'delete an entire subtree',
    mutations: [{ kind: 'node.delete', nodeId: 'folder' }],
    check: root => expect(root.children!.map(node => node.id)).toEqual(['destination']),
  },
  {
    name: 'update only the header',
    mutations: [{ kind: 'resource.update', patch: { label: '  Updated  ', metadata: { '': [0, false, null, ''] } } }],
    check: root => expect(root.children![0].children![0]).toMatchObject({ enabled: false, body: '', meta: '' }),
  },
  {
    name: 'replace the root and nested tree',
    mutations: [{ kind: 'tree.replace', rootNode: { id: 'new-root', kind: 'module', label: 'Replacement', extra: {}, children: [] } }],
    check: root => expect(root).toEqual({ id: 'new-root', kind: 'module', label: 'Replacement' }),
  },
]

describe('Prompt Resource write result contract', () => {
  it.each(edits)('keeps $name equal to persisted reads and reversible after caller edits the result', async ({ mutations, check }) => {
    const { engine, store } = createStore()
    try {
      const created = await store.createResource({
        actor, resourceKind: 'lore', rootNode: createTree(), metadata: { original: true },
      })
      expect(await store.getResource(created.resource.id)).toEqual(created.resource)
      expect(created.resource.rootNode).not.toHaveProperty('extra')
      expect(created.resource.rootNode.children![1]).not.toHaveProperty('children')

      const updated = await store.mutateResource({
        actor, resourceId: created.resource.id, expectedVersion: 1, mutations,
      })
      const snapshot = structuredClone(updated.resource)
      expect(snapshot.version).toBe(2)
      expect(await store.getResource(snapshot.id)).toEqual(snapshot)
      check(snapshot.rootNode)
      if (mutations[0].kind === 'resource.update') {
        expect(snapshot.label).toBe('Updated')
        expect(snapshot.metadata).toEqual({ '': [0, false, null, ''] })
      }

      updated.resource.metadata['caller-only'] = true
      updated.resource.rootNode.label = 'Caller edit'
      expect(await store.getResource(snapshot.id)).toEqual(snapshot)
      const reverted = await store.revertChangeset({
        actor, changesetId: updated.commit.changesetId, expectedVersion: 2,
      })
      expect(reverted.resource.version).toBe(3)
      expect(reverted.resource.rootNode).toEqual(created.resource.rootNode)
      expect(reverted.resource.metadata).toEqual(created.resource.metadata)
      expect(reverted.resource.label).toBe(created.resource.label)
      expect(await store.getResource(snapshot.id)).toEqual(reverted.resource)
    } finally {
      await engine.close()
    }
  })

  it('returns JSON-normalized writes equal to persisted reads', async () => {
    const { engine, store } = createStore()
    try {
      const created = await store.createResource({ actor, resourceKind: 'lore', rootNode: createTree() })
      const capabilities = Object.assign(Object.create(null), { custom: -0 })
      const updated = await store.mutateResource({
        actor, resourceId: created.resource.id, expectedVersion: 1,
        mutations: [{ kind: 'node.update', nodeId: 'entry-a', patch: { capabilities } }],
      })
      const storedCapabilities = updated.resource.rootNode.children![0].children![0].capabilities as { custom: number }

      expect(Object.is(capabilities.custom, -0)).toBe(true)
      expect(Object.is(storedCapabilities.custom, -0)).toBe(false)
      expect(Object.getPrototypeOf(capabilities)).toBeNull()
      expect(Object.getPrototypeOf(storedCapabilities)).toBe(Object.prototype)
      expect(await store.getResource(created.resource.id)).toEqual(updated.resource)
    } finally {
      await engine.close()
    }
  })
})
