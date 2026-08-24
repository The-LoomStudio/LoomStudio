import { createApplicationRuntime, composeAgentTurnPrompt } from '../../../packages/application-runtime/src/index.js'
import { createSqliteDataEngine } from '../../../packages/data-engine/src/index.js'
import { createSqliteDocumentStore } from '../../../packages/document-store/src/index.js'
import { createPromptResourceStore } from '../../../packages/prompt-resource-store/src/index.js'
import { readFile } from 'node:fs/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { CardBundleArtifact } from '../../../packages/application-runtime/src/workspace.js'

function createIds() {
  let sequence = 0
  return (prefix: string) => `${prefix}-${++sequence}`
}

describe('Prompt Resource Store application runtime', () => {
  it('projects external Content Tool slots through Prompt Build ordering', async () => {
    const createId = createIds()
    const now = () => '2026-08-24T00:00:00.000Z'
    const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
    const documents = createSqliteDocumentStore({ engine })
    const promptResources = createPromptResourceStore({ engine, createId, now })
    const runtime = createApplicationRuntime({ dataEngine: engine, documents, promptResources })
    const preset = await runtime.createPromptResource({
      resourceKind: 'preset',
      name: 'Tool Projection Preset',
    })
    const result = await composeAgentTurnPrompt({
      promptResources,
      preset: (await runtime.getPromptResource({ resourceId: preset.resource.id })).resource,
      agentMessages: [],
      userInput: 'Hi',
      externalRuntime: {
        sourceNodes: [
          { id: 'tools-root', sourceId: 'tools', parentId: null, displayName: 'Tools', orderIndex: 0 },
          { id: 'tool-a', sourceId: 'tools', parentId: 'tools-root', displayName: 'Tool A', orderIndex: 1 },
          { id: 'tool-b', sourceId: 'tools', parentId: 'tools-root', displayName: 'Tool B', orderIndex: 2 },
        ],
        contributions: [
          {
            id: 'tool-a-content',
            sourceRef: { kind: 'runtime', sourceId: 'tools', sourceNodeId: 'tool-a' },
            content: 'Tool A instructions.',
            capabilities: {
              projection: { zoneId: 'tools', joinSlotKey: 'tool-a-slot' },
              lifecycle: { lifecycle: 'always' },
            },
          },
          {
            id: 'tool-b-content',
            sourceRef: { kind: 'runtime', sourceId: 'tools', sourceNodeId: 'tool-b' },
            content: 'Tool B instructions.',
            capabilities: {
              projection: { zoneId: 'tools', joinSlotKey: 'tool-b-slot' },
              lifecycle: { lifecycle: 'always' },
            },
          },
        ],
        slotRanks: [
          { zoneId: 'tools', slotKey: 'tool-a-slot', rankKey: '20' },
          { zoneId: 'tools', slotKey: 'tool-b-slot', rankKey: '10' },
        ],
      },
    })

    expect(result.projection.zones.find(zone => zone.zoneId === 'tools')?.slots.map(slot => slot.slotKey)).toEqual([
      'tool-b-slot',
      'tool-a-slot',
    ])
    expect(result.messages).toEqual([
      { role: 'system', content: 'Tool B instructions.\n\nTool A instructions.' },
      { role: 'user', content: 'Hi' },
    ])
    engine.close()
  })

  it('uses the supplied Agent Turn User macro context', async () => {
    const createId = createIds()
    const now = () => '2026-08-23T00:00:00.000Z'
    const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
    const documents = createSqliteDocumentStore({ engine })
    const promptResources = createPromptResourceStore({ engine, createId, now })
    const runtime = createApplicationRuntime({
      dataEngine: engine,
      documents,
      promptResources,
    })
    const preset = await runtime.createPromptResource({
      resourceKind: 'preset',
      name: 'Macro Preset',
    })
    await runtime.createPromptResourceAsset({
      resourceId: preset.resource.id,
      targetAssetId: preset.resource.rootNode.id,
      position: 'inside',
      asset: {
        id: 'macro-entry',
        kind: 'entry',
        label: 'Macro',
        body: 'Current user is {{User}}.',
      },
    })

    const result = await composeAgentTurnPrompt({
      promptResources,
      preset: (
        await runtime.getPromptResource({ resourceId: preset.resource.id })
      ).resource,
      agentMessages: [],
      userInput: 'Hi',
      macroContext: { user: 'Mio' },
    })

    expect(result.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ content: expect.stringContaining('Mio') }),
      ]),
    )
    expect(JSON.stringify(result.messages)).not.toContain('{{User}}')
    engine.close()
  })

  it('persists Runtime resources, nodes and mounts across engine restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'loom-prompt-resource-'))
    const filename = join(directory, 'studio.sqlite')
    const createId = createIds()
    const now = () => '2026-08-19T00:00:00.000Z'
    const firstEngine = createSqliteDataEngine({ filename, createId, now })
    const firstDocuments = createSqliteDocumentStore({ engine: firstEngine })
    const firstStore = createPromptResourceStore({ engine: firstEngine, createId, now })
    const firstRuntime = createApplicationRuntime({ dataEngine: firstEngine, documents: firstDocuments, promptResources: firstStore })
    const setting = await firstRuntime.createPromptResource({ resourceKind: 'setting', name: 'Persisted Setting' })
    await firstRuntime.createPromptResourceAsset({
      resourceId: setting.resource.id,
      targetAssetId: setting.resource.rootNode.id,
      position: 'inside',
      asset: { id: 'persisted-entry', kind: 'entry', label: 'Entry', body: 'Persisted body' },
    })
    const preset = await firstRuntime.createPromptResource({ resourceKind: 'preset', name: 'Persisted Preset' })
    await firstRuntime.replaceSettingMounts({ source: { kind: 'preset', id: preset.resource.id }, settingResourceIds: [setting.resource.id] })
    firstEngine.close()

    const secondEngine = createSqliteDataEngine({ filename, createId, now })
    const secondDocuments = createSqliteDocumentStore({ engine: secondEngine })
    const secondStore = createPromptResourceStore({ engine: secondEngine, createId, now })
    const secondRuntime = createApplicationRuntime({ dataEngine: secondEngine, documents: secondDocuments, promptResources: secondStore })
    const readPreset = await secondRuntime.getPromptResource({ resourceId: preset.resource.id })
    await expect(secondRuntime.listSettingMounts({ source: { kind: 'preset', id: preset.resource.id } })).resolves.toMatchObject({ mounts: [{ settingResourceId: setting.resource.id, source: { kind: 'preset', id: preset.resource.id } }] })
    expect(readPreset.resource.rootNode.children?.[0]?.label).toBe('主排序')
    expect((await secondRuntime.getPromptResource({ resourceId: setting.resource.id })).resource.rootNode.children?.[0]?.body).toBe('Persisted body')
    secondEngine.close()
    await rm(directory, { recursive: true, force: true })
  })

  it('resolves manual and preset mounts without cross-preset leakage', async () => {
    const createId = createIds()
    const now = () => '2026-08-19T00:00:00.000Z'
    const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
    const documents = createSqliteDocumentStore({ engine })
    const promptResources = createPromptResourceStore({ engine, createId, now })
    const runtime = createApplicationRuntime({ dataEngine: engine, documents, promptResources })
    const settingA = await runtime.createPromptResource({ resourceKind: 'setting', name: 'Setting A' })
    const settingB = await runtime.createPromptResource({ resourceKind: 'setting', name: 'Setting B' })
    for (const [resource, body] of [[settingA, 'A only'], [settingB, 'B only']] as const) {
      await runtime.createPromptResourceAsset({
        resourceId: resource.resource.id,
        targetAssetId: resource.resource.rootNode.id,
        position: 'inside',
        asset: { id: `${resource.resource.id}.entry`, kind: 'entry', label: body, body },
      })
    }
    const presetA = await runtime.createPromptResource({ resourceKind: 'preset', name: 'Preset A' })
    const presetB = await runtime.createPromptResource({ resourceKind: 'preset', name: 'Preset B' })
    await runtime.replaceSettingMounts({ source: { kind: 'preset', id: presetA.resource.id }, settingResourceIds: [settingA.resource.id] })
    await runtime.replaceSettingMounts({ source: { kind: 'preset', id: presetB.resource.id }, settingResourceIds: [settingB.resource.id] })
    const promptA = await composeAgentTurnPrompt({ promptResources, preset: (await runtime.getPromptResource({ resourceId: presetA.resource.id })).resource, agentMessages: [], userInput: 'Hi' })
    const promptB = await composeAgentTurnPrompt({ promptResources, preset: (await runtime.getPromptResource({ resourceId: presetB.resource.id })).resource, agentMessages: [], userInput: 'Hi' })
    expect(promptA.messages.some(message => 'content' in message && message.content.includes('A only'))).toBe(true)
    expect(promptA.messages.some(message => 'content' in message && message.content.includes('B only'))).toBe(false)
    expect(promptB.messages.some(message => 'content' in message && message.content.includes('B only'))).toBe(true)
    expect(promptB.messages.some(message => 'content' in message && message.content.includes('A only'))).toBe(false)
    engine.close()
  })

  it('imports and exports resources and Card bundles without writing Resource Documents', async () => {
    const createId = createIds()
    const now = () => '2026-08-19T00:00:00.000Z'
    const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
    const documents = createSqliteDocumentStore({ engine })
    const promptResources = createPromptResourceStore({ engine, createId, now })
    const runtime = createApplicationRuntime({ dataEngine: engine, documents, promptResources })
    const artifact = JSON.parse(await readFile(join(process.cwd(), 'packages/application-runtime/fixtures/workspaces/loom-city-v0.json'), 'utf8')) as CardBundleArtifact
    const imported = await runtime.importCardBundle({ artifact })
    expect((await documents.list({ type: 'airp.promptResource' })).items).toHaveLength(0)
    const resources = await runtime.listCardPromptResources({ cardId: imported.card.id })
    expect(resources.resources.length).toBeGreaterThan(0)
    const exported = await runtime.exportCardArtifact({ cardId: imported.card.id })
    expect(exported.artifact.contextAssets.map(node => node.id)).toEqual(artifact.contextAssets.map(node => node.id))

    const promptExport = await runtime.exportPromptResource({ resourceId: resources.resources[0]!.id })
    const promptImport = await runtime.importPromptResource({ artifact: promptExport.artifact })
    expect(promptImport.resource.rootNode.label).toBe(promptExport.artifact.rootNode.label)
    expect(promptImport.resource.rootNode.children?.map(node => node.label)).toEqual(promptExport.artifact.rootNode.children?.map(node => node.label))

    const legacy = await runtime.createPromptResource({ resourceKind: 'setting', name: 'Legacy Extra' })
    await runtime.createPromptResourceAsset({
      resourceId: legacy.resource.id,
      targetAssetId: legacy.resource.rootNode.id,
      position: 'inside',
      asset: {
        id: 'legacy-extra-entry',
        kind: 'entry',
        label: 'Legacy',
        body: 'Legacy body',
        configRows: [{ label: 'mode', value: 'stable' }],
        isSection: true,
        extra: { communityField: { preserved: true } },
      },
    })
    const legacyExport = await runtime.exportPromptResource({ resourceId: legacy.resource.id })
    const legacyImport = await runtime.importPromptResource({ artifact: legacyExport.artifact })
    expect(legacyImport.resource.rootNode.children?.[0]).toMatchObject({
      configRows: [{ label: 'mode', value: 'stable' }],
      isSection: true,
      extra: { communityField: { preserved: true } },
    })
    engine.close()
  })
})
