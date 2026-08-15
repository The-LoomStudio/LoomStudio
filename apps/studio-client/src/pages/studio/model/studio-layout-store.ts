import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { safeLocalStorage } from '../../../shared/browser/safe-local-storage.js'
import type { WindowSize } from '../window-resize.js'
import type { LongTextEditorMode } from '../../../shared/ui/long-text-editor/long-text-editor-model.js'

export const STUDIO_PANEL_IDS = ['model', 'agent', 'character', 'preset', 'resource', 'inspector', 'logs', 'settings'] as const

export type StudioPanelId = (typeof STUDIO_PANEL_IDS)[number]
export type AssetLayoutId = 'preset' | 'resources'
export type AssetViewMode = 'explorer' | 'split' | 'editor'
export type ContextCategory = 'setting' | 'logic' | 'runtime' | 'history'
export type PanelWindowMode = 'reference' | 'immersive'
export type PresetView = 'assets' | 'order'

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
  assetMetadataOpen: boolean
  assetLayouts: Record<AssetLayoutId, AssetLayout>
  contextCategory: ContextCategory
  dockOpen: boolean
  panelWindowModes: Partial<Record<StudioPanelId, PanelWindowMode>>
  panelWindowSizes: Partial<Record<StudioPanelId, WindowSize>>
  presetView: PresetView
  railWidth: number
  textEditorMode: LongTextEditorMode
  uiScale: number
}

type StudioLayoutStore = StudioLayoutData & {
  closeDock(): void
  openAssetDetail(layoutId: AssetLayoutId, workspaceId: string, selectedId: string): void
  setAssetMetadataOpen(open: boolean): void
  setAssetExpandedIds(layoutId: AssetLayoutId, workspaceId: string, expandedIds: string[]): void
  setAssetExplorerWidth(layoutId: AssetLayoutId, width: number): void
  setAssetSelectedId(layoutId: AssetLayoutId, workspaceId: string, selectedId?: string): void
  setAssetViewMode(layoutId: AssetLayoutId, workspaceId: string, viewMode: AssetViewMode): void
  setContextCategory(category: ContextCategory): void
  setPanelWindowSize(panel: StudioPanelId, size: WindowSize): void
  setPresetView(view: PresetView): void
  setRailWidth(width: number): void
  setTextEditorMode(mode: LongTextEditorMode): void
  setUiScale(scale: number): void
  toggleDock(): void
  togglePanelWindowMode(panel: StudioPanelId): void
}

type StudioPanelStore = {
  activePanel: StudioPanelId | null
  closePanel(): void
  setActivePanel(panel: StudioPanelId | null): void
  togglePanel(panel: StudioPanelId): void
}

const STORAGE_KEY = 'loom-studio-layout'
const STORAGE_VERSION = 10
const DEFAULT_EXPLORER_WIDTH = 300
const DEFAULT_RAIL_WIDTH = 160
const RAIL_COLLAPSED_WIDTH = 42
const RAIL_MIN_TEXT_WIDTH = 96
const RAIL_MAX_WIDTH = 320
const UI_SCALE_DEFAULT = 100
const UI_SCALE_MIN = 80
const UI_SCALE_MAX = 125
export const DEFAULT_ASSET_VIEW_STATE: AssetViewState = { viewMode: 'explorer' }

function updateAssetView(
  state: StudioLayoutData,
  layoutId: AssetLayoutId,
  workspaceId: string,
  updates: Partial<AssetViewState>,
): Pick<StudioLayoutData, 'assetLayouts'> {
  const layout = state.assetLayouts[layoutId]
  return {
    assetLayouts: {
      ...state.assetLayouts,
      [layoutId]: {
        ...layout,
        views: {
          ...layout.views,
          [workspaceId]: {
            ...(layout.views[workspaceId] ?? DEFAULT_ASSET_VIEW_STATE),
            ...updates,
          },
        },
      },
    },
  }
}

export function createDefaultStudioLayout(): StudioLayoutData {
  return {
    assetMetadataOpen: false,
    assetLayouts: {
      preset: { explorerWidth: DEFAULT_EXPLORER_WIDTH, views: {} },
      resources: { explorerWidth: DEFAULT_EXPLORER_WIDTH, views: {} },
    },
    contextCategory: 'setting',
    dockOpen: false,
    panelWindowModes: {},
    panelWindowSizes: {},
    presetView: 'assets',
    railWidth: DEFAULT_RAIL_WIDTH,
    textEditorMode: 'source',
    uiScale: UI_SCALE_DEFAULT,
  }
}

export function sanitizeStudioLayout(value: unknown): StudioLayoutData {
  const defaults = createDefaultStudioLayout()
  if (!isRecord(value)) return defaults

  return {
    assetMetadataOpen: value.assetMetadataOpen === true,
    assetLayouts: {
      preset: readAssetLayout(value.assetLayouts, 'preset', defaults.assetLayouts.preset),
      resources: readAssetLayout(value.assetLayouts, 'resources', defaults.assetLayouts.resources),
    },
    contextCategory: isContextCategory(value.contextCategory) ? value.contextCategory : defaults.contextCategory,
    dockOpen: value.dockOpen === true || readPanelId(value.activePanel) !== null,
    panelWindowModes: readPanelWindowModes(value.panelWindowModes),
    panelWindowSizes: readPanelWindowSizes(value.panelWindowSizes),
    presetView: value.presetView === 'order' || value.presetPanel === 'order' ? 'order' : defaults.presetView,
    railWidth: readRailWidth(value.railWidth),
    textEditorMode: value.textEditorMode === 'preview' ? 'preview' : defaults.textEditorMode,
    uiScale: readUiScale(value.uiScale),
  }
}

export const useStudioPanelStore = create<StudioPanelStore>(set => ({
  activePanel: null,
  closePanel: () => set({ activePanel: null }),
  setActivePanel: activePanel => set({ activePanel }),
  togglePanel: panel => set(state => ({ activePanel: state.activePanel === panel ? null : panel })),
}))

export const useStudioLayoutStore = create<StudioLayoutStore>()(
  persist(
    (set) => ({
      ...createDefaultStudioLayout(),
      closeDock: () => set({ dockOpen: false }),
      openAssetDetail: (layoutId, workspaceId, selectedId) => set(state => {
        const current = state.assetLayouts[layoutId].views[workspaceId] ?? DEFAULT_ASSET_VIEW_STATE
        return {
          assetLayouts: {
            ...state.assetLayouts,
            [layoutId]: {
              ...state.assetLayouts[layoutId],
              views: {
                ...state.assetLayouts[layoutId].views,
                [workspaceId]: {
                  ...current,
                  selectedId,
                  viewMode: current.viewMode === 'explorer' ? 'split' : current.viewMode,
                },
              },
            },
          },
        }
      }),
      setAssetMetadataOpen: assetMetadataOpen => set({ assetMetadataOpen }),
      setAssetExpandedIds: (layoutId, workspaceId, expandedIds) => set(state => updateAssetView(
        state,
        layoutId,
        workspaceId,
        { expandedIds: [...new Set(expandedIds)] },
      )),
      setAssetExplorerWidth: (layoutId, explorerWidth) => set(state => ({
        assetLayouts: {
          ...state.assetLayouts,
          [layoutId]: { ...state.assetLayouts[layoutId], explorerWidth },
        },
      })),
      setAssetSelectedId: (layoutId, workspaceId, selectedId) => set(state => updateAssetView(state, layoutId, workspaceId, { selectedId })),
      setAssetViewMode: (layoutId, workspaceId, viewMode) => set(state => updateAssetView(state, layoutId, workspaceId, { viewMode })),
      setContextCategory: contextCategory => set({ contextCategory }),
      setPanelWindowSize: (panel, size) => set(state => ({
        panelWindowSizes: { ...state.panelWindowSizes, [panel]: size },
      })),
      setPresetView: presetView => set({ presetView }),
      setRailWidth: railWidth => set({ railWidth: readRailWidth(railWidth) }),
      setTextEditorMode: textEditorMode => set({ textEditorMode }),
      setUiScale: uiScale => set({ uiScale: readUiScale(uiScale) }),
      toggleDock: () => set(state => ({ dockOpen: !state.dockOpen })),
      togglePanelWindowMode: panel => set(state => ({
        panelWindowModes: {
          ...state.panelWindowModes,
          [panel]: state.panelWindowModes[panel] === 'immersive' ? 'reference' : 'immersive',
        },
      })),
    }),
    {
      name: STORAGE_KEY,
      version: STORAGE_VERSION,
      storage: createJSONStorage(() => safeLocalStorage),
      migrate: persisted => sanitizeStudioLayout(persisted),
      merge: (persisted, current) => ({ ...current, ...sanitizeStudioLayout(persisted) }),
      partialize: state => ({
        assetMetadataOpen: state.assetMetadataOpen,
        assetLayouts: state.assetLayouts,
        contextCategory: state.contextCategory,
        dockOpen: state.dockOpen,
        panelWindowModes: state.panelWindowModes,
        panelWindowSizes: state.panelWindowSizes,
        presetView: state.presetView,
        railWidth: state.railWidth,
        textEditorMode: state.textEditorMode,
        uiScale: state.uiScale,
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

function readRailWidth(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_RAIL_WIDTH
  if (value < RAIL_MIN_TEXT_WIDTH) return RAIL_COLLAPSED_WIDTH
  return Math.min(RAIL_MAX_WIDTH, value)
}

function readUiScale(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return UI_SCALE_DEFAULT
  return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, Math.round(value / 5) * 5))
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
    const size = value[panel] ?? value[legacyPanelId(panel)]
    return isRecord(size) && isFinitePositiveNumber(size.width) && isFinitePositiveNumber(size.height)
      ? [[panel, { width: size.width, height: size.height }]]
      : []
  }))
}

function readPanelWindowModes(value: unknown): Partial<Record<StudioPanelId, PanelWindowMode>> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(STUDIO_PANEL_IDS.flatMap(panel => {
    const mode = value[panel] ?? value[legacyPanelId(panel)]
    return mode === 'reference' || mode === 'immersive' ? [[panel, mode]] : []
  }))
}

function readPanelId(value: unknown): StudioPanelId | null {
  if (value === 'api') return 'model'
  if (value === 'resources') return 'character'
  if (value === 'editor') return 'resource'
  return typeof value === 'string' && STUDIO_PANEL_IDS.includes(value as StudioPanelId)
    ? value as StudioPanelId
    : null
}

function legacyPanelId(panel: StudioPanelId): string {
  if (panel === 'model') return 'api'
  if (panel === 'character') return 'resources'
  if (panel === 'resource') return 'editor'
  return panel
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
