import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createAgentStore, createNarrativeStore, createPromptResourceStore } from '@loom-studio/application-data'
import { createAgentToolRegistry, createApplicationRuntime } from '@loom-studio/application-runtime'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createId, nowIso } from '@loom-studio/shared'
import { activate } from '../../../extensions/the-world/src/server/index.js'

function readPackageJson(path: string) {
  return JSON.parse(readFileSync(new URL(`../../../extensions/the-world/${path}`, import.meta.url), 'utf8'))
}

describe('The World prompt resources', () => {
  it('exposes maintenance rules only after explicit import and Preset adoption', async () => {
    const engine = createSqliteDataEngine({ filename: ':memory:', createId, now: nowIso })
    const documents = createSqliteDocumentStore({ engine })
    const promptResources = createPromptResourceStore({ engine })
    const agentTools = createAgentToolRegistry([])
    const runtime = createApplicationRuntime({
      dataEngine: engine,
      documents,
      promptResources,
      agentTools,
      agents: createAgentStore({ engine }),
      narratives: createNarrativeStore({ engine }),
    })
    try {
      const manifest = readPackageJson('manifest.json')
      const imported = await runtime.importExtensionPackageResources({
        packageId: manifest.id,
        packageVersion: manifest.version,
        transformRules: [],
        textExtractors: [],
        promptResources: manifest.contributes.promptResources.map((contribution: { source: string }) => ({
          contribution,
          artifact: readPackageJson(contribution.source),
        })),
        agentTools: manifest.contributes.agentTools.map((contribution: { source: string }) => ({
          contribution,
          definition: readPackageJson(contribution.source),
        })),
      })
      expect(imported.promptResources).toHaveLength(1)
      expect(imported.agentTools.map(tool => tool.toolId)).toEqual([
        'official.the-world/read-world-state',
        'official.the-world/update-world-state',
      ])
      const localPreset = await runtime.createPromptResource({ resourceKind: 'preset', name: 'World test' })
      const presetId = localPreset.resource.id
      const preset = (await runtime.getAgentPreset({ agentPresetId: presetId })).agentPreset
      const provider = await runtime.createProviderProfile({
        providerExtensionId: 'official.openai-compatible', displayName: 'Test Provider', config: {},
        enabledModelIds: ['test-model'],
      })
      await runtime.updateAgentPreset({
        agentPresetId: presetId, expectedVersion: preset.version,
        model: { providerProfileId: provider.providerProfile.id, modelId: 'test-model' },
      })
      const session = await runtime.createAgentSession({ agentPresetId: presetId })
      const before = await runtime.previewAgentTurn({ agentSessionId: session.session.id, input: '读取世界' })
      expect(before.projection.messages.map(message => message.content).join('\n')).not.toContain('先调用 official.the-world/read-world-state')
      expect((await runtime.listPresetToolMounts({ presetId })).mounts.every(mount => !mount.defaultEnabled)).toBe(true)
      expect(before.toolExposures).toEqual([])

      await runtime.replaceLoreMounts({ expectedMountIds: (await runtime.listLoreMounts({ source: { kind: 'preset', id: presetId } })).mounts.map(mount => mount.id),
        source: { kind: 'preset', id: presetId },
        loreResourceIds: [imported.promptResources[0]!.resourceId],
      })
      await runtime.replacePresetToolMounts({ expectedMountIds: (await runtime.listPresetToolMounts({ presetId: presetId })).mounts.map(mount => mount.id),
        presetId,
        mounts: imported.agentTools.map((tool, orderIndex) => ({
          toolId: tool.toolId, orderIndex, defaultEnabled: true,
        })),
      })
      await expect(runtime.previewAgentTurn({ agentSessionId: session.session.id, input: '读取世界' }))
        .rejects.toThrow('No runtime handler registered')
      activate({
        state: { contribute() {} },
        rpc: { register() {} },
        agentTools: {
          register(toolId: string, handler: (input: unknown, context: { signal: AbortSignal; invocationId: string }) => Promise<any>) {
            agentTools.registerRuntime({
              toolId,
              execute: async ({ invocation, signal }) => ({
                invocationId: invocation.id, toolId, status: 'completed',
                content: [{ type: 'json', value: await handler({ arguments: invocation.arguments }, { signal, invocationId: invocation.id }) }],
              }),
            })
          },
        },
      })
      const after = await runtime.previewAgentTurn({ agentSessionId: session.session.id, input: '读取世界' })
      expect(after.projection.messages.map(message => message.content).join('\n')).toContain('先调用 official.the-world/read-world-state')
      expect(after.toolExposures.map(exposure => exposure.toolId)).toEqual(imported.agentTools.map(tool => tool.toolId))
      expect((await runtime.listPresetToolMounts({ presetId })).mounts).toEqual(expect.arrayContaining(
        imported.agentTools.map(tool => expect.objectContaining({ toolId: tool.toolId, defaultEnabled: true })),
      ))
    } finally {
      engine.close()
    }
  })
})
