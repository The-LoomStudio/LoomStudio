import type { CardBundleArtifact } from '@loom-studio/application-runtime'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { callRpc, withStudioServer } from './helpers.js'

describe('studio server card bundle rpc integration', () => {
  it('imports a bundle and exposes its card resources and import metadata', async () => {
    await withStudioServer(async port => {
      const imported = await callRpc<{
        card: { id: string; importBundleId: string; promptResourceIds: string[] }
        importBundle: { id: string; cardId: string; sourceArtifactRef: { format: string } }
      }>(port, 'application.importCardBundle', { artifact: await readLoomCityArtifact() })
      const resources = await Promise.all(imported.card.promptResourceIds.map(async resourceId => (
        await callRpc<{ resource: { id: string } }>(port, 'application.getPromptResource', { resourceId })
      ).resource))

      expect(resources.map(resource => resource.id)).toEqual(imported.card.promptResourceIds)
      expect(imported.card.importBundleId).toBe(imported.importBundle.id)
      expect(imported.importBundle).toMatchObject({
        id: imported.importBundle.id,
        cardId: imported.card.id,
        sourceArtifactRef: { format: 'loom.cardBundle' },
      })
    })
  })

  it('preserves exact raw bundle JSON in the local Blob Store', async () => {
    await withStudioServer(async (port, dir) => {
      const raw = await readFile(join(process.cwd(), 'packages/application-runtime/fixtures/workspaces/loom-city-v0.json'), 'utf8')
      const imported = await callRpc<{
        importBundle: {
          sourceArtifactRef: {
            sourceArtifactId: string
            blobId: string
            sha256: string
            originalFileName: string
          }
        }
      }>(port, 'application.importCardBundle', {
        source: { text: raw, originalFileName: 'loom-city-v0.json' },
      })
      const ref = imported.importBundle.sourceArtifactRef
      const filename = join(
        dir,
        'data',
        'blobs',
        'sha256',
        ref.sha256.slice(0, 2),
        ref.sha256.slice(2, 4),
        ref.sha256,
      )

      expect(await readFile(filename, 'utf8')).toBe(raw)
      expect(ref).toMatchObject({
        sourceArtifactId: expect.any(String),
        blobId: expect.any(String),
        originalFileName: 'loom-city-v0.json',
      })
    })
  })

  it('edits, undoes, redoes, and exports a resource through resource-scoped rpc', async () => {
    await withStudioServer(async port => {
      const imported = await callRpc<{
        card: { id: string; promptResourceIds: string[] }
      }>(port, 'application.importCardBundle', { artifact: await readLoomCityArtifact() })
      const resources = await Promise.all(imported.card.promptResourceIds.map(async resourceId => (
        await callRpc<{
          resource: { id: string; rootNode: CardBundleArtifact['contextAssets'][number] }
        }>(port, 'application.getPromptResource', { resourceId })
      ).resource))
      const preset = resources.find(resource => resource.rootNode.id === 'preset-default-airp')
      if (!preset) throw new Error('Expected preset resource')

      const updated = await callRpc<{
        mutation: { changesetId: string }
      }>(port, 'application.updatePromptResourceAsset', {
        resourceId: preset.id,
        assetId: 'preset-style-directive',
        body: 'RPC resource edit.',
      })
      const undo = await callRpc<{ mutation: { changesetId: string } }>(port, 'application.revertPromptResourceChangeset', {
        changesetId: updated.mutation.changesetId,
      })
      const redo = await callRpc<{ mutation: { changesetId: string } }>(port, 'application.revertPromptResourceChangeset', {
        changesetId: undo.mutation.changesetId,
      })
      const exported = await callRpc<{ artifact: CardBundleArtifact }>(port, 'application.exportCardBundle', {
        cardId: imported.card.id,
      })

      expect(redo.mutation.changesetId).toEqual(expect.any(String))
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
