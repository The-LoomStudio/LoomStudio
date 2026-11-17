// @vitest-environment happy-dom
import { act, createElement as h, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'
import { useMobileReadingChrome } from '../../../apps/studio-client/src/pages/studio/use-mobile-reading-chrome.js'

let root: Root
let host: HTMLDivElement
let stage: HTMLElement
let scroller: HTMLElement
;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
function Shell({ enabled = true, scope = 'story-a' }) {
  const ref = useRef<HTMLElement>(null)
  useMobileReadingChrome(ref, enabled, scope)
  return h('main', { ref },
    h('header', { 'data-loom-component': 'stage-floating-header' }, h('section', { id: 'story-menu' })),
    h('div', { id: 'reading', style: { overflowY: 'auto' } }, '正文'),
    h('div', { 'data-loom-object': 'agent-composer-layer' }, h('textarea')))
}
async function render(props = {}) {
  if (!root) {
    host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  }
  await act(async () => root.render(h(Shell, props)))
  stage = host.querySelector('main')!
  scroller = host.querySelector('#reading')!
  Object.defineProperties(scroller, { scrollHeight: { configurable: true, value: 1000 }, clientHeight: { configurable: true, value: 200 } })
}
async function touch(type: string, y: number, x = 0) {
  await act(async () => {
    const event = new Event(type, { bubbles: true })
    Object.assign(event, { touches: type === 'touchend' ? [] : [{ clientX: x, clientY: y }] })
    scroller.dispatchEvent(event)
  })
  await new Promise(requestAnimationFrame)
}
async function scrollTo(y: number) {
  await act(async () => {
    scroller.scrollTop = y
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }))
  })
}
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined!
  host?.remove()
  delete document.documentElement.dataset.keyboardOpen
})

it('tracks fractional scroll progress, reverses immediately, and does not snap on touch release', async () => {
  await render()
  await scrollTo(100)
  expect(stage.querySelector<HTMLElement>('header')!.style.getPropertyValue('--loom-mobile-chrome-progress')).toBe('0')
  await scrollTo(116.8)
  expect(Number(stage.querySelector<HTMLElement>('header')!.style.getPropertyValue('--loom-mobile-chrome-progress'))).toBeCloseTo(0.3)
  await scrollTo(122.4)
  expect(Number(stage.querySelector<HTMLElement>('header')!.style.getPropertyValue('--loom-mobile-chrome-progress'))).toBeCloseTo(0.4)
  await scrollTo(118.4)
  expect(Number(stage.querySelector<HTMLElement>('header')!.style.getPropertyValue('--loom-mobile-chrome-progress'))).toBeCloseTo(0.4 - 4 / 56)
  await touch('touchend', 156)
  expect(Number(stage.querySelector<HTMLElement>('header')!.style.getPropertyValue('--loom-mobile-chrome-progress'))).toBeCloseTo(0.4 - 4 / 56)
  await scrollTo(200)
  expect(stage.querySelector<HTMLElement>('header')!.style.getPropertyValue('--loom-mobile-chrome-progress')).toBe('1')
})

it('ignores horizontal gestures and downward overscroll at the bottom', async () => {
  await render()
  await touch('touchstart', 100)
  await touch('touchmove', 60, 80)
  expect(stage.querySelector<HTMLElement>('header')!.style.getPropertyValue('--loom-mobile-chrome-progress')).toBe('0')
  scroller.scrollTop = 800
  await touch('touchstart', 100)
  await touch('touchmove', 40)
  expect(stage.querySelector<HTMLElement>('header')!.style.getPropertyValue('--loom-mobile-chrome-progress')).toBe('0')
})

it('keeps editing and expanded story controls visible', async () => {
  await render()
  await scrollTo(100)
  await scrollTo(128)
  expect(stage.querySelector<HTMLElement>('header')!.style.getPropertyValue('--loom-mobile-chrome-progress')).toBe('0.5')
  await act(async () => host.querySelector('textarea')!.focus())
  await scrollTo(140)
  expect(stage.querySelector<HTMLElement>('header')!.style.getPropertyValue('--loom-mobile-chrome-progress')).toBe('0')
  host.querySelector('textarea')!.blur()
  host.querySelector<HTMLElement>('#story-menu')!.dataset.expanded = 'true'
  await scrollTo(160)
  expect(stage.querySelector<HTMLElement>('header')!.style.getPropertyValue('--loom-mobile-chrome-progress')).toBe('0')
})

it('resets on navigation and stops hiding when mobile reading is disabled', async () => {
  await render()
  await act(async () => scroller.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 28 })))
  await new Promise(requestAnimationFrame)
  expect(stage.querySelector<HTMLElement>('header')!.style.getPropertyValue('--loom-mobile-chrome-progress')).toBe('0.5')
  await render({ scope: 'story-b' })
  expect(stage.querySelector<HTMLElement>('header')!.style.getPropertyValue('--loom-mobile-chrome-progress')).toBe('0')
  await render({ enabled: false })
  await scrollTo(200)
  expect(stage.querySelector<HTMLElement>('header')!.style.getPropertyValue('--loom-mobile-chrome-progress')).toBe('0')
})
