// @vitest-environment happy-dom
import type { StudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'
import { describe, expect, it, vi } from 'vitest'
import { settle, hooks, primaryFixture } from '../../support/client/narrative-runtime.js'
import type { NarrativeSwipeView } from '../../../apps/studio-client/src/features/narrative-runtime/model/use-narrative-runtime.js'

const view = (changes: Partial<NarrativeSwipeView> = {}): NarrativeSwipeView => ({
  id: 'group', timelineId: 'timeline', branchId: 'branch', revision: 4,
  inputNodeId: 'original-input', sourceAgentSessionId: 'timeline',
  selectedCandidateId: 'a', active: false, suspended: false, canSelect: true, canGenerate: true,
  candidates: [{ id: 'a', nodeId: 'a-node', preview: 'A', status: 'completed' },
    { id: 'b', nodeId: 'b-node', preview: 'B', status: 'completed' }], ...changes,
})

async function swipeFixture(swipe = view()) {
  const f = await primaryFixture()
  const getSwipes = vi.fn(async () => ({ swipe }))
  const selectSwipe = vi.fn<StudioApi['narratives']['selectSwipe']>(async () => ({ page: f.result.narrative, swipe: { ...swipe, selectedCandidateId: 'b', revision: 5 } }))
  f.input.api.narratives.getSwipes = getSwipes
  f.input.api.narratives.selectSwipe = selectSwipe
  f.render()
  const dispose = f.unmount
  hooks.narrativeConnected()
  await f.loadRoot()
  return { ...f, getSwipes, selectSwipe, dispose }
}

describe('Narrative Swipe wiring', () => {
  it('submits an edited input atomically through Swipe without modifying the continuation draft', async () => {
    const f = await swipeFixture()
    await settle(() => f.render().generateSwipe('swipe', false, 'Different direction'))
    expect(f.createRun).toHaveBeenCalledWith(expect.objectContaining({ narrativeTarget: expect.objectContaining({
      swipe: { groupId: 'group', mode: 'swipe', expectedRevision: 4, input: 'Different direction' },
    }) }))
    expect(f.appendInput).not.toHaveBeenCalled()
    expect(f.render().composerInput).toBe('  Draft\n')
    expect(f.render().displayOnlyNodeId).toBeUndefined()
    f.dispose?.()
  })
  it('retains A for display while the authoritative nodes have returned to the input baseline', async () => {
    const f = await swipeFixture()
    const node = (id: string, raw: string) => ({ id, kind: id === 'original-input' ? 'user-input' as const : 'narrative' as const, floor: id === 'original-input' ? 1 : 2, timelineId: 'timeline', stateRevisionId: 'state', workspaceRevisionId: 'workspace',
      body: { format: 'loom-markdown.v1' as const, raw }, createdAt: 'now' })
    const originalInput = node('original-input', 'User input')
    const a = { ...node('a-node', 'Candidate A'), parentNodeId: originalInput.id }
    f.getPage.mockResolvedValue({ ...f.result.narrative, nodes: [originalInput, a] })
    hooks.onCommit?.([{ entityType: 'narrative.branch', entityId: 'branch' }])
    await vi.waitFor(() => expect(f.render().nodes.at(-1)?.id).toBe('a-node'))
    f.getPage.mockResolvedValue({ ...f.result.narrative, nodes: [originalInput] })
    const wait = Promise.withResolvers<Awaited<ReturnType<typeof f.subscribeRun>>>()
    f.subscribeRun.mockImplementationOnce(() => wait.promise)
    const pending = f.render().generateSwipe('swipe')
    await vi.waitFor(() => expect(f.subscribeRun).toHaveBeenCalledOnce())
    hooks.onCommit?.([{ entityType: 'narrative.branch', entityId: 'branch' }])
    await vi.waitFor(() => expect(f.render().nodes.map(item => item.id)).toEqual(['original-input']))
    expect(f.render().nodes.map(item => item.id)).toEqual(['original-input'])
    expect(f.render().displayNodes.map(item => item.id)).toEqual(['original-input', 'a-node'])
    expect(f.render().displayOnlyNodeId).toBe('a-node')
    wait.resolve({ events: [{ type: 'completed', runId: 'run', result: f.rootResult }], nextCursor: 1, done: true, state: 'completed' })
    await pending
    await f.loadRoot()
    expect(f.render().displayOnlyNodeId).toBeUndefined()
    expect(f.appendInput).not.toHaveBeenCalled()
    f.dispose?.()
  })

  it('selects a completed candidate with revision and head CAS, keeping the draft', async () => {
    const f = await swipeFixture()
    await settle(() => f.render().selectSwipe('b'))
    expect(f.selectSwipe).toHaveBeenCalledWith({ timelineId: 'timeline', branchId: 'branch',
      groupId: 'group', candidateId: 'b', expectedRevision: 4, expectedHeadNodeId: null })
    expect(f.render().swipe?.selectedCandidateId).toBe('b')
    expect(f.getTranscript).toHaveBeenCalledWith(expect.objectContaining({ selectedCandidates: true }))
    expect(f.render().composerInput).toBe('  Draft\n')
    expect(f.createRun).not.toHaveBeenCalled()
    f.dispose?.()
  })

  it.each(['swipe', 'regenerate', 'retry'] as const)('creates %s on the original input without appending or clearing the draft', async mode => {
    const f = await swipeFixture()
    f.getPage.mockClear()
    await settle(() => f.render().generateSwipe(mode))
    await f.loadRoot()
    expect(f.createRun).toHaveBeenCalledWith(expect.objectContaining({
      agentSessionId: 'timeline', input: '', narrativeTarget: {
        timelineId: 'timeline', branchId: 'branch', inputNodeId: 'original-input',
        swipe: { groupId: 'group', mode, expectedRevision: 4 },
      },
    }))
    expect(f.appendInput).not.toHaveBeenCalled()
    expect(f.render().composerInput).toBe('  Draft\n')
    expect(f.getPage).toHaveBeenCalledExactlyOnceWith({ timelineId: 'timeline', branchId: 'branch', limit: 100 })
    expect(f.subscribeRun).toHaveBeenCalledOnce()
    expect(f.getSwipes.mock.calls.length).toBeGreaterThan(1)
    expect(f.reportFailure).not.toHaveBeenCalled()
    f.dispose?.()
  })

  it('does not select or generate while suspended even with stale permissions', async () => {
    const f = await swipeFixture(view({ suspended: true }))
    await settle(() => f.render().selectSwipe('b'))
    await settle(() => f.render().generateSwipe('swipe'))
    expect(f.selectSwipe).not.toHaveBeenCalled()
    expect(f.createRun).not.toHaveBeenCalled()
    f.dispose?.()
  })

  it('requires confirmed regeneration when the primary session changes', async () => {
    const f = await swipeFixture(view({ sourceAgentSessionId: 'old-session' }))
    await settle(() => f.render().generateSwipe('swipe'))
    expect(f.createRun).not.toHaveBeenCalled()
    await settle(() => f.render().generateSwipe('regenerate', true))
    expect(f.createRun).toHaveBeenCalledWith(expect.objectContaining({ narrativeTarget: expect.objectContaining({
      swipe: { groupId: 'group', mode: 'regenerate', expectedRevision: 4, allowSessionChange: true },
    }) }))
    f.dispose?.()
  })

  it('reports selection errors and leaves the current candidate unchanged', async () => {
    const f = await swipeFixture()
    f.selectSwipe.mockRejectedValueOnce(new Error('Revision conflict'))
    await settle(() => f.render().selectSwipe('b'))
    expect(f.reportFailure).toHaveBeenCalledWith(expect.objectContaining({ message: 'Revision conflict' }))
    expect(f.render().swipe?.selectedCandidateId).toBe('a')
    expect(f.render().swipeBusy).toBe(false)
    f.dispose?.()
  })

  it('ignores a selection response and stale handlers after leaving the Timeline', async () => {
    const f = await swipeFixture()
    let finish!: (result: Awaited<ReturnType<typeof f.selectSwipe>>) => void
    f.selectSwipe.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const old = f.render()
    const pending = old.selectSwipe('b')
    f.render().resetToDraftTimeline()
    f.render()
    finish({ page: f.result.narrative, swipe: view({ selectedCandidateId: 'b' }) })
    await pending
    await old.generateSwipe('swipe')
    expect(f.render().timeline).toBeUndefined()
    expect(f.render().swipe).toBeUndefined()
    expect(f.createRun).not.toHaveBeenCalled()
    f.dispose?.()
  })
})
