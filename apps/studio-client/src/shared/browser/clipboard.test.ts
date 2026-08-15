import { afterEach, describe, expect, it, vi } from 'vitest'
import { tryWriteClipboardText } from './clipboard.js'

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')

afterEach(() => {
  if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator)
  else Reflect.deleteProperty(globalThis, 'navigator')
})

describe('tryWriteClipboardText', () => {
  it('returns the clipboard result without leaking rejection control flow', async () => {
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('denied'))
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText } } })

    await expect(tryWriteClipboardText('first')).resolves.toBe(true)
    await expect(tryWriteClipboardText('second')).resolves.toBe(false)
    expect(writeText).toHaveBeenNthCalledWith(1, 'first')
    expect(writeText).toHaveBeenNthCalledWith(2, 'second')
  })
})
