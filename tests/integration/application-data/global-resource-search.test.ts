import { createSqliteDataEngine } from '@loom-studio/data-engine'
import {
  createPromptResourceStore,
  createNarrativeStore,
  type PromptResourceStore,
  type PromptResourceTreeNode,
} from '@loom-studio/application-data'
import { describe, expect, it } from 'vitest'

const actor = { kind: 'system' as const, id: 'global-resource-search-test' }
const now = () => '2026-10-13T00:00:00.000Z'

function createEngine() {
  let sequence = 0
  return createSqliteDataEngine({ filename: ':memory:', createId: prefix => `${prefix}-${++sequence}`, now })
}

async function createDefinition(store: PromptResourceStore, id: string, children: PromptResourceTreeNode[], resourceKind = 'lore') {
  return store.createResource({
    actor, id, resourceKind, label: `来源${id}`, metadata: { author: '作者' },
    rootNode: { id: `${id}-root`, kind: 'module', label: `根${id}`, children },
  })
}

describe('global definition resource search', () => {
  it('browses nested entries in directory order with paths, pagination and no bodies', async () => {
    const engine = createEngine()
    const store = createPromptResourceStore({ engine, now })
    try {
      await createDefinition(store, 'directory', [
        { id: 'z-folder', kind: 'folder', label: '第一组', children: [
          { id: 'z-first', kind: 'entry', label: '先显示', body: '大段正文' },
          { id: 'a-second', kind: 'entry', label: '后显示', body: '另一段正文' },
        ] },
        { id: 'a-last', kind: 'entry', label: '末尾', body: '正文' },
      ])
      const ids: string[] = []
      let cursor: string | undefined
      do {
        const page = await store.listSearchNodes({ resourceId: 'directory', limit: 1, cursor })
        ids.push(...page.hits.map(hit => hit.nodeId))
        expect(page.hits.every(hit => hit.snippet === '')).toBe(true)
        if (!cursor) expect(page.hits[0]!.path).toEqual(['根directory', '第一组', '先显示'])
        cursor = page.nextCursor
      } while (cursor)
      expect(ids).toEqual(['z-first', 'a-second', 'a-last'])
      const first = await store.listSearchNodes({ resourceId: 'directory', limit: 1 })
      await expect(store.listSearchNodes({ resourceId: 'other', cursor: first.nextCursor })).rejects.toThrow('cursor')
      await store.deleteResource({ resourceId: 'directory', expectedVersion: 1, actor })
      expect((await store.listSearchNodes({ resourceId: 'directory' })).hits).toEqual([])
    } finally { await engine.close() }
  })

  it('lists only saved timeline name and origin fields for narrative navigation', async () => {
    const engine = createEngine()
    const store = createNarrativeStore({ engine, now })
    try {
      await store.createTimeline({
        actor, id: 'story', title: '剧情名称', createdFrom: { cardId: 'card', cardVersion: 2 }, stateRevisionId: 'state-1',
        openingNode: { body: { format: 'loom-markdown.v1', raw: '不属于全局搜索的剧情正文' } },
      })
      expect(await store.listSearchTimelines()).toEqual([{ id: 'story', title: '剧情名称', createdFrom: { cardId: 'card', cardVersion: 2 } }])
      await store.deleteTimeline({ actor, timelineId: 'story' })
      expect(await store.listSearchTimelines()).toEqual([])
    } finally { await engine.close() }
  })

  it('finds continuous Chinese, literal syntax, Unicode case and bounded authored snippets', async () => {
    const engine = createEngine()
    const store = createPromptResourceStore({ engine, now })
    try {
      await createDefinition(store, 'chinese', [
        { id: 'body-only', kind: 'entry', label: '地理', body: `${'遥远的土地'.repeat(80)}王都北境历史${'充满未知'.repeat(80)} {{notExecuted}}` },
        { id: 'meta-only', kind: 'entry', label: '说明', meta: '霜月城与南方贸易' },
        { id: 'syntax', kind: 'entry', label: '字面符号', body: '100%_真相 "王都" C:\\archive ÄBC É' },
        { id: 'syntax-decoy', kind: 'entry', label: '替代文本', body: '100XQ真相 archive abc e' },
      ])

      for (const query of ['王', '王都', '王都北境', '北境历史']) {
        const result = await store.searchNodes({ query })
        const hit = result.hits.find(item => item.nodeId === 'body-only')
        expect(hit).toMatchObject({ matchField: 'body', rank: 4, resourceId: 'chinese' })
        expect(hit?.snippet).toContain(query)
        expect(Array.from(hit!.snippet).length).toBeLessThanOrEqual(180)
        expect(hit).not.toHaveProperty('body')
      }
      expect((await store.searchNodes({ query: '霜月城' })).hits[0]).toMatchObject({ nodeId: 'meta-only', matchField: 'meta' })
      for (const query of ['%', '_', '%_真相', '"王都"', '\\', 'Äbc', 'é']) {
        expect((await store.searchNodes({ query })).hits.map(hit => hit.nodeId)).toEqual(['syntax'])
      }
      expect((await store.searchNodes({ query: '{{notExecuted}}' })).hits.map(hit => hit.nodeId)).toEqual(['body-only'])
      expect((await store.searchNodes({ query: '王都 不存在' })).hits).toEqual([])
    } finally { await engine.close() }
  })

  it('does not inherit resource or ancestor name matches for either short or long Chinese queries', async () => {
    const engine = createEngine()
    const store = createPromptResourceStore({ engine, now })
    try {
      await store.createResource({
        actor, id: 'other-world', resourceKind: 'lore', label: '异世界',
        rootNode: {
          id: 'world-root', kind: 'module', label: '异世界', children: [
            { id: 'world-document', kind: 'entry', label: '世界观.md', body: '这里记录基础设定' },
            { id: 'tavern', kind: 'entry', label: '酒馆', body: '店主经营一家旅舍' },
          ],
        },
      })
      expect((await store.searchNodes({ query: '世界', resourceIds: ['other-world'] })).hits.map(hit => hit.nodeId)).toEqual(['world-document', 'world-root'])
      expect((await store.searchNodes({ query: '异世界', resourceIds: ['other-world'] })).hits.map(hit => hit.nodeId)).toEqual(['world-root'])
      expect((await store.searchNodes({ query: '世界观', resourceIds: ['other-world'] })).hits).toMatchObject([
        { nodeId: 'world-document', path: ['异世界', '世界观.md'], matchField: 'label' },
      ])

      await store.createResource({
        actor, id: 'north-world', resourceKind: 'lore', label: '北境世界资料',
        rootNode: {
          id: 'north-root', kind: 'module', label: '资料集', children: [{
            id: 'north-folder', kind: 'folder', label: '北境世界', children: [
              { id: 'north-document', kind: 'entry', label: '北境世界指南.md' },
              { id: 'north-tavern', kind: 'entry', label: '酒馆', body: '店主经营一家旅舍' },
            ],
          }],
        },
      })
      for (const query of ['北境', '北境世界']) {
        expect((await store.searchNodes({ query, resourceIds: ['north-world'] })).hits.map(hit => hit.nodeId).sort()).toEqual(['north-document', 'north-folder'])
      }
      expect((await store.searchNodes({ query: '北境世界资料', resourceIds: ['north-world'] })).hits).toEqual([])
      expect((await store.searchNodes({ query: '北境世界 酒馆', resourceIds: ['north-world'] })).hits).toEqual([])
    } finally { await engine.close() }
  })

  it('matches every term across own fields, with scope and kind before stable pagination', async () => {
    const engine = createEngine()
    const store = createPromptResourceStore({ engine, now })
    try {
      await createDefinition(store, 'a-global', [{ id: 'global-exact', kind: 'entry', label: '王都', body: '地理' }])
      await createDefinition(store, 'z-scoped', [
        { id: 'name-exact', kind: 'entry', label: '王都' },
        { id: 'name-contains', kind: 'entry', label: '古代王都' },
        {
          id: 'cities', kind: 'folder', label: '北方都市', children: [
            { id: 'same-a', kind: 'entry', label: '同名', body: '王都在这里' },
            { id: 'same-b', kind: 'entry', label: '同名', body: '王都通商' },
          ],
        },
      ])
      await createDefinition(store, 'preset', [{ id: 'preset-entry', kind: 'entry', label: '王都' }], 'preset')
      const scoped = await store.searchNodes({ query: '王都', resourceIds: ['z-scoped'], limit: 1 })
      expect(scoped.hits.map(hit => hit.nodeId)).toEqual(['name-exact'])
      const nodeIds: string[] = [...scoped.hits.map(hit => hit.nodeId)]
      let cursor = scoped.nextCursor
      while (cursor) {
        const page = await store.searchNodes({ query: '王都', resourceIds: ['z-scoped'], limit: 1, cursor })
        nodeIds.push(...page.hits.map(hit => hit.nodeId))
        cursor = page.nextCursor
      }
      expect(nodeIds).toEqual(['name-exact', 'name-contains', 'same-a', 'same-b'])
      expect((await store.searchNodes({ query: '同名 通商' })).hits).toMatchObject([
        { nodeId: 'same-b', path: ['根z-scoped', '北方都市', '同名'], matchField: 'body' },
      ])
      expect((await store.searchNodes({ query: '北方都市' })).hits.map(hit => hit.nodeId)).toEqual(['cities'])
      expect((await store.searchNodes({ query: '北方都市 同名' })).hits).toEqual([])
      expect((await store.searchNodes({ query: '北方 同名' })).hits).toEqual([])
      expect((await store.searchNodes({ query: '王都', resourceIds: [] })).hits).toEqual([])
      expect((await store.searchNodes({ query: '王都', resourceIds: ['z-scoped'], resourceKinds: ['preset'] })).hits).toEqual([])
      expect((await store.searchNodes({ query: '王都', resourceKinds: ['preset'] })).hits.map(hit => hit.nodeId)).toEqual(['preset-entry'])
      await expect(store.searchNodes({ query: '王都', resourceIds: ['a-global'], cursor: scoped.nextCursor })).rejects.toMatchObject({ code: 'prompt_resource.cursor_invalid' })
    } finally { await engine.close() }
  })

  it('keeps rename, move, replace, revert, tombstone and restore consistent with the authoritative tree', async () => {
    const engine = createEngine()
    const store = createPromptResourceStore({ engine, now })
    try {
      const created = await createDefinition(store, 'lifecycle', [
        { id: 'old-folder', kind: 'folder', label: '旧城区域', children: [{ id: 'entry', kind: 'entry', label: '遗迹', body: '王都旧历史' }] },
        { id: 'new-folder', kind: 'folder', label: '新城区域' },
      ])
      const moved = await store.mutateResource({
        actor, resourceId: created.resource.id, expectedVersion: 1,
        mutations: [
          { kind: 'resource.update', patch: { label: '重命名世界书' } },
          { kind: 'node.move', nodeId: 'entry', parentId: 'new-folder', orderIndex: 0 },
        ],
      })
      expect((await store.searchNodes({ query: '王都' })).hits[0]).toMatchObject({ resourceLabel: '重命名世界书', path: ['根lifecycle', '新城区域', '遗迹'] })
      expect((await store.searchNodes({ query: '新城区域 王都' })).hits).toEqual([])
      expect((await store.searchNodes({ query: '旧城区域 王都' })).hits).toEqual([])
      expect((await store.searchNodes({ query: '重命名世界书 王都' })).hits).toEqual([])
      expect((await store.searchNodes({ query: '来源lifecycle' })).hits).toEqual([])
      const changed = await store.mutateResource({
        actor, resourceId: created.resource.id, expectedVersion: moved.resource.version,
        mutations: [{ kind: 'node.update', nodeId: 'entry', patch: { body: '海都新历史' } }],
      })
      expect((await store.searchNodes({ query: '王都' })).hits).toEqual([])
      expect((await store.searchNodes({ query: '海都新历史' })).hits.map(hit => hit.nodeId)).toEqual(['entry'])
      const reverted = await store.revertChangeset({ actor, changesetId: changed.commit.changesetId })
      expect((await store.searchNodes({ query: '王都旧历史' })).hits.map(hit => hit.nodeId)).toEqual(['entry'])
      expect((await store.searchNodes({ query: '海都' })).hits).toEqual([])
      const replaced = await store.mutateResource({
        actor, resourceId: created.resource.id, expectedVersion: reverted.resource.version,
        mutations: [{ kind: 'tree.replace', rootNode: { id: 'replacement-root', kind: 'module', label: '新树', children: [{ id: 'replacement-entry', kind: 'entry', label: '新内容', body: '荒野传说' }] } }],
      })
      expect((await store.searchNodes({ query: '王都' })).hits).toEqual([])
      expect((await store.searchNodes({ query: '荒野传说' })).hits.map(hit => hit.nodeId)).toEqual(['replacement-entry'])
      const restoredTree = await store.revertChangeset({ actor, changesetId: replaced.commit.changesetId })
      expect((await store.searchNodes({ query: '王都' })).hits.map(hit => hit.nodeId)).toEqual(['entry'])
      expect((await store.searchNodes({ query: '荒野' })).hits).toEqual([])
      const deleted = await store.deleteResource({ actor, resourceId: created.resource.id, expectedVersion: restoredTree.resource.version })
      expect((await store.searchNodes({ query: '王都' })).hits).toEqual([])
      expect(await store.listSearchResources()).toEqual([])
      await store.restoreResource({ actor, resourceId: created.resource.id, expectedVersion: deleted.resource.version })
      expect((await store.searchNodes({ query: '王都旧历史' })).hits.map(hit => hit.nodeId)).toEqual(['entry'])
    } finally { await engine.close() }
  })

  it('rolls index changes back with failed resource transactions', async () => {
    const engine = createEngine()
    const store = createPromptResourceStore({ engine, now })
    try {
      await createDefinition(store, 'rollback', [{ id: 'saved', kind: 'entry', label: '描述', body: '保留原始文字' }])
      await expect(engine.transact({ actor }, async tx => {
        store.transaction(tx).mutateResource({
          resourceId: 'rollback', expectedVersion: 1,
          mutations: [
            { kind: 'node.update', nodeId: 'saved', patch: { body: '不应提交的文字' } },
            { kind: 'node.create', parentId: 'rollback-root', node: { id: 'unsaved', kind: 'entry', label: '未提交', body: '不应提交的文字' } },
          ],
        })
        throw new Error('rollback probe')
      })).rejects.toThrow('rollback probe')
      expect((await store.searchNodes({ query: '保留原始' })).hits.map(hit => hit.nodeId)).toEqual(['saved'])
      expect((await store.searchNodes({ query: '不应提交' })).hits).toEqual([])
      expect((await store.getResource('rollback'))?.version).toBe(1)
    } finally { await engine.close() }
  })

  it('indexes current author resources without runtime resources or source names', async () => {
    const engine = createEngine()
    try {
      const store = createPromptResourceStore({ engine, now })
      engine.database.exec('BEGIN')
      for (const kind of ['lore', 'preset', 'runtime', 'history', 'prompt', 'logic']) {
        engine.database.prepare(`
          INSERT INTO prompt_resources (id, resource_kind, root_node_id, label, version, metadata_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, 1, '{"author":"旧作者"}', ?, ?)
        `).run(kind, kind, `${kind}-root`, `${kind}名称`, now(), now())
        engine.database.prepare(`
          INSERT INTO prompt_resource_nodes (id, resource_id, parent_id, order_index, kind, label, body, extra_json, created_at, updated_at)
          VALUES (?, ?, NULL, 0, 'module', ?, '迁移历史文字', '{}', ?, ?)
        `).run(`${kind}-root`, kind, `${kind}名称`, now(), now())
      }
      engine.database.exec('COMMIT')
      expect(engine.database.prepare('PRAGMA table_info(prompt_resource_node_search)').all().map(row => row.name)).toEqual(['label', 'meta', 'body'])
      expect((await store.searchNodes({ query: '迁移历史' })).hits.map(hit => hit.resourceId)).toEqual(['lore', 'preset'])
      expect(engine.database.prepare('SELECT count(*) AS count FROM prompt_resource_node_search').get()).toEqual({ count: 2 })
      expect(await store.listSearchResources()).toEqual([
        { id: 'lore', resourceKind: 'lore', label: 'lore名称', rootNodeId: 'lore-root', metadata: { author: '旧作者' } },
        { id: 'preset', resourceKind: 'preset', label: 'preset名称', rootNodeId: 'preset-root', metadata: { author: '旧作者' } },
      ])
      await createDefinition(store, 'future-runtime', [{ id: 'runtime-entry', kind: 'entry', label: '迁移历史', body: '迁移历史文字' }], 'runtime')
      expect((await store.searchNodes({ query: '迁移历史' })).hits.map(hit => hit.resourceId)).toEqual(['lore', 'preset'])
      expect(engine.database.prepare('SELECT count(*) AS count FROM prompt_resource_node_search').get()).toEqual({ count: 2 })
    } finally { await engine.close() }
  })
})
