import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { describe, expect, it } from 'vitest'
import { createMemorySecretBackend } from './memory-backend.js'
import { createSecretStore, SecretStoreError } from './store.js'
import type { SecretBackend, SecretPlaintext } from './types.js'

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
