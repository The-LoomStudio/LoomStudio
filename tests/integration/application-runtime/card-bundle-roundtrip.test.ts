import { describe, expect, it } from 'vitest'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createPromptResourceStore } from '@loom-studio/application-data'
import { createVariableRenderContext, exportCardArtifact, importCardBundle, readPromptResourceInputs, type CardBundleArtifact } from '@loom-studio/application-runtime'
import { compilePromptDataModel } from '../../../packages/application-runtime/src/prompt/prompt-build-pipeline.js'
import { fromStoredResource } from '../../../packages/application-runtime/src/prompt/prompt-resource-mapper.js'
import { assertCardBundleArtifact, normalizeCardBundleArtifact } from '../../../packages/application-runtime/src/cards/card-bundle-codec.js'
import { decodeCardBundleZip, encodeCardBundleZip } from '../../../apps/studio-server/src/codecs/card-bundle-zip.js'

function fixture() {
  let sequence = 0
  const createId = (prefix: string) => `${prefix}-${++sequence}`
  const now = () => '2026-10-23T00:00:00.000Z'
  const dataEngine = createSqliteDataEngine({ filename: ':memory:', createId, now })
  return { dataEngine, documents: createSqliteDocumentStore({ engine: dataEngine }),
    promptResources: createPromptResourceStore({ engine: dataEngine, createId, now }) }
}

function artifact(): CardBundleArtifact {
  return {
    schemaVersion: 4, artifactId: 'roundtrip', displayName: 'Roundtrip', card: { name: 'Roundtrip' },
    contextAssets: [{ id: 'preset', kind: 'module', category: 'preset', label: 'Preset', children: [
      { id: 'custom-anchor', kind: 'virtual', label: 'Custom' },
      { id: 'public-anchor', kind: 'virtual', label: 'Public', capabilities: { targetAnchorId: '@public' } },
      { id: 'entry', kind: 'entry', label: 'Entry', body: 'Required prompt content', capabilities: { targetAnchorId: 'custom-anchor' } },
      { id: 'public-entry', kind: 'entry', label: 'Public entry', body: 'Public content', capabilities: { targetAnchorId: '@public' } },
    ] }],
  }
}

describe('Card bundle resource round trips', () => {
  it('keeps implicit and public anchors executable when importing the same Card twice', async () => {
    const stores = fixture()
    try {
      for (let index = 0; index < 2; index++) {
        const imported = await importCardBundle({ artifact: artifact(), ...stores })
        const inputs = await readPromptResourceInputs({ promptResources: stores.promptResources,
          resourceIds: imported.card.promptResourceIds!, variables: createVariableRenderContext() })
        expect(compilePromptDataModel(inputs).messages.map(message => message.content).join('\n'))
          .toContain('Required prompt content')
        expect(compilePromptDataModel(inputs).messages.map(message => message.content).join('\n'))
          .toContain('Public content')
      }
    } finally { await stores.dataEngine.close() }
  })

  it('remaps cross-resource references even when the referencing tree itself has no collisions', async () => {
    const stores = fixture()
    try {
      const source = artifact()
      await importCardBundle({ artifact: source, ...stores })
      source.contextAssets.push({ id: 'fresh-root', kind: 'module', category: 'lore', label: 'Fresh', children: [
        { id: 'fresh-entry', kind: 'entry', label: 'Cross resource', body: 'Cross-resource content', capabilities: { targetAnchorId: 'custom-anchor' } },
      ] })
      const imported = await importCardBundle({ artifact: source, ...stores })
      const inputs = await readPromptResourceInputs({ promptResources: stores.promptResources,
        resourceIds: imported.card.promptResourceIds!, variables: createVariableRenderContext() })
      expect(compilePromptDataModel(inputs).messages.map(message => message.content).join('\n')).toContain('Cross-resource content')
    } finally { await stores.dataEngine.close() }
  })

  it('preserves edited preset settings through export, ZIP and reimport with remapped nodes', async () => {
    const stores = fixture()
    try {
      const imported = await importCardBundle({ artifact: artifact(), ...stores })
      const resource = (await stores.promptResources.getResource(imported.card.promptResourceIds![0]!))!
      const settings = { macros: { tone: 'gentle' }, useCardLore: false, useGlobalLore: false, historyPolicy: 'ephemeral' as const }
      await stores.promptResources.mutateResource({ resourceId: resource.id, expectedVersion: resource.version,
        actor: { kind: 'system', id: 'test' }, mutations: [{ kind: 'resource.update', patch: {
          metadata: { ...resource.metadata, ...settings, model: { providerId: 'local-only', modelId: 'local-model' } },
        } }] })
      const exported = await exportCardArtifact({ cardId: imported.card.id, ...stores })
      expect(exported.contextAssetSettings?.preset).toEqual(settings)
      const decoded = await decodeCardBundleZip(encodeCardBundleZip({ artifact: exported,
        avatar: { bytes: Buffer.from('test avatar'), mediaType: 'image/png' } }))
      expect(decoded.artifact.contextAssetSettings).toEqual(exported.contextAssetSettings)
      const reimported = await importCardBundle({ artifact: decoded.artifact, ...stores })
      const restored = fromStoredResource((await stores.promptResources.getResource(reimported.card.promptResourceIds![0]!))!)
      expect(restored).toMatchObject(settings)
      expect(restored.rootNode.id).not.toBe('preset')
      expect(restored.model).toBeUndefined()
    } finally { await stores.dataEngine.close() }
  })

  it('accepts old v4 bundles and rejects invalid resource settings at the import boundary', () => {
    expect(normalizeCardBundleArtifact(artifact()).contextAssetSettings).toBeUndefined()
    for (const settings of [{ missing: {} }, { preset: { historyPolicy: 'invalid' } }, { preset: { useCardLore: 'false' } },
      { preset: { macros: { tone: 1 } } }, { preset: { model: {} } }]) {
      expect(() => assertCardBundleArtifact({ ...artifact(), contextAssetSettings: settings })).toThrow()
    }
  })
})
