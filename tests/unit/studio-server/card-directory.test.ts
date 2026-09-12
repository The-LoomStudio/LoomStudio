import { afterEach, describe, expect, it, vi } from 'vitest'
import { join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import * as fs from 'node:fs/promises'
import { createCardDirectoryService } from '../../../apps/studio-server/src/resource-directories/card-directory.js'
import { decodeCardBundleFiles, type CardBundleFilesInput } from '../../../apps/studio-server/src/codecs/card-bundle-zip.js'

const fault = vi.hoisted(() => ({ remaining: 0, cleanup: false }))
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    rm: async (path: string, options: Parameters<typeof actual.rm>[1]) => {
      if (fault.cleanup && path.endsWith('/.loom/card-directories/card-1')) {
        fault.cleanup = false
        throw new Error('simulated cleanup failure')
      }
      return actual.rm(path, options)
    },
    rename: async (from: string, to: string) => {
      await actual.rename(from, to)
      if (to.includes('/characters/') && fault.remaining > 0 && --fault.remaining === 0) throw new Error('simulated interruption')
    },
  }
})

const roots: string[] = []
afterEach(async () => {
  fault.remaining = 0
  fault.cleanup = false
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true })
})

async function setup() {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'loom-directory-')))
  roots.push(root)
  const bundle: CardBundleFilesInput = {
    artifact: {
      schemaVersion: 4, artifactId: 'source', displayName: 'Card',
      card: { name: 'Card', description: 'Description', opening: 'Opening', macros: { user: 'Player' } },
      contextAssets: [{
        id: 'book', kind: 'module', label: 'World', category: 'setting',
        children: [{ id: 'entry', kind: 'entry', label: 'Entry', body: 'World text' }],
      }],
      extensionPayloads: [{
        id: 'payload', packageId: 'example.package', fileName: 'data.json', format: 'example.data', mediaType: 'application/json', content: '{"value":1}',
      }],
      scriptAttachments: [{
        orderIndex: 0,
        script: {
          format: 'loom.script', schemaVersion: 1, fileName: 'panel.loom.js',
          source: [
            '// ==LoomScript==', '// @format 1', '// @id directory.panel',
            '// @name Panel', '// @version 1.0.0', '// @runtime client-sandbox',
            '// @contribution {"kind":"renderer","id":"panel","surface":"shell.workspace-panel","scope":"workspace","inputs":["artifact:panel"]}',
            '// ==/LoomScript==', 'export const renderers = {}', '',
          ].join('\r\n'),
        },
      }],
      metadata: { exportedAt: 'first' },
    },
    avatar: { bytes: Buffer.from('image'), mediaType: 'image/png' },
  }
  const service = createCardDirectoryService({ dataRoot: root, readCard: async () => bundle })
  const save = async () => service.saveCard('card-1', (await service.previewCard('card-1')).token)
  return { root, bundle, service, save, directory: join(root, 'characters/card-1') }
}

async function fileMap(root: string) {
  const files = new Map<string, Uint8Array>()
  async function walk(path: string) {
    for (const item of await fs.readdir(path, { withFileTypes: true })) {
      const target = join(path, item.name)
      if (item.isDirectory()) await walk(target)
      else files.set(relative(root, target), await fs.readFile(target))
    }
  }
  await walk(root)
  return files
}

describe('card resource directories', () => {
  it('does not restore a deleted card directory if post-commit cleanup fails', async () => {
    const { root, directory, service, save } = await setup()
    await save()
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    fault.cleanup = true
    await expect(service.deleteCard('card-1', async () => 'committed')).resolves.toBe('committed')
    await expect(fs.stat(directory)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(log).toHaveBeenCalled()
    await service.recoverDeletions(async () => false)
    await expect(fs.stat(join(root, '.loom/card-directories/card-1'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves a newly created directory when rollback would collide with it', async () => {
    const { root, directory, service, save } = await setup()
    await save()
    await expect(service.deleteCard('card-1', async () => {
      await fs.mkdir(directory)
      await fs.writeFile(join(directory, 'new.txt'), 'external')
      throw new Error('database failure')
    })).rejects.toThrow('directory recovery required')
    expect(await fs.readFile(join(directory, 'new.txt'), 'utf8')).toBe('external')
    await expect(fs.stat(join(root, '.loom/card-directories/card-1/deleted/manifest.json'))).resolves.toBeTruthy()
    await expect(service.recoverDeletions(async () => true)).rejects.toThrow('conflicts')
  })

  it('deletes the saved directory including author files only after committing card deletion', async () => {
    const { root, directory, service, save } = await setup()
    await save()
    await fs.writeFile(join(directory, 'README.md'), 'Author notes')
    await expect(service.deleteCard('card-1', async () => {
      await expect(fs.stat(directory)).rejects.toMatchObject({ code: 'ENOENT' })
      return 'deleted'
    })).resolves.toBe('deleted')
    await expect(fs.stat(directory)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.stat(join(root, '.loom/card-directories/card-1'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('restores the whole directory when the database commit fails and excludes concurrent saves', async () => {
    const { directory, service, save } = await setup()
    await save()
    const before = await fileMap(directory)
    await expect(service.deleteCard('card-1', async () => {
      await expect(service.previewCard('card-1')).rejects.toThrow('already running')
      throw new Error('database failure')
    })).rejects.toThrow('database failure')
    expect(await fileMap(directory)).toEqual(before)
    await expect(save()).resolves.toMatchObject({ changedFiles: 0 })
  })

  it.each([true, false])('recovers an interrupted deletion using DB existence: %s', async exists => {
    const { root, directory, service, save } = await setup()
    await save()
    const metadata = join(root, '.loom/card-directories/card-1')
    await fs.writeFile(join(metadata, 'delete.json'), JSON.stringify({ cardId: 'card-1' }))
    await fs.rename(directory, join(metadata, 'deleted'))
    await service.recoverDeletions(async () => exists)
    if (exists) await expect(save()).resolves.toMatchObject({ changedFiles: 0 })
    else await expect(fs.stat(metadata)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('saves a complete file bundle, round trips attachments, and ignores ephemeral export time', async () => {
    const { service, save, bundle, directory } = await setup()
    const first = await save()
    expect(first.changedFiles).toBeGreaterThan(5)
    const read = decodeCardBundleFiles(await fileMap(directory))
    expect(read.artifact.card).toMatchObject(bundle.artifact.card)
    expect(read.artifact.contextAssets).toEqual(bundle.artifact.contextAssets)
    expect(read.artifact.extensionPayloads).toEqual(bundle.artifact.extensionPayloads)
    expect(read.artifact.scriptAttachments).toEqual(bundle.artifact.scriptAttachments)
    expect(read.avatar.bytes).toEqual(bundle.avatar.bytes)
    bundle.artifact.metadata!.exportedAt = 'later'
    expect((await service.previewCard('card-1')).changes).toEqual([])
    expect((await save()).changedFiles).toBe(0)
    expect(bundle.artifact.metadata!.exportedAt).toBe('later')
  })

  it('writes only changed files and preserves untracked source files', async () => {
    const { service, save, bundle, directory } = await setup()
    await save()
    const oldStat = await fs.stat(join(directory, 'assets/avatar.png'))
    await fs.mkdir(join(directory, 'src'))
    await fs.writeFile(join(directory, 'src/custom.js'), 'private source')
    bundle.artifact.card.description = 'Updated description'
    expect((await service.previewCard('card-1')).changes).toEqual([{ path: 'card/description.md', kind: 'modified' }])
    expect((await save()).changedFiles).toBe(1)
    expect((await fs.stat(join(directory, 'assets/avatar.png'))).mtimeMs).toBe(oldStat.mtimeMs)
    expect(await fs.readFile(join(directory, 'src/custom.js'), 'utf8')).toBe('private source')
  })

  it('rejects a stale DB preview and then external edits without overwriting', async () => {
    const { service, save, bundle, directory } = await setup()
    await save()
    const preview = await service.previewCard('card-1')
    bundle.artifact.card.description = 'New DB content'
    await expect(service.saveCard('card-1', preview.token)).rejects.toThrow('stale')
    await fs.writeFile(join(directory, 'card/description.md'), 'IDE content')
    const conflicts = await service.previewCard('card-1')
    expect(conflicts.conflicts).toEqual(['card/description.md'])
    await expect(service.saveCard('card-1', conflicts.token)).rejects.toThrow('External edits preserved')
    expect(await fs.readFile(join(directory, 'card/description.md'), 'utf8')).toBe('IDE content')
  })

  it('rejects an untracked file collision and does not adopt its bytes', async () => {
    const { service, save, directory } = await setup()
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(join(directory, 'card.json'), 'user file')
    expect((await service.previewCard('card-1')).conflicts).toContain('card.json')
    await expect(save()).rejects.toThrow('External edits preserved')
    expect(await fs.readFile(join(directory, 'card.json'), 'utf8')).toBe('user file')
  })

  it('recovers partial multi-file replacement in a fresh service without advancing baseline', async () => {
    const { root, save, bundle, directory } = await setup()
    await save()
    const before = await fileMap(directory)
    bundle.artifact.card.description = 'Changed'
    bundle.artifact.card.opening = 'Changed opening'
    bundle.artifact.card.macros = { user: 'Changed player' }
    fault.remaining = 2
    await expect(save()).rejects.toThrow('simulated interruption')
    const restarted = createCardDirectoryService({ dataRoot: root, readCard: async () => bundle })
    await expect(restarted.previewCard('card-1')).rejects.toThrow('unfinished save')
    expect(await restarted.recoverCard('card-1')).toEqual({ recovered: true })
    expect(await fileMap(directory)).toEqual(before)
    expect((await restarted.previewCard('card-1')).changes).toHaveLength(3)
  })

  it('refuses rollback over an IDE edit made after interruption', async () => {
    const { service, save, bundle, directory } = await setup()
    await save()
    bundle.artifact.card.description = 'Changed'
    bundle.artifact.card.opening = 'Changed opening'
    fault.remaining = 1
    await expect(save()).rejects.toThrow('simulated interruption')
    await fs.writeFile(join(directory, 'card/description.md'), 'New IDE content')
    const before = await fileMap(directory)
    await expect(service.recoverCard('card-1')).rejects.toThrow('Recovery conflict')
    expect(await fileMap(directory)).toEqual(before)
  })

  it('deletes removed managed files, but preserves directories and other files', async () => {
    const { save, bundle, directory } = await setup()
    await save()
    await fs.writeFile(join(directory, 'card/notes.md'), 'untracked notes')
    delete bundle.artifact.card.description
    await save()
    await expect(fs.stat(join(directory, 'card/description.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await fs.readFile(join(directory, 'card/notes.md'), 'utf8')).toBe('untracked notes')
  })

  it('rejects traversal and symlinked author directories', async () => {
    const { root, service } = await setup()
    await expect(service.previewCard('../escape')).rejects.toThrow('Invalid card')
    await fs.mkdir(join(root, 'elsewhere'))
    await fs.symlink(join(root, 'elsewhere'), join(root, 'characters'))
    await expect(service.previewCard('card-1')).rejects.toThrow('symbolic link')
    expect(await fs.readdir(join(root, 'elsewhere'))).toEqual([])
  })
})
