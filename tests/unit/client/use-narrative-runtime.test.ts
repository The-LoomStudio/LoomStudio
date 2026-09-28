import { describe, expect, it } from 'vitest'
import type { NarrativeBranch, NarrativeTimeline } from '../../../apps/studio-client/src/entities/index.js'
import { inspectSessionRunStatus, readComposerDraftKey, resolveNarrativeBranch } from '../../../apps/studio-client/src/features/narrative-runtime/model/use-narrative-runtime.js'

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
