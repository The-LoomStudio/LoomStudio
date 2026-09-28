import { describe, expect, it } from 'vitest'
import { officialFakeModelId } from '@loom-studio/ai-gateway'
import { callRpc, withStudioServer } from './helpers.js'

describe('studio server Agent Turn RPC', () => {
  it('appends idempotent input then delivers persisted raw text without implicit Narrative output', async () => {
    await withStudioServer(async port => {
      const provider = await callRpc<{ providerProfile: { id: string } }>(port, 'application.createProviderProfile', {
        providerExtensionId: 'official.fake', displayName: 'Input Provider', config: {}, enabledModelIds: [officialFakeModelId],
      })
      const preset = await createPreset(port, 'Input Agent', 'Help.')
      const profile = await callRpc<{ agentPreset: { id: string } }>(port, 'application.updateAgentPreset', {
        name: 'Input Agent', agentPresetId: preset.id, expectedVersion: (await callRpc<{ resource: { version: number } }>(port, 'application.getPromptResource', { resourceId: preset.id })).resource.version, model: { providerProfileId: provider.providerProfile.id, modelId: officialFakeModelId },
      })
      const { session } = await callRpc<{ session: { id: string } }>(port, 'application.createAgentSession', { agentPresetId: profile.agentPreset.id })
      const { card } = await callRpc<{ card: { id: string } }>(port, 'application.createCard', { name: 'Input Story' })
      const { timeline, branch } = await callRpc<{ timeline: { id: string }; branch: { id: string } }>(port, 'application.createNarrativeTimeline', { cardId: card.id })
      const input = { timelineId: timeline.id, branchId: branch.id, nodeId: 'rpc-input', expectedHeadNodeId: null, content: 'Accepted raw.' }
      await expect(callRpc(port, 'application.appendNarrativeInput', { ...input, expectedHeadNodeId: 'stale' })).rejects.toThrow('head conflict')
      await expect(callRpc(port, 'application.getAgentTranscriptPage', { agentSessionId: session.id })).resolves.toMatchObject({ entries: [] })
      const appended = await callRpc(port, 'application.appendNarrativeInput', input)
      expect(await callRpc(port, 'application.appendNarrativeInput', input)).toEqual(appended)
      await expect(callRpc(port, 'application.appendNarrativeInput', { ...input, content: 'Conflict.' })).rejects.toThrow('node conflict')
      const target = { timelineId: timeline.id, branchId: branch.id, inputNodeId: input.nodeId }
      await expect(callRpc(port, 'application.previewAgentTurn', { agentSessionId: session.id, input: 'forged', narrativeTarget: { ...target, inputNodeId: 1 } })).rejects.toThrow('inputNodeId')
      await callRpc(port, 'application.previewAgentTurn', { agentSessionId: session.id, input: 'forged', narrativeTarget: target })
      await expect(callRpc(port, 'application.getAgentTranscriptPage', { agentSessionId: session.id })).resolves.toMatchObject({ entries: [] })
      const result = await callRpc(port, 'application.invokeAgentTurn', { agentSessionId: session.id, input: '', narrativeTarget: target })
      expect(result).toMatchObject({ entries: { user: { entry: { content: 'Accepted raw.' } } }, mutation: { scope: 'agent-session-transcript' } })
      expect(result).not.toHaveProperty('narrative')
      const page = await callRpc<{ nodes: Array<{ id: string }> }>(port, 'application.getNarrativePage', { timelineId: timeline.id })
      expect(page.nodes.map(node => node.id)).toEqual(['rpc-input'])
    })
  })

  it('manages Agent Presets with Preset Prompt Resources through RPC', async () => {
    await withStudioServer(async port => {
      const profile = await callRpc<{ providerProfile: { id: string } }>(port, 'application.createProviderProfile', {
        providerExtensionId: 'official.fake',
        displayName: 'Local Provider',
        config: {},
        enabledModelIds: [officialFakeModelId],
      })
      expect(JSON.stringify(profile)).not.toContain('secret:')
      const preset = await createPreset(port, 'Guide', 'Guide the user.')
      const setting = await callRpc<{ resource: { id: string } }>(port, 'application.createPromptResource', {
        resourceKind: 'setting',
        name: 'Guide Knowledge',
      })
      const updatedPreset = await callRpc<{ mounts: Array<{ settingResourceId: string }> }>(port, 'application.replaceSettingMounts', {
        source: { kind: 'preset', id: preset.id },
        settingResourceIds: [setting.resource.id],
      })
      const agentPreset = await callRpc<{ agentPreset: { id: string; version: number } }>(port, 'application.updateAgentPreset', {
        name: 'Local Guide',
        agentPresetId: preset.id, expectedVersion: (await callRpc<{ resource: { version: number } }>(port, 'application.getPromptResource', { resourceId: preset.id })).resource.version,
        model: { providerProfileId: profile.providerProfile.id, modelId: officialFakeModelId },
      })

      const toolMounts = await callRpc<{ mounts: Array<{ toolId: string }> }>(port, 'application.listPresetToolMounts', { presetId: preset.id })
      expect(toolMounts.mounts.length).toBeGreaterThan(0)
      expect(toolMounts.mounts.map(m => m.toolId)).toContain('official/search_context')

      const updatedProfile = await callRpc<{ agentPreset: { rootNode: { label: string } } }>(port, 'application.updateAgentPreset', {
        agentPresetId: agentPreset.agentPreset.id,
        expectedVersion: agentPreset.agentPreset.version,
        name: 'Updated Local Guide',
      })
      const presets = await callRpc<{ resources: Array<{ id: string }> }>(port, 'application.listPromptResources', { resourceKind: 'preset' })
      const profiles = await callRpc<{ agentPresets: Array<{ id: string }> }>(port, 'application.listAgentPresets', {})

      expect(updatedPreset.mounts.map(mount => mount.settingResourceId)).toEqual([setting.resource.id])
      expect(updatedProfile.agentPreset.rootNode.label).toBe('Updated Local Guide')
      expect(presets.resources.map(item => item.id)).toContain(preset.id)
      expect(profiles.agentPresets.map(item => item.id)).toContain(agentPreset.agentPreset.id)

      const card = await callRpc<{ card: { id: string } }>(port, 'application.createCard', { name: 'External references' })
      await callRpc(port, 'application.updateCardPromptResources', { cardId: card.card.id, promptResourceIds: [preset.id] })
      const timeline = await callRpc<{ timeline: { id: string } }>(port, 'application.createNarrativeTimeline', { cardId: card.card.id })
      const cardBefore = await callRpc(port, 'application.getCard', { cardId: card.card.id })
      const timelineBefore = await callRpc(port, 'application.getNarrativeTimeline', { timelineId: timeline.timeline.id })
      const profileBefore = await callRpc(port, 'application.getAgentPreset', { agentPresetId: agentPreset.agentPreset.id })
      expect(cardBefore).toMatchObject({ card: { promptResourceIds: [preset.id] } })
      expect(timelineBefore).toMatchObject({ timeline: { promptResourceIds: [preset.id] } })
      expect(profileBefore).toMatchObject({ agentPreset: { id: preset.id } })
      const session = await callRpc<{ session: { id: string } }>(port, 'application.createAgentSession', { agentPresetId: agentPreset.agentPreset.id })
      await callRpc(port, 'application.upsertTextTransformRule', {
        ruleId: 'owned-preset-rule',
        rule: {
          name: 'Owned rule', owner: { kind: 'preset', presetId: preset.id }, enabled: true, orderIndex: 0,
          matcher: { kind: 'regex', pattern: 'a', flags: 'g' }, effect: { kind: 'replace', replacement: 'b' },
          targets: ['agent-session'], phases: ['display'],
        },
      })

      const deletePresetResult = await callRpc<{ deleted: boolean; detachedReferences: Record<string, number> }>(port, 'application.deletePromptResource', { resourceId: preset.id })
      expect(deletePresetResult.deleted).toBe(true)
      expect(deletePresetResult.detachedReferences).toEqual({ presets: 0, cards: 0, timelines: 0 })
      await expect(callRpc(port, 'application.getPromptResource', { resourceId: preset.id })).rejects.toThrow('Prompt resource not found')
      await expect(callRpc(port, 'application.getAgentPreset', { agentPresetId: agentPreset.agentPreset.id })).rejects.toThrow('Prompt resource not found')
      await expect(callRpc(port, 'application.getCard', { cardId: card.card.id })).resolves.toEqual(cardBefore)
      await expect(callRpc(port, 'application.getNarrativeTimeline', { timelineId: timeline.timeline.id })).resolves.toEqual(timelineBefore)
      const remainingSettingMounts = await callRpc<{ mounts: Array<{ source: { kind: string; id: string } }> }>(port, 'application.listSettingMounts', {})
      expect(remainingSettingMounts.mounts.filter(mount => mount.source.kind === 'preset' && mount.source.id === preset.id)).toEqual([])
      await expect(callRpc(port, 'application.listPresetToolMounts', { presetId: preset.id })).resolves.toEqual({ mounts: [] })
      await expect(callRpc(port, 'application.listTextTransformRules', {})).resolves.toEqual({ rules: [] })
      await expect(callRpc(port, 'application.getPromptResource', { resourceId: setting.resource.id })).resolves.toMatchObject({ resource: { id: setting.resource.id } })
      for (const method of ['application.previewAgentTurn', 'application.invokeAgentTurn']) {
        await expect(callRpc(port, method, { agentSessionId: session.session.id, input: 'Continue.' }))
          .rejects.toThrow('Prompt resource not found')
      }
      await expect(callRpc(port, 'application.getAgentTranscriptPage', { agentSessionId: session.session.id })).resolves.toMatchObject({ entries: [] })

      // 创建一个纯空预设并立即删除，验证在没有任何关联引用/规则时，Document 参与者不会因 0 变更报 Document transaction produced no changes
      const standalonePreset = await createPreset(port, 'Standalone Preset', 'Standalone prompt.')
      const deleteStandaloneResult = await callRpc<{ deleted: boolean }>(port, 'application.deletePromptResource', { resourceId: standalonePreset.id })
      expect(deleteStandaloneResult.deleted).toBe(true)

      await expect(callRpc(port, 'application.getAgentPreset', { agentPresetId: agentPreset.agentPreset.id })).rejects.toThrow('Prompt resource not found')
    })
  })

  it('rejects invalid Agent Turn RPC input before writing messages', async () => {
    await withStudioServer(async port => {
      const preset = await createPreset(port, 'Safe Agent', 'Stay safe.')
      const provider = await callRpc<{ providerProfile: { id: string } }>(port, 'application.createProviderProfile', {
        providerExtensionId: 'official.fake',
        displayName: 'Safe Provider',
        config: {},
        enabledModelIds: [officialFakeModelId],
      })
      const agentPreset = await callRpc<{ agentPreset: { id: string } }>(port, 'application.updateAgentPreset', {
        name: 'Safe Agent Preset',
        agentPresetId: preset.id, expectedVersion: (await callRpc<{ resource: { version: number } }>(port, 'application.getPromptResource', { resourceId: preset.id })).resource.version,
        model: { providerProfileId: provider.providerProfile.id, modelId: officialFakeModelId },
      })
      const session = await callRpc<{ session: { id: string } }>(port, 'application.createAgentSession', {
        agentPresetId: agentPreset.agentPreset.id,
      })

      await expect(callRpc(port, 'application.invokeAgentTurn', {
        agentSessionId: session.session.id,
        input: '',
      })).rejects.toThrow('Agent turn input cannot be empty')
      const page = await callRpc<{ entries: unknown[] }>(port, 'application.getAgentTranscriptPage', {
        agentSessionId: session.session.id,
      })

      expect(page.entries).toEqual([])
    })
  })
})

async function createPreset(port: number, name: string, instructions: string): Promise<{ id: string }> {
  const created = await callRpc<{ resource: { id: string; rootNode: { id: string } } }>(port, 'application.createPromptResource', {
    resourceKind: 'preset',
    name,
  })
  await callRpc(port, 'application.createPromptResourceAsset', {
    resourceId: created.resource.id,
    targetAssetId: created.resource.rootNode.id,
    position: 'inside',
    asset: {
      id: `${created.resource.id}.instructions`,
      label: 'Agent Instructions',
      category: 'preset',
      kind: 'entry',
      body: instructions,
    },
  })
  return { id: created.resource.id }
}
