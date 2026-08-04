export type WindowResizeAxis = 'horizontal' | 'vertical' | 'both'

export type WindowSize = {
  height: number
  width: number
}

const WINDOW_MIN_WIDTH = 520
const WINDOW_MIN_HEIGHT = 360

export function resizeWindow(
  initial: WindowSize,
  delta: { x: number; y: number },
  bounds: WindowSize,
  axis: WindowResizeAxis,
): WindowSize {
  const minimumWidth = Math.min(WINDOW_MIN_WIDTH, bounds.width)
  const minimumHeight = Math.min(WINDOW_MIN_HEIGHT, bounds.height)

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
