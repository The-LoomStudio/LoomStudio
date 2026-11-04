// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { settle, fixture, hooks, primaryFixture } from '../../support/client/narrative-runtime.js'

describe('Narrative input persistence and delivery', () => {

  it('sends inline discussion through the Timeline Session without appending prose or replacing the composer draft', async () => {
    const f = await primaryFixture()
    const accepted = await settle(() => f.render().sendDiscussionInput('请调整这一段'))
    expect(accepted).toBe(true)
    expect(f.appendInput).not.toHaveBeenCalled()
    expect(f.createRun).toHaveBeenCalledWith(expect.objectContaining({
      agentSessionId: 'timeline', input: '请调整这一段',
      narrativeTarget: { timelineId: 'timeline', branchId: 'branch' },
    }))
    expect(f.render().composerInput).toBe('  Draft\n')
    expect(f.render().inputMode).toBe('roleplay')
  })

  it('retains the loaded older boundary across latest-page events and terminal refresh', async () => {
    vi.stubGlobal('EventSource', class {})
    const f = await fixture()
    await settle(() => f.render().createTimelineFromCard())
    await settle(() => f.render().createAgentSession('profile', true))
    const node = (id: string) => ({ id, kind: 'narrative' as const, floor: Number(id.slice(1)), timelineId: 'timeline', stateRevisionId: 'state', workspaceRevisionId: 'workspace',
      body: { format: 'loom-markdown.v1' as const, raw: id }, createdAt: 'now' })
    const n1 = node('n1'), n2 = node('n2'), n3 = node('n3')
    f.getPage.mockResolvedValueOnce({ ...f.result.narrative, nodes: [n3], nextCursor: 'page2' })
    f.render()
    const dispose = f.unmount
    hooks.onCommit?.([{ entityType: 'narrative.branch', entityId: 'branch' }])
    await vi.waitFor(() => expect(f.render().olderCursor).toBe('page2'))
    f.getPage.mockResolvedValueOnce({ ...f.result.narrative, nodes: [n2], nextCursor: 'page1' })
    await settle(() => f.render().loadOlderNodes())
    f.getPage.mockResolvedValueOnce({ ...f.result.narrative, nodes: [n3], nextCursor: 'page2' })
    hooks.onCommit?.([{ entityType: 'narrative.branch', entityId: 'branch' }])
    await Promise.resolve()
    await Promise.resolve()
    expect(f.render().olderCursor).toBe('page1')
    f.getPage.mockResolvedValueOnce({ ...f.result.narrative, nodes: [n3], nextCursor: 'page2' })
    await settle(() => f.render().submitTurn(f.event))
    await f.loadRoot()
    expect(f.render().olderCursor).toBe('page1')
    f.getPage.mockResolvedValueOnce({ ...f.result.narrative, nodes: [n1] })
    await settle(() => f.render().loadOlderNodes())
    expect(f.getPage.mock.calls.at(-1)?.[0].cursor).toBe('page1')
    expect(f.render().nodes.map(item => item.id)).toEqual(['n1', 'n2', 'n3'])
    dispose?.()
  })

  it('waits for server acceptance before observing a Run or clearing input', async () => {
    const f = await primaryFixture()
    const append = f.submitInterjection.getMockImplementation()!
    let release!: () => void
    let entered!: () => void
    const writing = new Promise<void>(resolve => { entered = resolve })
    const wait = new Promise<void>(resolve => { release = resolve })
    f.submitInterjection.mockImplementationOnce(async input => {
      entered()
      await wait
      return append(input)
    })
    const pending = f.render().submitTurn(f.event)
    await writing
    expect(f.createSession).toHaveBeenCalledOnce()
    expect(f.subscribeRun).not.toHaveBeenCalled()
    expect(f.render().nodes).toEqual([])
    release()
    await pending
    await f.loadRoot()
    expect(f.submitInterjection).toHaveBeenCalledWith(expect.objectContaining({
      input: '  Draft\n', mode: 'narrative',
      narrativeTarget: { timelineId: 'timeline', branchId: 'branch' },
    }))
    expect(f.render().nodes.map(node => node.body.raw)).toEqual(['Draft'])
  })

  it('retains failed submissions and retries the same request identity', async () => {
    const f = await primaryFixture()
    f.submitInterjection.mockRejectedValueOnce(new Error('Head conflict'))
    await settle(() => f.render().submitTurn(f.event))
    await f.loadRoot()
    expect(f.createSession).toHaveBeenCalledOnce()
    expect(f.subscribeRun).not.toHaveBeenCalled()
    expect(f.render().nodes).toEqual([])
    expect(f.render().composerInput).toBe('  Draft\n')
    await settle(() => f.render().submitTurn(f.event))
    await f.loadRoot()
    expect(f.submitInterjection.mock.calls[1]![0]).toEqual(f.submitInterjection.mock.calls[0]![0])
    expect(f.submitInterjection).toHaveBeenCalledTimes(2)
  })

  it('continues Timeline delivery when the sidebar changes during server acceptance', async () => {
    const f = await primaryFixture()
    const append = f.submitInterjection.getMockImplementation()!
    let release!: () => void
    let entered!: () => void
    const writing = new Promise<void>(resolve => { entered = resolve })
    const wait = new Promise<void>(resolve => { release = resolve })
    f.submitInterjection.mockImplementationOnce(async input => {
      entered()
      await wait
      return append(input)
    })
    const pending = f.render().submitTurn(f.event)
    await writing
    f.render().newAgentSession()
    release()
    await pending
    await f.loadRoot()
    expect(f.render().nodes).toHaveLength(1)
    expect(f.createSession).toHaveBeenCalledOnce()
    expect(f.submitInterjection).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ agentSessionId: 'timeline' }))
    expect(f.appendInput).not.toHaveBeenCalled()
    expect(f.render().agentSession).toBeUndefined()
  })

  it('keeps persisted input and a newer draft when no retry checkpoint or swipe is available', async () => {
    const f = await primaryFixture()
    await settle(() => f.render().submitTurn(f.event))
    await f.loadRoot()
    const nodeId = f.render().nodes[0]!.id
    f.render().newAgentSession()
    f.render().setInput('A newer draft')
    await settle(() => f.render().retryNarrativeInput())
    expect(f.appendInput).not.toHaveBeenCalled()
    expect(f.submitInterjection).toHaveBeenCalledOnce()
    expect(f.render().nodes[0]?.id).toBe(nodeId)
    expect(f.render().composerInput).toBe('A newer draft')
    expect(f.render().nodes).toHaveLength(1)
    expect(f.createSession).toHaveBeenCalledOnce()
  })

  it('does not redeliver a committed input through a different endpoint', async () => {
    const f = await primaryFixture()
    await settle(() => f.render().submitTurn(f.event))
    await f.loadRoot()
    f.input.api = { ...f.input.api }
    expect(f.render().canRetryNarrativeInput).toBe(false)
    await settle(() => f.render().retryNarrativeInput())
    expect(f.submitInterjection).toHaveBeenCalledOnce()
  })

  it('refreshes Narrative Head on any committed branch change, independent of the writer', async () => {
    vi.stubGlobal('EventSource', class {})
    const f = await primaryFixture()
    await settle(() => f.render().submitTurn(f.event))
    await f.loadRoot()
    f.render()
    const dispose = f.unmount
    const before = f.getPage.mock.calls.length
    hooks.onCommit?.([{ entityType: 'narrative.branch', entityId: 'other-branch' }])
    expect(f.getPage).toHaveBeenCalledTimes(before)
    const node = { id: 'external-node', kind: 'narrative' as const, floor: 2, timelineId: 'timeline', stateRevisionId: 'state', workspaceRevisionId: 'workspace',
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
    await settle(() => f.render().submitTurn(f.event))
    await f.loadRoot()
    expect(f.submitInterjection.mock.calls[1]![0].narrativeTarget).toEqual({ timelineId: 'timeline', branchId: 'branch' })
    expect(f.appendInput).not.toHaveBeenCalled()
    dispose?.()
  })

  it('treats an explicit new submission with the same text as a new user node', async () => {
    const f = await primaryFixture()
    await settle(() => f.render().submitTurn(f.event))
    await f.loadRoot()
    f.render().setInput('Draft')
    await settle(() => f.render().submitTurn(f.event))
    await f.loadRoot()
    expect(f.appendInput).not.toHaveBeenCalled()
    expect(f.submitInterjection).toHaveBeenCalledTimes(2)
    expect(f.submitInterjection.mock.calls[1]![0].requestId).not.toBe(f.submitInterjection.mock.calls[0]![0].requestId)
  })

  it.each([false, true])('does not clear newer input or publish a late Run into another Timeline (leave Timeline: %s)', async switchSelection => {
    const f = await primaryFixture()
    let entered!: () => void
    const creating = new Promise<void>(resolve => { entered = resolve })
    let accept!: (value: { runId: string }) => void
    const response = new Promise<{ runId: string }>(resolve => { accept = resolve })
    const submit = f.submitInterjection.getMockImplementation()!
    f.submitInterjection.mockImplementationOnce(async request => { entered(); await response; return submit(request) })
    const pending = f.render().submitTurn(f.event)
    await creating
    f.render().setInput('Newer draft')
    if (switchSelection) { f.render().resetToDraftTimeline(); await f.loadRoot() }
    const destinationDraft = f.render().composerInput
    accept({ runId: 'run' })
    const activated = await pending
    await f.loadRoot()
    const state = f.render()
    expect(state.composerInput).toBe(destinationDraft)
    if (switchSelection) {
      expect(activated).toBeUndefined()
      expect(state.activeAgentRun).toBeUndefined()
      expect(state.nodes).toEqual([])
      expect(state.rootMessages).toEqual([])
      expect(state.rootActiveRun).toBeUndefined()
      expect(state.agentMessages).toEqual([])
    } else {
      expect(state.rootActiveRun?.status).toBe('completed')
      expect(state.activeAgentRun).toBeUndefined()
    }
  })

  it('retains the draft and creates no optimistic entries when Run creation fails', async () => {
    const f = await primaryFixture()
    const failure = new Error('Run creation failed')
    f.submitInterjection.mockRejectedValueOnce(failure)
    await expect(f.render().submitTurn(f.event)).resolves.toBeUndefined()
    const failed = f.render()
    expect(failed.composerInput).toBe('  Draft\n')
    expect(failed.nodes).toHaveLength(0)
    expect(failed.agentMessages).toEqual([])
    expect(failed.activeAgentRun).toBeUndefined()
    expect(f.reportFailure).toHaveBeenCalledWith(failure)
    await failed.submitTurn(f.event)
    expect(f.createTimeline).toHaveBeenCalledOnce()
    expect(f.createSession).toHaveBeenCalledOnce()
    expect(f.submitInterjection).toHaveBeenCalledTimes(2)
    expect(f.appendInput).not.toHaveBeenCalled()
    expect(f.render().composerInput).toBe('')
    expect(f.render().nodes.some(node => node.id.startsWith('optimistic-'))).toBe(false)
  })

  it('submits on the loaded Timeline Session without creating another Timeline or Session', async () => {
    const f = await primaryFixture()
    await expect(f.render().submitTurn(f.event)).resolves.toBeUndefined()
    expect(f.reportFailure).not.toHaveBeenCalled()
    expect(f.submitInterjection).toHaveBeenCalledOnce()
    expect(f.render().composerInput).toBe('')
    await f.loadRoot()
    expect(f.render().lastRun).toBeDefined()
    expect(f.createTimeline).toHaveBeenCalledOnce()
    expect(f.createSession).toHaveBeenCalledOnce()
  })
})
