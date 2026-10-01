import { describe, expect, it } from 'vitest'
import { countText, applyTokenMultiplier } from '@loom-studio/tokenizer'

describe('literal text token counting', () => {
  it('counts empty, mixed text, whitespace and code deterministically', () => {
    expect(countText('').baseTokens).toBe(0)
    for (const text of ['你好 world\n', 'const x = { name: "角色" };', '   ', 'a\r\nb']) {
      const result = countText(text)
      expect(result.baseTokens).toBeGreaterThan(0)
      expect(countText(text)).toEqual(result)
      expect(result.estimatedTokens).toBe(result.baseTokens)
    }
  })
  it('counts special marker strings literally', () => {
    expect(countText('<|endoftext|>').baseTokens).toBeGreaterThan(1)
    expect(countText('<|im_start|>system').baseTokens).toBeGreaterThan(1)
  })
  it('applies rounding only after summing and rejects invalid multipliers', () => {
    expect(applyTokenMultiplier(3, 0.6).estimatedTokens).toBe(2)
    for (const multiplier of [0, -1, Infinity, NaN]) {
      expect(() => countText('', { multiplier })).toThrow(RangeError)
    }
    expect(() => applyTokenMultiplier(Number.MAX_SAFE_INTEGER, 2)).toThrow(RangeError)
  })
})
