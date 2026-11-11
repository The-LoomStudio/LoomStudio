import { useEffect, type RefObject } from 'react'

const editing = 'input, textarea, select, [contenteditable="true"], .cm-editor'
const controls = '[data-loom-component="stage-floating-header"], [data-loom-object="agent-composer-layer"]'
const excludedTargets = `${editing}, ${controls}, pre, [role="menu"], [role="listbox"], [role="dialog"]`

const MAX_HIDE_OFFSET = 56 // 行程阈值 (px)，对应顶栏标准高度
const SNAP_DURATION_MS = 240
const SNAP_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'
const SNAP_TRANSITION = `transform ${SNAP_DURATION_MS}ms ${SNAP_EASING}, opacity ${SNAP_DURATION_MS}ms ease`

/**
 * 1:1 像素级跟手移动端阅读 Chrome 控制器
 * 基于 Scroll-Delta Clamping 数学模型与平滑磁吸状态机
 */
export function useMobileReadingChrome(
  stageRef: RefObject<HTMLElement | null>,
  enabled: boolean,
  scope: string,
) {
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return

    const shell = stage.closest<HTMLElement>('[data-loom-object="studio-shell"]') ?? stage
    let currentOffset = 0
    let lastScrollTop = 0
    let activeScroller: HTMLElement | null = null
    let snapTimer: number | undefined
    let cleanupSnapTimer: number | undefined

    const getSurfaces = (): HTMLElement[] => [
      ...stage.querySelectorAll<HTMLElement>(
        '[data-loom-component="stage-floating-header"], [data-loom-object="agent-composer-layer"]',
      ),
    ]

    const clearTimers = () => {
      if (snapTimer !== undefined) {
        window.clearTimeout(snapTimer)
        snapTimer = undefined
      }
      if (cleanupSnapTimer !== undefined) {
        window.clearTimeout(cleanupSnapTimer)
        cleanupSnapTimer = undefined
      }
    }

    const render = (progress: number, animated: boolean) => {
      const p = Math.max(0, Math.min(1, progress))
      const surfaces = getSurfaces()

      for (const surface of surfaces) {
        surface.style.transition = animated ? SNAP_TRANSITION : 'none'
        surface.style.setProperty('--loom-mobile-chrome-progress', String(p))
      }

      // 当完全隐藏时切换可访问性属性，未完全隐藏时保持可见并可交互
      const hidden = String(p === 1)
      if (shell.dataset.mobileChromeHidden !== hidden) {
        shell.dataset.mobileChromeHidden = hidden
      }

      if (animated) {
        if (cleanupSnapTimer !== undefined) window.clearTimeout(cleanupSnapTimer)
        cleanupSnapTimer = window.setTimeout(() => {
          for (const surface of getSurfaces()) {
            surface.style.transition = 'none'
          }
          cleanupSnapTimer = undefined
        }, SNAP_DURATION_MS + 20)
      }
    }

    const reveal = (animated = true) => {
      clearTimers()
      currentOffset = 0
      render(0, animated)
    }

    // 初始化时确保完全展示
    reveal(false)
    if (!enabled) return

    const isLocked = () =>
      document.documentElement.dataset.keyboardOpen === 'true' ||
      Boolean(document.querySelector('dialog[open]')) ||
      Boolean(stage.querySelector('[data-loom-object="agent-composer-layer"] [aria-expanded="true"]')) ||
      Boolean(stage.querySelector('[data-loom-component="stage-floating-header"] [data-expanded="true"]')) ||
      Boolean(document.activeElement instanceof Element && document.activeElement.closest(editing)) ||
      Boolean(window.getSelection()?.toString())

    function isValidScrollTarget(target: EventTarget | null): target is HTMLElement {
      if (!(target instanceof HTMLElement)) return false
      if (target.closest(excludedTargets)) return false
      return stage ? stage.contains(target) : false
    }

    function scheduleSnap() {
      if (snapTimer !== undefined) window.clearTimeout(snapTimer)
      snapTimer = window.setTimeout(() => {
        snapTimer = undefined
        const ratio = currentOffset / MAX_HIDE_OFFSET
        if (ratio > 0 && ratio < 1) {
          currentOffset = ratio >= 0.5 ? MAX_HIDE_OFFSET : 0
          render(currentOffset / MAX_HIDE_OFFSET, true)
        }
      }, 140)
    }

    // ================= 核心滚动监听（原生捕获） =================
    function handleScroll(event: Event) {
      if (isLocked()) {
        reveal(true)
        return
      }

      const target = event.target
      if (!isValidScrollTarget(target)) return

      const currentScrollTop = Math.max(0, target.scrollTop)

      // 切换滚动容器或初次记录
      if (activeScroller !== target) {
        activeScroller = target
        lastScrollTop = currentScrollTop
      }

      const deltaY = currentScrollTop - lastScrollTop
      lastScrollTop = currentScrollTop

      // 边界保护：到达页面最顶部（<= 6px）时强制完整展示
      if (currentScrollTop <= 6) {
        currentOffset = 0
        render(0, true)
        return
      }

      // 如果 deltaY 为 0，不产生多余计算
      if (Math.abs(deltaY) < 0.1) return

      // 正在跟手滚动：立即取消平滑过渡，实现 0 延迟 1:1 跟手
      if (cleanupSnapTimer !== undefined) {
        window.clearTimeout(cleanupSnapTimer)
        cleanupSnapTimer = undefined
        for (const surface of getSurfaces()) {
          surface.style.transition = 'none'
        }
      }

      // 核心公式：滚动差值实时累加并严格钳制在 [0, MAX_HIDE_OFFSET]
      currentOffset = Math.max(0, Math.min(MAX_HIDE_OFFSET, currentOffset + deltaY))
      const progress = currentOffset / MAX_HIDE_OFFSET
      render(progress, false)

      // 滚动静止后，若停在中间态自动就近平滑磁吸
      scheduleSnap()
    }

    // ================= 触摸辅助（针对无 overflow 区域与手势即刻打断） =================
    let touchPoint: { x: number; y: number } | null = null
    let touchAxis: 'x' | 'y' | null = null

    function handleTouchStart(event: TouchEvent) {
      if (event.touches.length !== 1) {
        touchPoint = null
        touchAxis = null
        return
      }

      // 用户手指接触屏幕瞬间：打断正在进行的磁吸动画，实现即触即停
      if (cleanupSnapTimer !== undefined || snapTimer !== undefined) {
        clearTimers()
        for (const surface of getSurfaces()) {
          surface.style.transition = 'none'
        }
      }

      const target = event.target
      if (target instanceof Element && target.closest(excludedTargets)) {
        touchPoint = null
        return
      }

      touchPoint = { x: event.touches[0].clientX, y: event.touches[0].clientY }
      touchAxis = null
    }

    function handleTouchMove(event: TouchEvent) {
      if (event.touches.length !== 1 || !touchPoint) return

      const next = event.touches[0]
      const dx = next.clientX - touchPoint.x
      const dy = touchPoint.y - next.clientY

      // 判断主滑动手势方向（水平手势放弃跟随，避免干扰左右滑动手势或翻页）
      if (!touchAxis) {
        if (Math.abs(dy) > 8 && Math.abs(dy) >= Math.abs(dx)) {
          touchAxis = 'y'
        } else if (Math.abs(dx) >= 12 && Math.abs(dx) > Math.abs(dy)) {
          touchAxis = 'x'
          return
        } else {
          return
        }
      }

      if (touchAxis === 'x') return
      touchPoint = { x: next.clientX, y: next.clientY }

      if (isLocked()) {
        reveal(true)
        return
      }

      // 如果目标不在可滚动容器中（例如空白区域），由 touch 兜底驱动增量
      const target = event.target instanceof HTMLElement ? event.target : null
      const isScrollable = target && target.scrollHeight > target.clientHeight + 2
      if (!isScrollable) {
        currentOffset = Math.max(0, Math.min(MAX_HIDE_OFFSET, currentOffset + dy))
        render(currentOffset / MAX_HIDE_OFFSET, false)
        scheduleSnap()
      }
    }

    function handleTouchEnd() {
      touchPoint = null
      touchAxis = null
      scheduleSnap()
    }

    // ================= 桌面滚轮支持 =================
    function handleWheel(event: WheelEvent) {
      if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return
      if (isLocked()) {
        reveal(true)
        return
      }

      const target = event.target
      if (!isValidScrollTarget(target)) return

      const deltaY = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 40 : 1)
      currentOffset = Math.max(0, Math.min(MAX_HIDE_OFFSET, currentOffset + deltaY))
      render(currentOffset / MAX_HIDE_OFFSET, false)
      scheduleSnap()
    }

    function handleFocusIn(event: FocusEvent) {
      if (event.target instanceof Element && event.target.closest(`${editing}, ${controls}`)) {
        reveal(true)
      }
    }

    const passiveCapture = { passive: true, capture: true }
    const passive = { passive: true }

    stage.addEventListener('scroll', handleScroll, passiveCapture)
    stage.addEventListener('touchstart', handleTouchStart, passive)
    stage.addEventListener('touchmove', handleTouchMove, passive)
    stage.addEventListener('touchend', handleTouchEnd, passive)
    stage.addEventListener('touchcancel', handleTouchEnd, passive)
    stage.addEventListener('wheel', handleWheel, passive)
    stage.addEventListener('focusin', handleFocusIn)

    return () => {
      clearTimers()
      stage.removeEventListener('scroll', handleScroll, true)
      stage.removeEventListener('touchstart', handleTouchStart)
      stage.removeEventListener('touchmove', handleTouchMove)
      stage.removeEventListener('touchend', handleTouchEnd)
      stage.removeEventListener('touchcancel', handleTouchEnd)
      stage.removeEventListener('wheel', handleWheel)
      stage.removeEventListener('focusin', handleFocusIn)
    }
  }, [stageRef, enabled, scope])
}
