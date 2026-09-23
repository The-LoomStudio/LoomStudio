import { describe, expect, it } from 'vitest'
import { officialFakeModelId } from '@loom-studio/ai-gateway'
import { callRpc, withStudioServer } from './helpers.js'

describe('studio server Agent Turn RPC', () => {
  it('manages Agent Profiles with Preset Prompt Resources through RPC', async () => {
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
      const agentProfile = await callRpc<{ agentProfile: { id: string } }>(port, 'application.createAgentProfile', {
        name: 'Local Guide',
        presetId: preset.id,
        model: { providerProfileId: profile.providerProfile.id, modelId: officialFakeModelId },
      })

      const toolMounts = await callRpc<{ mounts: Array<{ toolId: string }> }>(port, 'application.listPresetToolMounts', { presetId: preset.id })
      expect(toolMounts.mounts.length).toBeGreaterThan(0)
      expect(toolMounts.mounts.map(m => m.toolId)).toContain('official/search_context')

      const updatedProfile = await callRpc<{ agentProfile: { name: string } }>(port, 'application.updateAgentProfile', {
        agentProfileId: agentProfile.agentProfile.id,
        name: 'Updated Local Guide',
      })
      const presets = await callRpc<{ resources: Array<{ id: string }> }>(port, 'application.listPromptResources', { resourceKind: 'preset' })
      const profiles = await callRpc<{ agentProfiles: Array<{ id: string }> }>(port, 'application.listAgentProfiles', {})

      expect(updatedPreset.mounts.map(mount => mount.settingResourceId)).toEqual([setting.resource.id])
      expect(updatedProfile.agentProfile.name).toBe('Updated Local Guide')
      expect(presets.resources.map(item => item.id)).toContain(preset.id)
      expect(profiles.agentProfiles.map(item => item.id)).toContain(agentProfile.agentProfile.id)

      const card = await callRpc<{ card: { id: string } }>(port, 'application.createCard', { name: 'External references' })
      await callRpc(port, 'application.updateCardPromptResources', { cardId: card.card.id, promptResourceIds: [preset.id] })
      const timeline = await callRpc<{ timeline: { id: string } }>(port, 'application.createNarrativeTimeline', { cardId: card.card.id })
      const cardBefore = await callRpc(port, 'application.getCard', { cardId: card.card.id })
      const timelineBefore = await callRpc(port, 'application.getNarrativeTimeline', { timelineId: timeline.timeline.id })
      const profileBefore = await callRpc(port, 'application.getAgentProfile', { agentProfileId: agentProfile.agentProfile.id })
      expect(cardBefore).toMatchObject({ card: { promptResourceIds: [preset.id] } })
      expect(timelineBefore).toMatchObject({ timeline: { promptResourceIds: [preset.id] } })
      expect(profileBefore).toMatchObject({ agentProfile: { presetId: preset.id } })
      const session = await callRpc<{ session: { id: string } }>(port, 'application.createAgentSession', { agentProfileId: agentProfile.agentProfile.id })
      await callRpc(port, 'application.upsertTextTransformRule', {
        ruleId: 'owned-preset-rule',
        rule: {
          name: 'Owned rule', owner: { kind: 'preset', presetId: preset.id }, enabled: true, orderIndex: 0,
          matcher: { kind: 'regex', pattern: 'a', flags: 'g' }, effect: { kind: 'replace', replacement: 'b' },
          targets: ['agent-session'], phases: ['display'],
        },
      })

      const deletePresetResult = await callRpc<{ deleted: boolean; detachedReferences: { agentProfiles?: number } }>(port, 'application.deletePromptResource', { resourceId: preset.id })
      expect(deletePresetResult.deleted).toBe(true)
      expect(deletePresetResult.detachedReferences).toEqual({ presets: 0, cards: 0, timelines: 0, agentProfiles: 0 })
      await expect(callRpc(port, 'application.getPromptResource', { resourceId: preset.id })).rejects.toThrow('Prompt resource not found')
      await expect(callRpc(port, 'application.getAgentProfile', { agentProfileId: agentProfile.agentProfile.id })).resolves.toEqual(profileBefore)
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

      await callRpc(port, 'application.deleteAgentProfile', { agentProfileId: agentProfile.agentProfile.id })
      await expect(callRpc(port, 'application.getAgentProfile', { agentProfileId: agentProfile.agentProfile.id })).rejects.toThrow('Document not found')
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
      const agentProfile = await callRpc<{ agentProfile: { id: string } }>(port, 'application.createAgentProfile', {
        name: 'Safe Agent Profile',
        presetId: preset.id,
        model: { providerProfileId: provider.providerProfile.id, modelId: officialFakeModelId },
      })
      const session = await callRpc<{ session: { id: string } }>(port, 'application.createAgentSession', {
        agentProfileId: agentProfile.agentProfile.id,
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
