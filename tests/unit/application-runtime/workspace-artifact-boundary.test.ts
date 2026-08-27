import {
  createApplicationRuntime,
  createVariableRenderContext,
  exportCardArtifact,
  getImportBundle,
  importCardBundle,
  isCardBundleArtifact,
  readPromptResourceInputs,
  type CardBundleArtifact,
} from '@loom-studio/application-runtime'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createPromptResourceStore } from '@loom-studio/prompt-resource-store'
import { describe, expect, it } from 'vitest'

describe('card bundle artifact boundary', () => {
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
    await expect(getImportBundle({ documents: fixture.documents, importBundleId: imported.importBundle.id })).resolves.toEqual(imported.importBundle)
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
})

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

function createFixture() {
  let sequence = 0
  const createId = (prefix: string) => `${prefix}-${++sequence}`
  const now = () => '2026-06-22T00:00:00.000Z'
  const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
  const documents = createSqliteDocumentStore({ engine })
  const promptResources = createPromptResourceStore({ engine, createId, now })
  return { dataEngine: engine, engine, documents, promptResources }
}
