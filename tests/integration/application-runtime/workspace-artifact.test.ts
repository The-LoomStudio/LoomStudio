import { applicationDocumentTypes, createApplicationRuntime, type CardBundleArtifact } from '@loom-studio/application-runtime'
import { createInMemoryDocumentStore } from '@loom-studio/document-store'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('application runtime card bundle integration', () => {
  it('creates sessions from the card resource manifest without copying resources', async () => {
    const documents = createInMemoryDocumentStore()
    const runtime = createApplicationRuntime({ documents })
    const imported = await runtime.importCardBundle({ artifact: await readLoomCityArtifact() })
    const before = await documents.list({ type: applicationDocumentTypes.promptResource })
    const created = await runtime.createSessionFromCard({ cardId: imported.card.id })
    const after = await documents.list({ type: applicationDocumentTypes.promptResource })

    expect(created.session.promptResourceIds).toEqual(imported.card.promptResourceIds)
    expect(after.items.map(item => item.id)).toEqual(before.items.map(item => item.id))
  })

  it('previews and submits using the session resource manifest', async () => {
    const runtime = createApplicationRuntime({ documents: createInMemoryDocumentStore() })
    const imported = await runtime.importCardBundle({ artifact: await readLoomCityArtifact() })
    const created = await runtime.createSessionFromCard({ cardId: imported.card.id })
    const preview = await runtime.previewPrompt({ sessionId: created.session.id, input: '继续。' })
    const turn = await runtime.submitTurn({ sessionId: created.session.id, input: '继续前进。' })
    const run = await runtime.getRun({ runId: turn.run.id })

    expect(preview.messages.length).toBeGreaterThan(0)
    expect(run.runtimeEntries.some(entry => entry.kind === 'prompt')).toBe(true)
  })

  it('edits a resource directly and exports the current card bundle', async () => {
    const runtime = createApplicationRuntime({ documents: createInMemoryDocumentStore() })
    const imported = await runtime.importCardBundle({ artifact: await readLoomCityArtifact() })
    const listed = await runtime.listCardPromptResources({ cardId: imported.card.id })
    const preset = listed.resources.find(resource => resource.rootNode.id === 'preset-default-airp')
    if (!preset) throw new Error('Expected preset resource')

    await runtime.updatePromptResourceAsset({
      resourceId: preset.id,
      assetId: 'preset-style-directive',
      body: 'Resource-scoped edit.',
    })
    const exported = await runtime.exportCardArtifact({ cardId: imported.card.id })

    expect(findNode(exported.artifact, 'preset-style-directive')?.body).toBe('Resource-scoped edit.')
    expect(exported.artifact.metadata).toMatchObject({ exportedFromCardId: imported.card.id })
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
