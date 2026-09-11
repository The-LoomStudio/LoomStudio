import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { safeLocalStorage } from '../../../shared/browser/safe-local-storage.js'
import type { WindowSize } from '../window-resize.js'
import type { LongTextEditorMode } from '../../../shared/ui/long-text-editor/long-text-editor-model.js'

export const STUDIO_PANEL_IDS = ['model', 'agent', 'sessions', 'character', 'preset', 'resource', 'state', 'text-transform', 'inspector', 'logs', 'extensions', 'settings'] as const

export type StudioPanelId = (typeof STUDIO_PANEL_IDS)[number]
export type AssetLayoutId = 'preset' | 'resources'
export type AssetViewMode = 'master-detail' | 'drilldown'
export type ContextCategory = 'setting' | 'logic' | 'runtime' | 'history'
export type PanelWindowMode = 'reference' | 'immersive'
export type PresetView = 'assets' | 'order' | 'tools' | 'macros' | 'text'

export type AssetViewState = {
  expandedIds?: string[]
  selectedId?: string
  viewMode: AssetViewMode
}

export type AssetPane = 'explorer' | 'detail'

type AssetLayout = {
  explorerWidth: number
  views: Record<string, AssetViewState>
}

type StudioLayoutData = {
  assetMetadataOpen: boolean
  assetLayouts: Record<AssetLayoutId, AssetLayout>
  assetPanes: Record<AssetLayoutId, Record<string, AssetPane>>
  contextCategory: ContextCategory
  dockOpen: boolean
  dockPinned: boolean
  panelWindowMode: PanelWindowMode
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
  setAssetPane(layoutId: AssetLayoutId, workspaceId: string, pane: AssetPane): void
  setAssetSelectedId(layoutId: AssetLayoutId, workspaceId: string, selectedId?: string): void
  setAssetViewMode(layoutId: AssetLayoutId, workspaceId: string, viewMode: AssetViewMode): void
  setContextCategory(category: ContextCategory): void
  setPanelWindowSize(panel: StudioPanelId, size: WindowSize): void
  setPresetView(view: PresetView): void
  setRailWidth(width: number): void
  setTextEditorMode(mode: LongTextEditorMode): void
  setUiScale(scale: number): void
  toggleDock(): void
  toggleDockPinned(): void
  togglePanelWindowMode(panel?: StudioPanelId): void
}

type StudioPanelStore = {
  activePanel: StudioPanelId | null
  canGoBack: boolean
  canGoForward: boolean
  closePanel(): void
  goBack(): void
  goForward(): void
  setActivePanel(panel: StudioPanelId | null, options?: { record?: boolean }): void
  syncActivePanel(panel: StudioPanelId | null): void
  togglePanel(panel: StudioPanelId): void
}

const STORAGE_KEY = 'loom-studio-layout'
const STORAGE_VERSION = 11
const DEFAULT_EXPLORER_WIDTH = 300
const DEFAULT_RAIL_WIDTH = 160
const RAIL_COLLAPSED_WIDTH = 42
const RAIL_MIN_TEXT_WIDTH = 96
const RAIL_MAX_WIDTH = 320
const UI_SCALE_DEFAULT = 100
const UI_SCALE_MIN = 80
const UI_SCALE_MAX = 125
export const DEFAULT_ASSET_VIEW_STATE: AssetViewState = { viewMode: 'master-detail' }

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
    assetPanes: { preset: {}, resources: {} },
    contextCategory: 'setting',
    dockOpen: false,
    dockPinned: true,
    panelWindowMode: 'reference',
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

  const panelWindowModes = readPanelWindowModes(value.panelWindowModes)
  const panelWindowMode: PanelWindowMode = value.panelWindowMode === 'immersive' ||
    Object.values(panelWindowModes).some(mode => mode === 'immersive')
      ? 'immersive'
      : 'reference'

  return {
    assetMetadataOpen: value.assetMetadataOpen === true,
    assetLayouts: {
      preset: readAssetLayout(value.assetLayouts, 'preset', defaults.assetLayouts.preset),
      resources: readAssetLayout(value.assetLayouts, 'resources', defaults.assetLayouts.resources),
    },
    assetPanes: defaults.assetPanes,
    contextCategory: isContextCategory(value.contextCategory) ? value.contextCategory : defaults.contextCategory,
    dockOpen: value.dockOpen === true || readPanelId(value.activePanel) !== null,
    dockPinned: value.dockPinned === undefined ? defaults.dockPinned : value.dockPinned === true,
    panelWindowMode,
    panelWindowModes,
    panelWindowSizes: readPanelWindowSizes(value.panelWindowSizes),
    presetView: value.presetView === 'text'
      ? 'text'
      : value.presetView === 'tools'
      ? 'tools'
      : value.presetView === 'macros'
        ? 'macros'
        : value.presetView === 'order' || value.presetPanel === 'order'
          ? 'order'
          : defaults.presetView,
    railWidth: readRailWidth(value.railWidth),
    textEditorMode: value.textEditorMode === 'preview' ? 'preview' : defaults.textEditorMode,
    uiScale: readUiScale(value.uiScale),
  }
}

export const useStudioPanelStore = create<StudioPanelStore>((set, get) => {
  let history: Array<StudioPanelId | null> = [null]
  let historyIndex = 0

  const recordPanel = (panel: StudioPanelId | null) => {
    const current = history[historyIndex]
    if (current === panel) return
    history = [...history.slice(0, historyIndex + 1), panel]
    historyIndex = history.length - 1
  }

  const updateNavigationState = () => ({
    activePanel: history[historyIndex],
    canGoBack: historyIndex > 0,
    canGoForward: historyIndex < history.length - 1,
  })

  return {
    activePanel: null,
    canGoBack: false,
    canGoForward: false,
    closePanel: () => {
      recordPanel(null)
      set(updateNavigationState())
    },
    goBack: () => {
      if (historyIndex === 0) return
      historyIndex -= 1
      set(updateNavigationState())
    },
    goForward: () => {
      if (historyIndex >= history.length - 1) return
      historyIndex += 1
      set(updateNavigationState())
    },
    setActivePanel: (panel, options) => {
      if (options?.record !== false) recordPanel(panel)
      else history[historyIndex] = panel
      set(updateNavigationState())
    },
    syncActivePanel: panel => {
      history[historyIndex] = panel
      set(updateNavigationState())
    },
    togglePanel: panel => {
      recordPanel(get().activePanel === panel ? null : panel)
      set(updateNavigationState())
    },
  }
})

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
      setAssetPane: (layoutId, workspaceId, pane) => set(state => ({
        assetPanes: {
          ...state.assetPanes,
          [layoutId]: {
            ...state.assetPanes[layoutId],
            [workspaceId]: pane,
          },
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
      toggleDockPinned: () => set(state => ({ dockPinned: !state.dockPinned })),
      togglePanelWindowMode: (panel?: StudioPanelId) => set(state => {
        const nextMode: PanelWindowMode = (state.panelWindowMode === 'immersive' || (panel && state.panelWindowModes[panel] === 'immersive'))
          ? 'reference'
          : 'immersive'
        const nextModes: Partial<Record<StudioPanelId, PanelWindowMode>> = nextMode === 'immersive'
          ? Object.fromEntries(STUDIO_PANEL_IDS.map(id => [id, 'immersive']))
          : {}
        return {
          panelWindowMode: nextMode,
          panelWindowModes: nextModes,
        }
      }),
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
        dockPinned: state.dockPinned,
        panelWindowMode: state.panelWindowMode,
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
    if (!workspaceId || !isRecord(state)) return []
    const viewMode = readAssetViewMode(state.viewMode)
    if (!viewMode) return []
    const selectedId = typeof state.selectedId === 'string' && state.selectedId ? state.selectedId : undefined
    const expandedIds = Array.isArray(state.expandedIds)
      ? [...new Set(state.expandedIds.filter((id): id is string => typeof id === 'string' && id.length > 0))]
      : undefined
    return [[workspaceId, {
      ...(expandedIds ? { expandedIds } : {}),
      ...(selectedId ? { selectedId } : {}),
      viewMode,
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
  return value === 'master-detail' || value === 'drilldown'
}

function readAssetViewMode(value: unknown): AssetViewMode | undefined {
  if (isAssetViewMode(value)) return value
  if (value === 'split') return 'master-detail'
  if (value === 'explorer' || value === 'editor') return 'drilldown'
  return undefined
}

function isFinitePositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
