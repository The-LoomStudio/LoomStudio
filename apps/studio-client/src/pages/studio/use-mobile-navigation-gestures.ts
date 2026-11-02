import type { MobileTabPanRequest } from '../../shared/ui/mobile-tab-pages/mobile-tab-pages.js'
import { useEffect, useRef } from 'react'
import { mobileReleaseTarget, mobileResistance } from '@loom-studio/ui'
import type { MobilePagePan, MobilePagePanRequest } from '../../shared/ui/master-detail-workbench/mobile-page-pan.js'

const scopeSelector = '[data-loom-mobile-tab-scope]'
const excluded = 'input, textarea, select, [contenteditable="true"], .cm-editor, pre, [role="slider"], video, audio, canvas, iframe, [role="menu"], [data-mobile-swipe="ignore"]'

/** Swipe the page's primary tabs only; nested tabs remain click-operated. */
type TabAction = { result: 'handled' | 'boundary' | 'none'; commit(): void }
function resolveTabAction(target: Element, direction: 'next' | 'previous'): TabAction {
  const dialog = target.closest('dialog')
  const page = target.closest('[data-loom-mobile-page]')
  const primary = page?.querySelector<HTMLElement>('[data-loom-primary-tabs] [data-loom-ui-tabs]')
  const lists: HTMLElement[] = []
  if (primary && primary.closest('dialog') === dialog) lists.push(primary)
  else {
    const scopes: Element[] = []
    for (let scope = target.closest(scopeSelector); scope && (!dialog || dialog.contains(scope)); scope = scope.parentElement?.closest(scopeSelector) ?? null) scopes.unshift(scope)
    for (const scope of scopes) {
      const owned = [...scope.querySelectorAll<HTMLElement>('[data-loom-ui-tabs]')]
        .filter(list => list.closest(scopeSelector) === scope && !list.closest('[hidden], [inert]') && list.closest('dialog') === dialog && getComputedStyle(list).display !== 'none')
      if (!owned.length) continue
      if (owned.length !== 1) return { result: 'handled', commit() {} }
      lists.push(owned[0]!)
      break
    }
  }
  const list = lists[0]
  if (!list) return { result: 'none', commit() {} }
  const tabs = [...list.querySelectorAll<HTMLButtonElement>('[role="tab"]')].filter(tab => !tab.disabled)
  const index = tabs.findIndex(tab => tab.getAttribute('aria-selected') === 'true')
  if (index < 0) return { result: 'handled', commit() {} }
  const next = tabs[index + (direction === 'next' ? 1 : -1)]
  return { result: next || direction === 'next' ? 'handled' : 'boundary', commit() { next?.click() } }
}
export function swipeTabs(target: Element, direction: 'next' | 'previous') {
  const action = resolveTabAction(target, direction)
  action.commit()
  return action.result
}

type DrawerGesture = {
  enabled: boolean
  open: boolean
  getProgress?(): number
  onProgress(progress: number): void
  onEnd(open: boolean, velocity?: number): void
}

export function settleDrawer(progress: number, velocity: number): boolean {
  return mobileReleaseTarget(progress, 1, velocity)
}

export function useMobileNavigationGestures(enabled: boolean, onNavigation: () => void, drawer?: DrawerGesture) {
  const latest = useRef(onNavigation)
  latest.current = onNavigation
  const drawerRef = useRef(drawer)
  drawerRef.current = drawer
  useEffect(() => {
    if (!enabled) return
    let start: { x: number; y: number; target: Element; time: number } | undefined
    let suppressClickUntil = 0
    const suppressSwipeClick = (event: MouseEvent) => {
      if (event.detail !== 0 && Date.now() < suppressClickUntil) { event.preventDefault(); event.stopImmediatePropagation() }
    }
    let pagePan: MobilePagePan | undefined
    let tabAction: TabAction | undefined
    let lastX = 0, lastTime = 0, velocity = 0
    let horizontal = false
    let drag: { initialOpen: boolean; initialProgress: number; progress: number; width: number; lastX: number; lastTime: number; velocity: number } | undefined
    const cancel = () => {
      if (drag) drawerRef.current?.onEnd(drag.initialOpen)
      pagePan?.cancel()
      pagePan = undefined
      tabAction = undefined
      drag = undefined
      reset()
    }
    const reset = () => { start = undefined; horizontal = false }
    const begin = (event: TouchEvent) => {
      cancel()
      if (event.touches.length !== 1 || !(event.target instanceof Element) || event.target.closest(excluded) || window.getSelection()?.toString()) return
      for (let node: Element | null = event.target; node; node = node.parentElement) {
        if (node.scrollWidth > node.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(node).overflowX)) return
      }
      start = { x: event.touches[0]!.clientX, y: event.touches[0]!.clientY, target: event.target, time: event.timeStamp }
    }
    const move = (event: TouchEvent) => {
      if (!start || event.touches.length !== 1) { cancel(); return }
      const dx = event.touches[0]!.clientX - start.x
      const dy = event.touches[0]!.clientY - start.y
      if (!horizontal) {
        if (Math.abs(dy) > 12 && Math.abs(dy) >= Math.abs(dx)) { reset(); return }
        if (Math.abs(dx) < 16 || Math.abs(dx) < Math.abs(dy) * 1.5) return
        horizontal = true
        lastX = start.x; lastTime = start.time; velocity = 0
        if (dx > 0) {
          const request: MobilePagePanRequest = {}
          start.target.dispatchEvent(new CustomEvent('loom:mobile-page-pan', { bubbles: true, detail: request }))
          pagePan = request.controller
        }
        if (!pagePan) {
          const request: MobileTabPanRequest = { direction: dx < 0 ? 'next' : 'previous' }
          start.target.dispatchEvent(new CustomEvent('loom:mobile-tab-pan', { bubbles: true, detail: request }))
          pagePan = request.controller
          tabAction = request.boundary !== undefined
            ? { result: request.boundary ? 'boundary' : 'handled', commit() {} }
            : resolveTabAction(start.target, dx < 0 ? 'next' : 'previous')
        }
        const candidate = drawerRef.current
        if (!pagePan && candidate?.enabled && (candidate.open || tabAction?.result !== 'handled') && !start.target.closest('dialog') && (candidate.open ? dx < 0 : dx > 0)) {
          drag = { initialOpen: candidate.open, initialProgress: candidate.getProgress?.() ?? (candidate.open ? 1 : 0), progress: candidate.open ? 1 : 0, width: window.innerWidth, lastX: start.x, lastTime: start.time, velocity: 0 }
        }
      }
      if (event.cancelable) event.preventDefault()
      const nextX = event.touches[0]!.clientX
      if (event.timeStamp > lastTime) velocity = (nextX - lastX) / (event.timeStamp - lastTime)
      lastX = nextX; lastTime = event.timeStamp
      if (pagePan) pagePan.move(dx)
      if (drag) {
        const x = event.touches[0]!.clientX
        const elapsed = event.timeStamp - drag.lastTime
        if (elapsed > 0) drag.velocity = (x - drag.lastX) / elapsed
        drag.lastX = x
        drag.lastTime = event.timeStamp
        drag.progress = mobileResistance(drag.initialProgress * drag.width + dx, 0, drag.width) / drag.width
        drawerRef.current?.onProgress(drag.progress)
      }
    }
    const end = (event: TouchEvent) => {
      if (horizontal) suppressClickUntil = Date.now() + 400
      if (pagePan) {
        pagePan.end(event.timeStamp - lastTime > 120 ? 0 : velocity)
        pagePan = undefined
        tabAction = undefined
        reset()
        return
      }
      if (drag && start) {
        const velocity = event.timeStamp - drag.lastTime > 120 ? 0 : drag.velocity
        drawerRef.current?.onEnd(settleDrawer(drag.progress, velocity), velocity)
        drag = undefined
        reset()
        return
      }
      if (start && horizontal && event.changedTouches.length) {
        const dx = event.changedTouches[0]!.clientX - start.x
        if (Math.abs(dx) >= 56) {
          const result = tabAction?.result ?? 'none'
          tabAction?.commit()
          if (dx > 0 && result !== 'handled') {
            const unhandled = start.target.dispatchEvent(new Event('loom:mobile-back', { bubbles: true, cancelable: true }))
            if (unhandled && !start.target.closest('dialog')) latest.current()
          }
        }
      }
      reset()
    }
    document.addEventListener('click', suppressSwipeClick, true)
    document.addEventListener('touchstart', begin, { passive: true })
    document.addEventListener('touchmove', move, { passive: false })
    document.addEventListener('touchend', end)
    document.addEventListener('touchcancel', cancel)
    return () => {
      pagePan?.cancel()
      document.removeEventListener('click', suppressSwipeClick, true)
      document.removeEventListener('touchstart', begin)
      document.removeEventListener('touchmove', move)
      document.removeEventListener('touchend', end)
      document.removeEventListener('touchcancel', cancel)
    }
  }, [enabled])
}
