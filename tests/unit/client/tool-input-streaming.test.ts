import { projectTimelineRounds } from '../../../apps/studio-client/src/features/narrative-runtime/model/timeline-execution-projection.js'
import { describe, expect, it, vi } from 'vitest'
import { runAgentTurn, mergeAgentRunEntries, retainRunPresentation, type ObservedRun } from '../../../apps/studio-client/src/features/narrative-runtime/model/agent-run-observer.js'
import type { AgentTranscriptEntry } from '../../../apps/studio-client/src/entities/agent.js'
import type { StudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'

type Batch = Awaited<ReturnType<StudioApi['agentSessions']['subscribeRun']>>
const delta = (id: string, text: string): Extract<Batch['events'][number], { type: 'tool-input-delta' }> => ({
  type: 'tool-input-delta', runId: 'run', providerRunId: 'provider', providerStep: 1,
  streamId: `tool:${id}`, toolCallId: id, toolName: 'codeact_json', delta: text,
})
const saved = (id: string) => ({ id: `saved-${id}`, runId: 'run', agentSessionId: 'session', sequence: 1, createdAt: '',
  entry: { streamId: `tool:${id}`, kind: 'tool-invocation' as const, invocationId: `invocation-${id}`, providerItemId: id,
    toolId: 'codeact', exposedName: 'codeact_json', transport: 'native-function' as const, status: 'proposed' as const, arguments: {} } })
const stop: Batch['events'][number] = { type: 'suspended', runId: 'run' }
function fixture(batches: Batch[], committed: AgentTranscriptEntry[] = []) {
  const subscribeRun = vi.fn()
  for (const batch of batches) subscribeRun.mockResolvedValueOnce(batch)
  const api = { agentSessions: { subscribeRun,
    getTranscript: vi.fn(async () => ({ session: { id: 'session' }, entries: committed })),
  } } as unknown as StudioApi
  const run: ObservedRun = { api, runId: 'run', sessionId: 'session', target: 'agent', selection: 1,
    streamingId: 'streaming', cursor: 0, status: 'running', observing: true }
  let entries: AgentTranscriptEntry[] = []
  const states: AgentTranscriptEntry[][] = []
  return { run, states, subscribeRun, entries: () => entries,
    execute: (onNarrativeCommitted?: () => Promise<void>) => runAgentTurn(run, () => true, update => { entries = update(entries); states.push(entries) }, () => {}, () => {}, onNarrativeCommitted) }
}

describe('streamed tool input projection', () => {
  it('keeps interleaved arguments separate and replaces drafts with saved invocations using stable presentation identities', async () => {
    const f = fixture([{ events: [delta('a', '{'), delta('b', 'second'), delta('a', '}'),
      { type: 'transcript-appended', runId: 'run', entries: [saved('a'), { ...saved('b'), sequence: 2 }] }, stop],
      nextCursor: 5, done: true, state: 'suspended' }])
    await f.execute()
    expect(f.states[2].map(item => item.entry.kind === 'tool-input' ? item.entry.rawInput : undefined)).toEqual(['{}', 'second'])
    expect(f.entries().map(item => item.id)).toEqual(['saved-a', 'saved-b'])
    expect(f.entries().map(item => item.presentationId)).toEqual(f.states[2].map(item => item.id))
    expect(retainRunPresentation(f.entries(), [saved('a')])[0].presentationId).toBe(f.states[2][0].id)
    const repeated = mergeAgentRunEntries(f.entries(), [saved('a')], f.run)
    expect(repeated.find(item => item.id === 'saved-a')?.presentationId).toBe(f.states[2][0].id)
  })

  it('retains unfinished arguments as interrupted when the run stops without a saved invocation', async () => {
    const f = fixture([{ events: [delta('a', '{"source":'), stop], nextCursor: 2, done: true, state: 'suspended' }])
    await f.execute()
    expect(f.entries()[0].entry).toMatchObject({ kind: 'tool-input', status: 'interrupted', rawInput: '{"source":' })
  })

  it('restores an expired snapshot before appending subsequent deltas', async () => {
    const f = fixture([
      { events: [], nextCursor: 100, done: false, state: 'running', replayExpired: true, partialEvents: [delta('a', '{')] },
      { events: [delta('a', '}'), stop], nextCursor: 102, done: true, state: 'suspended' },
    ])
    await f.execute()
    expect(f.subscribeRun).toHaveBeenNthCalledWith(2, 'run', 100, 'session')
    expect(f.entries()).toHaveLength(1)
    expect(f.entries()[0].entry).toHaveProperty('rawInput', '{}')
  })

  it('does not resurrect a draft committed while the transcript was being read', async () => {
    const f = fixture([
      { events: [], nextCursor: 100, done: false, state: 'running', replayExpired: true, partialEvents: [delta('a', '{')] },
      { events: [{ type: 'transcript-appended', runId: 'run', entries: [saved('a')] }, stop], nextCursor: 102, done: true, state: 'suspended' },
    ], [saved('a')])
    await f.execute()
    expect(f.states.every(entries => entries.every(entry => entry.entry.kind !== 'tool-input'))).toBe(true)
    expect(f.entries().map(entry => entry.id)).toEqual(['saved-a'])
  })
})

it('settles streamed reasoning when tool arguments start and retains its display identity when saved', async () => {
  const f = fixture([{ events: [
    { type: 'reasoning-delta', runId: 'run', providerRunId: 'provider', providerStep: 1, reasoningId: 'reason', streamId: 'run:1:reasoning', delta: 'Read the scene.' },
    delta('read', '{'),
    { type: 'transcript-appended', runId: 'run', entries: [{ id: 'saved-reason', agentSessionId: 'session', runId: 'run', sequence: 1, createdAt: '',
      entry: { streamId: 'run:1:reasoning', kind: 'reasoning' as const, source: 'provider-native' as const, content: 'Read the scene.', visibility: 'collapsed' as const, replay: 'omit' as const } }, { ...saved('read'), sequence: 2 }] }, stop,
  ], nextCursor: 4, done: true, state: 'suspended' }])
  await f.execute()
  expect(f.states[1][0].entry).toHaveProperty('state', 'completed')
  expect(f.entries().find(item => item.id === 'saved-reason')?.presentationId).toBe(f.states[0][0].presentationId)
})

it('does not assign a current stream identity to older persisted reasoning from the same run', () => {
  const partial: AgentTranscriptEntry = { id: 'streaming-reasoning-run', presentationId: 'current-step', runId: 'run', agentSessionId: 'session', sequence: 3, createdAt: '',
    entry: { visibility: 'collapsed' as const, replay: 'omit' as const, kind: 'reasoning' as const, source: 'provider-native' as const, content: 'New thought' } }
  const older = { ...partial, id: 'saved-old', presentationId: undefined, sequence: 1, entry: { kind: 'reasoning' as const, source: 'provider-native' as const, visibility: 'collapsed' as const, replay: 'omit' as const, content: 'Old thought' } }
  expect(retainRunPresentation([partial], [older])[0].presentationId).toBeUndefined()
})


it('uses server narrative purpose and exchange identity instead of inferring them from automatic mode', () => {
  const message = (id: string, role: 'user' | 'assistant', content: string): AgentTranscriptEntry & { entry: Extract<AgentTranscriptEntry['entry'], { kind: 'message' }> } => ({
    id, runId: 'run', agentSessionId: 'session', sequence: 1, createdAt: '', timelinePosition: {}, entry: { kind: 'message', role, content },
  })
  const body = message('streaming-timeline-run', 'assistant', 'The door opens.')
  if (body.entry.kind === 'message') { body.entry.purpose = 'narrative'; body.entry.state = 'partial' }
  const active = { runId: 'run', status: 'running' as const }
  const writing = projectTimelineRounds([body], [], 'writer', active)
  expect(writing[0].execution.steps).toMatchObject([{ kind: 'narrative', content: 'The door opens.', state: 'running' }])
  const user = { ...message('user', 'user', 'Explain the scene'), timelinePosition: { exchangeId: 'user' } }
  const reply = { ...body, timelinePosition: { exchangeId: 'user' }, entry: { ...body.entry, purpose: 'discussion' as const } }
  const discussion = projectTimelineRounds([user, reply], [], 'writer', active)
  expect(discussion[0].execution.steps).toEqual([])
  expect(discussion[0].discussions[0].steps).toMatchObject([{ kind: 'reply', content: 'The door opens.' }])
})


it('refreshes committed prose while the Run is still running and preserves the reply stream', async () => {
  const prose: Extract<Batch['events'][number], { type: 'transcript-appended' }>['entries'][number] = { id: 'prose', runId: 'run', agentSessionId: 'session', sequence: 1, createdAt: '',
    entry: { kind: 'message', role: 'assistant', purpose: 'narrative', content: 'Story.' } }
  const f = fixture([
    { events: [{ type: 'text-delta', runId: 'run', providerRunId: 'provider', providerStep: 1, delta: 'Still replying' },
      { type: 'transcript-appended', runId: 'run', entries: [prose] }], nextCursor: 2, state: 'running', done: false },
    { events: [stop], nextCursor: 3, state: 'suspended', done: true },
  ])
  const refresh = vi.fn(async () => {
    expect(f.run.status).toBe('running')
    expect(f.entries().some(item => item.id === 'prose')).toBe(true)
    expect(f.entries().find(item => item.id === 'streaming')?.entry).toMatchObject({ content: 'Still replying' })
  })
  await f.execute(refresh)
  expect(refresh).toHaveBeenCalledTimes(1)
})

it('starts a separate thought after committed declared prose without replaying its text', async () => {
  const f = fixture([{ events: [
    { type: 'reasoning-delta', runId: 'run', providerRunId: 'first', providerStep: 1, reasoningId: 'reason', delta: 'Before' },
    { type: 'text-delta', runId: 'run', providerRunId: 'first', providerStep: 1, streamId: 'run:1:text', delta: 'Story' },
    { type: 'transcript-appended', runId: 'run', entries: [{ id: 'prose', runId: 'run', agentSessionId: 'session', sequence: 2, createdAt: '', entry: { kind: 'message', role: 'assistant', purpose: 'narrative', streamId: 'run:1:text', content: 'Story' } }] },
    { type: 'reasoning-delta', runId: 'run', providerRunId: 'second', providerStep: 2, reasoningId: 'reason', delta: 'After' }, stop,
  ], nextCursor: 5, state: 'suspended', done: true }])
  await f.execute()
  expect(f.entries().map(item => item.entry).filter(entry => entry.kind === 'reasoning').map(entry => entry.content)).toEqual(['Before', 'After'])
  expect(f.entries().findIndex(item => item.id === 'prose')).toBeLessThan(f.entries().findIndex(item => item.entry.kind === 'reasoning' && item.entry.content === 'After'))
  expect(f.entries().find(item => item.id === 'streaming')?.entry).toMatchObject({ content: '' })
})
