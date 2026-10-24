import { createId } from '@loom-studio/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => vi.restoreAllMocks())

describe('shared id generation', () => {
  it('uses eleven alphanumeric characters without the namespace', () => {
    expect(createId('tool-invocation')).toMatch(/^[A-Za-z0-9]{11}$/)
  })

  it('rejects bytes outside the uniform alphabet range', () => {
    vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(array => {
      const bytes = array as Uint8Array
      bytes.set([248, 255, 0, 9, 10, 35, 36, 61, 62, 247, 1, 2, 3, 4, 5, 6])
      return array
    })
    expect(createId()).toBe('09AZaz0z123')
  })

  it('retries a taken identity before returning a fresh one', () => {
    let value = 0
    vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(array => {
      ;(array as Uint8Array).fill(value++)
      return array
    })
    expect(createId('document', id => id === '00000000000')).toBe('11111111111')
  })

  it('bounds collision retries and propagates lookup failures', () => {
    const isTaken = vi.fn(() => true)
    expect(() => createId('document', isTaken)).toThrow('Unable to allocate a unique ID')
    expect(isTaken).toHaveBeenCalledTimes(5)
    expect(() => createId('document', () => { throw new Error('Storage unavailable') })).toThrow('Storage unavailable')
  })
})
