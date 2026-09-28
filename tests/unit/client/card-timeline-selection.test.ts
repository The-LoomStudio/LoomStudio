import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useNarrativeRuntime } from '../../../apps/studio-client/src/features/narrative-runtime/model/use-narrative-runtime.js'
import type { StudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'
import type { AgentSession, NarrativeBranch, NarrativeNode, NarrativeTimeline } from '../../../apps/studio-client/src/entities/index.js'

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
    id: timeline.activeBranchId, timelineId: id, createdAt: timeline.createdAt, updatedAt: timeline.updatedAt,
  }
  return { timeline, branch, branches: [branch], nodes: [], nextCursor: undefined as string | undefined }
}
function session(id: string, title = id): AgentSession {
  return { id, title, agentPresetId: 'profile', entryCount: 0, createdAt: '2026-09-23', updatedAt: '2026-09-23' }
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
  const listSessions = vi.fn<StudioApi['agentSessions']['list']>(async () => ({ sessions: [] }))
  const deleteSession = vi.fn<StudioApi['agentSessions']['delete']>(async () => ({ deleted: true, mutation: { changesetId: 'delete' } }))
  const updateSession = vi.fn<StudioApi['agentSessions']['update']>(async input => ({
    session: session(input.agentSessionId, input.title), mutation: { changesetId: 'update' },
  }))
  const deleteTimeline = vi.fn<StudioApi['narratives']['delete']>(async () => ({ deleted: true, mutation: { changesetId: 'delete' } }))
  const input: Parameters<typeof useNarrativeRuntime>[0] = {
    api: {
      narratives: { list, get, getPage, create, delete: deleteTimeline },
      agentSessions: { list: listSessions, delete: deleteSession, update: updateSession },
    } as unknown as StudioApi,
    initialInput: '', onSelectCard: id => { input.selectedCardId = id },
    onSelectAgentPreset: vi.fn(), runAgentAction: action => action(),
    runAction: async action => {
      try { await action(); return true } catch { return false }
    },
    runLatestAction: action => action({ isCurrent: () => true } as never),
  }
  const render = () => {
    hooks.cursor = 0
    const result = useNarrativeRuntime({ ...input })
    for (const effect of hooks.effects.splice(0)) effect()
    return result
  }
  return { input, render, requests, list, get, getPage, create, listSessions, deleteSession, updateSession }
}
beforeEach(() => { hooks.cursor = 0; hooks.values = []; hooks.effects = [] })

describe('Card timeline selection', () => {
  it.each(['delete', 'rename'] as const)('does not replace the current Timeline after a late %s', async operation => {
    const f = fixture()
    await f.render().activateTimeline('old')
    const pending = deferred<void>()
    f.input.api.narratives.delete = vi.fn<StudioApi['narratives']['delete']>(async () => {
      await pending.promise
      return { deleted: true, mutation: { changesetId: 'delete' } }
    })
    f.input.api.narratives.update = vi.fn(async () => {
      await pending.promise
      return { timeline: { ...details('old').timeline, title: 'Renamed' }, mutation: { changesetId: 'rename' } }
    })
    const old = f.render()
    const request = operation === 'delete' ? old.deleteTimeline('old') : old.renameTimeline('old', 'Renamed')
    await f.render().activateTimeline('new')
    f.render().setInput('Keep new draft')
    pending.resolve()
    const result = await request
    expect(result).toEqual(operation === 'delete' ? true : { ...details('old').timeline, title: 'Renamed' })
    const current = f.render()
    expect(current.timeline?.id).toBe('new')
    expect(current.branch?.id).toBe('new-branch')
    expect(current.composerInput).toBe('Keep new draft')
  })

  it('keeps the active branch when a rename returns an older Timeline snapshot', async () => {
    const f = fixture()
    await f.render().activateTimeline('current')
    const pending = deferred<void>()
    f.input.api.narratives.update = vi.fn(async () => {
      await pending.promise
      return { timeline: { ...details('current').timeline, title: 'Renamed' }, mutation: { changesetId: 'rename' } }
    })
    const request = f.render().renameTimeline('current', 'Renamed')
    const target = { ...details('current').branch, id: 'new-branch' }
    const switched = { ...details('current').timeline, activeBranchId: target.id }
    f.input.api.narratives.switch = vi.fn().mockResolvedValue({ timeline: switched })
    f.getPage.mockResolvedValueOnce({ ...details('current'), timeline: switched, branch: target })
    await f.render().switchBranch(target)
    pending.resolve()
    await request
    const current = f.render()
    expect(current.timeline?.title).toBe('Renamed')
    expect(current.timeline?.activeBranchId).toBe(target.id)
    expect(current.branch?.id).toBe(target.id)
  })

  it.each(['fork', 'switch'] as const)('publishes a completed branch %s while its selection is current', async operation => {
    const f = fixture()
    await f.render().activateTimeline('current')
    const target = { ...details('current').branch, id: 'target-branch' }
    const switched = { ...details('current').timeline, activeBranchId: target.id }
    f.input.api.narratives.fork = vi.fn().mockResolvedValue({ branch: target })
    f.input.api.narratives.switch = vi.fn().mockResolvedValue({ timeline: switched })
    f.getPage.mockResolvedValueOnce({ ...details('current'), timeline: switched, branch: target })
    const current = f.render()
    const result = operation === 'fork'
      ? await current.forkFromNode({ id: 'node', timelineId: 'current' } as NarrativeNode)
      : await current.switchBranch(target)
    expect(result).toEqual(operation === 'fork' ? { timelineId: 'current', branchId: target.id } : undefined)
    expect(f.render().branch?.id).toBe(target.id)
    expect(f.render().timeline?.activeBranchId).toBe(target.id)
  })

  it.each(['fork', 'switch'] as const)('does not publish a late branch %s over another Timeline', async operation => {
    const f = fixture()
    await f.render().activateTimeline('old')
    const old = f.render()
    const target = { ...details('old').branch, id: 'target-branch' }
    const switched = { ...details('old').timeline, activeBranchId: target.id }
    const pending = deferred<void>()
    const pageStarted = deferred<void>()
    f.input.api.narratives.fork = vi.fn().mockResolvedValue({ branch: target })
    f.input.api.narratives.switch = vi.fn().mockResolvedValue({ timeline: switched })
    f.getPage.mockImplementationOnce(async () => {
      pageStarted.resolve()
      await pending.promise
      return { ...details('old'), timeline: switched, branch: target }
    })
    const result = operation === 'fork'
      ? old.forkFromNode({ id: 'node', timelineId: 'old' } as NarrativeNode)
      : old.switchBranch(target)
    await pageStarted.promise
    await f.render().activateTimeline('new')
    f.render().setInput('New Timeline draft')
    pending.resolve()
    expect(await result).toBeUndefined()
    const current = f.render()
    expect(current.timeline?.id).toBe('new')
    expect(current.branch?.id).toBe('new-branch')
    expect(current.composerInput).toBe('New Timeline draft')
    expect(current.branches.map(branch => branch.id)).toEqual(['new-branch'])
  })

  it.each(['timelines', 'sessions'] as const)('keeps the latest full %s refresh when an older read finishes last', async kind => {
    const f = fixture()
    const state = f.render()
    const pending = deferred<void>()
    if (kind === 'timelines') {
      f.list.mockImplementationOnce(async () => { await pending.promise; return { timelines: [details('old').timeline] } })
    } else {
      f.listSessions.mockImplementationOnce(async () => { await pending.promise; return { sessions: [session('old')] } })
    }
    const old = kind === 'timelines' ? state.refreshAllTimelines() : state.refreshAllAgentSessions()
    if (kind === 'timelines') {
      f.list.mockResolvedValueOnce({ timelines: [details('new').timeline] })
      await state.refreshAllTimelines()
    } else {
      f.listSessions.mockResolvedValueOnce({ sessions: [session('new')] })
      await state.refreshAllAgentSessions()
    }
    pending.resolve()
    await old
    const current = f.render()
    expect((kind === 'timelines' ? current.allTimelines : current.allAgentSessions).map(item => item.id)).toEqual(['new'])
  })

  it.each(['timelines', 'sessions'] as const)('hides and rejects old-API full %s results', async kind => {
    const f = fixture()
    const state = f.render()
    f.list.mockResolvedValueOnce({ timelines: [details('same').timeline] })
    f.listSessions.mockResolvedValueOnce({ sessions: [session('same')] })
    await state.refreshAllTimelines()
    await state.refreshAllAgentSessions()
    const pending = deferred<void>()
    if (kind === 'timelines') f.list.mockImplementationOnce(async () => { await pending.promise; return { timelines: [details('old-api').timeline] } })
    else f.listSessions.mockImplementationOnce(async () => { await pending.promise; return { sessions: [session('old-api')] } })
    const old = kind === 'timelines' ? state.refreshAllTimelines() : state.refreshAllAgentSessions()
    f.input.api = {
      ...f.input.api,
      narratives: { ...f.input.api.narratives, list: async () => ({ timelines: [details('new-api').timeline] }) },
      agentSessions: { ...f.input.api.agentSessions, list: async () => ({ sessions: [session('new-api')] }) },
    }
    const next = f.render()
    expect(kind === 'timelines' ? next.allTimelines : next.allAgentSessions).toEqual([])
    if (kind === 'timelines') await next.refreshAllTimelines()
    else await next.refreshAllAgentSessions()
    pending.resolve()
    await old
    const current = f.render()
    expect((kind === 'timelines' ? current.allTimelines : current.allAgentSessions).map(item => item.id)).toEqual(['new-api'])
  })

  it.each(['delete', 'rename'] as const)('does not let a pending Session list undo a committed %s', async action => {
    const f = fixture()
    const state = f.render()
    f.listSessions.mockResolvedValueOnce({ sessions: [session('same')] })
    await state.refreshAllAgentSessions()
    const pending = deferred<void>()
    f.listSessions.mockImplementationOnce(async () => { await pending.promise; return { sessions: [session('same')] } })
    const old = state.refreshAllAgentSessions()
    if (action === 'delete') await state.deleteAgentSession('same')
    else await state.renameAgentSession('same', 'Renamed')
    f.listSessions.mockResolvedValueOnce({ sessions: action === 'delete' ? [] : [session('same', 'Renamed')] })
    pending.resolve()
    await old
    expect(f.render().allAgentSessions).toEqual(action === 'delete' ? [] : [session('same', 'Renamed')])
  })

  it('finishes the initial full Session list after a concurrent deletion without losing other records', async () => {
    const f = fixture()
    const state = f.render()
    const pending = deferred<void>()
    f.listSessions.mockImplementationOnce(async () => { await pending.promise; return { sessions: [session('deleted'), session('other')] } })
    const first = state.refreshAllAgentSessions()
    await state.deleteAgentSession('deleted')
    f.listSessions.mockResolvedValueOnce({ sessions: [session('other')] })
    pending.resolve()
    await first
    expect(f.render().allAgentSessions.map(item => item.id)).toEqual(['other'])
  })

  it.each(['delete', 'rename'] as const)('does not publish a late Session %s into another API with the same ID', async action => {
    const f = fixture()
    const state = f.render()
    const pending = deferred<void>()
    if (action === 'delete') f.deleteSession.mockImplementationOnce(async () => {
      await pending.promise
      return { deleted: true, mutation: { changesetId: 'delete' } }
    })
    else f.updateSession.mockImplementationOnce(async () => {
      await pending.promise
      return { session: session('same', 'Old API rename'), mutation: { changesetId: 'rename' } }
    })
    const mutation = action === 'delete' ? state.deleteAgentSession('same') : state.renameAgentSession('same', 'Old API rename')
    f.input.api = {
      ...f.input.api,
      agentSessions: { ...f.input.api.agentSessions, list: async () => ({ sessions: [session('same', 'New API')] }) },
    }
    await f.render().refreshAllAgentSessions()
    pending.resolve()
    expect(await mutation).toBe(action === 'delete' ? false : undefined)
    expect(f.render().allAgentSessions).toEqual([session('same', 'New API')])
  })

  it('keeps a committed Timeline deletion when the follow-up refresh fails', async () => {
    const f = fixture()
    const state = f.render()
    f.list.mockResolvedValueOnce({ timelines: [details('deleted').timeline] })
    await state.refreshAllTimelines()
    f.list.mockRejectedValueOnce(new Error('Refresh unavailable'))
    await expect(state.deleteTimeline('deleted')).resolves.toBe(true)
    expect(f.render().allTimelines).toEqual([])
  })

  it('returns the committed Timeline when its follow-up list refresh fails', async () => {
    const f = fixture()
    const state = f.render()
    f.list.mockRejectedValueOnce(new Error('Refresh unavailable'))
    await expect(state.createTimelineFromCard('a')).resolves.toEqual({
      timelineId: 'a-created', branchId: 'a-created-branch',
    })
    expect(f.render().timeline?.id).toBe('a-created')
    expect(f.create).toHaveBeenCalledOnce()
  })

  it('does not return a committed Timeline after selection changes during refresh', async () => {
    const f = fixture()
    const state = f.render()
    const refresh = deferred<{ timelines: NarrativeTimeline[] }>()
    const started = deferred<void>()
    f.list.mockImplementationOnce(() => { started.resolve(); return refresh.promise })
    const created = state.createTimelineFromCard('a')
    await started.promise
    await f.render().activateTimeline('b')
    refresh.resolve({ timelines: [details('a-created').timeline] })
    await expect(created).resolves.toBeUndefined()
    expect(f.render().timeline?.id).toBe('b')
  })

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
