import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { safeLocalStorage } from '../browser/safe-local-storage.js'

type AppearanceBackground = { id: string; image: string }
type AppearanceMaterial = { mode: 'solid' | 'translucent' | 'glass'; blur: number; opacity: number; glassPanels?: boolean }
export type AppearanceState = {
  background: AppearanceBackground | null
  scopedBackground: (AppearanceBackground & { cardId: string; ownerKey: string }) | null
  canvasWidth: number
  explicitOverrides: { canvasWidth?: true; blur?: true; opacity?: true }
  narrativeOverscan: number
  focusComposerOnStartup: boolean
  followAI: boolean
  material: AppearanceMaterial
  setBackground(background: AppearanceBackground | null): void
  setScopedBackground(background: NonNullable<AppearanceState['scopedBackground']>): void
  clearScopedBackground(ownerKey: string, backgroundId?: string): void
  setCanvasWidth(width: number): void
  resetCanvasWidth(): void
  resetMaterial(): void
  setMaterialParameter(parameter: 'blur' | 'opacity', value: number | undefined): void
  setNarrativeOverscan(count: number): void
  setFocusComposerOnStartup(value: boolean): void
  setFollowAI(value: boolean): void
  setMaterial(value: AppearanceMaterial): void
}

export const APPEARANCE_DEFAULTS = {
  canvasWidth: 720,
  material: { mode: 'glass', blur: 18, opacity: 62, glassPanels: true } satisfies AppearanceMaterial,
}

export const useAppearanceStore = create<AppearanceState>()(persist((set) => ({
  background: null,
  scopedBackground: null,
  canvasWidth: APPEARANCE_DEFAULTS.canvasWidth,
  explicitOverrides: {},
  narrativeOverscan: 5,
  focusComposerOnStartup: false,
  followAI: true,
  material: { ...APPEARANCE_DEFAULTS.material },
  setBackground: background => set({ background, scopedBackground: null }),
  setScopedBackground: scopedBackground => set({ scopedBackground }),
  clearScopedBackground: (ownerKey, backgroundId) => set(state => state.scopedBackground?.ownerKey === ownerKey
    && (backgroundId === undefined || state.scopedBackground.id === backgroundId) ? { scopedBackground: null } : state),
  setCanvasWidth: canvasWidth => set(state => ({ canvasWidth, explicitOverrides: { ...state.explicitOverrides, canvasWidth: true } })),
  resetCanvasWidth: () => set(state => ({
    canvasWidth: APPEARANCE_DEFAULTS.canvasWidth,
    explicitOverrides: { blur: state.explicitOverrides.blur, opacity: state.explicitOverrides.opacity },
  })),
  resetMaterial: () => set(state => ({
    material: { ...APPEARANCE_DEFAULTS.material },
    explicitOverrides: { ...(state.explicitOverrides.canvasWidth ? { canvasWidth: true as const } : {}) },
  })),
  setMaterialParameter: (parameter, value) => set(state => {
    const explicitOverrides = { ...state.explicitOverrides }
    if (value === undefined) delete explicitOverrides[parameter]
    else explicitOverrides[parameter] = true
    return { material: { ...state.material, [parameter]: value ?? APPEARANCE_DEFAULTS.material[parameter] }, explicitOverrides }
  }),
  setNarrativeOverscan: narrativeOverscan => set({ narrativeOverscan }),
  setFocusComposerOnStartup: focusComposerOnStartup => set({ focusComposerOnStartup }),
  setFollowAI: followAI => set({ followAI }),
  setMaterial: material => set(state => ({ material, explicitOverrides: {
    ...state.explicitOverrides,
    ...(material.blur !== state.material.blur ? { blur: true as const } : {}),
    ...(material.opacity !== state.material.opacity ? { opacity: true as const } : {}),
  } })),
}), {
  name: 'loom-studio-appearance',
  storage: createJSONStorage(() => safeLocalStorage),
  merge: (persisted, current) => {
    if (!persisted || typeof persisted !== 'object' || Array.isArray(persisted)) return current
    const saved = persisted as Record<string, unknown>
    const material = saved.material && typeof saved.material === 'object'
      ? saved.material as Record<string, unknown> : {}
    const background = saved.background && typeof saved.background === 'object'
      ? saved.background as Record<string, unknown> : undefined
    const restored: AppearanceState = {
      ...current,
      background: saved.background === null ? null
        : background && typeof background.id === 'string' && typeof background.image === 'string'
          ? { id: background.id, image: background.image } : current.background,
      canvasWidth: typeof saved.canvasWidth === 'number' && Number.isFinite(saved.canvasWidth)
        && saved.canvasWidth >= 540 && saved.canvasWidth <= 1120 ? saved.canvasWidth : current.canvasWidth,
      narrativeOverscan: typeof saved.narrativeOverscan === 'number' && Number.isInteger(saved.narrativeOverscan)
        && saved.narrativeOverscan >= 0 && saved.narrativeOverscan <= 50 ? saved.narrativeOverscan : current.narrativeOverscan,
      focusComposerOnStartup: saved.focusComposerOnStartup === true,
      followAI: typeof saved.followAI === 'boolean' ? saved.followAI : current.followAI,
      material: {
        mode: material.mode === 'solid' || material.mode === 'translucent' || material.mode === 'glass' ? material.mode : current.material.mode,
        blur: typeof material.blur === 'number' && Number.isFinite(material.blur)
          && material.blur >= 0 && material.blur <= 32 ? material.blur : current.material.blur,
        opacity: typeof material.opacity === 'number' && Number.isFinite(material.opacity)
          && material.opacity >= 0 && material.opacity <= 100 ? material.opacity : current.material.opacity,
        glassPanels: typeof material.glassPanels === 'boolean' ? material.glassPanels : (current.material.glassPanels ?? true),
      },
    }
    const overrides = saved.explicitOverrides
    if (overrides && typeof overrides === 'object' && !Array.isArray(overrides)) {
      const flags = overrides as Record<string, unknown>
      restored.explicitOverrides = {
        ...(flags.canvasWidth === true ? { canvasWidth: true as const } : {}),
        ...(flags.blur === true ? { blur: true as const } : {}),
        ...(flags.opacity === true ? { opacity: true as const } : {}),
      }
    } else {
      restored.explicitOverrides = {}
    }
    return restored
  },
  partialize: state => ({
    background: state.background,
    canvasWidth: state.canvasWidth,
    explicitOverrides: state.explicitOverrides,
    narrativeOverscan: state.narrativeOverscan,
    focusComposerOnStartup: state.focusComposerOnStartup,
    followAI: state.followAI,
    material: state.material,
  }),
}))
