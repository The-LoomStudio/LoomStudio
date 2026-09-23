import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createStateStore } from '@loom-studio/application-data'
import type { JsonObject } from '@loom-studio/shared'
import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'

it('replays own prototype-like delta keys and rejects inherited delta parents', async () => {
  const engine = createSqliteDataEngine({
    filename: ':memory:', createId: prefix => `${prefix}-${randomUUID()}`, now: () => new Date().toISOString(),
  })
  const store = createStateStore({ engine })
  const actor = { kind: 'system' as const, id: 'state-prototype-test' }
  try {
    const initial: JsonObject = { padding: 'x'.repeat(2048) }
    const own: JsonObject = {
      ...initial,
      ...JSON.parse('{"__proto__":{"fr008Delta":1,"":null},"constructor":{"prototype":{"value":2}}}'),
    }
    const updated: JsonObject = {
      ...initial,
      ...JSON.parse('{"__proto__":{"fr008Delta":3,"":null},"constructor":{"prototype":{"value":4}}}'),
    }
    const created = await store.createScopeWithInitialRevision({
      actor, scope: { kind: 'global', ownerId: 'workspace' },
      revision: { snapshot: initial, operations: [] },
    })
    let parentRevisionId = created.snapshot.revision.id
    const ids: string[] = []
    for (const snapshot of [own, updated, initial]) {
      const result = await engine.transact({ actor }, async tx => store.transaction(tx).createRevision({
        scopeId: created.snapshot.scope.id, parentRevisionId, snapshot, operations: [],
      }).revision)
      ids.push(result.value.id)
      parentRevisionId = result.value.id
      expect(engine.database.prepare('SELECT snapshot_json FROM state_revisions WHERE id = ?').get(parentRevisionId))
        .toEqual({ snapshot_json: null })
      expect((await createStateStore({ engine }).getRevision(parentRevisionId))?.snapshot).toEqual(snapshot)
      expect(Object.hasOwn(Object.prototype, 'fr008Delta')).toBe(false)
    }
    for (const path of [['__proto__', 'fr008Delta'], ['constructor', 'prototype', 'fr008Delta']]) {
      engine.database.prepare('UPDATE state_revisions SET delta_json = ? WHERE id = ?')
        .run(JSON.stringify([{ op: 'set', path, value: true }]), ids[0]!)
      await expect(createStateStore({ engine }).getRevision(ids[0]!))
        .rejects.toMatchObject({ code: 'state.data_invalid' })
      expect(Object.hasOwn(Object.prototype, 'fr008Delta')).toBe(false)
    }
  } finally {
    Reflect.deleteProperty(Object.prototype, 'fr008Delta')
    await engine.close()
  }
})
