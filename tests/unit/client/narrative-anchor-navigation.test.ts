import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useNarrativeAnchorNavigation } from '../../../apps/studio-client/src/widgets/narrative-timeline/use-narrative-anchor-navigation.js'

const hooks = vi.hoisted(() => ({
  cursor: 0, values: [] as unknown[], effects: [] as (() => void)[],
}))
vi.mock('react', async importOriginal => {
  const effect = (callback: () => void | (() => void), deps: unknown[]) => {
    const index = hooks.cursor++
    const previous = hooks.values[index] as { deps: unknown[]; cleanup?: () => void } | undefined
    if (previous && deps.every((value, i) => Object.is(value, previous.deps[i]))) return
    const entry = { deps, cleanup: undefined as (() => void) | undefined }
    hooks.values[index] = entry
    hooks.effects.push(() => { previous?.cleanup?.(); entry.cleanup = callback() || undefined })
  }
  return {
    ...await importOriginal<typeof import('react')>(),
    useEffect: effect,
    useLayoutEffect: effect,
    useState: (initial: unknown) => {
      const index = hooks.cursor++
      if (!(index in hooks.values)) hooks.values[index] = initial
      return [hooks.values[index], (value: unknown) => {
        hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value
      }]
    },
    useRef: (initial: unknown) => {
      const index = hooks.cursor++
      if (!(index in hooks.values)) hooks.values[index] = { current: initial }
      return hooks.values[index]
    },
  }
})

beforeEach(() => { hooks.cursor = 0; hooks.values = []; hooks.effects = [] })

function fixture() {
  const onLocate = vi.fn()
  const requests: Array<ReturnType<typeof Promise.withResolvers<void>>> = []
  const load = vi.fn(() => {
    const request = Promise.withResolvers<void>()
    requests.push(request)
    return request.promise
  })
  const input: Parameters<typeof useNarrativeAnchorNavigation>[0] = {
    timelineId: 'timeline-a', nodeId: 'target', nodes: [{ id: 'latest' }],
    hasOlder: true, busy: false, onLoadOlder: load, onLocate,
  }
  const render = () => {
    hooks.cursor = 0
    const status = useNarrativeAnchorNavigation(input)
    for (const effect of hooks.effects.splice(0)) effect()
    return status
  }
  return { input, render, load, requests, onLocate }
}

describe('explicit Narrative anchor history navigation', () => {
  it('loads older pages sequentially, deduplicates rerenders and stops at the exact target', async () => {
    const f = fixture()
    f.input.nodeId = undefined
    expect(f.render()).toBe('idle')
    expect(f.load).not.toHaveBeenCalled()
    f.input.nodeId = 'target'
    expect(f.render()).toBe('loading')
    f.render()
    f.input.onLoadOlder = () => f.load()
    f.render()
    expect(f.load).toHaveBeenCalledTimes(1)
    f.input.nodes = [{ id: 'older' }, ...f.input.nodes]
    f.render()
    expect(f.load).toHaveBeenCalledTimes(1)
    f.requests[0]!.resolve()
    await f.requests[0]!.promise
    expect(f.render()).toBe('loading')
    expect(f.load).toHaveBeenCalledTimes(2)
    f.input.nodes = [{ id: 'target' }, ...f.input.nodes]
    f.requests[1]!.resolve()
    await f.requests[1]!.promise
    expect(f.render()).toBe('located')
    f.render()
    expect(f.onLocate.mock.calls).toEqual([['target']])
    expect(f.load).toHaveBeenCalledTimes(2)
  })

  it('reports exhausted or failed reads without selecting a substitute or retrying the same page', async () => {
    const f = fixture()
    f.render()
    f.requests[0]!.reject(new Error('Read failed'))
    await f.requests[0]!.promise.catch(() => undefined)
    expect(f.render()).toBe('failed')
    f.render()
    expect(f.load).toHaveBeenCalledTimes(1)
    expect(f.onLocate).not.toHaveBeenCalled()
    f.input.nodeId = 'another-target'
    expect(f.render()).toBe('loading')
    expect(f.load).toHaveBeenCalledTimes(2)
    f.input.hasOlder = false
    f.requests[1]!.resolve()
    await f.requests[1]!.promise
    expect(f.render()).toBe('unavailable')
    f.render()
    expect(f.load).toHaveBeenCalledTimes(2)
    expect(f.onLocate).not.toHaveBeenCalled()
  })

  it('isolates changed anchors and Timelines from older completions', async () => {
    const f = fixture()
    f.render()
    f.input.nodeId = 'new-anchor'
    f.render()
    expect(f.load).toHaveBeenCalledTimes(1)
    f.input.nodes = [{ id: 'target' }, ...f.input.nodes]
    f.requests[0]!.resolve()
    await f.requests[0]!.promise
    f.render()
    expect(f.onLocate).not.toHaveBeenCalled()
    expect(f.load).toHaveBeenCalledTimes(2)

    f.input.timelineId = 'timeline-b'
    f.input.nodes = [{ id: 'b-latest' }]
    f.render()
    expect(f.load).toHaveBeenCalledTimes(3)
    f.requests[1]!.reject(new Error('Late failure from timeline-a'))
    await f.requests[1]!.promise.catch(() => undefined)
    expect(f.render()).toBe('loading')
    expect(f.load).toHaveBeenCalledTimes(3)
    expect(f.onLocate).not.toHaveBeenCalled()
    f.input.nodes = [{ id: 'new-anchor' }, ...f.input.nodes]
    f.requests[2]!.resolve()
    await f.requests[2]!.promise
    expect(f.render()).toBe('located')
    expect(f.onLocate.mock.calls).toEqual([['new-anchor']])
  })
})
