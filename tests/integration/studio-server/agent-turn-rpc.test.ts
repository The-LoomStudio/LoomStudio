import { describe, expect, it } from 'vitest'
import { callRpc, withStudioServer } from './helpers.js'

describe('studio server Agent Turn RPC', () => {
  it('manages Agent Profiles with Preset Prompt Resources through RPC', async () => {
    await withStudioServer(async port => {
      const profile = await callRpc<{ providerProfile: { id: string } }>(port, 'application.createProviderProfile', {
        providerExtensionId: 'official.fake',
        displayName: 'Local Provider',
        config: { baseUrl: 'https://example.test/v1' },
        enabledModelIds: ['test-model'],
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
        model: { providerProfileId: profile.providerProfile.id, modelId: 'test-model' },
      })

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

      await callRpc(port, 'application.deleteAgentProfile', { agentProfileId: agentProfile.agentProfile.id })
      await callRpc(port, 'application.deletePromptResource', { resourceId: preset.id })
      await expect(callRpc(port, 'application.getAgentProfile', { agentProfileId: agentProfile.agentProfile.id })).rejects.toThrow('Document not found')
      await expect(callRpc(port, 'application.getPromptResource', { resourceId: preset.id })).rejects.toThrow('Prompt resource not found')
    })
  })

  it('rejects invalid Agent Turn RPC input before writing messages', async () => {
    await withStudioServer(async port => {
      const preset = await createPreset(port, 'Safe Agent', 'Stay safe.')
      const provider = await callRpc<{ providerProfile: { id: string } }>(port, 'application.createProviderProfile', {
        providerExtensionId: 'official.fake',
        displayName: 'Safe Provider',
        config: { baseUrl: 'https://example.test/v1' },
        enabledModelIds: ['test-model'],
      })
      const agentProfile = await callRpc<{ agentProfile: { id: string } }>(port, 'application.createAgentProfile', {
        name: 'Safe Agent Profile',
        presetId: preset.id,
        model: { providerProfileId: provider.providerProfile.id, modelId: 'test-model' },
      })
      const session = await callRpc<{ session: { id: string } }>(port, 'application.createAgentSession', {
        agentProfileId: agentProfile.agentProfile.id,
      })

      await expect(callRpc(port, 'application.invokeAgentTurn', {
        agentSessionId: session.session.id,
        input: '',
      })).rejects.toThrow('Agent turn input cannot be empty')
      const page = await callRpc<{ messages: unknown[] }>(port, 'application.getAgentMessagePage', {
        agentSessionId: session.session.id,
      })

      expect(page.messages).toEqual([])
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
