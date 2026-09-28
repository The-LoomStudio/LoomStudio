import { afterEach, expect, it, vi } from 'vitest'
import { useAppearanceStore } from '../../../apps/studio-client/src/shared/studio-shell/appearance-store.js'

afterEach(() => vi.unstubAllGlobals())

it('persists and restores the message buffer without changing other appearance fields', async () => {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  })
  const key = useAppearanceStore.persist.getOptions().name
  if (!key) throw new Error('Appearance persistence requires a storage key')
  useAppearanceStore.getState().setNarrativeOverscan(12)
  const saved = values.get(key)!
  expect(JSON.parse(saved).state.narrativeOverscan).toBe(12)
  const width = useAppearanceStore.getState().canvasWidth
  useAppearanceStore.getState().setNarrativeOverscan(0)
  values.set(key, saved)
  await useAppearanceStore.persist.rehydrate()
  expect(useAppearanceStore.getState().narrativeOverscan).toBe(12)
  expect(useAppearanceStore.getState().canvasWidth).toBe(width)
})
