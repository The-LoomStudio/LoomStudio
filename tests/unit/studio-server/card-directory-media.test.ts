import { afterEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { crc32 } from 'node:zlib'
import { defaultCardPng, encodeCardBundlePng } from '../../../apps/studio-server/src/codecs/card-png.js'
import { createCardDirectoryMedia } from '../../../apps/studio-server/src/resource-directories/card-directory-media.js'
import { createStudioHttpServer } from '../../../apps/studio-server/src/http/http-server.js'
import { createApplicationSessionAuth } from '../../../apps/studio-server/src/http/application-session-auth.js'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true })
})
function png(content: string) {
  const data = Buffer.from(`loOm${content}`)
  const chunk = Buffer.alloc(data.length + 8)
  chunk.writeUInt32BE(data.length - 4, 0)
  data.copy(chunk, 4)
  chunk.writeUInt32BE(crc32(data), chunk.length - 4)
  return Buffer.concat([defaultCardPng.subarray(0, -12), chunk, defaultCardPng.subarray(-12)])
}

async function setup() {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'loom-media-')))
  roots.push(root)
  const metadata = join(root, '.loom/card-directories/card-1')
  const directory = join(root, 'characters/card-1')
  await fs.mkdir(metadata, { recursive: true })
  await fs.mkdir(join(directory, 'assets'), { recursive: true })
  const baseline = { version: 1, cardId: 'card-1', files: {}, mediaRefs: { avatarAssetId: 'asset-1' } }
  const saveBaseline = (value: unknown) => fs.writeFile(join(metadata, 'baseline.json'), JSON.stringify(value))
  const manifest = (path: string | undefined) => fs.writeFile(join(directory, 'manifest.json'), JSON.stringify({ schema: 'loom.cardBundle.zip.v2', media: { avatar: path } }))
  await saveBaseline(baseline)
  await manifest('assets/avatar.png')
  await fs.writeFile(join(directory, 'assets/avatar.png'), png('first'))
  return { root, directory, metadata, baseline, saveBaseline, manifest, media: createCardDirectoryMedia({ dataRoot: root }) }
}

describe('card directory media', () => {
  it('serves authenticated GET/HEAD with content-based revalidation and explicit failures', async () => {
    let bytes = png('first')
    const server = createStudioHttpServer({
      auth: createApplicationSessionAuth(), rpcRouter: { call: async () => null },
      cardMedia: { read: async (id, kind) => {
        if (id === 'invalid') throw new Error('Invalid media')
        return kind === 'avatar' ? { bytes, mediaType: 'image/png' } : undefined
      } },
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Missing server address')
      const origin = `http://127.0.0.1:${address.port}`
      const path = `${origin}/cards/card-1/media/avatar?v=1`
      expect((await fetch(path)).status).toBe(401)
      const session = await fetch(`${origin}/auth/session`, { method: 'POST', headers: { origin } })
      const cookie = session.headers.get('set-cookie')!.split(';')[0]!
      const first = await fetch(path, { headers: { cookie } })
      expect(first.status).toBe(200)
      expect(first.headers.get('content-type')).toBe('image/png')
      expect(first.headers.get('cache-control')).toBe('no-cache')
      expect(first.headers.get('x-content-type-options')).toBe('nosniff')
      expect(Buffer.from(await first.arrayBuffer())).toEqual(bytes)
      const etag = first.headers.get('etag')!
      const head = await fetch(path, { method: 'HEAD', headers: { cookie } })
      expect(head.headers.get('etag')).toBe(etag)
      expect(await head.text()).toBe('')
      const cached = await fetch(path, { headers: { cookie, 'if-none-match': `W/${etag}` } })
      expect(cached.status).toBe(304)
      expect(await cached.text()).toBe('')
      bytes = png('second')
      const changed = await fetch(path, { headers: { cookie, 'if-none-match': etag } })
      expect(changed.status).toBe(200)
      expect(changed.headers.get('etag')).not.toBe(etag)
      expect((await fetch(`${origin}/cards/card-1/media/background`, { headers: { cookie } })).status).toBe(404)
      expect((await fetch(`${origin}/cards/invalid/media/avatar`, { headers: { cookie } })).status).toBe(400)
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  })

  it('watches image changes and disposes its native watcher', async () => {
    const { root, media, directory } = await setup()
    let changes = 0
    const watcher = await media.watch(() => { changes += 1 })
    try {
      await fs.writeFile(join(directory, 'assets/avatar.png'), png('changed'))
      await expect.poll(() => changes).toBeGreaterThan(0)
    } finally {
      watcher.dispose()
    }
    const count = changes
    await fs.writeFile(join(directory, 'assets/avatar.png'), png('after close'))
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(changes).toBe(count)
    await fs.rm(join(root, 'characters'), { recursive: true })
    const emptyWatcher = await media.watch(() => {})
    emptyWatcher.dispose()
    expect(await fs.readdir(join(root, 'characters'))).toEqual([])
  })

  it('coalesces manifest media switches and directory renames, clearing pending notifications on dispose', async () => {
    const { media, manifest, directory } = await setup()
    let changes = 0
    const watcher = await media.watch(() => { changes += 1 })
    try {
      await manifest('assets/other.png')
      await manifest('assets/avatar.png')
      await expect.poll(() => changes).toBe(1)
      await fs.rename(join(directory, 'assets'), join(directory, 'renamed'))
      await expect.poll(() => changes).toBe(2)
      await manifest('renamed/avatar.png')
      await new Promise(resolve => setTimeout(resolve, 20))
    } finally {
      watcher.dispose()
    }
    await new Promise(resolve => setTimeout(resolve, 150))
    expect(changes).toBe(2)
  })

  it('strips PNG card text payloads before returning image bytes', async () => {
    const { media, directory } = await setup()
    const image = png('cover')
    const card = encodeCardBundlePng(image, Buffer.from('private card payload'))
    await fs.writeFile(join(directory, 'assets/avatar.png'), card)
    expect((await media.read('card-1', 'avatar', 'asset-1'))?.bytes).toEqual(image)
  })

  it('reads replacement bytes on every request and follows explicit bindings', async () => {
    const { media, root, directory, metadata } = await setup()
    expect((await media.read('card-1', 'avatar', 'asset-1'))?.bytes).toEqual(png('first'))
    await fs.writeFile(join(directory, 'assets/avatar.png'), png('second'))
    expect((await media.read('card-1', 'avatar', 'asset-1'))?.bytes).toEqual(png('second'))
    await fs.rename(directory, join(root, 'characters/author-name'))
    await fs.writeFile(join(metadata, 'binding.json'), JSON.stringify({ directoryName: 'author-name', artifactId: 'source' }))
    expect((await media.read('card-1', 'avatar', 'asset-1'))?.mediaType).toBe('image/png')
  })

  it('falls back only for unsaved, legacy, changed references or an undeclared kind', async () => {
    const { media, baseline, saveBaseline, manifest, metadata } = await setup()
    expect(await media.read('card-1', 'avatar', 'new-asset')).toBeUndefined()
    expect(await media.read('card-1', 'avatar')).toBeUndefined()
    expect(await media.read('card-1', 'background')).toBeUndefined()
    await manifest(undefined)
    expect(await media.read('card-1', 'avatar', 'asset-1')).toBeUndefined()
    await saveBaseline({ ...baseline, mediaRefs: undefined })
    expect(await media.read('card-1', 'avatar', 'asset-1')).toBeUndefined()
    await fs.rm(join(metadata, 'baseline.json'))
    expect(await media.read('card-1', 'avatar', 'asset-1')).toBeUndefined()
  })

  it('matches undefined references and fails for a declared missing file', async () => {
    const { media, baseline, saveBaseline, directory } = await setup()
    await saveBaseline({ ...baseline, mediaRefs: {} })
    expect((await media.read('card-1', 'avatar'))?.bytes).toEqual(png('first'))
    await fs.rm(join(directory, 'assets/avatar.png'))
    await expect(media.read('card-1', 'avatar')).rejects.toThrow('missing')
  })

  it('rejects traversal, symbolic links, SVG and falsely named raster files', async () => {
    const { media, manifest, directory, root } = await setup()
    await expect(media.read('../escape', 'avatar')).rejects.toThrow('Invalid card')
    await manifest('../outside.png')
    await expect(media.read('card-1', 'avatar', 'asset-1')).rejects.toThrow()
    await manifest('assets/avatar.svg')
    await expect(media.read('card-1', 'avatar', 'asset-1')).rejects.toThrow('raster')
    await manifest('assets/avatar.png')
    await fs.writeFile(join(directory, 'assets/avatar.png'), '<svg/>')
    await expect(media.read('card-1', 'avatar', 'asset-1')).rejects.toThrow('raster')
    await fs.rm(join(directory, 'assets/avatar.png'))
    await fs.writeFile(join(root, 'outside.png'), png('outside'))
    await fs.symlink(join(root, 'outside.png'), join(directory, 'assets/avatar.png'))
    await expect(media.read('card-1', 'avatar', 'asset-1')).rejects.toThrow('symbolic link')
  })
})
