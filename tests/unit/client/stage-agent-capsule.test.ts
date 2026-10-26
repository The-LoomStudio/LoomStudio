import { describe, expect, it } from 'vitest'
import { resolveAgentRuntimePhase } from '../../../apps/studio-client/src/features/narrative-runtime/model/agent-runtime-phase.js'
import type { AgentTranscriptEntry } from '../../../apps/studio-client/src/entities/index.js'
import type { ActiveAgentRun } from '../../../apps/studio-client/src/features/narrative-runtime/model/use-narrative-runtime.js'

describe('resolveAgentRuntimePhase', () => {
  it('returns idle when activeRun is undefined or not running', () => {
    expect(resolveAgentRuntimePhase(undefined, [])).toEqual({ kind: 'idle' })
    expect(resolveAgentRuntimePhase({ runId: 'r1', status: 'completed' } as ActiveAgentRun, [])).toEqual({ kind: 'idle' })
  })

  it('detects approval requirement when approval is present or suspended', () => {
    const approvalRun: ActiveAgentRun = {
      runId: 'r1',
      status: 'running',
      approval: { requestId: 'req1', target: 'mutation' } as any,
    }
    expect(resolveAgentRuntimePhase(approvalRun, [])).toEqual({
      kind: 'approval',
      text: '等待确认',
    })

    const suspendedRun: ActiveAgentRun = {
      runId: 'r2',
      status: 'suspended',
    }
    expect(resolveAgentRuntimePhase(suspendedRun, [])).toEqual({
      kind: 'approval',
      text: '等待确认',
    })
  })

  it('detects active reasoning in running state', () => {
    const runningRun: ActiveAgentRun = { runId: 'r1', status: 'running' }
    const messages: AgentTranscriptEntry[] = [
      {
        id: 'm1',
        agentSessionId: 's1', sequence: 1,
        runId: 'r1',
        createdAt: '2026-10-11T00:00:00Z',
        entry: { kind: 'reasoning', content: 'Thinking...' },
      },
    ]

    expect(resolveAgentRuntimePhase(runningRun, messages)).toEqual({
      kind: 'running',
      action: 'reasoning',
      text: '思考中...',
    })
  })

  it('detects pending tool invocations for search, reading, writing, and custom tools', () => {
    const runningRun: ActiveAgentRun = { runId: 'r1', status: 'running' }

    const searchMessages: AgentTranscriptEntry[] = [
      {
        id: 'm1',
        agentSessionId: 's1', sequence: 1,
        runId: 'r1',
        createdAt: '2026-10-11T00:00:00Z',
        entry: { kind: 'tool-invocation', invocationId: 'inv1', toolId: 'web_search', exposedName: '网页搜索' },
      },
    ]
    expect(resolveAgentRuntimePhase(runningRun, searchMessages)).toEqual({
      kind: 'running',
      action: 'searching',
      text: '检索中...',
    })

    const readMessages: AgentTranscriptEntry[] = [
      {
        id: 'm2',
        agentSessionId: 's1', sequence: 1,
        runId: 'r1',
        createdAt: '2026-10-11T00:00:00Z',
        entry: { kind: 'tool-invocation', invocationId: 'inv2', toolId: 'read_worldbook', exposedName: '读取世界书' },
      },
    ]
    expect(resolveAgentRuntimePhase(runningRun, readMessages)).toEqual({
      kind: 'running',
      action: 'reading',
      text: '读取中...',
    })

    const writeMessages: AgentTranscriptEntry[] = [
      {
        id: 'm3',
        agentSessionId: 's1', sequence: 1,
        runId: 'r1',
        createdAt: '2026-10-11T00:00:00Z',
        entry: { kind: 'tool-invocation', invocationId: 'inv3', toolId: 'codeact_edit', exposedName: '编辑代码' },
      },
    ]
    expect(resolveAgentRuntimePhase(runningRun, writeMessages)).toEqual({
      kind: 'running',
      action: 'writing',
      text: '写作中...',
    })
  })

  it('ignores completed tools and falls back to earlier active entry or general running', () => {
    const runningRun: ActiveAgentRun = { runId: 'r1', status: 'running' }
    const messages: AgentTranscriptEntry[] = [
      {
        id: 'm1',
        agentSessionId: 's1', sequence: 1,
        runId: 'r1',
        createdAt: '2026-10-11T00:00:00Z',
        entry: { kind: 'reasoning', content: 'thinking after tool' },
      },
      {
        id: 'm2',
        agentSessionId: 's1', sequence: 1,
        runId: 'r1',
        createdAt: '2026-10-11T00:00:01Z',
        entry: { kind: 'tool-invocation', invocationId: 'inv1', toolId: 'read_file' },
      },
      {
        id: 'm3',
        agentSessionId: 's1', sequence: 1,
        runId: 'r1',
        createdAt: '2026-10-11T00:00:02Z',
        entry: { kind: 'tool-result', invocationId: 'inv1', content: 'file content' },
      },
    ]

    // inv1 已经完成，所以活跃项是前方的 reasoning
    expect(resolveAgentRuntimePhase(runningRun, messages)).toEqual({
      kind: 'running',
      action: 'reasoning',
      text: '思考中...',
    })
  })

  it('detects streaming partial message', () => {
    const runningRun: ActiveAgentRun = { runId: 'r1', status: 'running' }
    const messages: AgentTranscriptEntry[] = [
      {
        id: 'm1',
        agentSessionId: 's1', sequence: 1,
        runId: 'r1',
        createdAt: '2026-10-11T00:00:00Z',
        entry: { kind: 'message', role: 'assistant', state: 'partial', content: 'Hello' },
      },
    ]

    expect(resolveAgentRuntimePhase(runningRun, messages)).toEqual({
      kind: 'running',
      action: 'generating',
      text: '生成中...',
    })
  })
})
