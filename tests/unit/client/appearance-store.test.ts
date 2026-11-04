import { describe, expect, it } from 'vitest'
import { useAppearanceStore } from '../../../apps/studio-client/src/shared/studio-shell/appearance-store.js'

describe('appearance persistence boundary', () => {
  const current = useAppearanceStore.getState()
  const merge = useAppearanceStore.persist.getOptions().merge!

  it.each([null, [], { material: null }, { material: { mode: 'invalid', blur: '18', opacity: Infinity } }])('keeps valid defaults for damaged state: %j', saved => {
    const result = merge(saved, current)
    expect(result.material).toEqual(current.material)
    expect(result.setMaterial).toBe(current.setMaterial)
  })

  it('preserves valid fields while ignoring invalid and nonpersistent fields', () => {
    const result = merge({
      material: { mode: 'solid', blur: 12, opacity: -1 }, canvasWidth: 900,
      narrativeOverscan: NaN, followAI: false, background: { id: 'wall', image: '/wall.png' },
      explicitOverrides: { canvasWidth: true, blur: true, material: true },
      scopedBackground: { id: 'forged' }, setMaterial: null,
    }, current)
    expect(result).toMatchObject({
      material: { mode: 'solid', blur: 12, opacity: current.material.opacity },
      canvasWidth: 900, narrativeOverscan: current.narrativeOverscan, explicitOverrides: { canvasWidth: true, blur: true },
      followAI: false, background: { id: 'wall', image: '/wall.png' }, scopedBackground: current.scopedBackground,
    })
    expect(result.setMaterial).toBe(current.setMaterial)
    expect(result.explicitOverrides).toEqual({ canvasWidth: true, blur: true })
    expect(merge({ canvasWidth: 900, material: { blur: 12 } }, current).explicitOverrides).toEqual({})
  })

  it('preserves glassPanels boolean preference', () => {
    const disabled = merge({ material: { glassPanels: false } }, current)
    expect(disabled.material.glassPanels).toBe(false)
    const enabled = merge({ material: { glassPanels: true } }, current)
    expect(enabled.material.glassPanels).toBe(true)
  })
})
