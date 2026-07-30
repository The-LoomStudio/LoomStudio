import { applicationDocumentTypes, type CardBundleArtifact } from '@loom-studio/application-runtime'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { callRpc, withStudioServer } from './helpers.js'

describe('studio server card bundle rpc integration', () => {
  it('imports a bundle and exposes its card resources and import metadata', async () => {
    await withStudioServer(async port => {
      const imported = await callRpc<{
        card: { id: string; importBundleId: string; promptResourceIds: string[] }
        importBundle: { id: string }
      }>(port, 'application.importCardBundle', { artifact: await readLoomCityArtifact() })
      const listed = await callRpc<{
        resources: Array<{ id: string; rootNode: CardBundleArtifact['contextAssets'][number] }>
      }>(port, 'application.listCardPromptResources', { cardId: imported.card.id })
      const bundle = await callRpc<{
        importBundle: { id: string; cardId: string; sourceArtifactRef: { format: string } }
      }>(port, 'application.getImportBundle', { importBundleId: imported.importBundle.id })

      expect(listed.resources.map(resource => resource.id)).toEqual(imported.card.promptResourceIds)
      expect(imported.card.importBundleId).toBe(imported.importBundle.id)
      expect(bundle.importBundle).toMatchObject({
        id: imported.importBundle.id,
        cardId: imported.card.id,
        sourceArtifactRef: { format: 'loom.cardBundle' },
      })
    })
  })

  it('edits, undoes, redoes, and exports a resource through resource-scoped rpc', async () => {
    await withStudioServer(async port => {
      const imported = await callRpc<{
        card: { id: string; promptResourceIds: string[] }
      }>(port, 'application.importCardBundle', { artifact: await readLoomCityArtifact() })
      const listed = await callRpc<{
        resources: Array<{ id: string; rootNode: CardBundleArtifact['contextAssets'][number] }>
      }>(port, 'application.listCardPromptResources', { cardId: imported.card.id })
      const preset = listed.resources.find(resource => resource.rootNode.id === 'preset-default-airp')
      if (!preset) throw new Error('Expected preset resource')

      const updated = await callRpc<{
        mutation: { changesetId: string }
      }>(port, 'application.updatePromptResourceAsset', {
        resourceId: preset.id,
        assetId: 'preset-style-directive',
        body: 'RPC resource edit.',
      })
      const changeset = await callRpc<{
        changeset: { operations: Array<{ documentId: string; type: string }> }
      }>(port, 'docs.getChangeset', { changesetId: updated.mutation.changesetId })
      const undo = await callRpc<{ changesetId: string }>(port, 'docs.revertChangeset', {
        changesetId: updated.mutation.changesetId,
      })
      await callRpc(port, 'docs.revertChangeset', { changesetId: undo.changesetId })
      const exported = await callRpc<{ artifact: CardBundleArtifact }>(port, 'application.exportCardArtifact', {
        cardId: imported.card.id,
      })

      expect(changeset.changeset.operations).toEqual([expect.objectContaining({
        documentId: preset.id,
        type: applicationDocumentTypes.promptResource,
      })])
      expect(findNode(exported.artifact, 'preset-style-directive')?.body).toBe('RPC resource edit.')
    })
  })
})

async function readLoomCityArtifact(): Promise<CardBundleArtifact> {
  return JSON.parse(await readFile(join(process.cwd(), 'packages/application-runtime/fixtures/workspaces/loom-city-v0.json'), 'utf8')) as CardBundleArtifact
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
