import { createAgentStore, createNarrativeStore, createPromptResourceStore } from '@loom-studio/application-data'
import {
  createAgentToolRegistry, createApplicationRuntime, createNarrativeContextRegistry, createNarrativeReader, createNarrativeSampler,
  createOfficialAgentToolRegistry,
  type NarrativeContextProjection, type NarrativeHistoryReadApproval, type ToolApprovalHandler, type ToolDefinition, type ToolExecutionScope,
} from '@loom-studio/application-runtime'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createId, nowIso, type ChatMessage } from '@loom-studio/shared'
import { describe, expect, it, vi } from 'vitest'
import { readNarrativeContext } from '../../../packages/application-runtime/src/narrative/context-provider.js'

async function fixture(count = 45) {
  const engine = createSqliteDataEngine({ filename: ':memory:', createId, now: nowIso })
  const store = createNarrativeStore({ engine, createId, now: nowIso })
  const actor = { kind: 'system' as const, id: 'test' }
  const setup = createApplicationRuntime({
    dataEngine: engine, documents: createSqliteDocumentStore({ engine }), narratives: store,
    promptResources: createPromptResourceStore({ engine, createId, now: nowIso }),
  })
  const { card } = await setup.createCard({ name: 'Fixture' })
  const story = await setup.createNarrativeTimeline({
    cardId: card.id,
    openingNodes: Array.from({ length: count }, (_, index) => ({ content: `FLOOR_${index + 1}` })),
  })
  const scope = { timelineId: story.timeline.id, branchId: story.branch.id }
  const context = createNarrativeContextRegistry()
  // Test producer only: these published boundaries do not implement a memory algorithm.
  let published: NarrativeContextProjection = {
    version: 'v1', memory: { coveredThroughNodeId: story.nodes[31]!.id, entries: [{ id: 'summary', content: 'SUMMARY_1_32' }] },
    rawThroughNodeId: story.nodes[39]!.id,
  }
  const provider = context.register({ id: 'test.memory', resolve: async () => published })
  const reader = createNarrativeReader({ store, context, ...scope })
  return {
    ...story, card, engine, store, scope, context, reader, provider,
    publish: (value: NarrativeContextProjection) => { published = value },
    append: async (raw: string) => store.appendNode({
      actor, ...scope, expectedHeadNodeId: (await store.getBranch(scope.branchId))!.headNodeId!,
      stateRevisionId: story.nodes.at(-1)!.stateRevisionId, body: { format: 'loom-markdown.v1', raw },
    }),
  }
}

describe('host-owned Narrative read ranges', () => {
  it('resolves private context with the trusted Card while keeping other Cards isolated', async () => {
    const f = await fixture()
    try {
      f.provider.dispose()
      f.context.register({
        id: 'private.memory',
        resolve: async () => ({ version: 'private', rawThroughNodeId: f.nodes[39]!.id, memory: { coveredThroughNodeId: f.nodes[31]!.id, entries: [{ id: 'private-summary', content: 'Private summary' }] } }),
      }, { kind: 'card', cardId: f.card.id })
      const request = { selection: { kind: 'tail' as const, count: 100 } }
      const reader = createNarrativeReader({ store: f.store, context: f.context, ...f.scope, cardId: f.card.id })
      expect((await reader.sample(request)).nodes.map(node => node.id)).toEqual(f.nodes.slice(32).map(node => node.id))
      const other = createNarrativeReader({ store: f.store, context: f.context, ...f.scope, cardId: 'other-card' })
      await expect(other.sample(request)).rejects.toMatchObject({ code: 'narrative.context_unconfigured' })
    } finally { f.engine.close() }
  })
  it('bounds counts, node endpoints and every continuation to the authorized interval', async () => {
    const f = await fixture(245)
    try {
      const access = { ...f.scope, afterNodeId: f.nodes[31]!.id, throughNodeId: f.nodes[239]!.id }
      const sampler = createNarrativeSampler(f.store, access)
      access.afterNodeId = f.nodes[0]!.id
      const request = { ...f.scope, selection: { kind: 'tail' as const, count: 10_000 }, maxNodes: 17 }
      let page = await sampler.sample(request)
      const ids: string[] = []
      for (let reads = 0; ; reads++) {
        expect(reads).toBeLessThan(20)
        ids.unshift(...page.nodes.map(node => node.id))
        if (page.complete) {
          expect(page.nextBeforeNodeId).toBeUndefined()
          break
        }
        expect(page.nextBeforeNodeId).not.toBe(f.nodes[31]!.id)
        page = await sampler.sample({ ...request, selection: { ...request.selection, throughNodeId: page.nextBeforeNodeId } })
      }
      expect(ids).toEqual(f.nodes.slice(32, 240).map(node => node.id))
      for (const selection of [
        { kind: 'tail' as const, count: 1, throughNodeId: f.nodes[31]!.id },
        { kind: 'tail' as const, count: 1, throughNodeId: f.nodes[240]!.id },
        { kind: 'range' as const, afterNodeId: f.nodes[30]!.id },
        { kind: 'range' as const, afterNodeId: f.nodes[36]!.id, throughNodeId: f.nodes[35]!.id },
        { kind: 'tail' as const, count: 1, throughNodeId: 'unknown' },
      ]) {
        await expect(sampler.sample({ ...f.scope, selection })).rejects.toMatchObject({ code: 'narrative.read_out_of_range' })
      }
      await expect(sampler.sample({ ...request, timelineId: 'other' })).rejects.toMatchObject({ code: 'narrative.read_out_of_range' })
      await expect(sampler.sample({ ...request, branchId: 'other' })).rejects.toMatchObject({ code: 'narrative.read_out_of_range' })
      const empty = createNarrativeSampler(f.store, { ...f.scope, throughNodeId: null })
      expect((await empty.sample(request)).nodes).toEqual([])
      await expect(empty.sample({ ...request, selection: { kind: 'tail', count: 1, throughNodeId: f.nodes[0]!.id } })).rejects.toMatchObject({ code: 'narrative.read_out_of_range' })
    } finally { f.engine.close() }
  })

  it('keeps passive 33-40 separate from active 33-45 and consumes newly published boundaries on the next read', async () => {
    const f = await fixture()
    try {
      const readPassive = async () => readNarrativeContext(f.store, f.scope, (await f.context.resolve(f.scope))!)
      const tail = { selection: { kind: 'tail' as const, count: 1_000 } }
      expect((await readPassive()).map(node => node.id)).toEqual(f.nodes.slice(32, 40).map(node => node.id))
      expect((await f.reader.sample(tail)).nodes.map(node => node.id)).toEqual(f.nodes.slice(32).map(node => node.id))
      const added = await f.append('FLOOR_46')
      expect((await readPassive()).map(node => node.id)).toEqual(f.nodes.slice(32, 40).map(node => node.id))
      expect((await f.reader.sample(tail)).nodes.at(-1)?.id).toBe(added.node.id)
      f.publish({
        version: 'v2', memory: { coveredThroughNodeId: f.nodes[39]!.id, entries: [{ id: 'summary', content: 'SUMMARY_1_40' }] },
        rawThroughNodeId: f.nodes[44]!.id,
      })
      expect((await readPassive()).map(node => node.id)).toEqual(f.nodes.slice(40, 45).map(node => node.id))
      expect((await f.reader.sample(tail)).nodes.map(node => node.id)).toEqual([...f.nodes.slice(40).map(node => node.id), added.node.id])
      f.publish({ version: 'all', memory: { coveredThroughNodeId: added.node.id, entries: [{ id: 'all', content: 'ALL' }] }, rawThroughNodeId: null })
      expect((await f.reader.sample(tail)).nodes).toEqual([])
      f.provider.dispose()
      await expect(f.reader.sample(tail)).rejects.toMatchObject({ code: 'narrative.context_unconfigured' })
    } finally { f.engine.close() }
  })

  it('requires approval for each exact old read and rechecks cancellation and the fixed upper bound', async () => {
    const f = await fixture()
    try {
      const old = { selection: { kind: 'tail' as const, count: 1, throughNodeId: f.nodes[4]!.id } }
      await expect(f.reader.sample(old)).rejects.toMatchObject({ code: 'narrative.history_authorization_required' })
      const deny = vi.fn(async () => ({ decision: 'deny' as const, reason: 'User declined' }))
      await expect(f.reader.sample(old, undefined, deny)).rejects.toThrow('User declined')
      const allow = vi.fn(async (action: NarrativeHistoryReadApproval) => {
        if (action.selection.kind === 'tail') action.selection.count = 1000
        return { decision: 'allow' as const }
      })
      expect((await f.reader.sample(old, undefined, allow)).text).toBe('FLOOR_5')
      expect(allow).toHaveBeenCalledWith(expect.objectContaining({
        kind: 'narrative-history-read', ...f.scope, maxNodes: 1000, maxCharacters: 2_000_000,
      }), undefined)
      await expect(f.reader.sample(old)).rejects.toMatchObject({ code: 'narrative.history_authorization_required' })
      const controller = new AbortController()
      await expect(f.reader.sample(old, controller.signal, async () => {
        controller.abort(new Error('Stopped'))
        return { decision: 'allow' }
      })).rejects.toThrow('Stopped')
      const snapshotRead = await f.reader.sample({
        selection: { kind: 'range', afterNodeId: f.nodes[0]!.id },
      }, undefined, async () => {
        await f.append('NEW_AFTER_APPROVAL_REQUEST')
        return { decision: 'allow' }
      })
      expect(snapshotRead.nodes.at(-1)?.id).toBe(f.nodes[44]!.id)
      expect(snapshotRead.text).not.toContain('NEW_AFTER_APPROVAL_REQUEST')
      const oversized = vi.fn(async () => ({ decision: 'allow' as const }))
      await expect(f.reader.sample({ ...old, maxNodes: 1_001 }, undefined, oversized)).rejects.toThrow(/maxNodes/)
      expect(oversized).not.toHaveBeenCalled()
    } finally { f.engine.close() }
  })

  it('uses the executing Tool approval handler rather than trusting a script-supplied permission', async () => {
    const f = await fixture()
    try {
      const tool: ToolDefinition = {
        id: 'test/read', owner: { namespace: 'test' }, name: 'read', description: 'Read',
        input: { kind: 'structured', schema: { type: 'object', properties: {} } },
      }
      const invocation = { id: 'read-1', toolId: tool.id, arguments: {} }
      const scope: ToolExecutionScope = {
        context: [],
        narrative: {
          ...f.scope, sample: f.reader.sample,
          appendNode: async () => ({ nodeId: 'unused' }), editNode: async () => ({ nodeId: 'unused' }),
        },
      }
      const makeTools = (approve?: ToolApprovalHandler) => createAgentToolRegistry([tool], [{
        toolId: tool.id, approve,
        execute: async ({ scope, signal }) => ({
          invocationId: invocation.id, toolId: tool.id, status: 'completed',
          content: [{ type: 'text', text: (await scope!.narrative!.sample({
            selection: { kind: 'tail', count: 1, throughNodeId: f.nodes[2]!.id },
          }, signal, async () => ({ decision: 'allow' }))).text }],
        }),
      }])
      const absent = makeTools()
      expect(await absent.approve(invocation)).toEqual({ decision: 'allow' })
      expect(await absent.execute(invocation, new AbortController().signal, scope)).toMatchObject({
        status: 'failed', content: [], error: { code: 'narrative.history_denied' },
      })
      const approve = vi.fn<ToolApprovalHandler>(async ({ action }) => action?.kind === 'narrative-history-read'
        ? { decision: 'allow' } : { decision: 'deny' })
      const allowed = await makeTools(approve).execute(invocation, new AbortController().signal, scope)
      expect(approve).toHaveBeenCalledWith(expect.objectContaining({
        invocation, action: expect.objectContaining({ kind: 'narrative-history-read', selection: { kind: 'tail', count: 1, throughNodeId: f.nodes[2]!.id } }),
      }))
      expect(allowed).toMatchObject({ status: 'completed', content: [{ type: 'text', text: 'FLOOR_3' }] })
    } finally { f.engine.close() }
  })

  it.each(['content', 'json'] as const)('enforces active and approved history reads in the real %s CodeAct tool loop', async mode => {
    const f = await fixture()
    try {
      const projection = (await f.context.resolve(f.scope))!
      f.provider.dispose()
      f.context.register({ id: 'private.memory', resolve: async () => projection }, { kind: 'card', cardId: f.card.id })
      const tools = createOfficialAgentToolRegistry()
      const toolId = mode === 'content' ? 'official/codeact' : 'official/codeact_json'
      let permitHistory = false
      const actions: NarrativeHistoryReadApproval[] = []
      const agentTools = createAgentToolRegistry(tools.list(), [{
        ...tools.getRegistration(toolId)!,
        approve: async ({ action }) => {
          if (!action) return { decision: 'allow' }
          actions.push(action)
          return permitHistory ? { decision: 'allow' } : { decision: 'deny', reason: 'USER_DENIED' }
        },
      }])
      const agents = createAgentStore({ engine: f.engine, createId, now: nowIso })
      const requests: ChatMessage[][] = []
      const source = `
const active = await ctx.readNarrative({ selection: { kind: "tail", count: 10000 } });
print(active.text);
const old = await ctx.readNarrative({ selection: { kind: "tail", count: 1, throughNodeId: ${JSON.stringify(f.nodes[4]!.id)} } });
print("OLD=" + old.text);
`
      let step = 0
      const runtime = createApplicationRuntime({
        dataEngine: f.engine, documents: createSqliteDocumentStore({ engine: f.engine }),
        narratives: f.store, narrativeContext: f.context, agents,
        promptResources: createPromptResourceStore({ engine: f.engine, createId, now: nowIso }),
        agentTools,
        gateway: { invokeChat: async ({ request }) => {
          requests.push(structuredClone(request.messages))
          const invoke = step++ % 2 === 0
          const content = !invoke ? 'DONE' : mode === 'content'
            ? `<loom_tool name="codeact"><metadata>{}</metadata><content>${source}</content></loom_tool>` : ''
          return {
            provider: 'test', model: 'model', text: content, finishReason: 'stop',
            message: {
              role: 'assistant', content,
              ...(invoke && mode === 'json' ? { tool_calls: [{ id: `call-${step}`, type: 'function', function: { name: 'codeact_json', arguments: JSON.stringify({ code: source }) } }] } : {}),
            },
          }
        } },
      })
      const { resource: preset } = await runtime.createPromptResource({ resourceKind: 'preset', name: 'Writer' })
      await runtime.replacePresetToolMounts({ presetId: preset.id, mounts: [{ toolId, defaultEnabled: true, orderIndex: 0 }] })
      const { providerProfile } = await runtime.createProviderProfile({
        providerExtensionId: 'official.openai-compatible', displayName: 'Test', config: {}, enabledModelIds: ['model'],
      })
      const { agentPreset } = await runtime.updateAgentPreset({
        name: 'Writer', agentPresetId: preset.id, expectedVersion: (await runtime.getPromptResource({ resourceId: preset.id })).resource.version, model: { providerProfileId: providerProfile.id, modelId: 'model' },
      })
      const { session } = await runtime.createAgentSession({ agentPresetId: agentPreset.id, timelineId: f.scope.timelineId })
      const invoke = () => runtime.invokeAgentTurn({ agentSessionId: session.id, input: 'Read' })
      await invoke()
      let entries = (await agents.getEntryPage({ agentSessionId: session.id, limit: 100 })).entries
      const denied = entries.find(entry => entry.entry.kind === 'tool-result')!.entry
      expect(JSON.stringify(denied)).toContain('USER_DENIED')
      expect(JSON.stringify(denied)).not.toContain('OLD=FLOOR_5')
      permitHistory = true
      await invoke()
      entries = (await agents.getEntryPage({ agentSessionId: session.id, limit: 100 })).entries
      const allowed = entries.filter(entry => entry.entry.kind === 'tool-result').at(-1)!.entry
      expect(allowed).toMatchObject({ status: 'completed' })
      expect(JSON.stringify(allowed)).toContain('FLOOR_33')
      expect(JSON.stringify(allowed)).toContain('FLOOR_45')
      expect(JSON.stringify(allowed)).not.toContain('FLOOR_32')
      expect(JSON.stringify(allowed)).toContain('OLD=FLOOR_5')
      expect(actions).toHaveLength(2)
      expect(actions[0]?.selection).toEqual({ kind: 'tail', count: 1, throughNodeId: f.nodes[4]!.id })
      const prefix = (messages: ChatMessage[]) => messages.find(message => message.role === 'developer')?.content
      expect(prefix(requests[0]!)).toBe(prefix(requests[2]!))
      expect(prefix(requests[0]!)).toContain('FLOOR_40')
      expect(prefix(requests[0]!)).not.toContain('FLOOR_41')
    } finally { f.engine.close() }
  })
})
