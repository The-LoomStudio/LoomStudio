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
  const createPreset = async () => {
    const { providerProfile } = await runtime.createProviderProfile({
      providerExtensionId: 'official.fake', displayName: 'Test Provider',
      config: {}, enabledModelIds: [officialFakeModelId],
    })
    return (await runtime.createAgentPreset({
      name: 'Test Preset',
      model: { providerProfileId: providerProfile.id, modelId: officialFakeModelId },
    })).agentPreset
  }
  return { engine, runtime, agentTools, createPreset }
}

describe('Agent Preset dangling references', () => {
  it('deletes a referenced Preset without changing session history, and fails subsequent execution', async () => {
    const { engine, runtime, createPreset } = fixture()
    try {
      const profile = await createPreset()
      const { session } = await runtime.createAgentSession({ agentPresetId: profile.id })
      await runtime.appendAgentTranscriptEntries({
        agentSessionId: session.id, expectedEntryCount: 0,
        entries: [{ runId: 'old-run', entry: { kind: 'message', role: 'user', content: 'Keep this history.' } }],
      })
      const before = await runtime.getAgentTranscriptPage({ agentSessionId: session.id })
      await expect(runtime.deleteAgentPreset({ agentPresetId: profile.id })).resolves.toMatchObject({ deleted: true })
      expect((await runtime.listAgentPresets()).agentPresets).toEqual([])
      await expect(runtime.getAgentPreset({ agentPresetId: profile.id })).rejects.toThrow(`Prompt resource not found: ${profile.id}`)
      expect((await runtime.getAgentSession({ agentSessionId: session.id })).session.agentPresetId).toBe(profile.id)
      expect((await runtime.listAgentSessions()).sessions.map(item => item.id)).toContain(session.id)
      expect(await runtime.getAgentTranscriptPage({ agentSessionId: session.id })).toEqual(before)
      await expect(runtime.previewAgentTurn({ agentSessionId: session.id, input: 'Continue.' }))
        .rejects.toThrow(`Prompt resource not found: ${profile.id}`)
      await expect(runtime.invokeAgentTurn({ agentSessionId: session.id, input: 'Continue.' }))
        .rejects.toThrow(`Prompt resource not found: ${profile.id}`)
      expect(await runtime.getAgentTranscriptPage({ agentSessionId: session.id })).toEqual(before)
      await expect(runtime.createAgentSession({ agentPresetId: profile.id })).rejects.toThrow(`Prompt resource not found: ${profile.id}`)
    } finally { await engine.close() }
  })

  it('retains stale Tool references during unrelated edits but validates explicit replacements', async () => {
    const { engine, runtime, agentTools, createPreset } = fixture()
    try {
      const profile = await createPreset()
      const mounts = [{ toolId: tool.id, orderIndex: 0, defaultEnabled: true }]
      await runtime.replacePresetToolMounts({ presetId: profile.id, mounts })
      agentTools.replaceDefinitions([])
      const { agentPreset: renamed } = await runtime.updateAgentPreset({
        agentPresetId: profile.id, expectedVersion: profile.version, name: 'Renamed',
      })
      expect(renamed.rootNode.label).toBe('Renamed')
      const { agentPreset: updated } = await runtime.updateAgentPreset({
        agentPresetId: profile.id, expectedVersion: renamed.version, delivery: 'complete',
      })
      expect(updated.delivery).toBe('complete')
      expect((await runtime.listPresetToolMounts({ presetId: profile.id })).mounts).toMatchObject(mounts)
      await expect(runtime.replacePresetToolMounts({ presetId: profile.id, mounts }))
        .rejects.toThrow('not registered')
      await expect(runtime.replacePresetToolMounts({
        presetId: profile.id, mounts: [{ toolId: 'missing/tool', orderIndex: 0, defaultEnabled: true }],
      }))
        .rejects.toThrow('not registered')
      expect((await runtime.getAgentPreset({ agentPresetId: profile.id })).agentPreset).toEqual(updated)
      agentTools.replaceDefinitions([tool])
      const { mounts: replaced } = await runtime.replacePresetToolMounts({
        presetId: profile.id, mounts: [{ ...mounts[0]!, defaultEnabled: false }],
      })
      expect(replaced).toMatchObject([{ toolId: tool.id, defaultEnabled: false }])
      const { mounts: cleared } = await runtime.replacePresetToolMounts({ presetId: profile.id, mounts: [] })
      expect(cleared).toEqual([])
    } finally { await engine.close() }
  })
})
