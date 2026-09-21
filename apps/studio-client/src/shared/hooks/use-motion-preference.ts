import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { safeLocalStorage } from '../browser/safe-local-storage.js'

export type MotionPreference = 'system' | 'full' | 'reduce'
export type EffectiveMotion = 'full' | 'reduce'

type MotionPreferenceState = {
  preference: MotionPreference
  setPreference(preference: MotionPreference): void
}

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

export const useMotionPreferenceStore = create<MotionPreferenceState>()(persist(set => ({
  preference: 'system',
  setPreference: preference => set({ preference }),
}), {
  name: 'loom-studio-motion',
  storage: createJSONStorage(() => safeLocalStorage),
  partialize: state => ({ preference: state.preference }),
}))

export function resolveEffectiveMotion(preference: MotionPreference, systemReduced: boolean): EffectiveMotion {
  if (preference === 'system') return systemReduced ? 'reduce' : 'full'
  return preference
}

export function readEffectiveMotion(preference = useMotionPreferenceStore.getState().preference): EffectiveMotion {
  return resolveEffectiveMotion(preference, globalThis.matchMedia?.(REDUCED_MOTION_QUERY).matches ?? false)
}

export function applyEffectiveMotion(motion: EffectiveMotion): void {
  document.documentElement.dataset.loomMotion = motion
}

export function initializeMotionPreference(): void {
  applyEffectiveMotion(readEffectiveMotion())
}

export function useEffectiveMotion(): EffectiveMotion {
  const preference = useMotionPreferenceStore(state => state.preference)
  const [systemReduced, setSystemReduced] = useState(() => globalThis.matchMedia?.(REDUCED_MOTION_QUERY).matches ?? false)

  useEffect(() => {
    const query = globalThis.matchMedia?.(REDUCED_MOTION_QUERY)
    if (!query) return
    const update = () => setSystemReduced(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  return resolveEffectiveMotion(preference, systemReduced)
}
