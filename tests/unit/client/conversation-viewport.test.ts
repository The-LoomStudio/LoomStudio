import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useConversationViewport } from '../../../apps/studio-client/src/shared/ui/conversation-viewport/use-conversation-viewport.js'

const hooks = vi.hoisted(() => ({
  cursor: 0,
  slots: [] as unknown[],
  effects: [] as (() => void | (() => void))[],
  options: undefined as Record<string, any> | undefined,
  resize: [] as (() => void)[],
}))
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useRef: (initial: unknown) => {
    const index = hooks.cursor++
    hooks.slots[index] ??= { current: initial }
    return hooks.slots[index]
  },
  useState: (initial: unknown) => {
    const index = hooks.cursor++
    hooks.slots[index] ??= initial
    return [hooks.slots[index], (value: unknown) => { hooks.slots[index] = value }]
  },
  useCallback: (callback: unknown) => callback,
  useMemo: (factory: () => unknown) => factory(),
  useLayoutEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect) },
}))
vi.mock('../../../apps/studio-client/node_modules/@tanstack/react-virtual/dist/esm/index.js', async original => ({
  ...await original<Record<string, unknown>>(),
  useVirtualizer: (options: Record<string, unknown>) => {
    hooks.options = options
    return {}
  },
}))

function render(options: Parameters<typeof useConversationViewport>[0]) {
  hooks.cursor = 0
  return useConversationViewport(options)
}
beforeEach(() => {
  hooks.slots = []
  hooks.effects = []
  hooks.resize = []
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { hooks.resize.push(callback) }
    observe() {}
    disconnect() {}
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('shared conversation viewport contract (no browser layout)', () => {
  it('uses stable IDs and pins an edited row outside the visible range', () => {
    render({ items: Array.from({ length: 20 }, (_, i) => ({ id: `node-${i}` })), pinnedId: 'node-17', overscan: 2 })
    expect(hooks.options?.getItemKey(17)).toBe('node-17')
    expect(hooks.options?.useFlushSync).toBe(false)
    expect(hooks.options?.rangeExtractor({ startIndex: 2, endIndex: 4, overscan: 2, count: 20 })).toEqual([0, 1, 2, 3, 4, 5, 6, 17])
  })

  it('starts anchor navigation without automatic following', () => {
    const viewport = render({ items: [{ id: 'anchor' }], followInitially: false })
    expect(viewport.smooth.followingRef.current).toBe(false)
  })
})

it('gives smooth following sole ownership of the bottom instead of stacking virtualizer end anchoring', () => {
  render({ items: [{ id: 'stream' }] })
  expect(hooks.options?.anchorTo).toBe('start')
  expect(hooks.options?.followOnAppend).toBe(false)
})

it('anchors history above the viewport and gives bottom following sole ownership of resize scrolls', () => {
  const viewport = render({ items: [{ id: 'round' }], anchorReadingPosition: true })
  const cleanups = hooks.effects.map(effect => effect())
  viewport.scrollRef.current = { scrollTop: 200 } as HTMLDivElement
  const shouldAdjust = viewport.virtualizer.shouldAdjustScrollPositionOnItemSizeChange!
  const row = { index: 0, key: 'round', start: 100, end: 210, size: 110, lane: 0 }
  viewport.virtualizer.scrollOffset = 220
  expect(shouldAdjust(row, 100, viewport.virtualizer)).toBe(false)
  viewport.smooth.pause()
  expect(shouldAdjust(row, 100, viewport.virtualizer)).toBe(true)
  expect(shouldAdjust({ ...row, end: 230 }, 100, viewport.virtualizer)).toBe(false)
  for (const cleanup of cleanups) cleanup?.()
})
