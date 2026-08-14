import { useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react'
import type { StudioPanelId } from './model/studio-layout-store.js'
import {
  DEFAULT_WINDOW_RESIZE_CONSTRAINTS,
  readWindowResizeBounds,
  resizeWindow,
  type WindowResizeAxis,
  type WindowResizeConstraints,
  type WindowSize,
} from './window-resize.js'

type WindowResizeSession = {
  axis: WindowResizeAxis
  bounds: WindowSize
  constraints: WindowResizeConstraints
  current: WindowSize
  initial: WindowSize
  panel: StudioPanelId
  pointerId: number
  startX: number
  startY: number
}

type WindowResizePreview = {
  panel: StudioPanelId
  size: WindowSize
}

type UseStudioWindowResizeOptions = {
  activePanel: StudioPanelId | null
  dockRef: RefObject<HTMLElement | null>
  setPanelWindowSize(panel: StudioPanelId, size: WindowSize): void
  stageRef: RefObject<HTMLElement | null>
}

export function useStudioWindowResize(options: UseStudioWindowResizeOptions) {
  const sessionRef = useRef<WindowResizeSession | undefined>(undefined)
  const [preview, setPreview] = useState<WindowResizePreview>()
  const [resizing, setResizing] = useState(false)

  function begin(axis: WindowResizeAxis, event: PointerEvent<HTMLButtonElement>) {
    const measurement = readMeasurement(options.stageRef.current, options.dockRef.current)
    if (!options.activePanel || !measurement) return

    sessionRef.current = {
      axis,
      bounds: measurement.bounds,
      constraints: measurement.constraints,
      current: measurement.size,
      initial: measurement.size,
      panel: options.activePanel,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
    setResizing(true)
  }

  function move(event: PointerEvent<HTMLButtonElement>) {
    const session = sessionRef.current
    if (!session) return
    const size = resizeWindow(
      session.initial,
      { x: event.clientX - session.startX, y: event.clientY - session.startY },
      session.bounds,
      session.axis,
      session.constraints,
    )
    session.current = size
    setPreview({ panel: session.panel, size })
  }

  function stop(event: PointerEvent<HTMLButtonElement>) {
    finish()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  function finish() {
    const session = sessionRef.current
    if (session) options.setPanelWindowSize(session.panel, session.current)
    sessionRef.current = undefined
    setPreview(undefined)
    setResizing(false)
  }

  function resizeWithKeyboard(axis: WindowResizeAxis, event: KeyboardEvent<HTMLButtonElement>) {
    const measurement = readMeasurement(options.stageRef.current, options.dockRef.current)
    if (!options.activePanel || !measurement) return
    const horizontal = axis !== 'vertical'
    const vertical = axis !== 'horizontal'
    const delta = {
      x: horizontal && event.key === 'ArrowLeft' ? -16 : horizontal && event.key === 'ArrowRight' ? 16 : 0,
      y: vertical && event.key === 'ArrowUp' ? -16 : vertical && event.key === 'ArrowDown' ? 16 : 0,
    }
    if (delta.x === 0 && delta.y === 0) return

    options.setPanelWindowSize(options.activePanel, resizeWindow(
      measurement.size,
      delta,
      measurement.bounds,
      axis,
      measurement.constraints,
    ))
    event.preventDefault()
  }

  return { begin, finish, move, preview, resizeWithKeyboard, resizing, stop }
}

function readMeasurement(stage: HTMLElement | null, dock: HTMLElement | null) {
  if (!stage || !dock) return null
  const stageBounds = stage.getBoundingClientRect()
  const dockBounds = dock.getBoundingClientRect()
  const styles = getComputedStyle(dock)
  const cssMaximumHeight = Number.parseFloat(styles.maxHeight)
  const constraints = {
    edgeGap: readCssLength(styles, '--loom-window-gap', DEFAULT_WINDOW_RESIZE_CONSTRAINTS.edgeGap),
    minimumHeight: readCssLength(styles, '--loom-window-min-height', DEFAULT_WINDOW_RESIZE_CONSTRAINTS.minimumHeight),
    minimumWidth: readCssLength(styles, '--loom-window-min-width', DEFAULT_WINDOW_RESIZE_CONSTRAINTS.minimumWidth),
  }

  return {
    bounds: readWindowResizeBounds(stageBounds, dockBounds, cssMaximumHeight, constraints.edgeGap),
    constraints,
    size: { width: dockBounds.width, height: dockBounds.height },
  }
}

function readCssLength(styles: CSSStyleDeclaration, property: string, fallback: number): number {
  const value = Number.parseFloat(styles.getPropertyValue(property))
  return Number.isFinite(value) && value >= 0 ? value : fallback
}
