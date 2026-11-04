import { describe, expect, it, vi } from 'vitest'
import { createStudioTrpcClient } from '../../../apps/studio-client/src/shared/api/trpc-client.js'
import { createStudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'
import { authenticatedFetch, callRpc, withStudioServer } from './helpers.js'
import { authenticatedTrpc } from './trpc-helpers.js'

const source = [
  '// ==LoomScript==', '// @format 1', '// @id pilot.script', '// @name Pilot',
  '// @version 1.0.0', '// @runtime client-sandbox', '// @capability state.read',
  '// @contribution {"kind":"renderer","id":"pilot","surface":"shell.workspace-panel","scope":"workspace","inputs":["artifact:pilot.data"]}',
  '// ==/LoomScript==', 'export const renderers = {}',
].join('\n')

describe('tRPC mount pilot', () => {
  it('uses inferred client calls for script mounting and preserves grants on rejected writes', async () => {
    await withStudioServer(async port => {
      const trpc = await authenticatedTrpc(port)
      const api = createStudioApi(trpc)
      const target = { kind: 'workspace', workspaceId: 'pilot' } as const
      const { script } = await callRpc<{ script: { id: string } }>(port, 'application.importLoomScript', { owner: target, fileName: 'pilot.loom.js', source })
      const created = await api.loomScripts.createMount({ target, scriptDocumentId: script.id, orderIndex: 0 })
      expect(created.mount).toMatchObject({ enabled: false, grantedCapabilities: [] })
      const update = { mountId: created.mount.id, expectedVersion: created.mount.version, enabled: true, orderIndex: 0, grantedCapabilities: ['state.read'] }
      const saved = await api.loomScripts.updateMount(update)
      await expect(api.loomScripts.updateMount({ ...update, expectedVersion: saved.mount.version, grantedCapabilities: ['state.write'] })).rejects.toThrow('unique requested capabilities')
      expect((await api.loomScripts.listMounts(target)).mounts).toEqual([saved.mount])
      await expect(api.loomScripts.createMount({
        // @ts-expect-error extension ownership is not an admissible mount target
        target: { kind: 'extension', packageId: 'bad', installationId: 'bad' },
        scriptDocumentId: script.id, orderIndex: 0,
      })).rejects.toThrow()
    })
  })

  it('preserves tracing metadata and rejects batching', async () => {
    await withStudioServer(async port => {
      const path = '/trpc/application.listPresetToolMounts'
      const init = { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }
      const result = await authenticatedFetch(port, path, init)
      expect(result.status).toBe(200)
      expect(result.headers.get('x-call-id')).toBeTruthy()
      expect(result.headers.get('x-correlation-id')).toBeTruthy()
      expect((await authenticatedFetch(port, `${path}?batch=1`, { ...init, body: '{"0":{}}' })).status).toBe(400)
      const error = await authenticatedFetch(port, '/trpc/application.createLoomScriptMount', init)
      expect(error.status).toBe(400)
      expect((await error.json()).error.data.callId).toBe(error.headers.get('x-call-id'))
    })
  })

  it('bootstraps once on 401 and does not retry a dispatched failing mutation', async () => {
    // A cookie jar represents the browser; requests still hit the real HTTP server.
    vi.stubGlobal('window', {})
    try {
      await withStudioServer(async port => {
        let cookie = ''
        const calls: string[] = []
        const client = createStudioTrpcClient({ endpoint: `http://127.0.0.1:${port}/trpc`, fetch: async (input, init) => {
          calls.push(String(input))
          const headers = new Headers(init?.headers)
          headers.set('origin', `http://127.0.0.1:${port}`)
          if (cookie) headers.set('cookie', cookie)
          const result = await fetch(input, { ...init, headers })
          cookie = result.headers.get('set-cookie')?.split(';')[0] ?? cookie
          return result
        } })
        await expect(client.application.listPresetToolMounts.query({})).resolves.toHaveProperty('mounts')
        expect(calls.map(url => new URL(url).pathname)).toEqual(['/trpc/application.listPresetToolMounts', '/auth/session', '/trpc/application.listPresetToolMounts'])
        await expect(client.application.replacePresetToolMounts.mutate({ expectedMountIds: [], presetId: 'missing', mounts: [] })).rejects.toThrow()
        expect(calls).toHaveLength(4)
      })
    } finally { vi.unstubAllGlobals() }
  })
})
