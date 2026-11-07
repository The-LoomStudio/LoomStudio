import { createId, nowIso } from '@loom-studio/shared'
import { createApplicationRuntime, type PromptResourceArtifact } from '@loom-studio/application-runtime'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createPromptResourceStore } from '@loom-studio/application-data'
import { describe, expect, it } from 'vitest'

function artifact(): PromptResourceArtifact {
  return { format: 'loom.promptResource', schemaVersion: 2, resourceKind: 'preset',
    metadata: { release: { id: 'fog.preset', version: '1.0.0' } },
    rootNode: { id: 'fog.preset', kind: 'module', category: 'preset', label: 'Narrator',
      children: [{ id: 'fog.style', kind: 'entry', label: 'Style', body: 'Third person' }] }, macros: { tone: 'gentle' }, useCardLore: false }
}
function fixture() {
  const engine = createSqliteDataEngine({ filename: ':memory:', createId, now: nowIso })
  const documents = createSqliteDocumentStore({ engine })
  const promptResources = createPromptResourceStore({ engine })
  return { engine, promptResources, runtime: createApplicationRuntime({ dataEngine: engine, documents, promptResources }) }
}

describe('standalone Prompt package updates', () => {
  it('retains local resource/node identity and player settings while adopting content and macros', async () => {
    const f = fixture()
    try {
      const { resource } = await f.runtime.importPromptResource({ artifact: artifact() })
      const next = artifact()
      next.metadata!.release!.version = '1.1.0'
      next.useCardLore = true
      next.rootNode.children![0]!.body = 'Second person'
      next.rootNode.children!.push({ id: 'fog.new', kind: 'entry', label: 'Weather', body: 'Rain' })
      next.macros = { tone: 'mysterious' }
      const input = { resourceId: resource.id, artifact: next }
      const review = await f.runtime.previewPromptPackageUpdate(input)
      expect(review.local.rootNode.children![0]!.body).toBe('Third person')
      expect(review.incoming.rootNode.children![0]!.id).toBe(resource.rootNode.children![0]!.id)
      const applied = await f.runtime.applyPromptPackageUpdate({ ...input, expectedVersion: review.expectedVersion, fingerprint: review.fingerprint })
      expect(applied.resource.id).toBe(resource.id)
      expect(applied.resource.rootNode.id).toBe(resource.rootNode.id)
      expect(applied.resource.rootNode.children![0]).toMatchObject({ id: resource.rootNode.children![0]!.id, body: 'Second person' })
      expect(applied.resource.rootNode.children![1]!.id).not.toBe('fog.new')
      expect(applied.resource.macros).toEqual({ tone: 'mysterious' })
      expect(applied.resource.useCardLore).toBe(false)
      expect(applied.resource.metadata!.release!.version).toBe('1.1.0')
      expect(applied.mutation!.changesetId).toBeTruthy()
    } finally { await f.engine.close() }
  })

  it('keeps local content without a review ledger and makes a detached personal copy', async () => {
    const f = fixture()
    try {
      const { resource } = await f.runtime.importPromptResource({ artifact: artifact() })
      const next = artifact()
      next.metadata!.release!.version = '1.1.0'
      next.rootNode.children![0]!.body = 'Second person'
      const input = { resourceId: resource.id, artifact: next }
      const review = await f.runtime.previewPromptPackageUpdate(input)
      const kept = await f.runtime.applyPromptPackageUpdate({ ...input, expectedVersion: review.expectedVersion, fingerprint: review.fingerprint, keepLocal: true })
      expect(kept.resource.version).toBe(resource.version)
      expect(kept.resource.metadata!.release!.version).toBe('1.0.0')
      expect(kept.mutation).toBeUndefined()
      const copy = await f.runtime.duplicatePromptResource({ resourceId: resource.id, expectedVersion: resource.version, name: 'My narrator' })
      expect(copy.resource.sourcePackage).toBeUndefined()
      expect(copy.resource.metadata?.release).toBeUndefined()
      await f.runtime.applyPromptPackageUpdate({ ...input, expectedVersion: review.expectedVersion, fingerprint: review.fingerprint })
      await expect(f.runtime.applyPromptPackageUpdate({ ...input, expectedVersion: review.expectedVersion, fingerprint: review.fingerprint })).rejects.toThrow('review the package again')
    } finally { await f.engine.close() }
  })

  it('refuses changed attachments or an unproven package identity without modifying SQL', async () => {
    const f = fixture()
    try {
      const { resource } = await f.runtime.importPromptResource({ artifact: artifact() })
      const next = artifact()
      next.loreMounts = [{ kind: 'external', resourceId: 'external-lore' }]
      const input = { resourceId: resource.id, artifact: next }
      const review = await f.runtime.previewPromptPackageUpdate(input)
      expect(review.blockingChanges).toHaveLength(1)
      await expect(f.runtime.applyPromptPackageUpdate({ ...input, expectedVersion: review.expectedVersion, fingerprint: review.fingerprint })).rejects.toThrow('dedicated adoption flow')
      next.metadata!.release!.id = 'unrelated'
      await expect(f.runtime.previewPromptPackageUpdate(input)).rejects.toThrow('identity cannot be proven')
      expect((await f.runtime.getPromptResource({ resourceId: resource.id })).resource.version).toBe(resource.version)
    } finally { await f.engine.close() }
  })
})
