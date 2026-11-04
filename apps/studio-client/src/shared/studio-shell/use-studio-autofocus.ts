import { useEffect, useRef, type RefObject } from 'react'

/** Startup preference is sampled once; later panel changes never own Composer focus. */
export function useStudioAutofocus(ready: boolean, composer: RefObject<HTMLTextAreaElement | null>, enabled = false) {
  const enabledAtStartup = useRef(enabled)
  const finished = useRef(false)
  useEffect(() => {
    if (!enabledAtStartup.current || finished.current) return
    let frame = 0
    let observer: MutationObserver | undefined
    function cleanup() {
      observer?.disconnect()
      cancelAnimationFrame(frame)
      document.removeEventListener('pointerdown', cancel, true)
      document.removeEventListener('keydown', cancel, true)
      document.removeEventListener('focusin', cancel, true)
    }
    function cancel() {
      finished.current = true
      cleanup()
    }
    const visible = (element: HTMLElement) => !element.closest('[hidden], [inert], [aria-hidden="true"]')
      && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden'
    function focus() {
      frame = 0
      if (finished.current) return
      if ((document.activeElement && document.activeElement !== document.body && document.activeElement !== document.documentElement)
        || [...document.querySelectorAll<HTMLElement>('dialog[open], [role="menu"], [data-loom-component^="overlay-"], [data-loom-component="studio-panel-right"]')].some(visible)) {
        cancel()
        return
      }
      const target = composer.current
      if (!target || !visible(target) || target.disabled || target.readOnly) return
      cancel()
      target.focus({ preventScroll: true })
    }
    function schedule() { if (!frame) frame = requestAnimationFrame(focus) }
    document.addEventListener('pointerdown', cancel, true)
    document.addEventListener('keydown', cancel, true)
    document.addEventListener('focusin', cancel, true)
    if (ready) {
      observer = new MutationObserver(schedule)
      observer.observe(document.body, { subtree: true, childList: true, attributes: true,
        attributeFilter: ['hidden', 'inert', 'aria-hidden', 'disabled', 'readonly'] })
      schedule()
    }
    return cleanup
  }, [ready, composer])
}
