import { createAgentStore, createNarrativeStore, createPromptResourceStore } from '@loom-studio/application-data'
import { createApplicationRuntime, createNarrativeContextRegistry, createOfficialAgentToolRegistry } from '@loom-studio/application-runtime'
import type { GatewayChatResult } from '@loom-studio/application-runtime'
import type { AiGatewayRequest } from '@loom-studio/ai-gateway'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { describe, expect, it } from 'vitest'
import type { VfsMutationPreview } from '../../../packages/application-runtime/src/vfs/types.js'

function authorContext() {
  return { agentRun: {
    runId: 'author-test-run', onEvent: () => {},
    onMutationApproval: async (_preview: VfsMutationPreview) => ({ decision: 'allow' as const }),
  } }
}

async function fixture(mode: 'content' | 'json', finishReason: GatewayChatResult['finishReason'] = 'tool_call', code?: string, cancelAfterAppend?: AbortController) {
  let sequence = 0
  const createId = (prefix: string) => `${prefix}-${++sequence}`
  const now = () => '2026-09-21T00:00:00.000Z'
  const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
  const agents = createAgentStore({ engine, createId, now })
  const calls: Array<Pick<AiGatewayRequest, 'messages' | 'tools'>> = []
  const toolId = mode === 'content' ? 'official/codeact' : 'official/codeact_json'
  const source = code ?? 'const result = await ctx.search({path:"/context", terms:["KEY_SENTINEL"]}); print(result);'
  const narrativeContext = createNarrativeContextRegistry()
  const narratives = createNarrativeStore({ engine, createId, now })
  const runtime = createApplicationRuntime({
    dataEngine: engine, documents: createSqliteDocumentStore({ engine }),
    agents, narratives: cancelAfterAppend ? {
      ...narratives,
      appendNode: async (input) => {
        const result = await narratives.appendNode(input)
        if (input.body.raw === 'CANCELLED_STORY') cancelAfterAppend.abort('user-cancel')
        return result
      },
    } : narratives, narrativeContext,
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
  const { agentPreset } = await runtime.updateAgentPreset({
    name: 'Writer', agentPresetId: preset.id, expectedVersion: (await runtime.getPromptResource({ resourceId: preset.id })).resource.version, model: { providerProfileId: providerProfile.id, modelId: 'test' },
  })
  const { session } = await runtime.createAgentSession({ agentPresetId: agentPreset.id })
  return { runtime, engine, calls, agents, session, toolId, preset, setting, narrativeContext }
}

describe('CodeAct production tool loop', () => {
  it('returns a corrective error for JSON-wrapped Freeform code and continues the Run', async () => {
    const f = await fixture('content', 'stop', JSON.stringify({ code: 'throw new Error("MUST_NOT_EXECUTE")' }))
    try {
      await f.runtime.invokeAgentTurn({ agentSessionId: f.session.id, input: 'Use CodeAct.' })
      const { entries } = await f.agents.getEntryPage({ agentSessionId: f.session.id, limit: 100 })
      const result = entries.find(entry => entry.entry.kind === 'tool-result')!.entry
      expect(result).toMatchObject({ status: 'failed', error: { code: 'codeact.json_envelope' } })
      expect(f.calls).toHaveLength(2)
      expect(JSON.stringify(f.calls[1]!.messages)).toContain('Nothing was executed')
      expect(entries.some(entry => entry.entry.kind === 'run-state' && entry.entry.state === 'suspended')).toBe(false)
      expect(entries.at(-1)!.entry).toMatchObject({ kind: 'run-state', state: 'completed' })
    } finally { f.engine.close() }
  })

  it.each(['content', 'json'] as const)('requires approval before exposing author metadata through %s', async mode => {
    const f = await fixture(mode, 'stop', `
print(await ctx.ls("/resources/World"));
try { await ctx.read("/resources/World/@meta.yaml"); } catch (e) { print(e.code); }
await ctx.setAuthorMode(true);
print(await ctx.read("/resources/World/@meta.yaml"));
`)
    try {
      const previews: string[] = []
      const context = authorContext()
      context.agentRun.onMutationApproval = async preview => {
        previews.push(preview.action)
        return { decision: 'allow' }
      }
      await f.runtime.invokeAgentTurn({ agentSessionId: f.session.id, input: 'Edit resources.' }, context)
      const { entries } = await f.agents.getEntryPage({ agentSessionId: f.session.id, limit: 100 })
      const result = entries.find(entry => entry.entry.kind === 'tool-result')!.entry
      expect(result).toMatchObject({ status: 'completed' })
      expect(previews).toEqual(['author-mode'])
      expect(JSON.stringify(result)).toContain('vfs.not_found')
      expect(JSON.stringify(result)).toContain('label: World')
    } finally { f.engine.close() }
  })

  it.each(['content', 'json'] as const)('reads and edits an appended Narrative via its VFS path through %s', async mode => {
    const f = await fixture(mode, 'stop', `
const result = await ctx.appendNarrative({ content: "PATH_STORY" });
print(await ctx.read(result.path));
print(await ctx.write(result.path, "EDITED_STORY"));
`)
    try {
      const { card } = await f.runtime.createCard({ name: 'Story', opening: 'OPENING' })
      const { timeline } = await f.runtime.createNarrativeTimeline({ cardId: card.id })
      const before = await f.runtime.getNarrativePage({ timelineId: timeline.id })
      f.narrativeContext.register({ id: 'test.memory', resolve: async () => ({
        version: 'initial', memory: null, rawThroughNodeId: before.branch.headNodeId!,
      }) })
      await f.runtime.invokeAgentTurn({
        agentSessionId: f.session.id, input: 'Write and edit.', narrativeTarget: { timelineId: timeline.id },
      }, authorContext())
      const page = await f.runtime.getNarrativePage({ timelineId: timeline.id })
      expect(page.nodes.map(node => node.body.raw)).toEqual(['OPENING', 'EDITED_STORY'])
      const { entries } = await f.agents.getEntryPage({ agentSessionId: f.session.id, limit: 100 })
      const result = entries.find(entry => entry.entry.kind === 'tool-result')!.entry
      expect(result).toMatchObject({ status: 'completed' })
      expect(JSON.stringify(result)).toContain(`/narrative/${page.nodes.at(-1)!.id}.md`)
    } finally { f.engine.close() }
  })

  it('does not overwrite a Narrative changed by the user during approval', async () => {
    const f = await fixture('json', 'stop', `
const node = await ctx.appendNarrative({ content: "ORIGINAL" });
await ctx.read(node.path);
await ctx.write(node.path, "STALE_AGENT_EDIT");
`)
    try {
      const { card } = await f.runtime.createCard({ name: 'Story', opening: 'OPENING' })
      const { timeline } = await f.runtime.createNarrativeTimeline({ cardId: card.id })
      const before = await f.runtime.getNarrativePage({ timelineId: timeline.id })
      f.narrativeContext.register({ id: 'test.memory', resolve: async () => ({
        version: 'initial', memory: null, rawThroughNodeId: before.branch.headNodeId!,
      }) })
      const context = authorContext()
      context.agentRun.onMutationApproval = async () => {
        const current = await f.runtime.getNarrativePage({ timelineId: timeline.id })
        const node = current.nodes.at(-1)!
        await f.runtime.editNarrativeNode({
          timelineId: timeline.id, branchId: current.branch.id, nodeId: node.id,
          expectedHeadNodeId: current.branch.headNodeId!, expectedRaw: node.body.raw, raw: 'USER_EDIT',
        })
        return { decision: 'allow' }
      }
      await f.runtime.invokeAgentTurn({
        agentSessionId: f.session.id, input: 'Edit.', narrativeTarget: { timelineId: timeline.id },
      }, context)
      expect((await f.runtime.getNarrativePage({ timelineId: timeline.id })).nodes.at(-1)!.body.raw).toBe('USER_EDIT')
      const { entries } = await f.agents.getEntryPage({ agentSessionId: f.session.id, limit: 100 })
      expect(entries.find(entry => entry.entry.kind === 'tool-result')!.entry).toMatchObject({ status: 'failed' })
    } finally { f.engine.close() }
  })

  it('does not bypass old-history authorization through an exact VFS path', async () => {
    const f = await fixture('json', 'stop', `
const old = await ctx.read("/narrative/node-secret.md");
print(old);
`)
    try {
      const { card } = await f.runtime.createCard({ name: 'Story' })
      const { timeline } = await f.runtime.createNarrativeTimeline({ cardId: card.id })
      await f.runtime.appendNarrativeInput({
        timelineId: timeline.id, branchId: timeline.activeBranchId,
        nodeId: 'node-secret', expectedHeadNodeId: null, content: 'SECRET_OLD_TEXT',
      })
      f.narrativeContext.register({ id: 'test.memory', resolve: async () => ({
        version: 'covered', memory: { coveredThroughNodeId: 'node-secret', entries: [{ id: 'summary', content: 'Summary' }] },
        rawThroughNodeId: 'node-secret',
      }) })
      await f.runtime.invokeAgentTurn({
        agentSessionId: f.session.id, input: 'Read.', narrativeTarget: { timelineId: timeline.id },
      })
      const { entries } = await f.agents.getEntryPage({ agentSessionId: f.session.id, limit: 100 })
      const result = entries.find(entry => entry.entry.kind === 'tool-result')!.entry
      expect(result).toMatchObject({ status: 'failed' })
      expect(JSON.stringify(result)).not.toContain('SECRET_OLD_TEXT')
    } finally { f.engine.close() }
  })

  it.each(['content', 'json'] as const)('retains a committed Narrative receipt after %s is cancelled', async mode => {
    const controller = new AbortController()
    const f = await fixture(mode, 'stop', `
await ctx.appendNarrative({ content: "CANCELLED_STORY" });
await ctx.appendNarrative({ content: "MUST_NOT_APPEND" });
`, controller)
    try {
      const { card } = await f.runtime.createCard({ name: 'Story', opening: 'OPENING' })
      const { timeline } = await f.runtime.createNarrativeTimeline({ cardId: card.id })
      const before = await f.runtime.getNarrativePage({ timelineId: timeline.id })
      await expect(f.runtime.invokeAgentTurn({
        agentSessionId: f.session.id, input: 'Write.', narrativeTarget: { timelineId: timeline.id },
      }, { abortSignal: controller.signal })).rejects.toThrow()
      expect(controller.signal.aborted).toBe(true)
      const page = await f.runtime.getNarrativePage({ timelineId: timeline.id })
      expect(page.nodes).toHaveLength(before.nodes.length + 1)
      const node = page.nodes.at(-1)!
      expect(node.body.raw).toBe('CANCELLED_STORY')
      const { entries } = await f.agents.getEntryPage({ agentSessionId: f.session.id, limit: 100 })
      const results = entries.filter(entry => entry.entry.kind === 'tool-result')
      expect(results).toHaveLength(1)
      expect(results[0]!.entry).toMatchObject({ status: 'aborted' })
      const text = JSON.stringify(results[0]!.entry)
      expect(text).toContain(node.id)
      expect(text).toContain(`/narrative/${node.id}.md`)
      expect(text).not.toContain('MUST_NOT_APPEND')
      expect(f.calls).toHaveLength(1)
    } finally { f.engine.close() }
  })

  it.each(['content', 'json'] as const)('appends one host-bound Narrative node through %s without changing resources', async mode => {
    const f = await fixture(mode, 'stop', 'print(await ctx.appendNarrative({ content: "NEW_STORY" }));')
    try {
      const { card } = await f.runtime.createCard({ name: 'Story', opening: 'OPENING' })
      const { timeline } = await f.runtime.createNarrativeTimeline({ cardId: card.id })
      const before = await f.runtime.getNarrativePage({ timelineId: timeline.id })
      await f.runtime.invokeAgentTurn({
        agentSessionId: f.session.id, input: 'Write the next paragraph.', narrativeTarget: { timelineId: timeline.id },
      })
      const after = await f.runtime.getNarrativePage({ timelineId: timeline.id })
      expect(after.nodes).toHaveLength(before.nodes.length + 1)
      expect(after.nodes.at(-1)!.body.raw).toBe('NEW_STORY')
      const { entries } = await f.agents.getEntryPage({ agentSessionId: f.session.id, limit: 100 })
      expect(entries.find(entry => entry.entry.kind === 'tool-result')!.entry).toMatchObject({ status: 'completed' })
      expect(JSON.stringify(entries)).toContain(after.nodes.at(-1)!.id)
      const resultText = JSON.stringify(entries.find(entry => entry.entry.kind === 'tool-result')!.entry)
      expect(resultText.split(`/narrative/${after.nodes.at(-1)!.id}.md`)).toHaveLength(2)
      await expect(f.runtime.getPromptResource({ resourceId: f.setting.id }))
        .resolves.toMatchObject({ resource: { rootNode: { children: [{ body: 'KEY_SENTINEL belongs to C.' }] } } })
    } finally { f.engine.close() }
  })

  it.each(['content', 'json'] as const)('reports committed Narrative IDs when %s fails afterward', async mode => {
    const f = await fixture(mode, 'stop', 'await ctx.appendNarrative({ content: "COMMITTED_STORY" }); throw new Error("later failure");')
    try {
      const { card } = await f.runtime.createCard({ name: 'Story', opening: 'OPENING' })
      const { timeline } = await f.runtime.createNarrativeTimeline({ cardId: card.id })
      await f.runtime.invokeAgentTurn({
        agentSessionId: f.session.id, input: 'Write.', narrativeTarget: { timelineId: timeline.id },
      })
      const page = await f.runtime.getNarrativePage({ timelineId: timeline.id })
      const node = page.nodes.at(-1)!
      expect(node.body.raw).toBe('COMMITTED_STORY')
      const { entries } = await f.agents.getEntryPage({ agentSessionId: f.session.id, limit: 100 })
      const result = entries.find(entry => entry.entry.kind === 'tool-result')!.entry
      expect(result).toMatchObject({ status: 'failed' })
      expect(JSON.stringify(result)).toContain(node.id)
      expect(JSON.stringify(result)).toContain(`/narrative/${node.id}.md`)
    } finally { f.engine.close() }
  })

  it.each(['content', 'json'] as const)('rejects %s Narrative append without a bound Timeline', async mode => {
    const f = await fixture(mode, 'stop', 'await ctx.appendNarrative({ content: "NOT_WRITTEN" });')
    try {
      await f.runtime.invokeAgentTurn({ agentSessionId: f.session.id, input: 'Write.' })
      const { entries } = await f.agents.getEntryPage({ agentSessionId: f.session.id, limit: 100 })
      expect(entries.find(entry => entry.entry.kind === 'tool-result')!.entry)
        .toMatchObject({ status: 'failed', error: { code: 'codeact.narrative_unavailable' } })
    } finally { f.engine.close() }
  })

  it.each(['content', 'json'] as const)('rejects %s target injection and empty content', async mode => {
    const f = await fixture(mode, 'stop', `
for (const input of [{ content: "NO", timelineId: "other" }, { content: " " }]) {
  try { await ctx.appendNarrative(input); } catch (error) { print(error.code); }
}`)
    try {
      const { card } = await f.runtime.createCard({ name: 'Story', opening: 'OPENING' })
      const { timeline } = await f.runtime.createNarrativeTimeline({ cardId: card.id })
      const before = await f.runtime.getNarrativePage({ timelineId: timeline.id })
      await f.runtime.invokeAgentTurn({
        agentSessionId: f.session.id, input: 'Write.', narrativeTarget: { timelineId: timeline.id },
      })
      const after = await f.runtime.getNarrativePage({ timelineId: timeline.id })
      expect(after.nodes).toHaveLength(before.nodes.length)
      const { entries } = await f.agents.getEntryPage({ agentSessionId: f.session.id, limit: 100 })
      expect(entries.find(entry => entry.entry.kind === 'tool-result')!.entry)
        .toMatchObject({ status: 'completed', content: [{ type: 'text', text: 'codeact.invalid_arguments\ncodeact.invalid_arguments' }] })
    } finally { f.engine.close() }
  })

  it.each(['content', 'json'] as const)('shares host-selected Narrative processing with %s tools', async mode => {
    const f = await fixture(mode, 'stop', `
const raw = await ctx.readNarrative({ selection: { kind: "tail", count: 1 } });
const prompt = await ctx.readNarrative({ selection: { kind: "tail", count: 1 }, view: "prompt" });
print(raw.text);
print(prompt.text);
print(prompt.nodes[0].body.raw);
`);
    try {
      const { card } = await f.runtime.createCard({ name: 'Story', opening: 'RAW_STORY {{name}}' })
      const { timeline } = await f.runtime.createNarrativeTimeline({ cardId: card.id })
      const page = await f.runtime.getNarrativePage({ timelineId: timeline.id })
      // Explicit test producer, not the official memory plugin.
      f.narrativeContext.register({ id: 'test.memory', resolve: async () => ({
        version: 'initial', memory: null, rawThroughNodeId: page.branch.headNodeId!,
      }) })
      await f.runtime.upsertTextTransformRule({
        ruleId: 'story-transform',
        rule: {
          name: 'story', owner: { kind: 'preset', presetId: f.preset.id }, enabled: true, orderIndex: 0,
          matcher: { kind: 'regex', pattern: 'RAW_STORY', flags: 'g' },
          effect: { kind: 'replace', replacement: 'PROMPT_STORY' },
          targets: ['narrative'], phases: ['prompt'],
        },
      })
      await f.runtime.invokeAgentTurn({
        agentSessionId: f.session.id, input: 'Read story', narrativeTarget: { timelineId: timeline.id },
      })
      const { entries } = await f.agents.getEntryPage({ agentSessionId: f.session.id, limit: 100 })
      const result = entries.find(entry => entry.entry.kind === 'tool-result')!.entry
      expect(result).toMatchObject({
        status: 'completed',
        content: [{ type: 'text', text: 'RAW_STORY {{name}}\nPROMPT_STORY {{name}}\nRAW_STORY {{name}}' }],
      })
      expect(f.calls[0]!.messages.some(message => message.content?.includes('PROMPT_STORY {{name}}'))).toBe(true)
      expect((await f.runtime.getNarrativePage({ timelineId: timeline.id })).nodes[0]!.body.raw).toBe('RAW_STORY {{name}}')
    } finally { f.engine.close() }
  })

  it.each(['content', 'json'] as const)('connects the real resource mount to %s without exposing node IDs', async mode => {
    const f = await fixture(mode, 'stop', 'print(await ctx.read("/resources/World/Key.md"));')
    try {
      await f.runtime.invokeAgentTurn({ agentSessionId: f.session.id, input: 'Read source.' })
      const { entries } = await f.agents.getEntryPage({ agentSessionId: f.session.id, limit: 100 })
      const result = entries.find(entry => entry.entry.kind === 'tool-result')!.entry
      expect(result).toMatchObject({ status: 'completed' })
      expect(JSON.stringify(result)).toContain('KEY_SENTINEL belongs to C.')
      expect(JSON.stringify(result)).not.toContain('loom-resource://')
      expect(JSON.stringify(result)).toContain('/resources/World/Key.md')
    } finally {
      f.engine.close()
    }
  })

  it.each(['content', 'json'] as const)('writes a fully read Prompt Resource through %s', async mode => {
    const f = await fixture(mode, 'stop', 'await ctx.setAuthorMode(true); await ctx.read("/resources/World/Key.md"); print(await ctx.write("/resources/World/Key.md", "KEY_UPDATED"));')
    try {
      await f.runtime.invokeAgentTurn({ agentSessionId: f.session.id, input: 'Update the key note.' }, authorContext())
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
    const f = await fixture(mode, 'stop', `await ctx.setAuthorMode(true); await ctx.read(${JSON.stringify(path)}); print(await ctx.write(${JSON.stringify(path)}, "label: Key Note\\nmeta: owned by A\\n"));`)
    try {
      await f.runtime.invokeAgentTurn({ agentSessionId: f.session.id, input: 'Update the key note metadata.' }, authorContext())
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
    const f = await fixture(mode, 'stop', `await ctx.setAuthorMode(true); await ctx.read(${JSON.stringify(path)}); await ctx.patch(${JSON.stringify(path)}, ${JSON.stringify(diff)}); await ctx.read("/not-mounted");`)
    try {
      await f.runtime.invokeAgentTurn({ agentSessionId: f.session.id, input: 'Transfer the key.' }, authorContext())
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

  it('refreshes official CodeAct guidance on reinitialization without changing preset mounts', async () => {
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
      const updated = (await f.runtime.listAgentTools()).tools.find(item => item.id === f.toolId)!
      expect(updated.prompt?.guidance).toContain('### ctx.appendNarrative')
      expect(updated.description).toContain('Narrative append')
      const preview = await f.runtime.previewAgentTurn({ agentSessionId: f.session.id, input: 'Inspect.' })
      const text = preview.messages.map(message => message.content).join('\n')
      expect(text).not.toContain('CUSTOM_CODEACT_GUIDE')
      expect(text.match(/### ctx.appendNarrative/g)).toHaveLength(1)
      const { resource } = await f.runtime.createPromptResource({ resourceKind: 'preset', name: 'New' })
      const { mounts } = await f.runtime.listPresetToolMounts({ presetId: resource.id })
      expect(mounts.filter(mount => mount.toolId.startsWith('official/codeact'))).toHaveLength(2)
      expect(mounts.every(mount => !mount.defaultEnabled)).toBe(true)
    } finally {
      f.engine.close()
    }
  })
})
