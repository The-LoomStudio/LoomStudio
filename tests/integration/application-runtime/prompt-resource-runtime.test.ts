import { createApplicationRuntime, composeAgentTurnPrompt, createVariableRenderContext, createOfficialAgentToolRegistry } from '../../../packages/application-runtime/src/index.js'
import { createSqliteDataEngine } from '../../../packages/data-engine/src/index.js'
import { createSqliteDocumentStore } from '../../../packages/document-store/src/index.js'
import { createAgentStore, createNarrativeStore, createPromptResourceStore } from '../../../packages/application-data/src/index.js'
import { officialFakeModelId } from '@loom-studio/ai-gateway'
import { readFile } from 'node:fs/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { CardBundleArtifact } from '../../../packages/application-runtime/src/cards/workspace.js'
import { toStoredResourceInput } from '../../../packages/application-runtime/src/prompt/prompt-resource-mapper.js'

function createIds() {
  let sequence = 0
  return (prefix: string) => `${prefix}-${++sequence}`
}

describe('Prompt Resource Store application runtime', () => {
  it('reads only live Card binding summaries and filtered Mounts without reading resource trees', async () => {
    const createId = createIds()
    const now = () => '2026-10-02T00:00:00.000Z'
    const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
    try {
      const documents = createSqliteDocumentStore({ engine })
      const promptResources = createPromptResourceStore({ engine, createId })
      const runtime = createApplicationRuntime({ dataEngine: engine, documents, promptResources })
      const { resource } = await runtime.createPromptResource({ resourceKind: 'setting', name: 'Target' })
      const { resource: unrelated } = await runtime.createPromptResource({ resourceKind: 'setting', name: 'Unrelated' })
      const { card } = await runtime.createCard({ name: 'Bound' })
      await runtime.updateCardPromptResources({ cardId: card.id, promptResourceIds: [resource.id] })
      const { card: deleted } = await runtime.createCard({ name: 'Deleted' })
      await runtime.updateCardPromptResources({ cardId: deleted.id, promptResourceIds: [resource.id] })
      await runtime.deleteCard({ cardId: deleted.id })
      for (let index = 0; index < 110; index++) {
        await runtime.createCard({ name: `Unrelated ${index}`, description: 'Unrelated body'.repeat(100) })
      }
      await runtime.replaceSettingMounts({ source: { kind: 'manual', id: 'global' }, settingResourceIds: [resource.id, unrelated.id] })
      const mounts = vi.spyOn(promptResources, 'listSettingMounts')
      const reads = [
        vi.spyOn(promptResources, 'getResource').mockRejectedValue(new Error('Full resource read forbidden')),
        vi.spyOn(documents, 'list').mockRejectedValue(new Error('Full document list forbidden')),
      ]
      try {
        const bindings = await runtime.getPromptResourceBindings({ resourceId: resource.id })
        expect(bindings.cards).toEqual([{ id: card.id, name: 'Bound' }])
        expect(bindings.settingMounts).toHaveLength(1)
        expect(bindings.settingMounts[0]?.settingResourceId).toBe(resource.id)
        expect(mounts).toHaveBeenCalledWith({ settingResourceId: resource.id })
        for (const read of reads) expect(read).not.toHaveBeenCalled()
      } finally {
        for (const read of reads) read.mockRestore()
        mounts.mockRestore()
      }
      await runtime.deletePromptResource({ resourceId: resource.id })
      await expect(runtime.getPromptResourceBindings({ resourceId: resource.id })).rejects.toThrow('Prompt resource not found')
      await expect(runtime.getPromptResourceBindings({ resourceId: 'missing' })).rejects.toThrow('Prompt resource not found')
    } finally { await engine.close() }
  })

  it('persists newly created children before the first preset or setting sibling', async () => {
    const createId = createIds()
    const now = () => '2026-09-29T00:00:00.000Z'
    const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
    try {
      const promptResources = createPromptResourceStore({ engine, createId, now })
      const runtime = createApplicationRuntime({
        dataEngine: engine, documents: createSqliteDocumentStore({ engine }), promptResources,
      })
      for (const resourceKind of ['preset', 'setting'] as const) {
        const { resource } = await runtime.createPromptResource({ resourceKind, name: resourceKind })
        const first = resource.rootNode.children?.[0]
          ?? (await runtime.createPromptResourceAsset({
            resourceId: resource.id, targetAssetId: resource.rootNode.id, position: 'inside',
            asset: { id: `${resourceKind}-first`, kind: 'entry', label: 'First' },
          })).resource.rootNode.children![0]!
        await runtime.createPromptResourceAsset({
          resourceId: resource.id, targetAssetId: first.id, position: 'before',
          asset: { id: `${resourceKind}-new-folder`, kind: 'folder', label: 'New Folder', children: [] },
        })
        const reloaded = await runtime.getPromptResource({ resourceId: resource.id })
        expect(reloaded.resource.rootNode.children?.slice(0, 2).map(node => node.id))
          .toEqual([`${resourceKind}-new-folder`, first.id])
      }
    } finally {
      await engine.close()
    }
  })

  it('imports a preset and its tool mounts atomically without leaving a resource after mount failure', async () => {
    const createId = createIds()
    const now = () => '2026-09-27T00:00:00.000Z'
    const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
    try {
      const promptResources = createPromptResourceStore({ engine, createId, now })
      const runtime = createApplicationRuntime({
        dataEngine: engine, documents: createSqliteDocumentStore({ engine }), promptResources,
        agentTools: createOfficialAgentToolRegistry(),
      })
      const artifact = {
        format: 'loom.promptResource' as const, schemaVersion: 2 as const, resourceKind: 'preset' as const,
        rootNode: {
          id: 'root', kind: 'module' as const, label: 'Imported',
          orderList: ['second', '@external', 'first'],
          children: [
            { id: 'first', kind: 'entry' as const, label: 'First', body: 'First' },
            { id: 'second', kind: 'entry' as const, label: 'Second', body: 'Second' },
          ],
        },
      }
      const transaction = promptResources.transaction.bind(promptResources)
      const failure = vi.spyOn(promptResources, 'transaction').mockImplementation(tx => ({
        ...transaction(tx),
        addPresetToolMount: () => { throw new Error('Mount write failed') },
      }))
      await expect(runtime.importPromptResource({ artifact })).rejects.toThrow('Mount write failed')
      expect((await promptResources.listResources()).resources).toEqual([])
      expect(await promptResources.listPresetToolMounts({})).toEqual([])
      failure.mockRestore()
      const imported = await runtime.importPromptResource({ artifact })
      expect(await promptResources.listPresetToolMounts({ presetResourceId: imported.resource.id })).not.toEqual([])
      expect(imported.mutation?.changesetId).toBeTruthy()
      const root = imported.resource.rootNode
      expect(root.children?.map(child => child.id)).not.toEqual(['first', 'second'])
      expect(root.orderList).toEqual([root.children![1]!.id, '@external', root.children![0]!.id])
      expect(artifact.rootNode.orderList).toEqual(['second', '@external', 'first'])
    } finally {
      await engine.close()
    }
  })

  it('persists Agent configuration on the preset but excludes local bindings from prompt exports', async () => {
    const createId = createIds()
    const now = () => '2026-09-27T00:00:00.000Z'
    const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
    try {
      const promptResources = createPromptResourceStore({ engine, createId, now })
      const runtime = createApplicationRuntime({
        dataEngine: engine, documents: createSqliteDocumentStore({ engine }), promptResources,
      })
      const model = { providerProfileId: 'local-provider', modelId: 'local-model' }
      const { resource: stored } = await promptResources.createResource({
        ...toStoredResourceInput({
          content: {
            resourceKind: 'preset',
            rootNode: { id: 'agent-root', kind: 'module', label: 'Writer' },
            model, delivery: 'complete', historyPolicy: 'persistent',
            createdAt: now(), updatedAt: now(),
          },
        }),
        actor: { kind: 'system', id: 'test' },
        reason: 'test.agent-preset',
      })
      const { resource } = await runtime.getPromptResource({ resourceId: stored.id })
      expect(resource).toMatchObject({ id: stored.id, model, delivery: 'complete' })
      expect((await runtime.listPromptResources({ resourceKind: 'preset' })).resources)
        .toContainEqual(resource)
      const { artifact } = await runtime.exportPromptResource({ resourceId: stored.id })
      expect(artifact.rootNode).toEqual(resource.rootNode)
      expect(artifact).not.toHaveProperty('model')
      expect(artifact).not.toHaveProperty('delivery')
    } finally {
      await engine.close()
    }
  })

  it('follows the current Card Settings in an existing Timeline without rewriting State or history', async () => {
    const createId = createIds()
    const now = () => '2026-09-26T00:00:00.000Z'
    const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
    try {
      const narratives = createNarrativeStore({ engine, createId, now })
      const runtime = createApplicationRuntime({
        dataEngine: engine, documents: createSqliteDocumentStore({ engine }),
        narratives, agents: createAgentStore({ engine, createId, now }),
        promptResources: createPromptResourceStore({ engine, createId, now }),
      })
      const settings = []
      for (const label of ['OLD_SETTING', 'NEW_SETTING']) {
        const { resource } = await runtime.createPromptResource({ resourceKind: 'setting', name: label })
        await runtime.createPromptResourceAsset({
          resourceId: resource.id, targetAssetId: resource.rootNode.id, position: 'inside',
          asset: { id: `${resource.id}.body`, kind: 'entry', label, body: label, capabilities: { targetAnchorId: '@chat.system' } },
        })
        settings.push(resource.id)
      }
      const { card } = await runtime.createCard({ name: 'Updating card' })
      await runtime.updateCardPromptResources({ cardId: card.id, promptResourceIds: [settings[0]!] })
      const { timeline, branch } = await runtime.createNarrativeTimeline({ cardId: card.id, openingNodes: [{ content: 'Keep original story' }] })
      const { resource: preset } = await runtime.createPromptResource({ resourceKind: 'preset', name: 'Reader' })
      const { providerProfile } = await runtime.createProviderProfile({
        providerExtensionId: 'official.fake', displayName: 'Test', config: {}, enabledModelIds: [officialFakeModelId],
      })
      const { agentPreset } = await runtime.updateAgentPreset({
        name: 'Reader', agentPresetId: preset.id, expectedVersion: (await runtime.getPromptResource({ resourceId: preset.id })).resource.version, model: { providerProfileId: providerProfile.id, modelId: officialFakeModelId },
      })
      const { session } = await runtime.createAgentSession({ agentPresetId: agentPreset.id, timelineId: timeline.id })
      const target = { scope: 'timeline' as const, timelineId: timeline.id, branchId: branch.id }
      const state = await runtime.getStateSnapshot({ target })
      const history = await narratives.getPage({ timelineId: timeline.id, branchId: branch.id, limit: 10 })
      const preview = () => runtime.previewAgentTurn({ agentSessionId: session.id, input: 'Continue' })
      expect(JSON.stringify((await preview()).messages)).toContain('OLD_SETTING')
      await runtime.updateCardPromptResources({ cardId: card.id, promptResourceIds: [settings[1]!] })
      const updated = JSON.stringify((await preview()).messages)
      expect(updated).toContain('NEW_SETTING')
      expect(updated).not.toContain('OLD_SETTING')
      await runtime.deletePromptResource({ resourceId: settings[1]! })
      const deleted = await preview()
      expect(JSON.stringify(deleted.messages)).not.toContain('NEW_SETTING')
      expect(JSON.stringify(deleted.messages)).not.toContain('OLD_SETTING')
      expect(deleted.promptBuildTrace.diagnostics).toContainEqual(expect.objectContaining({
        code: 'prompt.resource_missing', resourceId: settings[1],
      }))
      expect(await runtime.getStateSnapshot({ target })).toEqual(state)
      expect(await narratives.getPage({ timelineId: timeline.id, branchId: branch.id, limit: 10 })).toEqual(history)
    } finally {
      await engine.close()
    }
  })

  it('preserves unresolved macros and their diagnostic paths in the composed prompt', async () => {
    const createId = createIds()
    const now = () => '2026-09-24T00:00:00.000Z'
    const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
    try {
      const documents = createSqliteDocumentStore({ engine })
      const promptResources = createPromptResourceStore({ engine, createId, now })
      const runtime = createApplicationRuntime({ dataEngine: engine, documents, promptResources })
      const { resource: preset } = await runtime.createPromptResource({ resourceKind: 'preset', name: 'Macro boundary' })
      const body = 'Keep {{global.missing}}; available={{global.name}}.'
      const { resource } = await runtime.createPromptResourceAsset({
        resourceId: preset.id,
        targetAssetId: preset.rootNode.id,
        position: 'inside',
        asset: { id: 'macro-entry', kind: 'entry', label: 'Macro entry', body },
      })
      const result = await composeAgentTurnPrompt({
        promptResources,
        contextResourceIds: [],
        preset: resource,
        agentMessages: [],
        userInput: 'Continue',
        variables: createVariableRenderContext({ global: { name: 'Alice' } }),
      })
      expect(result.messages).toContainEqual(expect.objectContaining({
        content: 'Keep {{global.missing}}; available=Alice.',
      }))
      expect(result.promptBuildTrace.variables?.diagnostics).toContainEqual({
        severity: 'warning', code: 'variable.path_missing', path: 'global.missing',
      })
      expect((await runtime.getPromptResource({ resourceId: resource.id })).resource).toEqual(resource)
      expect(result.promptBuildTrace.status).toBe('ok')
    } finally {
      engine.close()
    }
  })

  it('warns for a deleted optional setting without hiding preset or storage failures', async () => {
    const createId = createIds()
    const now = () => '2026-09-23T00:00:00.000Z'
    const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
    try {
      const documents = createSqliteDocumentStore({ engine })
      const promptResources = createPromptResourceStore({ engine, createId, now })
      const runtime = createApplicationRuntime({ dataEngine: engine, documents, promptResources })
      const { resource: preset } = await runtime.createPromptResource({ resourceKind: 'preset', name: 'Preset' })
      const { resource: setting } = await runtime.createPromptResource({ resourceKind: 'setting', name: 'Setting' })
      await runtime.replaceSettingMounts({ source: { kind: 'preset', id: preset.id }, settingResourceIds: [setting.id] })
      const mounts = await promptResources.listSettingMounts()
      await runtime.deletePromptResource({ resourceId: setting.id })
      expect(await promptResources.getResource(setting.id)).toBeNull()
      const input = { promptResources, preset, contextResourceIds: [], agentMessages: [], userInput: 'Hi' }
      const result = await composeAgentTurnPrompt(input)
      expect(result.messages).toContainEqual(expect.objectContaining({ role: 'user', content: 'Hi' }))
      expect(result.promptBuildTrace.diagnostics).toContainEqual(expect.objectContaining({
        severity: 'warning', code: 'prompt.resource_missing', resourceId: setting.id,
      }))
      expect(result.toolExecutionScope.vfsResourceIds).not.toContain(setting.id)
      expect(await promptResources.listSettingMounts()).toEqual(mounts)
      await runtime.deletePromptResource({ resourceId: preset.id })
      await expect(composeAgentTurnPrompt(input)).rejects.toThrow(`Prompt resource not found: ${preset.id}`)
      vi.spyOn(promptResources, 'getResource').mockRejectedValue(new Error('storage unavailable'))
      await expect(composeAgentTurnPrompt(input)).rejects.toThrow('storage unavailable')
    } finally {
      engine.close()
    }
  })

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
      contextResourceIds: [],
      preset: (await runtime.getPromptResource({ resourceId: preset.resource.id })).resource,
      agentMessages: [],
      userInput: 'Hi',
      externalRuntime: {
        sourceNodes: [
          { id: 'tools-root', sourceId: 'tools', parentId: null, displayName: 'Tools', orderIndex: 0, kind: 'module' },
          { id: 'tool-a', sourceId: 'tools', parentId: 'tools-root', displayName: 'Tool A', orderIndex: 1, kind: 'entry' },
          { id: 'tool-b', sourceId: 'tools', parentId: 'tools-root', displayName: 'Tool B', orderIndex: 2, kind: 'entry' },
        ],
        contributions: [
          {
            id: 'tool-a-content',
            sourceRef: { kind: 'runtime', sourceId: 'tools', sourceNodeId: 'tool-a' },
            content: 'Tool A instructions.',
            capabilities: {
              targetAnchorId: '@chat.tools', localDepth: 20,
            },
          },
          {
            id: 'tool-b-content',
            sourceRef: { kind: 'runtime', sourceId: 'tools', sourceNodeId: 'tool-b' },
            content: 'Tool B instructions.',
            capabilities: {
              targetAnchorId: '@chat.tools', localDepth: 10,
            },
          },
        ],
      },
    })

    expect(result.projection.messages.find(msg => msg.fragmentIds.includes('tool-a-content'))?.fragmentIds).toEqual([
      'tool-b-content',
      'tool-a-content',
    ])
    expect(result.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'system', content: 'Tool B instructions.\n\nTool A instructions.' }),
      expect.objectContaining({ role: 'user', content: 'Hi' }),
    ]))
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
      contextResourceIds: [],
      preset: (
        await runtime.getPromptResource({ resourceId: preset.resource.id })
      ).resource,
      agentMessages: [],
      userInput: 'Hi',
      variables: createVariableRenderContext({ global: { user: { name: 'Mio' } } }),
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
    expect(readPreset.resource.rootNode).toEqual(preset.resource.rootNode)
    expect((await secondRuntime.getPromptResource({ resourceId: setting.resource.id })).resource.rootNode.children?.[0]?.body).toBe('Persisted body')
    secondEngine.close()
    await rm(directory, { recursive: true, force: true })
  })

  it('uses explicit preset mounts without automatically including global mounts', async () => {
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
        asset: { id: `${resource.resource.id}.entry`, kind: 'entry', label: body, body, capabilities: { targetAnchorId: '@chat.system' } },
      })
    }
    const presetA = await runtime.createPromptResource({ resourceKind: 'preset', name: 'Preset A' })
    const presetB = await runtime.createPromptResource({ resourceKind: 'preset', name: 'Preset B' })
    await runtime.replaceSettingMounts({ source: { kind: 'manual', id: 'global' }, settingResourceIds: [settingA.resource.id] })
    await runtime.replaceSettingMounts({ source: { kind: 'preset', id: presetB.resource.id }, settingResourceIds: [settingB.resource.id] })
    const promptA = await composeAgentTurnPrompt({ promptResources, contextResourceIds: [], preset: (await runtime.getPromptResource({ resourceId: presetA.resource.id })).resource, agentMessages: [], userInput: 'Hi' })
    const promptB = await composeAgentTurnPrompt({ promptResources, contextResourceIds: [], preset: (await runtime.getPromptResource({ resourceId: presetB.resource.id })).resource, agentMessages: [], userInput: 'Hi' })
    expect(promptA.messages.some(message => typeof message.content === 'string' && message.content.includes('A only'))).toBe(false)
    expect(promptA.messages.some(message => typeof message.content === 'string' && message.content.includes('B only'))).toBe(false)
    expect(promptB.messages.some(message => typeof message.content === 'string' && message.content.includes('A only'))).toBe(false)
    expect(promptB.messages.some(message => typeof message.content === 'string' && message.content.includes('B only'))).toBe(true)
    engine.close()
  })

  it('can exclude default card Settings while keeping an explicit preset mount', async () => {
    const createId = createIds()
    const now = () => '2026-08-19T00:00:00.000Z'
    const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
    try {
      const documents = createSqliteDocumentStore({ engine })
      const promptResources = createPromptResourceStore({ engine, createId, now })
      const runtime = createApplicationRuntime({
        dataEngine: engine, documents, promptResources,
        agents: createAgentStore({ engine, createId, now }),
        narratives: createNarrativeStore({ engine, createId, now }),
      })
      const preset = await runtime.createPromptResource({ resourceKind: 'preset', name: 'Preset' })
      const setting = await runtime.createPromptResource({ resourceKind: 'setting', name: 'Setting' })
      const cardSetting = await runtime.createPromptResource({ resourceKind: 'setting', name: 'Card Setting' })
      await runtime.createPromptResourceAsset({
        resourceId: cardSetting.resource.id, targetAssetId: cardSetting.resource.rootNode.id, position: 'inside',
        asset: { id: 'card-setting-entry', kind: 'entry', label: 'Card Setting', body: 'CARD_DEFAULT_MARKER', capabilities: { targetAnchorId: '@chat.system' } },
      })
      const { card } = await runtime.createCard({ name: 'Role' })
      await runtime.updateCardPromptResources({ cardId: card.id, promptResourceIds: [cardSetting.resource.id] })
      const { timeline } = await runtime.createNarrativeTimeline({ cardId: card.id })
      const { providerProfile } = await runtime.createProviderProfile({
        providerExtensionId: 'official.fake', displayName: 'Test', config: {}, enabledModelIds: [officialFakeModelId],
      })
      await runtime.replaceSettingMounts({ source: { kind: 'preset', id: preset.resource.id }, settingResourceIds: [setting.resource.id] })
      const current = (await runtime.getAgentPreset({ agentPresetId: preset.resource.id })).agentPreset
      await runtime.updateAgentPreset({
        agentPresetId: current.id, expectedVersion: current.version, useCardSettings: false,
        model: { providerProfileId: providerProfile.id, modelId: officialFakeModelId },
      })
      expect((await runtime.getAgentPreset({ agentPresetId: current.id })).agentPreset.useCardSettings).toBe(false)
      expect((await promptResources.listSettingMounts({ source: { kind: 'preset', id: current.id } })).map(mount => mount.settingResourceId)).toEqual([setting.resource.id])
      const { session } = await runtime.createAgentSession({ agentPresetId: current.id, timelineId: timeline.id })
      expect(JSON.stringify((await runtime.previewAgentTurn({ agentSessionId: session.id, input: 'Hi' })).messages))
        .not.toContain('CARD_DEFAULT_MARKER')
    } finally { engine.close() }
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
    expect(imported.card.promptResourceIds).toBeDefined()
    const resources = await Promise.all(imported.card.promptResourceIds!.map(async resourceId => (
      await runtime.getPromptResource({ resourceId })
    ).resource))
    expect(resources.length).toBeGreaterThan(0)
    const exported = await runtime.exportCardBundle({ cardId: imported.card.id })
    expect(exported.artifact.contextAssets.map(node => node.id)).toEqual(artifact.contextAssets.map(node => node.id))

    const promptExport = await runtime.exportPromptResource({ resourceId: resources[0]!.id })
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
