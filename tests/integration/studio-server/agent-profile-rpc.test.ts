import { describe, expect, it } from 'vitest'
import { callRpc, withStudioServer } from './helpers.js'

describe('studio server agent profile rpc integration', () => {
  it('binds an agent profile and exposes transcript inspection through /rpc', async () => {
    await withStudioServer(async port => {
      const providerAccount = await callRpc<{
        providerAccount: { id: string }
      }>(port, 'application.createProviderAccount', {
        providerExtensionId: 'official.fake',
        displayName: 'RPC Fake Provider',
      })
      const modelProfile = await callRpc<{
        modelProfile: { id: string }
      }>(port, 'application.createModelProfile', {
        providerAccountId: providerAccount.providerAccount.id,
        displayName: 'RPC Fake Model',
        providerModelId: 'fake-rpc',
      })
      const agentRuntimeProfile = await callRpc<{
        agentRuntimeProfile: { id: string }
      }>(port, 'application.createAgentRuntimeProfile', {
        name: 'RPC Narrative Agent',
        modelProfileId: modelProfile.modelProfile.id,
      })
      const card = await callRpc<{
        card: { id: string }
      }>(port, 'application.createCard', {
        name: 'RPC Agent Card',
        opening: {
          entries: [
            { role: 'assistant', content: 'RPC 开场。' },
          ],
        },
      })
      const created = await callRpc<{
        session: { id: string; agentRuntimeProfileId: string }
        branch: { id: string }
      }>(port, 'application.createSessionFromCard', {
        cardId: card.card.id,
        agentRuntimeProfileId: agentRuntimeProfile.agentRuntimeProfile.id,
      })
      const turn = await callRpc<{
        run: { agentRuntimeProfileId: string; modelProfileId: string }
      }>(port, 'application.submitTurn', {
        sessionId: created.session.id,
        branchId: created.branch.id,
        input: 'RPC 玩家输入。',
      })
      const transcript = await callRpc<{
        entries: Array<{ role: string; content: string; parentTranscriptEntryId?: string }>
      }>(port, 'application.getAgentTranscript', {
        sessionId: created.session.id,
      })

      expect(created.session.agentRuntimeProfileId).toBe(agentRuntimeProfile.agentRuntimeProfile.id)
      expect(turn.run).toMatchObject({
        agentRuntimeProfileId: agentRuntimeProfile.agentRuntimeProfile.id,
        modelProfileId: modelProfile.modelProfile.id,
      })
      expect(transcript.entries.map(entry => entry.content)).toEqual([
        'RPC 开场。',
        'RPC 玩家输入。',
        'Agent draft: RPC 玩家输入。',
      ])
      expect(transcript.entries[1]?.parentTranscriptEntryId).toBe(transcript.entries[0]?.id)
      expect(transcript.entries[2]?.parentTranscriptEntryId).toBe(transcript.entries[1]?.id)
    })
  })
})
