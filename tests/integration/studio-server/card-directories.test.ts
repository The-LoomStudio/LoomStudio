import { cp, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import type { CardDirectoryCatalog, CardDirectoryPreview, OpenCardDirectoryResult } from '@loom-studio/shared'
import { createStudioServer } from '../../../apps/studio-server/src/main.js'
import { resolveLoomStudioLocalPaths } from '../../../apps/studio-server/src/platform/local-paths.js'
import { defaultCardPng, encodeCardPng } from '../../../apps/studio-server/src/codecs/card-png.js'
import { encodeCardBundleZip } from '../../../apps/studio-server/src/codecs/card-bundle-zip.js'
import { authenticatedFetch, callRpc } from './helpers.js'

it('connects archive import, live directory media, in-place Apply and copied-folder registration', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'loom-card-directories-http-')))
  const localPaths = resolveLoomStudioLocalPaths({ home: root })
  const server = createStudioServer({ localPaths, extensionRootDirectory: join(root, 'empty-extensions') })
  const eventsAbort = new AbortController()
  try {
    const { port } = await server.listen(0)
    const zip = encodeCardBundleZip({
      artifact: {
        schemaVersion: 4, artifactId: 'directory-http', displayName: 'HTTP card',
        card: { name: 'HTTP card', description: 'Original description' },
        contextAssets: [{ id: 'book', kind: 'module', category: 'setting', label: 'World', children: [
          { id: 'entry', kind: 'entry', label: 'Town', body: 'Original town' },
        ] }],
      },
      avatar: { bytes: defaultCardPng, mediaType: 'image/png' },
    })
    const imported = await authenticatedFetch(port, '/cards/import/loomcard', { method: 'POST', body: Buffer.from(zip) })
    const importedBody = await imported.json() as { card: { id: string; promptResourceIds: string[]; media: { avatarAssetId: string } } }
    expect(imported.status, JSON.stringify(importedBody)).toBe(201)
    const card = importedBody.card
    const directory = join(localPaths.dataRoot, 'characters', card.id)
    const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'))
    expect(manifest.resources.metadata.metadata.exportedFromCardId).toBe(card.id)
    const baseline = JSON.parse(await readFile(join(localPaths.dataRoot, '.loom/card-directories', card.id, 'baseline.json'), 'utf8'))
    expect(baseline.snapshot.cardId).toBe(card.id)
    expect(baseline.mediaRefs.avatarAssetId).toBe(card.media.avatarAssetId)

    const imageUrl = `/cards/${card.id}/media/avatar?revision=first`
    const firstImage = await authenticatedFetch(port, imageUrl)
    expect(firstImage.status).toBe(200)
    expect(firstImage.headers.get('cache-control')).toBe('no-cache')
    const firstEtag = firstImage.headers.get('etag')
    await firstImage.arrayBuffer()
    const stream = await authenticatedFetch(port, '/extensions/events', { signal: eventsAbort.signal })
    const reader = stream.body!.getReader()
    await reader.read()
    const notification = (async () => {
      const decoder = new TextDecoder()
      let text = ''
      while (!text.includes('event: directories.media.changed')) {
        const chunk = await reader.read()
        if (chunk.done) throw new Error('Media event stream ended')
        text += decoder.decode(chunk.value, { stream: true })
      }
    })()
    const eventTimeout = setTimeout(() => eventsAbort.abort(), 5_000)
    const replacement = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXf8AAAAASUVORK5CYII=', 'base64')
    await writeFile(join(directory, manifest.media.avatar), encodeCardPng(replacement, {
      schemaVersion: 4, artifactId: 'embedded-payload', displayName: 'Not imported', card: { name: 'Not imported' }, contextAssets: [],
    }))
    try { await notification } finally { clearTimeout(eventTimeout); await reader.cancel() }
    const changedImage = await authenticatedFetch(port, imageUrl, { headers: { 'if-none-match': firstEtag! } })
    expect(changedImage.status).toBe(200)
    expect(changedImage.headers.get('etag')).not.toBe(firstEtag)
    expect(Buffer.from(await changedImage.arrayBuffer())).toEqual(replacement)
    const immutable = await authenticatedFetch(port, `/assets/${card.media.avatarAssetId}`)
    expect(Buffer.from(await immutable.arrayBuffer())).toEqual(Buffer.from(defaultCardPng))

    await writeFile(join(directory, 'card/description.md'), 'Edited in the source folder')
    const preview = await callRpc<CardDirectoryPreview>(port, 'directories.previewApply', { cardId: card.id })
    expect(preview.conflicts).toEqual([])
    await callRpc(port, 'directories.apply', { cardId: card.id, token: preview.token })
    expect(await readFile(join(directory, manifest.media.avatar))).toEqual(replacement)
    const updated = await callRpc<{ card: { id: string; description: string; promptResourceIds: string[] } }>(port, 'application.getCard', { cardId: card.id })
    expect(updated.card).toMatchObject({ id: card.id, description: 'Edited in the source folder', promptResourceIds: card.promptResourceIds })
    expect(await callRpc(port, 'directories.previewCard', { cardId: card.id })).toMatchObject({ changes: [], conflicts: [] })

    const copied = join(localPaths.dataRoot, 'characters', 'Copied source')
    await cp(directory, copied, { recursive: true })
    await writeFile(join(copied, 'README.md'), '# Local author notes')
    const scan = await callRpc<CardDirectoryCatalog>(port, 'directories.scan', {})
    expect(scan.entries.find(entry => entry.directory === copied)).toMatchObject({ sourceCardId: card.id })
    expect(scan.entries.find(entry => entry.directory === copied)?.registeredCardId).toBeUndefined()
    const opened = await callRpc<OpenCardDirectoryResult>(port, 'directories.open', { directory: copied })
    const registered = await callRpc<{ cardId: string }>(port, 'directories.import', { directory: copied, token: opened.token })
    expect(registered.cardId).not.toBe(card.id)
    const rescanned = await callRpc<CardDirectoryCatalog>(port, 'directories.scan', {})
    expect(rescanned.entries.find(entry => entry.directory === copied)).toMatchObject({ registeredCardId: registered.cardId })
    expect(rescanned.entries.find(entry => entry.directory === copied)?.error).toBeUndefined()
    expect(await readFile(join(copied, 'README.md'), 'utf8')).toBe('# Local author notes')
    await expect(callRpc(port, 'directories.import', { directory: copied, token: opened.token })).rejects.toThrow('already registered')
    const cards = await callRpc<{ cards: unknown[] }>(port, 'application.listCards', {})
    expect(cards.cards).toHaveLength(2)
  } finally {
    eventsAbort.abort()
    await server.close()
    await rm(root, { recursive: true, force: true })
  }
}, 20_000)
