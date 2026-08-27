import {
  createApplicationRuntime,
  createVariableRenderContext,
  readPromptResourceInputs,
  type CardBundleArtifact,
} from '../../../packages/application-runtime/src/index.js'
import { createSqliteDataEngine } from '../../../packages/data-engine/src/index.js'
import { createSqliteDocumentStore } from '../../../packages/document-store/src/index.js'
import { createPromptResourceStore } from '../../../packages/prompt-resource-store/src/index.js'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('application runtime card bundle integration', () => {
  it('initializes the official assistant Prompt resources and keeps the built-ins read-only', async () => {
    const { runtime } = createTestRuntime()

    await runtime.initialize()
    const listed = await runtime.listPromptResources()
    const preset = listed.resources.find(resource => resource.origin?.key === 'loom-assistant-preset')
    const setting = listed.resources.find(resource => resource.origin?.key === 'loom-knowledge-setting')

    expect(preset).toMatchObject({
      resourceKind: 'preset',
      rootNode: { label: 'Loom Studio 问答助手' },
      historyPolicy: 'persistent',
    })
    await expect(runtime.listSettingMounts({ source: { kind: 'manual', id: 'global' } })).resolves.toMatchObject({ mounts: [{ settingResourceId: setting!.id }] })
    const compositionItems = preset?.rootNode.children?.find(node => node.kind === 'order')?.skeletonPatch?.items
      ?.flatMap(item => item.kind === 'message' ? item.items : [item])
    expect(compositionItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'slot', bindingId: 'runtime.narrativeHistory' }),
      expect.objectContaining({ kind: 'slot', bindingId: 'runtime.sessionHistory' }),
      expect.objectContaining({ kind: 'entry', source: { kind: 'binding', bindingId: 'runtime.currentInput' } }),
    ]))
    expect(setting).toMatchObject({ resourceKind: 'setting', rootNode: { label: 'Loom Studio 基础知识' } })
    const updated = await runtime.updatePromptResourceAsset({
      resourceId: preset!.id,
      assetId: preset!.rootNode.id,
      label: 'Changed',
    })
    expect(updated.resource.rootNode.label).toBe('Changed')
  })

  it('creates, duplicates, exports, and imports independent Prompt resources', async () => {
    const { runtime } = createTestRuntime()
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
    const { runtime } = createTestRuntime()
    const preset = await runtime.createPromptResource({ resourceKind: 'preset', name: 'Guide Preset' })
    const setting = await runtime.createPromptResource({ resourceKind: 'setting', name: 'Guide Knowledge' })

    const updated = await runtime.replaceSettingMounts({
      source: { kind: 'preset', id: preset.resource.id },
      settingResourceIds: [setting.resource.id],
    })

    expect(updated.mounts).toMatchObject([{ settingResourceId: setting.resource.id }])
    await expect(runtime.replaceSettingMounts({
      source: { kind: 'preset', id: preset.resource.id },
      settingResourceIds: [preset.resource.id],
    })).rejects.toThrow('can only link Setting resources')
  })

  it('applies Folder effective enabled and preserves Entry lifecycle', async () => {
    const { runtime, promptResources } = createTestRuntime()
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
      promptResources,
      resourceIds: [created.resource.id],
      variables: createVariableRenderContext(),
    })).resolves.toMatchObject({ contributions: [] })

    await runtime.updatePromptResourceAsset({ resourceId: created.resource.id, assetId: 'folder-1', enabled: true })
    const enabled = await readPromptResourceInputs({
      promptResources,
      resourceIds: [created.resource.id],
      variables: createVariableRenderContext(),
    })
    expect(enabled.contributions[0]?.capabilities.lifecycle).toEqual({ lifecycle: 'fresh' })
  })

  it('preserves exact raw JSON through the Source Artifact capability', async () => {
    const raw = await readFile(join(process.cwd(), 'packages/application-runtime/fixtures/workspaces/loom-city-v0.json'), 'utf8')
    let preserved: Uint8Array | undefined
    const { runtime } = createTestRuntime({
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

  it('round-trips Card V2 State Templates and Bindings and rejects identity conflicts', async () => {
    const { runtime, documents } = createTestRuntime()
    const artifact: CardBundleArtifact = {
      schemaVersion: 2,
      artifactId: 'state-card-v2',
      displayName: 'State Card V2',
      card: { name: 'State Card' },
      contextAssets: [],
      stateTemplates: [{
        id: 'template.person.v1', templateVersion: 1, label: 'Person',
        schema: { type: 'object', properties: { gold: { type: 'number' } }, required: ['gold'] },
        initial: { gold: 10 },
      }],
      timelineStateBindings: [{ path: 'characters.alice', templateId: 'template.person.v1', templateVersion: 1, initial: { gold: 12 } }],
    }
    const imported = await runtime.importCardBundle({ artifact })
    const exported = await runtime.exportCardBundle({ cardId: imported.card.id })

    expect(exported.artifact).toMatchObject({
      schemaVersion: 2,
      stateTemplates: artifact.stateTemplates,
      timelineStateBindings: artifact.timelineStateBindings,
    })
    await expect(documents.get('template.person.v1')).resolves.toMatchObject({ type: 'airp.stateDefinition' })
    await expect(runtime.importCardBundle({ artifact })).resolves.toBeDefined()
    await expect(runtime.importCardBundle({
      artifact: {
        ...artifact,
        artifactId: 'conflicting-state-card',
        stateTemplates: [{ ...artifact.stateTemplates![0]!, initial: { gold: 99 } }],
      },
    })).rejects.toThrow('State template identity conflict')
    await expect(runtime.importCardBundle({
      artifact: {
        ...artifact,
        artifactId: 'missing-template-card',
        stateTemplates: [],
      },
    })).rejects.toThrow('template is missing')
  })

  it('edits a resource directly and exports the current card bundle', async () => {
    const { runtime } = createTestRuntime()
    const imported = await runtime.importCardBundle({ artifact: await readLoomCityArtifact() })
    const listed = await runtime.listCardPromptResources({ cardId: imported.card.id })
    const preset = listed.resources.find(resource => resource.rootNode.id === 'preset-default-airp')
    if (!preset) throw new Error('Expected preset resource')

    await runtime.updatePromptResourceAsset({
      resourceId: preset.id,
      assetId: 'preset-style-directive',
      body: 'Resource-scoped edit.',
    })
    const exported = await runtime.exportCardBundle({ cardId: imported.card.id })

    expect(findNode(exported.artifact, 'preset-style-directive')?.body).toBe('Resource-scoped edit.')
    expect(exported.artifact.metadata).toMatchObject({ exportedFromCardId: imported.card.id })
  })

  it('passes through unknown source fields while canonical fields use current data', async () => {
    const { runtime } = createTestRuntime()
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

    const result = await runtime.exportCardBundle({ cardId: imported.card.id })
    const exported = result.artifact as CardBundleArtifact & {
      communityExtension?: { retained: boolean }
      card: CardBundleArtifact['card'] & { communityCardField?: string }
    }
    expect(exported.communityExtension).toEqual({ retained: true })
    expect(exported.card.communityCardField).toBe('kept')
    expect(exported.card.description).toBe('Current canonical description')
  })

  it('rejects invalid manifest references and keeps shared resources after deleting a card', async () => {
    const { runtime, documents } = createTestRuntime()
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
    })).rejects.toThrow('Prompt resource not found: missing-resource')
    await expect(runtime.updateCardPromptResources({
      cardId: secondCard.card.id,
      promptResourceIds: [wrongType.documents[0]!.id],
    })).rejects.toThrow('Prompt resource not found')

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

function createTestRuntime(options: {
  sourceArtifacts?: Parameters<typeof createApplicationRuntime>[0]['sourceArtifacts']
} = {}) {
  let sequence = 0
  const createId = (prefix: string) => `${prefix}-${++sequence}`
  const now = () => '2026-08-19T00:00:00.000Z'
  const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
  const documents = createSqliteDocumentStore({ engine })
  const promptResources = createPromptResourceStore({ engine, createId, now })
  const runtime = createApplicationRuntime({ dataEngine: engine, documents, promptResources, sourceArtifacts: options.sourceArtifacts })
  return { engine, documents, promptResources, runtime }
}
