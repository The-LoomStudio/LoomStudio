import { createApplicationRuntime, type ApplicationRuntimeOptions, type StateChangeEvent, type StateTarget } from '@loom-studio/application-runtime'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createNarrativeStore, createPromptResourceStore } from '@loom-studio/application-data'
import { describe, expect, it } from 'vitest'

function createTestRuntime(onStateChanged?: ApplicationRuntimeOptions['onStateChanged'], withNarratives = false) {
  let nextId = 0
  let nextTime = 0
  const createId = (prefix: string) => `${prefix}-${++nextId}`
  const now = () => `2026-08-25T01:00:${String(nextTime++).padStart(2, '0')}.000Z`
  const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
  const documents = createSqliteDocumentStore({ engine })
  const promptResources = createPromptResourceStore({ engine, createId, now })
  const narratives = withNarratives ? createNarrativeStore({ engine, createId, now }) : undefined
  const runtime = createApplicationRuntime({ dataEngine: engine, documents, narratives, promptResources, onStateChanged })
  return { engine, runtime }
}

describe('application state runtime', () => {
  it('rolls back a new default and its definition when an existing parent schema rejects it', async () => {
    const { engine, runtime } = createTestRuntime()
    try {
      await runtime.initialize()
      await runtime.upsertStateDefinition({ definitionId: 'settings', definition: {
        kind: 'global', path: 'global.settings', schema: { type: 'object', additionalProperties: false }, default: {},
      } })
      const before = await runtime.getStateSnapshot({ target: { scope: 'global' } })
      const count = countChangesets(engine)
      await expect(runtime.upsertStateDefinition({ definitionId: 'volume', definition: {
        kind: 'global', path: 'global.settings.volume', schema: { type: 'number' }, default: 1,
      } })).rejects.toMatchObject({ code: 'state.schema_additional_property' })
      expect(await runtime.getStateSnapshot({ target: { scope: 'global' } })).toEqual(before)
      await expect(runtime.getStateDefinition({ definitionId: 'volume' })).rejects.toThrow('Document not found')
      expect(countChangesets(engine)).toBe(count)
      await expect(runtime.applyStateMutation({ target: { scope: 'global' }, expectedRevisionId: before.snapshot.revisionId,
        operations: [{ op: 'set', path: '/unrelated', value: true }] })).resolves.toBeDefined()
    } finally { await engine.close() }
  })

  it.each(['schema', 'readOnly'])('rejects State compensation that violates the current %s without partial commits', async restriction => {
    const { engine, runtime } = createTestRuntime()
    try {
      await runtime.initialize()
      const definition = await runtime.upsertStateDefinition({
        definitionId: 'state.counter',
        definition: { kind: 'global', path: 'global.counter', schema: { type: 'number' }, default: 0 },
      })
      const before = await runtime.getStateSnapshot({ target: { scope: 'global' } })
      const changed = await runtime.applyStateMutation({
        target: { scope: 'global' }, expectedRevisionId: before.snapshot.revisionId,
        operations: [{ op: 'set', path: '/counter', value: 1 }],
      })
      await runtime.upsertStateDefinition({
        definitionId: 'state.counter', expectedVersion: definition.definition.version,
        definition: {
          kind: 'global', path: 'global.counter',
          schema: restriction === 'schema' ? { type: 'number', minimum: 1 } : { type: 'number' },
          ...(restriction === 'readOnly' ? { readOnly: true } : {}),
        },
      })
      const count = countChangesets(engine)
      await expect(runtime.revertChangeset({ changesetId: changed.mutation.changesetId })).rejects.toMatchObject({
        code: restriction === 'schema' ? 'state.schema_minimum' : 'state.read_only',
      })
      expect(countChangesets(engine)).toBe(count)
      expect((await runtime.getStateSnapshot({ target: { scope: 'global' } })).snapshot).toEqual(changed.snapshot)
    } finally { engine.close() }
  })

  it('checks Definition undo against current State and preserves valid undo/redo', async () => {
    const { engine, runtime } = createTestRuntime()
    try {
      await runtime.initialize()
      const definition = await runtime.upsertStateDefinition({
        definitionId: 'state.counter',
        definition: { kind: 'global', path: 'global.counter', schema: { type: 'number', maximum: 0 }, default: 0 },
      })
      const relaxed = await runtime.upsertStateDefinition({
        definitionId: 'state.counter', expectedVersion: definition.definition.version,
        definition: { kind: 'global', path: 'global.counter', schema: { type: 'number' } },
      })
      const before = await runtime.getStateSnapshot({ target: { scope: 'global' } })
      const changed = await runtime.applyStateMutation({
        target: { scope: 'global' }, expectedRevisionId: before.snapshot.revisionId,
        operations: [{ op: 'set', path: '/counter', value: 1 }],
      })
      const count = countChangesets(engine)
      await expect(runtime.revertChangeset({ changesetId: relaxed.mutation.changesetId })).rejects.toMatchObject({ code: 'state.schema_maximum' })
      expect(countChangesets(engine)).toBe(count)
      expect((await runtime.getStateDefinition({ definitionId: 'state.counter' })).definition).toEqual(relaxed.definition)
      expect((await runtime.getStateSnapshot({ target: { scope: 'global' } })).snapshot).toEqual(changed.snapshot)
      const undoneState = await runtime.revertChangeset({ changesetId: changed.mutation.changesetId })
      const undoneDefinition = await runtime.revertChangeset({ changesetId: relaxed.mutation.changesetId })
      expect((await runtime.getStateDefinition({ definitionId: 'state.counter' })).definition.schema.maximum).toBe(0)
      await runtime.revertChangeset({ changesetId: undoneDefinition.mutation.changesetId })
      expect((await runtime.getStateDefinition({ definitionId: 'state.counter' })).definition.schema).toEqual({ type: 'number' })
      await runtime.revertChangeset({ changesetId: undoneState.mutation.changesetId })
      expect((await runtime.getStateSnapshot({ target: { scope: 'global' } })).snapshot.value.counter).toBe(1)
    } finally { engine.close() }
  })

  it.each(['definition-first', 'mutation-first'])('validates Global Schema at commit time with %s', async order => {
    const { engine, runtime } = createTestRuntime()
    try {
      await runtime.initialize()
      const definition = await runtime.upsertStateDefinition({
        definitionId: 'state.counter',
        definition: { kind: 'global', path: 'global.counter', schema: { type: 'number' }, default: 0 },
      })
      const before = await runtime.getStateSnapshot({ target: { scope: 'global' } })
      const update = () => runtime.upsertStateDefinition({
        definitionId: 'state.counter', expectedVersion: definition.definition.version,
        definition: { kind: 'global', path: 'global.counter', schema: { type: 'number', maximum: 0 } },
      })
      const mutate = () => runtime.applyStateMutation({
        target: { scope: 'global' }, expectedRevisionId: before.snapshot.revisionId,
        operations: [{ op: 'set', path: '/counter', value: 1 }],
      })
      const results = await Promise.allSettled(order === 'definition-first' ? [update(), mutate()] : [mutate(), update()])
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
      const rejected = results.find(result => result.status === 'rejected')
      expect(rejected).toMatchObject({ reason: { code: 'state.schema_maximum' } })
      const current = await runtime.getStateSnapshot({ target: { scope: 'global' } })
      const currentDefinition = await runtime.getStateDefinition({ definitionId: 'state.counter' })
      if (currentDefinition.definition.schema.maximum === 0) expect(current.snapshot.value.counter).toBe(0)
      else expect(current.snapshot.value.counter).toBe(1)
    } finally { engine.close() }
  })

  it('does not write through a concurrently committed read-only Definition', async () => {
    const { engine, runtime } = createTestRuntime()
    try {
      await runtime.initialize()
      const definition = await runtime.upsertStateDefinition({
        definitionId: 'state.counter',
        definition: { kind: 'global', path: 'global.counter', schema: { type: 'number' }, default: 0 },
      })
      const before = await runtime.getStateSnapshot({ target: { scope: 'global' } })
      const [updated, changed] = await Promise.allSettled([
        runtime.upsertStateDefinition({
          definitionId: 'state.counter', expectedVersion: definition.definition.version,
          definition: { kind: 'global', path: 'global.counter', schema: { type: 'number' }, readOnly: true },
        }),
        runtime.applyStateMutation({
          target: { scope: 'global' }, expectedRevisionId: before.snapshot.revisionId,
          operations: [{ op: 'set', path: '/counter', value: 1 }],
        }),
      ])
      expect(updated.status).toBe('fulfilled')
      if (changed.status === 'rejected') {
        expect(changed.reason).toMatchObject({ code: 'state.read_only' })
        expect((await runtime.getStateSnapshot({ target: { scope: 'global' } })).snapshot.value.counter).toBe(0)
      } else if (updated.status === 'fulfilled') {
        const commits = engine.database.prepare('SELECT id FROM changesets ORDER BY rowid').all().map(row => row.id)
        expect(commits.indexOf(changed.value.mutation.changesetId)).toBeLessThan(commits.indexOf(updated.value.mutation.changesetId))
      }
    } finally { engine.close() }
  })

  it.each(['global', 'timeline'])('returns one receipt for concurrent identical %s requests and preserves undo/redo', async scope => {
    const events: StateChangeEvent[] = []
    const { engine, runtime } = createTestRuntime(event => { events.push(event) }, scope === 'timeline')
    try {
      await runtime.initialize()
      let target: StateTarget = { scope: 'global' }
      if (scope === 'timeline') {
        const { card } = await runtime.createCard({ name: 'State replay' })
        const { timeline, branch } = await runtime.createNarrativeTimeline({ cardId: card.id })
        target = { scope: 'timeline', timelineId: timeline.id, branchId: branch.id }
      }
      const before = await runtime.getStateSnapshot({ target })
      const count = countChangesets(engine)
      const eventCount = events.length
      const input = {
        target, expectedRevisionId: before.snapshot.revisionId,
        operations: [{ op: 'set' as const, path: '/counter', value: 1 }], idempotencyKey: 'concurrent',
      }
      const [first, replay] = await Promise.all([runtime.applyStateMutation(input), runtime.applyStateMutation(input)])
      expect(replay).toEqual(first)
      expect(countChangesets(engine)).toBe(count + 1)
      expect(events).toHaveLength(eventCount + 1)
      expect((await runtime.getStateSnapshot({ target: input.target })).snapshot).toEqual(first.snapshot)
      const undone = await runtime.revertChangeset({ changesetId: first.mutation.changesetId })
      expect((await runtime.getStateSnapshot({ target })).snapshot.value).toEqual(before.snapshot.value)
      await runtime.revertChangeset({ changesetId: undone.mutation.changesetId })
      expect((await runtime.getStateSnapshot({ target })).snapshot.value).toEqual(first.snapshot.value)
    } finally { engine.close() }
  })

  it('notifies only committed changes, including defaults and compensation but excluding replay and conflicts', async () => {
    const events: StateChangeEvent[] = []
    const { engine, runtime } = createTestRuntime(event => {
      expect(engine.database.prepare('SELECT id FROM changesets WHERE id = ?').get(event.changesetId)).toBeTruthy()
      events.push(event)
    })
    try {
      await runtime.initialize()
      const definition = await runtime.upsertStateDefinition({
        definitionId: 'state.counter',
        definition: { kind: 'global', path: 'global.counter', schema: { type: 'number' }, default: 0 },
      })
      const initial = await runtime.getStateSnapshot({ target: { scope: 'global' } })
      expect(events).toEqual([{
        target: { scope: 'global' }, revisionId: initial.snapshot.revisionId,
        changesetId: definition.mutation.changesetId, paths: ['/counter'],
      }])
      const input = {
        target: { scope: 'global' as const }, expectedRevisionId: initial.snapshot.revisionId,
        operations: [{ op: 'set' as const, path: '/counter', value: 1 }], idempotencyKey: 'once',
      }
      const changed = await runtime.applyStateMutation(input, { clientId: 'ui' })
      await runtime.applyStateMutation(input, { actor: { kind: 'extension', id: 'example' } })
      await expect(runtime.applyStateMutation({ ...input, idempotencyKey: undefined })).rejects.toMatchObject({ code: 'state.head_conflict' })
      expect(events).toHaveLength(2)
      expect(events[1]).toEqual({
        target: input.target, revisionId: changed.snapshot.revisionId,
        changesetId: changed.mutation.changesetId, paths: ['/counter'],
      })
      const reverted = await runtime.revertChangeset({ changesetId: changed.mutation.changesetId })
      const snapshot = await runtime.getStateSnapshot({ target: input.target })
      expect(events[2]).toEqual({
        target: input.target, revisionId: snapshot.snapshot.revisionId,
        changesetId: reverted.mutation.changesetId, paths: [''],
      })
      expect(snapshot.snapshot.value).toEqual({ counter: 0 })
    } finally {
      engine.close()
    }
  })

  it('does not undo a committed write when its notification observer throws', async () => {
    const { engine, runtime } = createTestRuntime(() => { throw new Error('Observer failed') })
    try {
      await runtime.initialize()
      const initial = await runtime.getStateSnapshot({ target: { scope: 'global' } })
      const changed = await runtime.applyStateMutation({
        target: initial.snapshot.target, expectedRevisionId: initial.snapshot.revisionId,
        operations: [{ op: 'set', path: '/value', value: 1 }],
      })
      expect((await runtime.getStateSnapshot({ target: initial.snapshot.target })).snapshot).toEqual(changed.snapshot)
    } finally {
      engine.close()
    }
  })

  it('does not notify when the transaction rolls back after creating a revision', async () => {
    const events: StateChangeEvent[] = []
    const { engine, runtime } = createTestRuntime(event => { events.push(event) })
    try {
      await runtime.initialize()
      const before = await runtime.getStateSnapshot({ target: { scope: 'global' } })
      const count = countChangesets(engine)
      engine.database.exec(`
        CREATE TRIGGER reject_state_head BEFORE UPDATE OF head_revision_id ON state_scopes
        BEGIN SELECT RAISE(ABORT, 'head update rejected'); END;
      `)
      await expect(runtime.applyStateMutation({
        target: before.snapshot.target, expectedRevisionId: before.snapshot.revisionId,
        operations: [{ op: 'set', path: '/value', value: 1 }],
      })).rejects.toThrow('head update rejected')
      expect(events).toEqual([])
      expect(await runtime.getStateSnapshot({ target: before.snapshot.target })).toEqual(before)
      expect(countChangesets(engine)).toBe(count)
    } finally {
      engine.close()
    }
  })

  it('rejects non-finite set operations without changing the committed snapshot', async () => {
    const { engine, runtime } = createTestRuntime()
    try {
      await runtime.initialize()
      const before = await runtime.getStateSnapshot({ target: { scope: 'global' } })
      for (const value of [NaN, Infinity, -Infinity]) {
        await expect(runtime.applyStateMutation({
          target: { scope: 'global' },
          expectedRevisionId: before.snapshot.revisionId,
          operations: [{ op: 'set', path: '/external', value: { nested: [value] } }],
        })).rejects.toMatchObject({ code: 'state.snapshot_invalid' })
        expect(await runtime.getStateSnapshot({ target: { scope: 'global' } })).toEqual(before)
      }
    } finally {
      await engine.close()
    }
  })

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

  it.each(['constructor', 'toString', '__proto__'])('initializes a missing own Global State key named %s', async key => {
    const { engine, runtime } = createTestRuntime()
    try {
      await runtime.initialize()
      await runtime.upsertStateDefinition({
        definitionId: 'state.own-key',
        definition: { kind: 'global', path: `global.${key}`, schema: { type: 'number' }, default: 7 },
      })
      const value = (await runtime.getStateSnapshot({ target: { scope: 'global' } })).snapshot.value
      expect(Object.hasOwn(value, key)).toBe(true)
      expect(value[key]).toBe(7)
      await expect(runtime.upsertStateDefinition({
        definitionId: 'state.incompatible',
        definition: { kind: 'global', path: `global.${key}`, schema: { type: 'string' } },
      })).rejects.toMatchObject({ code: 'state.schema_type' })
    } finally {
      await engine.close()
    }
  })

  it('stores prototype-like Global Definition paths as own State keys', async () => {
    const { engine, runtime } = createTestRuntime()
    const prototype = Object.prototype as Record<string, unknown>
    delete prototype.definitionValue

    try {
      await runtime.initialize()
      await runtime.upsertStateDefinition({
        definitionId: 'state.prototype-like',
        definition: {
          kind: 'global',
          path: 'global.__proto__.definitionValue',
          schema: { type: 'number' },
          default: 7,
        },
      })

      const value = (await runtime.getStateSnapshot({ target: { scope: 'global' } })).snapshot.value
      expect(JSON.parse(JSON.stringify(value))).toEqual(JSON.parse('{"__proto__":{"definitionValue":7}}'))
      expect(Object.hasOwn(value, '__proto__')).toBe(true)
      expect(({} as Record<string, unknown>).definitionValue).toBeUndefined()
    } finally {
      delete prototype.definitionValue
      engine.close()
    }
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
