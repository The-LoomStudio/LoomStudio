import {
  applicationDocumentTypes,
  exportCardArtifact,
  getImportBundle,
  importCardBundle,
  readPromptResourceInputs,
  updatePromptResourceAsset,
  type CardBundleArtifact,
} from '@loom-studio/application-runtime'
import { createInMemoryDocumentStore } from '@loom-studio/document-store'
import { describe, expect, it } from 'vitest'

describe('card bundle artifact boundary', () => {
  it('imports a card, flat prompt resources, and an immutable import bundle', async () => {
    const documents = createInMemoryDocumentStore()
    const imported = await importCardBundle({ artifact: createArtifact(), documents, now: '2026-06-22T00:00:00.000Z' })

    expect(imported.card.promptResourceIds).toHaveLength(2)
    expect(imported.card.importBundleId).toBe(imported.importBundle.id)
    expect(imported.importBundle.documentIds).toEqual([imported.card.id, ...imported.card.promptResourceIds!])
    expect(imported.importBundle.sourceArtifactRef).toMatchObject({
      artifactId: 'test-card-bundle-v0',
      format: 'loom.cardBundle',
    })
    await expect(documents.get(imported.card.promptResourceIds![0]!)).resolves.toMatchObject({
      type: applicationDocumentTypes.promptResource,
    })
    await expect(getImportBundle({ documents, importBundleId: imported.importBundle.id })).resolves.toEqual(imported.importBundle)
  })

  it('builds prompt inputs directly from ordered resource ids', async () => {
    const documents = createInMemoryDocumentStore()
    const imported = await importCardBundle({ artifact: createArtifact(), documents })
    const inputs = await readPromptResourceInputs({
      documents,
      resourceIds: imported.card.promptResourceIds ?? [],
      macroContext: { user: 'User' },
    })

    expect(inputs.contributions.map(contribution => contribution.content)).toContain('Original prompt asset.')
    await expect(readPromptResourceInputs({
      documents,
      resourceIds: [imported.card.promptResourceIds![0]!, imported.card.promptResourceIds![0]!],
      macroContext: { user: 'User' },
    })).rejects.toThrow('Duplicate prompt resource id')
  })

  it('exports current resource content while retaining source artifact metadata', async () => {
    const documents = createInMemoryDocumentStore()
    const imported = await importCardBundle({ artifact: createArtifact(), documents })
    const resourceId = imported.card.promptResourceIds![0]!

    await documents.transact({ actor: { kind: 'kernel', id: 'test' }, reason: 'test.edit' }, async tx => {
      await updatePromptResourceAsset({
        assetId: 'preset-entry',
        body: 'Edited prompt asset.',
        documents: tx,
        resourceId,
      })
    })
    const exported = await exportCardArtifact({ cardId: imported.card.id, documents })

    expect(findNode(exported, 'preset-entry')?.body).toBe('Edited prompt asset.')
    expect(imported.importBundle.sourceArtifact.contextAssets[0]?.children?.[0]?.body).toBe('Original prompt asset.')
    expect(exported.metadata).toMatchObject({
      importBundle: { id: imported.importBundle.id },
      exportedFromCardId: imported.card.id,
    })
  })

  it('re-imports an export with fresh document ids', async () => {
    const documents = createInMemoryDocumentStore()
    const first = await importCardBundle({ artifact: createArtifact(), documents })
    const exported = await exportCardArtifact({ cardId: first.card.id, documents })
    const second = await importCardBundle({ artifact: exported, documents })

    expect(second.card.id).not.toBe(first.card.id)
    expect(second.importBundle.id).not.toBe(first.importBundle.id)
    expect(second.card.promptResourceIds).not.toEqual(first.card.promptResourceIds)
    expect(second.importBundle.documentIds).toEqual([second.card.id, ...second.card.promptResourceIds!])
  })
})

function createArtifact(): CardBundleArtifact {
  return {
    schemaVersion: 1,
    artifactId: 'test-card-bundle-v0',
    displayName: 'Test Card Bundle',
    card: { name: 'Test Card' },
    contextAssets: [
      {
        id: 'preset-main',
        label: 'Preset',
        category: 'preset',
        kind: 'module',
        children: [{
          id: 'preset-entry',
          label: 'Preset Entry',
          category: 'preset',
          kind: 'entry',
          body: 'Original prompt asset.',
          capabilities: { projection: { zoneId: 'preset.system' } },
        }],
      },
      {
        id: 'setting-main',
        label: 'Setting',
        category: 'setting',
        kind: 'module',
        children: [],
      },
    ],
  }
}

function findNode(artifact: CardBundleArtifact, id: string): CardBundleArtifact['contextAssets'][number] | undefined {
  const queue = [...artifact.contextAssets]
  while (queue.length > 0) {
    const node = queue.shift()
    if (!node) continue
    if (node.id === id) return node
    queue.push(...(node.children ?? []))
  }
  return undefined
}
