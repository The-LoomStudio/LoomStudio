// @vitest-environment happy-dom
import { act, createElement, type FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSession, AgentTranscriptEntry, NarrativeBranch, NarrativeNode, NarrativeTimeline } from '../../../apps/studio-client/src/entities/index.js'
import type { StudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'
import { useNarrativeRuntime } from '../../../apps/studio-client/src/features/narrative-runtime/model/use-narrative-runtime.js'

const commitRefresh = vi.hoisted(() => new Set<() => void>())
vi.mock('../../../apps/studio-client/src/shared/api/data-commit-events.js', () => ({ subscribeDataCommits: (_operations: unknown, refresh: () => void) => {
  commitRefresh.add(refresh)
  return () => { commitRefresh.delete(refresh) }
} }))
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true) })
const roots: ReturnType<typeof createRoot>[] = []
afterEach(async () => { for (const root of roots.splice(0)) await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals() })

type Batch = Awaited<ReturnType<StudioApi['agentSessions']['subscribeRun']>>
async function mount(options: { preset?: string; suspended?: boolean; entries?: AgentTranscriptEntry[]; reason?: string } = {}) {
  const timeline: NarrativeTimeline = { id: 'timeline', activeBranchId: 'branch', promptResourceIds: [], createdAt: '', updatedAt: '' }
  const branch: NarrativeBranch = { id: 'branch', timelineId: timeline.id, stateHeadRevisionId: 'state', createdAt: '', updatedAt: '' }
  let session: AgentSession = { id: timeline.id, kind: 'timeline', timelineId: timeline.id, agentPresetId: options.preset, entryCount: 0, createdAt: '', updatedAt: '' }
  const child: AgentSession = { ...session, kind: 'agent', id: 'child', agentPresetId: 'helper' }
  let entries: AgentTranscriptEntry[] = options.entries ?? (options.suspended ? [{ id: 'checkpoint', agentSessionId: timeline.id, runId: 'run', sequence: 1, createdAt: '', entry: { kind: 'run-state', state: 'running' } }] : [])
  let nodes: NarrativeNode[] = []
  let runState = options.suspended ? 'suspended' as const : 'completed' as 'completed' | 'suspended'
  const api = {
    narratives: {
      list: vi.fn(async () => ({ timelines: [timeline] })),
      get: vi.fn(async () => ({ timeline, branches: [branch] })),
      getPage: vi.fn(async () => ({ timeline, branch, nodes })),
      getSwipes: vi.fn(async () => ({})),
      appendInput: vi.fn(async (input: Parameters<StudioApi['narratives']['appendInput']>[0]) => {
        const node: NarrativeNode = { id: input.nodeId!, kind: 'user-input', floor: 1, timelineId: timeline.id, body: { format: 'loom-markdown.v1', raw: input.content }, createdAt: '' }
        nodes = [...nodes, node]
        return { timeline, branch, node }
      }),
    },
    agentSessions: {
      list: vi.fn(async () => ({ sessions: [child] })),
      getTranscript: vi.fn(async ({ agentSessionId }: { agentSessionId: string }) => ({ session: agentSessionId === timeline.id ? session : child, entries: agentSessionId === timeline.id ? entries : [] })),
      runState: vi.fn<StudioApi['agentSessions']['runState']>(async () => ({ runId: 'run', state: runState, ...(options.reason ? { reason: options.reason } : {}) })),
      create: vi.fn(),
      update: vi.fn(async (input: { agentPresetId?: string; narrativeMode?: 'declared' | 'automatic' }) => { session = { ...session, ...input }; return { session } }),
      createRun: vi.fn<StudioApi['agentSessions']['createRun']>(async () => ({ runId: 'run' })),
      subscribeRun: vi.fn<StudioApi['agentSessions']['subscribeRun']>(async () => ({ events: [], nextCursor: 1, done: true, state: 'completed', replayExpired: true })),
      resumeRun: vi.fn(async () => ({ runId: 'run', accepted: true })),
      abandonRun: vi.fn(async () => { entries = []; runState = 'completed'; return { runId: 'run', accepted: true } }),
      acknowledgeRunCompletion: vi.fn(async () => ({ runId: 'run', accepted: true })),
    },
  }
  const failures: unknown[] = []
  const reported = async (action: () => Promise<void>) => { try { await action(); return true } catch (error) { failures.push(error); return false } }
  let current!: ReturnType<typeof useNarrativeRuntime>
  function Harness() {
    current = useNarrativeRuntime({ api: api as unknown as StudioApi, storageScope: 'root-contract', initialInput: '', selectedCardId: 'card', onSelectCard() {}, onSelectAgentPreset() {}, runAction: reported, runAgentAction: async action => { await reported(action) }, runLatestAction: async action => { await action({ isCurrent: () => true } as never) } })
    return null
  }
  const root = createRoot(document.createElement('div'))
  roots.push(root)
  await act(async () => root.render(createElement(Harness)))
  await act(async () => { await current.activateTimeline(timeline.id) })
  return { api, failures, get current() { return current }, event: { preventDefault() {} } as FormEvent, setEntries: (value: AgentTranscriptEntry[]) => { entries = value } }
}

describe('Timeline root Session contracts', () => {
  it.each([false, true])('retries an edited latest discussion without appending a roleplay input (suspended=%s)', async suspended => {
    const entries: AgentTranscriptEntry[] = [
      { id: 'guide', agentSessionId: 'timeline', sequence: 1, runId: 'run', createdAt: '', entry: { kind: 'message', role: 'user', content: 'Old guidance' } },
      { id: 'checkpoint', agentSessionId: 'timeline', sequence: 2, runId: 'run', createdAt: '', entry: { kind: 'run-state', state: suspended ? 'failed' : 'completed', recovery: { materialBaseline: {} } } },
    ]
    const f = await mount({ preset: 'writer', suspended, entries })
    expect(f.current.canRetryNarrativeInput).toBe(true)
    await act(async () => { expect(await f.current.retryDiscussionInput('guide', 'Edited guidance')).toBe(true) })
    expect(f.api.agentSessions.createRun).toHaveBeenCalledWith(expect.objectContaining({
      agentSessionId: 'timeline', input: 'Edited guidance', retry: { entryId: 'guide' }, narrativeTarget: { timelineId: 'timeline', branchId: 'branch' },
    }))
    expect(f.api.narratives.appendInput).not.toHaveBeenCalled()
    expect(f.api.agentSessions.resumeRun).not.toHaveBeenCalled()
    expect(f.api.agentSessions.abandonRun).toHaveBeenCalledTimes(suspended ? 1 : 0)
    expect(f.failures).toEqual([])
  })

  it('loads without a preset, then updates the preset and mode on the same identity', async () => {
    const f = await mount()
    expect(f.current.primarySession).toMatchObject({ id: 'timeline', kind: 'timeline', agentPresetId: undefined })
    await act(async () => { await f.current.configureRoot({ agentPresetId: 'writer', narrativeMode: 'automatic' }) })
    expect(f.api.agentSessions.update).toHaveBeenCalledWith({ agentSessionId: 'timeline', agentPresetId: 'writer', narrativeMode: 'automatic' })
    expect(f.current.primarySession).toMatchObject({ id: 'timeline', agentPresetId: 'writer', narrativeMode: 'automatic' })
    expect(f.api.agentSessions.create).not.toHaveBeenCalled()
    expect(f.failures).toEqual([])
  })

  it('appends roleplay once, then sends discussion through the same root without appending', async () => {
    const f = await mount({ preset: 'writer' })
    await act(async () => { f.current.setInput('Walk outside') })
    await act(async () => { await f.current.submitTurn(f.event) })
    const written = f.api.narratives.appendInput.mock.calls[0]![0]
    expect(f.api.agentSessions.createRun).toHaveBeenNthCalledWith(1, expect.objectContaining({ agentSessionId: 'timeline', input: 'Walk outside', narrativeTarget: { timelineId: 'timeline', branchId: 'branch', inputNodeId: written.nodeId } }))
    await act(async () => { f.current.setInputMode('discussion'); f.current.setInput('Keep the scene quiet') })
    await act(async () => { await f.current.submitTurn(f.event) })
    expect(f.api.narratives.appendInput).toHaveBeenCalledOnce()
    expect(f.api.agentSessions.createRun).toHaveBeenNthCalledWith(2, expect.objectContaining({ agentSessionId: 'timeline', input: 'Keep the scene quiet', narrativeTarget: { timelineId: 'timeline', branchId: 'branch' } }))
    expect(f.api.agentSessions.create).not.toHaveBeenCalled()
    expect(f.failures).toEqual([])
  })

  it('keeps roleplay and discussion drafts separate when the bottom mode button switches', async () => {
    const f = await mount({ preset: 'writer' })
    await act(async () => { f.current.setInput('Unsaved action') })
    await act(async () => { f.current.setInputMode('discussion') })
    expect(f.current.input).toBe('')
    await act(async () => { f.current.setInput('Unsaved instruction') })
    await act(async () => { f.current.setInputMode('roleplay') })
    expect(f.current.input).toBe('Unsaved action')
    await act(async () => { f.current.setInputMode('discussion') })
    expect(f.current.input).toBe('Unsaved instruction')
    await act(async () => { await f.current.submitTurn(f.event) })
    expect(f.current.input).toBe('')
    await act(async () => { f.current.setInputMode('roleplay') })
    expect(f.current.input).toBe('Unsaved action')
    expect(f.api.narratives.appendInput).not.toHaveBeenCalled()
    expect(f.failures).toEqual([])
  })

  it('keeps observing root output when the sidebar selects a helper Session', async () => {
    const f = await mount({ preset: 'writer' })
    const next = Promise.withResolvers<Batch>()
    f.api.agentSessions.subscribeRun.mockResolvedValueOnce({ events: [{ type: 'text-delta', runId: 'run', providerRunId: 'provider', providerStep: 1, delta: 'First' }], nextCursor: 1, done: false, state: 'running' }).mockReturnValueOnce(next.promise)
    await act(async () => { f.current.setInputMode('discussion'); f.current.setInput('Discuss') })
    await act(async () => { await f.current.submitTurn(f.event) })
    await vi.waitFor(() => expect(f.api.agentSessions.subscribeRun).toHaveBeenCalledTimes(2))
    await act(async () => { await f.current.activateAgentSession('child') })
    expect(f.current.agentSession?.id).toBe('child')
    expect(f.current.primarySession?.id).toBe('timeline')
    f.setEntries([{ id: 'saved-partial', agentSessionId: 'timeline', runId: 'run', sequence: 1, createdAt: '', entry: { kind: 'message', role: 'assistant', content: 'First second', state: 'partial' } }])
    await act(async () => { next.resolve({ events: [{ type: 'text-delta', runId: 'run', providerRunId: 'provider', providerStep: 1, delta: ' second' }, { type: 'suspended', runId: 'run' }], nextCursor: 2, done: true, state: 'suspended' }) })
    expect(f.current.rootMessages.find(entry => entry.id === 'saved-partial')?.entry.content).toBe('First second')
    expect(f.current.rootActiveRun?.status).toBe('suspended')
    expect(f.current.agentMessages).toEqual([])
    expect(f.failures).toEqual([])
  })

  it('isolates concurrent root and sidebar runs, including a late response after sidebar reselection', async () => {
    const f = await mount({ preset: 'writer' })
    const rootBatch = Promise.withResolvers<Batch>()
    const childBatch = Promise.withResolvers<Batch>()
    f.api.agentSessions.createRun.mockImplementation(async request => ({ runId: `run-${request.agentSessionId}` }))
    f.api.agentSessions.subscribeRun.mockImplementation(runId => runId === 'run-timeline' ? rootBatch.promise : childBatch.promise)
    await act(async () => { f.current.setInputMode('discussion'); f.current.setInput('Root request') })
    await act(async () => { await f.current.submitTurn(f.event) })
    await act(async () => { await f.current.activateAgentSession('child'); f.current.setAgentInput('Child request') })
    let childSend!: Promise<void>
    await act(async () => { childSend = f.current.submitAgentTurn(f.event) })
    expect(f.api.agentSessions.subscribeRun).toHaveBeenCalledWith('run-timeline', 0, 'timeline')
    expect(f.api.agentSessions.subscribeRun).toHaveBeenCalledWith('run-child', 0, 'child')
    expect(f.current.rootActiveRun?.status).toBe('running')
    expect(f.current.activeAgentRun?.status).toBe('running')
    f.setEntries([{ id: 'root-answer', agentSessionId: 'timeline', runId: 'run-timeline', sequence: 1, createdAt: '',
      entry: { kind: 'message', role: 'assistant', content: 'Root only', state: 'partial' } }])
    await act(async () => { rootBatch.resolve({ events: [{ type: 'suspended', runId: 'run-timeline' }], nextCursor: 1, done: true, state: 'suspended' }) })
    expect(f.current.rootActiveRun?.status).toBe('suspended')
    expect(f.current.activeAgentRun?.status).toBe('running')
    expect(f.current.agentMessages.some(entry => entry.entry.content === 'Root only')).toBe(false)
    await act(async () => { await f.current.activateAgentSession('child') })
    await act(async () => {
      childBatch.resolve({ events: [{ type: 'text-delta', runId: 'run-child', providerRunId: 'provider', providerStep: 1, delta: 'Stale child' },
        { type: 'suspended', runId: 'run-child' }], nextCursor: 1, done: true, state: 'suspended' })
      await childSend
    })
    expect(f.current.agentMessages).toEqual([])
    expect(f.current.activeAgentRun).toBeUndefined()
    expect(f.current.rootMessages.map(entry => entry.id)).toEqual(['root-answer'])
    expect(f.current.rootActiveRun?.status).toBe('suspended')
    expect(f.failures).toEqual([])
  })

  it.each(['resume', 'abandon'] as const)('restores a suspended root on reload and can %s it', async action => {
    const f = await mount({ preset: 'writer', suspended: true })
    expect(f.current.rootActiveRun).toMatchObject({ runId: 'run', status: 'suspended' })
    expect(f.current.rootRecovery?.status).toBe('suspended')
    expect(f.api.agentSessions.subscribeRun).not.toHaveBeenCalled()
    if (action === 'resume') {
      await act(async () => { await f.current.resumeRootRun() })
      expect(f.api.agentSessions.resumeRun).toHaveBeenCalledWith({ runId: 'run', agentSessionId: 'timeline' })
      expect(f.api.agentSessions.subscribeRun).toHaveBeenCalledWith('run', 0, 'timeline')
      expect(f.current.rootActiveRun?.status).toBe('completed')
    } else {
      await act(async () => { await f.current.abandonRootRun() })
      expect(f.api.agentSessions.abandonRun).toHaveBeenCalledWith('run', 'timeline')
      expect(f.current.rootActiveRun).toBeUndefined()
      expect(f.current.rootRecovery).toBeUndefined()
    }
    expect(f.failures).toEqual([])
  })

  const reason = 'Provider request failed (503): service unavailable'
  const failedCheckpoint: Awaited<ReturnType<StudioApi['agentSessions']['getTranscript']>>['entries'][number] = { id: 'failed-checkpoint', agentSessionId: 'timeline', runId: 'run', sequence: 2, createdAt: '',
    entry: { kind: 'run-state', state: 'failed', reason, recovery: { version: 1 } } }

  it('resolves a provider failure without output and resumes without sending the input twice', async () => {
    const f = await mount({ preset: 'writer' })
    f.api.agentSessions.runState.mockResolvedValue({ runId: 'run', state: 'suspended', reason })
    f.api.agentSessions.subscribeRun.mockResolvedValueOnce({ events: [{ type: 'failed', runId: 'run', error: { name: 'Error', message: reason } }], nextCursor: 1, done: true, state: 'failed' })
    f.setEntries([failedCheckpoint])
    await act(async () => { f.current.setInput('Walk outside') })
    await act(async () => { await f.current.submitTurn(f.event) })
    expect(f.current.rootActiveRun).toMatchObject({ runId: 'run', status: 'suspended', error: reason })
    expect(f.current.rootRecovery).toMatchObject({ status: 'suspended', error: reason })
    expect(f.current.input).toBe('')
    expect(f.api.agentSessions.runState).toHaveBeenCalledWith('run', 'timeline')
    f.setEntries([])
    await act(async () => { await f.current.resumeRootRun() })
    expect(f.current.rootActiveRun?.status).toBe('completed')
    expect(f.current.rootRecovery).toBeUndefined()
    expect(f.api.narratives.appendInput).toHaveBeenCalledOnce()
    expect(f.api.agentSessions.createRun).toHaveBeenCalledOnce()
    expect(f.api.agentSessions.resumeRun).toHaveBeenCalledOnce()
    expect(f.failures).toEqual([])
  })

  it('restores the same failed checkpoint and error after reload and deduplicates concurrent actions', async () => {
    const f = await mount({ preset: 'writer', suspended: true, entries: [failedCheckpoint], reason })
    expect(f.current.rootActiveRun).toMatchObject({ runId: 'run', status: 'suspended', error: reason })
    expect(f.current.rootRecovery).toMatchObject({ status: 'suspended', error: reason })
    const resumed = Promise.withResolvers<Awaited<ReturnType<StudioApi['agentSessions']['resumeRun']>>>()
    f.api.agentSessions.resumeRun.mockReturnValueOnce(resumed.promise)
    await act(async () => {
      const first = f.current.resumeRootRun()
      await f.current.resumeRootRun()
      await f.current.abandonRootRun()
      expect(f.api.agentSessions.resumeRun).toHaveBeenCalledOnce()
      expect(f.api.agentSessions.abandonRun).not.toHaveBeenCalled()
      f.setEntries([])
      resumed.resolve({ runId: 'run', accepted: true })
      await first
    })
    expect(f.current.rootActiveRun?.status).toBe('completed')
    expect(f.api.agentSessions.createRun).not.toHaveBeenCalled()
    expect(f.api.narratives.appendInput).not.toHaveBeenCalled()
    expect(f.failures).toEqual([])
  })

  it('resolves terminal recovery when a concurrent commit refresh supersedes its transcript read', async () => {
    const f = await mount({ preset: 'writer' })
    f.api.agentSessions.runState.mockResolvedValue({ runId: 'run', state: 'suspended', reason })
    const terminalRead = Promise.withResolvers<Awaited<ReturnType<StudioApi['agentSessions']['getTranscript']>>>()
    f.api.agentSessions.getTranscript.mockReturnValueOnce(terminalRead.promise)
    f.api.agentSessions.subscribeRun.mockResolvedValueOnce({ events: [{ type: 'failed', runId: 'run', error: { name: 'Error', message: reason } }], nextCursor: 1, done: true, state: 'failed' })
    await act(async () => { f.current.setInput('Walk outside') })
    await act(async () => { await f.current.submitTurn(f.event) })
    const newer = { id: 'newer', agentSessionId: 'timeline', runId: 'run', sequence: 3, createdAt: '', entry: { kind: 'reasoning' as const, content: 'Saved diagnostic', source: 'provider-native' as const, visibility: 'collapsed' as const, replay: 'omit' as const } } satisfies AgentTranscriptEntry
    f.setEntries([failedCheckpoint, newer])
    await act(async () => { for (const refresh of commitRefresh) refresh() })
    expect(f.current.rootMessages.map(entry => entry.id)).toEqual(['failed-checkpoint', 'newer'])
    await act(async () => {
      terminalRead.resolve({ session: f.current.primarySession!, entries: [failedCheckpoint] })
    })
    expect(f.current.rootActiveRun).toMatchObject({ runId: 'run', status: 'suspended', error: reason })
    expect(f.current.rootRecovery).toMatchObject({ status: 'suspended', error: reason })
    expect(f.current.rootMessages.map(entry => entry.id)).toEqual(['failed-checkpoint', 'newer'])
    expect(f.api.agentSessions.runState).toHaveBeenCalledWith('run', 'timeline')
    expect(f.failures).toEqual([])
  })

  it('keeps a failed run without a checkpoint terminal', async () => {
    const f = await mount({ preset: 'writer' })
    f.setEntries([{ ...failedCheckpoint, entry: { kind: 'run-state', state: 'failed', reason } }])
    f.api.agentSessions.subscribeRun.mockResolvedValueOnce({ events: [{ type: 'failed', runId: 'run', error: { name: 'Error', message: reason } }], nextCursor: 1, done: true, state: 'failed' })
    await act(async () => { f.current.setInput('Walk outside') })
    await act(async () => { await f.current.submitTurn(f.event) })
    expect(f.current.rootActiveRun?.status).toBe('failed')
    expect(f.current.rootRecovery).toMatchObject({ status: 'failed', error: reason })
    expect(f.api.agentSessions.runState).not.toHaveBeenCalled()
    await act(async () => { await f.current.resumeRootRun() })
    expect(f.api.agentSessions.resumeRun).not.toHaveBeenCalled()
    expect(f.failures).toEqual([])
  })
})
