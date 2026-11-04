// @vitest-environment happy-dom
import { notify } from '../../../apps/studio-client/src/shared/notifications/index.js'
import { describe, expect, it, vi } from 'vitest'
import { settle, fixture, primaryFixture } from '../../support/client/narrative-runtime.js'
import type { StudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'
import { resolveSessionRun } from '../../../apps/studio-client/src/features/narrative-runtime/model/agent-run-observer.js'

describe('Narrative Run recovery', () => {
  it.each([true, false])('only resolves a persisted failed run when it retains a checkpoint (%s)', async recoverable => {
    const reason = 'Provider request failed (503): service unavailable'
    const runState = vi.fn<StudioApi['agentSessions']['runState']>(async () => ({ runId: 'run', state: 'suspended', reason }))
    const active = await resolveSessionRun({ agentSessions: { runState } } as unknown as StudioApi, 'timeline', [{
      id: 'failed', agentSessionId: 'timeline', runId: 'run', sequence: 1, createdAt: '',
      entry: { kind: 'run-state', state: 'failed', reason, ...(recoverable ? { recovery: { version: 1 } } : {}) },
    }])
    if (recoverable) {
      expect(active).toEqual({ runId: 'run', status: 'suspended', error: reason })
      expect(runState).toHaveBeenCalledExactlyOnceWith('run', 'timeline')
    } else {
      expect(active).toBeUndefined()
      expect(runState).not.toHaveBeenCalled()
    }
  })

  it.each([false, true])('surfaces a recoverable provider error including expired replay (%s)', async replayExpired => {
    const f = await fixture()
    const notification = vi.spyOn(notify, 'providerError').mockImplementation(() => 'test-provider-error')
    try {
      f.render().setAgentInput('Draft')
      const reason = 'Provider request failed (404): retired model'
      f.subscribeRun.mockResolvedValueOnce({
        events: replayExpired ? [] : [{ type: 'suspended', runId: 'run', reason }],
        reason, nextCursor: 1, done: true, state: 'suspended', replayExpired,
      })
      await settle(() => f.render().submitAgentTurn(f.event))
      await f.loadRoot()
      expect(f.render().runRecovery).toMatchObject({ status: 'suspended', error: reason, target: 'agent' })
      expect(notification).toHaveBeenCalledOnce()
      expect(f.resumeRun).not.toHaveBeenCalled()
    } finally { notification.mockRestore() }
  })

  it('does not notify an error for an explicit user pause', async () => {
    const f = await fixture()
    const notification = vi.spyOn(notify, 'providerError').mockImplementation(() => 'test-provider-error')
    try {
      f.render().setAgentInput('Draft')
      f.subscribeRun.mockResolvedValueOnce({ events: [{ type: 'suspended', runId: 'run', reason: 'user-pause' }], nextCursor: 1, done: true, state: 'suspended' })
      await settle(() => f.render().submitAgentTurn(f.event))
      await f.loadRoot()
      expect(f.render().runRecovery?.error).toBeUndefined()
      expect(notification).not.toHaveBeenCalled()
    } finally { notification.mockRestore() }
  })

  it('reuses a send request ID after its acknowledgement is lost', async () => {
    const f = await fixture()
    f.submitInterjection.mockRejectedValueOnce(new Error('Response was lost'))
    f.render().setAgentInput('Draft')
    await settle(() => f.render().submitAgentTurn(f.event))
      await f.loadRoot()
    const first = f.submitInterjection.mock.calls[0]![0]
    expect(first.requestId).toEqual(expect.any(String))
    expect(f.render().agentInput).toBe('Draft')
    await settle(() => f.render().submitAgentTurn(f.event))
      await f.loadRoot()
    expect(f.submitInterjection.mock.calls[1]![0]).toEqual(first)
  })

  it('replaces streamed native reasoning with its committed transcript entry', async () => {
    const f = await fixture()
    f.subscribeRun.mockResolvedValueOnce({ events: [{ type: 'reasoning-delta', runId: 'run', providerRunId: 'provider', providerStep: 1, reasoningId: 'r', streamId: 'reasoning', delta: 'Thinking' }], nextCursor: 1, done: false, state: 'running' })
    const finish = Promise.withResolvers<Awaited<ReturnType<StudioApi['agentSessions']['subscribeRun']>>>()
    f.subscribeRun.mockReturnValueOnce(finish.promise)
    f.render().setAgentInput('Draft')
    const running = f.render().submitAgentTurn(f.event)
    await vi.waitFor(() => expect(f.subscribeRun).toHaveBeenCalledTimes(2))
    expect(f.render().agentMessages.filter(item => item.entry.kind === 'reasoning')).toHaveLength(1)
    const terminal = Promise.withResolvers<Awaited<ReturnType<StudioApi['agentSessions']['subscribeRun']>>>()
    f.subscribeRun.mockReturnValueOnce(terminal.promise)
    finish.resolve({ events: [{ type: 'transcript-appended', runId: 'run', entries: [{ id: 'native', runId: 'run', agentSessionId: 'session', sequence: 2, createdAt: '', entry: { streamId: 'reasoning', kind: 'reasoning' as const, content: 'Thinking complete', source: 'provider-native' as const, visibility: 'collapsed' as const, replay: 'omit' as const } }] }], nextCursor: 2, done: false, state: 'running' })
    await vi.waitFor(() => expect(f.subscribeRun).toHaveBeenCalledTimes(3))
    expect(f.render().agentMessages.filter(item => item.entry.kind === 'reasoning')).toMatchObject([{ id: 'native', entry: { content: 'Thinking complete' } }])
    terminal.resolve({ events: [{ type: 'suspended', runId: 'run' }], nextCursor: 3, done: true, state: 'suspended' })
    await running
  })

  it('reports pause rejection while preserving the active run and approval', async () => {
    const f = await fixture()
    const finish = Promise.withResolvers<Awaited<ReturnType<StudioApi['agentSessions']['subscribeRun']>>>()
    f.subscribeRun.mockResolvedValueOnce({
      events: [{ type: 'mutation-approval-requested', runId: 'run', requestId: 'approval',
        preview: { action: 'replace', path: '/test', kind: 'state', before: '1', after: '2' } }],
      nextCursor: 1, done: false, state: 'running',
    }).mockReturnValueOnce(finish.promise)
    const failure = new Error('Pause unavailable')
    f.input.api.agentSessions.pauseRun = vi.fn(async () => { throw failure })
    f.input.api.agentSessions.approveMutation = vi.fn(async (runId, requestId) => ({ runId, requestId, accepted: true }))
    f.render().setAgentInput('Draft')
    const running = f.render().submitAgentTurn(f.event)
    await vi.waitFor(() => expect(f.subscribeRun).toHaveBeenCalledTimes(2))
    await settle(() => f.render().pauseAgentRun())
    expect(f.reportFailure).toHaveBeenCalledWith(failure)
    expect(f.render().activeAgentRun?.approval?.requestId).toBe('approval')
    expect(await settle(() => f.render().approveAgentMutation(false, 'Reason'))).toBe(true)
    expect(f.input.api.agentSessions.approveMutation).toHaveBeenCalledWith('run', 'approval', false, 'Reason')
    expect(f.render().activeAgentRun?.approval).toBeUndefined()
    finish.resolve({ events: [{ type: 'suspended', runId: 'run' }], nextCursor: 2, done: true, state: 'suspended' })
    await running
  })
  it('publishes the Inspector result after expired replay and acknowledges only received completion', async () => {
    const f = await fixture()
    await settle(() => f.render().createTimelineFromCard())
    await settle(() => f.render().createAgentSession('profile', true))
    const projection: Awaited<ReturnType<StudioApi['agentSessions']['invoke']>>['projection'] = { messages: [{ role: 'user', content: 'Large compiled prompt', fragmentIds: [] }], editorProjection: { sourceRows: [], promptRows: [] } }
    const result = { ...f.result, projection, promptBuildTrace: { ...f.result.promptBuildTrace, buildId: 'original-trace' } }
    f.subscribeRun.mockResolvedValueOnce({
      events: [{ type: 'completed', runId: 'run', result }],
      nextCursor: 100, done: true, state: 'completed',
      replayExpired: true, partialEvents: [], pendingApprovals: [],
    })
    f.render().setAgentInput('Draft')
    await settle(() => f.render().submitAgentTurn(f.event))
      await f.loadRoot()
    expect(f.render().lastRun).toBe(result)
    expect(f.acknowledgeRunCompletion).toHaveBeenCalledExactlyOnceWith('run')
    expect(f.reportFailure).not.toHaveBeenCalled()
  })
  it('resynchronizes expired replay before accepting new deltas and restores pending approval', async () => {
    const f = await fixture()
    await settle(() => f.render().createTimelineFromCard())
    await settle(() => f.render().createAgentSession('profile', true))
    const user = { id: 'committed-user', agentSessionId: 'session', runId: 'run', sequence: 1,
      entry: { kind: 'message' as const, role: 'user' as const, content: 'Draft' }, createdAt: '' }
    const assistant = { ...user, id: 'committed-assistant', sequence: 2,
      entry: { kind: 'message' as const, role: 'assistant' as const, content: 'Saved step' } }
    f.getTranscript.mockResolvedValue({ session: f.result.agentSession, entries: [user, assistant] })
    const expired: Awaited<ReturnType<StudioApi['agentSessions']['subscribeRun']>> = { events: [], nextCursor: 100, done: false, state: 'running' as const,
      replayExpired: true, partialEvents: [
        { type: 'reasoning-delta', runId: 'run', providerRunId: 'provider-run', providerStep: 1, streamId: 'reasoning', reasoningId: 'reasoning', afterSequence: 2, delta: 'Recovered reasoning' },
        { type: 'text-delta', runId: 'run', providerRunId: 'provider-run', providerStep: 1, streamId: 'text', afterSequence: 2, delta: 'Recovered' },
      ],
      pendingApprovals: [{ type: 'mutation-approval-requested', runId: 'run', requestId: 'approval', preview: { action: 'replace', path: '/test', kind: 'state', before: '1', after: '2' } }] }
    let resolve!: (value: Awaited<ReturnType<StudioApi['agentSessions']['subscribeRun']>>) => void
    f.subscribeRun.mockResolvedValueOnce({
      events: [
        { type: 'transcript-appended', runId: 'run', entries: [{ ...assistant, id: 'stale-step', entry: { ...assistant.entry, content: 'Stale' } }] },
        { type: 'text-delta', runId: 'run', providerRunId: 'provider-run', providerStep: 1, delta: 'OLD' },
      ], nextCursor: 2, done: false, state: 'running',
    })
      .mockResolvedValueOnce(expired)
      .mockResolvedValueOnce({ events: [], nextCursor: 100, done: false, state: 'running', pendingApprovals: expired.pendingApprovals })
      .mockImplementationOnce(() => new Promise(accept => { resolve = accept }))
    f.render().setAgentInput('Draft')
    const pending = f.render().submitAgentTurn(f.event)
    await vi.waitFor(() => expect(f.subscribeRun).toHaveBeenCalledTimes(4))
    expect(f.getTranscript.mock.calls.filter(([request]) => request.agentSessionId === 'session')).toHaveLength(1)
    expect(f.subscribeRun.mock.calls[3]).toEqual(['run', 100, 'session'])
    expect(f.render().agentMessages.filter(item => item.entry.kind !== 'user-interjection').map(item => 'content' in item.entry ? item.entry.content : undefined)).toEqual(['Draft', 'Saved step', 'Recovered reasoning', 'Recovered'])
    expect(f.render().activeAgentRun?.approval?.requestId).toBe('approval')
    resolve({ events: [{ type: 'text-delta', runId: 'run', providerRunId: 'provider-run', providerStep: 1, delta: ' tail' }], nextCursor: 101, done: false, state: 'running' })
    let finish!: (value: Awaited<ReturnType<StudioApi['agentSessions']['subscribeRun']>>) => void
    f.subscribeRun.mockImplementationOnce(() => new Promise(accept => { finish = accept }))
    await vi.waitFor(() => expect(f.subscribeRun).toHaveBeenCalledTimes(5))
    expect(f.render().agentMessages.at(-1)?.entry).toHaveProperty('content', 'Recovered tail')
    finish({ events: [{ type: 'suspended', runId: 'run' }], nextCursor: 102, done: true, state: 'suspended' })
    await pending
  })

  it('does not restore expired partial text already committed during the Transcript read', async () => {
    const f = await fixture()
    f.render().setAgentInput('Draft')
    const assistant = { id: 'saved', agentSessionId: 'session', runId: 'run', sequence: 2,
      entry: { kind: 'message' as const, role: 'assistant' as const, content: 'Snapshot text' }, createdAt: '' }
    let resolveRead!: (value: Awaited<ReturnType<StudioApi['agentSessions']['getTranscript']>>) => void
    f.getTranscript.mockImplementationOnce(() => new Promise(accept => { resolveRead = accept }))
    let finish!: (value: Awaited<ReturnType<StudioApi['agentSessions']['subscribeRun']>>) => void
    f.subscribeRun.mockResolvedValueOnce({
      events: [], nextCursor: 100, done: false, state: 'running', replayExpired: true,
      partialEvents: [{ type: 'text-delta', runId: 'run', providerRunId: 'provider-run', providerStep: 1, streamId: 'text', afterSequence: 2, delta: 'Snapshot text' }], pendingApprovals: [],
    })
      .mockResolvedValueOnce({
        events: [{ type: 'transcript-appended', runId: 'run', entries: [assistant] }, { type: 'text-delta', runId: 'run', providerRunId: 'provider-run', providerStep: 1, delta: 'Next step' }],
        nextCursor: 102, done: false, state: 'running',
      })
      .mockImplementationOnce(() => new Promise(accept => { finish = accept }))
    const pending = f.render().submitAgentTurn(f.event)
    await vi.waitFor(() => expect(f.getTranscript).toHaveBeenCalledOnce())
    resolveRead({ session: f.result.agentSession, entries: [assistant] })
    await vi.waitFor(() => expect(f.subscribeRun).toHaveBeenCalledTimes(3))
    expect(f.subscribeRun.mock.calls[1]).toEqual(['run', 100, 'session'])
    expect(f.render().agentMessages.filter(item => item.id === 'saved')).toHaveLength(1)
    expect(f.render().agentMessages.at(-1)?.entry).toHaveProperty('content', 'Next step')
    finish({ events: [{ type: 'suspended', runId: 'run' }], nextCursor: 103, done: true, state: 'suspended' })
    await pending
  })

  it('finishes expired completed replay through authoritative refresh without a completed result', async () => {
    const f = await fixture()
    await settle(() => f.render().createTimelineFromCard())
    await settle(() => f.render().createAgentSession('profile', true))
    f.subscribeRun.mockResolvedValueOnce({
      events: [], nextCursor: 100, done: true, state: 'completed',
      replayExpired: true, partialEvents: [], pendingApprovals: [],
    })
    f.render().setAgentInput('Draft')
    await settle(() => f.render().submitAgentTurn(f.event))
      await f.loadRoot()
    expect(f.render().activeAgentRun?.status).toBe('completed')
    expect(f.render().runRecovery).toBeUndefined()
    expect(f.render().agentMessages).toEqual([f.result.entries.user, f.result.entries.assistant])
    expect(f.getTranscript).toHaveBeenCalledWith(expect.objectContaining({ agentSessionId: 'session' }))
    expect(f.reportFailure).not.toHaveBeenCalled()
    expect(f.submitInterjection).toHaveBeenCalledOnce()
    expect(f.subscribeRun).toHaveBeenCalledWith('run', 0, 'session')
    expect(f.acknowledgeRunCompletion).not.toHaveBeenCalled()
  })

  it.each(['selection', 'api'])('ignores expired Transcript reload after %s changes', async change => {
    const f = await fixture()
    f.render().setAgentInput('Draft')
    let resolveRead!: (value: Awaited<ReturnType<StudioApi['agentSessions']['getTranscript']>>) => void
    f.getTranscript.mockImplementationOnce(() => new Promise(accept => { resolveRead = accept }))
    f.subscribeRun.mockResolvedValueOnce({
      events: [], nextCursor: 100, done: false, state: 'running', replayExpired: true,
      partialEvents: [{ type: 'text-delta', runId: 'run', providerRunId: 'provider-run', providerStep: 1, streamId: 'text', afterSequence: 2, delta: 'OLD' }], pendingApprovals: [{ type: 'mutation-approval-requested', runId: 'run', requestId: 'old', preview: { action: 'replace', path: '/test', kind: 'state', before: '1', after: '2' } }],
    })
    const pending = f.render().submitAgentTurn(f.event)
    await vi.waitFor(() => expect(f.getTranscript).toHaveBeenCalledOnce())
    if (change === 'selection') f.render().newAgentSession()
    else f.input.api = { ...f.input.api }
    const before = f.render().agentMessages
    resolveRead({ session: f.result.agentSession, entries: [] })
    await pending
    expect(f.render().agentMessages).toEqual(before)
    expect(f.render().activeAgentRun).toBeUndefined()
    expect(f.subscribeRun).toHaveBeenCalledOnce()
  })

  it('refreshes tool-written nodes after completion and reports a refresh failure without rerunning', async () => {
    const f = await primaryFixture()
    f.getPage.mockRejectedValueOnce(new Error('Refresh unavailable'))
    await settle(() => f.render().submitTurn(f.event))
    await f.loadRoot()
    expect(f.render().rootActiveRun?.status).toBe('completed')
    expect(f.render().rootRecovery).toMatchObject({ status: 'refresh-failed', refreshFailed: true })
    const toolNode = { id: 'tool-node', kind: 'narrative' as const, floor: 2, timelineId: 'timeline', stateRevisionId: 'state', workspaceRevisionId: 'workspace',
      body: { format: 'loom-markdown.v1' as const, raw: 'Tool-written story' }, createdAt: 'now' }
    f.getPage.mockResolvedValueOnce({ ...f.result.narrative, nodes: [...f.result.narrative.nodes, toolNode] })
    await settle(() => f.render().reconnectRootRun())
    expect(f.render().nodes.map(node => node.body.raw)).toEqual(['Draft', 'Tool-written story'])
    expect(f.render().rootRecovery).toBeUndefined()
    expect(f.submitInterjection).toHaveBeenCalledOnce()
    expect(f.appendInput).not.toHaveBeenCalled()
  })

  it('reconnects at the retained cursor without replaying text or creating/resuming a Run', async () => {
    vi.useFakeTimers()
    const f = await primaryFixture()
    f.subscribeRun
      .mockResolvedValueOnce({ events: [{ type: 'text-delta', runId: 'run', providerRunId: 'provider-run', providerStep: 1, delta: 'Partial' }], nextCursor: 1, done: false, state: 'running' })
      .mockRejectedValueOnce(new Error('Offline'))
      .mockRejectedValueOnce(new Error('Offline'))
      .mockRejectedValueOnce(new Error('Offline'))
    const pending = f.render().submitTurn(f.event)
    await vi.runAllTimersAsync()
    await pending
    expect(f.render().rootRecovery?.status).toBe('disconnected')
    expect(f.render().rootActiveRun?.status).toBe('running')
    expect(f.render().rootMessages.at(-1)?.entry).toHaveProperty('content', 'Partial')
    await settle(() => f.render().submitTurn(f.event))
    await f.loadRoot()
    expect(f.submitInterjection).toHaveBeenCalledOnce()

    let release!: () => void
    const reading = new Promise<void>(resolve => { release = resolve })
    f.subscribeRun.mockImplementationOnce(async () => {
      await reading
      return { events: [{ type: 'completed', runId: 'run', result: f.rootResult }], nextCursor: 2, done: true, state: 'completed' }
    })
    const reconnect = f.render().reconnectRootRun()
    await settle(() => f.render().reconnectRootRun())
    expect(f.subscribeRun).toHaveBeenLastCalledWith('run', 1, 'timeline')
    expect(f.subscribeRun).toHaveBeenCalledTimes(5)
    release()
    await reconnect
    expect(f.render().rootRecovery).toBeUndefined()
    expect(f.render().rootActiveRun?.status).toBe('completed')
    expect(f.render().rootMessages.map(entry => entry.id)).toEqual(['user', 'assistant'])
    expect(f.submitInterjection).toHaveBeenCalledOnce()
    expect(f.resumeRun).not.toHaveBeenCalled()
  })

  it.each(['failed', 'cancelled'] as const)('retains the server-committed user node on %s without locally appending or automatically redelivering', async status => {
    const f = await primaryFixture()
    f.subscribeRun.mockResolvedValueOnce({
      events: [status === 'failed'
        ? { type: 'failed', runId: 'run', error: { name: 'Error', message: 'Stopped' } }
        : { type: 'cancelled', runId: 'run', reason: 'Stopped' }],
      nextCursor: 1, done: true, state: status,
    })
    await settle(() => f.render().submitTurn(f.event))
    await f.loadRoot()
    let state = f.render()
    expect(state.rootActiveRun?.status).toBe(status)
    expect(state.rootRecovery?.status).toBe(status)
    expect(state.composerInput).toBe('')
    expect(state.nodes).toHaveLength(1)
    expect(f.getPage).toHaveBeenCalledWith({ timelineId: 'timeline', branchId: 'branch', limit: 100 })
    expect(state.rootMessages.map(entry => entry.id)).toEqual(['user', 'assistant'])
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
    expect(f.render().rootRecovery?.input).toBeUndefined()
    // This fixture exposes no swipe action or recovery checkpoint. A terminal
    // message must remain persisted without manufacturing a new submission.
    expect(state.canRetryNarrativeInput).toBe(false)
    expect(f.appendInput).not.toHaveBeenCalled()
    expect(f.submitInterjection).toHaveBeenCalledOnce()
    expect(f.resumeRun).not.toHaveBeenCalled()
  })

  it('retries a failed terminal refresh without restarting or resubscribing the Run', async () => {
    const f = await primaryFixture()
    f.subscribeRun.mockResolvedValueOnce({ events: [{ type: 'failed', runId: 'run', error: { name: 'Error', message: 'Run failed' } }], nextCursor: 1, done: true, state: 'failed' })
    f.getPage.mockRejectedValueOnce(new Error('Read failed'))
    await settle(() => f.render().submitTurn(f.event))
    await f.loadRoot()
    expect(f.render().rootRecovery).toMatchObject({ status: 'failed', refreshFailed: true })
    expect(f.render().nodes).toHaveLength(0)
    expect(f.result.narrative.nodes).toHaveLength(1)
    await settle(() => f.render().reconnectRootRun())
    expect(f.render().rootRecovery?.refreshFailed).toBeUndefined()
    expect(f.getPage).toHaveBeenCalledTimes(2)
    expect(f.subscribeRun).toHaveBeenCalledOnce()
    expect(f.submitInterjection).toHaveBeenCalledOnce()
  })

  it('does not publish a late reconnect or terminal refresh after leaving the Timeline', async () => {
    vi.useFakeTimers()
    const f = await primaryFixture()
    f.subscribeRun.mockRejectedValueOnce(new Error('Offline')).mockRejectedValueOnce(new Error('Offline')).mockRejectedValueOnce(new Error('Offline'))
    const pending = f.render().submitTurn(f.event)
    await vi.runAllTimersAsync()
    await pending
    let release!: () => void
    const reading = new Promise<void>(resolve => { release = resolve })
    f.subscribeRun.mockImplementationOnce(async () => {
      await reading
      return { events: [{ type: 'completed', runId: 'run', result: f.rootResult }], nextCursor: 1, done: true, state: 'completed' }
    })
    const reconnect = f.render().reconnectRootRun()
    f.render().resetToDraftTimeline(); await f.loadRoot()
    release()
    await reconnect
    expect(f.submitInterjection).toHaveBeenCalledOnce()
    expect(f.subscribeRun).toHaveBeenCalledTimes(4)
    expect(f.subscribeRun).toHaveBeenLastCalledWith('run', 0, 'timeline')
    expect(f.render().rootMessages).toEqual([])
    expect(f.render().rootActiveRun).toBeUndefined()
    expect(f.render().rootRecovery).toBeUndefined()
  })

  it('Agent chat uses the same failure contract rather than inventing a suspended Run', async () => {
    const f = await fixture()
    f.render().setAgentInput('Agent draft')
    f.submitInterjection.mockRejectedValueOnce(new Error('Create rejected'))
    await settle(() => f.render().submitAgentTurn(f.event))
      await f.loadRoot()
    expect(f.render().agentInput).toBe('Agent draft')
    expect(f.render().activeAgentRun).toBeUndefined()
    f.subscribeRun.mockResolvedValueOnce({ events: [{ type: 'failed', runId: 'run', error: { name: 'Error', message: 'Run failed' } }], nextCursor: 1, done: true, state: 'failed' })
    await settle(() => f.render().submitAgentTurn(f.event))
      await f.loadRoot()
    expect(f.render().activeAgentRun?.status).toBe('failed')
    expect(f.render().runRecovery?.target).toBe('agent')
    expect(f.getPage).not.toHaveBeenCalled()
    f.render().restoreRunInput()
    expect(f.render().agentInput).toBe('Agent draft')
    expect(f.resumeRun).not.toHaveBeenCalled()
  })

  it.each(['timeline', 'endpoint'] as const)('ignores a terminal refresh that finishes after changing %s', async destination => {
    const f = await primaryFixture()
    f.subscribeRun.mockResolvedValueOnce({ events: [{ type: 'failed', runId: 'run', error: { name: 'Error', message: 'Run failed' } }], nextCursor: 1, done: true, state: 'failed' })
    let entered!: () => void
    const refreshing = new Promise<void>(resolve => { entered = resolve })
    let release!: () => void
    const response = new Promise<void>(resolve => { release = resolve })
    f.getPage.mockImplementationOnce(async () => { entered(); await response; return f.result.narrative })
    const pending = f.render().submitTurn(f.event)
    await refreshing
    if (destination === 'timeline') { f.render().resetToDraftTimeline(); await f.loadRoot() }
    else {
      f.input.api = { ...f.input.api }
      f.render()
    }
    const destinationInput = f.render().composerInput
    release()
    await pending
    expect(f.render().rootMessages).toEqual([])
    expect(f.render().rootRecovery).toBeUndefined()
    expect(f.render().runRecoveryBusy).toBe(false)
    f.render().restoreRunInput()
    expect(f.render().composerInput).toBe(destinationInput)
  })

  it('keeps a resumed execution failure terminal rather than relabeling it as suspended', async () => {
    const f = await primaryFixture()
    f.subscribeRun.mockResolvedValueOnce({ events: [{ type: 'suspended', runId: 'run' }], nextCursor: 1, done: true, state: 'suspended' })
    await settle(() => f.render().submitTurn(f.event))
    await f.loadRoot()
    expect(f.render().rootActiveRun?.status).toBe('suspended')
    f.subscribeRun.mockResolvedValueOnce({ events: [{ type: 'failed', runId: 'continued', error: { name: 'Error', message: 'Run failed' } }], nextCursor: 1, done: true, state: 'failed' })
    await settle(() => f.render().resumeRootRun())
    expect(f.render().rootActiveRun).toEqual({ runId: 'continued', status: 'failed' })
    expect(f.render().rootRecovery).toMatchObject({ target: 'narrative', status: 'failed' })
    expect(f.render().rootRecovery?.input).toBeUndefined()
    expect(f.resumeRun).toHaveBeenCalledOnce()
    expect(f.submitInterjection).toHaveBeenCalledOnce()
  })
})
