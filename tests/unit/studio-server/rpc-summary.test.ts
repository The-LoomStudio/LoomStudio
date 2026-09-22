import { describe, expect, it } from 'vitest'
import { isTechnicalRpc, summarizeRpc } from '../../../apps/studio-server/src/rpc/rpc-summary.js'

describe('metadata-only RPC summaries', () => {
  it('keeps entity names and content out of list summaries', () => {
    expect(summarizeRpc('application.listAgentProfiles', { agentProfiles: [{ id: 'private-id', name: 'private name' }] }))
      .toEqual({ textSuffix: '1 entries', summaryData: { itemCount: 1 } })
    expect(summarizeRpc('application.createCard', { card: { name: 'private', content: 'private' }, mutation: { changesetId: 'changeset-1' } }))
      .toEqual({ textSuffix: 'changes committed', summaryData: { changesetId: 'changeset-1' } })
  })
  it('distinguishes an accepted asynchronous run from a completed turn', () => {
    expect(summarizeRpc('application.agent.run.create', { runId: 'run-1' })).toEqual({ textSuffix: 'run accepted', summaryData: { runId: 'run-1' } })
    expect(summarizeRpc('application.invokeAgentTurn', { runId: 'run-1', provider: { model: 'model-1' }, entries: { private: 'private' } }))
      .toEqual({ textSuffix: 'turn completed', summaryData: { runId: 'run-1', model: 'model-1' } })
  })
  it('marks reads and polling as technical without marking run creation or mutations', () => {
    expect(isTechnicalRpc('application.agent.run.subscribe')).toBe(true)
    expect(isTechnicalRpc('application.getAgentTranscriptPage')).toBe(true)
    expect(isTechnicalRpc('application.listCards')).toBe(true)
    expect(isTechnicalRpc('application.agent.run.create')).toBe(false)
    expect(isTechnicalRpc('application.updateCard')).toBe(false)
  })
})
