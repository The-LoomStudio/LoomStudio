import { describe, expect, it } from 'vitest'
import { readToastCopyText } from '../../../apps/studio-client/src/shared/ui/notification-toaster/notification-toaster.js'

describe('NotificationToaster.readToastCopyText', () => {
  it('copies the visible title and description as plain text', () => {
    const toast = {
      querySelector(selector: string) {
        if (selector === '[data-title]') return { textContent: 'Request failed' }
        if (selector === '[data-description]') return { textContent: 'Provider unavailable' }
        return null
      },
    } as unknown as Element

    expect(readToastCopyText(toast)).toBe('Request failed\nProvider unavailable')
  })
})
