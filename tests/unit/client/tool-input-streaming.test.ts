import { describe, expect, it, vi } from 'vitest'
import { runAgentTurn, mergeAgentRunEntries, retainToolPresentation, type ObservedRun } from '../../../apps/studio-client/src/features/narrative-runtime/model/agent-run-observer.js'
import type { AgentTranscriptEntry } from '../../../apps/studio-client/src/entities/agent.js'
import type { StudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'

type Batch = Awaited<ReturnType<StudioApi['agentSessions']['subscribeRun']>>
const delta = (id: string, text: string): Extract<Batch['events'][number], { type: 'tool-input-delta' }> => ({
  type: 'tool-input-delta', runId: 'run', providerRunId: 'provider', providerStep: 1,
  toolCallId: id, toolName: 'codeact_json', delta: text,
})
const saved = (id: string) => ({ id: `saved-${id}`, runId: 'run', agentSessionId: 'session', sequence: 1, createdAt: '',
  entry: { kind: 'tool-invocation' as const, invocationId: `invocation-${id}`, providerItemId: id,
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
    execute: () => runAgentTurn(run, () => true, update => { entries = update(entries); states.push(entries) }, () => {}, () => {}) }
}

describe('streamed tool input projection', () => {
  it('keeps interleaved arguments separate and replaces drafts with saved invocations using stable presentation identities', async () => {
    const f = fixture([{ events: [delta('a', '{'), delta('b', 'second'), delta('a', '}'),
      { type: 'transcript-appended', runId: 'run', entries: [saved('a'), { ...saved('b'), sequence: 2 }] }, stop],
      nextCursor: 5, done: true, state: 'suspended' }])
    await f.execute()
    expect(f.states[2].map(item => item.entry.rawInput)).toEqual(['{}', 'second'])
    expect(f.entries().map(item => item.id)).toEqual(['saved-a', 'saved-b'])
    expect(f.entries().map(item => item.presentationId)).toEqual(f.states[2].map(item => item.id))
    expect(retainToolPresentation(f.entries(), [saved('a')])[0].presentationId).toBe(f.states[2][0].id)
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
      { events: [], nextCursor: 100, done: false, state: 'running', replayExpired: true, partialToolInputs: [delta('a', '{')] },
      { events: [delta('a', '}'), stop], nextCursor: 102, done: true, state: 'suspended' },
    ])
    await f.execute()
    expect(f.subscribeRun).toHaveBeenNthCalledWith(2, 'run', 100, 'session')
    expect(f.entries()).toHaveLength(1)
    expect(f.entries()[0].entry.rawInput).toBe('{}')
  })

  it('does not resurrect a draft committed while the transcript was being read', async () => {
    const f = fixture([
      { events: [], nextCursor: 100, done: false, state: 'running', replayExpired: true, partialToolInputs: [delta('a', '{')] },
      { events: [{ type: 'transcript-appended', runId: 'run', entries: [saved('a')] }, stop], nextCursor: 102, done: true, state: 'suspended' },
    ], [saved('a')])
    await f.execute()
    expect(f.states.every(entries => entries.every(entry => entry.entry.kind !== 'tool-input'))).toBe(true)
    expect(f.entries().map(entry => entry.id)).toEqual(['saved-a'])
  })
})
