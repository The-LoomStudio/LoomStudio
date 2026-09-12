import {
  createApplicationRuntime,
  createVariableRenderContext,
  exportCardArtifact,
  importCardBundle,
  isCardBundleArtifact,
  readPromptResourceInputs,
  type CardBundleArtifact,
} from '@loom-studio/application-runtime'
import { isPromptResourceArtifact, normalizePromptResourceArtifact } from '../../../packages/application-runtime/src/cards/workspace.js'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createBlobStore } from '@loom-studio/blob-store'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createPromptResourceStore } from '@loom-studio/prompt-resource-store'
import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('card bundle artifact boundary', () => {
  it('keeps shared prompt resources when a card and its private resources are deleted', async () => {
    const fixture = createFixture()
    const first = await importCardBundle({ artifact: createArtifact(), ...fixture })
    const second = await importCardBundle({ artifact: createArtifact(), ...fixture })
    const deletedIds: string[] = []
    const runtime = createApplicationRuntime({ dataEngine: fixture.engine, documents: fixture.documents, promptResources: fixture.promptResources,
      withCardDeletion: async (id, commit) => { deletedIds.push(id); return commit() },
    })
    const shared = first.card.promptResourceIds![0]!
    const own = first.card.promptResourceIds![1]!
    await runtime.updateCardPromptResources({ cardId: second.card.id, promptResourceIds: [shared] })
    await runtime.deleteCard({ cardId: first.card.id, includePromptResources: true })
    expect(deletedIds).toEqual([first.card.id])
    expect(await fixture.promptResources.getResource(shared)).toBeTruthy()
    expect(await fixture.promptResources.getResource(own)).toBeNull()
  })

  it('imports a card, flat prompt resources, and an immutable import bundle', async () => {
    const fixture = createFixture()
    const imported = await importCardBundle({ artifact: createArtifact(), ...fixture, now: '2026-06-22T00:00:00.000Z' })

    expect(imported.card.promptResourceIds).toHaveLength(2)
    expect(imported.card.importBundleId).toBe(imported.importBundle.id)
    expect(imported.card.preset).toEqual({ system: 'Bundle system prompt.' })
    expect(imported.card.settingLayer.entries).toEqual([
      expect.objectContaining({ id: 'bundle-setting', content: 'Bundle setting content.' }),
    ])
    expect(imported.importBundle.documentIds).toEqual([imported.card.id, imported.importBundle.id])
    expect(imported.importBundle.sourceArtifactRef).toMatchObject({
      artifactId: 'test-card-bundle-v0',
      format: 'loom.cardBundle',
    })
    await expect(fixture.promptResources.getResource(imported.card.promptResourceIds![0]!)).resolves.toBeTruthy()
  })

  it('builds prompt inputs directly from ordered resource ids', async () => {
    const fixture = createFixture()
    const imported = await importCardBundle({ artifact: createArtifact(), ...fixture })
    const inputs = await readPromptResourceInputs({
      promptResources: fixture.promptResources,
      resourceIds: imported.card.promptResourceIds ?? [],
      variables: createVariableRenderContext(),
    })

    expect(inputs.contributions.map(contribution => contribution.content)).toContain('Original prompt asset.')
    await expect(readPromptResourceInputs({
      promptResources: fixture.promptResources,
      resourceIds: [imported.card.promptResourceIds![0]!, imported.card.promptResourceIds![0]!],
      variables: createVariableRenderContext(),
    })).rejects.toThrow('Duplicate prompt resource id')
  })

  it('persists opaque Extension Payloads as canonical documents and exports them unchanged', async () => {
    const fixture = createFixture()
    const artifact = createArtifact()
    artifact.extensionPayloads = [{
      id: 'image-style-v1',
      packageId: 'example.image-generator',
      fileName: 'style.json',
      format: 'example.image-style',
      mediaType: 'application/json',
      schemaVersion: 1,
      requirement: { versionRange: '^1.0.0' },
      metadata: { label: 'Watercolor' },
      content: '{"artist":"example","style":"watercolor"}',
      resourceOrigin: 'external',
    }]

    const imported = await importCardBundle({ artifact, ...fixture })
    const payloadId = imported.card.portableExtensionPayloadIds?.[0]
    expect(payloadId).toBeTruthy()
    await expect(fixture.documents.get(payloadId!)).resolves.toMatchObject({
      type: 'airp.portableExtensionPayload',
      content: {
        artifactPayloadId: 'image-style-v1',
        packageId: 'example.image-generator',
        content: artifact.extensionPayloads[0]!.content,
      },
    })
    expect(imported.importBundle.documentIds).toContain(payloadId)

    const exported = await exportCardArtifact({
      cardId: imported.card.id,
      documents: fixture.documents,
      promptResources: fixture.promptResources,
    })
    expect(exported.extensionPayloads).toEqual(artifact.extensionPayloads)

    const reimported = await importCardBundle({ artifact: exported, ...fixture })
    expect(reimported.card.portableExtensionPayloadIds?.[0]).not.toBe(payloadId)
  })

  it('exports current resource content while retaining source artifact metadata', async () => {
    const fixture = createFixture()
    const imported = await importCardBundle({ artifact: createArtifact(), ...fixture })
    const resourceId = imported.card.promptResourceIds![0]!

    const runtime = createApplicationRuntime({ dataEngine: fixture.engine, documents: fixture.documents, promptResources: fixture.promptResources })
    await runtime.updatePromptResourceAsset({ resourceId, assetId: 'preset-entry', body: 'Edited prompt asset.' })
    const exported = await exportCardArtifact({ cardId: imported.card.id, documents: fixture.documents, promptResources: fixture.promptResources })

    expect(findNode(exported, 'preset-entry')?.body).toBe('Edited prompt asset.')
    expect(imported.importBundle.sourceArtifact.contextAssets[0]?.children?.[0]?.body).toBe('Original prompt asset.')
    expect(exported.metadata).toMatchObject({
      importBundle: { id: imported.importBundle.id },
      exportedFromCardId: imported.card.id,
    })
    expect(exported.card.preset).toEqual({ system: 'Bundle system prompt.' })
    expect(exported.card.settingLayer?.entries).toEqual([
      expect.objectContaining({ id: 'bundle-setting', content: 'Bundle setting content.' }),
    ])
  })

  it('re-imports an export with fresh document ids', async () => {
    const fixture = createFixture()
    const first = await importCardBundle({ artifact: createArtifact(), ...fixture })
    const exported = await exportCardArtifact({ cardId: first.card.id, documents: fixture.documents, promptResources: fixture.promptResources })
    const second = await importCardBundle({ artifact: exported, ...fixture })

    expect(second.card.id).not.toBe(first.card.id)
    expect(second.importBundle.id).not.toBe(first.importBundle.id)
    expect(second.card.promptResourceIds).not.toEqual(first.card.promptResourceIds)
    expect(second.importBundle.documentIds).toEqual([second.card.id, second.importBundle.id])
    expect(second.card.preset).toEqual(first.card.preset)
    expect(second.card.settingLayer).toEqual(first.card.settingLayer)
  })

  it('keeps external provenance per Card through ID remapping and reference edits', async () => {
    const fixture = createFixture()
    const artifact = createArtifact()
    artifact.externalContextAssetIds = [artifact.contextAssets[1]!.id]
    const first = await importCardBundle({ artifact, ...fixture })
    expect(first.card.externalPromptResourceIds).toEqual([first.card.promptResourceIds![1]])
    const exportCard = (cardId: string) => exportCardArtifact({ cardId, ...fixture })
    const exported = await exportCard(first.card.id)
    expect(exported.externalContextAssetIds).toEqual([exported.contextAssets[1]!.id])
    const second = await importCardBundle({ artifact: exported, ...fixture })
    const reexported = await exportCard(second.card.id)
    expect(reexported.contextAssets[1]!.id).not.toBe(exported.contextAssets[1]!.id)
    expect(reexported.externalContextAssetIds).toEqual([reexported.contextAssets[1]!.id])

    const runtime = createApplicationRuntime({ dataEngine: fixture.engine, documents: fixture.documents, promptResources: fixture.promptResources })
    await expect(runtime.updateCardPromptResources({
      cardId: first.card.id, promptResourceIds: first.card.promptResourceIds!, externalPromptResourceIds: ['missing'],
    })).rejects.toThrow('External prompt resources')
    await runtime.updateCardPromptResources({
      cardId: first.card.id, promptResourceIds: first.card.promptResourceIds!, externalPromptResourceIds: [],
    })
    expect((await exportCard(first.card.id)).externalContextAssetIds).toEqual([])
    expect((await exportCard(second.card.id)).externalContextAssetIds).toEqual(reexported.externalContextAssetIds)
    await runtime.updateCardPromptResources({
      cardId: second.card.id, promptResourceIds: [second.card.promptResourceIds![0]!],
    })
    expect((await exportCard(second.card.id)).externalContextAssetIds).toEqual([])
  })

  it('rejects malformed nested resource nodes and duplicate ids before writing', async () => {
    const malformed = createArtifact() as unknown as { contextAssets: Array<{ children?: unknown }> }
    malformed.contextAssets[0]!.children = [{ id: 'missing-node-shape' }]
    expect(isCardBundleArtifact(malformed as never)).toBe(false)
    await expect(importCardBundle({ artifact: malformed as never, ...createFixture() }))
      .rejects.toThrow('Prompt resource node label must be a string')

    const duplicate = createArtifact()
    duplicate.contextAssets[0]!.children!.push({
      id: 'preset-entry',
      label: 'Duplicate',
      kind: 'entry',
    })
    expect(isCardBundleArtifact(duplicate as never)).toBe(false)
    await expect(importCardBundle({ artifact: duplicate, ...createFixture() }))
      .rejects.toThrow('Duplicate prompt resource node id: preset-entry')
  })

  it('rejects malformed, duplicate, and oversized Extension Payloads before writing', async () => {
    const duplicate = createArtifact()
    duplicate.extensionPayloads = [createPayload(), createPayload()]
    expect(isCardBundleArtifact(duplicate as never)).toBe(false)
    await expect(importCardBundle({ artifact: duplicate, ...createFixture() }))
      .rejects.toThrow('Duplicate Extension Payload id')

    const unsafeName = createArtifact()
    unsafeName.extensionPayloads = [{ ...createPayload(), fileName: '../config.json' }]
    await expect(importCardBundle({ artifact: unsafeName, ...createFixture() }))
      .rejects.toThrow('fileName is invalid')

    const unsafePackage = createArtifact()
    unsafePackage.extensionPayloads = [{ ...createPayload(), packageId: 'example/extension' }]
    await expect(importCardBundle({ artifact: unsafePackage, ...createFixture() }))
      .rejects.toThrow('packageId')

    const invalidVersion = createArtifact()
    invalidVersion.extensionPayloads = [{ ...createPayload(), schemaVersion: 0 }]
    await expect(importCardBundle({ artifact: invalidVersion, ...createFixture() }))
      .rejects.toThrow('schemaVersion is invalid')

    const emptyFormat = createArtifact()
    emptyFormat.extensionPayloads = [{ ...createPayload(), format: '   ' }]
    await expect(importCardBundle({ artifact: emptyFormat, ...createFixture() }))
      .rejects.toThrow('format')

    const oversized = createArtifact()
    oversized.extensionPayloads = [{ ...createPayload(), content: 'x'.repeat(8 * 1024 * 1024 + 1) }]
    await expect(importCardBundle({ artifact: oversized, ...createFixture() }))
      .rejects.toThrow('Extension Payload exceeds')

    const tooMany = createArtifact()
    tooMany.extensionPayloads = Array.from({ length: 65 }, (_, index) => ({
      ...createPayload(),
      id: `payload-${index}`,
    }))
    await expect(importCardBundle({ artifact: tooMany, ...createFixture() }))
      .rejects.toThrow('exceed 64 entries')

    const totalOversized = createArtifact()
    totalOversized.extensionPayloads = Array.from({ length: 5 }, (_, index) => ({
      ...createPayload(),
      id: `payload-${index}`,
      content: 'x'.repeat(7 * 1024 * 1024),
    }))
    await expect(importCardBundle({ artifact: totalOversized, ...createFixture() }))
      .rejects.toThrow('total bytes')
  })

  it('records trusted request context on the bundle transaction', async () => {
    const fixture = createFixture()
    const commits: Array<{ changeset: { createdBy: unknown; correlationId?: string; callId?: string; parentCallId?: string } }> = []
    fixture.engine.subscribeCommits(commit => commits.push({ changeset: { createdBy: commit.actor, correlationId: commit.correlationId, callId: commit.callId, parentCallId: commit.parentCallId } }))

    await importCardBundle({
      artifact: createArtifact(),
      context: {
        clientId: 'bundle-client',
        correlationId: 'corr-bundle',
        callId: 'call-bundle',
        parentCallId: 'call-parent',
      },
      ...fixture,
    })

    expect(commits).toHaveLength(1)
    expect(commits[0]?.changeset).toMatchObject({
      createdBy: { kind: 'client', id: 'bundle-client' },
      correlationId: 'corr-bundle',
      callId: 'call-bundle',
      parentCallId: 'call-parent',
    })
  })

  it('imports legacy v2 and round-trips v3 Script attachments with disabled empty-grant Mounts', async () => {
    const fixture = createFixture()
    const rootDirectory = await mkdtemp(join(tmpdir(), 'loom-card-script-'))
    const blobs = createBlobStore({ engine: fixture.engine, rootDirectory, createId: prefix => `${prefix}-blob`, now: () => '2026-09-11T00:00:00.000Z' })
    try {
      const legacy = await importCardBundle({ artifact: createArtifact(), ...fixture })
      expect(legacy.importBundle.sourceArtifact.schemaVersion).toBe(4)

      const artifact = createArtifact()
      artifact.schemaVersion = 3
      artifact.scriptAttachments = [{
        orderIndex: 7,
        resourceOrigin: 'external',
        script: { format: 'loom.script', schemaVersion: 1, fileName: 'alice.loom.js', source: loomScriptSource() },
      }]
      const imported = await importCardBundle({ artifact, ...fixture, blobs })
      const documents = await fixture.documents.list({ type: 'airp.loomScriptMount' })
      const mount = documents.items.find(item => (item.content as any).target?.cardId === imported.card.id)
      expect(mount?.content).toMatchObject({ enabled: false, grantedCapabilities: [], orderIndex: 7 })

      const exported = await exportCardArtifact({ cardId: imported.card.id, documents: fixture.documents, promptResources: fixture.promptResources, blobs })
      expect(exported.schemaVersion).toBe(4)
      expect(exported.scriptAttachments).toEqual(artifact.scriptAttachments)
    } finally {
      await rm(rootDirectory, { recursive: true, force: true })
    }
  })

  it('round-trips Card-owned text rules and extractors without restoring foreign ownership', async () => {
    const fixture = createFixture()
    const artifact = createArtifact()
    artifact.schemaVersion = 4
    artifact.textTransformRules = [{
      name: 'Hide reasoning', enabled: true, orderIndex: 3,
      matcher: { kind: 'regex', pattern: '<think>.*?</think>', flags: 'gs' },
      effect: { kind: 'replace', replacement: '' }, targets: ['narrative'], phases: ['prompt'],
    }]
    artifact.textExtractors = [{
      name: 'Weather', enabled: true, orderIndex: 2,
      matcher: { kind: 'regex', pattern: '<weather>(.*?)</weather>', flags: 'gs', contentGroup: 1 },
      targets: ['narrative'], strategy: 'latest-valid', parser: 'text', artifactType: 'weather',
    }]
    const first = await importCardBundle({ artifact, ...fixture })
    const exported = await exportCardArtifact({ cardId: first.card.id, documents: fixture.documents, promptResources: fixture.promptResources })
    expect(exported.textTransformRules).toEqual(artifact.textTransformRules)
    expect(exported.textExtractors).toEqual(artifact.textExtractors)
    const second = await importCardBundle({ artifact: exported, ...fixture })
    const rules = await fixture.documents.list({ type: 'airp.textTransformRule' })
    expect(rules.items.map(item => item.content.owner)).toEqual(expect.arrayContaining([
      { kind: 'card', cardId: first.card.id }, { kind: 'card', cardId: second.card.id },
    ]))
    const extractors = await fixture.documents.list({ type: 'airp.textExtractor' })
    expect(extractors.items.map(item => item.content.owner)).toEqual(expect.arrayContaining([
      { kind: 'card', cardId: first.card.id }, { kind: 'card', cardId: second.card.id },
    ]))
    const invalid = structuredClone(artifact)
    Object.assign(invalid.textTransformRules![0]!, { owner: { kind: 'workspace' } })
    await expect(importCardBundle({ artifact: invalid, ...fixture })).rejects.toThrow('Invalid Card text pipeline')
    expect((await fixture.documents.list({ type: 'airp.textTransformRule' })).items).toHaveLength(2)
  })

  it('accepts Prompt Resource v1 and normalizes portable Script attachments to v2', () => {
    const legacy = {
      format: 'loom.promptResource' as const,
      schemaVersion: 1 as const,
      resourceKind: 'preset' as const,
      rootNode: { id: 'preset-root', label: 'Preset', kind: 'module' as const },
    }
    expect(isPromptResourceArtifact(legacy)).toBe(true)
    expect(normalizePromptResourceArtifact(legacy).schemaVersion).toBe(2)

    const portable = normalizePromptResourceArtifact({
      ...legacy,
      schemaVersion: 2,
      scriptAttachments: [{ orderIndex: 3, script: { format: 'loom.script', schemaVersion: 1, fileName: 'alice.loom.js', source: loomScriptSource() } }],
    })
    expect(portable.scriptAttachments?.[0]).toMatchObject({ orderIndex: 3, script: { fileName: 'alice.loom.js' } })
  })

  it('imports and exports Preset Script attachments through the formal Prompt Resource runtime', async () => {
    const fixture = createFixture()
    const rootDirectory = await mkdtemp(join(tmpdir(), 'loom-preset-script-'))
    const blobs = createBlobStore({ engine: fixture.engine, rootDirectory, createId: prefix => `${prefix}-preset-blob`, now: () => '2026-09-11T00:00:00.000Z' })
    try {
      const runtime = createApplicationRuntime({ ...fixture, blobs })
      const attachment = {
        orderIndex: 2,
        script: { format: 'loom.script' as const, schemaVersion: 1 as const, fileName: 'alice.loom.js', source: loomScriptSource() },
      }
      const imported = await runtime.importPromptResource({
        artifact: {
          format: 'loom.promptResource',
          schemaVersion: 2,
          resourceKind: 'preset',
          rootNode: { id: 'preset-root', label: 'Preset', kind: 'module' },
          scriptAttachments: [attachment],
        },
      })
      const mounts = await runtime.listLoomScriptMounts({ target: { kind: 'preset', presetId: imported.resource.id } })
      expect(mounts.mounts).toMatchObject([{ enabled: false, grantedCapabilities: [], orderIndex: 2 }])

      const exported = await runtime.exportPromptResource({ resourceId: imported.resource.id })
      expect(exported.artifact).toMatchObject({ schemaVersion: 2, scriptAttachments: [attachment] })
    } finally {
      await rm(rootDirectory, { recursive: true, force: true })
    }
  })
})

function loomScriptSource(): string {
  return [
    '// ==LoomScript==',
    '// @format       1',
    '// @id           alice.presentation',
    '// @name         Alice UI',
    '// @version      1.0.0',
    '// @runtime      client-sandbox',
    '// @contribution {"kind":"renderer","id":"status-panel","surface":"narrative.entry.inline","scope":"node","inputs":["match:alice.status"]}',
    '// ==/LoomScript==',
    'export const renderers = {}',
  ].join('\n')
}

function createArtifact(): CardBundleArtifact {
  return {
    schemaVersion: 2,
    artifactId: 'test-card-bundle-v0',
    displayName: 'Test Card Bundle',
    card: {
      name: 'Test Card',
      preset: { system: 'Bundle system prompt.' },
      settingLayer: {
        entries: [{
          id: 'bundle-setting',
          content: 'Bundle setting content.',
          activation: { kind: 'always' },
        }],
      },
    },
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
          capabilities: { targetAnchorId: 'preset.system' },
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

function createPayload(): NonNullable<CardBundleArtifact['extensionPayloads']>[number] {
  return {
    id: 'payload-v1',
    packageId: 'example.extension',
    fileName: 'config.json',
    format: 'example.config',
    mediaType: 'application/json',
    content: '{}',
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

function createFixture() {
  let sequence = 0
  const createId = (prefix: string) => `${prefix}-${++sequence}`
  const now = () => '2026-06-22T00:00:00.000Z'
  const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
  const documents = createSqliteDocumentStore({ engine })
  const promptResources = createPromptResourceStore({ engine, createId, now })
  return { dataEngine: engine, engine, documents, promptResources }
}
