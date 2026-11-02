// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { swipeTabs, useMobileNavigationGestures, settleDrawer } from '../../../apps/studio-client/src/pages/studio/use-mobile-navigation-gestures.js'

afterEach(() => { document.body.innerHTML = '' })
function scope(parent: Element, active = 0) {
  const node = document.createElement('section')
  node.setAttribute('data-loom-mobile-tab-scope', '')
  node.innerHTML = `<nav data-loom-ui-tabs><button role="tab" aria-selected="${active === 0}">一</button><button role="tab" aria-selected="${active === 1}">二</button></nav><p>内容</p>`
  parent.append(node)
  return node
}
it('changes only primary tabs even when the gesture starts in nested content', () => {
  const outer = scope(document.body)
  const inner = scope(outer)
  const outerClick = vi.fn(), innerClick = vi.fn()
  outer.querySelector('button:last-child')!.addEventListener('click', outerClick)
  inner.querySelector('button:last-child')!.addEventListener('click', innerClick)
  expect(swipeTabs(inner.querySelector('p')!, 'next')).toBe('handled')
  expect(innerClick).not.toHaveBeenCalled()
  expect(outerClick).toHaveBeenCalledOnce()
  expect(swipeTabs(inner.querySelector('p')!, 'previous')).toBe('boundary')
  expect(swipeTabs(outer.querySelector('p')!, 'previous')).toBe('boundary')
})
it('ignores disabled tabs and never wraps at the last tab', () => {
  const node = scope(document.body, 1)
  const click = vi.fn()
  node.querySelector('button')!.addEventListener('click', click)
  expect(swipeTabs(node.querySelector('p')!, 'next')).toBe('handled')
  expect(click).not.toHaveBeenCalled()
  node.querySelector('button')!.disabled = true
  expect(swipeTabs(node.querySelector('p')!, 'previous')).toBe('boundary')
})
it('passes through empty layout scopes but does not guess between peer groups', () => {
  const outer = scope(document.body)
  const empty = document.createElement('div')
  empty.setAttribute('data-loom-mobile-tab-scope', '')
  outer.append(empty)
  expect(swipeTabs(empty, 'previous')).toBe('boundary')
  outer.append(outer.querySelector('nav')!.cloneNode(true))
  expect(swipeTabs(empty, 'previous')).toBe('handled')
})

it('tracks drawer progress without committing until release, and cancels back to its initial state', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const progress = vi.fn(), end = vi.fn(), navigation = vi.fn()
  function Shell() {
    useMobileNavigationGestures(true, navigation, { enabled: true, open: false, onProgress: progress, onEnd: end })
    return createElement('div', { id: 'reading' }, '正文')
  }
  try {
    await act(async () => root.render(createElement(Shell)))
    const target = host.querySelector('#reading')!
    const touch = async (type: string, x: number, time: number) => act(async () => {
      const event = new Event(type, { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'timeStamp', { value: time })
      Object.assign(event, { touches: type === 'touchend' || type === 'touchcancel' ? [] : [{ clientX: x, clientY: 100 }], changedTouches: [{ clientX: x, clientY: 100 }] })
      target.dispatchEvent(event)
    })
    await touch('touchstart', 0, 0)
    await touch('touchmove', innerWidth * 0.3, 500)
    expect(progress).toHaveBeenLastCalledWith(0.3)
    await touch('touchmove', innerWidth * 0.4, 1000)
    expect(progress).toHaveBeenLastCalledWith(0.4)
    expect(end).not.toHaveBeenCalled()
    await touch('touchcancel', innerWidth * 0.4, 1200)
    expect(end).toHaveBeenLastCalledWith(false)
    await touch('touchstart', 0, 2000)
    await touch('touchmove', innerWidth * 0.6, 2500)
    await touch('touchend', innerWidth * 0.6, 3000)
    expect(end).toHaveBeenLastCalledWith(true, 0)
    expect(navigation).not.toHaveBeenCalled()
  } finally {
    await act(async () => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
  }
})

it('settles by recent direction for a fling, otherwise by distance', () => {
  expect(settleDrawer(0.2, 0.8)).toBe(true)
  expect(settleDrawer(0.8, -0.8)).toBe(false)
  expect(settleDrawer(0.3, 0)).toBe(false)
  expect(settleDrawer(0.6, 0)).toBe(true)
})

it('uses the explicitly owned primary tabs from a sibling detail pane in both directions', () => {
  const page = document.createElement('section')
  page.setAttribute('data-loom-mobile-page', '')
  document.body.append(page)
  const master = scope(page, 1)
  master.setAttribute('inert', '')
  master.querySelector('nav')!.outerHTML = `<div data-loom-primary-tabs>${master.querySelector('nav')!.outerHTML}</div>`
  const detail = scope(page)
  const primary = vi.fn(), nested = vi.fn()
  master.querySelector('button')!.addEventListener('click', primary)
  detail.querySelector('button')!.addEventListener('click', nested)
  expect(swipeTabs(detail.querySelector('p')!, 'previous')).toBe('handled')
  expect(primary).toHaveBeenCalledOnce()
  expect(nested).not.toHaveBeenCalled()
  master.querySelectorAll('button').forEach((button, index) => button.setAttribute('aria-selected', String(index === 0)))
  const next = vi.fn()
  master.querySelector('button:last-child')!.addEventListener('click', next)
  swipeTabs(detail.querySelector('p')!, 'next')
  expect(next).toHaveBeenCalledOnce()
})
