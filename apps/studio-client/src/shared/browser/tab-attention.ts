import { triggerMobileHaptic, type HapticFeedbackPattern } from '../ui/mobile-haptics.js'

export type AiRunFinishStatus = 'completed' | 'failed'

let originalFaviconHref: string | null = null
let originalFaviconType: string | null = null
let originalTitle: string | null = null
let hasAttentionBadge = false
let listenersAttached = false

function getFaviconLink(): HTMLLinkElement | null {
  if (typeof document === 'undefined') return null
  return (
    document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    ?? document.querySelector<HTMLLinkElement>('link[rel*="icon"]')
  )
}

/**
 * Draw a high-contrast notification badge on the top-right corner of the favicon.
 */
function drawBadgeOnFavicon(faviconUrl: string, dotColor: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined' || typeof Image === 'undefined') {
      return reject(new Error('DOM environment unavailable'))
    }

    const img = new Image()
    img.crossOrigin = 'anonymous'

    img.onload = () => {
      try {
        const size = 32
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')
        if (!ctx) return reject(new Error('Canvas 2D context unavailable'))

        // 1. Draw base icon
        ctx.drawImage(img, 0, 0, size, size)

        // 2. Draw badge dot on top-right
        const radius = 5
        const x = size - radius - 1
        const y = radius + 1

        // Dark outer stroke ring for high contrast across dark and light tab backgrounds
        ctx.beginPath()
        ctx.arc(x, y, radius + 1.5, 0, Math.PI * 2)
        ctx.fillStyle = '#09090b'
        ctx.fill()

        // Vibrant inner badge dot
        ctx.beginPath()
        ctx.arc(x, y, radius, 0, Math.PI * 2)
        ctx.fillStyle = dotColor
        ctx.fill()

        resolve(canvas.toDataURL('image/png'))
      } catch (err) {
        reject(err)
      }
    }

    img.onerror = err => reject(err)
    img.src = faviconUrl
  })
}

/**
 * Show a tab attention badge (Favicon red dot + Title dot) when user is away.
 */
export function showTabAttention(status: AiRunFinishStatus = 'completed') {
  if (typeof document === 'undefined') return

  const link = getFaviconLink()
  if (link && originalFaviconHref === null) {
    originalFaviconHref = link.getAttribute('href') ?? link.href
    originalFaviconType = link.getAttribute('type')
  }

  if (originalTitle === null) {
    originalTitle = document.title
  }

  hasAttentionBadge = true

  // 1. Prefix document.title with a subtle unread dot
  const baseTitle = originalTitle || document.title
  if (!document.title.startsWith('● ')) {
    document.title = `● ${baseTitle}`
  }

  // 2. Update favicon with canvas badge
  const dotColor = status === 'failed' ? '#f43f5e' : '#ef4444'
  if (link && originalFaviconHref) {
    drawBadgeOnFavicon(originalFaviconHref, dotColor)
      .then(badgedDataUrl => {
        if (hasAttentionBadge && link) {
          link.type = 'image/png'
          link.href = badgedDataUrl
        }
      })
      .catch(() => {
        // Fallback: title dot remains active if canvas drawing is blocked
      })
  }

  ensureAutoClearListeners()
}

/**
 * Clear the tab attention badge and restore original title and Favicon.
 */
export function clearTabAttention() {
  if (typeof document === 'undefined') return
  if (!hasAttentionBadge && originalFaviconHref === null && originalTitle === null) return

  const hadBadge = hasAttentionBadge
  hasAttentionBadge = false

  // Restore Favicon
  const link = getFaviconLink()
  if (link && originalFaviconHref !== null) {
    link.href = originalFaviconHref
    if (originalFaviconType) {
      link.type = originalFaviconType
    } else {
      link.removeAttribute('type')
    }
  }

  // Restore Title
  if (originalTitle !== null) {
    document.title = originalTitle
  }

  // Provide tactile confirmation upon return to tab if an unread notification was cleared
  if (hadBadge) {
    triggerMobileHaptic('light')
  }
}

/**
 * Ensure window/document event listeners automatically clear attention badge when user returns.
 */
function ensureAutoClearListeners() {
  if (listenersAttached || typeof window === 'undefined' || typeof document === 'undefined') return
  listenersAttached = true

  const handleReturn = () => {
    if (typeof document !== 'undefined' && !document.hidden) {
      clearTabAttention()
    }
  }

  document.addEventListener('visibilitychange', handleReturn)
  window.addEventListener('focus', handleReturn)
}

/**
 * Notify that an AI execution has finished (either completed or failed).
 * - Background (user away / hidden tab): activates Favicon red dot badge + Title unread dot.
 * - Foreground (user in page): triggers distinct tactile haptic feedback.
 */
export function notifyAiRunFinished(status: AiRunFinishStatus) {
  if (typeof document === 'undefined') return

  const isBackground = document.hidden || (typeof document.hasFocus === 'function' && !document.hasFocus())
  if (isBackground) {
    showTabAttention(status)
  } else {
    const pattern: HapticFeedbackPattern = status === 'completed' ? 'ai-completed' : 'ai-failed'
    triggerMobileHaptic(pattern)
  }
}

/** Exported for testing reset */
export function _resetTabAttentionStateForTesting() {
  originalFaviconHref = null
  originalFaviconType = null
  originalTitle = null
  hasAttentionBadge = false
  listenersAttached = false
}
