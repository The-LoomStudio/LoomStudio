import { createApplicationRuntime, type CardBundleArtifact } from '@loom-studio/application-runtime'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createPromptResourceStore } from '@loom-studio/prompt-resource-store'
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCardDirectoryService } from '../../../apps/studio-server/src/resource-directories/card-directory.js'

const cleanups: Array<() => Promise<void>> = []
const fault = vi.hoisted(() => ({ renameTo: '' }))
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, rename: async (from: string, to: string) => {
    await actual.rename(from, to)
    if (to === fault.renameTo) { fault.renameTo = ''; throw new Error('interrupted directory finalization') }
  } }
})
afterEach(async () => { fault.renameTo = ''; for (const cleanup of cleanups.splice(0)) await cleanup() })

async function setup() {
  let sequence = 0
  const createId = (prefix: string) => `${prefix}-${++sequence}`
  const now = () => '2026-09-12T00:00:00.000Z'
  const dataEngine = createSqliteDataEngine({ filename: ':memory:', createId, now })
  const root = await realpath(await mkdtemp(join(tmpdir(), 'card-directory-apply-')))
  const documents = createSqliteDocumentStore({ engine: dataEngine })
  const promptResources = createPromptResourceStore({ engine: dataEngine, createId, now })
  const runtime = createApplicationRuntime({ dataEngine, documents, promptResources })
  cleanups.push(async () => { dataEngine.close(); await rm(root, { recursive: true, force: true }) })
  const artifact: CardBundleArtifact = {
    schemaVersion: 4, artifactId: 'directory-card', displayName: 'Directory card',
    card: { name: 'Directory card', description: 'Original description' },
    contextAssets: [{ id: 'root', kind: 'module', category: 'setting', label: 'World', children: [
      { id: 'entry', kind: 'entry', label: 'Town', body: 'Original town' },
    ] }],
  }
  const { card } = await runtime.importCardBundle({ artifact })
  let failAfterCommit = false
  const service = createCardDirectoryService({
    dataRoot: root,
    readCard: async cardId => ({
      ...await runtime.captureCardDirectoryState({ cardId }),
      avatar: { bytes: Buffer.from('fixture-avatar'), mediaType: 'image/png' },
    }),
    applyCard: async (cardId, changed, snapshot, context) => {
      await runtime.applyCardDirectoryState({ cardId, artifact: changed, snapshot }, context)
      if (failAfterCommit) throw new Error('simulated response loss after commit')
    },
  })
  const directory = join(root, `characters/${card.id}`)
  const description = join(directory, 'card/description.md')
  const promptBody = join(directory, 'prompts/0-World/0-Town.md')
  const promptIndex = join(directory, 'prompts/0-World/index.json')
  const save = async () => service.saveCard(card.id, (await service.previewCard(card.id)).token)
  const apply = async () => service.apply(card.id, (await service.previewApply(card.id)).token)
  const baseline = () => readFile(join(root, `.loom/card-directories/${card.id}/baseline.json`), 'utf8')
  return { root, directory, description, promptBody, promptIndex, baseline, runtime, service, card, documents, promptResources, save, apply,
    loseResponse: () => { failAfterCommit = true } }
}

async function diskFiles(directory: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  async function visit(path: string, prefix: string) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const relative = `${prefix}${entry.name}`
      if (entry.isDirectory()) await visit(join(path, entry.name), `${relative}/`)
      else result[relative] = (await readFile(join(path, entry.name))).toString('base64')
    }
  }
  await visit(directory, '')
  return result
}

describe('Card directory Runtime integration', () => {
  it('saves, applies Markdown to the original Card, and saves again without differences', async () => {
    const f = await setup()
    await f.save()
    await writeFile(f.description, 'Edited description')
    await writeFile(f.promptBody, 'Edited town')
    const preview = await f.service.previewApply(f.card.id)
    expect(preview.conflicts).toEqual([])
    expect(preview.changes.map(change => change.path)).toEqual(expect.arrayContaining(['card/description.md', 'prompts/0-World/0-Town.md']))
    await f.service.apply(f.card.id, preview.token)
    expect((await f.runtime.getCard({ cardId: f.card.id })).card).toMatchObject({ id: f.card.id, description: 'Edited description', promptResourceIds: f.card.promptResourceIds })
    expect((await f.promptResources.getResource(f.card.promptResourceIds![0]!))!.rootNode.children![0]).toMatchObject({ id: 'entry', body: 'Edited town' })
    expect(await f.service.previewCard(f.card.id)).toMatchObject({ changes: [], conflicts: [] })
    expect(await f.save()).toMatchObject({ changedFiles: 0 })
  })

  it('refuses database CAS changes and preserves the edited directory', async () => {
    const f = await setup()
    await f.save()
    await writeFile(f.description, 'Directory description')
    const oldBaseline = await f.baseline()
    await f.runtime.updateCard({ cardId: f.card.id, description: 'Database description' })
    const preview = await f.service.previewApply(f.card.id)
    expect(preview.conflicts).toEqual(['database'])
    await expect(f.service.apply(f.card.id, preview.token)).rejects.toThrow('Database changed')
    expect(await readFile(f.description, 'utf8')).toBe('Directory description')
    expect((await f.runtime.getCard({ cardId: f.card.id })).card.description).toBe('Database description')
    expect(await f.baseline()).toBe(oldBaseline)
  })

  it('keeps shared-write failures recoverable without overwriting DB or disk', async () => {
    const f = await setup()
    const other = await f.runtime.createCard({ name: 'Other' })
    await f.runtime.updateCardPromptResources({ cardId: other.card.id, promptResourceIds: f.card.promptResourceIds! })
    await f.save()
    const oldBaseline = await f.baseline()
    await writeFile(f.promptBody, 'Unapproved shared edit')
    const editedFiles = await diskFiles(f.directory)
    await expect(f.apply()).rejects.toThrow('shared resource')
    await f.service.recoverCard(f.card.id)
    expect(await diskFiles(f.directory)).toEqual(editedFiles)
    expect(await f.baseline()).toBe(oldBaseline)
    expect((await f.promptResources.getResource(f.card.promptResourceIds![0]!))!.rootNode.children![0]!.body).toBe('Original town')
    expect((await f.service.previewApply(f.card.id)).changes).toContainEqual({ path: 'prompts/0-World/0-Town.md', kind: 'modified' })
  })

  it('rolls back a transaction failure and leaves the edited files available for another preview', async () => {
    const f = await setup()
    await f.promptResources.createResource({ actor: { kind: 'kernel', id: 'fixture' }, resourceKind: 'setting', rootNode: { id: 'occupied', kind: 'module', label: 'Occupied' } })
    await f.save()
    const oldBaseline = await f.baseline()
    await writeFile(f.description, 'Uncommitted description')
    await writeFile(f.promptBody, 'Uncommitted town')
    const index = JSON.parse(await readFile(f.promptIndex, 'utf8'))
    index.children.push({ metadata: { id: 'occupied', kind: 'entry', label: 'Collision' } })
    await writeFile(f.promptIndex, JSON.stringify(index))
    const editedFiles = await diskFiles(f.directory)
    await expect(f.apply()).rejects.toThrow()
    await f.service.recoverCard(f.card.id)
    expect(await diskFiles(f.directory)).toEqual(editedFiles)
    expect(await f.baseline()).toBe(oldBaseline)
    expect((await f.runtime.getCard({ cardId: f.card.id })).card).toMatchObject({ version: f.card.version, description: 'Original description' })
    expect((await f.promptResources.getResource(f.card.promptResourceIds![0]!))!.rootNode.children![0]!.body).toBe('Original town')
    expect((await f.service.previewApply(f.card.id)).changes.length).toBeGreaterThan(0)
  })

  it('recovers the baseline when Apply commits but its callback loses the response', async () => {
    const f = await setup()
    await f.save()
    await writeFile(f.description, 'Committed description')
    const editedFiles = await diskFiles(f.directory)
    f.loseResponse()
    await expect(f.apply()).rejects.toThrow('simulated response loss after commit')
    await f.service.recoverCard(f.card.id)
    expect((await f.runtime.getCard({ cardId: f.card.id })).card.description).toBe('Committed description')
    const finalizedFiles = await diskFiles(f.directory)
    const manifest = JSON.parse(Buffer.from(finalizedFiles['manifest.json']!, 'base64').toString('utf8'))
    expect(manifest.resources.metadata.description).toBe('Committed description')
    delete finalizedFiles['manifest.json']
    delete editedFiles['manifest.json']
    expect(finalizedFiles).toEqual(editedFiles)
    const saved = JSON.parse(await f.baseline())
    expect(saved.snapshot).toEqual((await f.runtime.captureCardDirectoryState({ cardId: f.card.id })).snapshot)
    expect(await f.service.previewApply(f.card.id)).toMatchObject({ changes: [], conflicts: [] })
    expect(await f.save()).toMatchObject({ changedFiles: 0 })
  })

  it.each([false, true])('recovers interrupted post-commit file finalization, preserving later IDE edits: %s', async externalEdit => {
    const f = await setup()
    await f.save()
    await writeFile(f.description, 'Committed change')
    fault.renameTo = join(f.directory, 'manifest.json')
    await expect(f.apply()).rejects.toThrow('interrupted directory finalization')
    expect((await f.runtime.getCard({ cardId: f.card.id })).card.description).toBe('Committed change')
    if (externalEdit) {
      await writeFile(f.promptBody, 'Later IDE edit')
      expect(await f.service.recoverApplies()).toMatchObject([{ cardId: f.card.id, error: expect.stringContaining('External edits preserved') }])
      expect(await readFile(f.promptBody, 'utf8')).toBe('Later IDE edit')
      expect((await f.runtime.getCard({ cardId: f.card.id })).card.description).toBe('Committed change')
    } else {
      expect(await f.service.recoverApplies()).toEqual([])
      expect(await f.service.previewCard(f.card.id)).toMatchObject({ changes: [], conflicts: [] })
      await expect(readFile(join(f.root, `.loom/card-directories/${f.card.id}/apply.json`))).rejects.toMatchObject({ code: 'ENOENT' })
    }
  })
})
