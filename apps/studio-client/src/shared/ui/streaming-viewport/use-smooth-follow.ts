import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react'

/** One scroll owner per viewport. Content growth never counts as user intent. */
export function useSmoothFollow({ scrollRef, contentRef, enabled = true, scopeId, initially = true, growthOnly = false }: {
  scrollRef: RefObject<HTMLDivElement | null>
  contentRef: RefObject<HTMLDivElement | null>
  enabled?: boolean
  scopeId?: string
  growthOnly?: boolean
  initially?: boolean
}) {
  const [following, setFollowing] = useState(initially)
  const followingRef = useRef(initially)
  const interruptionRef = useRef(0)
  const wakeRef = useRef<() => void>(() => {})
  const pause = useCallback(() => {
    interruptionRef.current += 1
    followingRef.current = false
    setFollowing(false)
  }, [])
  const resume = useCallback(() => {
    followingRef.current = true
    setFollowing(true)
    if (enabled) wakeRef.current()
    else if (scrollRef.current) scrollRef.current.scrollTop = Math.max(0, scrollRef.current.scrollHeight - scrollRef.current.clientHeight)
  }, [enabled, scrollRef])

  useLayoutEffect(() => {
    followingRef.current = initially
    setFollowing(initially)
    wakeRef.current()
  }, [scopeId, initially])

  useLayoutEffect(() => {
    if (!enabled) return
    const element = scrollRef.current
    if (!element) return
    element.dataset.streamScroll = ''
    let frame = 0
    let previousTime = 0
    let previousTop = element.scrollTop
    let previousMaximum = Math.max(0, element.scrollHeight - element.clientHeight)
    let writtenTop: number | undefined
    let userMoving = false
    let touchY = 0
    const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
      || document.documentElement.dataset.loomMotion === 'reduce'
    const owns = (target: EventTarget | null) => target instanceof Element
      && target.closest('[data-stream-scroll]') === element
    const hasSelection = () => {
      const selection = window.getSelection()
      return Boolean(selection && !selection.isCollapsed && selection.anchorNode && element.contains(selection.anchorNode))
    }
    const tick = (time: number) => {
      frame = 0
      if (!followingRef.current) return
      if (hasSelection()) { pause(); return }
      const target = Math.max(0, element.scrollHeight - element.clientHeight)
      const distance = target - element.scrollTop
      const dt = previousTime ? Math.min(64, time - previousTime) : 16
      previousTime = time
      if (Math.abs(distance) > .5) {
        element.scrollTop = reduced() || Math.abs(distance) < 1 ? target
          : element.scrollTop + distance * (1 - Math.exp(-dt / 70))
        writtenTop = element.scrollTop
        previousTop = element.scrollTop
        previousMaximum = target
        frame = requestAnimationFrame(tick)
      } else previousTime = 0
    }
    const wake = () => {
      if (!frame && followingRef.current) frame = requestAnimationFrame(tick)
    }
    wakeRef.current = wake
    const wheel = (event: WheelEvent) => {
      if (!owns(event.target) || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return
      userMoving = true
      if (event.deltaY < 0) pause()
    }
    const key = (event: KeyboardEvent) => {
      if (!owns(event.target) || (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]'))) return
      if (['ArrowUp', 'PageUp', 'Home'].includes(event.key) || event.key === ' ' && event.shiftKey) { userMoving = true; pause() }
      if (['ArrowDown', 'PageDown', 'End', ' '].includes(event.key)) userMoving = true
    }
    const touchStart = (event: TouchEvent) => { if (owns(event.target)) touchY = event.touches[0].clientY }
    const touchMove = (event: TouchEvent) => {
      if (!owns(event.target)) return
      userMoving = true
      const next = event.touches[0].clientY
      if (next > touchY + 2) pause()
      touchY = next
    }
    const pointer = (event: PointerEvent) => { if (event.target === element) userMoving = true }
    const scroll = () => {
      const top = element.scrollTop
      const maximum = Math.max(0, element.scrollHeight - element.clientHeight)
      const ownWrite = writtenTop !== undefined && Math.abs(top - writtenTop) < 1
      // Native input inside a sandbox iframe cannot bubble to this document.
      // Scrollbar drags and keyboard scrolling can also arrive without a host
      // input event. The actual upward movement must release the lock itself.
      const clampedByShrink = maximum < previousMaximum && Math.abs(top - maximum) < 1
      if (!ownWrite) {
        if (top < previousTop - 1 && !clampedByShrink) pause()
        else if (userMoving && maximum - top <= 24 && !hasSelection()) resume()
      }
      writtenTop = undefined
      previousTop = top
      previousMaximum = maximum
      userMoving = false
    }
    const selection = () => { if (hasSelection()) pause() }
    let previousContent = contentRef.current?.textContent
    const contentChanged = () => {
      const content = contentRef.current?.textContent
      if (!growthOnly || content !== previousContent) wake()
      previousContent = content
    }
    const observer = new ResizeObserver(contentChanged)
    const mutations = new MutationObserver(contentChanged)
    if (contentRef.current) mutations.observe(contentRef.current, { subtree: true, childList: true, characterData: true })
    observer.observe(element)
    if (contentRef.current) observer.observe(contentRef.current)
    element.addEventListener('wheel', wheel, { passive: true })
    element.addEventListener('keydown', key)
    element.addEventListener('touchstart', touchStart, { passive: true })
    element.addEventListener('touchmove', touchMove, { passive: true })
    element.addEventListener('pointerdown', pointer)
    element.addEventListener('scroll', scroll)
    document.addEventListener('selectionchange', selection)
    if (!growthOnly) wake()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      mutations.disconnect()
      wakeRef.current = () => {}
      delete element.dataset.streamScroll
      element.removeEventListener('wheel', wheel)
      element.removeEventListener('keydown', key)
      element.removeEventListener('touchstart', touchStart)
      element.removeEventListener('touchmove', touchMove)
      element.removeEventListener('pointerdown', pointer)
      element.removeEventListener('scroll', scroll)
      document.removeEventListener('selectionchange', selection)
    }
  }, [enabled, scopeId, scrollRef, contentRef, pause, resume, growthOnly])

  useLayoutEffect(() => { if (enabled && !growthOnly) wakeRef.current() })
  return { following, followingRef, interruptionRef, pause, resume }
}
