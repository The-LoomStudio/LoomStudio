import { createAgentStore, createPromptResourceStore } from '@loom-studio/application-data'
import { officialFakeModelId } from '@loom-studio/ai-gateway'
import { createAgentToolRegistry, createApplicationRuntime, type ToolDefinition } from '@loom-studio/application-runtime'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { describe, expect, it } from 'vitest'

const tool: ToolDefinition = {
  id: 'test/read_context', owner: { namespace: 'test' }, name: 'read_context',
  description: 'Read context.', input: { kind: 'structured', schema: { type: 'object' } },
}

function fixture() {
  let nextId = 0
  const createId = (prefix: string) => `${prefix}-${++nextId}`
  const now = () => '2026-09-23T00:00:00.000Z'
  const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
  const documents = createSqliteDocumentStore({ engine })
  const agentTools = createAgentToolRegistry([tool])
  const runtime = createApplicationRuntime({
    dataEngine: engine, documents, agentTools,
    agents: createAgentStore({ engine, createId, now }),
    promptResources: createPromptResourceStore({ engine, createId, now }),
  })
  const createProfile = async (toolOverrides = {}) => {
    const { providerProfile } = await runtime.createProviderProfile({
      providerExtensionId: 'official.fake', displayName: 'Test Provider',
      config: {}, enabledModelIds: [officialFakeModelId],
    })
    const { resource } = await runtime.createPromptResource({ resourceKind: 'preset', name: 'Test Preset' })
    return (await runtime.createAgentProfile({
      name: 'Test Profile', presetId: resource.id,
      model: { providerProfileId: providerProfile.id, modelId: officialFakeModelId },
      toolOverrides,
    })).agentProfile
  }
  return { engine, runtime, agentTools, createProfile }
}

describe('Agent Profile dangling references', () => {
  it('deletes a referenced Profile without changing session history, and fails subsequent execution', async () => {
    const { engine, runtime, createProfile } = fixture()
    try {
      const profile = await createProfile()
      const { session } = await runtime.createAgentSession({ agentProfileId: profile.id })
      await runtime.appendAgentTranscriptEntries({
        agentSessionId: session.id, expectedEntryCount: 0,
        entries: [{ runId: 'old-run', entry: { kind: 'message', role: 'user', content: 'Keep this history.' } }],
      })
      const before = await runtime.getAgentTranscriptPage({ agentSessionId: session.id })
      await expect(runtime.deleteAgentProfile({ agentProfileId: profile.id })).resolves.toEqual({ deleted: true })
      expect((await runtime.listAgentProfiles()).agentProfiles).toEqual([])
      await expect(runtime.getAgentProfile({ agentProfileId: profile.id })).rejects.toThrow(`Document not found: ${profile.id}`)
      expect((await runtime.getAgentSession({ agentSessionId: session.id })).session.agentProfileId).toBe(profile.id)
      expect((await runtime.listAgentSessions()).sessions.map(item => item.id)).toContain(session.id)
      expect(await runtime.getAgentTranscriptPage({ agentSessionId: session.id })).toEqual(before)
      await expect(runtime.previewAgentTurn({ agentSessionId: session.id, input: 'Continue.' }))
        .rejects.toThrow(`Document not found: ${profile.id}`)
      await expect(runtime.invokeAgentTurn({ agentSessionId: session.id, input: 'Continue.' }))
        .rejects.toThrow(`Document not found: ${profile.id}`)
      expect(await runtime.getAgentTranscriptPage({ agentSessionId: session.id })).toEqual(before)
      await expect(runtime.createAgentSession({ agentProfileId: profile.id })).rejects.toThrow(`Document not found: ${profile.id}`)
    } finally { await engine.close() }
  })

  it('retains stale Tool references during unrelated edits but validates explicit replacements', async () => {
    const { engine, runtime, agentTools, createProfile } = fixture()
    try {
      const profile = await createProfile({ [tool.id]: true })
      agentTools.replaceDefinitions([])
      const { agentProfile: renamed } = await runtime.updateAgentProfile({ agentProfileId: profile.id, name: 'Renamed' })
      expect(renamed.name).toBe('Renamed')
      expect(renamed.toolOverrides).toEqual({ [tool.id]: true })
      const { agentProfile: updated } = await runtime.updateAgentProfile({ agentProfileId: profile.id, delivery: 'complete' })
      expect(updated.delivery).toBe('complete')
      expect(updated.toolOverrides).toEqual({ [tool.id]: true })
      await expect(runtime.updateAgentProfile({ agentProfileId: profile.id, toolOverrides: { [tool.id]: true } }))
        .rejects.toThrow('not registered')
      await expect(runtime.updateAgentProfile({ agentProfileId: profile.id, toolOverrides: { 'missing/tool': true } }))
        .rejects.toThrow('not registered')
      expect((await runtime.getAgentProfile({ agentProfileId: profile.id })).agentProfile).toEqual(updated)
      await expect(createProfile({ 'missing/tool': true })).rejects.toThrow('not registered')
      agentTools.replaceDefinitions([tool])
      const { agentProfile: replaced } = await runtime.updateAgentProfile({
        agentProfileId: profile.id, toolOverrides: { [tool.id]: false },
      })
      expect(replaced.toolOverrides).toEqual({ [tool.id]: false })
      const { agentProfile: cleared } = await runtime.updateAgentProfile({ agentProfileId: profile.id, toolOverrides: {} })
      expect(cleared.toolOverrides).toEqual({})
    } finally { await engine.close() }
  })
})
