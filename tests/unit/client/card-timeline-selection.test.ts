import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useNarrativeRuntime } from '../../../apps/studio-client/src/features/narrative-runtime/model/use-narrative-runtime.js'
import type { StudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'
import type { NarrativeBranch, NarrativeTimeline } from '../../../apps/studio-client/src/entities/index.js'

const hooks = vi.hoisted(() => ({
  cursor: 0, values: [] as unknown[], effects: [] as (() => void)[],
}))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
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
  useEffect: (effect: () => void | (() => void), deps: unknown[]) => {
    const index = hooks.cursor++
    const previous = hooks.values[index] as { deps: unknown[]; cleanup?: () => void } | undefined
    if (previous && deps.every((item, i) => Object.is(item, previous.deps[i]))) return
    const entry = { deps, cleanup: undefined as (() => void) | undefined }
    hooks.values[index] = entry
    hooks.effects.push(() => { previous?.cleanup?.(); entry.cleanup = effect() || undefined })
  },
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(accept => { resolve = accept })
  return { promise, resolve }
}
function details(id: string) {
  const timeline: NarrativeTimeline = {
    id, promptResourceIds: [], activeBranchId: `${id}-branch`, createdAt: '2026-09-23', updatedAt: '2026-09-23',
  }
  const branch: NarrativeBranch = {
    id: timeline.activeBranchId, timelineId: id, stateHeadRevisionId: `${id}-state`, createdAt: timeline.createdAt, updatedAt: timeline.updatedAt,
  }
  return { timeline, branch, branches: [branch], nodes: [], nextCursor: undefined as string | undefined }
}
function fixture() {
  const requests = new Map<string, ReturnType<typeof deferred<{ timelines: NarrativeTimeline[] }>>>()
  const list = vi.fn(({ createdFromCardId }: { createdFromCardId?: string }) => {
    if (!createdFromCardId) return Promise.resolve({ timelines: [] })
    const request = requests.get(createdFromCardId) ?? deferred<{ timelines: NarrativeTimeline[] }>()
    requests.set(createdFromCardId, request)
    return request.promise
  })
  const get = vi.fn(async (id: string) => details(id))
  const getPage = vi.fn(async ({ timelineId }: { timelineId: string }) => details(timelineId))
  const create = vi.fn(async ({ cardId }: { cardId: string }) => details(`${cardId}-created`))
  const input: Parameters<typeof useNarrativeRuntime>[0] = {
    api: { narratives: { list, get, getPage, create }, agentSessions: { list: async () => ({ sessions: [] }) } } as unknown as StudioApi,
    initialInput: '', onSelectCard: id => { input.selectedCardId = id },
    onSelectAgentProfile: vi.fn(), runAgentAction: action => action(),
    runAction: async action => {
      try { await action(); return true } catch { return false }
    },
    runLatestAction: action => action({ isCurrent: () => true } as never),
  }
  const render = () => {
    hooks.cursor = 0
    const result = useNarrativeRuntime(input)
    for (const effect of hooks.effects.splice(0)) effect()
    return result
  }
  return { input, render, requests, list, get, getPage, create }
}
beforeEach(() => { hooks.cursor = 0; hooks.values = []; hooks.effects = [] })

describe('Card timeline selection', () => {
  it('coalesces an older-page request and ignores its cursor after switching Timeline', async () => {
    const f = fixture()
    f.getPage.mockResolvedValueOnce({ ...details('a'), nextCursor: 'a-older' })
    await f.render().activateTimeline('a')
    const pending = deferred<ReturnType<typeof details>>()
    f.getPage.mockImplementationOnce(() => pending.promise)
    const state = f.render()
    const first = state.loadOlderNodes()
    expect(state.loadOlderNodes()).toBe(first)
    expect(f.getPage).toHaveBeenCalledTimes(2)
    f.getPage.mockResolvedValueOnce({ ...details('b'), nextCursor: 'b-older' })
    await state.activateTimeline('b')
    f.render()
    pending.resolve(details('a'))
    await first
    expect(f.render().timeline?.id).toBe('b')
    expect(f.render().olderCursor).toBe('b-older')
  })

  it('retains the cursor on page failure and permits an explicit retry', async () => {
    const f = fixture()
    f.getPage.mockResolvedValueOnce({ ...details('a'), nextCursor: 'a-older' })
    await f.render().activateTimeline('a')
    f.getPage.mockRejectedValueOnce(new Error('Read failed'))
    await expect(f.render().loadOlderNodes()).rejects.toThrow('Could not load')
    expect(f.render().olderCursor).toBe('a-older')
    f.getPage.mockResolvedValueOnce(details('a'))
    await f.render().loadOlderNodes()
    expect(f.render().olderCursor).toBeUndefined()
  })

  it('shares selection/effect reads and ignores an older Card list that finishes last', async () => {
    const f = fixture()
    const a = f.render().selectCardTimeline('a', true)
    f.render()
    const b = f.render().selectCardTimeline('b', true)
    f.render()
    f.requests.get('b')!.resolve({ timelines: [details('b-timeline').timeline] })
    await expect(b).resolves.toEqual({ timelineId: 'b-timeline', branchId: 'b-timeline-branch' })
    f.requests.get('a')!.resolve({ timelines: [details('a-timeline').timeline] })
    await expect(a).resolves.toBeUndefined()
    const state = f.render()
    expect(state.cardTimelines.map(item => item.id)).toEqual(['b-timeline'])
    expect(state.timeline?.id).toBe('b-timeline')
    expect(f.get.mock.calls).toEqual([['b-timeline']])
    expect(f.list.mock.calls.filter(([args]) => args.createdFromCardId)).toHaveLength(2)
    expect(f.create).not.toHaveBeenCalled()
  })

  it('ignores a Timeline page that resolves after another Card selection', async () => {
    const f = fixture()
    const page = deferred<ReturnType<typeof details>>()
    const pageStarted = deferred<void>()
    f.getPage.mockImplementationOnce(() => { pageStarted.resolve(); return page.promise })
    const a = f.render().selectCardTimeline('a')
    f.render()
    f.requests.get('a')!.resolve({ timelines: [details('a-timeline').timeline] })
    await pageStarted.promise
    const b = f.render().selectCardTimeline('b')
    f.render()
    f.requests.get('b')!.resolve({ timelines: [] })
    await expect(b).resolves.toBeNull()
    page.resolve(details('a-timeline'))
    await expect(a).resolves.toBeUndefined()
    expect(f.render().timeline).toBeUndefined()
    expect(f.render().cardTimelines).toEqual([])
  })

  it('does not activate a completed creation after switching Card', async () => {
    const f = fixture()
    const created = deferred<ReturnType<typeof details>>()
    const createStarted = deferred<void>()
    f.create.mockImplementationOnce(() => { createStarted.resolve(); return created.promise })
    const a = f.render().selectCardTimeline('a', true)
    f.render()
    f.requests.get('a')!.resolve({ timelines: [] })
    await createStarted.promise
    const b = f.render().selectCardTimeline('b')
    f.render()
    f.requests.get('b')!.resolve({ timelines: [] })
    await b
    created.resolve(details('a-created'))
    await expect(a).resolves.toBeUndefined()
    expect(f.render().timeline).toBeUndefined()
  })

  it('does not publish a list from the previous API even when Card IDs match', async () => {
    const f = fixture()
    f.input.selectedCardId = 'same'
    const first = f.render().refreshCardTimelines('same', true)
    const replacementList = vi.fn(async () => ({ timelines: [details('new-server').timeline] }))
    f.input.api = { ...f.input.api, narratives: { ...f.input.api.narratives, list: replacementList } }
    await f.render().refreshCardTimelines('same', true)
    f.requests.get('same')!.resolve({ timelines: [details('old-server').timeline] })
    await first
    expect(f.render().cardTimelines.map(item => item.id)).toEqual(['new-server'])
  })

  it('allows a post-mutation refresh to supersede an older same-Card read', async () => {
    const f = fixture()
    f.input.selectedCardId = 'same'
    const old = f.render().refreshCardTimelines('same', true)
    f.list.mockImplementationOnce(async () => ({ timelines: [details('fresh').timeline] }))
    await f.render().refreshCardTimelines('same')
    f.requests.get('same')!.resolve({ timelines: [details('stale').timeline] })
    await old
    expect(f.render().cardTimelines.map(item => item.id)).toEqual(['fresh'])
  })

  it('does not cancel explicit Timeline navigation when bootstrap selects a default Card', async () => {
    const f = fixture()
    const page = deferred<ReturnType<typeof details>>()
    const started = deferred<void>()
    f.getPage.mockImplementationOnce(() => { started.resolve(); return page.promise })
    const navigation = f.render().activateTimeline('linked')
    await started.promise
    f.input.selectedCardId = 'default'
    f.render()
    f.requests.get('default')!.resolve({ timelines: [] })
    page.resolve(details('linked'))
    await expect(navigation).resolves.toBe('linked-branch')
    expect(f.render().timeline?.id).toBe('linked')
  })

  it.each(['list', 'create'] as const)('ends the loading state after a reported %s failure', async failure => {
    const f = fixture()
    const state = f.render()
    if (failure === 'list') f.list.mockRejectedValueOnce(new Error('Unavailable'))
    else f.create.mockRejectedValueOnce(new Error('Unavailable'))
    const selected = state.selectCardTimeline('a', true)
    f.render()
    if (failure === 'create') f.requests.get('a')!.resolve({ timelines: [] })
    await expect(selected).resolves.toBeUndefined()
    expect(f.render().agentSessionLoading).toBe(false)
    expect(f.render().agentSessionReady).toBe(true)
  })
})
