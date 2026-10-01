import { describe, expect, it } from 'vitest'
import { officialFakeModelId } from '@loom-studio/ai-gateway'
import { createId, nowIso } from '@loom-studio/shared'
import { readFile } from 'node:fs/promises'
import { createAgentToolRegistry, createApplicationRuntime } from '../../../packages/application-runtime/src/index.js'
import { createSqliteDataEngine } from '../../../packages/data-engine/src/index.js'
import { createSqliteDocumentStore } from '../../../packages/document-store/src/index.js'
import { createAgentStore, createPromptResourceStore } from '../../../packages/application-data/src/index.js'
import type { PromptResourceArtifact } from '../../../packages/application-runtime/src/index.js'

describe('Agent preset resource', () => {
  it('refreshes built-in source on upgrade while preserving enabled tool mounts', async () => {
    const engine = createSqliteDataEngine({ filename: ':memory:', createId, now: nowIso })
    try {
      const promptResources = createPromptResourceStore({ engine })
      const runtime = createApplicationRuntime({
        dataEngine: engine, documents: createSqliteDocumentStore({ engine }), promptResources,
        agentTools: createAgentToolRegistry([{
          id: 'test/read', owner: { namespace: 'test' }, name: 'read',
          description: 'Read', input: { kind: 'structured', schema: { type: 'object', properties: {} } },
        }]),
      })
      const id = 'prompt-resource.official.loom-assistant'
      const artifact: PromptResourceArtifact = {
        format: 'loom.promptResource', schemaVersion: 2, resourceKind: 'preset',
        rootNode: { id: 'root', kind: 'module', label: 'Original', children: [] },
        macros: { tone: 'source' },
      }
      const install = (source: PromptResourceArtifact) => runtime.installOfficialContent({
        packageId: 'official.starter', packageVersion: '0.1.0',
        resources: [{ id, artifact: source }], settingMounts: [],
      })
      await install(artifact)
      const { mounts } = await runtime.listPresetToolMounts({ presetId: id })
      await runtime.replacePresetToolMounts({
        presetId: id, mounts: [{ ...mounts[0]!, defaultEnabled: true }],
      })
      const before = (await runtime.getAgentPreset({ agentPresetId: id })).agentPreset
      await runtime.updatePromptResourceMacros({
        resourceId: id, expectedVersion: before.version, macros: { tone: 'edited' },
      })
      expect((await install(artifact)).mutation).toBeUndefined()
      const upgrade = await install({
        ...artifact, rootNode: { ...artifact.rootNode, label: 'Updated' },
      })
      expect(upgrade.mutation?.changesetId).toBeTruthy()
      const after = (await runtime.getAgentPreset({ agentPresetId: id })).agentPreset
      expect(after.rootNode.label).toBe('Updated')
      expect(after.macros).toEqual({ tone: 'source' })
      expect((await runtime.listPresetToolMounts({ presetId: id })).mounts[0]?.defaultEnabled).toBe(true)
    } finally {
      await engine.close()
    }
  })

  it('owns execution configuration and tool mounts without creating a Profile', async () => {
    const engine = createSqliteDataEngine({ filename: ':memory:', createId, now: nowIso })
    try {
      const documents = createSqliteDocumentStore({ engine })
      const promptResources = createPromptResourceStore({ engine })
      const runtime = createApplicationRuntime({
        dataEngine: engine, documents, promptResources,
        agentTools: createAgentToolRegistry([{
          id: 'test/read', owner: { namespace: 'test' }, name: 'read',
          description: 'Read', input: { kind: 'structured', schema: { type: 'object', properties: {} } },
        }]),
      })
      const { agentPreset: unbound } = await runtime.createAgentPreset({ name: 'Writer' })
      expect(unbound.model).toBeUndefined()
      expect(unbound).toMatchObject({ resourceKind: 'preset', delivery: 'stream', historyPolicy: 'persistent' })
      expect((await documents.list({ type: 'airp.agentProfile' })).items).toEqual([])
      expect((await runtime.listAgentPresets()).agentPresets).toContainEqual(unbound)
      const { mounts } = await runtime.listPresetToolMounts({ presetId: unbound.id })
      expect(mounts.length).toBeGreaterThan(0)
      expect(mounts.every(mount => !mount.defaultEnabled)).toBe(true)
      await runtime.replacePresetToolMounts({
        presetId: unbound.id,
        mounts: [{ ...mounts[0]!, defaultEnabled: true }],
      })
      const { resource: withMacros } = await runtime.updatePromptResourceMacros({
        resourceId: unbound.id, expectedVersion: unbound.version, macros: { tone: 'quiet' },
      })
      const { providerProfile } = await runtime.createProviderProfile({
        providerExtensionId: 'official.fake', displayName: 'Test', config: {}, enabledModelIds: [officialFakeModelId],
      })
      const model = { providerProfileId: providerProfile.id, modelId: officialFakeModelId }
      const { agentPreset: bound } = await runtime.updateAgentPreset({
        agentPresetId: unbound.id, expectedVersion: withMacros.version,
        name: 'Renamed', model, delivery: 'complete', historyPolicy: 'ephemeral',
      })
      expect(bound).toMatchObject({
        id: unbound.id, rootNode: { label: 'Renamed' }, macros: { tone: 'quiet' },
        model, delivery: 'complete', historyPolicy: 'ephemeral',
      })
      expect((await promptResources.getResource(bound.id))?.label).toBe('Renamed')
      await expect(runtime.updateAgentPreset({
        agentPresetId: bound.id, expectedVersion: withMacros.version, name: 'Stale',
      })).rejects.toThrow()
      expect((await runtime.getAgentPreset({ agentPresetId: bound.id })).agentPreset).toEqual(bound)
      const { agentPreset: cleared } = await runtime.updateAgentPreset({
        agentPresetId: bound.id, expectedVersion: bound.version, model: null,
      })
      expect(cleared.model).toBeUndefined()
      expect(cleared.macros).toEqual({ tone: 'quiet' })
      expect((await runtime.listPresetToolMounts({ presetId: cleared.id })).mounts)
        .toMatchObject([{ toolId: mounts[0]!.toolId, defaultEnabled: true }])
      await runtime.deleteAgentPreset({ agentPresetId: cleared.id })
      expect((await runtime.listAgentPresets()).agentPresets).toEqual([])
      await expect(runtime.getAgentPreset({ agentPresetId: cleared.id })).rejects.toThrow()
    } finally {
      await engine.close()
    }
  })

  it.each(['default', 'official-assistant'] as const)('executes %s directly after binding a model', async template => {
    const engine = createSqliteDataEngine({ filename: ':memory:', createId, now: nowIso })
    try {
      const documents = createSqliteDocumentStore({ engine })
      const agents = createAgentStore({ engine })
      const promptResources = createPromptResourceStore({ engine })
      const requests: unknown[] = []
      const runtime = createApplicationRuntime({
        dataEngine: engine, documents, agents, promptResources,
        gateway: { invokeChat: async ({ request }) => {
          requests.push(request.messages)
          return { provider: 'test', model: 'test', text: 'Done', message: { role: 'assistant', content: 'Done' } }
        } },
      })
      let presetId: string
      if (template === 'default') {
        presetId = (await runtime.createAgentPreset({ name: 'Default Writer' })).agentPreset.id
      } else {
        const artifact = JSON.parse(await readFile(
          new URL('../../../official/starter/presets/assistant.json', import.meta.url), 'utf8',
        )) as PromptResourceArtifact
        presetId = 'prompt-resource.official.loom-assistant'
        await runtime.installOfficialContent({
          packageId: 'official.starter', packageVersion: '0.1.0',
          resources: [{ id: presetId, artifact }], settingMounts: [],
        })
      }
      const { agentPreset: unbound } = await runtime.getAgentPreset({ agentPresetId: presetId })
      const { session } = await runtime.createAgentSession({ agentPresetId: presetId })
      expect(session.agentPresetId).toBe(presetId)
      await expect(runtime.previewAgentTurn({ agentSessionId: session.id, input: 'Continue' }))
        .rejects.toThrow('has no model binding')
      expect(requests).toEqual([])
      expect((await runtime.getAgentTranscriptPage({ agentSessionId: session.id })).entries).toEqual([])
      const { providerProfile } = await runtime.createProviderProfile({
        providerExtensionId: 'official.fake', displayName: 'Test', config: {}, enabledModelIds: [officialFakeModelId],
      })
      const { agentPreset: bound } = await runtime.updateAgentPreset({
        agentPresetId: presetId, expectedVersion: unbound.version,
        model: { providerProfileId: providerProfile.id, modelId: officialFakeModelId },
      })
      expect(bound.rootNode).toEqual(unbound.rootNode)
      expect(bound.macros).toEqual(unbound.macros)
      const preview = await runtime.previewAgentTurn({ agentSessionId: session.id, input: 'Continue' })
      await runtime.invokeAgentTurn({ agentSessionId: session.id, input: 'Continue' })
      expect(requests).toEqual([preview.messages])
      expect(preview.messages.some(message => message.content === 'Continue')).toBe(true)
      expect((await documents.list({ type: 'airp.agentProfile' })).items).toEqual([])
    } finally {
      await engine.close()
    }
  })

  it('rejects Settings and unknown models without changing stored resources', async () => {
    const engine = createSqliteDataEngine({ filename: ':memory:', createId, now: nowIso })
    try {
      const documents = createSqliteDocumentStore({ engine })
      const promptResources = createPromptResourceStore({ engine })
      const runtime = createApplicationRuntime({ dataEngine: engine, documents, promptResources })
      const { resource } = await runtime.createPromptResource({ resourceKind: 'setting', name: 'Lore' })
      await expect(runtime.updateAgentPreset({
        agentPresetId: resource.id, expectedVersion: resource.version, delivery: 'complete',
      })).rejects.toThrow('Agent Preset not found')
      await expect(runtime.deleteAgentPreset({ agentPresetId: resource.id })).rejects.toThrow('not a Preset')
      await expect(runtime.createAgentPreset({
        name: 'Invalid', model: { providerProfileId: 'missing', modelId: 'missing' },
      })).rejects.toThrow()
      expect((await runtime.listAgentPresets()).agentPresets).toEqual([])
      expect((await runtime.getPromptResource({ resourceId: resource.id })).resource).toEqual(resource)
    } finally {
      await engine.close()
    }
  })
})
