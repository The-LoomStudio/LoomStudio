import { describe, expect, it, vi } from 'vitest'
import { createAgentStore, createNarrativeStore, createPromptResourceStore } from '@loom-studio/application-data'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createApplicationRuntime, createAgentToolRegistry, defaultSessionSummaryPolicy, type GatewayInvokeChatInput, type ToolDefinition } from '@loom-studio/application-runtime'
import { planSessionSummary } from '../../../packages/application-runtime/src/agents/session-summary.js'
import type { AgentSession, AgentTranscriptEntry } from '@loom-studio/application-data'
import { readSessionHistory } from '../../../packages/application-runtime/src/agents/session-history.js'

async function fixture(standalone = false) {
  let id = 0
  const clock = { createId: (prefix: string) => `${prefix}-${++id}`, now: () => '2026-10-20T00:00:00.000Z' }
  const engine = createSqliteDataEngine({ filename: ':memory:', ...clock })
  const agents = createAgentStore({ engine, ...clock })
  const narratives = createNarrativeStore({ engine, ...clock })
  const requests: GatewayInvokeChatInput[] = []
  let writes = 0
  let step = 0
  let summaryText = 'PRIVATE_HANDOFF'
  let summaryMode: 'replace' | 'patch' = 'replace'
  let memoryText = 'SHARED_PLAN'
  let summaryGate: Promise<void> | undefined
  let releaseSummary: (() => void) | undefined
  let afterWrite: (() => Promise<void>) | undefined
  const tool: ToolDefinition = { id: 'test/story', owner: { namespace: 'test' }, name: 'write_story', description: 'Write story', input: { kind: 'structured', schema: { type: 'object', properties: {} } } }
  const runtime = createApplicationRuntime({ dataEngine: engine, agents, narratives,
    documents: createSqliteDocumentStore({ engine }), promptResources: createPromptResourceStore({ engine, ...clock }),
    agentTools: createAgentToolRegistry([tool], [{ toolId: tool.id, execute: async ({ invocation, scope }) => {
      const text = `STORY_${++writes}`
      await scope!.narrative!.appendNode({ content: text })
      await afterWrite?.()
      return { invocationId: invocation.id, toolId: tool.id, status: 'completed', content: [{ type: 'text', text }] }
    } }]),
    gateway: { invokeChat: async input => {
      requests.push(structuredClone({ ...input, context: undefined, abortSignal: undefined, onEvent: undefined }))
      if (input.request.metadata?.purpose === 'session-summary') {
        await summaryGate
        input.abortSignal?.throwIfAborted()
        return { provider: 'test', model: 'test', text: '', finishReason: 'tool_call', message: { role: 'assistant', tool_calls: [{
          id: 'summary-call', type: 'function', function: { name: 'submit_session_summary', arguments: JSON.stringify({
            summary: { mode: summaryMode, text: summaryText }, ...(standalone ? {} : { memory: { mode: 'replace', text: memoryText } }),
          }) },
        }] } }
      }
      if (!standalone && ++step % 2) return { provider: 'test', model: 'test', text: '', finishReason: 'tool_call', message: { role: 'assistant', tool_calls: [{ id: `call-${step}`, type: 'function', function: { name: tool.name, arguments: '{}' } }] } }
      return { provider: 'test', model: 'test', text: 'DONE', message: { role: 'assistant', content: 'DONE' } }
    } },
  })
  await runtime.initialize()
  const preset = (await runtime.createPromptResource({ resourceKind: 'preset', name: 'Writer' })).resource
  const provider = (await runtime.createProviderProfile({ providerExtensionId: 'official.openai-compatible', displayName: 'Test', config: {}, enabledModelIds: ['test'] })).providerProfile
  await runtime.replacePresetToolMounts({ presetId: preset.id, mounts: standalone ? [] : [{ toolId: tool.id, orderIndex: 0, defaultEnabled: true }] })
  await runtime.updateAgentPreset({ agentPresetId: preset.id, expectedVersion: (await runtime.getPromptResource({ resourceId: preset.id })).resource.version, model: { providerProfileId: provider.id, modelId: 'test' } })
  const card = (await runtime.createCard({ name: 'Story', opening: '' })).card
  const created = standalone ? undefined : await runtime.createNarrativeTimeline({ cardId: card.id, openingContent: '' })
  const target = created ? { timelineId: created.timeline.id, branchId: created.branch.id } : undefined
  const session = (await runtime.createAgentSession({ agentPresetId: preset.id, timelineId: target?.timelineId })).session
  const turn = async (text: string) => {
    const branch = target ? await narratives.getBranch(target.branchId) : undefined
    const node = target ? (await runtime.appendNarrativeInput({ ...target, nodeId: clock.createId('input'), content: text, expectedHeadNodeId: branch?.headNodeId ?? null })).node : undefined
    return runtime.invokeAgentTurn({ agentSessionId: session.id, input: text, ...(target && node ? { narrativeTarget: { ...target, inputNodeId: node.id } } : {}) })
  }
  return { engine, agents, narratives, runtime, session, target, turn, requests,
    configure(options: { summaryMode?: 'replace' | 'patch'; summaryText?: string; holdSummary?: boolean; afterWrite?: () => Promise<void> }) {
      summaryText = options.summaryText ?? summaryText
      summaryMode = options.summaryMode ?? summaryMode
      afterWrite = options.afterWrite
      if (options.holdSummary) summaryGate = new Promise(resolve => { releaseSummary = resolve })
    }, release: () => releaseSummary?.(),
  }
}

describe('Session summary lifecycle', () => {
  it('keeps receipts outside a running summary and waits before invoking their response', async () => {
    const f = await fixture(true)
    try {
      await f.turn('OLD_WORK')
      f.configure({ holdSummary: true })
      const task = f.runtime.summarizeAgentSession({ agentSessionId: f.session.id })
      await vi.waitFor(() => expect(f.requests.some(item => item.request.metadata?.purpose === 'session-summary')).toBe(true))
      const before = f.requests.length
      await f.runtime.submitAgentInterjection({ agentSessionId: f.session.id, requestId: 'during-summary', input: 'NEW_RECEIPT', mode: 'discussion' })
      const invocation = f.runtime.invokeAgentTurn({ agentSessionId: f.session.id, input: 'Continue' })
      await new Promise(resolve => setImmediate(resolve))
      expect(f.requests).toHaveLength(before)
      f.release()
      expect((await task).state).toBe('adopted')
      await invocation
      const summaryRequest = f.requests.find(item => item.request.metadata?.purpose === 'session-summary')!
      expect(JSON.stringify(summaryRequest.request.messages)).not.toContain('NEW_RECEIPT')
      expect(JSON.stringify(f.requests.at(-1)!.request.messages)).toContain('NEW_RECEIPT')
      const entries = await f.agents.listEntries(f.session.id)
      const summary = entries.find(item => item.entry.kind === 'work-summary')!
      const message = entries.find(item => item.entry.kind === 'message' && item.entry.content === 'NEW_RECEIPT')!
      expect(message.sequence).toBeGreaterThan(summary.sequence)
    } finally { f.release(); f.engine.close() }
  })

  it('keeps Narrative buffer work when a normal Session input triggers the Token fallback', async () => {
    const f = await fixture()
    try {
      await f.turn('FIRST_NARRATIVE_WORK')
      await f.turn('BUFFER_NARRATIVE_WORK')
      await f.runtime.updateAgentSession({ agentSessionId: f.session.id, summaryPolicy: {
        ...defaultSessionSummaryPolicy, maxTokens: 10, triggerTokens: 20, triggerFloors: 40, bufferFloors: 2,
      } })
      await f.runtime.invokeAgentTurn({ agentSessionId: f.session.id, input: 'SESSION_ONLY_INPUT' })
      const summary = await f.agents.getLatestWorkSummary(f.session.id)
      expect(summary?.entry.kind).toBe('work-summary')
      const history = await readSessionHistory(f.agents, f.session.id)
      const messages = JSON.stringify(history.entries.filter(entry => entry.entry.kind === 'message'))
      expect(messages).toContain('BUFFER_NARRATIVE_WORK')
      expect(messages).not.toContain('FIRST_NARRATIVE_WORK')
      expect(messages).toContain('SESSION_ONLY_INPUT')
    } finally { f.engine.close() }
  })

  it('keeps a saved summary effective after later Workspace writes at the same story node', async () => {
    const f = await fixture()
    try {
      await f.turn('BEFORE_SUMMARY')
      await f.runtime.summarizeAgentSession({ agentSessionId: f.session.id })
      const before = await f.runtime.getAgentSessionMemory({ agentSessionId: f.session.id })
      expect(before.summary).not.toBeNull()
      const workspace = await f.runtime.getTimelineWorkspace(f.target!)
      await f.runtime.mutateTimelineWorkspace({ ...f.target!, expectedRevisionId: workspace.id,
        operations: [{ kind: 'write', entryId: 'memory', content: 'LATER_SHARED_WORK' }] })
      const after = await f.runtime.getAgentSessionMemory({ agentSessionId: f.session.id })
      expect(after.summary?.id).toBe(before.summary?.id)
      expect(after.coverage).toEqual(before.coverage)
    } finally { f.engine.close() }
  })

  it.each([true, false])('saves manual corrections without retiring newer work (standalone=%s)', async standalone => {
    const f = await fixture(standalone)
    try {
      await f.turn('BEFORE_SUMMARY')
      await f.runtime.summarizeAgentSession({ agentSessionId: f.session.id })
      await f.turn('TAIL_MUST_REMAIN')
      const memory = await f.runtime.getAgentSessionMemory({ agentSessionId: f.session.id })
      const original = memory.summary!
      expect(memory.coverage.messages.retired).toBeGreaterThan(0)
      expect(memory.coverage.messages.source).toBe(memory.coverage.messages.retired)
      expect(memory.coverage.messages.total).toBeGreaterThan(memory.coverage.messages.source)
      const input = { agentSessionId: f.session.id, expectedSummaryId: original.id,
        expectedEntryCount: memory.session.entryCount, content: 'MANUALLY_CORRECTED_HANDOFF' }
      await expect(f.runtime.updateAgentSessionSummary({ ...input, content: ' ' })).rejects.toThrow('不能为空')
      expect((await f.runtime.getAgentSessionMemory({ agentSessionId: f.session.id })).summary?.id).toBe(original.id)
      await f.runtime.updateAgentSessionSummary(input)
      const updated = (await f.runtime.getAgentSessionMemory({ agentSessionId: f.session.id })).summary!
      expect(updated.id).not.toBe(original.id)
      expect(updated.entry).toMatchObject({ content: input.content, boundary: original.entry.kind === 'work-summary' ? original.entry.boundary : undefined })
      const preview = JSON.stringify((await f.runtime.previewAgentTurn({ agentSessionId: f.session.id, input: 'NEXT' })).messages)
      expect(preview).toContain('MANUALLY_CORRECTED_HANDOFF')
      expect(preview).toContain('TAIL_MUST_REMAIN')
      expect(preview).not.toContain('PRIVATE_HANDOFF')
      await expect(f.runtime.updateAgentSessionSummary(input)).rejects.toThrow('已变化')
      expect(original.entry).toMatchObject({ content: 'PRIVATE_HANDOFF' })
      expect((await f.runtime.getAgentSessionMemory({ agentSessionId: f.session.id })).coverage).toEqual(memory.coverage)
      if (f.target) {
        const page = await f.narratives.getPage({ ...f.target, limit: 100 })
        const oldNode = page.nodes[0]!
        const point = await f.narratives.getRecoveryPoint(f.target.branchId, oldNode.id)
        await f.engine.transact({ actor: { kind: 'system', id: 'test-summary-edit-restore' } }, async tx => {
          f.narratives.transaction(tx).restoreBranch({ ...f.target!, expectedHeadNodeId: page.branch.headNodeId!,
            expectedStateHeadRevisionId: page.branch.stateHeadRevisionId, headNodeId: oldNode.id,
            stateRevisionId: point.stateRevisionId, workspaceRevisionId: point.workspaceRevisionId })
        })
        const restored = await f.runtime.getAgentSessionMemory({ agentSessionId: f.session.id })
        expect(restored.summary).toBeNull()
        expect(restored.coverage.messages.retired).toBe(0)
      }
    } finally { f.engine.close() }
  })

  it.each([{ buffer: 0, async: false }, { buffer: 2, async: false }, { buffer: 0, async: true }, { buffer: 2, async: true }])(
    'adopts host boundaries and retains complete tail ($buffer, $async)', async mode => {
      const f = await fixture()
      try {
        await f.runtime.updateAgentSession({ agentSessionId: f.session.id, summaryPolicy: {
          ...defaultSessionSummaryPolicy, triggerFloors: 4, bufferFloors: mode.buffer, asynchronous: mode.async,
        } })
        await f.turn('INPUT_ONE')
        await f.turn('INPUT_TWO')
        const before = (await f.agents.getSession(f.session.id))!.entryCount
        expect(f.requests.filter(r => r.request.metadata?.purpose === 'session-summary')).toHaveLength(0)
        const result = await f.turn('TRIGGER_INPUT_THREE')
        expect(result.summaryStatus?.state).toBe('adopted')
        const tasks = await f.runtime.listAgentSessionSummaryTasks({ agentSessionId: f.session.id })
        expect(tasks[0]).toMatchObject({ agentSessionId: f.session.id, state: 'adopted', sourceThroughSequence: before })
        expect(tasks[0]?.toolArguments).toContain('PRIVATE_HANDOFF')
        expect(tasks[0]?.taskId).toBe(result.summaryStatus?.taskId)
        const summary = await f.agents.getLatestWorkSummary(f.session.id)
        expect(summary?.entry).toMatchObject({ kind: 'work-summary', content: 'PRIVATE_HANDOFF', boundary: { sourceThroughSequence: before } })
        if (summary?.entry.kind !== 'work-summary') throw new Error('Missing summary')
        expect(summary.entry.boundary!.retiredThroughSequence).toEqual(mode.buffer ? expect.any(Number) : before)
        if (mode.buffer) expect(summary.entry.boundary!.retiredThroughSequence).toBeLessThan(before)
        expect((await f.runtime.getAgentSessionMemory({ agentSessionId: f.session.id, branchId: f.target!.branchId })).summary?.id).toBe(summary.id)
        const history = await readSessionHistory(f.agents, f.session.id)
        expect(JSON.stringify(history.entries)).toContain('TRIGGER_INPUT_THREE')
        const visibleMessages = history.entries.filter(entry => entry.entry.kind === 'message')
        expect(JSON.stringify(visibleMessages)).not.toContain('INPUT_ONE')
        expect(JSON.stringify(visibleMessages).includes('INPUT_TWO')).toBe(Boolean(mode.buffer))
        const summaryRequest = f.requests.find(r => r.request.metadata?.purpose === 'session-summary')!
        expect(JSON.stringify(summaryRequest.request.messages)).not.toContain('TRIGGER_INPUT_THREE')
        expect(JSON.stringify(summaryRequest.request.messages).includes('以下近期工作历史将完整保留')).toBe(Boolean(mode.buffer))
        expect(summaryRequest.request.tools?.map(t => t.name)).toEqual(['submit_session_summary'])
        expect(f.requests.filter(r => r.request.metadata?.purpose !== 'session-summary').every(r => !r.request.tools?.some(t => t.name === 'submit_session_summary'))).toBe(true)
        expect((await f.runtime.getTimelineWorkspace(f.target!)).entries[0]).toMatchObject({ content: { text: 'SHARED_PLAN' } })
        const preview = await f.runtime.previewAgentTurn({ agentSessionId: f.session.id, input: 'Next' })
        expect(JSON.stringify(preview.messages)).toContain('PRIVATE_HANDOFF')
        expect(JSON.stringify(preview.messages)).toContain('SHARED_PLAN')
        const swipe = (await f.runtime.getNarrativeSwipes(f.target!)).swipe!
        expect(swipe.requiresRegeneration).not.toBe(true)
        const page = await f.narratives.getPage({ ...f.target!, limit: 100 })
        const oldNode = page.nodes[1]!
        const point = await f.narratives.getRecoveryPoint(f.target!.branchId, oldNode.id)
        await f.engine.transact({ actor: { kind: 'system', id: 'test-restore' } }, async tx => {
          f.narratives.transaction(tx).restoreBranch({ ...f.target!, expectedHeadNodeId: page.branch.headNodeId!,
            expectedStateHeadRevisionId: page.branch.stateHeadRevisionId, headNodeId: oldNode.id,
            stateRevisionId: point.stateRevisionId, workspaceRevisionId: point.workspaceRevisionId })
        })
        expect((await f.runtime.getAgentSessionMemory({ agentSessionId: f.session.id, branchId: f.target!.branchId })).summary).toBeNull()
        const restored = await f.runtime.previewAgentTurn({ agentSessionId: f.session.id, input: 'RESUMED' })
        expect(JSON.stringify(restored.messages)).not.toContain('PRIVATE_HANDOFF')
        expect(JSON.stringify(restored.messages)).not.toContain('TRIGGER_INPUT_THREE')
        expect(JSON.stringify(restored.messages)).toContain('INPUT_ONE')
      } finally { f.engine.close() }
    })

  it('supports standalone summaries and rejects oversized results without retiring history', async () => {
    const f = await fixture(true)
    try {
      await f.turn('STANDALONE_TASK')
      expect((await f.runtime.summarizeAgentSession({ agentSessionId: f.session.id })).state).toBe('adopted')
      await f.turn('KEEP_THIS_WORK')
      await f.runtime.updateAgentSession({ agentSessionId: f.session.id, summaryPolicy: { ...defaultSessionSummaryPolicy, maxTokens: 2 } })
      f.configure({ summaryText: 'too many words for a two token budget' })
      const before = (await f.agents.getLatestWorkSummary(f.session.id))!.id
      expect((await f.runtime.summarizeAgentSession({ agentSessionId: f.session.id })).state).toBe('failed')
      expect((await f.agents.getLatestWorkSummary(f.session.id))!.id).toBe(before)
      expect(JSON.stringify((await readSessionHistory(f.agents, f.session.id)).entries)).toContain('KEEP_THIS_WORK')
      const records = await f.runtime.listAgentSessionSummaryTasks({ agentSessionId: f.session.id })
      expect(records[0]).toMatchObject({ state: 'failed', agentSessionId: f.session.id })
      expect(records[0]?.toolArguments).toContain('too many words')
      const preview = await f.runtime.previewAgentTurn({ agentSessionId: f.session.id, input: 'Continue' })
      expect(JSON.stringify(preview.messages)).not.toContain('too many words')
    } finally { f.engine.close() }
  })

  it('summarizes Timeline-bound editing work before any Narrative floor exists', async () => {
    const f = await fixture()
    try {
      await f.agents.appendEntries({ actor: { kind: 'system', id: 'editor' }, agentSessionId: f.session.id, expectedEntryCount: 0,
        entries: [{ entry: { kind: 'message', role: 'user', content: 'EDITING_WORK_WITHOUT_FLOORS' } }] })
      expect((await f.runtime.summarizeAgentSession({ agentSessionId: f.session.id })).state).toBe('adopted')
      const preview = await f.runtime.previewAgentTurn({ agentSessionId: f.session.id, input: 'Continue editing' })
      expect(JSON.stringify(preview.messages)).toContain('PRIVATE_HANDOFF')
      expect(JSON.stringify(preview.messages)).toContain('SHARED_PLAN')
      await f.runtime.appendNarrativeInput({ ...f.target!, nodeId: 'first-formal', expectedHeadNodeId: null, content: 'First story input' })
      const advanced = await f.runtime.previewAgentTurn({ agentSessionId: f.session.id, input: 'Continue' })
      expect(JSON.stringify(advanced.messages)).toContain('PRIVATE_HANDOFF')
    } finally { f.engine.close() }
  })

  it('checks standalone Token pressure before the next input without summarizing that new input', async () => {
    const f = await fixture(true)
    try {
      await f.runtime.updateAgentSession({ agentSessionId: f.session.id,
        summaryPolicy: { ...defaultSessionSummaryPolicy, maxTokens: 10, triggerTokens: 20 } })
      await f.turn('OLD_WORK')
      expect(await f.agents.getLatestWorkSummary(f.session.id)).toBeNull()
      expect((await f.turn('NEW_WORK')).summaryStatus?.state).toBe('adopted')
      const request = f.requests.find(item => item.request.metadata?.purpose === 'session-summary')!
      expect(JSON.stringify(request.request.messages)).toContain('OLD_WORK')
      expect(JSON.stringify(request.request.messages)).not.toContain('NEW_WORK')
    } finally { f.engine.close() }
  })

  it('patches the current summary and cancellation never adopts a draft', async () => {
    const f = await fixture(true)
    try {
      await f.turn('FIRST')
      await f.runtime.summarizeAgentSession({ agentSessionId: f.session.id })
      await f.turn('SECOND')
      f.configure({ summaryMode: 'patch', summaryText: '--- summary.md\n+++ summary.md\n@@ -1 +1 @@\n-PRIVATE_HANDOFF\n\\ No newline at end of file\n+PATCHED_HANDOFF\n\\ No newline at end of file\n' })
      expect((await f.runtime.summarizeAgentSession({ agentSessionId: f.session.id })).state).toBe('adopted')
      expect((await f.agents.getLatestWorkSummary(f.session.id))!.entry).toMatchObject({ content: 'PATCHED_HANDOFF' })
      await f.turn('THIRD')
      const before = (await f.agents.getLatestWorkSummary(f.session.id))!.id
      f.configure({ holdSummary: true, summaryMode: 'replace', summaryText: 'CANCELLED' })
      const task = f.runtime.summarizeAgentSession({ agentSessionId: f.session.id })
      await vi.waitFor(() => expect(f.runtime.getAgentSessionSummaryStatus({ agentSessionId: f.session.id }).state).toBe('preparing'))
      await f.runtime.cancelAgentSessionSummary({ agentSessionId: f.session.id })
      f.release()
      expect((await task).state).toBe('failed')
      expect((await f.runtime.listAgentSessionSummaryTasks({ agentSessionId: f.session.id }))[0]?.state).toBe('failed')
      expect((await f.agents.getLatestWorkSummary(f.session.id))!.id).toBe(before)
    } finally { f.release(); f.engine.close() }
  })

  it('adopts late results only at the next safe boundary', async () => {
    const f = await fixture()
    try {
      await f.runtime.updateAgentSession({ agentSessionId: f.session.id, summaryPolicy: { ...defaultSessionSummaryPolicy, triggerFloors: 2, asynchronous: true } })
      await f.turn('FIRST')
      f.configure({ holdSummary: true })
      expect((await f.turn('SECOND')).summaryStatus?.state).toBe('preparing')
      expect(await f.agents.getLatestWorkSummary(f.session.id)).toBeNull()
      f.release()
      await vi.waitFor(() => expect(f.runtime.getAgentSessionSummaryStatus({ agentSessionId: f.session.id }).state).toBe('ready'))
      expect(await f.agents.getLatestWorkSummary(f.session.id)).toBeNull()
      await f.runtime.updateAgentSession({ agentSessionId: f.session.id, summaryPolicy: { ...defaultSessionSummaryPolicy, triggerFloors: 100 } })
      expect((await f.turn('THIRD')).summaryStatus?.state).toBe('adopted')
      const messages = (await readSessionHistory(f.agents, f.session.id)).entries.filter(entry => entry.entry.kind === 'message')
      expect(JSON.stringify(messages)).toContain('SECOND')
      expect(JSON.stringify(messages)).toContain('THIRD')
    } finally { f.release(); f.engine.close() }
  })

  it('keeps work when an asynchronous MEMORY update conflicts', async () => {
    const f = await fixture()
    try {
      await f.runtime.updateAgentSession({ agentSessionId: f.session.id, summaryPolicy: { ...defaultSessionSummaryPolicy, triggerFloors: 2, asynchronous: true } })
      await f.turn('FIRST')
      f.configure({ holdSummary: true, afterWrite: async () => {
        const workspace = await f.runtime.getTimelineWorkspace(f.target!)
        await f.runtime.mutateTimelineWorkspace({ ...f.target!, expectedRevisionId: workspace.id, operations: [{ kind: 'write', entryId: 'memory', content: 'NEW_SHARED_WORK' }] })
        f.release()
      } })
      const result = await f.turn('SECOND')
      expect(result.summaryStatus?.state).toBe('failed')
      expect(result.summaryStatus?.error).toContain('MEMORY.md changed')
      expect(await f.agents.getLatestWorkSummary(f.session.id)).toBeNull()
      expect((await f.runtime.getTimelineWorkspace(f.target!)).entries[0]).toMatchObject({ content: { text: 'NEW_SHARED_WORK' } })
      expect(JSON.stringify((await readSessionHistory(f.agents, f.session.id)).entries)).toContain('FIRST')
    } finally { f.engine.close() }
  })
})


describe('Timeline work summary boundaries', () => {
  const context = {} as Parameters<typeof planSessionSummary>[0]
  const session: AgentSession = { id: 'timeline', kind: 'timeline', entryCount: 100,
    createdAt: '2026-10-24', updatedAt: '2026-10-24', summaryPolicy: {
      ...defaultSessionSummaryPolicy, triggerFloors: 2, bufferFloors: 1,
    } }
  const entry = (sequence: number, runId: string, data: AgentTranscriptEntry['entry']): AgentTranscriptEntry => ({
    id: `entry-${sequence}`, agentSessionId: session.id, sequence, runId, entry: data, createdAt: session.createdAt,
  })
  const entries = [
    entry(1, 'first', { kind: 'message', role: 'user', purpose: 'narrative', content: 'Round one' }),
    entry(2, 'first', { kind: 'message', role: 'assistant', purpose: 'narrative', content: 'First body' }),
    entry(3, 'first', { kind: 'run-state', state: 'completed' }),
    entry(4, 'guidance', { kind: 'message', role: 'user', purpose: 'discussion', content: 'Guidance in the same round' }),
    entry(5, 'guidance', { kind: 'run-state', state: 'completed' }),
    entry(20, 'second', { kind: 'message', role: 'user', purpose: 'narrative', content: 'Round two' }),
    entry(21, 'second', { kind: 'tool-invocation', invocationId: 'call', toolId: 'tool', exposedName: 'tool', transport: 'native-function', status: 'proposed' }),
    entry(22, 'second', { kind: 'tool-result', invocationId: 'call', toolId: 'tool', status: 'completed', content: [] }),
    entry(23, 'second', { kind: 'message', role: 'assistant', purpose: 'narrative', content: 'Second body' }),
    entry(24, 'second', { kind: 'run-state', state: 'completed' }),
  ]
  it('uses adopted Entry coverage and retains every Run and tool pair in buffered rounds', async () => {
    const plan = await planSessionSummary(context, { session, entries })
    expect(plan).toMatchObject({ expectedEntryCount: 100, boundary: { sourceThroughSequence: 24, retiredThroughSequence: 5 } })
    const oneRound = await planSessionSummary(context, { session, entries: entries.slice(0, 5) })
    expect(oneRound).toBeUndefined()
  })
  it('does not retire a new roleplay input before its Run completes', async () => {
    const plan = await planSessionSummary(context, { session: { ...session, summaryPolicy: { ...session.summaryPolicy!, bufferFloors: 0 } },
      entries: [...entries, entry(30, 'new', { kind: 'message', role: 'user', purpose: 'narrative', content: 'Unexecuted round' })], force: true })
    expect(plan?.boundary).toMatchObject({ sourceThroughSequence: 30, retiredThroughSequence: 24 })
    const preparation = await planSessionSummary(context, { session,
      entries: [entry(1, 'prepare', { kind: 'message', role: 'user', content: 'Prepare' }),
        entry(2, 'prepare', { kind: 'run-state', state: 'completed' }),
        entry(3, 'future', { kind: 'message', role: 'user', content: 'Not run yet' })], force: true })
    expect(preparation?.boundary).toMatchObject({ sourceThroughSequence: 3, retiredThroughSequence: 2 })
  })
})
