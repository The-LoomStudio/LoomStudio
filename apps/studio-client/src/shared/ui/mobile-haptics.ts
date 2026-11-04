/** Optional tactile confirmation; unsupported browsers keep the same interaction. */
export function mobileHaptic() {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function'
    || !window.matchMedia('(pointer: coarse)').matches || document.visibilityState !== 'visible') return
  navigator.vibrate(10)
}
