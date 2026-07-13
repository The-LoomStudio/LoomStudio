export function now(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}
