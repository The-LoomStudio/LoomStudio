import { afterEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCardDirectoryCatalog } from '../../../apps/studio-server/src/resource-directories/card-directory-catalog.js'
import { createCardDirectoryService } from '../../../apps/studio-server/src/resource-directories/card-directory.js'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true })
})

async function fixture() {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'loom-catalog-')))
  roots.push(root)
  const service = createCardDirectoryService({
    dataRoot: root,
    readCard: async () => ({
      artifact: {
        schemaVersion: 4, artifactId: 'source', displayName: 'Alice',
        metadata: { exportedFromCardId: 'card-1' },
        card: { name: 'Alice', description: 'Own description' },
        contextAssets: [{ id: 'clothing', kind: 'module', label: 'Clothing', body: 'Reference' }],
        externalContextAssetIds: ['clothing'],
      },
      avatar: { bytes: Buffer.from('avatar'), mediaType: 'image/png' },
    }),
  })
  const catalog = createCardDirectoryCatalog({ dataRoot: root, listCardIds: async () => ['card-1'] })
  const directory = join(root, 'characters/card-1')
  return {
    root, directory, catalog,
    save: async () => service.saveCard('card-1', (await service.previewCard('card-1')).token),
  }
}

describe('Card directory discovery and read-only opening', () => {
  it('previews declared raster media and README without exposing scripts or arbitrary HTML', async () => {
    const { directory, catalog, save } = await fixture()
    await save()
    await fs.writeFile(join(directory, 'README.md'), '# Author notes')
    await fs.writeFile(join(directory, 'index.html'), '<script>throw new Error()</script>')
    const opened = await catalog.open(directory)
    expect(opened.attachments).toMatchObject([{ path: 'assets/avatar.png', kind: 'image' }, { path: 'README.md', kind: 'document' }])
    expect(await catalog.attachment(directory, 'assets/avatar.png')).toEqual({ kind: 'image', content: `data:image/png;base64,${Buffer.from('avatar').toString('base64')}` })
    expect(await catalog.attachment(directory, 'README.md')).toEqual({ kind: 'document', content: '# Author notes' })
    await expect(catalog.attachment(directory, 'index.html')).rejects.toThrow('not a supported')
    await expect(catalog.attachment(directory, '../secret.txt')).rejects.toThrow('not a supported')
  })

  it('discovers saved and copied directories only on scan, without adopting copied identity', async () => {
    const { root, directory, catalog, save } = await fixture()
    expect((await catalog.scan()).entries).toEqual([])
    await save()
    const first = await catalog.scan()
    expect(first.entries).toMatchObject([{ name: 'Alice', registeredCardId: 'card-1', sameSourceCount: 0 }])
    const copied = join(root, 'characters/copied Alice')
    await fs.cp(directory, copied, { recursive: true })
    expect(catalog.list().entries).toHaveLength(1)
    const refreshed = await catalog.scan()
    expect(refreshed.entries).toHaveLength(2)
    const copy = refreshed.entries.find(entry => entry.directory === copied)!
    expect(copy.sourceCardId).toBe('card-1')
    expect(copy.registeredCardId).toBeUndefined()
    expect(copy.sameSourceCount).toBe(1)
    const before = await fs.readFile(join(root, '.loom/card-directories/card-1/baseline.json'))
    const opened = await catalog.open(copied)
    expect(opened.name).toBe('Alice')
    expect(opened.promptResources).toEqual([{ id: 'clothing', label: 'Clothing', external: true, indexPath: 'external/prompts/0-Clothing/index.json' }])
    expect(opened.files.some(file => file.path === opened.promptResources[0]!.indexPath)).toBe(true)
    expect(await fs.readFile(join(root, '.loom/card-directories/card-1/baseline.json'))).toEqual(before)
    expect(await fs.readdir(join(root, '.loom/card-directories'))).toEqual(['card-1'])
  })

  it('opens a selected project outside the scan root and ignores unindexed build files and links', async () => {
    const { root, directory, catalog, save } = await fixture()
    await save()
    const outside = join(root, 'selected-project')
    await fs.cp(directory, outside, { recursive: true })
    const original = await catalog.open(outside)
    await fs.mkdir(join(outside, 'node_modules'))
    await fs.symlink('/does-not-exist', join(outside, 'node_modules/unread'))
    const extra = await fs.open(join(outside, 'unused-large.bin'), 'w')
    await extra.truncate(65 * 1024 * 1024)
    await extra.close()
    expect(await catalog.open(outside)).toEqual(original)
    expect((await catalog.scan()).entries).toHaveLength(1)
    await expect(catalog.open('relative/path')).rejects.toThrow('absolute')
  })

  it('isolates broken headers and validates referenced files only when opened', async () => {
    const { root, directory, catalog, save } = await fixture()
    await save()
    await fs.mkdir(join(root, 'characters/plain-folder'))
    await fs.mkdir(join(root, 'characters/broken'))
    await fs.writeFile(join(root, 'characters/broken/manifest.json'), '{')
    await fs.symlink(directory, join(root, 'characters/linked'))
    const result = await catalog.scan()
    expect(result.entries).toHaveLength(3)
    expect(result.entries.filter(entry => entry.error)).toHaveLength(2)
    await fs.rm(join(directory, 'card/description.md'))
    expect((await catalog.scan()).entries.find(entry => entry.directory === directory)?.error).toBeUndefined()
    await expect(catalog.open(directory)).rejects.toThrow('missing card/description.md')
  })

  it('rejects traversal and indexed symlinks rather than reading outside the selected project', async () => {
    const { root, directory, catalog, save } = await fixture()
    await save()
    const cardPath = join(directory, 'card.json')
    const card = JSON.parse(await fs.readFile(cardPath, 'utf8'))
    await fs.writeFile(join(root, 'characters/secret.txt'), 'not a project resource')
    await fs.writeFile(cardPath, JSON.stringify({ ...card, description: '../secret.txt' }))
    await expect(catalog.open(directory)).rejects.toThrow('Unsafe ZIP entry')
    await fs.writeFile(cardPath, JSON.stringify(card))
    await fs.rm(join(directory, 'card/description.md'))
    await fs.symlink(join(root, 'characters/secret.txt'), join(directory, 'card/description.md'))
    await expect(catalog.open(directory)).rejects.toThrow('symbolic link')
  })

  it('does not register a mismatched identity or read oversized scan headers', async () => {
    const { root, directory, catalog, save } = await fixture()
    await save()
    const manifestPath = join(directory, 'manifest.json')
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
    manifest.resources.metadata.metadata.exportedFromCardId = 'someone-else'
    await fs.writeFile(manifestPath, JSON.stringify(manifest))
    const entry = (await catalog.scan()).entries[0]!
    expect(entry.error).toContain('identity differs')
    expect(entry.registeredCardId).toBeUndefined()
    await fs.mkdir(join(root, 'characters/large'))
    await fs.writeFile(join(root, 'characters/large/manifest.json'), Buffer.alloc(4 * 1024 * 1024 + 1))
    expect((await catalog.scan()).entries.find(item => item.directory.endsWith('/large'))?.error).toContain('4 MiB')
  })

  it('refuses a known unfinished save rather than presenting its partial files', async () => {
    const { root, directory, catalog, save } = await fixture()
    await save()
    const pending = join(root, '.loom/card-directories/card-1/pending')
    await fs.mkdir(pending)
    await fs.writeFile(join(pending, 'journal.json'), '{}')
    await expect(catalog.open(directory)).rejects.toThrow('unfinished save')
  })
})
