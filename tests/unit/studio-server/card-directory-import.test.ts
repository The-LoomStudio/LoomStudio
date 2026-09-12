import { afterEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { encodeCardBundleFiles, type CardBundleFilesInput } from '../../../apps/studio-server/src/codecs/card-bundle-zip.js'
import { createCardDirectoryService } from '../../../apps/studio-server/src/resource-directories/card-directory.js'
import { createCardDirectoryCatalog } from '../../../apps/studio-server/src/resource-directories/card-directory-catalog.js'
import { createCardDirectoryImporter } from '../../../apps/studio-server/src/resource-directories/card-directory-import.js'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }) })
async function fixture() {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'loom-directory-import-')))
  roots.push(root)
  const directory = join(root, 'characters', 'Alice project')
  const input: CardBundleFilesInput = { artifact: { schemaVersion: 4, artifactId: 'source', displayName: 'Alice', card: { name: 'Alice' }, contextAssets: [] }, avatar: { bytes: Buffer.from('image'), mediaType: 'image/png' } }
  for (const [path, bytes] of Object.entries(encodeCardBundleFiles(input))) {
    await fs.mkdir(dirname(join(directory, path)), { recursive: true })
    await fs.writeFile(join(directory, path), bytes)
  }
  await fs.writeFile(join(directory, 'README.md'), '# Personal source notes')
  const cards = new Map<string, CardBundleFilesInput>()
  const service = createCardDirectoryService({ dataRoot: root, readCard: async id => cards.get(id)! })
  const catalog = createCardDirectoryCatalog({ dataRoot: root, listCardIds: async () => [...cards.keys()] })
  let failImport = false
  let failNormalize = false
  const importer = createCardDirectoryImporter({
    dataRoot: root,
    cardExists: async id => cards.has(id),
    isRegistered: async path => (await catalog.scan()).entries.some(entry => entry.directory === path && Boolean(entry.registeredCardId)),
    importCard: async (bundle, id) => {
      if (failImport) throw new Error('database failure')
      cards.set(id, { ...bundle, artifact: { ...bundle.artifact, metadata: { ...bundle.artifact.metadata, exportedFromCardId: id } } })
    },
    normalizeCard: async id => {
      if (failNormalize) throw new Error('normalization failed')
      await service.recoverCard(id)
      await service.saveCard(id, (await service.previewCard(id)).token)
    },
  })
  return { root, directory, cards, service, catalog, importer, setFailure: (kind: 'import' | 'normalize', value: boolean) => { if (kind === 'import') failImport = value; else failNormalize = value } }
}

describe('directory import registration', () => {
  it('registers the existing folder once, preserves author files, and deletes through its binding', async () => {
    const f = await fixture()
    const token = (await f.catalog.open(f.directory)).token
    const { cardId } = await f.importer.importDirectory(f.directory, token, 'client')
    expect((await f.catalog.scan()).entries).toMatchObject([{ directory: f.directory, registeredCardId: cardId }])
    expect(await fs.readFile(join(f.directory, 'README.md'), 'utf8')).toContain('Personal source')
    await expect(f.importer.importDirectory(f.directory, token, 'client')).rejects.toThrow('already registered')
    expect(f.cards.size).toBe(1)
    await f.service.deleteCard(cardId, async () => { f.cards.delete(cardId) })
    await expect(fs.stat(f.directory)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('does not modify the original directory when DB import fails or validation is stale', async () => {
    const f = await fixture()
    const before = await fs.readFile(join(f.directory, 'manifest.json'))
    await expect(f.importer.importDirectory(f.directory, 'stale', 'client')).rejects.toThrow('changed since validation')
    f.setFailure('import', true)
    await expect(f.importer.importDirectory(f.directory, (await f.catalog.open(f.directory)).token, 'client')).rejects.toThrow('database failure')
    expect(f.cards.size).toBe(0)
    expect(await fs.readFile(join(f.directory, 'manifest.json'))).toEqual(before)
  })
  it('recovers registration after the database committed without importing a second Card', async () => {
    const f = await fixture()
    f.setFailure('normalize', true)
    await expect(f.importer.importDirectory(f.directory, (await f.catalog.open(f.directory)).token, 'client')).rejects.toThrow('Do not import again')
    expect(f.cards.size).toBe(1)
    expect(await f.importer.recoverImports()).toMatchObject([{ cardId: [...f.cards.keys()][0], error: 'normalization failed' }])
    expect((await f.catalog.scan()).entries[0]?.error).toContain('unfinished operation')
    f.setFailure('normalize', false)
    expect(await f.importer.recoverImports()).toEqual([])
    expect((await f.catalog.scan()).entries[0]?.registeredCardId).toBe([...f.cards.keys()][0])
    expect(f.cards.size).toBe(1)
  })
})
