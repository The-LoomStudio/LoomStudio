import { createSqliteDataEngine, DataEngineError } from '@loom-studio/data-engine'
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
    })).rejects.toMatchObject<DataEngineError>({ code: 'data.transaction_empty' })

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
    })).rejects.toMatchObject<DataEngineError>({ code: 'data.reentrant_transaction' })

    await expect(engine.transact({ actor: { kind: 'system', id: 'test' } }, async () => {
      await engine.transact({ actor: { kind: 'system', id: 'test' } }, async () => 'nested')
      return 'done'
    })).rejects.toMatchObject<DataEngineError>({ code: 'data.reentrant_transaction' })

    engine.close()
  })

  it('rejects operations after engine is closed', async () => {
    const engine = createTestEngine()
    engine.close()

    expect(() => engine.migrate({ namespace: 'test.closed', migrations: [] })).toThrowError(
      expect.objectContaining({ code: 'data.engine_closed' }),
    )
    await expect(engine.read(database => database.prepare('SELECT 1').get())).rejects.toMatchObject<DataEngineError>({
      code: 'data.engine_closed',
    })
    await expect(engine.transact({ actor: { kind: 'system', id: 'test' } }, async () => 'test')).rejects.toMatchObject<DataEngineError>({
      code: 'data.engine_closed',
    })
  })
})
