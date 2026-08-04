export type ContextMenuPoint = {
  x: number
  y: number
}

export type ContextMenuSize = {
  height: number
  width: number
}

export function placeContextMenu(
  anchor: ContextMenuPoint,
  menu: ContextMenuSize,
  viewport: ContextMenuSize,
  gap = 8,
): ContextMenuPoint {
  return {
    x: clamp(anchor.x, gap, Math.max(gap, viewport.width - menu.width - gap)),
    y: clamp(anchor.y, gap, Math.max(gap, viewport.height - menu.height - gap)),
  }
}

export function movedBeyondLongPressThreshold(
  start: ContextMenuPoint,
  current: ContextMenuPoint,
  threshold = 8,
): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) > threshold
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}
