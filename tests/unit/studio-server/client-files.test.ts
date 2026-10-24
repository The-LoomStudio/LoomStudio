import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
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
    const readExtensionFile = vi.fn(async () => ({ bytes: new TextEncoder().encode('export const ready = true'), mediaType: 'text/javascript' }))
    const server = createStudioHttpServer({
      extensionFiles: { read: readExtensionFile },
      clientDirectory: directory,
      auth: createApplicationSessionAuth(),
      applicationRuntime: { listCards: async () => ({ cards: [] }) } as unknown as import('@loom-studio/application-runtime').ApplicationRuntime,
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
      expect((await fetch(`${origin}/trpc/application.listCards`, { method: 'POST' })).status).toBe(401)
      expect((await fetch(`${origin}/extensions/events`)).status).toBe(401)
      const cardFilePath = `/card-extensions/card-1/example.package/1.0.0/${'a'.repeat(64)}/files/client.js`
      expect((await fetch(`${origin}${cardFilePath}`)).status).toBe(401)
      expect((await fetch(`${origin}/assets/private`)).status).toBe(401)
      expect((await fetch(`${origin}/%2e%2e%2fprivate.txt`)).status).toBe(400)
      if (process.platform !== 'win32') {
        await symlink(join(root, 'private.txt'), join(directory, 'escaped.txt'))
        expect((await fetch(`${origin}/escaped.txt`)).status).toBe(403)
      }
      const session = await fetch(`${origin}/auth/session`, { method: 'POST', headers: { origin } })
      expect(session.status).toBe(204)
      const cookie = session.headers.get('set-cookie')!.split(';')[0]!
      const cardFile = await fetch(`${origin}${cardFilePath}`, { headers: { cookie } })
      expect(cardFile.status).toBe(200)
      expect(await cardFile.text()).toBe('export const ready = true')
      expect(readExtensionFile).toHaveBeenCalledWith('example.package', '1.0.0', 'client.js', { cardId: 'card-1', archiveDigest: 'a'.repeat(64) })
      const response = await fetch(`${origin}/trpc/application.listCards`, {
        method: 'POST', headers: { cookie, 'content-type': 'application/json', origin },
        body: JSON.stringify({}),
      })
      expect((await fetch(`${origin}/rpc`, { method: 'POST', headers: { cookie } })).status).toBe(404)
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ result: { data: { cards: [] } } })
    } finally {
      await server.shutdown()
      await rm(root, { recursive: true, force: true })
    }
  })
})
