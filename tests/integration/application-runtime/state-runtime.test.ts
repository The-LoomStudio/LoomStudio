import { createApplicationRuntime } from '@loom-studio/application-runtime'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createPromptResourceStore } from '@loom-studio/prompt-resource-store'
import { describe, expect, it } from 'vitest'

function createTestRuntime() {
  let nextId = 0
  let nextTime = 0
  const createId = (prefix: string) => `${prefix}-${++nextId}`
  const now = () => `2026-08-25T01:00:${String(nextTime++).padStart(2, '0')}.000Z`
  const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
  const documents = createSqliteDocumentStore({ engine })
  const promptResources = createPromptResourceStore({ engine, createId, now })
  const runtime = createApplicationRuntime({ dataEngine: engine, documents, promptResources })
  return { engine, runtime }
}

describe('application state runtime', () => {
  it('reverts a mixed Global Definition default Changeset atomically', async () => {
    const { engine, runtime } = createTestRuntime()
    await runtime.initialize()
    const created = await runtime.upsertStateDefinition({
      definitionId: 'state.mixed',
      definition: { kind: 'global', path: 'global.mixed', schema: { type: 'number' }, default: 3 },
    })

    await runtime.revertChangeset({ changesetId: created.mutation.changesetId })

    await expect(runtime.getStateDefinition({ definitionId: 'state.mixed' })).rejects.toThrow('Document not found')
    await expect(runtime.getStateSnapshot({ target: { scope: 'global' } })).resolves.toMatchObject({ snapshot: { value: {} } })
    engine.close()
  })

  it('stores State Definitions and initializes a missing global default in the same commit', async () => {
    const { engine, runtime } = createTestRuntime()
    await runtime.initialize()
    const created = await runtime.upsertStateDefinition({
      definitionId: 'state.gold',
      definition: {
        kind: 'global',
        path: 'global.gold',
        schema: { type: 'number', minimum: 0 },
        default: 10,
      },
    })

    expect((await runtime.getStateSnapshot({ target: { scope: 'global' } })).snapshot.value).toEqual({ gold: 10 })
    expect((await runtime.listStateDefinitions({ kind: 'global' })).definitions).toEqual([created.definition])
    await expect(runtime.upsertStateDefinition({
      definitionId: 'state.gold',
      expectedVersion: created.definition.version,
      definition: { kind: 'global', path: 'global.gold', schema: { type: 'string' } },
    })).rejects.toMatchObject({ code: 'state.schema_type' })
    const locked = await runtime.upsertStateDefinition({
      definitionId: 'state.locked',
      definition: { kind: 'global', path: 'global.locked', schema: { type: 'number' }, default: 1, readOnly: true },
    })
    const snapshot = await runtime.getStateSnapshot({ target: { scope: 'global' } })
    await expect(runtime.applyStateMutation({
      target: { scope: 'global' }, expectedRevisionId: snapshot.snapshot.revisionId,
      operations: [{ op: 'set', path: '/locked', value: 2 }],
    })).rejects.toMatchObject({ code: 'state.read_only' })
    await runtime.deleteStateDefinition({ definitionId: locked.definition.id, expectedVersion: locked.definition.version })
    await expect(runtime.deleteStateDefinition({
      definitionId: 'state.gold', expectedVersion: created.definition.version,
    })).resolves.toMatchObject({ deleted: true })
    engine.close()
  })

  it('initializes global state and applies set, increment, and remove operations', async () => {
    const { engine, runtime } = createTestRuntime()
    await runtime.initialize()
    const initial = await runtime.getStateSnapshot({ target: { scope: 'global' } })

    const first = await runtime.applyStateMutation({
      target: { scope: 'global' },
      expectedRevisionId: initial.snapshot.revisionId,
      operations: [
        { op: 'set', path: '/gold', value: 10 },
        { op: 'set', path: '/profile', value: { name: 'Alice', temporary: true } },
      ],
    })
    const second = await runtime.applyStateMutation({
      target: { scope: 'global' },
      expectedRevisionId: first.snapshot.revisionId,
      operations: [
        { op: 'increment', path: '/gold', by: -3 },
        { op: 'remove', path: '/profile/temporary' },
      ],
    })

    expect(second.snapshot.value).toEqual({ gold: 7, profile: { name: 'Alice' } })
    await expect(runtime.getStateSnapshot({ target: { scope: 'global' } })).resolves.toEqual({ snapshot: second.snapshot })
    engine.close()
  })

  it('protects the global head and replays one idempotent mutation without a second commit', async () => {
    const { engine, runtime } = createTestRuntime()
    await runtime.initialize()
    const initial = await runtime.getStateSnapshot({ target: { scope: 'global' } })
    const input = {
      target: { scope: 'global' as const },
      expectedRevisionId: initial.snapshot.revisionId,
      operations: [{ op: 'set' as const, path: '/gold', value: 10 }],
      idempotencyKey: 'tool-invocation-1',
    }
    const changesetsBefore = countChangesets(engine)
    const first = await runtime.applyStateMutation(input)
    const replay = await runtime.applyStateMutation(input)

    expect(replay).toEqual(first)
    expect(countChangesets(engine)).toBe(changesetsBefore + 1)
    await expect(runtime.applyStateMutation({
      ...input,
      idempotencyKey: undefined,
    })).rejects.toMatchObject({ code: 'state.head_conflict' })
    await expect(runtime.applyStateMutation({
      ...input,
      operations: [{ op: 'set', path: '/gold', value: 20 }],
    })).rejects.toMatchObject({ code: 'state.idempotency_conflict' })
    engine.close()
  })

  it('reverts only the current State head by creating a compensating revision', async () => {
    const { engine, runtime } = createTestRuntime()
    await runtime.initialize()
    const initial = await runtime.getStateSnapshot({ target: { scope: 'global' } })
    const changed = await runtime.applyStateMutation({
      target: { scope: 'global' }, expectedRevisionId: initial.snapshot.revisionId,
      operations: [{ op: 'set', path: '/gold', value: 10 }],
    })
    const reverted = await runtime.revertChangeset({ changesetId: changed.mutation.changesetId })
    const current = await runtime.getStateSnapshot({ target: { scope: 'global' } })

    expect(current.snapshot.value).toEqual({})
    expect(current.snapshot.revisionId).not.toBe(initial.snapshot.revisionId)
    expect(engine.database.prepare('SELECT id FROM state_revisions WHERE id = ?').get(changed.snapshot.revisionId))
      .toEqual({ id: changed.snapshot.revisionId })
    expect(reverted.mutation.changesetId).not.toBe(changed.mutation.changesetId)
    await expect(runtime.revertChangeset({ changesetId: changed.mutation.changesetId })).rejects.toMatchObject({ code: 'state.revert_conflict' })
    engine.close()
  })

  it('rejects unsupported timeline state and invalid mutations explicitly', async () => {
    const { engine, runtime } = createTestRuntime()
    await runtime.initialize()
    const initial = await runtime.getStateSnapshot({ target: { scope: 'global' } })

    await expect(runtime.getStateSnapshot({
      target: { scope: 'timeline', timelineId: 'timeline-1', branchId: 'branch-1' },
    })).rejects.toMatchObject({ code: 'state.timeline_not_initialized' })
    await expect(runtime.applyStateMutation({
      target: { scope: 'global' },
      expectedRevisionId: initial.snapshot.revisionId,
      operations: [],
    })).rejects.toMatchObject({ code: 'state.operations_empty' })
    await expect(runtime.applyStateMutation({
      target: { scope: 'global' },
      expectedRevisionId: initial.snapshot.revisionId,
      operations: [{ op: 'increment', path: '/missing', by: 1 }],
    })).rejects.toMatchObject({ code: 'state.path_not_found' })
    await expect(runtime.applyStateMutation({
      target: { scope: 'global' }, expectedRevisionId: initial.snapshot.revisionId,
      operations: [{ op: 'set', path: '/invalid~2path', value: true }],
    })).rejects.toMatchObject({ code: 'state.path_invalid' })
    await expect(runtime.applyStateMutation({
      target: { scope: 'global' }, expectedRevisionId: initial.snapshot.revisionId,
      operations: [{ op: 'unknown', path: '/value' } as never],
    })).rejects.toMatchObject({ code: 'state.operation_invalid' })
    engine.close()
  })
})

function countChangesets(engine: ReturnType<typeof createSqliteDataEngine>): number {
  return (engine.database.prepare('SELECT COUNT(*) AS count FROM changesets').get() as { count: number }).count
}
