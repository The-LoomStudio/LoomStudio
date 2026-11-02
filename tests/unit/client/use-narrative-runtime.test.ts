import { projectTimelineRounds } from '../../../apps/studio-client/src/features/narrative-runtime/model/timeline-execution-projection.js'
import { createStudioTrpcClient } from '../../../apps/studio-client/src/shared/api/trpc-client.js'
import { describe, expect, it, vi } from 'vitest'
import type { AgentTranscriptEntry, NarrativeBranch, NarrativeNode, NarrativeTimeline } from '../../../apps/studio-client/src/entities/index.js'
import { inspectSessionRunStatus, mergeAgentRunEntries, readComposerDraftKey, reconcileNarrativeNodes, releasePrimaryRun, resolveNarrativeBranch } from '../../../apps/studio-client/src/features/narrative-runtime/model/use-narrative-runtime.js'
import { createStudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'

describe('releasePrimaryRun', () => {
  it('rejects running and failed cancellation without accepting a switch', async () => {
    const api = createStudioApi(createStudioTrpcClient({ fetch: async () => { throw new Error('Unexpected RPC in rendering test') } }))
    api.agentSessions.getTranscript = vi.fn<typeof api.agentSessions.getTranscript>(async () => ({
      session: { kind: 'agent' as const, id: 'primary', agentPresetId: 'preset', entryCount: 1, createdAt: '', updatedAt: '' },
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
      kind: 'tool-invocation' as const, invocationId: 'call-1', toolId: 'read',
      exposedName: 'read', transport: 'native-function' as const, status: 'proposed' as const,
    })
    const result = entry('result', 5, {
      kind: 'tool-result' as const, invocationId: 'call-1', toolId: 'read',
      status: 'completed' as const, content: [{ type: 'text', text: 'done' }],
    })
    const initial = mergeAgentRunEntries([optimistic, streaming], [user, running], run)
    expect(initial.map(item => item.id)).toEqual(['user', 'run-state', 'streaming'])
    const withCall = mergeAgentRunEntries(initial.map(item => item.id === 'streaming'
      ? { ...item, entry: { kind: 'message', role: 'assistant', content: 'partial text' } }
      : item), [call], run)
    expect(withCall.map(item => item.id)).toEqual(['user', 'run-state', 'call', 'streaming'])
    expect(withCall.at(-1)?.entry).toEqual({ kind: 'message', role: 'assistant', content: '', state: 'partial' })
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
  it('keeps a running transcript state distinct from suspension', () => {
    expect(inspectSessionRunStatus([{
      id: 'state', agentSessionId: 'session', sequence: 1, runId: 'live', createdAt: '',
      entry: { kind: 'run-state', state: 'running' },
    }])).toEqual({ runId: 'live', status: 'running' })
  })

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


describe('Timeline execution placement', () => {
  const entry = (id: string, data: AgentTranscriptEntry['entry'], runId = 'run'): AgentTranscriptEntry => ({ id, agentSessionId: 'timeline', sequence: 1, runId, entry: data, createdAt: '' })
  it('anchors work and round boundaries using canonical entry IDs, including helper-authored prose', () => {
    const nodes = [
      { id: 'input-node', entryId: 'input', kind: 'user-input', body: { raw: 'Act' } },
      { id: 'story-node', entryId: 'canonical-story', kind: 'narrative', body: { raw: 'Story' } },
    ] as NarrativeNode[]
    const projection = projectTimelineRounds([
      entry('preparation', { kind: 'message', role: 'user', content: 'Preparation' }, 'earlier'),
      entry('input', { kind: 'message', role: 'user', purpose: 'narrative', narrativeId: 'logical-input', content: 'Act' }),
      entry('work', { source: 'provider-native' as const, replay: 'omit' as const, kind: 'reasoning' as const, visibility: 'visible' as const, content: 'Think' }),
      { ...entry('canonical-story', { kind: 'message', role: 'assistant', purpose: 'narrative', narrativeId: 'independent-logical-id', content: 'Story' }), agentSessionId: 'helper' },
    ], nodes, 'Writer')
    expect(projection[0]?.discussions.map(run => run.input)).toEqual(['Preparation'])
    expect(projection[1]?.inputNode?.id).toBe('input-node')
    expect(projection[1]?.execution.steps.map(step => step.content)).toEqual(['Think', 'Story'])
  })
  it('shows the complete discussion once after length continuation without repeating its partials', () => {
    const projection = projectTimelineRounds([
      entry('partial-1', { kind: 'message', role: 'assistant', content: 'First', state: 'partial' }),
      entry('partial-2', { kind: 'message', role: 'assistant', content: 'First second', state: 'partial', continuesEntryId: 'partial-1' }),
      entry('final', { kind: 'message', role: 'assistant', content: 'First second final', continuesEntryId: 'partial-2' }),
    ], [], 'Writer')
    expect(projection.flatMap(round => round.communications.flatMap(group => group.execution.steps.map(step => step.content)))).toEqual(['First second final'])
  })
})

describe('Timeline round reading projection', () => {
  const entry = (id: string, data: AgentTranscriptEntry['entry'], roundId = 'round', runId = 'write'): AgentTranscriptEntry => ({
    id, agentSessionId: 'timeline', sequence: 1, roundId, candidateId: `${roundId}-candidate`, runId, entry: data, createdAt: '',
  })
  const node = (id: string, kind: NarrativeNode['kind'], runId?: string): NarrativeNode => ({
    id: `${id}-node`, entryId: id, kind, floor: 1, timelineId: 'timeline', body: { format: 'loom-markdown.v1', raw: id }, createdAt: '',
    ...(runId ? { source: { runId } } : {}),
  })
  const user = entry('input', { kind: 'message', role: 'user', purpose: 'narrative', content: 'Act' })
  const story = entry('story', { kind: 'message', role: 'assistant', purpose: 'narrative', content: 'Story' })

  it('preserves work/prose order in one execution and keeps guidance in its own candidate communication', () => {
    const rounds = projectTimelineRounds([user,
      entry('read', { exposedName: 'read', transport: 'native-function' as const, status: 'proposed' as const, kind: 'tool-invocation' as const, invocationId: 'read', toolId: 'read', arguments: {} }), story,
      entry('change', { exposedName: 'change', transport: 'native-function' as const, status: 'proposed' as const, kind: 'tool-invocation' as const, invocationId: 'change', toolId: 'change', arguments: {} }),
      entry('done', { kind: 'message', role: 'assistant', content: 'Done' }),
      entry('guide', { kind: 'message', role: 'user', content: 'Revise this' }, 'round', 'discuss'),
      entry('response', { kind: 'message', role: 'assistant', content: 'Revised' }, 'round', 'discuss'),
    ], [node('input', 'user-input'), node('story', 'narrative')], 'Writer')
    expect(rounds).toHaveLength(1)
    expect(rounds[0]?.execution.steps.map(step => step.kind)).toEqual(['tool', 'narrative', 'tool', 'reply'])
    expect(rounds[0]?.discussions.map(run => [run.input, ...run.steps.map(step => step.content)])).toEqual([['Revise this', 'Revised']])
    expect(rounds[0]?.candidateId).toBe('round-candidate')
  })

  it('keeps discussion at the prose visible when it was sent, including prose appended by that discussion Run', () => {
    const opening = node('opening', 'narrative')
    const start = entry('opening', { kind: 'message', role: 'assistant', purpose: 'narrative', content: 'Opening' })
    const guidance = entry('guide', { kind: 'message', role: 'user', content: 'Test prose' }, 'round', 'discuss')
    const declare = entry('declare', { exposedName: 'official/declare_narrative', transport: 'native-function' as const, status: 'proposed' as const, kind: 'tool-invocation' as const, invocationId: 'declare', toolId: 'official/declare_narrative' }, 'round', 'discuss')
    const prose = entry('second', { kind: 'message', role: 'assistant', purpose: 'narrative', content: 'Second' }, 'round', 'discuss')
    const report = entry('report', { kind: 'message', role: 'assistant', content: 'Done' }, 'round', 'discuss')
    const before = projectTimelineRounds([start, guidance, declare], [opening], 'Writer')
    const after = projectTimelineRounds([start, guidance, declare, prose, report], [opening, node('second', 'narrative')], 'Writer')
    expect(before[0]?.communications.find(group => group.anchorNodeId === opening.id)?.discussions[0]?.input).toBe('Test prose')
    const firstCommunication = after[0]?.communications.find(group => group.anchorNodeId === opening.id)
    expect(firstCommunication?.discussions.map(run => [run.input, ...run.steps.map(step => step.content)])).toEqual([['Test prose', '', 'Done']])
    expect(after[0]?.communications.find(group => group.anchorNodeId === 'second-node')?.discussions).toEqual([])
    expect(after[0]?.execution.steps.map(step => step.content)).toEqual(['opening', 'second'])
  })

  it('renders newly declared streaming prose in the reading flow while its discussion stays at the old floor', () => {
    const rounds = projectTimelineRounds([user, story,
      entry('guide', { kind: 'message', role: 'user', content: 'Add prose' }, 'round', 'discuss'),
      entry('declare', { content: [], kind: 'tool-result' as const, invocationId: 'declare', toolId: 'official/declare_narrative', status: 'completed' as const }, 'round', 'discuss'),
      entry('streaming-prose', { kind: 'message', role: 'assistant', content: 'New prose' }, 'round', 'discuss'),
    ], [node('input', 'user-input'), node('story', 'narrative')], 'Writer', { runId: 'discuss', status: 'running' })
    expect(rounds[0]?.execution.steps.map(step => step.kind)).toEqual(['narrative', 'narrative'])
    expect(rounds[0]?.execution.state).toBe('running')
    const communication = rounds[0]?.communications.find(group => group.anchorNodeId === 'story-node')
    expect(communication?.discussions[0]?.input).toBe('Add prose')
    expect(communication?.discussions[0]?.steps).toEqual([])
  })

  it('keeps separate communication threads for successive adopted prose within one round', () => {
    const rounds = projectTimelineRounds([user, story,
      entry('guide-one', { kind: 'message', role: 'user', content: 'First guidance' }, 'round', 'discuss-one'),
      entry('body-two', { kind: 'message', role: 'assistant', purpose: 'narrative', content: 'New prose' }, 'round', 'discuss-one'),
      entry('guide-two', { kind: 'message', role: 'user', content: 'Second guidance' }, 'round', 'discuss-two'),
    ], [node('input', 'user-input'), node('story', 'narrative'), node('body-two', 'narrative')], 'Writer')
    expect(rounds[0]?.communications.map(group => [group.anchorNodeId, group.discussions.map(run => run.input)])).toEqual([
      ['input-node', []], ['story-node', ['First guidance']], ['body-two-node', ['Second guidance']],
    ])
  })

  it('does not show work from rounds outside the loaded prose window', () => {
    const rounds = projectTimelineRounds([
      entry('old-guide', { kind: 'message', role: 'user', content: 'Old discussion' }, 'old'),
      entry('old-tool', { exposedName: 'old', transport: 'native-function' as const, status: 'proposed' as const, kind: 'tool-invocation' as const, invocationId: 'old-tool', toolId: 'old' }, 'old'), user, story,
    ], [node('input', 'user-input'), node('story', 'narrative')], 'Writer')
    expect(rounds).toHaveLength(1)
    expect(rounds[0]?.execution.steps.map(step => step.content)).toEqual(['story'])
    expect(rounds[0]?.discussions).toEqual([])
  })

  it('shows revised prose in the original work position without repeating the late revision Entry', () => {
    const revision = { ...node('revision', 'narrative', 'write'), body: { format: 'loom-markdown.v1' as const, raw: 'Edited story' } }
    const rounds = projectTimelineRounds([user,
      entry('read', { exposedName: 'read', transport: 'native-function' as const, status: 'proposed' as const, kind: 'tool-invocation' as const, invocationId: 'read', toolId: 'read' }), story,
      entry('after', { exposedName: 'after', transport: 'native-function' as const, status: 'proposed' as const, kind: 'tool-invocation' as const, invocationId: 'after', toolId: 'after' }),
      entry('revision', { kind: 'message', role: 'assistant', purpose: 'narrative', content: 'Edited story' }, 'round', 'revision-run'),
    ], [node('input', 'user-input'), revision], 'Writer')
    expect(rounds[0]?.execution.steps.map(step => step.kind)).toEqual(['tool', 'narrative', 'tool'])
    expect(rounds[0]?.execution.steps[1]?.content).toBe('Edited story')
  })

  it('keeps a historical revision in its old round while new-round work stays in the new round', () => {
    const original = node('story', 'narrative', 'write')
    const revised = { ...original, entryId: 'late-edit', body: { ...original.body, raw: 'Edited' } }
    const rounds = projectTimelineRounds([user, story,
      entry('next-input', { kind: 'message', role: 'user', purpose: 'narrative', content: 'Next' }, 'next', 'next-write'),
      entry('next-tool', { exposedName: 'read', transport: 'native-function' as const, status: 'proposed' as const, kind: 'tool-invocation' as const, invocationId: 'next-tool', toolId: 'read' }, 'next', 'next-write'),
      entry('next-story', { kind: 'message', role: 'assistant', purpose: 'narrative', content: 'Next story' }, 'next', 'next-write'),
      entry('late-edit', { kind: 'message', role: 'assistant', purpose: 'narrative', content: 'Edited' }, 'next', 'edit'),
    ], [node('input', 'user-input'), revised, node('next-input', 'user-input'), node('next-story', 'narrative', 'next-write')], 'Writer')
    expect(rounds.map(round => round.execution.steps.map(step => step.kind))).toEqual([['narrative'], ['tool', 'narrative']])
    expect(rounds[0]?.execution.steps[0]?.content).toBe('Edited')
  })

  it('consumes a declaration once adopted prose arrives so later ordinary streaming remains communication', () => {
    const rounds = projectTimelineRounds([user,
      entry('declare', { content: [], kind: 'tool-result' as const, invocationId: 'declare', toolId: 'official/declare_narrative', status: 'completed' as const }), story,
      entry('streaming-final', { kind: 'message', role: 'assistant', content: 'Finishing up' }),
    ], [node('input', 'user-input'), node('story', 'narrative')], 'Writer')
    expect(rounds[0]?.execution.steps.map(step => step.kind)).toEqual(['narrative', 'reply'])
  })
})
