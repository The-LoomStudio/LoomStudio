import { createAgentStore } from '@loom-studio/application-data'
import type { AgentTranscriptEntry, AgentTranscriptEntryData } from '@loom-studio/application-data'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { describe, expect, it } from 'vitest'
import { projectSessionHistory, readSessionHistory } from '../../../packages/application-runtime/src/agents/session-history.js'
import { compilePromptDataModel } from '../../../packages/application-runtime/src/prompt/prompt-build-pipeline.js'
import type { PromptContribution } from '../../../packages/application-runtime/src/prompt/prompt-builder.js'
import { buildOpenAIChatPayload } from '../../../packages/application-runtime/src/providers/provider-payload.js'

function records(items: AgentTranscriptEntryData[]): AgentTranscriptEntry[] {
  return items.map((entry, index) => ({
    id: `entry-${index}`, agentSessionId: 'session', sequence: index + 1, runId: 'run',
    createdAt: '2026-09-24T00:00:00.000Z', entry,
  }))
}
const observation: AgentTranscriptEntryData = { kind: 'provider-observation', provider: 'test', model: 'test' }
const call = (id: string, transport: 'native-function' | 'content' = 'native-function'): AgentTranscriptEntryData => ({
  kind: 'tool-invocation', invocationId: id, toolId: 'test/tool', exposedName: 'write',
  transport, providerItemId: id, arguments: { text: 'saved' }, status: 'proposed',
  ...(transport === 'content' ? { rawInput: '正文 {{literal}} \n第二行' } : {}),
})
const result = (id: string, status: 'completed' | 'denied' | 'failed' | 'aborted' = 'completed'): AgentTranscriptEntryData => ({
  kind: 'tool-result', invocationId: id, toolId: 'test/tool', status,
  content: status === 'completed' ? [{ type: 'text', text: `SAVED:${id}` }] : [],
  ...(status === 'completed' ? {} : { error: { code: `tool.${status}`, message: status } }),
})
const replay = (entries: AgentTranscriptEntry[]) => projectSessionHistory(entries, new Map(entries.flatMap(record =>
  record.entry.kind === 'message' ? [[record.id, record.entry.content] as const] : [],
))).flatMap(block => block.messages)

describe('Session tool history projection', () => {
  it('preserves a native batch and its result IDs inside a system-wrapped Session anchor', () => {
    const entries = records([observation, call('a'), call('b'), result('a'), result('b', 'denied')])
    const blocks = projectSessionHistory(entries, new Map())
    expect(blocks).toHaveLength(1)
    const messages = blocks[0]!.messages
    expect(messages.map(message => message.role)).toEqual(['assistant', 'tool', 'tool'])
    expect(messages[0]).toMatchObject({ tool_calls: [
      { id: 'a', function: { arguments: '{"text":"saved"}' } }, { id: 'b' },
    ] })
    expect(messages[2]).toEqual({ role: 'tool', tool_call_id: 'b', content: 'denied' })
    const contribution: PromptContribution = {
      id: 'batch', sourceRef: { kind: 'sessionHistory', sourceId: 'session', sourceNodeId: 'batch' },
      content: '', messages, capabilities: { targetAnchorId: '@chat.session' },
    }
    const input = {
      contributions: [contribution],
      sourceNodes: [
        { id: 'system', parentId: null, sourceId: 'preset', displayName: 'System', orderIndex: 0, kind: 'message', capabilities: { roleHint: 'system' as const } },
        { id: '@chat.session', parentId: 'system', sourceId: 'preset', displayName: 'Session', orderIndex: 0, kind: 'virtual' },
      ],
    }
    const compiled = compilePromptDataModel(input)
    expect(buildOpenAIChatPayload({ messages: compiled.messages, modelId: 'test' }).messages).toEqual(messages)
    expect(compilePromptDataModel({
      ...input, sourceNodes: input.sourceNodes.map(node => ({ ...node, enabled: node.id !== '@chat.session' })),
    }).messages).toEqual([])
    expect(() => compilePromptDataModel({
      ...input, contributions: [{ ...contribution, sourceRef: { ...contribution.sourceRef, kind: 'settingLayer' } }],
    })).toThrow(/must come from Session/)
  })

  it('retains Content source and multiple results without evaluating macros or replaying code', () => {
    const messages = replay(records([
      observation, call('a', 'content'), call('b', 'content'), result('a'), result('b', 'failed'),
    ]))
    expect(messages.map(message => message.role)).toEqual(['assistant', 'user', 'user'])
    expect(messages[0]!.content?.match(/<loom_tool name=/g)).toHaveLength(2)
    expect(messages[0]!.content).toContain('<content>正文 {{literal}} \n第二行</content>')
    expect(messages[1]!.content).toContain('invocation_id="a"')
    expect(messages[2]!.content).toContain('status="failed">failed</loom_tool_result>')
  })

  it('keeps persisted outcomes and treats unrecorded outcomes as unknown, not successful or retryable', () => {
    const entries = records([
      observation, call('a'), call('unknown'), result('a', 'aborted'),
      { kind: 'run-state', state: 'failed', reason: 'connection lost' },
    ])
    const before = structuredClone(entries)
    const messages = replay(entries)
    expect(messages.filter(message => message.role === 'tool')).toEqual([
      { role: 'tool', tool_call_id: 'a', content: 'aborted' },
    ])
    expect(messages.at(-1)!.content).toContain('execution outcome unknown')
    expect(messages.at(-1)!.content).toContain('do not assume it is safe to repeat')
    expect(entries).toEqual(before)
    expect(replay(records([result('orphan')]))[0]!.content).toContain('invocation not in supplied history')
  })

  it('keeps separate calls unambiguous when a Provider reuses a call ID', () => {
    const reused = { ...call('second'), providerItemId: 'a' }
    const messages = replay(records([observation, call('a'), result('a'), observation, reused, result('second')]))
    const toolIds = messages.flatMap(message => message.role === 'tool' ? [message.tool_call_id] : [])
    const callIds = messages.flatMap(message => message.role === 'assistant' ? message.tool_calls?.map(call => call.id) ?? [] : [])
    expect(toolIds).toEqual(callIds)
    expect(new Set(toolIds).size).toBe(2)
  })

  it('reads the whole unsummarized segment across real 100-entry pages without dropping its request or tool batches', async () => {
    let nextId = 0
    const createId = (prefix: string) => `${prefix}-${++nextId}`
    const now = () => '2026-09-24T00:00:00.000Z'
    const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
    const store = createAgentStore({ engine, createId, now })
    const actor = { kind: 'system' as const, id: 'test' }
    try {
      const { session } = await store.createSession({ actor, agentPresetId: 'profile' })
      const items: AgentTranscriptEntryData[] = [
        { kind: 'message', role: 'user', content: 'OLD_REQUEST' },
        { kind: 'run-state', state: 'running' }, observation,
        ...Array.from({ length: 60 }, (_, index) => call(`call-${index}`)),
        ...Array.from({ length: 60 }, (_, index) => result(`call-${index}`)),
        { kind: 'message', role: 'assistant', content: 'DONE' },
        { kind: 'run-state', state: 'completed' },
      ]
      await store.appendEntries({
        actor, agentSessionId: session.id, expectedEntryCount: 0,
        entries: items.map(entry => ({ runId: 'run', entry })),
      })
      const truncated = await store.getEntryPage({ agentSessionId: session.id, limit: 100 })
      expect(truncated.entries[0]!.entry.kind).toBe('tool-invocation')
      const history = await readSessionHistory(store, session.id)
      expect(history.entries[0]!.entry.kind).toBe('message')
      expect(history.entries.map(entry => entry.sequence)).toEqual(
        Array.from({ length: items.length }, (_, index) => index + 1),
      )
      const messages = replay(history.entries)
      expect(messages[0]).toEqual({ role: 'user', content: 'OLD_REQUEST' })
      expect(messages[1]).toMatchObject({ role: 'assistant', tool_calls: Array.from({ length: 60 }, (_, i) => expect.objectContaining({ id: `call-${i}` })) })
      expect(messages.filter(message => message.role === 'tool')).toHaveLength(60)
      expect(messages.at(-1)!.content).toBe('DONE')
      expect((await store.getSession(session.id))!.entryCount).toBe(items.length)
    } finally { engine.close() }
  })
})
