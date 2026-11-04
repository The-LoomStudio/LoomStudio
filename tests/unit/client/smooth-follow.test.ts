import { NarrativeExecutionFlow } from '../../../apps/studio-client/src/features/narrative-runtime/ui/narrative-execution-flow.js'
import type { NarrativeSessionExecution } from '../../../apps/studio-client/src/features/narrative-runtime/model/narrative-execution-view.js'
// @vitest-environment happy-dom
import { act, createElement as h, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useSmoothFollow } from '../../../apps/studio-client/src/shared/ui/streaming-viewport/use-smooth-follow.js'

let root: Root
let host: HTMLDivElement
let callbacks: Map<number, FrameRequestCallback>
let observers: ResizeObserverCallback[]
let serial: number
let clock: number
let contentHeight: number
let follow: ReturnType<typeof useSmoothFollow>

function Fixture({ enabled = true }: { enabled?: boolean } = {}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  follow = useSmoothFollow({ scrollRef, contentRef, enabled })
  return h('div', { ref: scrollRef }, h('div', { ref: contentRef }, h('div', { 'data-stream-scroll': '', 'data-inner': '' }, 'nested')))
}

async function frame() {
  await act(async () => {
    const current = [...callbacks.values()]
    callbacks.clear()
    clock += 16
    current.forEach(callback => callback(clock))
  })
}
async function settle() { for (let i = 0; callbacks.size && i < 100; i++) await frame() }
async function resize() { await act(async () => observers.forEach(callback => callback([], {} as ResizeObserver))) }
const viewport = () => host.firstElementChild as HTMLDivElement

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  callbacks = new Map(); observers = []; serial = 0; clock = 0; contentHeight = 800
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.set(++serial, callback); return serial })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id))
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  vi.stubGlobal('ResizeObserver', class { constructor(callback: ResizeObserverCallback) { observers.push(callback) } observe() {} disconnect() {} })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root.render(h(Fixture)))
  Object.defineProperties(viewport(), { scrollHeight: { get: () => contentHeight }, clientHeight: { get: () => 200 } })
  await settle()
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); window.getSelection()?.removeAllRanges(); vi.unstubAllGlobals() })

it('follows measured growth smoothly and stops scheduling frames after settling', async () => {
  expect(viewport().scrollTop).toBeCloseTo(600, 0)
  contentHeight = 1200; await resize(); await frame()
  expect(viewport().scrollTop).toBeGreaterThan(600)
  expect(viewport().scrollTop).toBeLessThan(1000)
  await settle()
  expect(viewport().scrollTop).toBeCloseTo(1000, 0)
  expect(callbacks.size).toBe(0)
})

it('keeps user position through later growth until explicitly resumed', async () => {
  await act(async () => viewport().dispatchEvent(new WheelEvent('wheel', { deltaY: -40, bubbles: true })))
  viewport().scrollTop = 300
  contentHeight = 1400; await resize(); await settle()
  expect(follow.following).toBe(false)
  expect(viewport().scrollTop).toBe(300)
  await act(async () => follow.resume()); await settle()
  expect(viewport().scrollTop).toBeCloseTo(1200, 0)
})

it('does not treat scrolling a nested viewport as outer user movement', async () => {
  await act(async () => host.querySelector('[data-inner]')!.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true })))
  expect(follow.following).toBe(true)
  contentHeight = 1000; await resize(); await settle()
  expect(viewport().scrollTop).toBeCloseTo(800, 0)
})

it('preserves an in-content selection through new output', async () => {
  const range = document.createRange(); range.selectNodeContents(host.querySelector('[data-inner]')!)
  await act(async () => { window.getSelection()!.addRange(range); document.dispatchEvent(new Event('selectionchange')) })
  expect(follow.following).toBe(false)
  const before = viewport().scrollTop
  contentHeight = 1600; await resize(); await settle()
  expect(viewport().scrollTop).toBe(before)
  expect(window.getSelection()!.toString()).toBe('nested')
})

it('cancels a pending animation on unmount', async () => {
  contentHeight = 1800; await resize()
  expect(callbacks.size).toBe(1)
  await act(async () => root.unmount())
  expect(callbacks.size).toBe(0)
})


it('keeps inspected live reasoning open when following prose completes', async () => {
  const inspected = vi.fn()
  const execution: NarrativeSessionExecution = { id: 'writing', preset: 'test', state: 'running', steps: [
    { id: 'thought', kind: 'thinking', title: '思考', content: 'Long thought', state: 'running' },
  ] }
  await act(async () => root.render(h(NarrativeExecutionFlow, { execution, reading: false, followWork: true, onInspect: inspected })))
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="查看工作过程"]')!.click())
  const detail = host.querySelector('[data-work-step="thought"]')!
  await act(async () => detail.querySelector('button')!.click())
  const region = host.querySelector('[aria-label="思考内容"]') as HTMLElement
  await act(async () => region.focus())
  await act(async () => root.render(h(NarrativeExecutionFlow, { execution: { ...execution, state: 'completed', steps: [
    { ...execution.steps[0], state: 'completed' },
    { id: 'body', kind: 'narrative', title: '正文', content: 'The door opens.', state: 'completed' },
  ] }, reading: false, followWork: true, onInspect: inspected })))
  expect(inspected).toHaveBeenCalled()
  expect(host.querySelector('[data-work-step="thought"]')).toBe(detail)
  expect(detail.getAttribute('data-open')).toBe('true')
  expect(host.querySelector('[aria-label="思考内容"]')).toBe(region)
})

it('releases following on upward native scrolling even when no wheel or pointer event reaches the host', async () => {
  // An expanded sandbox iframe, native scrollbar or browser keyboard scroll can
  // move the host without delivering the input event to its DOM listeners.
  await act(async () => {
    viewport().scrollTop = 300
    viewport().dispatchEvent(new Event('scroll'))
  })
  await settle()
  expect(follow.following).toBe(false)
  expect(viewport().scrollTop).toBe(300)
  contentHeight = 1400
  await resize(); await settle()
  expect(viewport().scrollTop).toBe(300)
})

it('keeps following when collapsing content clamps the viewport to its new bottom', async () => {
  await act(async () => {
    contentHeight = 500
    viewport().scrollTop = 300
    viewport().dispatchEvent(new Event('scroll'))
  })
  expect(follow.following).toBe(true)
  await resize(); await settle()
  expect(viewport().scrollTop).toBe(300)
  await act(async () => {
    viewport().scrollTop = 200
    viewport().dispatchEvent(new Event('scroll'))
  })
  expect(follow.following).toBe(false)
})

it('does not mistake its own animated writes for user scrolling', async () => {
  contentHeight = 1200
  await resize(); await frame()
  await act(async () => viewport().dispatchEvent(new Event('scroll')))
  expect(follow.following).toBe(true)
  await settle()
  expect(viewport().scrollTop).toBeCloseTo(1000, 0)
})

it('explicitly reaches the bottom after continuous following has stopped', async () => {
  await act(async () => follow.pause())
  viewport().scrollTop = 100
  await act(async () => root.render(h(Fixture, { enabled: false })))
  await act(async () => follow.resume())
  expect(viewport().scrollTop).toBe(600)
  expect(follow.following).toBe(true)
  expect(callbacks.size).toBe(0)
})
