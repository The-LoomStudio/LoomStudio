import { describe, expect, it, vi } from 'vitest'
import { fixture, hooks, primaryFixture } from '../../support/client/narrative-runtime.js'

describe('Narrative input persistence and delivery', () => {

  it('retains the loaded older boundary across latest-page events and terminal refresh', async () => {
    vi.stubGlobal('EventSource', class {})
    const f = fixture()
    await f.render().createTimelineFromCard()
    await f.render().createAgentSession('profile', true)
    const node = (id: string) => ({ id, kind: 'narrative' as const, floor: Number(id.slice(1)), timelineId: 'timeline', stateRevisionId: 'state', workspaceRevisionId: 'workspace',
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
    await f.loadRoot()
    expect(f.render().olderCursor).toBe('page1')
    f.getPage.mockResolvedValueOnce({ ...f.result.narrative, nodes: [n1] })
    await f.render().loadOlderNodes()
    expect(f.getPage.mock.calls.at(-1)?.[0].cursor).toBe('page1')
    expect(f.render().nodes.map(item => item.id)).toEqual(['n1', 'n2', 'n3'])
    dispose?.()
  })

  it('waits for the persisted user node before starting a Run on the Timeline Session', async () => {
    const f = await primaryFixture()
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
    expect(f.createSession).toHaveBeenCalledOnce()
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
    const f = await primaryFixture()
    f.appendInput.mockRejectedValueOnce(new Error('Head conflict'))
    await f.render().submitTurn(f.event)
    await f.loadRoot()
    expect(f.createSession).toHaveBeenCalledOnce()
    expect(f.createRun).not.toHaveBeenCalled()
    expect(f.render().nodes).toEqual([])
    expect(f.render().composerInput).toBe('  Draft\n')
    await f.render().submitTurn(f.event)
    await f.loadRoot()
    expect(f.appendInput.mock.calls[1]![0]).toEqual(f.appendInput.mock.calls[0]![0])
    expect(f.createRun).toHaveBeenCalledOnce()
  })

  it('continues Timeline delivery when the sidebar Session changes during the user-node write', async () => {
    const f = await primaryFixture()
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
    expect(f.createSession).toHaveBeenCalledOnce()
    expect(f.createRun).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ agentSessionId: 'timeline' }))
    expect(f.appendInput).toHaveBeenCalledOnce()
    expect(f.render().agentSession).toBeUndefined()
  })

  it('redelivers saved input to the Timeline Session without replacing a newer composer draft', async () => {
    const f = await primaryFixture()
    await f.render().submitTurn(f.event)
    await f.loadRoot()
    const nodeId = f.render().nodes[0]!.id
    f.render().newAgentSession()
    f.render().setInput('A newer draft')
    await f.render().retryNarrativeInput()
    expect(f.appendInput).toHaveBeenCalledOnce()
    expect(f.createRun).toHaveBeenLastCalledWith(expect.objectContaining({
      agentSessionId: 'timeline', input: 'Draft',
      narrativeTarget: { timelineId: 'timeline', branchId: 'branch', inputNodeId: nodeId },
    }))
    expect(f.render().composerInput).toBe('A newer draft')
    expect(f.render().nodes).toHaveLength(1)
    expect(f.createSession).toHaveBeenCalledOnce()
  })

  it('does not redeliver a committed input through a different endpoint', async () => {
    const f = await primaryFixture()
    await f.render().submitTurn(f.event)
    await f.loadRoot()
    f.input.api = { ...f.input.api }
    expect(f.render().canRetryNarrativeInput).toBe(false)
    await f.render().retryNarrativeInput()
    expect(f.createRun).toHaveBeenCalledOnce()
  })

  it('refreshes Narrative Head on any committed branch change, independent of the writer', async () => {
    vi.stubGlobal('EventSource', class {})
    const f = await primaryFixture()
    await f.render().submitTurn(f.event)
    await f.loadRoot()
    f.render()
    const dispose = hooks.commitEffect?.()
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
    await f.render().submitTurn(f.event)
    await f.loadRoot()
    expect(f.appendInput.mock.calls[1]![0].expectedHeadNodeId).toBe(node.id)
    dispose?.()
  })

  it('treats an explicit new submission with the same text as a new user node', async () => {
    const f = await primaryFixture()
    await f.render().submitTurn(f.event)
    await f.loadRoot()
    f.render().setInput('Draft')
    await f.render().submitTurn(f.event)
    await f.loadRoot()
    expect(f.appendInput).toHaveBeenCalledTimes(2)
    expect(f.appendInput.mock.calls[1]![0].nodeId).not.toBe(f.appendInput.mock.calls[0]![0].nodeId)
  })

  it.each([false, true])('does not clear newer input or publish a late Run into another Timeline (leave Timeline: %s)', async switchSelection => {
    const f = await primaryFixture()
    let entered!: () => void
    const creating = new Promise<void>(resolve => { entered = resolve })
    let accept!: (value: { runId: string }) => void
    const response = new Promise<{ runId: string }>(resolve => { accept = resolve })
    f.createRun.mockImplementationOnce(() => { entered(); return response })
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
    f.createRun.mockRejectedValueOnce(failure)
    await expect(f.render().submitTurn(f.event)).resolves.toBeUndefined()
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

  it('submits on the loaded Timeline Session without creating another Timeline or Session', async () => {
    const f = await primaryFixture()
    await expect(f.render().submitTurn(f.event)).resolves.toBeUndefined()
    expect(f.reportFailure).not.toHaveBeenCalled()
    expect(f.createRun).toHaveBeenCalledOnce()
    expect(f.render().composerInput).toBe('')
    expect(f.render().lastRun).toBeDefined()
    expect(f.createTimeline).toHaveBeenCalledOnce()
    expect(f.createSession).toHaveBeenCalledOnce()
  })
})
