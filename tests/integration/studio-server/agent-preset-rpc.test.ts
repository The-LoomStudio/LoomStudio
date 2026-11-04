import { authenticatedTrpc } from './trpc-helpers.js'
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
  it('persists content placement across RPC and rejects obsolete placement fields without replacing mounts', async () => {
    await withStudioServer(async port => {
      const { agentPreset } = await callRpc<{ agentPreset: AgentPresetEntry }>(
        port, 'application.createAgentPreset', { name: 'Tool placement' },
      )
      const { tools } = await callRpc<{ tools: Array<{ id: string; input: { kind: string } }> }>(port, 'application.listAgentTools', {})
      const tool = tools.find(tool => tool.input.kind === 'freeform')!
      expect(tool).toBeDefined()
      const mount = { toolId: tool.id, orderIndex: 0, defaultEnabled: true,
        activation: { kind: 'always' }, content: { targetAnchorId: '@chat.custom', localDepth: 12 } }
      const trpc = await authenticatedTrpc(port)
      const saved = await trpc.application.replacePresetToolMounts.mutate({ expectedMountIds: (await trpc.application.listPresetToolMounts.query({ presetId: agentPreset.id })).mounts.map(mount => mount.id),
        presetId: agentPreset.id, mounts: [mount],
      })
      const read = () => trpc.application.listPresetToolMounts.query({ presetId: agentPreset.id })
      expect((await read()).mounts).toEqual(saved.mounts)
      expect(saved.mounts[0]).toMatchObject(mount)
      for (const content of [{ zone: 'tools', slot: 'old', orderHint: 3 }, { targetAnchorId: 12 }, { localDepth: '12' }]) {
        await expect(trpc.application.replacePresetToolMounts.mutate({ expectedMountIds: (await trpc.application.listPresetToolMounts.query({ presetId: agentPreset.id })).mounts.map(mount => mount.id),
          presetId: agentPreset.id, mounts: [{ ...mount,
            // @ts-expect-error deliberate invalid wire input
            content }],
        })).rejects.toThrow()
      }
      expect((await read()).mounts).toEqual(saved.mounts)
    })
  })

})
