import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createPromptResourceStore } from '@loom-studio/application-data'
import { createId, nowIso } from '@loom-studio/shared'
import { describe, expect, it } from 'vitest'
import { listMappedResources } from '../../../packages/application-runtime/src/prompt/prompt-resource-mapper.js'

const actor = { kind: 'system' as const, id: 'pagination-test' }
function fixture() {
  const engine = createSqliteDataEngine({ filename: ':memory:', createId, now: nowIso })
  let time = 0
  const store = createPromptResourceStore({ engine, now: () => new Date(++time * 1000).toISOString() })
  return { engine, store }
}

describe('Prompt Resource keyset pagination', () => {
  it('keeps stable identity traversal while exposing only new IDs after its boundary', async () => {
    const { engine, store } = fixture()
    const create = (id: string) => store.createResource({
      actor, id, resourceKind: 'setting',
      rootNode: { id: `${id}-root`, kind: 'module', label: id },
    })
    try {
      for (const id of ['a', 'b', 'c']) await create(id)
      const first = await store.listResources({ order: 'id', limit: 2 })
      expect(first.resources.map(resource => resource.id)).toEqual(['c', 'b'])
      await store.deleteResource({ actor, resourceId: 'b', expectedVersion: 1 })
      await create('d')
      await create('aa')
      const second = await store.listResources({ order: 'id', limit: 2, cursor: first.nextCursor })
      expect(second.resources.map(resource => resource.id)).toEqual(['aa', 'a'])
      expect(second.nextCursor).toBeUndefined()
    } finally {
      await engine.close()
    }
  })

  it('keeps the original time boundary after cursor deletion or a read item update', async () => {
    const { engine, store } = fixture()
    try {
      for (const id of ['a', 'b', 'c']) {
        await store.createResource({ id, resourceKind: 'setting', actor, rootNode: { id: `${id}-root`, label: id, kind: 'module' } })
      }
      const first = await store.listResources({ limit: 2, resourceKind: 'setting' })
      expect(first.resources.map(item => item.id)).toEqual(['c', 'b'])
      await store.deleteResource({ actor, resourceId: 'b', expectedVersion: 1 })
      await store.mutateResource({ actor, resourceId: 'c', expectedVersion: 1, mutations: [{ kind: 'resource.update', patch: { label: 'Updated' } }] })
      const second = await store.listResources({ limit: 2, resourceKind: 'setting', cursor: first.nextCursor })
      expect(second.resources.map(item => item.id)).toEqual(['a'])
      expect(second.nextCursor).toBeUndefined()
      for (const changed of [{ resourceKind: 'preset' as const }, { order: 'id' as const }, { includeTombstone: true }]) {
        await expect(store.listResources({ resourceKind: 'setting', ...changed, cursor: first.nextCursor }))
          .rejects.toMatchObject({ code: 'prompt_resource.cursor_invalid' })
      }
      for (const cursor of ['', '2', '{}', 'null']) {
        await expect(store.listResources({ cursor })).rejects.toMatchObject({ code: 'prompt_resource.cursor_invalid' })
      }
    } finally {
      await engine.close()
    }
  })

  it('collects more than 500 identities despite an unread resource moving to the latest time', async () => {
    const { engine, store } = fixture()
    try {
      await engine.transact({ actor }, async tx => {
        const writer = store.transaction(tx)
        for (let index = 0; index < 501; index++) {
          const id = `resource-${String(index).padStart(3, '0')}`
          writer.createResource({ actor, id, resourceKind: 'setting', rootNode: { id: `${id}-root`, label: id, kind: 'module', category: 'setting' } })
        }
      })
      let pages = 0
      const resources = await listMappedResources({
        ...store,
        listResources: async input => {
          const page = await store.listResources(input)
          if (++pages === 1) {
            await store.mutateResource({
              actor, resourceId: 'resource-000', expectedVersion: 1,
              mutations: [{ kind: 'resource.update', patch: { label: 'Updated unread resource' } }],
            })
          }
          return page
        },
      }, 'setting')
      expect(pages).toBe(2)
      expect(resources).toHaveLength(501)
      expect(new Set(resources.map(item => item.id)).size).toBe(501)
      expect(resources.find(item => item.id === 'resource-000')?.version).toBe(2)
    } finally {
      await engine.close()
    }
  })
})
