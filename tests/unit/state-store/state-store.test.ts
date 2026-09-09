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
  it('migrates existing full-snapshot revisions without changing their values', async () => {
    let nextId = 0
    const createId = (prefix: string) => `${prefix}-${++nextId}`
    const now = () => '2026-09-09T00:00:00.000Z'
    const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
    engine.database.exec(`
      CREATE TABLE state_scopes (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('global', 'timeline')),
        owner_id TEXT NOT NULL,
        head_revision_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        UNIQUE(kind, owner_id),
        CHECK (kind = 'global' OR head_revision_id IS NULL)
      );
      CREATE TABLE state_revisions (
        id TEXT PRIMARY KEY,
        scope_id TEXT NOT NULL REFERENCES state_scopes(id),
        parent_revision_id TEXT REFERENCES state_revisions(id),
        changeset_id TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        operations_json TEXT NOT NULL,
        idempotency_key TEXT,
        created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_state_revisions_scope_idempotency
        ON state_revisions(scope_id, idempotency_key)
        WHERE idempotency_key IS NOT NULL;
      CREATE INDEX idx_state_revisions_scope_created
        ON state_revisions(scope_id, created_at, id);
      CREATE INDEX idx_state_revisions_parent
        ON state_revisions(parent_revision_id);
      INSERT INTO schema_migrations (namespace, version) VALUES ('application.state', 1);
      INSERT INTO state_scopes (
        id, kind, owner_id, head_revision_id, created_at, updated_at, deleted_at
      ) VALUES ('scope-old', 'global', 'workspace', 'revision-old', '${now()}', '${now()}', NULL);
      INSERT INTO state_revisions (
        id, scope_id, parent_revision_id, changeset_id,
        snapshot_json, operations_json, idempotency_key, created_at
      ) VALUES (
        'revision-old', 'scope-old', NULL, 'changeset-old',
        '{"legacy":true}', '[]', NULL, '${now()}'
      );
    `)

    const store = createStateStore({ engine, createId, now })
    expect((await store.getRevision('revision-old'))?.snapshot).toEqual({ legacy: true })
    const columns = engine.database.prepare('PRAGMA table_info(state_revisions)').all() as Array<{ name: string; notnull: number }>
    expect(columns.find(column => column.name === 'snapshot_json')?.notnull).toBe(0)
    expect(columns.some(column => column.name === 'delta_json')).toBe(true)
    engine.close()
  })

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

  it('stores ordinary revisions as deltas and materializes their full snapshots', async () => {
    const { engine, store, actor } = createTestContext()
    const padding = 'x'.repeat(1024)
    const created = await store.createScopeWithInitialRevision({
      actor,
      scope: { kind: 'global', ownerId: 'workspace' },
      revision: { snapshot: { counter: 0, nested: { keep: true, remove: true }, padding }, operations: [] },
    })

    const updated = await engine.transact({ actor }, async dataTx => {
      const state = store.transaction(dataTx)
      const revision = state.createRevision({
        scopeId: created.snapshot.scope.id,
        parentRevisionId: created.snapshot.revision.id,
        snapshot: { counter: 1, nested: { keep: false }, padding },
        operations: [{ op: 'set', path: '/counter', value: 1 }],
      }).revision
      state.setGlobalHead({
        scopeId: created.snapshot.scope.id,
        expectedRevisionId: created.snapshot.revision.id,
        revisionId: revision.id,
      })
      return revision
    })

    const stored = engine.database.prepare(`
      SELECT snapshot_json, delta_json, checkpoint_distance
      FROM state_revisions
      WHERE id = ?
    `).get(updated.value.id) as { snapshot_json: string | null; delta_json: string | null; checkpoint_distance: number }
    expect(stored.snapshot_json).toBeNull()
    expect(stored.delta_json).not.toBeNull()
    expect(stored.checkpoint_distance).toBe(1)
    expect((await store.getRevision(updated.value.id))?.snapshot).toEqual(updated.value.snapshot)
    expect((await store.getGlobalSnapshot())?.revision.snapshot).toEqual(updated.value.snapshot)
    engine.close()
  })

  it('creates periodic checkpoints and can rebuild after the materialization cache is discarded', async () => {
    const { engine, store, actor } = createTestContext()
    const padding = 'x'.repeat(1024)
    const created = await store.createScopeWithInitialRevision({
      actor,
      scope: { kind: 'global', ownerId: 'workspace' },
      revision: { snapshot: { counter: 0, padding }, operations: [] },
    })
    let revisionId = created.snapshot.revision.id

    for (let counter = 1; counter <= 32; counter += 1) {
      const previousRevisionId = revisionId
      const result = await engine.transact({ actor }, async dataTx => {
        const state = store.transaction(dataTx)
        const revision = state.createRevision({
          scopeId: created.snapshot.scope.id,
          parentRevisionId: previousRevisionId,
          snapshot: { counter, padding },
          operations: [{ op: 'set', path: '/counter', value: counter }],
        }).revision
        state.setGlobalHead({
          scopeId: created.snapshot.scope.id,
          expectedRevisionId: previousRevisionId,
          revisionId: revision.id,
        })
        return revision.id
      })
      revisionId = result.value
    }

    const stored = engine.database.prepare(`
      SELECT snapshot_json, delta_json, checkpoint_distance
      FROM state_revisions
      WHERE id = ?
    `).get(revisionId) as { snapshot_json: string | null; delta_json: string | null; checkpoint_distance: number }
    expect(stored.snapshot_json).not.toBeNull()
    expect(stored.delta_json).toBeNull()
    expect(stored.checkpoint_distance).toBe(0)

    const reopenedStore = createStateStore({ engine, createId: prefix => `${prefix}-reopened`, now: () => '2026-09-09T00:00:00.000Z' })
    expect((await reopenedStore.getRevision(revisionId))?.snapshot).toEqual({ counter: 32, padding })
    engine.close()
  })

  it('keeps large-world turn history compact while preserving historical recovery', async () => {
    const { engine, store, actor } = createTestContext()
    const entityCount = 48
    const turnCount = 96
    const componentPayload = 'component-data-'.repeat(48)
    const entities = Object.fromEntries(Array.from({ length: entityCount }, (_, index) => [
      `character-${index}`,
      {
        components: {
          identity: { name: `Character ${index}`, faction: index % 2 === 0 ? 'north' : 'south' },
          vitals: { hp: 100, mp: 40, stamina: 75 },
          inventory: { slots: Array.from({ length: 8 }, (_, slot) => `item-${index}-${slot}`) },
          notes: componentPayload,
        },
      },
    ]))
    const initialSnapshot = { entities: { characters: entities }, world: { day: 1, weather: 'clear' } }
    const created = await store.createScopeWithInitialRevision({
      actor,
      scope: { kind: 'timeline', ownerId: 'large-world' },
      revision: { snapshot: initialSnapshot, operations: [] },
    })

    const revisionIds = [created.snapshot.revision.id]
    const expectedSnapshots = [structuredClone(initialSnapshot)]
    let previousRevisionId = created.snapshot.revision.id
    let previousSnapshot = initialSnapshot
    for (let turn = 1; turn <= turnCount; turn += 1) {
      const nextSnapshot = structuredClone(previousSnapshot)
      const character = nextSnapshot.entities.characters[`character-${turn % entityCount}`]!
      character.components.vitals.hp = 100 - turn
      nextSnapshot.world.day = 1 + Math.floor(turn / 24)
      const result = await engine.transact({ actor }, async dataTx => {
        const state = store.transaction(dataTx)
        return state.createRevision({
          scopeId: created.snapshot.scope.id,
          parentRevisionId: previousRevisionId,
          snapshot: nextSnapshot,
          operations: [{ op: 'set', path: `/entities/characters/character-${turn % entityCount}/components/vitals/hp`, value: 100 - turn }],
        }).revision
      })
      previousRevisionId = result.value.id
      previousSnapshot = nextSnapshot
      revisionIds.push(result.value.id)
      expectedSnapshots.push(nextSnapshot)
    }

    const rows = engine.database.prepare(`
      SELECT id, snapshot_json, delta_json, checkpoint_distance
      FROM state_revisions
      WHERE scope_id = ?
      ORDER BY created_at, id
    `).all(created.snapshot.scope.id) as Array<{
      id: string
      snapshot_json: string | null
      delta_json: string | null
      checkpoint_distance: number
    }>
    const persistedBytes = rows.reduce((total, row) => total + Buffer.byteLength(row.snapshot_json ?? row.delta_json ?? ''), 0)
    const fullSnapshotBytes = expectedSnapshots.reduce((total, snapshot) => total + Buffer.byteLength(JSON.stringify(snapshot)), 0)
    const checkpointDistances = rows.map(row => row.checkpoint_distance)

    expect(rows).toHaveLength(turnCount + 1)
    expect(rows.filter(row => row.snapshot_json !== null)).toHaveLength(4)
    expect(Math.max(...checkpointDistances)).toBeLessThanOrEqual(31)
    expect(persistedBytes).toBeLessThan(fullSnapshotBytes / 2)

    const reopenedStore = createStateStore({
      engine,
      createId: prefix => `${prefix}-reopened`,
      now: () => '2026-08-25T01:00:00.000Z',
    })
    for (const index of [0, 1, 31, 32, 63, 64, turnCount]) {
      await expect(reopenedStore.getRevision(revisionIds[index]!)).resolves.toMatchObject({
        id: revisionIds[index],
        snapshot: expectedSnapshots[index],
      })
    }
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
