import { describe, expect, it } from 'vitest'
import { resolveEffectiveMotion } from '../../../apps/studio-client/src/shared/hooks/use-motion-preference.js'

describe('motion preference', () => {
  it('follows the system only when requested', () => {
    expect(resolveEffectiveMotion('system', false)).toBe('full')
    expect(resolveEffectiveMotion('system', true)).toBe('reduce')
    expect(resolveEffectiveMotion('full', true)).toBe('full')
    expect(resolveEffectiveMotion('reduce', false)).toBe('reduce')
  })
})
