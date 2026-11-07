import { createId, nowIso } from '@loom-studio/shared'
import { createApplicationRuntime, type CardBundleArtifact } from '@loom-studio/application-runtime'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createPromptResourceStore } from '@loom-studio/application-data'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBlobStore } from '@loom-studio/asset-store'
import { snapshotLoomScriptMounts } from '../../../packages/application-runtime/src/scripts/loom-script-resolution.js'
import { describe, expect, it, onTestFinished } from 'vitest'

function artifact(): CardBundleArtifact {
  return { schemaVersion: 4, artifactId: 'fog-harbor', displayName: 'Fog harbor', card: { name: 'Fog harbor', macros: { narrator: 'author' } },
    contextAssets: [{ id: 'fog.lore', kind: 'module', category: 'lore', label: 'Curfew', children: [{ id: 'fog.curfew', kind: 'entry', label: 'Curfew time', body: '22:00' }] },
      { id: 'fog.preset', kind: 'module', category: 'preset', label: 'Narrator', children: [{ id: 'fog.style', kind: 'entry', label: 'Style', body: 'Third person' }] }],
    contextAssetSettings: { 'fog.preset': { macros: { tone: 'gentle' } } } }
}
function fixture() {
  const engine = createSqliteDataEngine({ filename: ':memory:', createId, now: nowIso })
  const documents = createSqliteDocumentStore({ engine })
  const promptResources = createPromptResourceStore({ engine })
  const rootDirectory = mkdtempSync(join(tmpdir(), 'loom-card-update-'))
  onTestFinished(() => rmSync(rootDirectory, { recursive: true, force: true }))
  const blobs = createBlobStore({ engine, rootDirectory, createId, now: nowIso })
  const runtime = createApplicationRuntime({ dataEngine: engine, documents, promptResources, blobs })
  return { engine, documents, promptResources, runtime }
}

describe('Card package update', () => {
  it('keeps author/local identities across duplicate imports, adopts new content and preserves player choices', async () => {
    const f = fixture()
    try {
      const first = await f.runtime.importCardBundle({ artifact: artifact() })
      const second = await f.runtime.importCardBundle({ artifact: artifact() })
      const id = second.card.promptResourceIds![0]!
      const resource = (await f.promptResources.getResource(id))!
      expect(resource.rootNodeId).not.toBe('fog.lore')
      await f.promptResources.mutateResource({ actor: { kind: 'system', id: 'player' }, reason: 'player-edit', resourceId: id, expectedVersion: resource.version,
        mutations: [{ kind: 'tree.replace', rootNode: { ...resource.rootNode, children: resource.rootNode.children!.map(child => ({ ...child, body: '23:00' })) } }] })
      const next = artifact()
      next.card.name = 'Fog harbor revised'
      next.contextAssets[0]!.children![0]!.body = '21:00'
      next.contextAssets[1]!.children![0]!.body = 'Second person'
      next.contextAssets.push({ id: 'fog.dock', kind: 'module', category: 'lore', label: 'New dock', body: 'A new wharf' })
      const input = { cardId: second.card.id, expectedVersion: second.card.version, artifact: next }
      const preview = await f.runtime.previewCardPackageUpdate(input)
      expect(preview.blockingChanges).toEqual([])
      expect(preview.items[0]!.local?.rootNode.children![0]!.body).toBe('23:00')
      expect(preview.items[0]!.incoming?.rootNode.children![0]!.id).toBe(resource.rootNode.children![0]!.id)
      const updated = await f.runtime.applyCardPackageUpdate({ ...input, expectedFingerprint: preview.fingerprint, keepPromptResourceIds: [id], keepCardFields: ['name'] })
      expect(updated.card.id).toBe(second.card.id)
      expect(updated.card.name).toBe('Fog harbor')
      expect(updated.card.promptResourceIds).toHaveLength(3)
      expect((await f.runtime.getPromptResource({ resourceId: id })).resource.rootNode.children![0]!.body).toBe('23:00')
      expect((await f.runtime.getPromptResource({ resourceId: second.card.promptResourceIds![1]! })).resource.rootNode.children![0]!.body).toBe('Second person')
      expect((await f.runtime.getPromptResource({ resourceId: first.card.promptResourceIds![1]! })).resource.rootNode.children![0]!.body).toBe('Third person')
      const repeated = await f.runtime.previewCardPackageUpdate({ ...input, expectedVersion: updated.card.version })
      expect(repeated.items.find(item => item.sourceId === 'fog.lore')!.action).toBe('update')
    } finally { await f.engine.close() }
  })

  it('refuses legacy node mappings that cannot be proven instead of guessing by current order', async () => {
    const f = fixture()
    try {
      await f.runtime.importCardBundle({ artifact: artifact() })
      const { card } = await f.runtime.importCardBundle({ artifact: artifact() })
      const bundle = (await f.documents.get(card.importBundleId!))!
      const content = { ...(bundle.content as Record<string, unknown>) }
      delete content.resourceMappings
      await f.documents.write({ id: bundle.id, type: bundle.type, content: content as never, expectedVersion: bundle.version,
        actor: { kind: 'system', id: 'test' }, reason: 'legacy-fixture' })
      await expect(f.runtime.previewCardPackageUpdate({ cardId: card.id, expectedVersion: card.version, artifact: artifact() })).rejects.toThrow('cannot be proven')
    } finally { await f.engine.close() }
  })

  it('rejects a stale preview and mismatched artifact without writing', async () => {
    const f = fixture()
    try {
      const { card } = await f.runtime.importCardBundle({ artifact: artifact() })
      const input = { cardId: card.id, expectedVersion: card.version, artifact: artifact() }
      const preview = await f.runtime.previewCardPackageUpdate(input)
      const resource = (await f.promptResources.getResource(card.promptResourceIds![0]!))!
      await f.promptResources.mutateResource({ actor: { kind: 'system', id: 'player' }, reason: 'concurrent', resourceId: resource.id, expectedVersion: resource.version,
        mutations: [{ kind: 'resource.update', patch: { label: 'Concurrent change' } }] })
      await expect(f.runtime.applyCardPackageUpdate({ ...input, expectedFingerprint: preview.fingerprint })).rejects.toThrow('preview the update again')
      await expect(f.runtime.previewCardPackageUpdate({ ...input, artifact: { ...artifact(), artifactId: 'other-card' } })).rejects.toThrow('identity does not match')
      expect((await f.runtime.getCard({ cardId: card.id })).card.version).toBe(card.version)
    } finally { await f.engine.close() }
  })

  it('lists unsupported package component changes and never silently discards them', async () => {
    const f = fixture()
    try {
      const { card } = await f.runtime.importCardBundle({ artifact: artifact() })
      const next = artifact()
      next.stateTemplates = [{ id: 'wallet', templateVersion: 1, schema: { type: 'object' }, initial: {} }]
      const input = { cardId: card.id, expectedVersion: card.version, artifact: next }
      const preview = await f.runtime.previewCardPackageUpdate(input)
      expect(preview.blockingChanges).toEqual([expect.stringContaining('stateTemplates')])
      await expect(f.runtime.applyCardPackageUpdate({ ...input, expectedFingerprint: preview.fingerprint })).rejects.toThrow('stateTemplates')
    } finally { await f.engine.close() }
  })

  it('keeps a removed resource on request and removes it on a subsequent explicit update', async () => {
    const f = fixture()
    try {
      const { card } = await f.runtime.importCardBundle({ artifact: artifact() })
      const id = card.promptResourceIds![0]!
      const next = artifact(); next.contextAssets.splice(0, 1)
      let input = { cardId: card.id, expectedVersion: card.version, artifact: next }
      const preview = await f.runtime.previewCardPackageUpdate(input)
      const kept = await f.runtime.applyCardPackageUpdate({ ...input, expectedFingerprint: preview.fingerprint, keepPromptResourceIds: [id] })
      expect(kept.card.promptResourceIds).toContain(id)
      input = { ...input, expectedVersion: kept.card.version }
      const again = await f.runtime.previewCardPackageUpdate(input)
      expect(again.items.find(item => item.resourceId === id)!.action).toBe('remove')
      const removed = await f.runtime.applyCardPackageUpdate({ ...input, expectedFingerprint: again.fingerprint })
      expect(removed.card.promptResourceIds).not.toContain(id)
      expect(await f.promptResources.getResource(id)).toBeNull()
    } finally { await f.engine.close() }
  })
})

function scriptSource(id = 'fog.panel', version = '1.0.0', extra = false) {
  return ['// ==LoomScript==', '// @format 1', `// @id ${id}`, '// @name Fog panel', `// @version ${version}`, '// @runtime client',
    '// @setting {"key":"caption","label":"Caption","type":"string","default":"Author"}',
    '// @contribution {"kind":"renderer","id":"panel","surface":"narrative.entry.inline","scope":"node","inputs":[]}',
    ...(extra ? ['// @contribution {"kind":"renderer","id":"extra","surface":"narrative.entry.inline","scope":"node","inputs":[]}'] : []),
    '// ==/LoomScript==', 'export function activate() {}'].join('\n')
}
function withAttachments() {
  const value = artifact()
  value.scriptAttachments = [{ orderIndex: 2, script: { format: 'loom.script', schemaVersion: 1, fileName: 'fog.loom.js', source: scriptSource() } }]
  value.extensionPayloads = [{ id: 'fog.payload', packageId: 'fog.extension', fileName: 'data.json', format: 'json', mediaType: 'application/json', content: '{"value":1}' }]
  return value
}

describe('Card package attachments', () => {
  it('adopts ordinary code updates at the next snapshot, preserves settings and payload identity, and leaves new declarations for explicit adoption', async () => {
    const f = fixture()
    try {
      const original = withAttachments()
      const { card } = await f.runtime.importCardBundle({ artifact: original })
      const { mounts } = await f.runtime.listLoomScriptMounts({ target: { kind: 'card', cardId: card.id } })
      const mount = (await f.runtime.updateLoomScriptMount({ mountId: mounts[0]!.id, expectedVersion: mounts[0]!.version, enabled: true, orderIndex: 9, grantedCapabilities: ['runtime.client'], settings: { caption: 'Player' } })).mount
      const before = await snapshotLoomScriptMounts({ documents: f.documents }, { kind: 'card', cardId: card.id })
      const next = withAttachments()
      next.scriptAttachments![0]!.script.source = scriptSource('fog.panel', '1.1.0')
      next.scriptAttachments![0]!.settings = { caption: 'New author default' }
      next.extensionPayloads![0]!.content = '{"value":2}'
      let input = { cardId: card.id, expectedVersion: card.version, artifact: next }
      let review = await f.runtime.previewCardPackageUpdate(input)
      expect(review.attachmentChanges).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'fog.panel', action: 'update', requiresAdoption: false }), expect.objectContaining({ id: 'fog.payload', action: 'update' })]))
      let applied = await f.runtime.applyCardPackageUpdate({ ...input, expectedFingerprint: review.fingerprint })
      expect(applied.card.portableExtensionPayloadIds).toEqual(card.portableExtensionPayloadIds)
      const after = await snapshotLoomScriptMounts({ documents: f.documents }, { kind: 'card', cardId: card.id })
      expect(before.snapshots[0]!.documentVersion).toBe(1)
      expect(after.snapshots[0]).toMatchObject({ documentVersion: 2, settings: { caption: 'Player' }, orderIndex: 9, mountVersion: mount.runtimeRevision + 1 })
      next.scriptAttachments![0]!.script.source = scriptSource('fog.panel', '1.2.0', true)
      input = { ...input, expectedVersion: applied.card.version, artifact: next }
      review = await f.runtime.previewCardPackageUpdate(input)
      expect(review.attachmentChanges[0]).toMatchObject({ requiresAdoption: true, addedContributions: ['renderer:extra'] })
      applied = await f.runtime.applyCardPackageUpdate({ ...input, expectedFingerprint: review.fingerprint })
      const pending = await snapshotLoomScriptMounts({ documents: f.documents }, { kind: 'card', cardId: card.id })
      expect(pending.snapshots[0]!.documentVersion).toBe(2)
      expect((await f.runtime.listLoomScriptMounts({ target: { kind: 'card', cardId: card.id } })).mounts[0]!.grantedCapabilities).toEqual(['runtime.client'])
      next.scriptAttachments![0]!.script.source = scriptSource('fog.panel', '1.3.0').replace('// ==/LoomScript==', '// @require https://example.test/weather.js\n// ==/LoomScript==')
      input = { ...input, expectedVersion: applied.card.version, artifact: next }
      review = await f.runtime.previewCardPackageUpdate(input)
      expect(review.attachmentChanges[0]).toMatchObject({ requiresAdoption: true, addedContributions: [], addedRequirements: ['https://example.test/weather.js'] })
      await f.runtime.applyCardPackageUpdate({ ...input, expectedFingerprint: review.fingerprint })
      expect((await snapshotLoomScriptMounts({ documents: f.documents }, { kind: 'card', cardId: card.id })).snapshots[0]!.documentVersion).toBe(2)

    } finally { await f.engine.close() }
  })

  it('disables new scripts and removes only this Card mount, retaining shared script revisions', async () => {
    const f = fixture()
    try {
      const { card } = await f.runtime.importCardBundle({ artifact: withAttachments() })
      const mount = (await f.runtime.listLoomScriptMounts({ target: { kind: 'card', cardId: card.id } })).mounts[0]!
      const next = withAttachments()
      next.scriptAttachments![0]!.script.source = scriptSource('fog.new')
      next.extensionPayloads = []
      const input = { cardId: card.id, expectedVersion: card.version, artifact: next }
      const review = await f.runtime.previewCardPackageUpdate(input)
      expect(review.attachmentChanges).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'fog.panel', action: 'remove' }), expect.objectContaining({ id: 'fog.new', action: 'add', requiresAdoption: true })]))
      const applied = await f.runtime.applyCardPackageUpdate({ ...input, expectedFingerprint: review.fingerprint })
      expect(applied.card.portableExtensionPayloadIds).toEqual([])
      expect(await f.documents.get(mount.scriptDocumentId)).toBeTruthy()
      expect(await f.documents.get(mount.id)).toBeNull()
      const updated = (await f.runtime.listLoomScriptMounts({ target: { kind: 'card', cardId: card.id } })).mounts
      expect(updated).toHaveLength(1)
      expect(updated[0]).toMatchObject({ enabled: false, grantedCapabilities: [], runtimeRevision: 0 })
      const restoredInput = { cardId: card.id, expectedVersion: applied.card.version, artifact: withAttachments() }
      const restoredReview = await f.runtime.previewCardPackageUpdate(restoredInput)
      const restored = await f.runtime.applyCardPackageUpdate({ ...restoredInput, expectedFingerprint: restoredReview.fingerprint })
      expect((await f.runtime.previewCardPackageUpdate({ ...restoredInput, expectedVersion: restored.card.version })).blockingChanges).toEqual([])
    } finally { await f.engine.close() }
  })

  it('protects previews against concurrent mount edits and rejects duplicate identities and pinned revisions', async () => {
    const f = fixture()
    try {
      const { card } = await f.runtime.importCardBundle({ artifact: withAttachments() })
      const next = withAttachments()
      next.scriptAttachments![0]!.script.source = scriptSource('fog.panel', '1.1.0')
      const input = { cardId: card.id, expectedVersion: card.version, artifact: next }
      const review = await f.runtime.previewCardPackageUpdate(input)
      const mount = (await f.runtime.listLoomScriptMounts({ target: { kind: 'card', cardId: card.id } })).mounts[0]!
      await f.runtime.updateLoomScriptMount({ mountId: mount.id, expectedVersion: mount.version, enabled: false, orderIndex: 4, grantedCapabilities: [], pinnedDocumentVersion: 1 })
      await expect(f.runtime.applyCardPackageUpdate({ ...input, expectedFingerprint: review.fingerprint })).rejects.toThrow('preview the update again')
      expect((await f.runtime.previewCardPackageUpdate(input)).blockingChanges).toEqual([expect.stringContaining('pinned')])
      next.scriptAttachments!.push(structuredClone(next.scriptAttachments![0]!))
      await expect(f.runtime.previewCardPackageUpdate(input)).rejects.toThrow('metadataId must be unique')
    } finally { await f.engine.close() }
  })
})

describe('Card embedded extension archives', () => {
  it('stores changed archives without installing, preserves separately attached archives, and removes only source archives', async () => {
    const f = fixture()
    const archive = (packageId: string, version: string) => ({ packageId, version, archiveBase64: Buffer.from(`opaque archive ${packageId} ${version}`).toString('base64') })
    try {
      const original = artifact()
      original.extensionPackages = [archive('fog.extension', '1.0.0')]
      const imported = await f.runtime.importCardBundle({ artifact: original })
      const attached = await f.runtime.attachCardExtensionPackage({ cardId: imported.card.id, expectedVersion: imported.card.version, archive: archive('player.extra', '1.0.0') })
      const extra = attached.card.extensionPackages!.find(item => item.packageId === 'player.extra')!
      const installations = await f.runtime.listExtensionInstallations()
      const next = artifact()
      next.extensionPackages = [archive('fog.extension', '1.1.0'), archive('fog.new', '1.0.0')]
      let input = { cardId: attached.card.id, expectedVersion: attached.card.version, artifact: next }
      let review = await f.runtime.previewCardPackageUpdate(input)
      expect(review.attachmentChanges).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'extension', id: 'fog.extension', action: 'update', requiresAdoption: true }),
        expect.objectContaining({ kind: 'extension', id: 'fog.new', action: 'add', requiresAdoption: true }),
      ]))
      let applied = await f.runtime.applyCardPackageUpdate({ ...input, expectedFingerprint: review.fingerprint })
      expect(applied.card.extensionPackages).toContainEqual(extra)
      expect(applied.card.extensionPackages!.find(item => item.packageId === 'fog.extension')!.blobId).not.toBe(imported.card.extensionPackages![0]!.blobId)
      expect(await f.runtime.listExtensionInstallations()).toEqual(installations)
      next.extensionPackages = []
      input = { ...input, expectedVersion: applied.card.version, artifact: next }
      review = await f.runtime.previewCardPackageUpdate(input)
      expect(review.attachmentChanges.filter(item => item.kind === 'extension').map(item => item.action)).toEqual(['remove', 'remove'])
      applied = await f.runtime.applyCardPackageUpdate({ ...input, expectedFingerprint: review.fingerprint })
      expect(applied.card.extensionPackages).toEqual([extra])
      expect(await f.runtime.listExtensionInstallations()).toEqual(installations)
    } finally { await f.engine.close() }
  })

  it('refuses to overwrite an independently replaced archive under the same package ID', async () => {
    const f = fixture()
    try {
      const original = artifact()
      original.extensionPackages = [{ packageId: 'fog.extension', version: '1.0.0', archiveBase64: Buffer.from('original').toString('base64') }]
      const { card } = await f.runtime.importCardBundle({ artifact: original })
      const replaced = await f.runtime.attachCardExtensionPackage({ cardId: card.id, expectedVersion: card.version,
        archive: { packageId: 'fog.extension', version: '1.0.0', archiveBase64: Buffer.from('player replacement').toString('base64') } })
      const next = artifact()
      next.extensionPackages = [{ packageId: 'fog.extension', version: '1.1.0', archiveBase64: Buffer.from('author update').toString('base64') }]
      const input = { cardId: card.id, expectedVersion: replaced.card.version, artifact: next }
      const review = await f.runtime.previewCardPackageUpdate(input)
      expect(review.blockingChanges).toEqual([expect.stringContaining('archive source mapping cannot be proven')])
      await expect(f.runtime.applyCardPackageUpdate({ ...input, expectedFingerprint: review.fingerprint })).rejects.toThrow('archive source mapping cannot be proven')
    } finally { await f.engine.close() }
  })
})
