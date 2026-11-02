/** A gesture is claimed once; the owner retains it through release or cancellation. */
export type MobilePagePan = {
  move(distance: number): void
  end(velocity: number): void
  cancel(): void
}
export type MobilePagePanRequest = { controller?: MobilePagePan }
