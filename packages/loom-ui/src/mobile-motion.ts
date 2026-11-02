/** Shared release rules for mobile drawers and page stacks; velocity is px/ms. */
export const mobileMotionEasing = 'cubic-bezier(0.16, 1, 0.3, 1)'
export function mobileReleaseTarget(position: number, extent: number, velocity: number): boolean {
  return Math.abs(velocity) >= 0.5 ? velocity > 0 : position >= extent * 0.4
}
export function mobileResistance(position: number, min: number, max: number): number {
  if (position < min) return min - 24 * (1 - Math.exp((position - min) / 80))
  if (position > max) return max + 24 * (1 - Math.exp((max - position) / 80))
  return position
}
export function mobileMotionDuration(distance: number, velocity = 0): number {
  const mode = document.documentElement.dataset.loomMotion
  if (mode === 'reduce' || (mode !== 'full' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) return 0
  return Math.max(160, Math.min(360, Math.abs(distance) / Math.max(Math.abs(velocity), 0.8)))
}
