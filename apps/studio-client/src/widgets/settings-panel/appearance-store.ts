import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { safeLocalStorage } from '../../shared/browser/safe-local-storage.js'

export type AppearanceBackground = { id: string; image: string }
export type AppearanceMaterial = { mode: 'solid' | 'translucent' | 'glass'; blur: number; opacity: number }
type AppearanceState = {
  background: AppearanceBackground | null
  canvasWidth: number
  followAI: boolean
  material: AppearanceMaterial
  setBackground(background: AppearanceBackground | null): void
  setCanvasWidth(width: number): void
  setFollowAI(value: boolean): void
  setMaterial(value: AppearanceMaterial): void
}

export const useAppearanceStore = create<AppearanceState>()(persist((set) => ({
  background: { id: 'harbor', image: '/images/banner.png' },
  canvasWidth: 720,
  followAI: true,
  material: { mode: 'glass', blur: 18, opacity: 62 },
  setBackground: background => set({ background }),
  setCanvasWidth: canvasWidth => set({ canvasWidth }),
  setFollowAI: followAI => set({ followAI }),
  setMaterial: material => set({ material }),
}), {
  name: 'loom-studio-appearance',
  storage: createJSONStorage(() => safeLocalStorage),
  partialize: state => ({
    background: state.background,
    canvasWidth: state.canvasWidth,
    followAI: state.followAI,
    material: state.material,
  }),
}))
