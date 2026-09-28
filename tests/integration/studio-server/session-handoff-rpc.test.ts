import { describe, expect, it } from 'vitest'
import { officialFakeModelId } from '@loom-studio/ai-gateway'
import type { AgentTranscriptPage, CompleteAgentSessionHandoffResult, PreviewAgentTurnResult } from '@loom-studio/application-runtime'
import { callRpc, withStudioServer } from './helpers.js'

describe('Session handoff RPC', () => {
  it('validates input and commits a handoff without deleting the old conversation', async () => {
    await withStudioServer(async port => {
      const { providerProfile } = await callRpc<{ providerProfile: { id: string } }>(port, 'application.createProviderProfile', {
        providerExtensionId: 'official.fake', displayName: 'Test', config: {}, enabledModelIds: [officialFakeModelId],
      })
      const { resource } = await callRpc<{ resource: { id: string } }>(port, 'application.createPromptResource', { resourceKind: 'preset', name: 'Writer' })
      const { agentPreset } = await callRpc<{ agentPreset: { id: string } }>(port, 'application.updateAgentPreset', {
        name: 'Writer', agentPresetId: resource.id, expectedVersion: (await callRpc<{ resource: { version: number } }>(port, 'application.getPromptResource', { resourceId: resource.id })).resource.version, model: { providerProfileId: providerProfile.id, modelId: officialFakeModelId },
      })
      const { session } = await callRpc<{ session: { id: string } }>(port, 'application.createAgentSession', { agentPresetId: agentPreset.id })
      const input = { agentSessionId: session.id }
      await callRpc(port, 'application.invokeAgentTurn', { ...input, input: 'OLD_USER_REQUEST' })
      const before = await callRpc<AgentTranscriptPage>(port, 'application.getAgentTranscriptPage', input)
      await expect(callRpc(port, 'application.completeAgentSessionHandoff', {
        ...input, expectedEntryCount: 'invalid', summary: 'Handoff',
      })).rejects.toThrow()
      const completed = await callRpc<CompleteAgentSessionHandoffResult>(port, 'application.completeAgentSessionHandoff', {
        ...input, expectedEntryCount: before.session.entryCount, summary: 'WORK_RECORD: finish pending task',
      })
      expect(completed.memoryNotification.status).toBe('not-configured')
      expect(completed.session.entryCount).toBe(before.session.entryCount + 1)
      const preview = await callRpc<PreviewAgentTurnResult>(port, 'application.previewAgentTurn', { ...input, input: 'NEW_USER_REQUEST' })
      expect(JSON.stringify(preview.messages)).toContain('WORK_RECORD: finish pending task')
      expect(JSON.stringify(preview.messages)).not.toContain('OLD_USER_REQUEST')
      const after = await callRpc<AgentTranscriptPage>(port, 'application.getAgentTranscriptPage', input)
      expect(after.entries.slice(0, -1)).toEqual(before.entries)
      await expect(callRpc(port, 'application.completeAgentSessionHandoff', {
        ...input, expectedEntryCount: before.session.entryCount, summary: 'Stale handoff',
      })).rejects.toThrow(/count conflict/)
    })
  })
})
