import { createAgentStore, createNarrativeStore, createPromptResourceStore } from '@loom-studio/application-data'
import type { AiGatewayRequest } from '@loom-studio/ai-gateway'
import { createAgentToolRegistry, createApplicationRuntime, composeAgentTurnPrompt, type ToolDefinition } from '@loom-studio/application-runtime'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import type { PromptResourceNode } from '../../../packages/application-runtime/src/cards/workspace-types.js'
import { describe, expect, it } from 'vitest'

function createFixture(tools: ToolDefinition[] = []) {
  let sequence = 0
  const createId = (prefix: string) => `${prefix}-${++sequence}`
  const now = () => '2026-09-21T00:00:00.000Z'
  const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
  const promptResources = createPromptResourceStore({ engine, createId, now })
  const calls: Array<Pick<AiGatewayRequest, 'messages' | 'tools'>> = []
  const runtime = createApplicationRuntime({
    dataEngine: engine,
    documents: createSqliteDocumentStore({ engine }),
    agents: createAgentStore({ engine, createId, now }),
    narratives: createNarrativeStore({ engine, createId, now }),
    promptResources,
    agentTools: createAgentToolRegistry(tools, tools.map(tool => ({
      toolId: tool.id,
      execute: ({ invocation }) => ({
        invocationId: invocation.id, toolId: tool.id, status: 'completed' as const, content: [],
      }),
    }))),
    gateway: {
      invokeChat: async input => {
        calls.push(structuredClone({ messages: input.request.messages, tools: input.request.tools }))
        return {
          provider: 'fake', model: 'test-model',
          message: { role: 'assistant', content: 'SESSION_REPLY' }, text: 'SESSION_REPLY',
        }
      },
    },
  })
  return { engine, runtime, promptResources, calls }
}

function flatten(node: PromptResourceNode): PromptResourceNode[] {
  return [node, ...(node.children ?? []).flatMap(flatten)]
}

describe('bundled default preset', () => {
  it('connects native sources to the final provider request without merging Session messages', async () => {
    const tools: ToolDefinition[] = [
      {
        id: 'test/native', owner: { namespace: 'test' }, name: 'native_read',
        description: 'NATIVE_SCHEMA_ONLY',
        input: { kind: 'structured', schema: { type: 'object', properties: {} } },
      },
      {
        id: 'test/content', owner: { namespace: 'test' }, name: 'content_write',
        description: 'CONTENT_TOOL_DEFINITION',
        input: { kind: 'freeform', mediaType: 'text/plain' },
      },
    ]
    const { engine, runtime, calls } = createFixture(tools)
    try {
      const { resource: preset } = await runtime.createPromptResource({ resourceKind: 'preset', name: 'Default Copy' })
      await runtime.replacePresetToolMounts({
        presetId: preset.id,
        mounts: tools.map((tool, index) => ({ toolId: tool.id, orderIndex: index, defaultEnabled: true })),
      })
      const { resource: setting } = await runtime.createPromptResource({ resourceKind: 'setting', name: 'Story' })
      for (const [id, anchor, activation] of [
        ['STABLE_SETTING', '@setting.stable', { kind: 'always' as const }],
        ['DYNAMIC_SETTING', '@setting.lower', { kind: 'keyword' as const, keywords: ['CURRENT_INPUT'] }],
      ] as const) {
        await runtime.createPromptResourceAsset({
          resourceId: setting.id, targetAssetId: setting.rootNode.id, position: 'inside',
          asset: { id, kind: 'entry', label: id, body: id, capabilities: { targetAnchorId: anchor, activation } },
        })
      }
      await runtime.replaceSettingMounts({ source: { kind: 'manual', id: 'global' }, settingResourceIds: [setting.id] })
      const { card } = await runtime.createCard({ name: 'Story', opening: 'NARRATIVE_RAW' })
      const { timeline } = await runtime.createNarrativeTimeline({ cardId: card.id })
      await runtime.upsertTextTransformRule({
        ruleId: 'narrative-prompt-rule',
        rule: {
          name: 'Projection', owner: { kind: 'preset', presetId: preset.id }, enabled: true, orderIndex: 0,
          matcher: { kind: 'regex', pattern: 'NARRATIVE_RAW', flags: 'g' },
          effect: { kind: 'replace', replacement: 'NARRATIVE_PROJECTED' },
          targets: ['narrative'], phases: ['prompt'],
        },
      })
      const { providerProfile } = await runtime.createProviderProfile({
        providerExtensionId: 'official.openai-compatible', displayName: 'Test', config: {}, enabledModelIds: ['test-model'],
      })
      const { agentProfile } = await runtime.createAgentProfile({
        name: 'Writer', presetId: preset.id,
        model: { providerProfileId: providerProfile.id, modelId: 'test-model' },
      })
      const { session } = await runtime.createAgentSession({ agentProfileId: agentProfile.id, timelineId: timeline.id })
      await runtime.invokeAgentTurn({ agentSessionId: session.id, input: 'PREVIOUS_USER' })
      const preview = await runtime.previewAgentTurn({ agentSessionId: session.id, input: 'CURRENT_INPUT' })
      await runtime.invokeAgentTurn({ agentSessionId: session.id, input: 'CURRENT_INPUT' })
      const request = calls[1]!
      expect(request.messages).toEqual(preview.messages)
      expect(request.messages.map(message => message.role)).toEqual([
        'system', 'system', 'system', 'developer', 'user', 'assistant', 'system', 'user',
      ])
      const contents = request.messages.map(message => message.content)
      expect(contents[0]).toContain('清晰自然')
      expect(contents[1]).toContain('CONTENT_TOOL_DEFINITION')
      expect(contents[2]).toContain('<setting>\n\nSTABLE_SETTING\n\n</setting>')
      expect(contents.slice(3)).toEqual([
        'NARRATIVE_PROJECTED', 'PREVIOUS_USER', 'SESSION_REPLY', 'DYNAMIC_SETTING', 'CURRENT_INPUT',
      ])
      expect(request.messages.slice(0, 4)).toEqual(calls[0]!.messages.slice(0, 4))
      expect(JSON.stringify(request.messages)).not.toMatch(/NARRATIVE_RAW|NATIVE_SCHEMA_ONLY|\{\{/)
      expect(preview.macroInspection.entries.filter(entry => entry.name.startsWith('writing.')))
        .toHaveLength(3)
      expect(JSON.stringify(request.tools)).toContain('NATIVE_SCHEMA_ONLY')
      expect(JSON.stringify(request.tools)).not.toContain('CONTENT_TOOL_DEFINITION')
      expect(preview.toolExposures.map(tool => tool.transport)).toEqual(['native-function', 'content'])
      expect((await runtime.getNarrativePage({ timelineId: timeline.id })).nodes[0]!.body.raw).toBe('NARRATIVE_RAW')
    } finally {
      engine.close()
    }
  })

  it('instantiates independent nodes and macros for new and duplicated resources', async () => {
    const { engine, runtime } = createFixture()
    try {
      const first = (await runtime.createPromptResource({ resourceKind: 'preset', name: 'First' })).resource
      const second = (await runtime.createPromptResource({ resourceKind: 'preset', name: 'Second' })).resource
      const copy = (await runtime.duplicatePromptResource({ resourceId: first.id, name: 'Copy' })).resource
      const ids = [first, second, copy].flatMap(resource => flatten(resource.rootNode).map(node => node.id))
      expect(new Set(ids).size).toBe(ids.length)
      const firstEntry = flatten(copy.rootNode).find(node => node.kind === 'entry')!
      const updated = await runtime.updatePromptResourceAsset({ resourceId: copy.id, assetId: firstEntry.id, body: 'COPY_ONLY' })
      await runtime.updatePromptResourceMacros({
        resourceId: copy.id, expectedVersion: updated.resource.version, macros: { 'writing.style': 'COPY_STYLE' },
      })
      expect((await runtime.getPromptResource({ resourceId: first.id })).resource).toEqual(first)
      expect((await runtime.getPromptResource({ resourceId: second.id })).resource).toEqual(second)
      const changed = (await runtime.getPromptResource({ resourceId: copy.id })).resource
      expect(flatten(changed.rootNode).find(node => node.id === firstEntry.id)?.body).toBe('COPY_ONLY')
      expect(changed.macros?.['writing.style']).toBe('COPY_STYLE')
    } finally {
      engine.close()
    }
  })

  it('routes reserved contributions to separate ordered regions and leaves empty regions absent', async () => {
    const { engine, runtime, promptResources } = createFixture()
    try {
      const { resource: preset } = await runtime.createPromptResource({ resourceKind: 'preset', name: 'Slots' })
      const anchors = [
        '@memory.narrative', '@memory.session', '@runtime.state', '@memory.recalled',
        '@tools.dynamic', '@prompt.tail', '@fresh.tail', '@runtime.workspace', '@runtime.notices',
      ]
      const result = await composeAgentTurnPrompt({
        preset, promptResources, agentMessages: [], userInput: 'LATEST_INPUT',
        externalRuntime: {
          sourceNodes: [],
          contributions: anchors.map(anchor => ({
            id: anchor, sourceRef: { kind: 'runtime', sourceId: 'test', sourceNodeId: anchor },
            content: anchor, capabilities: { targetAnchorId: anchor },
          })),
        },
      })
      expect(result.messages.map(message => message.content).slice(2)).toEqual([
        '@memory.narrative', '@memory.session', '@runtime.state\n\n@memory.recalled\n\n@tools.dynamic',
        'LATEST_INPUT', '@prompt.tail\n\n@fresh.tail', '@runtime.workspace', '@runtime.notices',
      ])
      const empty = await composeAgentTurnPrompt({ preset, promptResources, agentMessages: [], userInput: 'LATEST_INPUT' })
      expect(empty.messages).toHaveLength(3)
    } finally {
      engine.close()
    }
  })

  it('keeps new inline entries at their tree position and honors ancestor switches and activation', async () => {
    const { engine, runtime, promptResources } = createFixture()
    try {
      const { resource: preset } = await runtime.createPromptResource({ resourceKind: 'preset', name: 'Editing' })
      const inputBlock = preset.rootNode.children!.find(node => node.capabilities?.roleHint === 'user')!
      const inserted = await runtime.createPromptResourceAsset({
        resourceId: preset.id, targetAssetId: inputBlock.id, position: 'inside',
        asset: { id: 'inline-example', kind: 'entry', label: 'After input', body: 'INLINE_AFTER_INPUT' },
      })
      const compile = async (userInput: string) => composeAgentTurnPrompt({
        preset: (await runtime.getPromptResource({ resourceId: preset.id })).resource,
        promptResources, agentMessages: [], userInput,
      })
      expect(flatten(inserted.resource.rootNode).find(node => node.body === 'INLINE_AFTER_INPUT')?.capabilities?.targetAnchorId)
        .toBeUndefined()
      expect((await compile('CURRENT')).messages.at(-1))
        .toMatchObject({ role: 'user', content: 'CURRENT\n\nINLINE_AFTER_INPUT' })
      await runtime.updatePromptResourceAsset({
        resourceId: preset.id, assetId: inputBlock.id,
        capabilities: { roleHint: 'user', activation: { kind: 'keyword', keywords: ['MATCH'] } },
      })
      expect(JSON.stringify((await compile('NO')).messages)).not.toContain('INLINE_AFTER_INPUT')
      expect(JSON.stringify((await compile('MATCH')).messages)).toContain('INLINE_AFTER_INPUT')
      await runtime.updatePromptResourceAsset({ resourceId: preset.id, assetId: inputBlock.id, enabled: false })
      expect(JSON.stringify((await compile('MATCH')).messages)).not.toContain('INLINE_AFTER_INPUT')
    } finally {
      engine.close()
    }
  })
})
