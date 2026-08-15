export type WindowResizeAxis = 'horizontal' | 'vertical' | 'both'

export type WindowSize = {
  height: number
  width: number
}

type Rectangle = {
  bottom: number
  left: number
  right: number
  top: number
}

export type WindowResizeConstraints = {
  edgeGap: number
  minimumHeight: number
  minimumWidth: number
}

export const DEFAULT_WINDOW_RESIZE_CONSTRAINTS: WindowResizeConstraints = {
  edgeGap: 18,
  minimumHeight: 360,
  minimumWidth: 520,
}

export function readWindowResizeBounds(
  stage: Pick<Rectangle, 'bottom' | 'right'>,
  dock: Pick<Rectangle, 'left' | 'top'>,
  cssMaximumHeight: number,
  edgeGap = DEFAULT_WINDOW_RESIZE_CONSTRAINTS.edgeGap,
): WindowSize {
  const availableHeight = stage.bottom - dock.top - edgeGap

  return {
    width: stage.right - dock.left - edgeGap,
    height: Number.isFinite(cssMaximumHeight)
      ? Math.min(availableHeight, cssMaximumHeight)
      : availableHeight,
  }
}

export function resizeWindow(
  initial: WindowSize,
  delta: { x: number; y: number },
  bounds: WindowSize,
  axis: WindowResizeAxis,
  constraints = DEFAULT_WINDOW_RESIZE_CONSTRAINTS,
): WindowSize {
  const minimumWidth = Math.min(constraints.minimumWidth, bounds.width)
  const minimumHeight = Math.min(constraints.minimumHeight, bounds.height)

  return {
    width: axis === 'vertical'
      ? initial.width
      : clamp(initial.width + delta.x, minimumWidth, bounds.width),
    height: axis === 'horizontal'
      ? initial.height
      : clamp(initial.height + delta.y, minimumHeight, bounds.height),
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}
