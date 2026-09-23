import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createMemorySecretBackend, createSecretStore } from '@loom-studio/secret-store'
import { createId, nowIso } from '@loom-studio/shared'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createStudioServer } from '../../../apps/studio-server/src/main.js'
import { resolveLoomStudioLocalPaths } from '../../../apps/studio-server/src/platform/local-paths.js'
import { callRpc } from './helpers.js'

describe('Studio Server credential cleanup', () => {
  it.each(['startup', 'shutdown'] as const)('retries retained keys during %s without deleting active credentials', async phase => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'loom-secret-cleanup-')))
    const localPaths = resolveLoomStudioLocalPaths({ home: root, environment: {} })
    const memory = createMemorySecretBackend()
    const keys = new Set<string>()
    let failDelete = true
    const backend = {
      ...memory,
      write: async (key: string, plaintext: Parameters<typeof memory.write>[1]) => {
        keys.add(key)
        await memory.write(key, plaintext)
      },
      delete: async (key: string) => {
        if (failDelete) throw new Error('Credential backend unavailable')
        await memory.delete(key)
        keys.delete(key)
      },
    }
    const engine = createSqliteDataEngine({ filename: localPaths.databaseFile, createId, now: nowIso })
    const store = createSecretStore({ engine, backend, createId, now: nowIso, authorizeUse: () => true })
    const actor = { kind: 'system' as const, id: 'test' }
    const owner = { type: 'test', id: 'test' }
    try {
      const created = await store.create({ actor, owner, purpose: 'test', plaintext: { values: { key: 'old-test-value' } } })
      const replaced = await store.replace({ actor, owner, ref: created.metadata.ref, plaintext: { values: { key: 'active-test-value' } } })
      expect(replaced.cleanupPending).toBe(true)
      expect(keys.size).toBe(2)
    } finally {
      await engine.close()
    }

    if (phase === 'startup') failDelete = false
    const server = createStudioServer({ localPaths, secretBackend: backend })
    try {
      const { port } = await server.listen(0)
      if (phase === 'startup') {
        expect(keys.size).toBe(1)
      } else {
        expect(keys.size).toBe(2)
        const diagnostics = await callRpc<{ items: { code: string }[] }>(port, 'diagnostics.list', {})
        expect(diagnostics.items).toContainEqual(expect.objectContaining({ code: 'secret.cleanup_pending' }))
        failDelete = false
      }
    } finally {
      await server.close()
    }
    try {
      expect(keys.size).toBe(1)
      expect(await memory.read([...keys][0]!)).toEqual({ values: { key: 'active-test-value' } })
      const reopened = createSqliteDataEngine({ filename: localPaths.databaseFile, createId, now: nowIso })
      try {
        expect(reopened.database.prepare('SELECT * FROM secret_backend_cleanup').all()).toEqual([])
      } finally {
        await reopened.close()
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
