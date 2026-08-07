export type DialogRect = {
  bottom: number
  left: number
  right: number
  top: number
}

export function isDialogBackdropPoint(rect: DialogRect, x: number, y: number): boolean {
  return x < rect.left || x > rect.right || y < rect.top || y > rect.bottom
}
