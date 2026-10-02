import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FormEvent } from 'react'
import { useNarrativeRuntime } from '../../../apps/studio-client/src/features/narrative-runtime/model/use-narrative-runtime.js'
import type { StudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'
import type { DataOperation } from '../../../apps/studio-client/src/shared/api/data-commit-events.js'

const hooks = vi.hoisted(() => ({
  cursor: 0,
  values: [] as unknown[],
  commitEffect: undefined as (() => void | (() => void)) | undefined,
  onCommit: undefined as ((operations: Array<{ entityType: string; entityId: string }>) => void) | undefined,
  narrativeConnected: undefined as (() => void) | undefined,
  sessionEffect: undefined as (() => void | (() => void)) | undefined,
  sessionCommit: undefined as ((operations: DataOperation[]) => void) | undefined,
  connected: undefined as (() => void) | undefined,
  subscribingSessions: false,
}))
vi.mock('../../../apps/studio-client/src/shared/api/data-commit-events.js', () => ({
  subscribeDataCommits: (onCommit: typeof hooks.sessionCommit, connected: () => void) => {
    if (hooks.subscribingSessions) {
      hooks.sessionCommit = onCommit
      hooks.connected = connected
      return () => { hooks.sessionCommit = undefined }
    }
    hooks.onCommit = onCommit
    hooks.narrativeConnected = connected
    return () => { hooks.onCommit = undefined }
  },
}))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: (effect: () => void, deps?: unknown[]) => {
    if (deps?.length === 3 && typeof deps[1] === 'string' && typeof deps[2] === 'string') hooks.commitEffect = effect
    if (deps?.length === 2 && deps[1] === 'timeline') hooks.sessionEffect = effect
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

beforeEach(() => { hooks.cursor = 0; hooks.values = []; hooks.commitEffect = undefined; hooks.onCommit = undefined
  hooks.narrativeConnected = undefined
  hooks.sessionEffect = undefined; hooks.sessionCommit = undefined; hooks.connected = undefined; hooks.subscribingSessions = false })
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
  const getPage = vi.fn<StudioApi['narratives']['getPage']>(async () => narrative)
  const resumeRun = vi.fn(async () => ({ runId: 'continued', accepted: true }))
  const acknowledgeRunCompletion = vi.fn(async (runId: string) => ({ runId, accepted: true }))
  const reportFailure = vi.fn()
  const input: Parameters<typeof useNarrativeRuntime>[0] = {
    api: {
      narratives: { create: createTimeline, appendInput, getPage },
      agentSessions: {
        create: createSession, createRun, subscribeRun, getTranscript, resumeRun, acknowledgeRunCompletion,
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
  return { render, event, input, result, appendInput, createTimeline, createSession, createRun, subscribeRun, getTranscript, getPage, resumeRun, acknowledgeRunCompletion, reportFailure }
}

describe('C-OCT-002 real HTTP/SSE ordering', () => {
  it.each([true, false])('keeps the edited body and Head when event delivery is delayed: %s', async delayEvent => {
    const { withStudioServer, callRpc, authenticatedFetch } = await import('../../integration/studio-server/helpers.js')
    await withStudioServer(async port => {
      type Page = Awaited<ReturnType<StudioApi['narratives']['getPage']>>
      type Edit = Awaited<ReturnType<StudioApi['narratives']['editNode']>>
      const card = await callRpc<{ card: { id: string } }>(port, 'application.createCard', { name: 'Read/write ordering' })
      const created = await callRpc<Page>(port, 'application.createNarrativeTimeline', {
        cardId: card.card.id, openingNodes: [{ content: 'Original' }],
      })
      const stream = await authenticatedFetch(port, '/extensions/events')
      const reader = stream.body!.getReader()
      const decoder = new TextDecoder()
      let buffered = ''
      let editEvent: { payload: { changesetId: string; operations: DataOperation[] } } | undefined
      const readEditEvent = async () => {
        while (!editEvent) {
          const { value, done } = await reader.read()
          if (done) throw new Error('SSE closed before the edit commit')
          buffered += decoder.decode(value, { stream: true })
          let boundary: number
          while ((boundary = buffered.indexOf('\n\n')) >= 0) {
            const frame = buffered.slice(0, boundary)
            buffered = buffered.slice(boundary + 2)
            if (!frame.startsWith('event: data.changed\n')) continue
            const data = frame.split('\n').find(line => line.startsWith('data: '))!
            editEvent = JSON.parse(data.slice(6))
          }
        }
        return editEvent
      }
      const f = fixture()
      f.createTimeline.mockResolvedValue(created)
      f.createSession.mockResolvedValue({ session: { ...f.result.agentSession, timelineId: created.timeline.id } })
      vi.stubGlobal('EventSource', class {})
      await f.render().createAgentSession('profile', true)
      f.render()
      const dispose = hooks.commitEffect?.()
      const oldReadReady = Promise.withResolvers<Page>()
      const releaseOldRead = Promise.withResolvers<void>()
      const reads: Promise<void>[] = []
      let holdRead = true
      let editResult: Edit | undefined
      f.input.runAction = async action => {
        const pending = action()
        reads.push(pending)
        await pending
        return true
      }
      f.getPage.mockImplementation(async params => {
        const page = await callRpc<Page>(port, 'application.getNarrativePage', params)
        if (holdRead) {
          holdRead = false
          oldReadReady.resolve(page)
          await releaseOldRead.promise
        }
        return page
      })
      f.input.api.narratives.editNode = async params => {
        const result = await callRpc<Edit>(port, 'application.editNarrativeNode', params)
        editResult = result
        if (!delayEvent) hooks.onCommit?.((await readEditEvent()).payload.operations)
        return result
      }
      try {
        hooks.narrativeConnected?.()
        const oldPage = await oldReadReady.promise
        expect(oldPage.nodes[0]?.body.raw).toBe('Original')
        await f.render().editNarrativeNode(created.nodes[0]!.id, 'Edited')
        const editedHead = f.render().branch?.headNodeId
        expect(editedHead).not.toBe(oldPage.branch.headNodeId)
        expect(f.render().nodes[0]?.body.raw).toBe('Edited')
        const actualEvent = await readEditEvent()
        expect(actualEvent.payload.changesetId).toBe(editResult?.mutation.changesetId)
        expect(actualEvent.payload.operations).toContainEqual(expect.objectContaining({
          entityType: 'narrative.branch', entityId: created.branch.id, kind: 'update',
        }))
        releaseOldRead.resolve()
        await Promise.all(reads)
        expect(f.render().nodes[0]?.body.raw).toBe('Edited')
        expect(f.render().branch?.headNodeId).toBe(editedHead)
        if (delayEvent) hooks.onCommit?.(actualEvent.payload.operations)
        await Promise.all(reads)
        expect(f.render().nodes[0]?.body.raw).toBe('Edited')
        expect(f.reportFailure).not.toHaveBeenCalled()
      } finally {
        releaseOldRead.resolve()
        dispose?.()
        await reader.cancel()
      }
    })
  })

  it.each(['older', 'terminal'] as const)('rejects a %s page crossing a successful local edit', async readKind => {
    vi.stubGlobal('EventSource', class {})
    const f = fixture()
    const original = { id: 'original', timelineId: 'timeline', stateRevisionId: 'state',
      body: { format: 'loom-markdown.v1' as const, raw: 'Original' }, createdAt: '' }
    const page = { ...f.result.narrative, branch: { ...f.result.narrative.branch, headNodeId: original.id }, nodes: [original] }
    f.createTimeline.mockResolvedValue(page)
    await f.render().createAgentSession('profile', true)
    if (readKind === 'older') {
      f.getPage.mockResolvedValueOnce({ ...page, nextCursor: 'older' })
      f.render()
      hooks.commitEffect?.()
      hooks.narrativeConnected?.()
      await vi.waitFor(() => expect(f.render().olderCursor).toBe('older'))
    }
    const readStarted = Promise.withResolvers<void>()
    const readResult = Promise.withResolvers<Awaited<ReturnType<StudioApi['narratives']['getPage']>>>()
    f.getPage.mockImplementationOnce(() => { readStarted.resolve(); return readResult.promise })
    const pending = readKind === 'older' ? f.render().loadOlderNodes() : f.render().submitTurn(f.event)
    await readStarted.promise
    const target = f.render().nodes.at(-1)!
    const edited = { ...target, id: 'edited', body: { ...target.body, raw: 'Edited' } }
    f.input.api.narratives.editNode = async () => ({
      timeline: page.timeline, branch: { ...page.branch, headNodeId: edited.id },
      replacements: [{ previousNodeId: target.id, node: edited }], mutation: { changesetId: 'edit' },
    })
    await f.render().editNarrativeNode(target.id, 'Edited')
    readResult.resolve({ ...page, nodes: [{ ...original, id: 'stale' }] })
    await pending
    expect(f.render().nodes.at(-1)?.body.raw).toBe('Edited')
    expect(f.render().branch?.headNodeId).toBe(edited.id)
    expect(f.render().nodes.some(item => item.id === 'stale')).toBe(false)
    if (readKind === 'older') expect(f.render().olderCursor).toBe('older')
    expect(f.reportFailure).not.toHaveBeenCalled()
  })

  it('allows an authoritative pending read to publish after an edit conflict', async () => {
    vi.stubGlobal('EventSource', class {})
    const f = fixture()
    const original = { id: 'original', timelineId: 'timeline', stateRevisionId: 'state',
      body: { format: 'loom-markdown.v1' as const, raw: 'Original' }, createdAt: '' }
    const page = { ...f.result.narrative, branch: { ...f.result.narrative.branch, headNodeId: original.id }, nodes: [original] }
    f.createTimeline.mockResolvedValue(page)
    await f.render().createAgentSession('profile', true)
    const readResult = Promise.withResolvers<Awaited<ReturnType<StudioApi['narratives']['getPage']>>>()
    f.getPage.mockReturnValueOnce(readResult.promise)
    f.input.api.narratives.editNode = async () => { throw new Error('Head conflict') }
    f.render()
    const dispose = hooks.commitEffect?.()
    hooks.narrativeConnected?.()
    await expect(f.render().editNarrativeNode(original.id, 'Unsaved')).rejects.toThrow('Head conflict')
    const external = { ...original, id: 'external', body: { ...original.body, raw: 'External' } }
    readResult.resolve({ ...page, branch: { ...page.branch, headNodeId: external.id }, nodes: [external] })
    await vi.waitFor(() => expect(f.render().nodes[0]?.body.raw).toBe('External'))
    expect(f.render().branch?.headNodeId).toBe(external.id)
    dispose?.()
  })
})

describe('Narrative first submission preparation', () => {
  it('publishes the Inspector result after expired replay and acknowledges only received completion', async () => {
    const f = fixture()
    await f.render().createAgentSession('profile', true)
    const projection = { messages: [{ role: 'user', content: 'Large compiled prompt' }] }
    const result = { ...f.result, projection, promptBuildTrace: { marker: 'original-trace' } }
    f.subscribeRun.mockResolvedValueOnce({
      events: [{ type: 'completed', runId: 'run', result }],
      nextCursor: 100, done: true, state: 'completed',
      replayExpired: true, partialText: '', pendingApprovals: [],
    } as Awaited<ReturnType<StudioApi['agentSessions']['subscribeRun']>>)
    f.render().setAgentInput('Draft')
    await f.render().submitAgentTurn(f.event)
    expect(f.render().lastRun).toBe(result)
    expect(f.acknowledgeRunCompletion).toHaveBeenCalledExactlyOnceWith('run')
    expect(f.reportFailure).not.toHaveBeenCalled()
  })
  it('resynchronizes expired replay before accepting new deltas and restores pending approval', async () => {
    const f = fixture()
    await f.render().createAgentSession('profile', true)
    const user = { id: 'committed-user', agentSessionId: 'session', runId: 'run', sequence: 1,
      entry: { kind: 'message' as const, role: 'user' as const, content: 'Draft' }, createdAt: '' }
    const assistant = { ...user, id: 'committed-assistant', sequence: 2,
      entry: { kind: 'message' as const, role: 'assistant' as const, content: 'Saved step' } }
    f.getTranscript.mockResolvedValue({ session: f.result.agentSession, entries: [user, assistant] })
    const expired = { events: [], nextCursor: 100, done: false, state: 'running' as const,
      replayExpired: true, partialText: 'Recovered',
      pendingApprovals: [{ type: 'mutation-approval-requested', requestId: 'approval', preview: { value: 1 } }] }
    let resolve!: (value: Awaited<ReturnType<StudioApi['agentSessions']['subscribeRun']>>) => void
    f.subscribeRun.mockResolvedValueOnce({
      events: [
        { type: 'transcript-appended', entries: [{ ...assistant, id: 'stale-step', entry: { ...assistant.entry, content: 'Stale' } }] },
        { type: 'text-delta', delta: 'OLD' },
      ], nextCursor: 2, done: false, state: 'running',
    } as Awaited<ReturnType<StudioApi['agentSessions']['subscribeRun']>>)
      .mockResolvedValueOnce(expired)
      .mockResolvedValueOnce({ events: [], nextCursor: 100, done: false, state: 'running' })
      .mockImplementationOnce(() => new Promise(accept => { resolve = accept }))
    f.render().setAgentInput('Draft')
    const pending = f.render().submitAgentTurn(f.event)
    await vi.waitFor(() => expect(f.subscribeRun).toHaveBeenCalledTimes(4))
    expect(f.getTranscript).toHaveBeenCalledOnce()
    expect(f.subscribeRun.mock.calls[3]).toEqual(['run', 100, 'session'])
    expect(f.render().agentMessages.map(item => item.entry.content)).toEqual(['Draft', 'Saved step', 'Recovered'])
    expect(f.render().activeAgentRun?.approval?.requestId).toBe('approval')
    resolve({ events: [{ type: 'text-delta', delta: ' tail' }], nextCursor: 101, done: false, state: 'running' })
    let finish!: (value: Awaited<ReturnType<StudioApi['agentSessions']['subscribeRun']>>) => void
    f.subscribeRun.mockImplementationOnce(() => new Promise(accept => { finish = accept }))
    await vi.waitFor(() => expect(f.subscribeRun).toHaveBeenCalledTimes(5))
    expect(f.render().agentMessages.at(-1)?.entry.content).toBe('Recovered tail')
    finish({ events: [{ type: 'suspended', runId: 'run' }], nextCursor: 102, done: true, state: 'suspended' })
    await pending
  })

  it('does not restore expired partial text already committed during the Transcript read', async () => {
    const f = fixture()
    f.render().setAgentInput('Draft')
    const assistant = { id: 'saved', agentSessionId: 'session', runId: 'run', sequence: 2,
      entry: { kind: 'message' as const, role: 'assistant' as const, content: 'Snapshot text' }, createdAt: '' }
    let resolveRead!: (value: Awaited<ReturnType<StudioApi['agentSessions']['getTranscript']>>) => void
    f.getTranscript.mockImplementationOnce(() => new Promise(accept => { resolveRead = accept }))
    let finish!: (value: Awaited<ReturnType<StudioApi['agentSessions']['subscribeRun']>>) => void
    f.subscribeRun.mockResolvedValueOnce({
      events: [], nextCursor: 100, done: false, state: 'running', replayExpired: true,
      partialText: 'Snapshot text', pendingApprovals: [],
    } as Awaited<ReturnType<StudioApi['agentSessions']['subscribeRun']>>)
      .mockResolvedValueOnce({
        events: [{ type: 'transcript-appended', entries: [assistant] }, { type: 'text-delta', delta: 'Next step' }],
        nextCursor: 102, done: false, state: 'running',
      } as Awaited<ReturnType<StudioApi['agentSessions']['subscribeRun']>>)
      .mockImplementationOnce(() => new Promise(accept => { finish = accept }))
    const pending = f.render().submitAgentTurn(f.event)
    await vi.waitFor(() => expect(f.getTranscript).toHaveBeenCalledOnce())
    resolveRead({ session: f.result.agentSession, entries: [assistant] })
    await vi.waitFor(() => expect(f.subscribeRun).toHaveBeenCalledTimes(3))
    expect(f.subscribeRun.mock.calls[1]).toEqual(['run', 100, 'session'])
    expect(f.render().agentMessages.filter(item => item.id === 'saved')).toHaveLength(1)
    expect(f.render().agentMessages.at(-1)?.entry.content).toBe('Next step')
    finish({ events: [{ type: 'suspended', runId: 'run' }], nextCursor: 103, done: true, state: 'suspended' })
    await pending
  })

  it('finishes expired completed replay through authoritative refresh without a completed result', async () => {
    const f = fixture()
    await f.render().createAgentSession('profile', true)
    f.subscribeRun.mockResolvedValueOnce({
      events: [], nextCursor: 100, done: true, state: 'completed',
      replayExpired: true, partialText: '', pendingApprovals: [],
    } as Awaited<ReturnType<StudioApi['agentSessions']['subscribeRun']>>)
    f.render().setAgentInput('Draft')
    await f.render().submitAgentTurn(f.event)
    expect(f.render().activeAgentRun?.status).toBe('completed')
    expect(f.render().runRecovery).toBeUndefined()
    expect(f.render().agentMessages).toEqual([f.result.entries.user, f.result.entries.assistant])
    expect(f.getTranscript).toHaveBeenCalledTimes(2)
    expect(f.reportFailure).not.toHaveBeenCalled()
    expect(f.createRun).toHaveBeenCalledOnce()
    expect(f.subscribeRun).toHaveBeenCalledWith('run', 0, 'session')
    expect(f.acknowledgeRunCompletion).not.toHaveBeenCalled()
  })

  it.each(['selection', 'api'])('ignores expired Transcript reload after %s changes', async change => {
    const f = fixture()
    f.render().setAgentInput('Draft')
    let resolveRead!: (value: Awaited<ReturnType<StudioApi['agentSessions']['getTranscript']>>) => void
    f.getTranscript.mockImplementationOnce(() => new Promise(accept => { resolveRead = accept }))
    f.subscribeRun.mockResolvedValueOnce({
      events: [], nextCursor: 100, done: false, state: 'running', replayExpired: true,
      partialText: 'OLD', pendingApprovals: [{ type: 'mutation-approval-requested', requestId: 'old', preview: {} }],
    } as Awaited<ReturnType<StudioApi['agentSessions']['subscribeRun']>>)
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

  it.each(['timeline', 'card', 'api'])('does not publish or navigate a late Session after %s changes', async change => {
    const f = fixture()
    await f.render().createAgentSession('profile', true)
    let resolve!: (value: Awaited<ReturnType<StudioApi['agentSessions']['create']>>) => void
    f.createSession.mockImplementationOnce(() => new Promise(accept => { resolve = accept }))
    const pending = f.render().createAgentSession('profile', true)
    if (change === 'timeline') f.render().resetToDraftTimeline()
    if (change === 'card') f.input.selectedCardId = 'other'
    if (change === 'api') f.input.api = { ...f.input.api }
    f.render()
    resolve({ session: { ...f.result.agentSession, id: 'late' } })
    expect(await pending).toBeUndefined()
    expect(f.render().agentSessions.some(item => item.id === 'late')).toBe(false)
    expect(f.render().primarySession?.id).not.toBe('late')
    if (change !== 'api') expect(f.render().allAgentSessions.some(item => item.id === 'late')).toBe(true)
  })

  it('keeps a committed Session without publishing when Card changes during first Timeline creation', async () => {
    const f = fixture()
    let resolve!: (value: typeof f.result.narrative) => void
    f.createTimeline.mockImplementationOnce(() => new Promise(accept => { resolve = accept }))
    const pending = f.render().createAgentSession('profile', true)
    f.input.selectedCardId = 'other'
    f.render()
    resolve(f.result.narrative)
    expect(await pending).toBeUndefined()
    expect(f.createSession).toHaveBeenCalledOnce()
    expect(f.render().timeline).toBeUndefined()
    expect(f.render().allAgentSessions.map(item => item.id)).toContain('session')
  })

  it('isolates Session events and uses targeted reads only for scoped updates', async () => {
    vi.stubGlobal('EventSource', class {})
    const f = fixture()
    await f.render().createAgentSession('profile', true)
    const list = vi.fn(async () => ({ sessions: [f.result.agentSession] }))
    const get = vi.fn(async () => ({ session: { ...f.result.agentSession, title: 'updated' } }))
    f.input.api.agentSessions.list = list
    f.input.api.agentSessions.get = get
    f.render()
    hooks.subscribingSessions = true
    const dispose = hooks.sessionEffect?.()
    const operation = (kind: string, timelineId = 'timeline'): DataOperation => ({
      entityType: 'agent.session', entityId: 'session', kind,
      scope: { store: 'narrative', entityType: 'narrative.timeline', entityId: timelineId },
    })
    hooks.sessionCommit?.([operation('update', 'other')])
    expect(list).not.toHaveBeenCalled()
    expect(get).not.toHaveBeenCalled()
    hooks.sessionCommit?.([operation('update')])
    await vi.waitFor(() => expect(f.render().agentSessions[0]?.title).toBe('updated'))
    expect(get).toHaveBeenCalledWith('session')
    expect(list).not.toHaveBeenCalled()
    for (const kind of ['create', 'delete']) {
      hooks.sessionCommit?.([operation(kind)])
      await Promise.resolve()
      await Promise.resolve()
    }
    hooks.connected?.()
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(3))
    hooks.sessionCommit?.([{ entityType: 'agent.session', entityId: 'session', kind: 'update' }])
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(4))
    dispose?.()
  })

  it('retains the loaded older boundary across latest-page events and terminal refresh', async () => {
    vi.stubGlobal('EventSource', class {})
    const f = fixture()
    await f.render().createAgentSession('profile', true)
    const node = (id: string) => ({ id, timelineId: 'timeline', stateRevisionId: 'state',
      body: { format: 'loom-markdown.v1' as const, raw: id }, createdAt: 'now' })
    const n1 = node('n1'), n2 = node('n2'), n3 = node('n3')
    f.getPage.mockResolvedValueOnce({ ...f.result.narrative, nodes: [n3], nextCursor: 'page2' })
    f.render()
    const dispose = hooks.commitEffect?.()
    hooks.onCommit?.([{ entityType: 'narrative.branch', entityId: 'branch' }])
    await vi.waitFor(() => expect(f.render().olderCursor).toBe('page2'))
    f.getPage.mockResolvedValueOnce({ ...f.result.narrative, nodes: [n2], nextCursor: 'page1' })
    await f.render().loadOlderNodes()
    f.getPage.mockResolvedValueOnce({ ...f.result.narrative, nodes: [n3], nextCursor: 'page2' })
    hooks.onCommit?.([{ entityType: 'narrative.branch', entityId: 'branch' }])
    await Promise.resolve()
    await Promise.resolve()
    expect(f.render().olderCursor).toBe('page1')
    f.getPage.mockResolvedValueOnce({ ...f.result.narrative, nodes: [n3], nextCursor: 'page2' })
    await f.render().submitTurn(f.event)
    expect(f.render().olderCursor).toBe('page1')
    f.getPage.mockResolvedValueOnce({ ...f.result.narrative, nodes: [n1] })
    await f.render().loadOlderNodes()
    expect(f.getPage.mock.calls.at(-1)?.[0].cursor).toBe('page1')
    expect(f.render().nodes.map(item => item.id)).toEqual(['n1', 'n2', 'n3'])
    dispose?.()
  })

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
