// @vitest-environment happy-dom
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
const { Virtualizer } = createRequire(resolve('apps/studio-client/package.json'))('@tanstack/react-virtual')
import { expect, it, vi } from 'vitest'
import { measureFileTreeElement, observeFileTreeOffset } from '../../../apps/studio-client/src/shared/ui/file-tree/file-tree-virtual-scroll.js'

it('reconciles a silently clamped offset when a kept-alive viewport becomes visible', () => {
  let resize!: ResizeObserverCallback
  const disconnect = vi.fn()
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { resize = callback }
    observe() {}
    disconnect = disconnect
  })
  const element = document.createElement('div')
  let height = 100
  Object.defineProperty(element, 'clientHeight', { get: () => height })
  element.scrollTop = 500
  const virtualizer = new Virtualizer({
    count: 100,
    getScrollElement: () => element,
    estimateSize: () => 40,
    initialOffset: 500,
    scrollToFn: () => {},
    observeElementRect: (_instance: unknown, callback: (rect: { width: number; height: number }) => void) => { callback({ width: 200, height: 100 }) },
    observeElementOffset: observeFileTreeOffset,
    measureElement: measureFileTreeElement,
  })
  const unmount = virtualizer._didMount()
  try {
    virtualizer._willUpdate()
    expect(virtualizer.getVirtualItems()[0]?.index).toBeGreaterThan(0)
    const row = document.createElement('div')
    row.dataset.index = '0'
    const readRects = vi.spyOn(row, 'getClientRects')
    const readHeight = vi.spyOn(row, 'offsetHeight', 'get')
    expect(measureFileTreeElement(row, undefined, virtualizer)).toBe(40)
    expect(readRects).not.toHaveBeenCalled()
    expect(readHeight).not.toHaveBeenCalled()
    virtualizer.resizeItem(0, 40)
    const hiddenEntry = { borderBoxSize: [{ blockSize: 0, inlineSize: 200 }] } as unknown as ResizeObserverEntry
    expect(measureFileTreeElement(row, hiddenEntry, virtualizer)).toBe(40)
    height = 0
    element.scrollTop = 0 // Hiding/clamping does not always dispatch a scroll event.
    resize([], {} as ResizeObserver)
    height = 100
    resize([], {} as ResizeObserver)
    expect(virtualizer.getVirtualItems()[0]?.index).toBe(0)
  } finally {
    unmount()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  }
  expect(disconnect).toHaveBeenCalled()
})
