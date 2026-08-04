import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'
import type { WindowSize } from '../window-resize.js'
import type { LongTextEditorMode } from '../../../shared/ui/long-text-editor/long-text-editor-model.js'

export const STUDIO_PANEL_IDS = ['api', 'preset', 'resources', 'editor', 'inspector', 'logs'] as const

export type StudioPanelId = (typeof STUDIO_PANEL_IDS)[number]
export type AssetLayoutId = Extract<StudioPanelId, 'preset' | 'resources'>
export type AssetViewMode = 'explorer' | 'split' | 'editor'
export type ContextCategory = 'setting' | 'logic' | 'runtime' | 'history'
export type PanelWindowMode = 'reference' | 'immersive'
export type PresetPanel = 'assets' | 'order'

export type AssetViewState = {
  expandedIds?: string[]
  selectedId?: string
  viewMode: AssetViewMode
}

type AssetLayout = {
  explorerWidth: number
  views: Record<string, AssetViewState>
}

type StudioLayoutData = {
  activePanel: StudioPanelId | null
  assetMetadataOpen: boolean
  assetLayouts: Record<AssetLayoutId, AssetLayout>
  contextCategory: ContextCategory
  dockOpen: boolean
  lastActivePanel: StudioPanelId | null
  panelWindowModes: Partial<Record<StudioPanelId, PanelWindowMode>>
  panelWindowSizes: Partial<Record<StudioPanelId, WindowSize>>
  presetPanel: PresetPanel
  textEditorMode: LongTextEditorMode
}

type StudioLayoutStore = StudioLayoutData & {
  closeDock(): void
  setAssetMetadataOpen(open: boolean): void
  setAssetExpandedIds(layoutId: AssetLayoutId, workspaceId: string, expandedIds: string[]): void
  setAssetExplorerWidth(layoutId: AssetLayoutId, width: number): void
  setAssetSelectedId(layoutId: AssetLayoutId, workspaceId: string, selectedId?: string): void
  setAssetViewMode(layoutId: AssetLayoutId, workspaceId: string, viewMode: AssetViewMode): void
  setContextCategory(category: ContextCategory): void
  setPanelWindowSize(panel: StudioPanelId, size: WindowSize): void
  setPresetPanel(panel: PresetPanel): void
  setTextEditorMode(mode: LongTextEditorMode): void
  toggleDock(): void
  togglePanel(panel: StudioPanelId): void
  togglePanelWindowMode(panel: StudioPanelId): void
  toggleWorkspace(): void
}

const STORAGE_KEY = 'loom-studio-layout'
const STORAGE_VERSION = 6
const DEFAULT_EXPLORER_WIDTH = 300
export const DEFAULT_ASSET_VIEW_STATE: AssetViewState = { viewMode: 'explorer' }
const safeStorage: StateStorage = {
  getItem: name => {
    try {
      return globalThis.localStorage?.getItem(name) ?? null
    } catch {
      return null
    }
  },
  removeItem: name => {
    try {
      globalThis.localStorage?.removeItem(name)
    } catch {
      // Layout persistence is optional when browser storage is unavailable.
    }
  },
  setItem: (name, value) => {
    try {
      globalThis.localStorage?.setItem(name, value)
    } catch {
      // Layout persistence is optional when browser storage is unavailable.
    }
  },
}

export function createDefaultStudioLayout(): StudioLayoutData {
  return {
    activePanel: null,
    assetMetadataOpen: false,
    assetLayouts: {
      preset: { explorerWidth: DEFAULT_EXPLORER_WIDTH, views: {} },
      resources: { explorerWidth: DEFAULT_EXPLORER_WIDTH, views: {} },
    },
    contextCategory: 'setting',
    dockOpen: false,
    lastActivePanel: null,
    panelWindowModes: {},
    panelWindowSizes: {},
    presetPanel: 'assets',
    textEditorMode: 'source',
  }
}

export function sanitizeStudioLayout(value: unknown): StudioLayoutData {
  const defaults = createDefaultStudioLayout()
  if (!isRecord(value)) return defaults

  const activePanel = readPanelId(value.activePanel)
  const lastActivePanel = readPanelId(value.lastActivePanel) ?? activePanel

  return {
    activePanel,
    assetMetadataOpen: value.assetMetadataOpen === true,
    assetLayouts: {
      preset: readAssetLayout(value.assetLayouts, 'preset', defaults.assetLayouts.preset),
      resources: readAssetLayout(value.assetLayouts, 'resources', defaults.assetLayouts.resources),
    },
    contextCategory: isContextCategory(value.contextCategory) ? value.contextCategory : defaults.contextCategory,
    dockOpen: activePanel !== null || value.dockOpen === true,
    lastActivePanel,
    panelWindowModes: readPanelWindowModes(value.panelWindowModes),
    panelWindowSizes: readPanelWindowSizes(value.panelWindowSizes),
    presetPanel: value.presetPanel === 'order' ? 'order' : defaults.presetPanel,
    textEditorMode: value.textEditorMode === 'preview' ? 'preview' : defaults.textEditorMode,
  }
}

export const useStudioLayoutStore = create<StudioLayoutStore>()(
  persist(
    (set) => ({
      ...createDefaultStudioLayout(),
      closeDock: () => set({ activePanel: null, dockOpen: false }),
      setAssetMetadataOpen: assetMetadataOpen => set({ assetMetadataOpen }),
      setAssetExpandedIds: (layoutId, workspaceId, expandedIds) => set(state => ({
        assetLayouts: {
          ...state.assetLayouts,
          [layoutId]: {
            ...state.assetLayouts[layoutId],
            views: {
              ...state.assetLayouts[layoutId].views,
              [workspaceId]: {
                ...(state.assetLayouts[layoutId].views[workspaceId] ?? DEFAULT_ASSET_VIEW_STATE),
                expandedIds: [...new Set(expandedIds)],
              },
            },
          },
        },
      })),
      setAssetExplorerWidth: (layoutId, explorerWidth) => set(state => ({
        assetLayouts: {
          ...state.assetLayouts,
          [layoutId]: { ...state.assetLayouts[layoutId], explorerWidth },
        },
      })),
      setAssetSelectedId: (layoutId, workspaceId, selectedId) => set(state => ({
        assetLayouts: {
          ...state.assetLayouts,
          [layoutId]: {
            ...state.assetLayouts[layoutId],
            views: {
              ...state.assetLayouts[layoutId].views,
              [workspaceId]: {
                ...(state.assetLayouts[layoutId].views[workspaceId] ?? DEFAULT_ASSET_VIEW_STATE),
                selectedId,
              },
            },
          },
        },
      })),
      setAssetViewMode: (layoutId, workspaceId, viewMode) => set(state => ({
        assetLayouts: {
          ...state.assetLayouts,
          [layoutId]: {
            ...state.assetLayouts[layoutId],
            views: {
              ...state.assetLayouts[layoutId].views,
              [workspaceId]: {
                ...(state.assetLayouts[layoutId].views[workspaceId] ?? DEFAULT_ASSET_VIEW_STATE),
                viewMode,
              },
            },
          },
        },
      })),
      setContextCategory: contextCategory => set({ contextCategory }),
      setPanelWindowSize: (panel, size) => set(state => ({
        panelWindowSizes: { ...state.panelWindowSizes, [panel]: size },
      })),
      setPresetPanel: presetPanel => set({ presetPanel }),
      setTextEditorMode: textEditorMode => set({ textEditorMode }),
      toggleDock: () => set(state => state.dockOpen || state.activePanel !== null
        ? { activePanel: null, dockOpen: false }
        : { activePanel: state.lastActivePanel, dockOpen: true }),
      togglePanel: panel => set(state => state.activePanel === panel
        ? { activePanel: null, dockOpen: true, lastActivePanel: panel }
        : { activePanel: panel, dockOpen: true, lastActivePanel: panel }),
      togglePanelWindowMode: panel => set(state => ({
        panelWindowModes: {
          ...state.panelWindowModes,
          [panel]: state.panelWindowModes[panel] === 'immersive' ? 'reference' : 'immersive',
        },
      })),
      toggleWorkspace: () => set(state => state.activePanel === null
        ? { activePanel: 'resources', dockOpen: true, lastActivePanel: 'resources' }
        : { activePanel: null, dockOpen: true }),
    }),
    {
      name: STORAGE_KEY,
      version: STORAGE_VERSION,
      storage: createJSONStorage(() => safeStorage),
      migrate: persisted => sanitizeStudioLayout(persisted),
      merge: (persisted, current) => ({ ...current, ...sanitizeStudioLayout(persisted) }),
      partialize: state => ({
        activePanel: state.activePanel,
        assetMetadataOpen: state.assetMetadataOpen,
        assetLayouts: state.assetLayouts,
        contextCategory: state.contextCategory,
        dockOpen: state.dockOpen,
        lastActivePanel: state.lastActivePanel,
        panelWindowModes: state.panelWindowModes,
        panelWindowSizes: state.panelWindowSizes,
        presetPanel: state.presetPanel,
        textEditorMode: state.textEditorMode,
      }),
    },
  ),
)

function readAssetLayout(value: unknown, id: AssetLayoutId, fallback: AssetLayout): AssetLayout {
  if (!isRecord(value) || !isRecord(value[id])) return fallback
  const layout = value[id]
  return {
    explorerWidth: isFinitePositiveNumber(layout.explorerWidth) ? layout.explorerWidth : fallback.explorerWidth,
    views: readAssetViews(layout.views),
  }
}

function readAssetViews(value: unknown): Record<string, AssetViewState> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(Object.entries(value).flatMap(([workspaceId, state]) => {
    if (!workspaceId || !isRecord(state) || !isAssetViewMode(state.viewMode)) return []
    const selectedId = typeof state.selectedId === 'string' && state.selectedId ? state.selectedId : undefined
    const expandedIds = Array.isArray(state.expandedIds)
      ? [...new Set(state.expandedIds.filter((id): id is string => typeof id === 'string' && id.length > 0))]
      : undefined
    return [[workspaceId, {
      ...(expandedIds ? { expandedIds } : {}),
      ...(selectedId ? { selectedId } : {}),
      viewMode: state.viewMode,
    }]]
  }))
}

function readPanelWindowSizes(value: unknown): Partial<Record<StudioPanelId, WindowSize>> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(STUDIO_PANEL_IDS.flatMap(panel => {
    const size = value[panel]
    return isRecord(size) && isFinitePositiveNumber(size.width) && isFinitePositiveNumber(size.height)
      ? [[panel, { width: size.width, height: size.height }]]
      : []
  }))
}

function readPanelWindowModes(value: unknown): Partial<Record<StudioPanelId, PanelWindowMode>> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(STUDIO_PANEL_IDS.flatMap(panel => {
    const mode = value[panel]
    return mode === 'reference' || mode === 'immersive' ? [[panel, mode]] : []
  }))
}

function readPanelId(value: unknown): StudioPanelId | null {
  return typeof value === 'string' && STUDIO_PANEL_IDS.includes(value as StudioPanelId)
    ? value as StudioPanelId
    : null
}

function isContextCategory(value: unknown): value is ContextCategory {
  return value === 'setting' || value === 'logic' || value === 'runtime' || value === 'history'
}

function isAssetViewMode(value: unknown): value is AssetViewMode {
  return value === 'explorer' || value === 'split' || value === 'editor'
}

function isFinitePositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
