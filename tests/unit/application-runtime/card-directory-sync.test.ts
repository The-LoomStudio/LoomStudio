import { createApplicationRuntime, type CardBundleArtifact } from '@loom-studio/application-runtime'
import { createBlobStore } from '@loom-studio/blob-store'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createPromptResourceStore } from '@loom-studio/prompt-resource-store'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createApplicationRuntimeContext } from '../../../packages/application-runtime/src/foundation/application-context.js'
import { createCardDirectoryRuntimeMethods } from '../../../packages/application-runtime/src/runtime/card-directory-sync.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup() })

async function fixture() {
  let sequence = 0
  const createId = (prefix: string) => `${prefix}-${++sequence}`
  const now = () => '2026-09-12T00:00:00.000Z'
  const dataEngine = createSqliteDataEngine({ filename: ':memory:', createId, now })
  const rootDirectory = await mkdtemp(join(tmpdir(), 'card-directory-sync-'))
  const options = {
    dataEngine,
    documents: createSqliteDocumentStore({ engine: dataEngine }),
    promptResources: createPromptResourceStore({ engine: dataEngine, createId, now }),
    blobs: createBlobStore({ engine: dataEngine, rootDirectory, createId, now }),
  }
  cleanups.push(async () => { dataEngine.close(); await rm(rootDirectory, { recursive: true, force: true }) })
  const runtime = createApplicationRuntime(options)
  const ctx = createApplicationRuntimeContext(options)
  const sync = createCardDirectoryRuntimeMethods(ctx)
  const { card } = await runtime.importCardBundle({ artifact: artifact() })
  return { ...options, runtime, sync, card, ctx }
}

function source(extra = '') {
  return `// ==LoomScript==\n// @format       1\n// @id           card.panel\n// @name         Card panel\n// @version      1.0.0\n// @runtime      client-sandbox\n// @capability   state.read\n${extra}// @contribution {"kind":"renderer","id":"panel","surface":"narrative.entry.inline","scope":"node","inputs":["match:card.status"]}\n// ==/LoomScript==\nexport const value = 1\n`
}

function artifact(): CardBundleArtifact {
  return {
    schemaVersion: 4, artifactId: 'sync-card', displayName: 'Sync card',
    card: { name: 'Sync card', macros: { mood: 'calm' } },
    contextAssets: [{ id: 'root', kind: 'module', category: 'setting', label: 'World', children: [
      { id: 'entry', kind: 'entry', label: 'Town', body: 'Old town' },
    ] }],
    extensionPayloads: [{ id: 'config', packageId: 'example.config', fileName: 'config.json', format: 'example.config', mediaType: 'application/json', content: '{"value":1}' }],
    scriptAttachments: [{ script: { format: 'loom.script', schemaVersion: 1, fileName: 'panel.loom.js', source: source() }, orderIndex: 0 }],
    stateTemplates: [{ id: 'state-template', templateVersion: 1, schema: { type: 'object', properties: { score: { type: 'number' } } }, initial: { score: 1 } }],
  }
}

describe('Card directory Apply', () => {
  it('updates private resources in place and keeps Script grants independent', async () => {
    const f = await fixture()
    const captured = await f.sync.captureCardDirectoryState({ cardId: f.card.id })
    const mounts = await f.runtime.listLoomScriptMounts({ target: { kind: 'card', cardId: f.card.id } })
    const mount = mounts.mounts[0]!
    const scriptBefore = await f.documents.get(mount.scriptDocumentId)
    captured.artifact.card.name = 'Edited card'
    captured.artifact.card.macros = { mood: 'happy' }
    captured.artifact.contextAssets[0]!.children![0]!.body = 'New town'
    captured.artifact.contextAssets[0]!.children!.push({ id: 'new-entry', kind: 'entry', label: 'River', body: 'Blue' })
    captured.artifact.extensionPayloads![0]!.content = '{"value":2}'
    captured.artifact.scriptAttachments![0]!.script.source = source().replace('value = 1', 'value = 2')
    captured.artifact.state!.contribution.templates[0]!.initial = { score: 2 }
    await f.sync.applyCardDirectoryState({ cardId: f.card.id, ...captured })
    const next = await f.runtime.getCard({ cardId: f.card.id })
    expect(next.card).toMatchObject({ id: f.card.id, name: 'Edited card', promptResourceIds: f.card.promptResourceIds, portableExtensionPayloadIds: f.card.portableExtensionPayloadIds })
    expect((await f.promptResources.getResource(f.card.promptResourceIds![0]!))!.rootNode.children).toMatchObject([{ id: 'entry', body: 'New town' }, { id: 'new-entry', body: 'Blue' }])
    expect((await f.documents.get(mount.scriptDocumentId))!.version).toBe(scriptBefore!.version + 1)
    expect((await f.runtime.listLoomScriptMounts({ target: { kind: 'card', cardId: f.card.id } })).mounts[0]).toMatchObject({ id: mount.id, enabled: false, grantedCapabilities: [] })
    expect((await f.documents.get('state-template'))!.content).toMatchObject({ initial: { score: 2 } })
    expect((await f.documents.get(f.card.portableExtensionPayloadIds![0]!))!.content).toMatchObject({ content: '{"value":2}' })
  })

  it('rejects a changed shared Prompt but allows an unchanged shared Prompt', async () => {
    const f = await fixture()
    const other = await f.runtime.createCard({ name: 'Other' })
    await f.runtime.updateCardPromptResources({ cardId: other.card.id, promptResourceIds: f.card.promptResourceIds! })
    const captured = await f.sync.captureCardDirectoryState({ cardId: f.card.id })
    const changed = structuredClone(captured.artifact)
    changed.contextAssets[0]!.children![0]!.body = 'Shared write'
    await expect(f.sync.applyCardDirectoryState({ cardId: f.card.id, artifact: changed, snapshot: captured.snapshot })).rejects.toThrow('shared resource')
    captured.artifact.card.name = 'Only Card changes'
    await expect(f.sync.applyCardDirectoryState({ cardId: f.card.id, ...captured })).resolves.toHaveProperty('mutation.changesetId')
  })

  it('rejects stale CAS without partial Prompt or Card writes', async () => {
    const f = await fixture()
    const captured = await f.sync.captureCardDirectoryState({ cardId: f.card.id })
    captured.artifact.card.name = 'Directory change'
    captured.artifact.contextAssets[0]!.children![0]!.body = 'Directory town'
    await f.runtime.updateCard({ cardId: f.card.id, name: 'Database change' })
    await expect(f.sync.applyCardDirectoryState({ cardId: f.card.id, ...captured })).rejects.toThrow('version conflict')
    expect((await f.runtime.getCard({ cardId: f.card.id })).card.name).toBe('Database change')
    expect((await f.promptResources.getResource(f.card.promptResourceIds![0]!))!.rootNode.children![0]!.body).toBe('Old town')
  })

  it('rolls back earlier Prompt mutations when a later tree operation fails', async () => {
    const f = await fixture()
    await f.promptResources.createResource({ actor: { kind: 'kernel', id: 'test' }, resourceKind: 'setting', rootNode: { id: 'occupied', kind: 'module', label: 'Other resource' } })
    const captured = await f.sync.captureCardDirectoryState({ cardId: f.card.id })
    captured.artifact.contextAssets[0]!.label = 'New label'
    captured.artifact.contextAssets[0]!.children![0]!.body = 'Intermediate write'
    captured.artifact.contextAssets[0]!.children!.push({ id: 'occupied', kind: 'entry', label: 'Collision' })
    await expect(f.sync.applyCardDirectoryState({ cardId: f.card.id, ...captured })).rejects.toThrow()
    expect((await f.promptResources.getResource(f.card.promptResourceIds![0]!))!.rootNode.children![0]!.body).toBe('Old town')
    expect((await f.runtime.getCard({ cardId: f.card.id })).card.version).toBe(f.card.version)
  })

  it('does not grant newly requested capabilities or enable a Script', async () => {
    const f = await fixture()
    const before = (await f.runtime.listLoomScriptMounts({ target: { kind: 'card', cardId: f.card.id } })).mounts[0]!
    const script = await f.documents.get(before.scriptDocumentId)
    await f.runtime.updateLoomScript({ scriptDocumentId: script!.id, expectedVersion: script!.version, fileName: 'panel.loom.js', source: source().replace('// @capability   state.read\n', '') })
    const captured = await f.sync.captureCardDirectoryState({ cardId: f.card.id })
    captured.artifact.scriptAttachments![0]!.script.source = source()
    await f.sync.applyCardDirectoryState({ cardId: f.card.id, ...captured })
    const mounts = await f.runtime.listLoomScriptMounts({ target: { kind: 'card', cardId: f.card.id } })
    expect(mounts.mounts[0]).toMatchObject({ enabled: false, grantedCapabilities: [] })
  })
})
