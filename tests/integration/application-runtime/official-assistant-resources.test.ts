import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { createBlobStore } from '@loom-studio/asset-store'
import { describe, expect, it, onTestFinished } from 'vitest'
import { createAgentStore, createNarrativeStore, createPromptResourceStore } from '@loom-studio/application-data'
import { createApplicationRuntime, createOfficialAgentToolRegistry, type ImportExtensionPackageResourcesInput } from '@loom-studio/application-runtime'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createId, nowIso } from '@loom-studio/shared'

function readOfficialJson(path: string) {
  return JSON.parse(readFileSync(new URL(`../../../official/extensions/loom-assistant/${path}`, import.meta.url), 'utf8'))
}

function fixture() {
  const engine = createSqliteDataEngine({ filename: ':memory:', createId, now: nowIso })
  const blobDirectory = mkdtempSync(join(tmpdir(), 'loom-official-assistant-resources-blobs-'))
  onTestFinished(() => rmSync(blobDirectory, { recursive: true, force: true }))
  const blobs = createBlobStore({ engine, rootDirectory: blobDirectory, createId, now: nowIso })
  const documents = createSqliteDocumentStore({ engine })
  const promptResources = createPromptResourceStore({ engine })
  const agents = createAgentStore({ engine })
  const narratives = createNarrativeStore({ engine })
  const runtime = createApplicationRuntime({
    blobs, dataEngine: engine,
    documents,
    promptResources,
    agentTools: createOfficialAgentToolRegistry(),
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
  // This suite imports the package text resources independently of its optional Script mounts.
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

describe.skipIf(!existsSync(new URL('../../../official/extensions/loom-assistant/manifest.json', import.meta.url)))('official Loom Assistant resources', () => {

  it('builds Nom product guidance and selects topic knowledge without unrelated notes', async () => {
    const { engine, runtime } = fixture()
    try {
      const input = officialPackage()
      // Knowledge validation is independent of the concurrently changing text pipeline.
      input.transformRules = []
      input.textExtractors = []
      for (const item of input.promptResources ?? []) {
        delete item.contribution.textUses
        delete item.contribution.scriptMounts
      }
      const installed = await runtime.importExtensionPackageResources(input)
      const presetId = installed.promptResources.find(item => item.contributionId === 'official.loom-assistant.preset')!.resourceId
      const preset = (await runtime.getAgentPreset({ agentPresetId: presetId })).agentPreset
      const provider = await runtime.createProviderProfile({ providerExtensionId: 'official.openai-compatible', displayName: 'Knowledge check', config: {}, enabledModelIds: ['knowledge-test'] })
      await runtime.updateAgentPreset({ agentPresetId: presetId, expectedVersion: preset.version, model: { providerProfileId: provider.providerProfile.id, modelId: 'knowledge-test' } })
      const session = await runtime.createAgentSession({ agentPresetId: presetId })
      const text = async (input: string) => (await runtime.previewAgentTurn({ agentSessionId: session.session.id, input })).projection.messages.map(message => message.content).join('\n')
      const toolsPreview = await runtime.previewAgentTurn({ agentSessionId: session.session.id, input: '寻找知识' })
      expect(toolsPreview.toolExposures.map(tool => tool.toolId)).toEqual(expect.arrayContaining(['official/search_context', 'official/read_context']))
      const authoring = await runtime.captureResourceAuthoring({ resourceId: presetId })
      expect(authoring.resource.toolMounts).toEqual(expect.arrayContaining([
        expect.objectContaining({ reference: { kind: 'host', toolId: 'official/search_context' } }),
        expect.objectContaining({ reference: { kind: 'host', toolId: 'official/read_context' } }),
      ]))
      const overview = await text('你好，介绍一下这个项目')
      expect(overview).toContain('你是诺姆（Nom）')
      expect(overview).toContain('Loom Studio 是面向 AI 角色扮演与交互叙事创作的平台')
      expect(overview).not.toContain('<LoomNote>这里填写简短的使用建议。</LoomNote>')
      expect(overview).not.toContain('尚未建立玩家 State 的旧故事')
      expect(await text('修改我的玩家资料会影响已有故事吗')).toContain('已有副本不会跟随全局模板')
      expect(await text('为什么我的知识不生效')).toContain('条目和祖先文件夹是否启用')
      expect(await text('展示助手提示')).toContain('<LoomNote>这里填写简短的使用建议。</LoomNote>')
    } finally { await engine.close() }
  })

  it('imports the declared Setting and Display rule and projects assistant notes', async () => {
    const { engine, runtime } = fixture()
    try {
      const input = officialPackage()
      const installed = await runtime.importExtensionPackageResources(input)
      const presetId = installed.promptResources.find(item => item.contributionId === 'official.loom-assistant.preset')!.resourceId
      const loreId = installed.promptResources.find(item => item.contributionId === 'official.loom-assistant.knowledge')!.resourceId
      const ruleId = installed.transformRules.find(item => item.contributionId === 'assistant-note')!.ruleId
      const preset = (await runtime.getAgentPreset({ agentPresetId: presetId })).agentPreset
      const mounts = await runtime.listLoreMounts({ source: { kind: 'preset', id: presetId } })

      expect(mounts.mounts).toEqual(expect.arrayContaining([
        expect.objectContaining({ loreResourceId: loreId, resolvedLoreResourceId: loreId }),
      ]))
      expect(preset.textUses).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'rule', id: ruleId, enabled: true }),
      ]))
      expect((await runtime.getTextTransformRule({ ruleId })).rule.enabled).toBe(false)

      const provider = await runtime.createProviderProfile({
        providerExtensionId: 'official.openai-compatible',
        displayName: 'Test Provider',
        config: {},
        enabledModelIds: ['test'],
      })
      await runtime.updateAgentPreset({
        agentPresetId: presetId,
        expectedVersion: preset.version,
        model: { providerProfileId: provider.providerProfile.id, modelId: 'test' },
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
