import { applicationDocumentTypes, createApplicationRuntime, readPromptResourceInputs, type CardBundleArtifact } from '@loom-studio/application-runtime'
import { createInMemoryDocumentStore } from '@loom-studio/document-store'
import { createOfficialPromptResourceContents } from '../../../packages/application-runtime/src/prompt-resource-defaults.js'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('application runtime card bundle integration', () => {
  it('initializes the official assistant Prompt resources and keeps the built-ins read-only', async () => {
    const runtime = createApplicationRuntime({ documents: createInMemoryDocumentStore() })

    await runtime.initialize()
    const listed = await runtime.listPromptResources()
    const preset = listed.resources.find(resource => resource.origin?.key === 'loom-assistant-preset')
    const setting = listed.resources.find(resource => resource.origin?.key === 'loom-knowledge-setting')

    expect(preset).toMatchObject({
      resourceKind: 'preset',
      rootNode: { label: 'Loom Studio 问答助手' },
      linkedSettingIds: [setting!.id],
      historyPolicy: 'persistent',
    })
    expect(preset?.rootNode.children?.find(node => node.kind === 'order')?.skeletonPatch?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'slot', bindingId: 'runtime.narrativeHistory' }),
      expect.objectContaining({ kind: 'slot', bindingId: 'runtime.sessionHistory' }),
      expect.objectContaining({ kind: 'entry', source: { kind: 'binding', bindingId: 'runtime.currentInput' } }),
    ]))
    expect(setting).toMatchObject({ resourceKind: 'setting', rootNode: { label: 'Loom Studio 基础知识' } })
    await expect(runtime.updatePromptResourceAsset({
      resourceId: preset!.id,
      assetId: preset!.rootNode.id,
      label: 'Changed',
    })).rejects.toThrow('read-only')
  })

  it('upgrades a stale official Prompt Skeleton during initialization', async () => {
    const documents = createInMemoryDocumentStore()
    const canonical = createOfficialPromptResourceContents('2026-08-15T00:00:00.000Z')
    const stalePreset = structuredClone(canonical[0]!)
    const orderNode = stalePreset.rootNode.children?.find(node => node.kind === 'order')
    if (!orderNode?.skeletonPatch?.zones) throw new Error('Official preset fixture is missing its skeleton')
    orderNode.skeletonPatch.zones = orderNode.skeletonPatch.zones.filter(zone => zone.id !== 'session.history')
    await documents.write({
      id: 'prompt-resource.official.loom-assistant',
      type: applicationDocumentTypes.promptResource,
      content: stalePreset,
    })
    await documents.write({
      id: 'prompt-resource.official.loom-knowledge',
      type: applicationDocumentTypes.promptResource,
      content: canonical[1]!,
    })

    const runtime = createApplicationRuntime({ documents })
    await runtime.initialize()

    const listed = await runtime.listPromptResources({ resourceKind: 'preset' })
    const preset = listed.resources.find(resource => resource.origin?.key === 'loom-assistant-preset')
    const migratedOrder = preset?.rootNode.children?.find(node => node.kind === 'order')
    expect(migratedOrder?.skeletonPatch?.zones?.map(zone => zone.id)).toContain('session.history')
  })

  it('migrates the legacy official Agent Preset reference without clearing other documents', async () => {
    const documents = createInMemoryDocumentStore()
    await documents.write({
      id: 'agent-preset.official.loom-assistant',
      type: 'airp.agentPreset',
      content: {
        name: 'Legacy Assistant',
        instructions: 'Legacy.',
        promptResourceIds: [],
        historyPolicy: 'persistent',
        createdAt: '2026-08-15T00:00:00.000Z',
        updatedAt: '2026-08-15T00:00:00.000Z',
      },
    })
    await documents.write({
      id: 'agent-profile-legacy',
      type: applicationDocumentTypes.agentProfile,
      content: {
        name: 'Legacy Profile',
        presetId: 'agent-preset.official.loom-assistant',
        model: { providerProfileId: 'provider-existing', modelId: 'model-existing' },
        createdAt: '2026-08-15T00:00:00.000Z',
        updatedAt: '2026-08-15T00:00:00.000Z',
      },
    })
    const runtime = createApplicationRuntime({ documents })

    await runtime.initialize()

    await expect(runtime.getAgentProfile({ agentProfileId: 'agent-profile-legacy' })).resolves.toMatchObject({
      agentProfile: { presetId: 'prompt-resource.official.loom-assistant' },
    })
    await expect(documents.get('agent-preset.official.loom-assistant')).resolves.toBeNull()
  })

  it('creates, duplicates, exports, and imports independent Prompt resources', async () => {
    const runtime = createApplicationRuntime({ documents: createInMemoryDocumentStore() })
    const created = await runtime.createPromptResource({ resourceKind: 'setting', name: 'Guide Knowledge' })
    const entry = await runtime.createPromptResourceAsset({
      resourceId: created.resource.id,
      targetAssetId: created.resource.rootNode.id,
      position: 'inside',
      asset: { id: 'imported-entry', label: 'Guide', kind: 'entry', body: 'Helpful knowledge.' },
    })
    const createdEntry = entry.resource.rootNode.children?.[0]

    expect(createdEntry?.capabilities?.projection).toMatchObject({
      zoneId: 'setting.stable',
      entryOrderHint: 10,
    })

    const duplicated = await runtime.duplicatePromptResource({ resourceId: created.resource.id })
    expect(duplicated.resource.rootNode.id).not.toBe(created.resource.rootNode.id)
    expect(duplicated.resource.rootNode.children?.[0]?.id).not.toBe('imported-entry')

    const exported = await runtime.exportPromptResource({ resourceId: duplicated.resource.id })
    const imported = await runtime.importPromptResource({ artifact: exported.artifact })
    expect(imported.resource.rootNode.id).not.toBe(duplicated.resource.rootNode.id)
    expect(imported.resource.rootNode.label).toBe('Guide Knowledge Copy')
  })

  it('binds only Setting resources to a Preset through an explicit relation', async () => {
    const runtime = createApplicationRuntime({ documents: createInMemoryDocumentStore() })
    const preset = await runtime.createPromptResource({ resourceKind: 'preset', name: 'Guide Preset' })
    const setting = await runtime.createPromptResource({ resourceKind: 'setting', name: 'Guide Knowledge' })

    const updated = await runtime.updatePresetSettings({
      presetId: preset.resource.id,
      linkedSettingIds: [setting.resource.id],
    })

    expect(updated.resource.linkedSettingIds).toEqual([setting.resource.id])
    await expect(runtime.updatePresetSettings({
      presetId: preset.resource.id,
      linkedSettingIds: [preset.resource.id],
    })).rejects.toThrow('can only link Setting resources')
  })

  it('applies Folder effective enabled and preserves Entry lifecycle', async () => {
    const documents = createInMemoryDocumentStore()
    const runtime = createApplicationRuntime({ documents })
    const created = await runtime.createPromptResource({ resourceKind: 'setting', name: 'Conditional Knowledge' })
    const withFolder = await runtime.createPromptResourceAsset({
      resourceId: created.resource.id,
      targetAssetId: created.resource.rootNode.id,
      position: 'inside',
      asset: { id: 'folder-1', label: 'Disabled Folder', kind: 'folder', enabled: false },
    })
    await runtime.createPromptResourceAsset({
      resourceId: created.resource.id,
      targetAssetId: withFolder.resource.rootNode.children![0]!.id,
      position: 'inside',
      asset: {
        id: 'entry-1',
        label: 'Fresh Entry',
        kind: 'entry',
        body: 'Only when the folder is enabled.',
        capabilities: { lifecycle: { lifecycle: 'fresh' } },
      },
    })

    await expect(readPromptResourceInputs({
      documents,
      resourceIds: [created.resource.id],
      macroContext: { user: 'User' },
    })).resolves.toMatchObject({ contributions: [] })

    await runtime.updatePromptResourceAsset({ resourceId: created.resource.id, assetId: 'folder-1', enabled: true })
    const enabled = await readPromptResourceInputs({
      documents,
      resourceIds: [created.resource.id],
      macroContext: { user: 'User' },
    })
    expect(enabled.contributions[0]?.capabilities.lifecycle).toEqual({ lifecycle: 'fresh' })
  })

  it('preserves exact raw JSON through the Source Artifact capability', async () => {
    const raw = await readFile(join(process.cwd(), 'packages/application-runtime/fixtures/workspaces/loom-city-v0.json'), 'utf8')
    let preserved: Uint8Array | undefined
    const runtime = createApplicationRuntime({
      documents: createInMemoryDocumentStore(),
      sourceArtifacts: {
        preserve: async input => {
          preserved = input.source
          return {
            sourceArtifactId: 'artifact-raw',
            blobId: 'blob-raw',
            sha256: 'a'.repeat(64),
            sizeBytes: input.source.byteLength,
            originalFileName: input.originalFileName,
            mediaType: input.mediaType,
          }
        },
      },
    })

    const imported = await runtime.importCardBundle({
      source: { text: raw, originalFileName: 'loom-city.json' },
    })

    expect(new TextDecoder().decode(preserved)).toBe(raw)
    expect(imported.importBundle.sourceArtifactRef).toMatchObject({
      sourceArtifactId: 'artifact-raw',
      blobId: 'blob-raw',
      originalFileName: 'loom-city.json',
    })
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

  it('passes through unknown source fields while canonical fields use current data', async () => {
    const runtime = createApplicationRuntime({ documents: createInMemoryDocumentStore() })
    const source = {
      ...await readLoomCityArtifact(),
      communityExtension: { retained: true },
      card: {
        ...(await readLoomCityArtifact()).card,
        communityCardField: 'kept',
      },
    } as CardBundleArtifact
    const imported = await runtime.importCardBundle({ artifact: source })
    await runtime.updateCard({ cardId: imported.card.id, description: 'Current canonical description' })

    const result = await runtime.exportCardArtifact({ cardId: imported.card.id })
    const exported = result.artifact as CardBundleArtifact & {
      communityExtension?: { retained: boolean }
      card: CardBundleArtifact['card'] & { communityCardField?: string }
    }
    expect(exported.communityExtension).toEqual({ retained: true })
    expect(exported.card.communityCardField).toBe('kept')
    expect(exported.card.description).toBe('Current canonical description')
  })

  it('rejects invalid manifest references and keeps shared resources after deleting a card', async () => {
    const documents = createInMemoryDocumentStore()
    const runtime = createApplicationRuntime({ documents })
    const imported = await runtime.importCardBundle({ artifact: await readLoomCityArtifact() })
    const resourceId = imported.card.promptResourceIds![0]!
    const secondCard = await runtime.createCard({ name: 'Shared resource card' })
    await runtime.updateCardPromptResources({ cardId: secondCard.card.id, promptResourceIds: [resourceId] })
    const wrongType = await documents.write({
      id: 'not-a-prompt-resource',
      type: 'example.note',
      content: {},
      expectedVersion: 'new',
    })

    await expect(runtime.updateCardPromptResources({
      cardId: secondCard.card.id,
      promptResourceIds: [resourceId, resourceId],
    })).rejects.toThrow('Duplicate prompt resource id')
    await expect(runtime.updateCardPromptResources({
      cardId: secondCard.card.id,
      promptResourceIds: ['missing-resource'],
    })).rejects.toThrow('Document not found: missing-resource')
    await expect(runtime.updateCardPromptResources({
      cardId: secondCard.card.id,
      promptResourceIds: [wrongType.documents[0]!.id],
    })).rejects.toThrow('Unexpected document type')

    await runtime.deleteCard({ cardId: imported.card.id })
    await expect(runtime.getPromptResource({ resourceId })).resolves.toMatchObject({
      resource: { id: resourceId },
    })
    await expect(runtime.getCard({ cardId: secondCard.card.id })).resolves.toMatchObject({
      card: { promptResourceIds: [resourceId] },
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
