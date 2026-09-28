import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { safeLocalStorage } from '../browser/safe-local-storage.js'

type AppearanceBackground = { id: string; image: string }
type AppearanceMaterial = { mode: 'solid' | 'translucent' | 'glass'; blur: number; opacity: number }
type AppearanceState = {
  background: AppearanceBackground | null
  scopedBackground: (AppearanceBackground & { cardId: string; ownerKey: string }) | null
  canvasWidth: number
  narrativeOverscan: number
  followAI: boolean
  material: AppearanceMaterial
  setBackground(background: AppearanceBackground | null): void
  setScopedBackground(background: NonNullable<AppearanceState['scopedBackground']>): void
  clearScopedBackground(ownerKey: string, backgroundId?: string): void
  setCanvasWidth(width: number): void
  setNarrativeOverscan(count: number): void
  setFollowAI(value: boolean): void
  setMaterial(value: AppearanceMaterial): void
}

export const useAppearanceStore = create<AppearanceState>()(persist((set) => ({
  background: { id: 'harbor', image: '/images/banner.png' },
  scopedBackground: null,
  canvasWidth: 720,
  narrativeOverscan: 5,
  followAI: true,
  material: { mode: 'glass', blur: 18, opacity: 62 },
  setBackground: background => set({ background, scopedBackground: null }),
  setScopedBackground: scopedBackground => set({ scopedBackground }),
  clearScopedBackground: (ownerKey, backgroundId) => set(state => state.scopedBackground?.ownerKey === ownerKey
    && (backgroundId === undefined || state.scopedBackground.id === backgroundId) ? { scopedBackground: null } : state),
  setCanvasWidth: canvasWidth => set({ canvasWidth }),
  setNarrativeOverscan: narrativeOverscan => set({ narrativeOverscan }),
  setFollowAI: followAI => set({ followAI }),
  setMaterial: material => set({ material }),
}), {
  name: 'loom-studio-appearance',
  storage: createJSONStorage(() => safeLocalStorage),
  partialize: state => ({
    background: state.background,
    canvasWidth: state.canvasWidth,
    narrativeOverscan: state.narrativeOverscan,
    followAI: state.followAI,
    material: state.material,
  }),
}))
