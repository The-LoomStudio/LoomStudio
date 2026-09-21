import { createAgentStore, createNarrativeStore, createPromptResourceStore } from '@loom-studio/application-data'
import { createApplicationRuntime, createOfficialAgentToolRegistry } from '@loom-studio/application-runtime'
import type { GatewayChatResult } from '@loom-studio/application-runtime'
import type { AiGatewayRequest } from '@loom-studio/ai-gateway'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { describe, expect, it } from 'vitest'

async function fixture(mode: 'content' | 'json', finishReason: GatewayChatResult['finishReason'] = 'tool_call', code?: string) {
  let sequence = 0
  const createId = (prefix: string) => `${prefix}-${++sequence}`
  const now = () => '2026-09-21T00:00:00.000Z'
  const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
  const agents = createAgentStore({ engine, createId, now })
  const calls: Array<Pick<AiGatewayRequest, 'messages' | 'tools'>> = []
  const toolId = mode === 'content' ? 'official/codeact' : 'official/codeact_json'
  const source = code ?? 'const result = await ctx.search({path:"/context", terms:["KEY_SENTINEL"]}); print(result);'
  const runtime = createApplicationRuntime({
    dataEngine: engine, documents: createSqliteDocumentStore({ engine }),
    agents, narratives: createNarrativeStore({ engine, createId, now }),
    promptResources: createPromptResourceStore({ engine, createId, now }),
    agentTools: createOfficialAgentToolRegistry(),
    gateway: {
      invokeChat: async input => {
        calls.push(structuredClone({ messages: input.request.messages, tools: input.request.tools }))
        if (calls.length > 1) return {
          provider: 'test', model: 'test', message: { role: 'assistant', content: 'DONE' }, text: 'DONE', finishReason: 'stop',
        }
        const content = mode === 'content' ? `<loom_tool name="codeact"><metadata>{}</metadata><content>${source}</content></loom_tool>` : ''
        return {
          provider: 'test', model: 'test', text: content, finishReason,
          message: {
            role: 'assistant', content,
            ...(mode === 'json' ? { tool_calls: [{
              id: 'provider-call-1', type: 'function',
              function: { name: 'codeact_json', arguments: JSON.stringify({ code: source }) },
            }] } : {}),
          },
        }
      },
    },
  })
  await runtime.initialize()
  const { resource: preset } = await runtime.createPromptResource({ resourceKind: 'preset', name: 'Writer' })
  await runtime.replacePresetToolMounts({
    presetId: preset.id,
    mounts: [{ toolId, defaultEnabled: true, orderIndex: 0 }],
  })
  const { resource: setting } = await runtime.createPromptResource({ resourceKind: 'setting', name: 'World' })
  await runtime.createPromptResourceAsset({
    resourceId: setting.id, targetAssetId: setting.rootNode.id, position: 'inside',
    asset: { id: 'key-setting', kind: 'entry', label: 'Key', body: 'KEY_SENTINEL belongs to C.', capabilities: { targetAnchorId: '@setting.stable' } },
  })
  await runtime.replaceSettingMounts({ source: { kind: 'manual', id: 'global' }, settingResourceIds: [setting.id] })
  const { providerProfile } = await runtime.createProviderProfile({
    providerExtensionId: 'official.openai-compatible', displayName: 'Test', config: {}, enabledModelIds: ['test'],
  })
  const { agentProfile } = await runtime.createAgentProfile({
    name: 'Writer', presetId: preset.id, model: { providerProfileId: providerProfile.id, modelId: 'test' },
  })
  const { session } = await runtime.createAgentSession({ agentProfileId: agentProfile.id })
  return { runtime, engine, calls, agents, session, toolId, preset, setting }
}

describe('CodeAct production tool loop', () => {
  it.each(['content', 'json'] as const)('connects the real resource mount to %s without exposing node IDs', async mode => {
    const f = await fixture(mode, 'stop', 'print(await ctx.read("/resources/World/Key.md"));')
    try {
      await f.runtime.invokeAgentTurn({ agentSessionId: f.session.id, input: 'Read source.' })
      const { entries } = await f.agents.getEntryPage({ agentSessionId: f.session.id, limit: 100 })
      const result = entries.find(entry => entry.entry.kind === 'tool-result')!.entry
      expect(result).toMatchObject({ status: 'completed' })
      expect(JSON.stringify(result)).toContain('KEY_SENTINEL belongs to C.')
      expect(JSON.stringify(result)).toContain('loom-resource://prompt-resource')
    } finally {
      f.engine.close()
    }
  })

  it.each(['content', 'json'] as const)('writes a fully read Prompt Resource through %s', async mode => {
    const f = await fixture(mode, 'stop', 'await ctx.read("/resources/World/Key.md"); print(await ctx.write("/resources/World/Key.md", "KEY_UPDATED"));')
    try {
      await f.runtime.invokeAgentTurn({ agentSessionId: f.session.id, input: 'Update the key note.' })
      const { entries } = await f.agents.getEntryPage({ agentSessionId: f.session.id, limit: 100 })
      const result = entries.find(entry => entry.entry.kind === 'tool-result')!.entry
      expect(result).toMatchObject({ status: 'completed' })
      expect(JSON.stringify(result)).toContain('\\"modified\\":true')
      await expect(f.runtime.getPromptResource({ resourceId: f.setting.id }))
        .resolves.toMatchObject({ resource: { rootNode: { children: [{ body: 'KEY_UPDATED' }] } } })
    } finally {
      f.engine.close()
    }
  })

  it.each(['content', 'json'] as const)('writes node Metadata through %s', async mode => {
    const path = '/resources/World/Key.md.meta.yaml'
    const f = await fixture(mode, 'stop', `await ctx.read(${JSON.stringify(path)}); print(await ctx.write(${JSON.stringify(path)}, "label: Key Note\\nmeta: owned by A\\n"));`)
    try {
      await f.runtime.invokeAgentTurn({ agentSessionId: f.session.id, input: 'Update the key note metadata.' })
      const { entries } = await f.agents.getEntryPage({ agentSessionId: f.session.id, limit: 100 })
      expect(entries.find(entry => entry.entry.kind === 'tool-result')!.entry).toMatchObject({ status: 'completed' })
      await expect(f.runtime.getPromptResource({ resourceId: f.setting.id }))
        .resolves.toMatchObject({ resource: { rootNode: { children: [{ label: 'Key Note', meta: 'owned by A' }] } } })
    } finally {
      f.engine.close()
    }
  })

  it.each(['content', 'json'] as const)('patches source through %s and preserves it after a later failure', async mode => {
    const path = '/resources/World/Key.md'
    const diff = `--- ${path}\n+++ ${path}\n@@ -20 +20 @@\n-KEY_SENTINEL belongs to C.\n+KEY_SENTINEL belongs to A.\n`
    const f = await fixture(mode, 'stop', `await ctx.read(${JSON.stringify(path)}); await ctx.patch(${JSON.stringify(path)}, ${JSON.stringify(diff)}); await ctx.read("/not-mounted");`)
    try {
      await f.runtime.invokeAgentTurn({ agentSessionId: f.session.id, input: 'Transfer the key.' })
      const { entries } = await f.agents.getEntryPage({ agentSessionId: f.session.id, limit: 100 })
      const result = entries.find(entry => entry.entry.kind === 'tool-result')!.entry
      expect(result).toMatchObject({ status: 'failed', error: { code: 'vfs.not_found' } })
      expect(JSON.stringify(result)).toContain(`${path}: modified; changeset`)
      await expect(f.runtime.getPromptResource({ resourceId: f.setting.id }))
        .resolves.toMatchObject({ resource: { rootNode: { children: [{ body: 'KEY_SENTINEL belongs to A.' }] } } })
    } finally { f.engine.close() }
  })

  it.each(['content', 'json'] as const)('executes %s and injects the same tutorial once in the stable anchor', async mode => {
    const f = await fixture(mode)
    try {
      const preview = await f.runtime.previewAgentTurn({ agentSessionId: f.session.id, input: 'Find the key.' })
      await f.runtime.invokeAgentTurn({ agentSessionId: f.session.id, input: 'Find the key.' })
      expect(f.calls).toHaveLength(2)
      expect(f.calls[0]!.messages).toEqual(preview.messages)
      const text = f.calls[0]!.messages.map(message => message.content).join('\n')
      expect(text.match(/### ctx\.read/g)).toHaveLength(1)
      expect(text.indexOf('## CodeAct')).toBeLessThan(text.indexOf('KEY_SENTINEL'))
      expect(text.match(/### ctx\.write/g)).toHaveLength(1)
      expect(JSON.stringify(f.calls[0]!.tools ?? [])).not.toContain('### ctx.read')
      const second = f.calls[1]!.messages
      expect(second.some(message => message.content?.includes('KEY_SENTINEL belongs to C.')
        && (mode === 'json' ? message.role === 'tool' : message.content.includes('loom_tool_result')))).toBe(true)
      const { entries } = await f.agents.getEntryPage({ agentSessionId: f.session.id, limit: 100 })
      const invocation = entries.find(entry => entry.entry.kind === 'tool-invocation')!.entry
      expect(invocation).toMatchObject({ toolId: f.toolId, transport: mode === 'content' ? 'content' : 'native-function' })
      expect(entries.find(entry => entry.entry.kind === 'tool-result')!.entry).toMatchObject({ status: 'completed', toolId: f.toolId })
      expect(entries.filter(entry => entry.entry.kind === 'message' && entry.entry.role === 'assistant')
        .map(entry => entry.entry.kind === 'message' ? entry.entry.content : '')).toEqual(['DONE'])
    } finally {
      f.engine.close()
    }
  })

  it.each(['content', 'json'] as const)('does not execute %s when the Provider reports truncation', async mode => {
    const f = await fixture(mode, 'length', 'print("MUST_NOT_EXECUTE");')
    try {
      await f.runtime.invokeAgentTurn({ agentSessionId: f.session.id, input: 'Run it.' })
      const { entries } = await f.agents.getEntryPage({ agentSessionId: f.session.id, limit: 100 })
      expect(entries.find(entry => entry.entry.kind === 'tool-result')!.entry)
        .toMatchObject({ status: 'failed', error: { code: 'codeact.incomplete_step' } })
    } finally {
      f.engine.close()
    }
  })

  it.each(['content', 'json'] as const)('preserves Unicode, quotes and JS escapes through %s', async mode => {
    const source = String.raw`const text = "她说：\"你好\"\nC:\\notes";
print(text);`
    const f = await fixture(mode, 'stop', source)
    try {
      await f.runtime.invokeAgentTurn({ agentSessionId: f.session.id, input: 'Run.' })
      const { entries } = await f.agents.getEntryPage({ agentSessionId: f.session.id, limit: 100 })
      expect(entries.find(entry => entry.entry.kind === 'tool-result')!.entry)
        .toMatchObject({ status: 'completed', content: [{ type: 'text', text: '她说："你好"\nC:\\notes' }] })
    } finally {
      f.engine.close()
    }
  })

  it('diagnoses a disabled tutorial anchor without moving instructions elsewhere', async () => {
    const f = await fixture('json')
    try {
      const toolsBlock = f.preset.rootNode.children!.find(node => node.children?.some(child => child.capabilities?.targetAnchorId === '@chat.tools'))!
      await f.runtime.updatePromptResourceAsset({ resourceId: f.preset.id, assetId: toolsBlock.id, enabled: false })
      const preview = await f.runtime.previewAgentTurn({ agentSessionId: f.session.id, input: 'Inspect.' })
      expect(JSON.stringify(preview.messages)).not.toContain('### ctx.read')
      expect(JSON.stringify(preview)).toContain('codeact.instructions_unmounted')
    } finally {
      f.engine.close()
    }
  })

  it('does not execute Content JavaScript altered by an assistant text transform', async () => {
    const f = await fixture('content', 'stop', 'print("BEFORE_TRANSFORM");')
    try {
      await f.runtime.upsertTextTransformRule({
        ruleId: 'codeact-text-rule',
        rule: {
          name: 'Replace text', owner: { kind: 'preset', presetId: f.preset.id }, enabled: true, orderIndex: 0,
          matcher: { kind: 'regex', pattern: 'BEFORE_TRANSFORM', flags: 'g' },
          effect: { kind: 'replace', replacement: 'AFTER_TRANSFORM' },
          targets: ['agent-session'], phases: ['classify'],
        },
      })
      await f.runtime.invokeAgentTurn({ agentSessionId: f.session.id, input: 'Run.' })
      const { entries } = await f.agents.getEntryPage({ agentSessionId: f.session.id, limit: 100 })
      expect(entries.find(entry => entry.entry.kind === 'tool-result')!.entry)
        .toMatchObject({ status: 'failed', error: { code: 'codeact.source_transformed' } })
    } finally {
      f.engine.close()
    }
  })

  it('preserves edited guidance and existing mounts on reinitialization; new mounts stay disabled', async () => {
    const f = await fixture('json')
    try {
      const tool = (await f.runtime.listAgentTools()).tools.find(tool => tool.id === f.toolId)!
      await f.runtime.updateAgentTool({
        toolId: tool.id, expectedVersion: tool.version,
        definition: {
          id: tool.id, owner: tool.owner, name: tool.name, description: tool.description, input: tool.input,
          prompt: { ...tool.prompt, guidance: 'CUSTOM_CODEACT_GUIDE' },
        },
      })
      const before = await f.runtime.listPresetToolMounts({ presetId: f.preset.id })
      await f.runtime.initialize()
      expect(await f.runtime.listPresetToolMounts({ presetId: f.preset.id })).toEqual(before)
      const preview = await f.runtime.previewAgentTurn({ agentSessionId: f.session.id, input: 'Inspect.' })
      const text = preview.messages.map(message => message.content).join('\n')
      expect(text.match(/CUSTOM_CODEACT_GUIDE/g)).toHaveLength(1)
      expect(text).not.toContain('### ctx.read')
      const { resource } = await f.runtime.createPromptResource({ resourceKind: 'preset', name: 'New' })
      const { mounts } = await f.runtime.listPresetToolMounts({ presetId: resource.id })
      expect(mounts.filter(mount => mount.toolId.startsWith('official/codeact'))).toHaveLength(2)
      expect(mounts.every(mount => !mount.defaultEnabled)).toBe(true)
    } finally {
      f.engine.close()
    }
  })
})
