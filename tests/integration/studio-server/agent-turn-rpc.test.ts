import { describe, expect, it } from 'vitest'
import { callRpc, withStudioServer } from './helpers.js'

describe('studio server Agent Turn RPC', () => {
  it('manages Agent Presets and Local Bindings through RPC', async () => {
    await withStudioServer(async port => {
      const account = await callRpc<{ providerAccount: { id: string } }>(port, 'application.createProviderAccount', {
        providerExtensionId: 'official.openai-compatible',
        displayName: 'Local Provider',
        config: { baseUrl: 'https://example.test/v1' },
        secretRefs: { apiKey: 'plain:test' },
      })
      const model = await callRpc<{ modelProfile: { id: string } }>(port, 'application.createModelProfile', {
        providerAccountId: account.providerAccount.id,
        displayName: 'Local Model',
        providerModelId: 'test-model',
      })
      const preset = await callRpc<{ agentPreset: { id: string; historyPolicy: string } }>(port, 'application.createAgentPreset', {
        name: 'Guide',
        instructions: 'Guide the user.',
        historyPolicy: 'ephemeral',
      })
      const binding = await callRpc<{ localBinding: { id: string; modelProfileId: string } }>(port, 'application.createAgentLocalBinding', {
        name: 'Local Guide',
        purpose: 'agent-work',
        modelProfileId: model.modelProfile.id,
      })

      const updatedPreset = await callRpc<{ agentPreset: { name: string; historyPolicy: string } }>(port, 'application.updateAgentPreset', {
        agentPresetId: preset.agentPreset.id,
        name: 'Updated Guide',
        historyPolicy: 'persistent',
      })
      const updatedBinding = await callRpc<{ localBinding: { purpose: string } }>(port, 'application.updateAgentLocalBinding', {
        localBindingId: binding.localBinding.id,
        purpose: 'test',
      })
      const presets = await callRpc<{ agentPresets: Array<{ id: string }> }>(port, 'application.listAgentPresets', {})
      const bindings = await callRpc<{ localBindings: Array<{ id: string }> }>(port, 'application.listAgentLocalBindings', {})

      expect(updatedPreset.agentPreset).toMatchObject({ name: 'Updated Guide', historyPolicy: 'persistent' })
      expect(updatedBinding.localBinding.purpose).toBe('test')
      expect(presets.agentPresets.map(item => item.id)).toContain(preset.agentPreset.id)
      expect(bindings.localBindings.map(item => item.id)).toContain(binding.localBinding.id)

      await callRpc(port, 'application.deleteAgentLocalBinding', { localBindingId: binding.localBinding.id })
      await callRpc(port, 'application.deleteAgentPreset', { agentPresetId: preset.agentPreset.id })
      await expect(callRpc(port, 'application.getAgentLocalBinding', { localBindingId: binding.localBinding.id })).rejects.toThrow('Document not found')
      await expect(callRpc(port, 'application.getAgentPreset', { agentPresetId: preset.agentPreset.id })).rejects.toThrow('Document not found')
    })
  })

  it('rejects invalid Agent Turn RPC input before writing messages', async () => {
    await withStudioServer(async port => {
      const preset = await callRpc<{ agentPreset: { id: string } }>(port, 'application.createAgentPreset', {
        name: 'Safe Agent',
        instructions: 'Stay safe.',
      })
      const session = await callRpc<{ session: { id: string } }>(port, 'application.createAgentSession', {
        agentPresetId: preset.agentPreset.id,
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
