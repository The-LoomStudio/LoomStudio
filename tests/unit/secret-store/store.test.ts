import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createId, nowIso } from '@loom-studio/shared'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createMemorySecretBackend } from '../../../packages/secret-store/src/memory-backend.js'
import { createSecretStore, SecretStoreError } from '../../../packages/secret-store/src/store.js'
import type { SecretBackend, SecretPlaintext } from '../../../packages/secret-store/src/types.js'

const actor = { kind: 'system' as const, id: 'secret-store-test' }
const owner = { type: 'provider-profile', id: 'provider-1' }

describe('Secret Store', () => {
  it('keeps plaintext out of SQLite and allows only authorized scoped use', async () => {
    const engine = createEngine()
    const store = createSecretStore({
      engine,
      backend: createMemorySecretBackend(),
      createId: createIds(),
      now: () => '2026-08-15T00:00:00.000Z',
      authorizeUse: (_metadata, context) => context.caller === 'ai-gateway',
    })
    const created = await store.create({
      actor,
      owner,
      purpose: 'provider-credential',
      plaintext: { values: { apiKey: 'super-secret-value' } },
    })

    expect(JSON.stringify(engine.database.prepare('SELECT * FROM secret_metadata').all())).not.toContain('super-secret-value')
    await expect(store.withSecret(created.metadata.ref, {
      caller: 'extension:unknown',
      owner,
      purpose: 'provider-credential',
    }, async () => 'unreachable')).rejects.toMatchObject({ code: 'secret.access_denied' })
    await expect(store.withSecret(created.metadata.ref, {
      caller: 'ai-gateway',
      owner,
      purpose: 'other-purpose',
    }, async () => 'unreachable')).rejects.toMatchObject({ code: 'secret.scope_mismatch' })
    await expect(store.withSecret(created.metadata.ref, {
      caller: 'ai-gateway',
      owner,
      purpose: 'provider-credential',
    }, async plaintext => plaintext.values.apiKey)).resolves.toBe('super-secret-value')
    engine.close()
  })

  it('keeps a replacement active while retrying cleanup of the old backend value', async () => {
    const engine = createEngine()
    const backend = createFlakyDeleteBackend()
    const store = createSecretStore({
      engine,
      backend,
      createId: createIds(),
      now: () => '2026-08-15T00:00:00.000Z',
      authorizeUse: () => true,
    })
    const created = await store.create({ actor, owner, purpose: 'provider-credential', plaintext: secret('old') })
    backend.failNextDelete()
    const replaced = await store.replace({ actor, owner, ref: created.metadata.ref, plaintext: secret('new') })

    expect(replaced.cleanupPending).toBe(true)
    await expect(store.withSecret(created.metadata.ref, {
      caller: 'ai-gateway', owner, purpose: 'provider-credential',
    }, async plaintext => plaintext.values.apiKey)).resolves.toBe('new')
    await expect(store.retryPendingCleanup({ actor })).resolves.toBe(1)
    engine.close()
  })

  it('leaves failed deletion recoverable and makes pending secrets unusable', async () => {
    const engine = createEngine()
    const backend = createFlakyDeleteBackend()
    const store = createSecretStore({
      engine,
      backend,
      createId: createIds(),
      now: () => '2026-08-15T00:00:00.000Z',
      authorizeUse: () => true,
    })
    const created = await store.create({ actor, owner, purpose: 'provider-credential', plaintext: secret('value') })
    backend.failNextDelete()
    const deleted = await store.delete({ actor, owner, ref: created.metadata.ref })

    expect(deleted).toMatchObject({ deleted: false, cleanupPending: true })
    await expect(store.withSecret(created.metadata.ref, {
      caller: 'ai-gateway', owner, purpose: 'provider-credential',
    }, async () => 'unreachable')).rejects.toBeInstanceOf(SecretStoreError)
    await expect(store.retryPendingCleanup({ actor })).resolves.toBe(1)
    await expect(store.getMetadata(created.metadata.ref)).resolves.toBeUndefined()
    engine.close()
  })

  it.each([
    ['create', 'before'],
    ['create', 'after'],
    ['replace', 'before'],
    ['replace', 'after'],
  ] as const)('recovers %s interrupted %s the external write without losing the old credential', async (operation, phase) => {
    const root = await mkdtemp(join(tmpdir(), 'loom-secret-intent-'))
    const filename = join(root, 'studio.sqlite')
    let engine = createSqliteDataEngine({ filename, createId, now: nowIso })
    const backend = createMemorySecretBackend()
    let interrupt = false
    let newKey = ''
    let observedIntent: unknown
    const store = createSecretStore({
      engine, createId, now: nowIso, authorizeUse: () => true,
      backend: {
        ...backend,
        write: async (key, plaintext) => {
          if (!interrupt) return await backend.write(key, plaintext)
          newKey = key
          observedIntent = await engine.read(database => database.prepare(
            'SELECT backend_key FROM secret_backend_cleanup WHERE backend_key = ?',
          ).get(key))
          await engine.close()
          if (phase === 'after') await backend.write(key, plaintext)
          throw new Error('Simulated process interruption')
        },
      },
    })
    try {
      const existing = operation === 'replace'
        ? await store.create({ actor, owner, purpose: 'provider-credential', plaintext: secret('old-value') })
        : undefined
      interrupt = true
      const pending = existing
        ? store.replace({ actor, owner, ref: existing.metadata.ref, plaintext: secret('new-value') })
        : store.create({ actor, owner, purpose: 'provider-credential', plaintext: secret('new-value') })
      await expect(pending).rejects.toMatchObject({ code: 'secret.backend_write_failed' })
      expect(observedIntent).toEqual({ backend_key: newKey })
      expect(await backend.read(newKey)).toEqual(phase === 'after' ? secret('new-value') : undefined)

      engine = createSqliteDataEngine({ filename, createId, now: nowIso })
      const reopened = createSecretStore({ engine, backend, createId, now: nowIso, authorizeUse: () => true })
      const queue = engine.database.prepare('SELECT * FROM secret_backend_cleanup').all()
      expect(queue).toHaveLength(1)
      expect(JSON.stringify(queue)).not.toContain('new-value')
      await expect(reopened.retryPendingCleanup({ actor })).resolves.toBe(1)
      expect(await backend.read(newKey)).toBeUndefined()
      expect(engine.database.prepare('SELECT * FROM secret_backend_cleanup').all()).toEqual([])
      if (existing) {
        await expect(reopened.withSecret(existing.metadata.ref, {
          caller: 'ai-gateway', owner, purpose: 'provider-credential',
        }, async value => value.values.apiKey)).resolves.toBe('old-value')
      } else {
        expect(engine.database.prepare('SELECT * FROM secret_metadata').all()).toEqual([])
      }
    } finally {
      await engine.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('does not delete an in-flight key when another Store on the same Engine retries cleanup', async () => {
    const engine = createEngine()
    const backend = createMemorySecretBackend()
    const started = Promise.withResolvers<string>()
    const release = Promise.withResolvers<void>()
    const options = { engine, createId, now: nowIso, authorizeUse: () => true }
    const writer = createSecretStore({
      ...options,
      backend: {
        ...backend,
        write: async (key, plaintext) => {
          await backend.write(key, plaintext)
          started.resolve(key)
          await release.promise
        },
      },
    })
    const cleaner = createSecretStore({ ...options, backend })
    const writing = writer.create({ actor, owner, purpose: 'provider-credential', plaintext: secret('active-value') })
    try {
      const key = await Promise.race([
        started.promise,
        writing.then(() => { throw new Error('Write completed before its pause') }),
      ])
      expect(engine.database.prepare('SELECT * FROM secret_backend_cleanup').all()).toHaveLength(1)
      await expect(cleaner.retryPendingCleanup({ actor })).resolves.toBe(0)
      expect(await backend.read(key)).toEqual(secret('active-value'))
      release.resolve()
      const created = await writing
      expect(engine.database.prepare('SELECT * FROM secret_backend_cleanup').all()).toEqual([])
      await expect(cleaner.withSecret(created.metadata.ref, {
        caller: 'ai-gateway', owner, purpose: 'provider-credential',
      }, async value => value.values.apiKey)).resolves.toBe('active-value')
    } finally {
      release.resolve()
      await writing.catch(() => undefined)
      await engine.close()
    }
  })

  it('does not call the external backend if the durable intent cannot commit', async () => {
    const engine = createEngine()
    const backend = createMemorySecretBackend()
    const write = vi.fn(backend.write)
    const store = createSecretStore({
      engine, backend: { ...backend, write }, createId, now: nowIso, authorizeUse: () => true,
    })
    engine.database.exec(`
      CREATE TRIGGER reject_cleanup_intent BEFORE INSERT ON secret_backend_cleanup
      BEGIN SELECT RAISE(ABORT, 'intent unavailable'); END;
    `)
    try {
      await expect(store.create({ actor, owner, purpose: 'provider-credential', plaintext: secret('value') }))
        .rejects.toThrow('intent unavailable')
      expect(write).not.toHaveBeenCalled()
      expect(engine.database.prepare('SELECT * FROM secret_metadata').all()).toEqual([])
    } finally {
      await engine.close()
    }
  })

  it('keeps a partially written key queued and reports failed cleanup without exposing plaintext', async () => {
    const engine = createEngine()
    const backend = createMemorySecretBackend()
    const onCleanupFailure = vi.fn()
    let failDelete = true
    let key = ''
    const store = createSecretStore({
      engine, createId, now: nowIso, authorizeUse: () => true, onCleanupFailure,
      backend: {
        ...backend,
        write: async (backendKey, plaintext) => {
          key = backendKey
          await backend.write(backendKey, plaintext)
          throw new Error('Backend failed after writing')
        },
        delete: async backendKey => {
          if (failDelete) throw new Error('Backend unavailable')
          await backend.delete(backendKey)
        },
      },
    })
    try {
      await expect(store.create({ actor, owner, purpose: 'provider-credential', plaintext: secret('private-value') }))
        .rejects.toMatchObject({ code: 'secret.backend_write_failed' })
      expect(engine.database.prepare('SELECT * FROM secret_backend_cleanup').all()).toHaveLength(1)
      expect(onCleanupFailure).toHaveBeenCalledExactlyOnceWith()
      await expect(store.retryPendingCleanup({ actor })).resolves.toBe(0)
      expect(onCleanupFailure).toHaveBeenCalledTimes(2)
      failDelete = false
      await expect(store.retryPendingCleanup({ actor })).resolves.toBe(1)
      expect(await backend.read(key)).toBeUndefined()
    } finally {
      await engine.close()
    }
  })

  it.each(['create', 'replace'] as const)('cleans prepared bytes when %s metadata commit fails', async operation => {
    const engine = createEngine()
    const backend = createMemorySecretBackend()
    const keys = new Set<string>()
    const store = createSecretStore({
      engine, createId, now: nowIso, authorizeUse: () => true,
      backend: {
        ...backend,
        write: async (key, plaintext) => { keys.add(key); await backend.write(key, plaintext) },
        delete: async key => { await backend.delete(key); keys.delete(key) },
      },
    })
    try {
      const existing = operation === 'replace'
        ? await store.create({ actor, owner, purpose: 'test', plaintext: secret('old') })
        : undefined
      engine.database.exec(`
        CREATE TRIGGER reject_metadata BEFORE ${operation === 'create' ? 'INSERT' : 'UPDATE'} ON secret_metadata
        BEGIN SELECT RAISE(ABORT, 'metadata unavailable'); END;
      `)
      const write = existing
        ? store.replace({ actor, owner, ref: existing.metadata.ref, plaintext: secret('new') })
        : store.create({ actor, owner, purpose: 'test', plaintext: secret('new') })
      await expect(write).rejects.toThrow('metadata unavailable')
      expect(engine.database.prepare('SELECT * FROM secret_backend_cleanup').all()).toEqual([])
      expect(keys.size).toBe(existing ? 1 : 0)
      if (existing) {
        await expect(store.withSecret(existing.metadata.ref, {
          caller: 'test', owner, purpose: 'test',
        }, async value => value.values.apiKey)).resolves.toBe('old')
      }
    } finally {
      await engine.close()
    }
  })
})

function createEngine() {
  return createSqliteDataEngine({ filename: ':memory:', createId: createIds(), now: () => '2026-08-15T00:00:00.000Z' })
}

function createIds() {
  let sequence = 0
  return (prefix: string) => `${prefix}-${++sequence}`
}

function secret(apiKey: string): SecretPlaintext {
  return { values: { apiKey } }
}

function createFlakyDeleteBackend(): SecretBackend & { failNextDelete(): void } {
  const values = new Map<string, SecretPlaintext>()
  let shouldFailDelete = false
  return {
    write: async (key, plaintext) => { values.set(key, structuredClone(plaintext)) },
    read: async key => values.get(key),
    delete: async key => {
      if (shouldFailDelete) {
        shouldFailDelete = false
        throw new Error('simulated backend failure')
      }
      values.delete(key)
    },
    failNextDelete: () => { shouldFailDelete = true },
  }
}
