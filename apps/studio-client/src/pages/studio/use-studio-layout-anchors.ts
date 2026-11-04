import { useLayoutEffect, type RefObject } from 'react'

const COMPOSER_SELECTOR = '[data-loom-component="chat-composer"]'

export function useStudioLayoutAnchors(stageRef: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const stage = stageRef.current
    const composer = stage?.querySelector<HTMLElement>(COMPOSER_SELECTOR)

    if (!stage || !composer) return

    let frame: number | undefined
    const update = () => {
      if (frame !== undefined) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        frame = undefined
        const stageBounds = stage.getBoundingClientRect()
        const composerBounds = composer.getBoundingClientRect()
        stage.style.setProperty('--loom-narrative-left-anchor', `${composerBounds.left - stageBounds.left}px`)
        stage.style.setProperty('--loom-narrative-right-anchor', `${composerBounds.right - stageBounds.left}px`)
      })
    }
    const observer = new ResizeObserver(update)
    observer.observe(stage)
    observer.observe(composer)
    update()

    return () => {
      observer.disconnect()
      if (frame !== undefined) cancelAnimationFrame(frame)
      stage.style.removeProperty('--loom-narrative-left-anchor')
      stage.style.removeProperty('--loom-narrative-right-anchor')
    }
  }, [stageRef])
}
