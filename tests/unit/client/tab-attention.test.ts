// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  _resetTabAttentionStateForTesting,
  clearTabAttention,
  notifyAiRunFinished,
  showTabAttention,
} from '../../../apps/studio-client/src/shared/browser/tab-attention.js'
import {
  mobileHaptic,
  triggerMobileHaptic,
} from '../../../apps/studio-client/src/shared/ui/mobile-haptics.js'

describe('tab-attention & mobile-haptics', () => {
  let vibrateMock: ReturnType<typeof vi.fn>
  let faviconLink: HTMLLinkElement

  beforeEach(() => {
    _resetTabAttentionStateForTesting()

    // Set up mock title & favicon link in document.head
    document.head.innerHTML = '<title>Loom Studio</title>'
    faviconLink = document.createElement('link')
    faviconLink.rel = 'icon'
    faviconLink.type = 'image/x-icon'
    faviconLink.href = '/src/shared/assets/favicon.ico'
    document.head.appendChild(faviconLink)

    // Set up navigator.vibrate mock
    vibrateMock = vi.fn().mockReturnValue(true)
    vi.stubGlobal('navigator', {
      ...navigator,
      vibrate: vibrateMock,
    })

    // Mock matchMedia for coarse pointer (touch / mobile)
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(pointer: coarse)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))

    // Default to visible & focused document
    Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true })
    Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true, configurable: true })
    Object.defineProperty(document, 'hasFocus', { value: () => true, writable: true, configurable: true })
  })

  afterEach(() => {
    _resetTabAttentionStateForTesting()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  describe('triggerMobileHaptic', () => {
    it('triggers light 10ms haptic tap by default', () => {
      mobileHaptic()
      expect(vibrateMock).toHaveBeenCalledWith(10)
    })

    it('triggers distinct rhythm [40, 60, 40] for ai-completed', () => {
      triggerMobileHaptic('ai-completed')
      expect(vibrateMock).toHaveBeenCalledWith([40, 60, 40])
    })

    it('triggers distinct warning rhythm [80, 60, 40] for ai-failed', () => {
      triggerMobileHaptic('ai-failed')
      expect(vibrateMock).toHaveBeenCalledWith([80, 60, 40])
    })

    it('does not vibrate if document is hidden', () => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', writable: true, configurable: true })
      triggerMobileHaptic('ai-completed')
      expect(vibrateMock).not.toHaveBeenCalled()
    })

    it('does not vibrate on non-coarse pointer devices (desktop mouse)', () => {
      window.matchMedia = vi.fn().mockReturnValue({ matches: false })
      triggerMobileHaptic('ai-completed')
      expect(vibrateMock).not.toHaveBeenCalled()
    })
  })

  describe('notifyAiRunFinished in foreground', () => {
    it('triggers haptic vibration and leaves favicon and title untouched when page is active', () => {
      Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true })
      Object.defineProperty(document, 'hasFocus', { value: () => true, writable: true, configurable: true })

      notifyAiRunFinished('completed')

      expect(vibrateMock).toHaveBeenCalledWith([40, 60, 40])
      expect(document.title).toBe('Loom Studio')
      expect(faviconLink.href).toContain('/src/shared/assets/favicon.ico')
    })

    it('triggers failure haptic pattern on failed run', () => {
      Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true })
      Object.defineProperty(document, 'hasFocus', { value: () => true, writable: true, configurable: true })

      notifyAiRunFinished('failed')

      expect(vibrateMock).toHaveBeenCalledWith([80, 60, 40])
      expect(document.title).toBe('Loom Studio')
    })
  })

  describe('notifyAiRunFinished in background (off-tab)', () => {
    beforeEach(() => {
      // Mock Canvas and Image for Favicon drawing
      const mockCanvas = {
        width: 32,
        height: 32,
        getContext: vi.fn().mockReturnValue({
          drawImage: vi.fn(),
          beginPath: vi.fn(),
          arc: vi.fn(),
          fill: vi.fn(),
          fillStyle: '',
        }),
        toDataURL: vi.fn().mockReturnValue('data:image/png;base64,mockbadgedata'),
      }
      const originalCreate = document.createElement.bind(document)
      vi.spyOn(document, 'createElement').mockImplementation(((tagName: string, options?: ElementCreationOptions) => {
        if (tagName === 'canvas') return mockCanvas as unknown as HTMLCanvasElement
        return originalCreate(tagName, options)
      }) as typeof document.createElement)

      // Mock Image onload trigger
      class MockImage {
        crossOrigin = ''
        onload: (() => void) | null = null
        onerror: ((err: unknown) => void) | null = null
        private _src = ''
        get src() {
          return this._src
        }
        set src(url: string) {
          this._src = url
          setTimeout(() => this.onload?.(), 0)
        }
      }
      vi.stubGlobal('Image', MockImage)
    })

    it('prefixes title with ● and does not call foreground vibration', async () => {
      Object.defineProperty(document, 'hidden', { value: true, writable: true, configurable: true })

      notifyAiRunFinished('completed')

      // Vibration should not be called in background
      expect(vibrateMock).not.toHaveBeenCalled()
      // Title should have unread marker
      expect(document.title).toBe('● Loom Studio')

      // Wait for image onload async badge draw
      await new Promise(r => setTimeout(r, 10))
      expect(faviconLink.href).toBe('data:image/png;base64,mockbadgedata')
      expect(faviconLink.type).toBe('image/png')
    })

    it('automatically restores title and original favicon when switching back to tab', async () => {
      Object.defineProperty(document, 'hidden', { value: true, writable: true, configurable: true })

      notifyAiRunFinished('completed')
      await new Promise(r => setTimeout(r, 10))

      expect(document.title).toBe('● Loom Studio')
      expect(faviconLink.href).toBe('data:image/png;base64,mockbadgedata')

      // User returns to tab
      Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true })
      document.dispatchEvent(new Event('visibilitychange'))

      // Cleared!
      expect(document.title).toBe('Loom Studio')
      expect(faviconLink.href).toContain('/src/shared/assets/favicon.ico')
      expect(faviconLink.type).toBe('image/x-icon')
      // Touch device receives tactile confirmation upon returning
      expect(vibrateMock).toHaveBeenCalledWith(10)
    })
  })
})
