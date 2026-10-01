import { describe, expect, it, vi } from 'vitest'
import type { AgentTranscriptEntry, NarrativeBranch, NarrativeNode, NarrativeTimeline } from '../../../apps/studio-client/src/entities/index.js'
import { inspectSessionRunStatus, mergeAgentRunEntries, readComposerDraftKey, reconcileNarrativeNodes, releasePrimaryRun, resolveNarrativeBranch } from '../../../apps/studio-client/src/features/narrative-runtime/model/use-narrative-runtime.js'
import { createStudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'

describe('releasePrimaryRun', () => {
  it('rejects running and failed cancellation without accepting a switch', async () => {
    const api = createStudioApi({ call: async () => { throw new Error('unexpected RPC') } })
    api.agentSessions.getTranscript = vi.fn(async () => ({
      session: { id: 'primary' } as any,
      entries: [{ id: 'input', agentSessionId: 'primary', runId: 'run', sequence: 1,
        entry: { kind: 'message', role: 'user', content: 'draft' }, createdAt: '' }],
    }))
    api.agentSessions.runState = vi.fn(async () => ({ runId: 'run', state: 'running' as const }))
    api.agentSessions.abandonRun = vi.fn(async () => ({ runId: 'run', accepted: false, state: 'suspended' as const }))
    await expect(releasePrimaryRun(api, 'primary')).rejects.toThrow('生成期间')
    expect(api.agentSessions.abandonRun).not.toHaveBeenCalled()
    api.agentSessions.runState = vi.fn(async () => ({ runId: 'run', state: 'suspended' as const }))
    await expect(releasePrimaryRun(api, 'primary')).rejects.toThrow('放弃失败')
    api.agentSessions.abandonRun = vi.fn(async () => ({ runId: 'run', accepted: true, state: 'suspended' as const }))
    await expect(releasePrimaryRun(api, 'primary')).resolves.toBeUndefined()
    expect(api.agentSessions.abandonRun).toHaveBeenCalledWith('run')
  })
})

describe('mergeAgentRunEntries', () => {
  const run = { optimisticEntryId: 'optimistic', streamingId: 'streaming' }
  const entry = (id: string, sequence: number, data: AgentTranscriptEntry['entry']): AgentTranscriptEntry => ({
    id, agentSessionId: 'session', sequence, entry: data, createdAt: '',
  })

  it('keeps the transient assistant after persisted steps and pairs each tool result without duplicates', () => {
    const optimistic = entry('optimistic', 1, { kind: 'message', role: 'user', content: 'Go' })
    const streaming = entry('streaming', 2, { kind: 'message', role: 'assistant', content: '' })
    const user = entry('user', 1, { kind: 'message', role: 'user', content: 'Go' })
    const running = entry('run-state', 2, { kind: 'run-state', state: 'running' })
    const call = entry('call', 4, {
      kind: 'tool-invocation', invocationId: 'call-1', toolId: 'read',
      exposedName: 'read', transport: 'native-function', status: 'proposed',
    })
    const result = entry('result', 5, {
      kind: 'tool-result', invocationId: 'call-1', toolId: 'read',
      status: 'completed', content: [{ type: 'text', text: 'done' }],
    })
    const initial = mergeAgentRunEntries([optimistic, streaming], [user, running], run)
    expect(initial.map(item => item.id)).toEqual(['user', 'run-state', 'streaming'])
    const withCall = mergeAgentRunEntries(initial.map(item => item.id === 'streaming'
      ? { ...item, entry: { kind: 'message', role: 'assistant', content: 'partial text' } }
      : item), [call], run)
    expect(withCall.map(item => item.id)).toEqual(['user', 'run-state', 'call', 'streaming'])
    expect(withCall.at(-1)?.entry).toEqual({ kind: 'message', role: 'assistant', content: '' })
    const withResult = mergeAgentRunEntries(withCall, [result], run)
    expect(withResult.map(item => item.id)).toEqual(['user', 'run-state', 'call', 'result', 'streaming'])
    expect(mergeAgentRunEntries(withResult, [call], run).map(item => item.id)).toEqual(['user', 'run-state', 'call', 'result', 'streaming'])
  })
})

describe('reconcileNarrativeNodes', () => {
  const node = (id: string, raw = id) => ({ id, body: { raw } }) as NarrativeNode

  it('keeps the loaded prefix and unchanged node identities while adding a new tail', () => {
    const current = [node('older'), node('a'), node('b')]
    expect(reconcileNarrativeNodes(current, [node('a'), node('b')])).toBe(current)
    const next = reconcileNarrativeNodes(current, [node('a'), node('b'), node('c')])
    expect(next.map(item => item.id)).toEqual(['older', 'a', 'b', 'c'])
    expect(next[0]).toBe(current[0])
    expect(next[1]).toBe(current[1])
    expect(next[2]).toBe(current[2])
  })

  it('replaces edited content and drops a nonoverlapping branch', () => {
    const current = [node('a'), node('b')]
    const next = reconcileNarrativeNodes(current, [node('a'), node('b', 'edited')])
    expect(next[0]).toBe(current[0])
    expect(next[1]?.body.raw).toBe('edited')
    expect(reconcileNarrativeNodes(current, [node('fork')]).map(item => item.id)).toEqual(['fork'])
  })
})

describe('readComposerDraftKey', () => {
  it('isolates temporary drafts by branch and falls back to the selected card before a session exists', () => {
    const timeline = { id: 'timeline-1' } as NarrativeTimeline
    const branchA = { id: 'branch-a' } as NarrativeBranch
    const branchB = { id: 'branch-b' } as NarrativeBranch

    expect(readComposerDraftKey(timeline, branchA)).toBe('timeline-1:branch-a')
    expect(readComposerDraftKey(timeline, branchB)).toBe('timeline-1:branch-b')
    expect(readComposerDraftKey(undefined, undefined, 'card-1')).toBe('card:card-1')
  })
})

describe('resolveNarrativeBranch', () => {
  const branches = [
    { id: 'branch-main' },
    { id: 'branch-fork' },
  ] as NarrativeBranch[]

  it('uses the active branch only when no explicit branch was requested', () => {
    expect(resolveNarrativeBranch(branches, 'branch-main', 'branch-fork')?.id).toBe('branch-fork')
    expect(resolveNarrativeBranch(branches, 'branch-main', 'missing')).toBeUndefined()
    expect(resolveNarrativeBranch(branches, 'branch-main')?.id).toBe('branch-main')
    expect(resolveNarrativeBranch([], 'branch-main')).toBeUndefined()
  })
})

describe('inspectSessionRunStatus', () => {
  it('identifies completed turns as idle', () => {
    const status = inspectSessionRunStatus([
      { id: '1', agentSessionId: 's', sequence: 1, entry: { kind: 'message', role: 'user', content: 'hello' }, createdAt: '' },
      { id: '2', agentSessionId: 's', sequence: 2, entry: { kind: 'message', role: 'assistant', content: 'world' }, createdAt: '' },
      { id: '3', agentSessionId: 's', sequence: 3, entry: { kind: 'run-state', state: 'completed' }, createdAt: '' },
    ] as any)
    expect(status).toEqual({ status: 'idle' })
  })

  it('identifies suspended run-state as suspended', () => {
    const status = inspectSessionRunStatus([
      { id: '1', agentSessionId: 's', sequence: 1, runId: 'run-1', entry: { kind: 'message', role: 'user', content: 'hello' }, createdAt: '' },
      { id: '2', agentSessionId: 's', sequence: 2, runId: 'run-1', entry: { kind: 'run-state', state: 'suspended' }, createdAt: '' },
    ] as any)
    expect(status).toEqual({ runId: 'run-1', status: 'suspended' })
  })

  it('does not offer execution resume for a failed terminal run', () => {
    const status = inspectSessionRunStatus([
      { id: '1', agentSessionId: 's', sequence: 1, runId: 'run-fail', entry: { kind: 'message', role: 'user', content: 'hello' }, createdAt: '' },
      { id: '2', agentSessionId: 's', sequence: 2, runId: 'run-fail', entry: { kind: 'run-state', state: 'failed', reason: '500' }, createdAt: '' },
    ] as any)
    expect(status).toEqual({ status: 'idle' })
  })

  it('identifies uncompleted user message without assistant reply as suspended', () => {
    const status = inspectSessionRunStatus([
      { id: '1', agentSessionId: 's', sequence: 1, runId: 'run-open', entry: { kind: 'message', role: 'user', content: 'hello' }, createdAt: '' },
    ] as any)
    expect(status).toEqual({ runId: 'run-open', status: 'suspended' })
  })
})
