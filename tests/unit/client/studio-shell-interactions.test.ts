// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { StudioPage } from '../../../apps/studio-client/src/pages/studio/studio-page.js'
import { StudioPanelRight } from '../../../apps/studio-client/src/pages/studio/studio-panel-right.js'
import { STUDIO_PANEL_IDS, useStudioLayoutStore } from '../../../apps/studio-client/src/shared/studio-shell/studio-layout-store.js'

let root: Root
let host: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 700 })
  document.documentElement.dataset.loomMotion = 'reduce'
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  useStudioLayoutStore.setState({ dockPinned: false, panelWindowMode: 'reference' })
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})
function props(panel: 'logs' | null = null) {
  const closePanel = vi.fn(), togglePanel = vi.fn()
  const navigation = { route: { panel }, closePanel, togglePanel, historyAction: 'POP', closeTool: vi.fn(), returnToReading: vi.fn() }
  return {
    overlaysReady: false, navigation, assetWorkspaceId: 'test', busy: false, canRedo: false, canUndo: false,
    canvas: createElement('button', { id: 'canvas-action' }, 'canvas'), agentPanel: createElement('button', { id: 'session-action' }, 'session'),
    panels: Object.fromEntries(STUDIO_PANEL_IDS.map(id => [id, () => null])), t: (key: string) => key,
    onRedo: vi.fn(), onUndo: vi.fn(), onOpenDashboard: vi.fn(), onOpenSearch: vi.fn(), onClearSearch: vi.fn(),
  } as unknown as ComponentProps<typeof StudioPage>
}
async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}
async function resize(width: number) {
  await act(async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
    window.dispatchEvent(new Event('resize'))
  })
}
it('closes the mobile drawer across a desktop breakpoint and can reopen it', async () => {
  await act(async () => root.render(createElement(StudioPage, props())))
  await click(host.querySelector('[title="rail.label"]')!)
  expect(host.querySelector('[data-mobile-drawer]')!.getAttribute('data-open')).toBe('true')
  await resize(1000)
  await resize(700)
  const drawer = host.querySelector<HTMLElement>('[data-mobile-drawer]')!
  expect(drawer.getAttribute('data-open')).toBe('false')
  await click(host.querySelector('[title="rail.label"]')!)
  expect(drawer.style.getPropertyValue('--loom-mobile-drawer-progress')).toBe('1')
})
it('clears an unfinished drawer drag when switching to desktop', async () => {
  await act(async () => root.render(createElement(StudioPage, props())))
  const canvas = host.querySelector('#canvas-action')!
  await act(async () => {
    for (const [type, x] of [['touchstart', 0], ['touchmove', 200]] as const) {
      const event = new Event(type, { bubbles: true, cancelable: true })
      Object.assign(event, { touches: [{ clientX: x, clientY: 100 }] })
      canvas.dispatchEvent(event)
    }
  })
  expect(host.querySelector('[data-mobile-drawer]')!.getAttribute('data-mobile-drawer-dragging')).toBe('true')
  await resize(1000)
  await resize(700)
  expect(host.querySelector('[data-mobile-drawer]')!.getAttribute('data-open')).toBe('false')
  expect(host.querySelector('[data-mobile-drawer]')!.getAttribute('data-mobile-drawer-dragging')).toBeNull()
})
it('allows mobile navigation clicks and Escape closes only its drawer', async () => {
  const input = props('logs')
  await act(async () => root.render(createElement(StudioPage, input)))
  await click(host.querySelector('[aria-controls="studio-mobile-navigation"]')!)
  await click(host.querySelector('[data-mobile-drawer] [aria-controls="studio-resource-panel"]')!)
  expect(input.navigation.togglePanel).toHaveBeenCalledWith('resource')
  expect(input.navigation.closePanel).not.toHaveBeenCalled()
  await act(async () => host.querySelector('[data-mobile-drawer] button')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
  expect(host.querySelector('[data-mobile-drawer]')!.getAttribute('data-open')).toBe('false')
  expect(input.navigation.closePanel).not.toHaveBeenCalled()
})
it('lets Session controls receive clicks while preserving canvas dismissal', async () => {
  await resize(1000)
  const input = props('logs'), sessionClick = vi.fn()
  input.agentPanelOpen = true
  input.agentPanel = createElement('button', { id: 'session-action', onClick: sessionClick }, 'session')
  await act(async () => root.render(createElement(StudioPage, input)))
  await click(host.querySelector('#session-action')!)
  expect(sessionClick).toHaveBeenCalledOnce()
  expect(input.navigation.closePanel).not.toHaveBeenCalled()
  await click(host.querySelector('#canvas-action')!)
  expect(input.navigation.closePanel).toHaveBeenCalledOnce()
})
it.each(['pointercancel', 'lostpointercapture'])('supports side-panel keyboard resizing and stops after %s', async cancellation => {
  await resize(1000)
  const onWidthChange = vi.fn()
  await act(async () => root.render(createElement(StudioPanelRight, { open: true, width: 420, onClose: vi.fn(), onWidthChange, children: null })))
  const handle = host.querySelector<HTMLElement>('[role="separator"]')!
  handle.setPointerCapture = vi.fn()
  handle.releasePointerCapture = vi.fn()
  handle.focus()
  expect(document.activeElement).toBe(handle)
  for (const [key, width] of [['ArrowLeft', 436], ['ArrowRight', 404], ['Home', 320], ['End', 838]] as const) {
    await act(async () => handle.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })))
    expect(onWidthChange).toHaveBeenLastCalledWith(width)
  }
  await act(async () => {
    handle.dispatchEvent(new MouseEvent('pointerdown', { clientX: 500, bubbles: true }))
    handle.dispatchEvent(new MouseEvent('pointermove', { clientX: 480, bubbles: true }))
  })
  expect(onWidthChange).toHaveBeenLastCalledWith(440)
  await act(async () => handle.dispatchEvent(new MouseEvent(cancellation, { bubbles: true })))
  onWidthChange.mockClear()
  await act(async () => handle.dispatchEvent(new MouseEvent('pointermove', { clientX: 450, bubbles: true })))
  expect(onWidthChange).not.toHaveBeenCalled()
})
