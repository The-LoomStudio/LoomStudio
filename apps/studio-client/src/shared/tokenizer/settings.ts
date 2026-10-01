import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { safeLocalStorage } from '../browser/safe-local-storage.js'
import { applyTokenMultiplier } from '@loom-studio/tokenizer/contracts'

export const useTokenDisplaySettings = create<{
  multiplier: number
  setMultiplier(value: number): void
}>()(persist(set => ({
  multiplier: 1,
  setMultiplier: multiplier => {
    applyTokenMultiplier(0, multiplier)
    set({ multiplier })
  },
}), {
  name: 'loom-studio-token-display',
  storage: createJSONStorage(() => safeLocalStorage),
  partialize: state => ({ multiplier: state.multiplier }),
}))
