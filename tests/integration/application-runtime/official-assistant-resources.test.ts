import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createAgentStore, createNarrativeStore, createPromptResourceStore } from '@loom-studio/application-data'
import { officialFakeModelId } from '@loom-studio/ai-gateway'
import { createApplicationRuntime, type ImportExtensionPackageResourcesInput } from '@loom-studio/application-runtime'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createId, nowIso } from '@loom-studio/shared'

function readOfficialJson(path: string) {
  return JSON.parse(readFileSync(new URL(`../../../official/extensions/loom-assistant/${path}`, import.meta.url), 'utf8'))
}

function fixture() {
  const engine = createSqliteDataEngine({ filename: ':memory:', createId, now: nowIso })
  const documents = createSqliteDocumentStore({ engine })
  const promptResources = createPromptResourceStore({ engine })
  const agents = createAgentStore({ engine })
  const narratives = createNarrativeStore({ engine })
  const runtime = createApplicationRuntime({
    dataEngine: engine,
    documents,
    promptResources,
    agents,
    narratives,
    gateway: {
      invokeChat: async () => ({
        provider: 'test',
        model: 'test',
        text: 'Done',
        message: { role: 'assistant', content: 'Done' },
      }),
    },
  })
  return { engine, runtime }
}

function officialPackage(): ImportExtensionPackageResourcesInput {
  const manifest = readOfficialJson('manifest.json')
  const contributions = manifest.contributes
  // This fixture has no blobStore; keep every non-script manifest contribution intact.
  return {
    packageId: manifest.id,
    packageVersion: manifest.version,
    promptResources: contributions.promptResources
      .map((contribution: Record<string, any>) => {
        const { scriptMounts: _scriptMounts, ...promptContribution } = contribution
        return {
          contribution: promptContribution,
          artifact: readOfficialJson(contribution.source.replace('./', '')),
        }
      }),
    transformRules: contributions.transformRules
      .map((contribution: Record<string, any>) => ({
        contribution,
        artifact: readOfficialJson(contribution.source.replace('./', '')),
      })),
    agentTools: (contributions.agentTools ?? []).map((contribution: Record<string, any>) => ({
      contribution,
      definition: readOfficialJson(contribution.source.replace('./', '')),
    })),
    textExtractors: (contributions.textExtractors ?? []).map((contribution: Record<string, any>) => ({
      contribution,
      artifact: readOfficialJson(contribution.source.replace('./', '')),
    })),
  }
}

describe('official Loom Assistant resources', () => {
  it('imports the declared Setting and Display rule and projects assistant notes', async () => {
    const { engine, runtime } = fixture()
    try {
      const input = officialPackage()
      const installed = await runtime.importExtensionPackageResources(input)
      const presetId = installed.promptResources.find(item => item.contributionId === 'official.loom-assistant.preset')!.resourceId
      const settingId = installed.promptResources.find(item => item.contributionId === 'official.loom-assistant.knowledge')!.resourceId
      const ruleId = installed.transformRules.find(item => item.contributionId === 'assistant-note')!.ruleId
      const preset = (await runtime.getAgentPreset({ agentPresetId: presetId })).agentPreset
      const mounts = await runtime.listSettingMounts({ source: { kind: 'preset', id: presetId } })

      expect(mounts.mounts).toEqual(expect.arrayContaining([
        expect.objectContaining({ settingResourceId: settingId, resolvedSettingResourceId: settingId }),
      ]))
      expect(preset.textUses).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'rule', id: ruleId, enabled: true }),
      ]))
      expect((await runtime.getTextTransformRule({ ruleId })).rule.enabled).toBe(false)

      const provider = await runtime.createProviderProfile({
        providerExtensionId: 'official.fake',
        displayName: 'Test Provider',
        config: {},
        enabledModelIds: [officialFakeModelId],
      })
      await runtime.updateAgentPreset({
        agentPresetId: presetId,
        expectedVersion: preset.version,
        model: { providerProfileId: provider.providerProfile.id, modelId: officialFakeModelId },
      })
      const session = await runtime.createAgentSession({ agentPresetId: presetId })
      const preview = await runtime.previewAgentTurn({ agentSessionId: session.session.id, input: '展示助手提示' })
      const previewText = preview.projection.messages.map(message => message.content).join('\n')
      expect(previewText).toContain('Loom Studio 是面向 AI 角色扮演与交互叙事创作的平台')
      expect(previewText).toContain('<LoomNote>这里填写简短的使用建议。</LoomNote>')

      await runtime.appendAgentTranscriptEntries({
        agentSessionId: session.session.id,
        expectedEntryCount: 0,
        entries: [{ entry: { kind: 'message', role: 'assistant', content: '<LoomNote>简短建议。</LoomNote>' } }],
      })
      expect((await runtime.projectHistory({
        source: { kind: 'agent-session', sessionId: session.session.id },
        phase: 'display',
      })).snapshot.entries[0]?.text).toBe('\n\n**助手提示**\n\n简短建议。\n\n')
    } finally {
      await engine.close()
    }
  })

  it('leaves the note unchanged in a Session whose preset does not adopt the shared rule', async () => {
    const { engine, runtime } = fixture()
    try {
      const installed = await runtime.importExtensionPackageResources(officialPackage())
      const ruleId = installed.transformRules.find(item => item.contributionId === 'assistant-note')!.ruleId
      const preset = await runtime.createPromptResource({ resourceKind: 'preset', name: 'Without assistant note rule' })
      const session = await runtime.createAgentSession({ agentPresetId: preset.resource.id })
      const original = '<LoomNote>简短建议。</LoomNote>'
      await runtime.appendAgentTranscriptEntries({
        agentSessionId: session.session.id,
        expectedEntryCount: 0,
        entries: [{ entry: { kind: 'message', role: 'assistant', content: original } }],
      })

      expect((await runtime.projectHistory({
        source: { kind: 'agent-session', sessionId: session.session.id },
        phase: 'display',
      })).snapshot.entries[0]?.text).toBe(original)
      expect((await runtime.getTextTransformRule({ ruleId })).rule.enabled).toBe(false)
    } finally {
      await engine.close()
    }
  })
})
