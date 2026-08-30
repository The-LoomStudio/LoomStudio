import { afterEach, describe, expect, it, vi } from 'vitest'
import { safeLocalStorage } from '../../../apps/studio-client/src/shared/browser/safe-local-storage.js'

const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')

afterEach(() => {
  if (originalLocalStorage) Object.defineProperty(globalThis, 'localStorage', originalLocalStorage)
  else Reflect.deleteProperty(globalThis, 'localStorage')
})

describe('safeLocalStorage', () => {
  it('preserves Storage behavior when available', () => {
    const storage = {
      getItem: vi.fn(() => 'value'),
      removeItem: vi.fn(),
      setItem: vi.fn(),
    }
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })

    expect(safeLocalStorage.getItem('key')).toBe('value')
    safeLocalStorage.setItem('key', 'next')
    safeLocalStorage.removeItem('key')
    expect(storage.setItem).toHaveBeenCalledWith('key', 'next')
    expect(storage.removeItem).toHaveBeenCalledWith('key')
  })

  it('degrades safely when Storage throws', () => {
    const fail = () => { throw new Error('unavailable') }
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: fail, removeItem: fail, setItem: fail },
    })

    expect(safeLocalStorage.getItem('key')).toBeNull()
    expect(() => safeLocalStorage.setItem('key', 'value')).not.toThrow()
    expect(() => safeLocalStorage.removeItem('key')).not.toThrow()
  })
})
