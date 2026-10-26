import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { hooks, primaryFixture } from '../../support/client/narrative-runtime.js'
import { NarrativeSwipePicker } from '../../../apps/studio-client/src/features/narrative-runtime/ui/narrative-swipe-picker.js'
import type { NarrativeSwipeView } from '../../../apps/studio-client/src/features/narrative-runtime/model/use-narrative-runtime.js'
import type { StudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'

const view = (): NarrativeSwipeView => ({
  id: 'group', timelineId: 'timeline', branchId: 'branch', revision: 4,
  inputNodeId: 'input', sourceAgentSessionId: 'timeline', selectedCandidateId: 'a',
  active: false, suspended: false, canSelect: true, canGenerate: true,
  candidates: [{ id: 'a', nodeId: 'a-node', preview: 'A', status: 'completed' }],
})

async function connect(f: Awaited<ReturnType<typeof primaryFixture>>, swipe = view()) {
  const getSwipes = vi.fn(async () => ({ swipe }))
  f.input.api.narratives.getSwipes = getSwipes
  f.render()
  const dispose = hooks.commitEffect?.()
  await Promise.resolve()
  await Promise.resolve()
  return { getSwipes, dispose }
}

describe('Swipe production recovery review regressions', () => {
  it('requires confirmed regeneration for the retired base prefix of the same Session', async () => {
    const f = await primaryFixture()
    const { dispose } = await connect(f, { ...view(), requiresRegeneration: true })
    await f.render().generateSwipe('swipe')
    expect(f.createRun).not.toHaveBeenCalled()
    await f.render().generateSwipe('regenerate', true)
    expect(f.createRun).toHaveBeenCalledWith(expect.objectContaining({ narrativeTarget: expect.objectContaining({
      swipe: { groupId: 'group', mode: 'regenerate', expectedRevision: 4, allowSessionChange: true },
    }) }))
    dispose?.()
  })
  it('keeps retry visible after failed B clears activeCandidateId, and without A', () => {
    for (const withA of [true, false]) {
      const swipe = view()
      if (!withA) { swipe.candidates = []; swipe.selectedCandidateId = undefined }
      swipe.candidates.push({ id: 'b', preview: '', status: 'failed' })
      const markup = renderToStaticMarkup(createElement(NarrativeSwipePicker, {
        swipe, busy: false, primarySessionId: 'timeline', onSelect: vi.fn(), onGenerate: vi.fn(), t: createTranslator('en-US'),
      }))
      expect(markup).toContain('Retry from start')
    }
  })

  it('refreshes the baseline from the real branch commit while generation is still running', async () => {
    const f = await primaryFixture()
    const { dispose } = await connect(f)
    const pending = Promise.withResolvers<Awaited<ReturnType<StudioApi['agentSessions']['subscribeRun']>>>()
    f.subscribeRun.mockReturnValueOnce(pending.promise)
    const running = f.render().generateSwipe('swipe')
    await vi.waitFor(() => expect(f.subscribeRun).toHaveBeenCalledOnce())
    const inputNode = { id: 'input', kind: 'user-input' as const, floor: 1, workspaceRevisionId: 'workspace', timelineId: 'timeline', stateRevisionId: 'baseline',
      body: { format: 'loom-markdown.v1' as const, raw: 'Original input' }, createdAt: '' }
    f.getPage.mockResolvedValue({ ...f.result.narrative, nodes: [inputNode] })
    hooks.onCommit?.([{ entityType: 'narrative.branch', entityId: 'branch' }])
    await vi.waitFor(() => expect(f.render().nodes.map(node => node.id)).toEqual(['input']))
    expect(f.render().swipeBusy).toBe(true)
    pending.resolve({ events: [{ type: 'completed', runId: 'run', result: f.rootResult }], nextCursor: 1, done: true, state: 'completed' })
    await running
    dispose?.()
  })

  it('accepts authoritative availability after an externally abandoned suspended run', async () => {
    const f = await primaryFixture()
    const { getSwipes, dispose } = await connect(f)
    getSwipes.mockResolvedValue({ swipe: { ...view(), suspended: true, canGenerate: false, canSelect: false } })
    f.subscribeRun.mockResolvedValueOnce({ events: [{ type: 'suspended', runId: 'run' }], nextCursor: 1, done: true, state: 'suspended' })
    await f.render().generateSwipe('swipe')
    expect(f.render().swipe?.suspended).toBe(true)
    getSwipes.mockResolvedValue({ swipe: view() })
    hooks.onCommit?.([{ entityType: 'agent.session', entityId: 'timeline' }])
    await vi.waitFor(() => expect(f.render().swipe?.suspended).toBe(false))
    expect(f.render().swipeBusy).toBe(false)
    dispose?.()
  })

  it('resumes and observes the writing session instead of the independently viewed session', async () => {
    const f = await primaryFixture()
    const other = { ...f.result.agentSession, id: 'other' }
    const readTranscript = f.getTranscript.getMockImplementation()!
    f.getTranscript.mockImplementation(async input => input.agentSessionId === other.id
      ? { session: other, entries: [] }
      : readTranscript(input))
    await f.render().activateAgentSession(other)
    const { dispose } = await connect(f)
    f.subscribeRun.mockResolvedValueOnce({ events: [{ type: 'suspended', runId: 'run' }], nextCursor: 1, done: true, state: 'suspended' })
    await f.render().generateSwipe('swipe')
    await f.loadRoot()
    await f.render().resumeRootRun()
    expect(f.resumeRun).toHaveBeenCalledWith({ runId: 'run', agentSessionId: 'timeline' })
    expect(f.subscribeRun.mock.calls.at(-1)).toEqual(['continued', 0, 'timeline'])
    expect(f.render().agentSession?.id).toBe('other')
    expect(f.render().agentMessages).toEqual([])
    dispose?.()
  })
})
