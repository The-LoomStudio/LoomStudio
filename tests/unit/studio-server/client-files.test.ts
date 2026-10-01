import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createApplicationSessionAuth } from '../../../apps/studio-server/src/http/application-session-auth.js'
import { createStudioHttpServer } from '../../../apps/studio-server/src/http/http-server.js'

describe('built client HTTP files', () => {
  it('serves pages before auth without exposing API routes, missing assets or escaped files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'loom-client-files-'))
    const directory = join(root, 'client')
    await mkdir(join(directory, 'app-assets'), { recursive: true })
    await writeFile(join(directory, 'index.html'), '<div id="root"></div>')
    await writeFile(join(directory, 'app-assets/client-hash.js'), 'export const ready = true')
    await writeFile(join(root, 'private.txt'), 'private')
    const server = createStudioHttpServer({
      clientDirectory: directory,
      auth: createApplicationSessionAuth(),
      rpcRouter: { call: async () => ({ ok: true }) },
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing server address')
    const origin = `http://127.0.0.1:${address.port}`
    try {
      for (const path of ['/', '/studio', '/studio/chat/example/branch/main']) {
        const response = await fetch(`${origin}${path}`, { headers: { accept: 'text/html' } })
        expect(response.status).toBe(200)
        expect(await response.text()).toContain('id="root"')
      }
      const asset = await fetch(`${origin}/app-assets/client-hash.js`, { method: 'HEAD' })
      expect(asset.status).toBe(200)
      expect(asset.headers.get('content-type')).toContain('javascript')
      expect(asset.headers.get('cache-control')).toContain('immutable')
      expect(await asset.text()).toBe('')
      expect((await fetch(`${origin}/app-assets/missing.js`)).status).toBe(404)
      expect((await fetch(`${origin}/studio/missing.js`, { headers: { accept: 'text/html' } })).status).toBe(404)
      expect((await fetch(`${origin}/rpc`, { method: 'POST' })).status).toBe(401)
      expect((await fetch(`${origin}/extensions/events`)).status).toBe(401)
      expect((await fetch(`${origin}/assets/private`)).status).toBe(401)
      expect((await fetch(`${origin}/%2e%2e%2fprivate.txt`)).status).toBe(400)
      if (process.platform !== 'win32') {
        await symlink(join(root, 'private.txt'), join(directory, 'escaped.txt'))
        expect((await fetch(`${origin}/escaped.txt`)).status).toBe(403)
      }
      const session = await fetch(`${origin}/auth/session`, { method: 'POST', headers: { origin } })
      expect(session.status).toBe(204)
      const cookie = session.headers.get('set-cookie')!.split(';')[0]!
      const response = await fetch(`${origin}/rpc`, {
        method: 'POST', headers: { cookie, 'content-type': 'application/json', origin },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'test.ping' }),
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ result: { ok: true } })
    } finally {
      await server.shutdown()
      await rm(root, { recursive: true, force: true })
    }
  })
})
