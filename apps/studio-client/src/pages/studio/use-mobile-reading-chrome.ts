import { useEffect, type RefObject } from 'react'

const editing = 'input, textarea, select, [contenteditable="true"], .cm-editor'
const controls = '[data-loom-component="stage-floating-header"], [data-loom-object="agent-composer-layer"]'

/** Only deliberate reading gestures affect chrome; streaming/restoration scrolls do not. */
export function useMobileReadingChrome(stageRef: RefObject<HTMLElement | null>, enabled: boolean, scope: string) {
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const shell = stage.closest<HTMLElement>('[data-loom-object="studio-shell"]') ?? stage
    let progress = 0
    const surfaces = [...stage.querySelectorAll<HTMLElement>('[data-loom-component="stage-floating-header"], [data-loom-object="agent-composer-layer"]')]
    let frame: number | undefined
    const paint = () => {
      frame = undefined
      for (const surface of surfaces) surface.style.setProperty('--loom-mobile-chrome-progress', String(progress))
      const hidden = String(progress === 1)
      if (shell.dataset.mobileChromeHidden !== hidden) shell.dataset.mobileChromeHidden = hidden
    }
    const setProgress = (next: number | ((current: number) => number)) => {
      progress = typeof next === 'function' ? next(progress) : next
      if (typeof next === 'number') {
        if (frame !== undefined) cancelAnimationFrame(frame)
        paint()
      } else if (frame === undefined) frame = requestAnimationFrame(paint)
    }
    setProgress(0)
    if (!enabled) return
    let scroller: HTMLElement | undefined
    let point: { x: number; y: number } | undefined
    let axis: 'x' | 'y' | undefined

    const reset = () => { scroller = undefined; point = undefined; axis = undefined }
    const reveal = () => { reset(); setProgress(0) }
    const locked = () => document.documentElement.dataset.keyboardOpen === 'true'
      || Boolean(document.querySelector('dialog[open]'))
      || Boolean(stage.querySelector('[data-loom-object="agent-composer-layer"] [aria-expanded="true"]'))
      || Boolean(stage.querySelector('[data-loom-component="stage-floating-header"] [data-expanded="true"]'))
      || Boolean(document.activeElement instanceof Element && document.activeElement.closest(editing))
      || Boolean(window.getSelection()?.toString())

    function findScroller(target: EventTarget | null): HTMLElement | undefined {
      if (!(target instanceof Element) || target.closest(`${editing}, ${controls}, pre, [role="menu"], [role="listbox"]`)) return
      for (let element = target instanceof HTMLElement ? target : target.parentElement; element && stage!.contains(element); element = element.parentElement) {
        if (element.scrollHeight > element.clientHeight + 1 && /^(auto|scroll)$/.test(getComputedStyle(element).overflowY)) return element
      }
    }
    function move(delta: number, target: HTMLElement) {
      if (locked()) { reveal(); return }
      if (!delta) return
      // One 120px reading gesture travels the full range, without snapping on release.
      // At viewport boundaries, ignore rubber-band motion in the blocked direction.
      const max = target.scrollHeight - target.clientHeight
      if (delta < 0 && target.scrollTop <= 0) { setProgress(0); return }
      if (delta > 0 && target.scrollTop >= max - 1) return
      setProgress(current => Math.max(0, Math.min(1, current + delta / 120)))
    }
    function touchStart(event: TouchEvent) {
      reset()
      if (event.touches.length !== 1) return
      scroller = findScroller(event.target)
      if (scroller) point = { x: event.touches[0].clientX, y: event.touches[0].clientY }
    }
    function touchMove(event: TouchEvent) {
      if (event.touches.length !== 1) { reset(); return }
      if (!point || !scroller) return
      const next = event.touches[0]
      const dx = next.clientX - point.x
      const dy = point.y - next.clientY
      if (!axis) {
        if (Math.abs(dy) > 12 && Math.abs(dy) >= Math.abs(dx)) axis = 'y'
        else if (Math.abs(dx) >= 16 && Math.abs(dx) >= Math.abs(dy) * 1.5) axis = 'x'
        else return
      }
      if (axis === 'x') return
      point = { x: next.clientX, y: next.clientY }
      move(dy, scroller)
    }
    function wheel(event: WheelEvent) {
      if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return
      const target = findScroller(event.target)
      if (!target) return
      move(event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? target.clientHeight : 1), target)
    }
    function focus(event: FocusEvent) {
      if (event.target instanceof Element && event.target.closest(`${editing}, ${controls}`)) reveal()
    }
    const passive = { passive: true }
    stage.addEventListener('touchstart', touchStart, passive)
    stage.addEventListener('touchmove', touchMove, passive)
    stage.addEventListener('touchend', reset, passive)
    stage.addEventListener('touchcancel', reset, passive)
    stage.addEventListener('wheel', wheel, passive)
    stage.addEventListener('focusin', focus)
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame)
      stage.removeEventListener('touchstart', touchStart)
      stage.removeEventListener('touchmove', touchMove)
      stage.removeEventListener('touchend', reset)
      stage.removeEventListener('touchcancel', reset)
      stage.removeEventListener('wheel', wheel)
      stage.removeEventListener('focusin', focus)
    }
  }, [stageRef, enabled, scope])
}
