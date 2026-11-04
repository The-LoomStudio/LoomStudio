import { expect, it, vi } from 'vitest'
import { createApplicationSessionAuth } from '../../../apps/studio-server/src/http/application-session-auth.js'
import { createStudioHttpServer } from '../../../apps/studio-server/src/http/http-server.js'

it('serves authenticated summaries through both file scopes without changing raw file responses', async () => {
  const source = JSON.stringify({ rootNode: { label: 'Preset', meta: 'Summary', body: 'PRIVATE PROMPT BODY' } })
  const read = vi.fn(async () => ({ bytes: new TextEncoder().encode(source), mediaType: 'application/json' }))
  const server = createStudioHttpServer({ auth: createApplicationSessionAuth(), extensionFiles: { read } })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing server address')
  const origin = `http://127.0.0.1:${address.port}`
  const digest = 'a'.repeat(64)
  const paths = ['/extensions/example.pkg/revision-2/files/preset.json', `/card-extensions/card-1/example.pkg/1.0.0/${digest}/files/preset.json`]
  try {
    expect((await fetch(`${origin}${paths[0]}?preview=summary&kind=preset`)).status).toBe(401)
    expect(read).not.toHaveBeenCalled()
    const auth = await fetch(`${origin}/auth/session`, { method: 'POST', headers: { origin } })
    const cookie = auth.headers.get('set-cookie')!.split(';')[0]!
    for (const path of paths) {
      const response = await fetch(`${origin}${path}?preview=summary&kind=preset`, { headers: { cookie } })
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(await response.json()).toEqual({ title: 'Preset', description: 'Summary' })
      const raw = await fetch(`${origin}${path}`, { headers: { cookie } })
      expect(await raw.text()).toBe(source)
    }
    expect(read).toHaveBeenCalledWith('example.pkg', 'revision-2', 'preset.json', undefined)
    expect(read).toHaveBeenCalledWith('example.pkg', '1.0.0', 'preset.json', { cardId: 'card-1', archiveDigest: digest })
    read.mockClear()
    for (const query of ['preview=summary', 'preview=summary&kind=background', 'preview=invalid&kind=preset', 'preview=summary&kind=preset&kind=script']) {
      expect((await fetch(`${origin}${paths[0]}?${query}`, { headers: { cookie } })).status).toBe(400)
    }
    expect(read).not.toHaveBeenCalled()
    read.mockResolvedValueOnce({ bytes: new TextEncoder().encode('not JSON'), mediaType: 'application/json' })
    expect((await fetch(`${origin}${paths[0]}?preview=summary&kind=preset`, { headers: { cookie } })).status).toBe(400)
  } finally {
    await server.shutdown()
  }
})
