import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FormEvent } from 'react'
import { useNarrativeRuntime } from '../../../apps/studio-client/src/features/narrative-runtime/model/use-narrative-runtime.js'
import type { StudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'

const hooks = vi.hoisted(() => ({
  cursor: 0,
  values: [] as unknown[],
  commitEffect: undefined as (() => void | (() => void)) | undefined,
  onCommit: undefined as ((operations: Array<{ entityType: string; entityId: string }>) => void) | undefined,
}))
vi.mock('../../../apps/studio-client/src/shared/api/data-commit-events.js', () => ({
  subscribeDataCommits: (onCommit: typeof hooks.onCommit) => {
    hooks.onCommit = onCommit
    return () => { hooks.onCommit = undefined }
  },
}))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: (effect: () => void, deps?: unknown[]) => {
    if (deps?.[1] === 'timeline' && deps?.[2] === 'branch') hooks.commitEffect = effect
  },
  useState: (initial: unknown) => {
    const index = hooks.cursor++
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial
    return [hooks.values[index], (value: unknown) => {
      hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value
    }]
  },
  useRef: (initial: unknown) => {
    const index = hooks.cursor++
    if (!(index in hooks.values)) hooks.values[index] = { current: initial }
    return hooks.values[index]
  },
}))

beforeEach(() => { hooks.cursor = 0; hooks.values = []; hooks.commitEffect = undefined; hooks.onCommit = undefined })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

function fixture() {
  const timeline = {
    id: 'timeline', activeBranchId: 'branch', promptResourceIds: [],
    createdAt: '2026-09-23', updatedAt: '2026-09-23',
  }
  const branch = {
    id: 'branch', timelineId: timeline.id, stateHeadRevisionId: 'state',
    createdAt: timeline.createdAt, updatedAt: timeline.updatedAt,
  }
  const session = {
    id: 'session', timelineId: timeline.id, agentPresetId: 'profile',
    createdAt: timeline.createdAt, updatedAt: timeline.updatedAt,
  }
  const narrative: Awaited<ReturnType<StudioApi['narratives']['getPage']>> = { timeline, branch, nodes: [] }
  const result = {
    narrative, agentSession: session,
    entries: {
      user: { id: 'user', entry: { kind: 'message', role: 'user', content: 'Draft' } },
      assistant: { id: 'assistant', entry: { kind: 'message', role: 'assistant', content: 'Reply' } },
    },
  }
  const createTimeline = vi.fn(async () => narrative)
  const appendInput = vi.fn<StudioApi['narratives']['appendInput']>(async input => {
    const node = { id: input.nodeId, timelineId: timeline.id, stateRevisionId: 'state',
      body: { format: 'loom-markdown.v1' as const, raw: input.content }, createdAt: timeline.createdAt }
    Object.assign(branch, { headNodeId: node.id })
    Object.assign(narrative, { nodes: [node] })
    return { timeline, branch, node, mutation: { changesetId: 'input-commit' } }
  })
  const createSession = vi.fn(async () => ({ session }))
  const createRun = vi.fn(async () => ({ runId: 'run' }))
  const subscribeRun = vi.fn<StudioApi['agentSessions']['subscribeRun']>(async () => ({
    events: [{ type: 'completed', runId: 'run', result }], nextCursor: 1, done: true, state: 'completed',
  }))
  const getTranscript = vi.fn(async () => ({ session, entries: [result.entries.user, result.entries.assistant] }))
  const getPage = vi.fn(async () => narrative)
  const resumeRun = vi.fn(async () => ({ runId: 'continued', accepted: true }))
  const reportFailure = vi.fn()
  const input: Parameters<typeof useNarrativeRuntime>[0] = {
    api: {
      narratives: { create: createTimeline, appendInput, getPage },
      agentSessions: {
        create: createSession, createRun, subscribeRun, getTranscript, resumeRun,
      },
    } as unknown as StudioApi,
    storageScope: 'test', initialInput: '  Draft\n', selectedCardId: 'card', selectedAgentPresetId: 'profile',
    onSelectCard: vi.fn(), onSelectAgentPreset: vi.fn(),
    runAgentAction: async action => { try { await action() } catch (error) { reportFailure(error) } },
    // Same boolean completion contract as useStudioState's runReported adapter.
    runAction: async action => {
      try { await action(); return true } catch (error) { reportFailure(error); return false }
    },
    runLatestAction: action => action({ isCurrent: () => true } as never),
  }
  const render = () => { hooks.cursor = 0; return useNarrativeRuntime(input) }
  const event = { preventDefault: vi.fn() } as unknown as FormEvent
  return { render, event, input, result, appendInput, createTimeline, createSession, createRun, subscribeRun, getTranscript, getPage, resumeRun, reportFailure }
}

describe('Narrative first submission preparation', () => {
  it('requires explicit primary creation before the first write, then binds it to the new Timeline', async () => {
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value) },
      removeItem: (key: string) => { storage.delete(key) },
    })
    const f = fixture()
    await f.render().submitTurn(f.event)
    expect(f.reportFailure).toHaveBeenCalledWith(expect.objectContaining({ message: '请先新建并设置主写作对话' }))
    expect(f.createTimeline).not.toHaveBeenCalled()
    expect(f.appendInput).not.toHaveBeenCalled()
    expect(f.render().input).toBe('  Draft\n')

    const primary = await f.render().createAgentSession('profile', true)
    expect(f.createTimeline).toHaveBeenCalledExactlyOnceWith({ cardId: 'card' })
    expect(f.createSession).toHaveBeenCalledExactlyOnceWith({ agentPresetId: 'profile', timelineId: 'timeline' })
    expect(primary.timelineId).toBe('timeline')
    expect(f.render().primarySession?.id).toBe(primary.id)
    expect(storage.get('loom.studio.primarySession:test:timeline')).toBe(primary.id)
    expect(f.render().input).toBe('  Draft\n')

    await f.render().submitTurn(f.event)
    expect(f.appendInput).toHaveBeenCalledOnce()
    expect(f.createRun).toHaveBeenCalledWith(expect.objectContaining({
      agentSessionId: primary.id,
      narrativeTarget: expect.objectContaining({ timelineId: 'timeline' }),
    }))
  })

  it('keeps the primary receiver when viewing a child Session and sends Narrative input to the primary', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null, setItem: () => {}, removeItem: () => {},
    })
    const f = fixture()
    const primary = await f.render().createAgentSession('profile', true)
    const child = { ...primary, id: 'child', agentPresetId: 'child-profile' }
    f.input.api.agentSessions.list = vi.fn(async () => ({ sessions: [primary, child] }))
    f.getTranscript.mockImplementation(async ({ agentSessionId }) => ({
      session: agentSessionId === child.id ? child : primary, entries: [],
    }))
    await f.render().activateAgentSession(child)
    expect(f.render().agentSession?.id).toBe(child.id)
    expect(f.render().primarySession?.id).toBe(primary.id)
    expect(f.input.onSelectAgentPreset).not.toHaveBeenCalled()

    await f.render().submitTurn(f.event)
    expect(f.createRun).toHaveBeenCalledWith(expect.objectContaining({
      agentSessionId: primary.id,
      narrativeTarget: expect.objectContaining({ timelineId: 'timeline' }),
    }))
    expect(f.render().agentSession?.id).toBe(child.id)
  })

  it('returns to the deleted Timeline source card and requires explicit primary creation before sending', async () => {
    const f = fixture()
    f.result.narrative.timeline.createdFrom = { cardId: 'source-card', cardVersion: 1 }
    f.input.selectedCardId = 'another-card'
    f.input.onSelectCard = vi.fn(id => { f.input.selectedCardId = id })
    f.input.api.narratives.get = vi.fn(async () => ({
      timeline: f.result.narrative.timeline, branches: [f.result.narrative.branch],
    }))
    f.input.api.narratives.list = vi.fn(async () => ({ timelines: [] }))
    f.input.api.narratives.delete = vi.fn(async () => ({ deleted: true, mutation: { changesetId: 'deleted' } }))
    const listSessions = vi.fn(async () => ({ sessions: [] }))
    f.input.api.agentSessions.list = listSessions
    await f.render().activateTimeline('timeline')
    listSessions.mockClear()

    await expect(f.render().deleteTimeline('timeline')).resolves.toBe(true)
    const preview = f.render()
    expect(f.input.onSelectCard).toHaveBeenCalledWith('source-card')
    expect(preview.timeline).toBeUndefined()
    expect(preview.branch).toBeUndefined()
    expect(preview.nodes).toEqual([])
    expect(preview.agentSessionReady).toBe(true)
    expect(preview.agentSession).toBeUndefined()
    expect(listSessions).not.toHaveBeenCalled()
    expect(f.input.api.narratives.list).toHaveBeenLastCalledWith({
      createdFromCardId: 'source-card', cursor: undefined, limit: 100,
    })

    preview.setInput('Start again')
    await expect(f.render().submitTurn(f.event)).resolves.toBeUndefined()
    expect(f.createTimeline).not.toHaveBeenCalled()
    expect(f.appendInput).not.toHaveBeenCalled()
    await f.render().createAgentSession('profile', true)
    expect(f.createTimeline).toHaveBeenCalledExactlyOnceWith({ cardId: 'source-card' })
    expect(f.render().input).toBe('Start again')
    expect(f.render().primarySession?.id).toBe('session')
    await f.render().submitTurn(f.event)
    expect(f.appendInput).toHaveBeenCalledWith(expect.objectContaining({ content: 'Start again' }))
    expect(f.createRun).toHaveBeenCalledOnce()
    expect(f.reportFailure).toHaveBeenCalledWith(expect.objectContaining({ message: '请先新建并设置主写作对话' }))
  })

  it('waits for the persisted user node before creating a Session or Run', async () => {
    const f = fixture()
    const append = f.appendInput.getMockImplementation()!
    let release!: () => void
    let entered!: () => void
    const writing = new Promise<void>(resolve => { entered = resolve })
    const wait = new Promise<void>(resolve => { release = resolve })
    f.appendInput.mockImplementationOnce(async input => {
      entered()
      await wait
      return append(input)
    })
    const pending = f.render().submitTurn(f.event)
    await writing
    expect(f.createSession).not.toHaveBeenCalled()
    expect(f.createRun).not.toHaveBeenCalled()
    expect(f.render().nodes).toEqual([])
    release()
    await pending
    expect(f.createRun).toHaveBeenCalledWith(expect.objectContaining({
      input: 'Draft',
      narrativeTarget: { timelineId: 'timeline', branchId: 'branch', inputNodeId: f.appendInput.mock.calls[0]![0].nodeId },
    }))
    expect(f.render().nodes.map(node => node.body.raw)).toEqual(['Draft'])
  })

  it('stops on a failed user-node write and retries with the same node identity', async () => {
    const f = fixture()
    f.appendInput.mockRejectedValueOnce(new Error('Head conflict'))
    await f.render().submitTurn(f.event)
    expect(f.createSession).not.toHaveBeenCalled()
    expect(f.createRun).not.toHaveBeenCalled()
    expect(f.render().nodes).toEqual([])
    expect(f.render().composerInput).toBe('  Draft\n')
    await f.render().submitTurn(f.event)
    expect(f.appendInput.mock.calls[1]![0]).toEqual(f.appendInput.mock.calls[0]![0])
    expect(f.createRun).toHaveBeenCalledOnce()
  })

  it('retains a user node committed while switching Session, but waits for explicit redelivery', async () => {
    const f = fixture()
    const append = f.appendInput.getMockImplementation()!
    let release!: () => void
    let entered!: () => void
    const writing = new Promise<void>(resolve => { entered = resolve })
    const wait = new Promise<void>(resolve => { release = resolve })
    f.appendInput.mockImplementationOnce(async input => {
      entered()
      await wait
      return append(input)
    })
    const pending = f.render().submitTurn(f.event)
    await writing
    f.render().newAgentSession()
    release()
    await pending
    expect(f.render().nodes).toHaveLength(1)
    expect(f.createSession).not.toHaveBeenCalled()
    expect(f.createRun).not.toHaveBeenCalled()
    await f.render().retryNarrativeInput()
    expect(f.appendInput).toHaveBeenCalledOnce()
    expect(f.createRun).toHaveBeenCalledOnce()
  })

  it('copies the saved input into a new Session without replacing a newer composer draft', async () => {
    const f = fixture()
    await f.render().submitTurn(f.event)
    const nodeId = f.render().nodes[0]!.id
    f.render().newAgentSession()
    f.render().setInput('A newer draft')
    const session = { ...f.result.agentSession, id: 'new-session' }
    f.createSession.mockResolvedValueOnce({ session })
    f.getTranscript.mockResolvedValueOnce({ session, entries: [] })
    await f.render().retryNarrativeInput()
    expect(f.appendInput).toHaveBeenCalledOnce()
    expect(f.createRun).toHaveBeenLastCalledWith(expect.objectContaining({
      agentSessionId: 'new-session', input: 'Draft',
      narrativeTarget: { timelineId: 'timeline', branchId: 'branch', inputNodeId: nodeId },
    }))
    expect(f.render().composerInput).toBe('A newer draft')
    expect(f.render().nodes).toHaveLength(1)
  })

  it('does not redeliver a committed input through a different endpoint', async () => {
    const f = fixture()
    await f.render().submitTurn(f.event)
    f.input.api = { ...f.input.api }
    expect(f.render().canRetryNarrativeInput).toBe(false)
    await f.render().retryNarrativeInput()
    expect(f.createRun).toHaveBeenCalledOnce()
  })

  it('refreshes tool-written nodes after completion and reports a refresh failure without rerunning', async () => {
    const f = fixture()
    f.getPage.mockRejectedValueOnce(new Error('Refresh unavailable'))
    await f.render().submitTurn(f.event)
    expect(f.render().activeAgentRun?.status).toBe('completed')
    expect(f.render().runRecovery).toMatchObject({ status: 'refresh-failed', refreshFailed: true })
    const toolNode = { id: 'tool-node', timelineId: 'timeline', stateRevisionId: 'state',
      body: { format: 'loom-markdown.v1' as const, raw: 'Tool-written story' }, createdAt: 'now' }
    f.getPage.mockResolvedValueOnce({ ...f.result.narrative, nodes: [...f.render().nodes, toolNode] })
    await f.render().reconnectAgentRun()
    expect(f.render().nodes.map(node => node.body.raw)).toEqual(['Draft', 'Tool-written story'])
    expect(f.render().runRecovery).toBeUndefined()
    expect(f.createRun).toHaveBeenCalledOnce()
    expect(f.appendInput).toHaveBeenCalledOnce()
  })

  it('refreshes Narrative Head on any committed branch change, independent of the writer', async () => {
    vi.stubGlobal('EventSource', class {})
    const f = fixture()
    await f.render().submitTurn(f.event)
    f.render()
    const dispose = hooks.commitEffect?.()
    const before = f.getPage.mock.calls.length
    hooks.onCommit?.([{ entityType: 'narrative.branch', entityId: 'other-branch' }])
    expect(f.getPage).toHaveBeenCalledTimes(before)
    const node = { id: 'external-node', timelineId: 'timeline', stateRevisionId: 'state',
      body: { format: 'loom-markdown.v1' as const, raw: 'External writer' }, createdAt: 'now' }
    f.getPage.mockResolvedValueOnce({
      ...f.result.narrative,
      branch: { ...f.result.narrative.branch, headNodeId: node.id },
      nodes: [...f.result.narrative.nodes, node],
    })
    hooks.onCommit?.([{ entityType: 'narrative.branch', entityId: 'branch' }])
    await vi.waitFor(() => expect(f.render().branch?.headNodeId).toBe(node.id))
    expect(f.render().nodes.map(item => item.body.raw)).toEqual(['Draft', 'External writer'])
    f.render().setInput('Next input')
    await f.render().submitTurn(f.event)
    expect(f.appendInput.mock.calls[1]![0].expectedHeadNodeId).toBe(node.id)
    dispose?.()
  })

  it('treats an explicit new submission with the same text as a new user node', async () => {
    const f = fixture()
    await f.render().submitTurn(f.event)
    f.render().setInput('Draft')
    await f.render().submitTurn(f.event)
    expect(f.appendInput).toHaveBeenCalledTimes(2)
    expect(f.appendInput.mock.calls[1]![0].nodeId).not.toBe(f.appendInput.mock.calls[0]![0].nodeId)
  })

  it('reconnects at the retained cursor without replaying text or creating/resuming a Run', async () => {
    vi.useFakeTimers()
    const f = fixture()
    f.subscribeRun
      .mockResolvedValueOnce({ events: [{ type: 'text-delta', runId: 'run', delta: 'Partial' }], nextCursor: 1, done: false, state: 'running' })
      .mockRejectedValueOnce(new Error('Offline'))
      .mockRejectedValueOnce(new Error('Offline'))
      .mockRejectedValueOnce(new Error('Offline'))
    const pending = f.render().submitTurn(f.event)
    await vi.runAllTimersAsync()
    expect(await pending).toEqual({ timelineId: 'timeline', branchId: 'branch' })
    expect(f.render().runRecovery?.status).toBe('disconnected')
    expect(f.render().activeAgentRun?.status).toBe('running')
    expect(f.render().agentMessages.at(-1)?.entry.content).toBe('Partial')
    await f.render().submitTurn(f.event)
    expect(f.createRun).toHaveBeenCalledOnce()

    let release!: () => void
    const reading = new Promise<void>(resolve => { release = resolve })
    f.subscribeRun.mockImplementationOnce(async () => {
      await reading
      return { events: [{ type: 'completed', runId: 'run', result: f.result }], nextCursor: 2, done: true, state: 'completed' }
    })
    const reconnect = f.render().reconnectAgentRun()
    await f.render().reconnectAgentRun()
    expect(f.subscribeRun).toHaveBeenLastCalledWith('run', 1)
    expect(f.subscribeRun).toHaveBeenCalledTimes(5)
    release()
    await reconnect
    expect(f.render().runRecovery).toBeUndefined()
    expect(f.render().activeAgentRun?.status).toBe('completed')
    expect(f.render().agentMessages.map(entry => entry.id)).toEqual(['user', 'assistant'])
    expect(f.createRun).toHaveBeenCalledOnce()
    expect(f.resumeRun).not.toHaveBeenCalled()
  })

  it.each(['failed', 'cancelled'] as const)('retains the committed user node on %s and redelivers without appending again', async status => {
    const f = fixture()
    f.subscribeRun.mockResolvedValueOnce({
      events: [{ type: status, runId: 'run', error: { message: 'Stopped' } }],
      nextCursor: 1, done: true, state: status,
    })
    await f.render().submitTurn(f.event)
    let state = f.render()
    expect(state.activeAgentRun?.status).toBe(status)
    expect(state.runRecovery?.status).toBe(status)
    expect(state.composerInput).toBe('')
    expect(state.nodes).toHaveLength(1)
    expect(f.getPage).toHaveBeenCalledWith({ timelineId: 'timeline', branchId: 'branch', limit: 100 })
    expect(state.agentMessages.map(entry => entry.id)).toEqual(['user', 'assistant'])
    for (const newer of ['New draft', '  \n']) {
      state.setInput(newer)
      // The action itself guards a same-tick edit, before a new render.
      state.restoreRunInput()
      expect(f.render().composerInput).toBe(newer)
      expect(f.render().canRestoreRunInput).toBe(false)
    }
    f.render().setInput('')
    state = f.render()
    expect(state.canRestoreRunInput).toBe(false)
    state.restoreRunInput()
    expect(f.render().composerInput).toBe('')
    expect(f.render().runRecovery?.input).toBeUndefined()
    expect(state.canRetryNarrativeInput).toBe(true)
    await state.retryNarrativeInput()
    expect(f.appendInput).toHaveBeenCalledOnce()
    expect(f.createRun).toHaveBeenCalledTimes(2)
    expect(f.resumeRun).not.toHaveBeenCalled()
  })

  it('retries a failed terminal refresh without restarting or resubscribing the Run', async () => {
    const f = fixture()
    f.subscribeRun.mockResolvedValueOnce({ events: [{ type: 'failed', runId: 'run' }], nextCursor: 1, done: true, state: 'failed' })
    f.getPage.mockRejectedValueOnce(new Error('Read failed'))
    await f.render().submitTurn(f.event)
    expect(f.render().runRecovery).toMatchObject({ status: 'failed', refreshFailed: true })
    expect(f.render().nodes).toHaveLength(1)
    await f.render().reconnectAgentRun()
    expect(f.render().runRecovery?.refreshFailed).toBeUndefined()
    expect(f.getPage).toHaveBeenCalledTimes(2)
    expect(f.subscribeRun).toHaveBeenCalledOnce()
    expect(f.createRun).toHaveBeenCalledOnce()
  })

  it('does not publish a late reconnect or terminal refresh into a new Session', async () => {
    vi.useFakeTimers()
    const f = fixture()
    f.subscribeRun.mockRejectedValueOnce(new Error('Offline')).mockRejectedValueOnce(new Error('Offline')).mockRejectedValueOnce(new Error('Offline'))
    const pending = f.render().submitTurn(f.event)
    await vi.runAllTimersAsync()
    await pending
    let release!: () => void
    const reading = new Promise<void>(resolve => { release = resolve })
    f.subscribeRun.mockImplementationOnce(async () => {
      await reading
      return { events: [{ type: 'completed', runId: 'run', result: f.result }], nextCursor: 1, done: true, state: 'completed' }
    })
    const reconnect = f.render().reconnectAgentRun()
    f.render().newAgentSession()
    release()
    await reconnect
    expect(f.render().agentMessages).toEqual([])
    expect(f.render().activeAgentRun).toBeUndefined()
    expect(f.render().runRecovery).toBeUndefined()
  })

  it('Agent chat uses the same failure contract rather than inventing a suspended Run', async () => {
    const f = fixture()
    f.render().setAgentInput('Agent draft')
    f.createRun.mockRejectedValueOnce(new Error('Create rejected'))
    await f.render().submitAgentTurn(f.event)
    expect(f.render().agentInput).toBe('Agent draft')
    expect(f.render().activeAgentRun).toBeUndefined()
    f.subscribeRun.mockResolvedValueOnce({ events: [{ type: 'failed', runId: 'run' }], nextCursor: 1, done: true, state: 'failed' })
    await f.render().submitAgentTurn(f.event)
    expect(f.render().activeAgentRun?.status).toBe('failed')
    expect(f.render().runRecovery?.target).toBe('agent')
    expect(f.getPage).not.toHaveBeenCalled()
    f.render().restoreRunInput()
    expect(f.render().agentInput).toBe('Agent draft')
    expect(f.resumeRun).not.toHaveBeenCalled()
  })

  it.each(['session', 'endpoint'] as const)('ignores a terminal refresh that finishes after changing %s', async destination => {
    const f = fixture()
    f.subscribeRun.mockResolvedValueOnce({ events: [{ type: 'failed', runId: 'run' }], nextCursor: 1, done: true, state: 'failed' })
    let entered!: () => void
    const refreshing = new Promise<void>(resolve => { entered = resolve })
    let release!: () => void
    const response = new Promise<void>(resolve => { release = resolve })
    f.getPage.mockImplementationOnce(async () => { entered(); await response; return f.result.narrative })
    const pending = f.render().submitTurn(f.event)
    await refreshing
    if (destination === 'session') f.render().newAgentSession()
    else {
      f.input.api = { ...f.input.api }
      f.render()
    }
    release()
    await pending
    expect(f.render().agentMessages).toEqual([])
    expect(f.render().runRecovery).toBeUndefined()
    expect(f.render().runRecoveryBusy).toBe(false)
    f.render().restoreRunInput()
    expect(f.render().composerInput).toBe('')
  })

  it('keeps a resumed execution failure terminal rather than relabeling it as suspended', async () => {
    const f = fixture()
    f.subscribeRun.mockResolvedValueOnce({ events: [{ type: 'suspended', runId: 'run' }], nextCursor: 1, done: true, state: 'suspended' })
    await f.render().submitTurn(f.event)
    expect(f.render().activeAgentRun?.status).toBe('suspended')
    f.subscribeRun.mockResolvedValueOnce({ events: [{ type: 'failed', runId: 'continued' }], nextCursor: 1, done: true, state: 'failed' })
    await f.render().resumeAgentRun()
    expect(f.render().activeAgentRun).toEqual({ runId: 'continued', status: 'failed' })
    expect(f.render().runRecovery).toMatchObject({ target: 'narrative', status: 'failed' })
    expect(f.render().runRecovery?.input).toBeUndefined()
    expect(f.resumeRun).toHaveBeenCalledOnce()
    expect(f.createRun).toHaveBeenCalledOnce()
  })

  it.each([false, true])('does not clear newer input or publish a late Run into a new selection (switch: %s)', async switchSelection => {
    const f = fixture()
    let entered!: () => void
    const creating = new Promise<void>(resolve => { entered = resolve })
    let accept!: (value: { runId: string }) => void
    const response = new Promise<{ runId: string }>(resolve => { accept = resolve })
    f.createRun.mockImplementationOnce(() => { entered(); return response })
    const pending = f.render().submitTurn(f.event)
    await creating
    f.render().setInput('Newer draft')
    if (switchSelection) f.render().newAgentSession()
    accept({ runId: 'run' })
    const activated = await pending
    const state = f.render()
    expect(state.composerInput).toBe('Newer draft')
    if (switchSelection) {
      expect(activated).toBeUndefined()
      expect(state.activeAgentRun).toBeUndefined()
      expect(state.nodes).toHaveLength(1)
      expect(state.agentMessages).toEqual([])
    } else {
      expect(state.activeAgentRun?.status).toBe('completed')
    }
  })

  it('retains the draft and creates no optimistic entries when Run creation fails', async () => {
    const f = fixture()
    const failure = new Error('Run creation failed')
    f.createRun.mockRejectedValueOnce(failure)
    await expect(f.render().submitTurn(f.event)).resolves.toEqual({ timelineId: 'timeline', branchId: 'branch' })
    const failed = f.render()
    expect(failed.composerInput).toBe('  Draft\n')
    expect(failed.nodes).toHaveLength(1)
    expect(failed.agentMessages).toEqual([])
    expect(failed.activeAgentRun).toBeUndefined()
    expect(f.reportFailure).toHaveBeenCalledWith(failure)
    await failed.submitTurn(f.event)
    expect(f.createTimeline).toHaveBeenCalledOnce()
    expect(f.createSession).toHaveBeenCalledOnce()
    expect(f.createRun).toHaveBeenCalledTimes(2)
    expect(f.appendInput).toHaveBeenCalledOnce()
    expect(f.render().composerInput).toBe('')
    expect(f.render().nodes.some(node => node.id.startsWith('optimistic-'))).toBe(false)
  })

  it('returns the committed Timeline identity even if Session delivery fails, without recreating it on retry', async () => {
    const f = fixture()
    const failure = new Error('Session creation failed')
    f.createSession.mockRejectedValueOnce(failure)
    const navigate = vi.fn()
    await f.render().submitTurn(f.event).then(activated => { if (activated) navigate(activated) })
    expect(navigate).toHaveBeenCalledExactlyOnceWith({ timelineId: 'timeline', branchId: 'branch' })
    expect(f.reportFailure).toHaveBeenCalledWith(failure)
    expect(f.createRun).not.toHaveBeenCalled()
    const state = f.render()
    expect(state.composerInput).toBe('  Draft\n')
    expect(state.timeline?.id).toBe('timeline')
    expect(state.branch?.id).toBe('branch')
    expect(state.nodes).toHaveLength(1)
    expect(state.agentMessages).toEqual([])
    expect(state.lastRun).toBeUndefined()
    await state.submitTurn(f.event)
    expect(f.createTimeline).toHaveBeenCalledOnce()
    expect(f.createSession).toHaveBeenCalledTimes(2)
    expect(f.createRun).toHaveBeenCalledOnce()
    expect(f.render().composerInput).toBe('')
    expect(f.render().lastRun).toBeDefined()
  })

  it('returns the new timeline navigation after a successful first submission', async () => {
    const f = fixture()
    await expect(f.render().submitTurn(f.event)).resolves.toEqual({ timelineId: 'timeline', branchId: 'branch' })
    expect(f.reportFailure).not.toHaveBeenCalled()
    expect(f.createRun).toHaveBeenCalledOnce()
    expect(f.render().composerInput).toBe('')
    expect(f.render().lastRun).toBeDefined()
  })
})
