import { describe, expect, it } from 'vitest'
import type { AgentPresetEntry } from '@loom-studio/application-runtime'
import { callRpc, withStudioServer } from './helpers.js'

describe('Agent preset RPC', () => {
  it('edits the same resource and rejects invalid execution options and stale writes', async () => {
    await withStudioServer(async port => {
      const { agentPreset } = await callRpc<{ agentPreset: AgentPresetEntry }>(
        port, 'application.createAgentPreset', { name: 'Writer', delivery: 'complete', historyPolicy: 'ephemeral' },
      )
      const target = { agentPresetId: agentPreset.id }
      const listed = await callRpc<{ agentPresets: AgentPresetEntry[] }>(port, 'application.listAgentPresets', {})
      expect(listed.agentPresets).toContainEqual(agentPreset)
      for (const invalid of [{ delivery: 'invalid' }, { historyPolicy: 'invalid' }, { model: {} }]) {
        await expect(callRpc(port, 'application.updateAgentPreset', {
          ...target, expectedVersion: agentPreset.version, ...invalid,
        })).rejects.toThrow()
      }
      const { agentPreset: updated } = await callRpc<{ agentPreset: AgentPresetEntry }>(
        port, 'application.updateAgentPreset',
        { ...target, expectedVersion: agentPreset.version, name: 'Renamed', model: null },
      )
      expect(updated).toMatchObject({
        id: agentPreset.id, rootNode: { label: 'Renamed' }, delivery: 'complete', historyPolicy: 'ephemeral',
      })
      expect(updated.model).toBeUndefined()
      await expect(callRpc(port, 'application.updateAgentPreset', {
        ...target, expectedVersion: agentPreset.version, name: 'Stale',
      })).rejects.toThrow()
      const read = await callRpc<{ agentPreset: AgentPresetEntry }>(port, 'application.getAgentPreset', target)
      expect(read.agentPreset).toEqual(updated)
      const prompt = await callRpc<{ resource: AgentPresetEntry }>(
        port, 'application.getPromptResource', { resourceId: agentPreset.id },
      )
      expect(prompt.resource).toEqual(updated)
      await callRpc(port, 'application.deleteAgentPreset', target)
      await expect(callRpc(port, 'application.getAgentPreset', target)).rejects.toThrow()
    })
  })
})
