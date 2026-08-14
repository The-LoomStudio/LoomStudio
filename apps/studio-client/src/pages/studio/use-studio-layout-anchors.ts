import { useLayoutEffect, type RefObject } from 'react'

const COMPOSER_SELECTOR = '[data-loom-component="chat-composer"]'
const COMPOSER_BASE_SELECTOR = '[data-loom-anchor="narrative-composer-base"]'
const COMPOSER_SURFACE_SELECTOR = '[data-loom-anchor="narrative-composer-surface"]'

export function useStudioLayoutAnchors(stageRef: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const stage = stageRef.current
    const composer = stage?.querySelector<HTMLElement>(COMPOSER_SELECTOR)
    const composerBase = stage?.querySelector<HTMLElement>(COMPOSER_BASE_SELECTOR)
    const composerSurface = stage?.querySelector<HTMLElement>(COMPOSER_SURFACE_SELECTOR)
    if (!stage || !composer || !composerBase || !composerSurface) return

    let frame: number | undefined
    const update = () => {
      if (frame !== undefined) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        frame = undefined
        const stageBounds = stage.getBoundingClientRect()
        const composerBounds = composer.getBoundingClientRect()
        const composerBaseBounds = composerBase.getBoundingClientRect()
        const surfaceStyles = getComputedStyle(composerSurface)
        const surfaceTopInset = readCssLength(surfaceStyles.paddingTop) + readCssLength(surfaceStyles.borderTopWidth)
        stage.style.setProperty('--loom-narrative-left-anchor', `${composerBounds.left - stageBounds.left}px`)
        stage.style.setProperty('--loom-narrative-right-anchor', `${composerBounds.right - stageBounds.left}px`)
        stage.style.setProperty('--loom-composer-base-top-anchor', `${composerBaseBounds.top - stageBounds.top - surfaceTopInset}px`)
      })
    }
    const observer = new ResizeObserver(update)
    observer.observe(stage)
    observer.observe(composer)
    observer.observe(composerBase)
    observer.observe(composerSurface)
    update()

    return () => {
      observer.disconnect()
      if (frame !== undefined) cancelAnimationFrame(frame)
      stage.style.removeProperty('--loom-narrative-left-anchor')
      stage.style.removeProperty('--loom-narrative-right-anchor')
      stage.style.removeProperty('--loom-composer-base-top-anchor')
    }
  }, [stageRef])
}

function readCssLength(value: string): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}
