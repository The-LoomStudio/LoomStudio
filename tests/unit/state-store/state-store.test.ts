import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createStateStore } from '@loom-studio/state-store'
import { describe, expect, it, vi } from 'vitest'

function createTestContext() {
  let nextId = 0
  let nextTime = 0
  const createId = (prefix: string) => `${prefix}-${++nextId}`
  const now = () => `2026-08-25T00:00:${String(nextTime++).padStart(2, '0')}.000Z`
  const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
  const store = createStateStore({ engine, createId, now })
  const actor = { kind: 'system' as const, id: 'test' }
  return { engine, store, actor }
}

describe('state store', () => {
  it('creates a global scope and initial full snapshot in one commit', async () => {
    const { engine, store, actor } = createTestContext()
    const observed = vi.fn()
    engine.subscribeCommits(observed)

    const created = await store.createScopeWithInitialRevision({
      actor,
      reason: 'test.create-global',
      scope: { kind: 'global', ownerId: 'workspace' },
      revision: {
        snapshot: { user: { name: 'Alice' } },
        operations: [{ op: 'set', path: '', value: { user: { name: 'Alice' } } }],
      },
    })

    expect(created.snapshot.scope).toMatchObject({
      kind: 'global',
      ownerId: 'workspace',
      headRevisionId: created.snapshot.revision.id,
    })
    expect(await store.getGlobalSnapshot()).toEqual(created.snapshot)
    expect(created.commit.operations.map(operation => operation.entityType)).toEqual([
      'state.scope',
      'state.revision',
      'state.scope',
    ])
    expect(observed).toHaveBeenCalledOnce()
    engine.close()
  })

  it('keeps global and timeline scopes unique by kind and owner', async () => {
    const { engine, store, actor } = createTestContext()
    await store.createScopeWithInitialRevision({
      actor,
      scope: { kind: 'global', ownerId: 'workspace' },
      revision: { snapshot: {}, operations: [] },
    })
    await store.createScopeWithInitialRevision({
      actor,
      scope: { kind: 'timeline', ownerId: 'workspace' },
      revision: { snapshot: {}, operations: [] },
    })

    await expect(store.createScopeWithInitialRevision({
      actor,
      scope: { kind: 'global', ownerId: 'workspace' },
      revision: { snapshot: {}, operations: [] },
    })).rejects.toMatchObject({ code: 'state.scope_conflict' })
    expect(await store.getScope({ kind: 'timeline', ownerId: 'workspace' })).not.toBeNull()
    engine.close()
  })

  it('creates revisions with parent protection and rejects cross-scope parents', async () => {
    const { engine, store, actor } = createTestContext()
    const global = await store.createScopeWithInitialRevision({
      actor,
      scope: { kind: 'global', ownerId: 'workspace' },
      revision: { snapshot: { gold: 10 }, operations: [] },
    })
    const timeline = await store.createScopeWithInitialRevision({
      actor,
      scope: { kind: 'timeline', ownerId: 'timeline-1' },
      revision: { snapshot: { scene: 1 }, operations: [] },
    })

    const updated = await engine.transact({ actor }, async dataTx => {
      const state = store.transaction(dataTx)
      const revision = state.createRevision({
        scopeId: global.snapshot.scope.id,
        parentRevisionId: global.snapshot.revision.id,
        snapshot: { gold: 8 },
        operations: [{ op: 'increment', path: '/gold', by: -2 }],
      }).revision
      state.setGlobalHead({
        scopeId: global.snapshot.scope.id,
        expectedRevisionId: global.snapshot.revision.id,
        revisionId: revision.id,
      })
      return revision
    })
    expect((await store.getGlobalSnapshot())?.revision.id).toBe(updated.value.id)

    await expect(engine.transact({ actor }, async dataTx => {
      store.transaction(dataTx).createRevision({
        scopeId: global.snapshot.scope.id,
        parentRevisionId: timeline.snapshot.revision.id,
        snapshot: {},
        operations: [],
      })
    })).rejects.toMatchObject({ code: 'state.revision_scope_mismatch' })
    engine.close()
  })

  it('replays identical idempotent revisions and rejects changed content', async () => {
    const { engine, store, actor } = createTestContext()
    const created = await store.createScopeWithInitialRevision({
      actor,
      scope: { kind: 'timeline', ownerId: 'timeline-1' },
      revision: { snapshot: {}, operations: [] },
    })
    const input = {
      scopeId: created.snapshot.scope.id,
      parentRevisionId: created.snapshot.revision.id,
      snapshot: { value: 1 },
      operations: [{ op: 'set', path: '/value', value: 1 }],
      idempotencyKey: 'tool-invocation-1',
    }

    const replay = await engine.transact({ actor }, async dataTx => {
      const state = store.transaction(dataTx)
      const first = state.createRevision(input)
      const second = state.createRevision(input)
      return { first, second }
    })
    expect(replay.value.first.replayed).toBe(false)
    expect(replay.value.second).toEqual({ revision: replay.value.first.revision, replayed: true })

    await expect(engine.transact({ actor }, async dataTx => {
      store.transaction(dataTx).createRevision({
        ...input,
        snapshot: { value: 2 },
      })
    })).rejects.toMatchObject({ code: 'state.idempotency_conflict' })
    engine.close()
  })

  it('tombstones scopes, preserves revision audit reads, and rolls back failed transactions', async () => {
    const { engine, store, actor } = createTestContext()
    const created = await store.createScopeWithInitialRevision({
      actor,
      scope: { kind: 'timeline', ownerId: 'timeline-1' },
      revision: { snapshot: { stable: true }, operations: [] },
    })

    await expect(engine.transact({ actor }, async dataTx => {
      store.transaction(dataTx).createRevision({
        id: 'rolled-back-revision',
        scopeId: created.snapshot.scope.id,
        parentRevisionId: created.snapshot.revision.id,
        snapshot: { stable: false },
        operations: [],
      })
      throw new Error('abort state transaction')
    })).rejects.toThrow('abort state transaction')
    expect(await store.getRevision('rolled-back-revision')).toBeNull()

    await engine.transact({ actor }, async dataTx => {
      store.transaction(dataTx).tombstoneScope({ scopeId: created.snapshot.scope.id })
    })
    expect(await store.getScopeById(created.snapshot.scope.id)).toBeNull()
    expect(await store.getScopeById(created.snapshot.scope.id, { includeDeleted: true })).toMatchObject({ deletedAt: expect.any(String) })
    expect(await store.getRevision(created.snapshot.revision.id)).toEqual(created.snapshot.revision)
    await expect(engine.transact({ actor }, async dataTx => {
      store.transaction(dataTx).createRevision({
        scopeId: created.snapshot.scope.id,
        parentRevisionId: created.snapshot.revision.id,
        snapshot: {},
        operations: [],
      })
    })).rejects.toMatchObject({ code: 'state.scope_not_found' })
    engine.close()
  })
})
