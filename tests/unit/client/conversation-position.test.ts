// @vitest-environment happy-dom
import { act, createElement, useLayoutEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { readConversationPosition, useConversationPosition, type ConversationPosition } from '../../../apps/studio-client/src/shared/ui/conversation-viewport/conversation-position.js'

const scope = { view: 'timeline' as const, scope: 'endpoint:timeline:branch' }
const snapshot: ConversationPosition = { scope: scope.scope, itemId: 'round', itemOffset: 700, scrollOffset: 719, following: false, anchorId: 'node' }
let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
let rowSize: number
let measured: boolean
let interruptionRef: { current: number }
const scrollToIndex = vi.fn()
function Harness({ initial }: { initial?: ConversationPosition }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const followingRef = useRef(false)
  useLayoutEffect(() => {
    Object.defineProperties(scrollRef.current!, { scrollHeight: { configurable: true, get: () => rowSize + 19 }, clientHeight: { configurable: true, value: 400 } })
  })
  useConversationPosition({ key: scope, initial, active: true, scrollRef, followingRef, interruptionRef, items: [{ id: 'round' }],
    virtualizer: { itemSizeCache: measured ? new Map([['round', rowSize]]) : new Map(), scrollToIndex,
      getVirtualItems: () => [{ index: 0, key: 'round', start: 19, end: 19 + rowSize, size: rowSize }],
    } as unknown as Parameters<typeof useConversationPosition>[0]['virtualizer'],
  })
  return createElement('div', { ref: scrollRef })
}
const render = async (initial?: ConversationPosition) => { await act(async () => root.render(createElement(Harness, { initial }))) }
const viewport = () => host.firstElementChild as HTMLDivElement
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  window.history.replaceState({ idx: 2, key: 'router', usr: { retained: true } }, '')
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  rowSize = 1800; measured = true; interruptionRef = { current: 0 }; scrollToIndex.mockClear()
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })

it('restores a paused reading offset after the iframe row receives its real height', async () => {
  rowSize = 240; measured = false
  await render(snapshot)
  expect(scrollToIndex).toHaveBeenCalledWith(0, { align: 'start' })
  expect(viewport().scrollTop).toBe(0)
  measured = true; await render(snapshot)
  expect(viewport().scrollTop).toBe(0)
  rowSize = 1800; await render(snapshot)
  expect(viewport().scrollTop).toBe(719)
})

it('saves the latest position on refresh without replacing router state or crossing scope', async () => {
  await render()
  viewport().scrollTop = 719
  window.dispatchEvent(new Event('beforeunload'))
  expect(readConversationPosition(scope)).toMatchObject({ itemId: 'round', itemOffset: 700, scrollOffset: 719, following: false })
  expect(window.history.state).toMatchObject({ idx: 2, key: 'router', usr: { retained: true } })
  expect(readConversationPosition({ ...scope, scope: 'other-branch' })).toBeUndefined()
  expect(readConversationPosition({ ...scope, view: 'session' })).toBeUndefined()
})

it('lets a fresh user interaction cancel delayed restoration', async () => {
  rowSize = 240; measured = false
  await render(snapshot)
  viewport().dispatchEvent(new WheelEvent('wheel', { deltaY: -20 }))
  viewport().scrollTop = 35
  rowSize = 1800; measured = true; await render(snapshot)
  expect(viewport().scrollTop).toBe(35)
})


it('cancels deferred restore after native upward scrolling without a host input event', async () => {
  rowSize = 240; measured = false
  await render(snapshot)
  // The actual follow controller increments this when it sees unexpected
  // upward scrollTop movement, even when the input happened inside an iframe.
  interruptionRef.current += 1
  viewport().scrollTop = 35
  rowSize = 1800; measured = true; await render(snapshot)
  expect(viewport().scrollTop).toBe(35)
})
