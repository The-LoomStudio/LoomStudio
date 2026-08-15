import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createNarrativeStore } from '@loom-studio/narrative-store'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, vi } from 'vitest'

function createTestContext() {
  let nextId = 0
  let nextTime = 0
  const createId = (prefix: string) => `${prefix}-${++nextId}`
  const now = () => `2026-08-12T00:00:${String(nextTime++).padStart(2, '0')}.000Z`
  const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
  const store = createNarrativeStore({ engine, createId, now })
  const actor = { kind: 'system' as const, id: 'test' }
  return { engine, store, actor }
}

describe('narrative store', () => {
  it('creates a timeline, opening path, branch, and one commit without Document rows', async () => {
    const { engine, store, actor } = createTestContext()
    const observed = vi.fn()
    engine.subscribeCommits(observed)

    const created = await store.createTimeline({
      actor,
      title: 'Test Story',
      createdFrom: { cardId: 'card-1', cardVersion: 3 },
      promptResourceIds: ['setting-1', 'setting-1', 'preset-1'],
      openingNodes: [
        { body: { format: 'loom-markdown.v1', raw: 'Opening one' } },
        { body: { format: 'loom-markdown.v1', raw: 'Opening two' }, source: { runId: 'run-opening' } },
      ],
    })

    expect(created.timeline).toMatchObject({
      title: 'Test Story',
      promptResourceIds: ['setting-1', 'preset-1'],
      activeBranchId: created.branch.id,
    })
    expect(created.nodes).toHaveLength(2)
    expect(created.nodes[1]).toMatchObject({
      parentNodeId: created.nodes[0]?.id,
      source: { runId: 'run-opening', changesetId: created.commit.changesetId },
    })
    expect(created.branch.headNodeId).toBe(created.nodes[1]?.id)
    expect(created.commit.operations.map(operation => operation.entityType)).toEqual([
      'narrative.timeline',
      'narrative.branch',
      'narrative.node',
      'narrative.node',
    ])
    expect(observed).toHaveBeenCalledOnce()
    expect(engine.database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('documents', 'document_revisions')").all()).toEqual([])
    engine.close()
  })

  it('appends atomically with expected-head protection and pages toward history without offset', async () => {
    const { engine, store, actor } = createTestContext()
    const created = await store.createTimeline({
      actor,
      openingNodes: [{ body: { format: 'loom-markdown.v1', raw: 'one' } }],
    })
    const second = await store.appendNode({
      actor,
      timelineId: created.timeline.id,
      branchId: created.branch.id,
      expectedHeadNodeId: created.branch.headNodeId ?? null,
      body: { format: 'loom-markdown.v1', raw: 'two' },
    })
    const third = await store.appendNode({
      actor,
      timelineId: created.timeline.id,
      branchId: created.branch.id,
      expectedHeadNodeId: second.node.id,
      body: { format: 'loom-markdown.v1', raw: 'three' },
    })

    const latest = await store.getPage({ timelineId: created.timeline.id, limit: 2 })
    const older = await store.getPage({ timelineId: created.timeline.id, cursor: latest.nextCursor, limit: 2 })
    expect(latest.nodes.map(node => node.body.raw)).toEqual(['two', 'three'])
    expect(older.nodes.map(node => node.body.raw)).toEqual(['one'])
    expect(older.nextCursor).toBeUndefined()

    const commitsBeforeConflict = engine.database.prepare('SELECT COUNT(*) AS count FROM changesets').get() as { count: number }
    await expect(store.appendNode({
      actor,
      timelineId: created.timeline.id,
      branchId: created.branch.id,
      expectedHeadNodeId: second.node.id,
      body: { format: 'loom-markdown.v1', raw: 'stale write' },
    })).rejects.toMatchObject({ code: 'narrative.head_conflict' })
    const commitsAfterConflict = engine.database.prepare('SELECT COUNT(*) AS count FROM changesets').get() as { count: number }
    expect(commitsAfterConflict.count).toBe(commitsBeforeConflict.count)
    expect(await store.getNode(third.node.id)).toMatchObject({ body: { raw: 'three' } })
    expect(engine.database.prepare("SELECT id FROM narrative_nodes WHERE body_raw = 'stale write'").get()).toBeUndefined()
    engine.close()
  })

  it('updates Timeline Prompt Resource references with optimistic conflict protection', async () => {
    const { engine, store, actor } = createTestContext()
    const created = await store.createTimeline({ actor, promptResourceIds: ['preset-1', 'setting-1'] })

    const updated = await store.updatePromptResources({
      actor,
      timelineId: created.timeline.id,
      promptResourceIds: ['setting-1'],
      expectedPromptResourceIds: ['preset-1', 'setting-1'],
    })

    expect(updated.timeline.promptResourceIds).toEqual(['setting-1'])
    await expect(store.updatePromptResources({
      actor,
      timelineId: created.timeline.id,
      promptResourceIds: [],
      expectedPromptResourceIds: ['preset-1', 'setting-1'],
    })).rejects.toMatchObject({ code: 'narrative.prompt_resources_conflict' })
    engine.close()
  })

  it('rolls back an appended node and head update when the surrounding engine transaction fails', async () => {
    const { engine, store, actor } = createTestContext()
    const created = await store.createTimeline({
      actor,
      openingNodes: [{ body: { format: 'loom-markdown.v1', raw: 'stable head' } }],
    })
    const originalHead = created.branch.headNodeId
    const commitCountBefore = engine.database.prepare('SELECT COUNT(*) AS count FROM changesets').get() as { count: number }

    await expect(engine.transact({ actor }, async dataTx => {
      store.transaction(dataTx).appendNode({
        timelineId: created.timeline.id,
        branchId: created.branch.id,
        expectedHeadNodeId: originalHead ?? null,
        nodeId: 'rolled-back-node',
        body: { format: 'loom-markdown.v1', raw: 'must disappear' },
      })
      throw new Error('abort narrative transaction')
    })).rejects.toThrow('abort narrative transaction')

    expect(await store.getNode('rolled-back-node')).toBeNull()
    expect(await store.getBranch(created.branch.id)).toMatchObject({ headNodeId: originalHead })
    expect(engine.database.prepare('SELECT COUNT(*) AS count FROM changesets').get()).toEqual(commitCountBefore)
    engine.close()
  })

  it('forks only from the source branch path and switches branches independently', async () => {
    const { engine, store, actor } = createTestContext()
    const created = await store.createTimeline({
      actor,
      openingNodes: [
        { body: { format: 'loom-markdown.v1', raw: 'root' } },
        { body: { format: 'loom-markdown.v1', raw: 'main' } },
      ],
    })
    const fork = await store.forkBranch({
      actor,
      timelineId: created.timeline.id,
      fromBranchId: created.branch.id,
      fromNodeId: created.nodes[0]!.id,
      title: 'Alternative',
    })
    const forkAppend = await store.appendNode({
      actor,
      timelineId: created.timeline.id,
      branchId: fork.branch.id,
      expectedHeadNodeId: created.nodes[0]!.id,
      body: { format: 'loom-markdown.v1', raw: 'fork' },
    })
    const switched = await store.switchBranch({
      actor,
      timelineId: created.timeline.id,
      branchId: fork.branch.id,
      expectedActiveBranchId: created.branch.id,
    })

    expect(switched.timeline.activeBranchId).toBe(fork.branch.id)
    expect((await store.getPage({ timelineId: created.timeline.id })).nodes.map(node => node.body.raw)).toEqual(['root', 'fork'])
    expect((await store.getPage({ timelineId: created.timeline.id, branchId: created.branch.id })).nodes.map(node => node.body.raw)).toEqual(['root', 'main'])

    await expect(store.forkBranch({
      actor,
      timelineId: created.timeline.id,
      fromBranchId: created.branch.id,
      fromNodeId: forkAppend.node.id,
    })).rejects.toMatchObject({ code: 'narrative.node_not_in_branch' })
    await expect(store.getPage({
      timelineId: created.timeline.id,
      branchId: created.branch.id,
      cursor: forkAppend.node.id,
    })).rejects.toMatchObject({ code: 'narrative.cursor_not_in_branch' })
    engine.close()
  })

  it('lists timelines by source card and returns every branch for one timeline', async () => {
    const { engine, store, actor } = createTestContext()
    const older = await store.createTimeline({
      actor,
      createdFrom: { cardId: 'card-1', cardVersion: 1 },
      title: 'Older',
    })
    const newer = await store.createTimeline({
      actor,
      createdFrom: { cardId: 'card-1', cardVersion: 2 },
      title: 'Newer',
      openingNodes: [{ body: { format: 'loom-markdown.v1', raw: 'opening' } }],
    })
    await store.createTimeline({
      actor,
      createdFrom: { cardId: 'card-2', cardVersion: 1 },
      title: 'Other Card',
    })
    const fork = await store.forkBranch({
      actor,
      timelineId: newer.timeline.id,
      fromBranchId: newer.branch.id,
      fromNodeId: newer.nodes[0]!.id,
      title: 'Alternative',
    })

    const page = await store.listTimelines({ createdFromCardId: 'card-1', limit: 1 })
    const next = await store.listTimelines({ createdFromCardId: 'card-1', cursor: page.nextCursor, limit: 1 })
    expect(page.timelines.map(timeline => timeline.id)).toEqual([newer.timeline.id])
    expect(next.timelines.map(timeline => timeline.id)).toEqual([older.timeline.id])
    expect((await store.listBranches(newer.timeline.id)).map(branch => branch.id)).toEqual([
      newer.branch.id,
      fork.branch.id,
    ])
    engine.close()
  })

  it('supports cross-domain use of one engine transaction and tombstones only the timeline root', async () => {
    const { engine, store, actor } = createTestContext()
    const result = await engine.transact({ actor, reason: 'test.cross-domain' }, async dataTx => {
      const narrative = store.transaction(dataTx)
      const created = narrative.createTimeline({
        openingNodes: [{ body: { format: 'loom-markdown.v1', raw: 'created together' } }],
      })
      dataTx.database.exec('CREATE TABLE test_state (id TEXT PRIMARY KEY)')
      dataTx.database.prepare('INSERT INTO test_state (id) VALUES (?)').run('state-1')
      dataTx.recordOperations([{ store: 'test-state', kind: 'create', entityId: 'state-1', entityType: 'test.state' }])
      return created
    })

    expect(result.commit.operations.map(operation => operation.store)).toEqual([
      'narrative',
      'narrative',
      'narrative',
      'test-state',
    ])
    expect(engine.database.prepare('SELECT id FROM changesets').all()).toHaveLength(1)

    const deleted = await store.deleteTimeline({
      actor,
      timelineId: result.value.timeline.id,
      reason: 'test delete',
    })
    expect(deleted.timeline.deletedAt).toBeDefined()
    expect(await store.getTimeline(result.value.timeline.id)).toBeNull()
    expect(await store.getBranch(result.value.branch.id)).toBeNull()
    expect(await store.getNode(result.value.nodes[0]!.id)).toBeNull()
    expect(engine.database.prepare('SELECT COUNT(*) AS count FROM narrative_nodes').get()).toEqual({ count: 1 })
    engine.close()
  })

  it('persists the schema namespace and timeline data across engine instances', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'loom-narrative-'))
    const filename = join(directory, 'studio.sqlite')
    let nextId = 0
    const createId = (prefix: string) => `${prefix}-${++nextId}`
    const now = () => '2026-08-12T00:00:00.000Z'

    try {
      const firstEngine = createSqliteDataEngine({ filename, createId, now })
      const firstStore = createNarrativeStore({ engine: firstEngine, createId, now })
      const created = await firstStore.createTimeline({
        actor: { kind: 'system', id: 'test' },
        openingNodes: [{ body: { format: 'loom-markdown.v1', raw: 'persistent' } }],
      })
      firstEngine.close()

      const secondEngine = createSqliteDataEngine({ filename, createId, now })
      const secondStore = createNarrativeStore({ engine: secondEngine, createId, now })
      expect(await secondStore.getPage({ timelineId: created.timeline.id })).toMatchObject({
        nodes: [{ body: { raw: 'persistent' } }],
      })
      secondEngine.close()

      const database = new DatabaseSync(filename)
      const migration = database
        .prepare('SELECT version FROM schema_migrations WHERE namespace = ?')
        .get('application.narrative')
      const changesets = database.prepare('SELECT COUNT(*) AS count FROM changesets').get()
      database.close()
      expect(migration).toEqual({ version: 2 })
      expect(changesets).toEqual({ count: 1 })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
