import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FormEvent } from 'react'
import { useNarrativeRuntime } from '../../../apps/studio-client/src/features/narrative-runtime/model/use-narrative-runtime.js'
import type { StudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'

const hooks = vi.hoisted(() => ({ cursor: 0, values: [] as unknown[] }))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: () => undefined,
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

beforeEach(() => { hooks.cursor = 0; hooks.values = [] })

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
    id: 'session', timelineId: timeline.id, agentProfileId: 'profile',
    createdAt: timeline.createdAt, updatedAt: timeline.updatedAt,
  }
  const narrative = { timeline, branch, nodes: [] }
  const result = {
    narrative, agentSession: session,
    entries: {
      user: { id: 'user', entry: { kind: 'message', role: 'user', content: 'Draft' } },
      assistant: { id: 'assistant', entry: { kind: 'message', role: 'assistant', content: 'Reply' } },
    },
  }
  const createTimeline = vi.fn(async () => narrative)
  const createSession = vi.fn(async () => ({ session }))
  const createRun = vi.fn(async () => ({ runId: 'run' }))
  const reportFailure = vi.fn()
  const input: Parameters<typeof useNarrativeRuntime>[0] = {
    api: {
      narratives: { create: createTimeline },
      agentSessions: {
        create: createSession, createRun,
        subscribeRun: async () => ({ events: [{ type: 'completed', result }], nextCursor: 1, done: true }),
        getTranscript: async () => ({ session, entries: [result.entries.user, result.entries.assistant] }),
      },
    } as unknown as StudioApi,
    initialInput: '  Draft\n', selectedCardId: 'card', selectedAgentProfileId: 'profile',
    onSelectCard: vi.fn(), onSelectAgentProfile: vi.fn(),
    runAgentAction: action => action(),
    // Same boolean completion contract as useStudioState's runReported adapter.
    runAction: async action => {
      try { await action(); return true } catch (error) { reportFailure(error); return false }
    },
    runLatestAction: action => action({ isCurrent: () => true } as never),
  }
  const render = () => { hooks.cursor = 0; return useNarrativeRuntime(input) }
  const event = { preventDefault: vi.fn() } as unknown as FormEvent
  return { render, event, createTimeline, createSession, createRun, reportFailure }
}

describe('Narrative first submission preparation', () => {
  it('does not return a success navigation after session creation fails, and can retry without recreating the timeline', async () => {
    const f = fixture()
    const failure = new Error('Session creation failed')
    f.createSession.mockRejectedValueOnce(failure)
    const navigate = vi.fn()
    await f.render().submitTurn(f.event).then(activated => { if (activated) navigate(activated) })
    expect(navigate).not.toHaveBeenCalled()
    expect(f.reportFailure).toHaveBeenCalledWith(failure)
    expect(f.createRun).not.toHaveBeenCalled()
    const state = f.render()
    expect(state.composerInput).toBe('  Draft\n')
    expect(state.timeline?.id).toBe('timeline')
    expect(state.branch?.id).toBe('branch')
    expect(state.nodes).toEqual([])
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
