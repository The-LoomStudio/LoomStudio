export type HapticFeedbackPattern = 'light' | 'ai-completed' | 'ai-failed'

const HAPTIC_PATTERNS: Record<HapticFeedbackPattern, number | number[]> = {
  light: 10,
  'ai-completed': [40, 60, 40],
  'ai-failed': [80, 60, 40],
}

/** Trigger tactile confirmation according to specified pattern. */
export function triggerMobileHaptic(pattern: HapticFeedbackPattern = 'light') {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function'
    || typeof window === 'undefined' || !window.matchMedia('(pointer: coarse)').matches
    || document.visibilityState !== 'visible') return
  try {
    navigator.vibrate(HAPTIC_PATTERNS[pattern])
  } catch {
    // Gracefully ignore browser security or policy restrictions.
  }
}

/** Optional tactile confirmation; unsupported browsers keep the same interaction. */
export function mobileHaptic() {
  triggerMobileHaptic('light')
}
