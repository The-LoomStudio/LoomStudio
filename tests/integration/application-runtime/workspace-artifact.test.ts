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
    const collectVirtualAnchors = (nodes?: Array<{ kind?: string; capabilities?: { targetAnchorId?: string }; children?: unknown[] }>): string[] => {
      if (!nodes) return []
      return nodes.flatMap(node => [
        ...(node.kind === 'virtual' && node.capabilities?.targetAnchorId ? [node.capabilities.targetAnchorId] : []),
        ...collectVirtualAnchors(node.children as any),
      ])
    }
    const virtualAnchors = collectVirtualAnchors(preset?.rootNode.children)
    expect(virtualAnchors).toEqual(expect.arrayContaining([
      '@chat.narrative',
      '@chat.session',
      '@chat.input',
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
    const createdEntry = entry.resource.rootNode.children?.find(c => c.label === 'Guide')

    expect(createdEntry?.capabilities).toMatchObject({
      targetAnchorId: '@chat.system',
      localDepth: 10,
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

  it('creates, edits, binds, exports, unbinds, and deletes Portable Extension Payloads', async () => {
    const { runtime, documents } = createTestRuntime()
    const created = await runtime.createPortableExtensionPayload({
      artifactPayloadId: 'image-style-v1',
      payload: {
        packageId: 'example.image-generator',
        fileName: 'style.json',
        format: 'example.image-style',
        mediaType: 'application/json',
        content: '{"style":"watercolor"}',
      },
    }, { actor: { kind: 'extension', id: 'example.image-generator' } })
    expect(created.mutation.changesetId).toBeTruthy()
    await expect(documents.getChangeset(created.mutation.changesetId)).resolves.toMatchObject({
      createdBy: { kind: 'extension', id: 'example.image-generator' },
    })
    await expect(runtime.getPortableExtensionPayload({ payloadId: created.payload.id }))
      .resolves.toEqual({ payload: created.payload })
    await expect(runtime.listPortableExtensionPayloads({ packageId: 'example.image-generator' }))
      .resolves.toMatchObject({ payloads: [{ id: created.payload.id }] })

    const updated = await runtime.updatePortableExtensionPayload({
      payloadId: created.payload.id,
      expectedVersion: created.payload.version,
      payload: {
        packageId: created.payload.packageId,
        fileName: created.payload.fileName,
        format: created.payload.format,
        mediaType: created.payload.mediaType,
        content: '{"style":"oil-painting"}',
      },
    })
    expect(updated.payload).toMatchObject({
      artifactPayloadId: 'image-style-v1',
      version: created.payload.version + 1,
      content: '{"style":"oil-painting"}',
    })

    const duplicateArtifactPayload = await runtime.createPortableExtensionPayload({
      artifactPayloadId: 'image-style-v1',
      payload: {
        packageId: 'example.image-generator',
        fileName: 'alternate-style.json',
        format: 'example.image-style',
        mediaType: 'application/json',
        content: '{"style":"ink"}',
      },
    })
    const card = await runtime.createCard({ name: 'Portable Payload Card' })
    await expect(runtime.replaceCardPortableExtensionPayloads({
      cardId: card.card.id,
      expectedVersion: card.card.version,
      payloadIds: [updated.payload.id, updated.payload.id],
    })).rejects.toThrow('Duplicate Portable Extension Payload binding')
    await expect(runtime.replaceCardPortableExtensionPayloads({
      cardId: card.card.id,
      expectedVersion: card.card.version,
      payloadIds: [updated.payload.id, duplicateArtifactPayload.payload.id],
    })).rejects.toThrow('Duplicate Artifact Payload id in Card bindings')
    const bound = await runtime.replaceCardPortableExtensionPayloads({
      cardId: card.card.id,
      expectedVersion: card.card.version,
      payloadIds: [updated.payload.id],
    })
    const exported = await runtime.exportCardBundle({ cardId: card.card.id })
    expect(bound.card.portableExtensionPayloadIds).toEqual([updated.payload.id])
    expect(exported.artifact.extensionPayloads).toEqual([{
      id: 'image-style-v1',
      packageId: 'example.image-generator',
      fileName: 'style.json',
      format: 'example.image-style',
      mediaType: 'application/json',
      content: '{"style":"oil-painting"}',
    }])
    await expect(runtime.deletePortableExtensionPayload({
      payloadId: updated.payload.id,
      expectedVersion: updated.payload.version,
    })).rejects.toThrow('still bound to Card')

    const unbound = await runtime.replaceCardPortableExtensionPayloads({
      cardId: card.card.id,
      expectedVersion: bound.card.version,
      payloadIds: [],
    })
    expect(unbound.card.portableExtensionPayloadIds).toEqual([])
    await expect(runtime.deletePortableExtensionPayload({
      payloadId: updated.payload.id,
      expectedVersion: updated.payload.version,
    })).resolves.toMatchObject({ deleted: true })
    await expect(runtime.deletePortableExtensionPayload({
      payloadId: duplicateArtifactPayload.payload.id,
      expectedVersion: duplicateArtifactPayload.payload.version,
    })).resolves.toMatchObject({ deleted: true })
  })

  it('keeps a Portable Extension Payload after deleting its bound Card', async () => {
    const { runtime } = createTestRuntime()
    const payload = await runtime.createPortableExtensionPayload({
      payload: {
        packageId: 'example.retained',
        fileName: 'config.json',
        format: 'example.retained-config',
        mediaType: 'application/json',
        content: '{}',
      },
    })
    const card = await runtime.createCard({ name: 'Disposable Card' })
    await runtime.replaceCardPortableExtensionPayloads({
      cardId: card.card.id,
      expectedVersion: card.card.version,
      payloadIds: [payload.payload.id],
    })

    await runtime.deleteCard({ cardId: card.card.id })

    await expect(runtime.getPortableExtensionPayload({ payloadId: payload.payload.id }))
      .resolves.toMatchObject({ payload: { id: payload.payload.id } })
    await expect(runtime.deletePortableExtensionPayload({
      payloadId: payload.payload.id,
      expectedVersion: payload.payload.version,
    })).resolves.toMatchObject({ deleted: true })
  })

  it('cascade deletes prompt resources and portable extension payloads when includePromptResources is true', async () => {
    const { runtime } = createTestRuntime()
    const resource = await runtime.createPromptResource({ resourceKind: 'setting', name: 'Card Lorebook' })
    const payload = await runtime.createPortableExtensionPayload({
      payload: {
        packageId: 'example.script',
        fileName: 'script.json',
        format: 'example.script',
        mediaType: 'application/json',
        content: '{"active":true}',
      },
    })
    const card = await runtime.createCard({ name: 'Cascaded Card' })
    await runtime.updateCardPromptResources({
      cardId: card.card.id,
      promptResourceIds: [resource.resource.id],
    })
    const updatedCard = await runtime.getCard({ cardId: card.card.id })
    await runtime.replaceCardPortableExtensionPayloads({
      cardId: card.card.id,
      expectedVersion: updatedCard.card.version,
      payloadIds: [payload.payload.id],
    })

    await expect(runtime.deleteCard({ cardId: card.card.id, includePromptResources: true }))
      .resolves.toMatchObject({ deleted: true })

    await expect(runtime.getPromptResource({ resourceId: resource.resource.id }))
      .rejects.toThrow('Prompt resource not found')
    await expect(runtime.getPortableExtensionPayload({ payloadId: payload.payload.id }))
      .rejects.toThrow('Document not found')
  })

  it('deletes Text Transform Rules owned by a deleted Card or Preset', async () => {
    const { runtime } = createTestRuntime()
    const card = await runtime.createCard({ name: 'Rule Owner Card' })
    const preset = await runtime.createPromptResource({ resourceKind: 'preset', name: 'Rule Owner Preset' })
    const rule = (owner: { kind: 'card'; cardId: string } | { kind: 'preset'; presetId: string }) => ({
      name: 'Owned Rule',
      owner,
      enabled: true,
      orderIndex: 0,
      matcher: { kind: 'regex' as const, pattern: 'owned', flags: 'g' },
      effect: { kind: 'replace' as const, replacement: '' },
      targets: ['narrative' as const],
      phases: ['display' as const],
    })
    await runtime.upsertTextTransformRule({ ruleId: 'card-owned-rule', rule: rule({ kind: 'card', cardId: card.card.id }) })
    await runtime.upsertTextTransformRule({ ruleId: 'preset-owned-rule', rule: rule({ kind: 'preset', presetId: preset.resource.id }) })

    await runtime.deleteCard({ cardId: card.card.id })
    await runtime.deletePromptResource({ resourceId: preset.resource.id })

    await expect(runtime.listTextTransformRules()).resolves.toEqual({ rules: [] })
  })

  it('edits a resource directly and exports the current card bundle', async () => {
    const { runtime } = createTestRuntime()
    const imported = await runtime.importCardBundle({ artifact: await readLoomCityArtifact() })
    const resources = await Promise.all(imported.card.promptResourceIds.map(async resourceId => (
      await runtime.getPromptResource({ resourceId })
    ).resource))
    const preset = resources.find(resource => resource.rootNode.id === 'preset-default-airp')
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
