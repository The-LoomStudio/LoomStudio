import { describe, expect, it } from 'vitest'
import { createAgentStore, createPromptResourceStore, createNarrativeStore } from '@loom-studio/application-data'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createApplicationRuntimeContext } from '../../../packages/application-runtime/src/foundation/application-context.js'
import { runNativeToolLoop } from '../../../packages/application-runtime/src/agents/tool-loop.js'
import { readAgentRunRecovery, type AgentRunRecovery } from '../../../packages/application-runtime/src/agents/run-recovery.js'
import type { ToolExecutionScope } from '../../../packages/application-runtime/src/agents/tool-registry.js'

const actor = { kind: 'kernel' as const, id: 'test' }

async function fixture(mode: 'declared' | 'automatic', purpose: 'narrative' | 'agent', failAdoption = false, failCall?: number) {
  let nextId = 0
  const createId = () => `entry-${++nextId}`
  const now = () => '2026-10-24T00:00:00.000Z'
  const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
  const narratives = createNarrativeStore({ engine, createId, now })
  const agents = createAgentStore({ engine, createId, now })
  await engine.transact({ actor }, async tx => agents.transaction(tx).createTimelineSession({ id: 'timeline' }))
  const user = await agents.appendEntries({ actor, agentSessionId: 'timeline', expectedEntryCount: 0,
    entries: [{ entry: { kind: 'message', role: 'user', content: 'Already saved' } }] })
  const scope: ToolExecutionScope = { context: [], narrative: { timelineId: 'timeline', branchId: 'branch',
    sample: async () => { throw new Error('unused') }, appendNode: async () => { throw new Error('unused') },
    editNode: async () => { throw new Error('unused') } } }
  let calls = 0
  const adopted: string[] = []
  const ctx = createApplicationRuntimeContext({ dataEngine: engine, documents: createSqliteDocumentStore({ engine }),
    promptResources: createPromptResourceStore({ engine, createId, now }), agents, narratives,
    gateway: { invokeChat: async () => {
      calls += 1
      if (calls === failCall) throw new Error('provider interrupted')
      if (mode === 'declared' && calls === 1) scope.narrative!.declareNext!()
      const content = calls === 1 ? 'first ' : calls === 2 ? 'second' : 'done'
      return { provider: 'test', model: 'test', text: content, finishReason: calls === 1 ? 'length' : 'stop',
        message: { role: 'assistant', content } }
    } } })
  const run = async (recovered?: AgentRunRecovery) => runNativeToolLoop({ ctx, agents, session: recovered ? (await agents.getSession('timeline'))! : user.session, runId: recovered ? 'resumed' : 'run',
    model: { providerProfileId: 'provider', modelId: 'test' }, initialMessages: recovered?.continuation.messages ?? [{ role: 'user', content: 'Already saved' }],
    recoveryRequest: { agentSessionId: 'timeline', input: 'Already saved' }, userInput: 'Already saved',
    compiledToolSet: { tools: [], trace: { sourceCount: 0, activeCount: 0, requestedOrder: [], effectiveOrder: [], activations: [], orders: [] } },
    toolExecutionScope: scope, branchId: 'branch', purpose, resumeUserEntry: user.entries[0],
    resumeAssistantEntryId: recovered?.continuation.partialEntryId,
    ...(recovered ? { requestContext: { agentRun: { runId: 'resumed', onEvent: () => {}, continuation: recovered.continuation } } } : {}),
    narrativeOutput: { mode, adopt: (tx, entry, content) => {
      expect(agents.transaction(tx).getEntry(entry.id)?.entry).toMatchObject({ kind: 'message', content })
      if (failAdoption) {
        if (scope.narrativeSource) scope.narrativeSource.cursorNodeId = 'advanced'
        throw new Error('adoption rejected')
      }
      adopted.push(content)
    } },
  })
  return { engine, ctx, agents, scope, run, adopted, calls: () => calls }
}

describe('Timeline narrative output loop', () => {
  it.each(['declared', 'automatic'] as const)('adopts the complete logical text once in %s mode', async mode => {
    const f = await fixture(mode, 'narrative')
    try {
      await f.run()
      expect(f.adopted).toEqual(['first second'])
      expect(f.calls()).toBe(mode === 'declared' ? 3 : 2)
      const { entries } = await f.agents.getEntryPage({ agentSessionId: 'timeline', limit: 100 })
      const messages = entries.filter(entry => entry.entry.kind === 'message')
      expect(messages.filter(entry => entry.entry.kind === 'message' && entry.entry.role === 'user')).toHaveLength(1)
      const narrative = messages.filter(entry => entry.entry.kind === 'message' && entry.entry.narrativeId)
      expect(narrative).toHaveLength(2)
      expect(narrative[1]!.entry).toMatchObject({ content: 'first second', narrativeId: (narrative[0]!.entry as { narrativeId: string }).narrativeId,
        continuesEntryId: narrative[0]!.id })
    } finally { f.ctx.observations.dispose(); f.engine.close() }
  })
  it('keeps discussion replies outside automatic adoption', async () => {
    const f = await fixture('automatic', 'agent')
    try { await f.run(); expect(f.adopted).toEqual([]) }
    finally { f.ctx.observations.dispose(); f.engine.close() }
  })
  it.each([2, 3])('recovers declaration state without duplicate adoption after provider call %s fails', async failCall => {
    const f = await fixture('declared', 'narrative', false, failCall)
    try {
      await expect(f.run()).rejects.toThrow('provider interrupted')
      const recovered = await readAgentRunRecovery(f.agents, { agentSessionId: 'timeline' })
      expect(recovered).toBeDefined()
      expect(recovered!.continuation.recovery.narrativeOutput?.declared).toBe(failCall === 2)
      await f.run(recovered!)
      expect(f.adopted).toEqual([failCall === 2 ? 'first done' : 'first second'])
    } finally { f.ctx.observations.dispose(); f.engine.close() }
  })
  it('guards adoption and restores the shared source cursor when its transaction fails', async () => {
    const f = await fixture('automatic', 'narrative', true)
    const source = { timelineId: 'timeline', branchId: 'branch', cursorNodeId: 'original' }
    f.scope.narrativeSource = source
    let guarded = 0
    f.scope.withNarrativeWrite = work => {
      expect(source.cursorNodeId).toBe('original')
      guarded += 1
      return work()
    }
    try {
      await expect(f.run()).rejects.toThrow('adoption rejected')
      expect(guarded).toBe(1)
      expect(f.scope.narrativeSource).toBe(source)
      expect(source.cursorNodeId).toBe('original')
      const { entries } = await f.agents.getEntryPage({ agentSessionId: 'timeline', limit: 100 })
      expect(entries.some(entry => entry.entry.kind === 'message' && entry.entry.content === 'first second')).toBe(false)
    } finally { f.ctx.observations.dispose(); f.engine.close() }
  })
})
