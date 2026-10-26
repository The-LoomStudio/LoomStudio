import { afterEach, describe, expect, it, onTestFinished } from 'vitest'
import { mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createInMemoryDocumentStore } from '@loom-studio/document-store'
import { createExtensionFileData } from '../../../apps/studio-server/src/extensions/extension-file-data.js'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
async function setup() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'loom-extension-data-')))
  roots.push(root)
  const documents = createInMemoryDocumentStore()
  onTestFinished(() => documents.close())
  return { root, documents, files: createExtensionFileData(root, documents) }
}

describe('extension file and SQL data ownership', () => {
  it('isolates packages and Card installations, and rejects owner path traversal', async () => {
    const { root, files } = await setup()
    const global = await files.directory('example.a', { kind: 'global' })
    expect(global).toBe(join(root, 'extensions/example.a/global'))
    expect(await files.directory('example.b', { kind: 'global' })).not.toBe(global)
    expect(await files.directory('example.a', { kind: 'card', cardId: '../../foreign' })).not.toBe(global)
    await expect(files.directory('../example.b', { kind: 'global' })).rejects.toThrow('owner')
    await writeFile(join(global, 'memory.json'), '{"floor":40}')
    expect(await readFile(join(global, 'memory.json'), 'utf8')).toBe('{"floor":40}')
  })

  it.skipIf(process.platform === 'win32')('rejects a data directory symlink to another owner', async () => {
    const { root, files } = await setup()
    const own = await files.directory('example.a', { kind: 'global' })
    await symlink(own, join(root, 'extensions/example.b'))
    await expect(files.directory('example.b', { kind: 'global' })).rejects.toThrow('escape')
  })

  it('deletes only explicitly selected global data, preserving other packages, Cards and imported resources', async () => {
    const { files, documents } = await setup()
    for (const [id, type, owner, installation] of [
      ['own', 'airp.extensionRecord', 'example.a', undefined],
      ['custom', 'example.custom', 'example.a', undefined],
      ['other', 'airp.extensionRecord', 'example.b', undefined],
      ['card', 'airp.extensionRecord', 'example.a', 'card-installation'],
      ['resource', 'airp.promptResource', 'example.a', undefined],
    ] as const) {
      await documents.write({ id, type, content: {}, meta: { ownerExtensionId: owner, ...(installation ? { ownerInstallationId: installation } : {}) } })
    }
    const path = await files.directory('example.a', { kind: 'global' })
    const cardPath = await files.directory('example.a', { kind: 'card', cardId: 'card-1' })
    await writeFile(join(path, 'memory.json'), '{}')
    await writeFile(join(cardPath, 'memory.json'), '{"card":true}')
    await files.removeGlobal('example.a', ['example.custom'])
    expect((await documents.get('own', { includeTombstone: true }))?.meta.tombstone).toBeTruthy()
    expect((await documents.get('custom', { includeTombstone: true }))?.meta.tombstone).toBeTruthy()
    for (const id of ['other', 'card', 'resource']) expect((await documents.get(id))?.meta.tombstone).toBeFalsy()
    await expect(readFile(join(path, 'memory.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(cardPath, 'memory.json'), 'utf8')).toBe('{"card":true}')
    await expect(files.removeGlobal('example.empty')).resolves.toBeUndefined()
  })
})
