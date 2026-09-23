import { createMemorySecretBackend } from '../../../packages/secret-store/src/index.js'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createStudioServer } from '../../../apps/studio-server/src/main.js'
import { resolveLoomStudioLocalPaths } from '../../../apps/studio-server/src/platform/local-paths.js'
import { callRpc } from './helpers.js'

describe('Studio Server shutdown', () => {
  it('waits for an accepted credential write before closing its SQLite dependencies', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'loom-shutdown-')))
    const localPaths = resolveLoomStudioLocalPaths({ home: root, environment: {} })
    const backend = createMemorySecretBackend()
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const server = createStudioServer({
      localPaths,
      secretBackend: {
        ...backend,
        write: async (key, plaintext) => {
          started.resolve()
          await release.promise
          await backend.write(key, plaintext)
        },
      },
    })
    let closed = false
    let closing: Promise<void> | undefined
    try {
      const { port } = await server.listen(0)
      const request = callRpc(port, 'application.createProviderProfile', {
        providerExtensionId: 'official.openai',
        displayName: 'Accepted before shutdown',
        config: {},
        credential: { apiKey: 'test-only-credential' },
      }).catch(error => error)
      await Promise.race([
        started.promise,
        request.then(result => { throw result instanceof Error ? result : new Error('RPC completed before the write pause') }),
      ])
      closing = server.close().then(() => { closed = true })
      await request
      await new Promise<void>(resolve => setImmediate(resolve))
      expect(closed).toBe(false)
      release.resolve()
      await closing

      const reopened = createStudioServer({ localPaths, secretBackend: backend })
      try {
        const address = await reopened.listen(0)
        const result = await callRpc<{ providerProfiles: { displayName: string; credential: { configured: boolean } }[] }>(
          address.port, 'application.listProviderProfiles', {},
        )
        expect(result.providerProfiles).toContainEqual(expect.objectContaining({
          displayName: 'Accepted before shutdown',
          credential: expect.objectContaining({ configured: true }),
        }))
      } finally {
        await reopened.close()
      }
    } finally {
      release.resolve()
      if (closing) await closing
      else await server.close()
      await rm(root, { recursive: true, force: true })
    }
  })
})
