import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { describe, expect, it, vi } from 'vitest'

function createTestEngine() {
  let nextId = 0
  let nextTime = 0
  return createSqliteDataEngine({
    filename: ':memory:',
    createId: prefix => `${prefix}-${++nextId}`,
    now: () => `2026-08-12T00:00:0${nextTime++}.000Z`,
  })
}

describe('sqlite data engine', () => {
  it('keeps nested reads consistent while another queued transaction waits', async () => {
    const engine = createTestEngine()
    engine.database.exec('CREATE TABLE snapshot_value (value INTEGER); INSERT INTO snapshot_value VALUES (1)')
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const read = () => engine.read(db => db.prepare('SELECT value FROM snapshot_value').get()!.value)
    try {
      const snapshot = engine.readSnapshot(async () => {
        const first = await read()
        entered.resolve()
        await release.promise
        return [first, await engine.readSnapshot(read)]
      })
      await entered.promise
      const writer = engine.transact({ actor: { kind: 'system', id: 'test' } }, async tx => {
        tx.database.exec('UPDATE snapshot_value SET value = 2')
        tx.recordOperations([{ store: 'test', kind: 'update', entityId: 'value', entityType: 'test' }])
      })
      release.resolve()
      expect(await snapshot).toEqual([1, 1])
      await writer
      expect(await read()).toBe(2)
    } finally { await engine.close() }
  })

  it('rejects writes inside a snapshot and clears failed and inherited snapshot authority', async () => {
    const engine = createTestEngine()
    const releaseInherited = Promise.withResolvers<void>()
    let inherited: Promise<unknown> | undefined
    const write = () => engine.transact({ actor: { kind: 'system', id: 'test' } }, async tx => {
      tx.recordOperations([{ store: 'test', kind: 'create', entityId: 'value', entityType: 'test' }])
    })
    try {
      await expect(engine.readSnapshot(async () => {
        inherited = releaseInherited.promise.then(write)
        await write()
      })).rejects.toMatchObject({ code: 'data.read_snapshot_write' })
      releaseInherited.resolve()
      await inherited
      expect(await engine.readSnapshot(() => engine.read(db => db.prepare('SELECT id FROM changesets').all()))).toHaveLength(1)
    } finally { await engine.close() }
  })

  it('does not pass a writers transaction guard to independently subscribed work', async () => {
    const engine = createTestEngine()
    let active = true
    let followup: Promise<unknown> | undefined
    const write = (id: string) => engine.transact({ actor: { kind: 'system', id: 'test' } }, async tx => {
      tx.recordOperations([{ store: 'test', kind: 'create', entityId: id, entityType: 'test' }])
    })
    engine.subscribeCommits(commit => {
      if (commit.operations[0]?.entityId !== 'parent') return
      active = false
      followup = write('subscriber')
    })
    try {
      await engine.withTransactionGuard(async () => { if (!active) throw new Error('Revoked') }, () => write('parent'))
      await followup
      expect(engine.database.prepare('SELECT id FROM changesets').all()).toHaveLength(2)
    } finally { await engine.close() }
  })

  it('rolls back a task whose guard is revoked during its transaction without affecting other tasks', async () => {
    const engine = createTestEngine()
    engine.database.exec('CREATE TABLE guarded_writes (id TEXT)')
    let active = true
    const guard = async () => { if (!active) throw new Error('Revoked') }
    const write = (id: string, revoke = false) => engine.transact({ actor: { kind: 'system', id: 'test' } }, async tx => {
      tx.database.prepare('INSERT INTO guarded_writes VALUES (?)').run(id)
      tx.recordOperations([{ store: 'test', kind: 'create', entityId: id, entityType: 'test' }])
      if (revoke) active = false
    })
    try {
      await expect(engine.withTransactionGuard(guard, () => write('rolled-back', true))).rejects.toThrow('Revoked')
      await write('independent')
      expect(engine.database.prepare('SELECT id FROM guarded_writes').all()).toEqual([{ id: 'independent' }])
      expect(engine.database.prepare('SELECT id FROM changesets').all()).toHaveLength(1)
    } finally { await engine.close() }
  })

  it('commits one journal fact after a successful transaction without storing entity content', async () => {
    const engine = createTestEngine()
    engine.migrate({
      namespace: 'test.notes',
      migrations: [{
        version: 1,
        migrate: database => database.exec('CREATE TABLE test_notes (id TEXT PRIMARY KEY, content TEXT NOT NULL)'),
      }],
    })

    const observed = vi.fn()
    engine.subscribeCommits(observed)
    const result = await engine.transact({ actor: { kind: 'system', id: 'test' }, reason: 'test.write' }, async tx => {
      tx.database.prepare('INSERT INTO test_notes (id, content) VALUES (?, ?)').run('note-1', 'private body')
      tx.recordOperations([{
        store: 'test.notes',
        kind: 'create',
        entityId: 'note-1',
        entityType: 'note',
        toVersion: 1,
      }])
      return 'done'
    })

    const journal = engine.database.prepare('SELECT id, operations_json FROM changesets').get() as {
      id: string
      operations_json: string
    }
    expect(result.value).toBe('done')
    expect(result.commit).toMatchObject({
      changesetId: journal.id,
      reason: 'test.write',
      operations: [{ store: 'test.notes', entityId: 'note-1' }],
    })
    expect(journal.operations_json).not.toContain('private body')
    expect(observed).toHaveBeenCalledOnce()
    engine.close()
  })

  it('rolls back failed and empty transactions without notifying observers', async () => {
    const engine = createTestEngine()
    engine.migrate({
      namespace: 'test.notes',
      migrations: [{
        version: 1,
        migrate: database => database.exec('CREATE TABLE test_notes (id TEXT PRIMARY KEY)'),
      }],
    })
    const observed = vi.fn()
    engine.subscribeCommits(observed)

    await expect(engine.transact({ actor: { kind: 'system', id: 'test' } }, async tx => {
      tx.database.prepare('INSERT INTO test_notes (id) VALUES (?)').run('failed')
      tx.recordOperations([{ store: 'test.notes', kind: 'create', entityId: 'failed', entityType: 'note' }])
      throw new Error('stop transaction')
    })).rejects.toThrow('stop transaction')

    await expect(engine.transact({ actor: { kind: 'system', id: 'test' } }, async tx => {
      tx.database.prepare('INSERT INTO test_notes (id) VALUES (?)').run('empty')
    })).rejects.toMatchObject({ code: 'data.transaction_empty' })

    expect(engine.database.prepare('SELECT id FROM test_notes').all()).toEqual([])
    expect(engine.database.prepare('SELECT id FROM changesets').all()).toEqual([])
    expect(observed).not.toHaveBeenCalled()
    engine.close()
  })

  it('isolates observer failures after commit', async () => {
    const engine = createTestEngine()
    const delivered = vi.fn()
    engine.subscribeCommits(() => {
      throw new Error('observer failed')
    })
    engine.subscribeCommits(delivered)

    await engine.transact({ actor: { kind: 'system', id: 'test' } }, async tx => {
      tx.database.exec('CREATE TABLE committed_value (id TEXT PRIMARY KEY)')
      tx.recordOperations([{ store: 'test', kind: 'create', entityId: 'value-1', entityType: 'value' }])
    })

    expect(delivered).toHaveBeenCalledOnce()
    expect(engine.database.prepare('SELECT id FROM changesets').all()).toHaveLength(1)
    engine.close()
  })

  it('keeps migration versions namespaced and rejects gaps, newer schemas, and failed upgrades', () => {
    const engine = createTestEngine()
    engine.migrate({
      namespace: 'test.valid',
      migrations: [{ version: 1, migrate: database => database.exec('CREATE TABLE valid_v1 (id TEXT)') }],
    })

    expect(() => engine.migrate({
      namespace: 'test.gap',
      migrations: [{ version: 2, migrate: () => undefined }],
    })).toThrow('Missing SQLite migration for test.gap after version 0')

    engine.database.prepare('INSERT INTO schema_migrations (namespace, version) VALUES (?, ?)').run('test.newer', 2)
    expect(() => engine.migrate({
      namespace: 'test.newer',
      migrations: [{ version: 1, migrate: () => undefined }],
    })).toThrow('SQLite schema test.newer@2 is newer than supported version 1')

    expect(() => engine.migrate({
      namespace: 'test.valid',
      migrations: [
        { version: 1, migrate: () => undefined },
        {
          version: 2,
          migrate: database => {
            database.exec('CREATE TABLE rolled_back_v2 (id TEXT)')
            throw new Error('migration failed')
          },
        },
      ],
    })).toThrow('migration failed')

    const versions = engine.database
      .prepare("SELECT namespace, version FROM schema_migrations WHERE namespace LIKE 'test.%' ORDER BY namespace")
      .all()
    const rolledBackTable = engine.database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'rolled_back_v2'")
      .get()
    expect(versions).toEqual([
      { namespace: 'test.newer', version: 2 },
      { namespace: 'test.valid', version: 1 },
    ])
    expect(rolledBackTable).toBeUndefined()
    engine.close()
  })

  it('rejects reentrant calls to read and transact inside an active transaction', async () => {
    const engine = createTestEngine()
    engine.migrate({
      namespace: 'test.reentrancy',
      migrations: [{
        version: 1,
        migrate: database => database.exec('CREATE TABLE test_reentrancy (id TEXT PRIMARY KEY)'),
      }],
    })

    await expect(engine.transact({ actor: { kind: 'system', id: 'test' } }, async () => {
      await engine.read(database => database.prepare('SELECT 1').get())
      return 'done'
    })).rejects.toMatchObject({ code: 'data.reentrant_transaction' })

    await expect(engine.transact({ actor: { kind: 'system', id: 'test' } }, async () => {
      await engine.transact({ actor: { kind: 'system', id: 'test' } }, async () => 'nested')
      return 'done'
    })).rejects.toMatchObject({ code: 'data.reentrant_transaction' })

    engine.close()
  })

  it('rejects operations after engine is closed', async () => {
    const engine = createTestEngine()
    engine.close()

    expect(() => engine.migrate({ namespace: 'test.closed', migrations: [] })).toThrowError(
      expect.objectContaining({ code: 'data.engine_closed' }),
    )
    await expect(engine.read(database => database.prepare('SELECT 1').get())).rejects.toMatchObject({
      code: 'data.engine_closed',
    })
    await expect(engine.transact({ actor: { kind: 'system', id: 'test' } }, async () => 'test')).rejects.toMatchObject({
      code: 'data.engine_closed',
    })
  })

  it('drains an active operation before closing the database', async () => {
    const engine = createTestEngine()
    engine.migrate({
      namespace: 'test.drain',
      migrations: [{
        version: 1,
        migrate: database => database.exec('CREATE TABLE test_drain (id TEXT PRIMARY KEY)'),
      }],
    })
    let release!: () => void
    const entered = new Promise<void>(resolve => {
      release = resolve
    })
    const operation = engine.read(async database => {
      await entered
      return database.prepare('SELECT 1 AS value').get()
    })
    const closing = engine.close()
    let settled = false
    void closing.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    release()
    await expect(operation).resolves.toEqual({ value: 1 })
    await expect(closing).resolves.toBeUndefined()
    await expect(engine.read(() => 1)).rejects.toMatchObject({
      code: 'data.engine_closed',
    })
  })
})
