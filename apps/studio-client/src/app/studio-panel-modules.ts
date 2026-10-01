import { lazy } from 'react'
import type { StudioPanelId } from '../shared/studio-shell/studio-layout-store.js'

const loadModelPanel = () => import('../widgets/model-panel/model-panel.js')
const loadPlayPanel = () => import('../widgets/play-panel/play-panel.js')
const loadSessionsPanel = () => import('../widgets/sessions-panel/sessions-panel.js')
const loadCharacterPanel = () => import('../widgets/character-panel/character-panel.js')
const loadPresetWorkbench = () => import('../widgets/preset-workbench/preset-workbench.js')
const loadContextWorkbench = () => import('../widgets/context-workbench/context-workbench.js')
const loadStudioStatePanel = () => import('./studio-state-panel.js')
const loadMacroPanel = () => import('./studio-macro-panel.js')
const loadTextTransformPanel = () => import('./studio-text-transform-panel.js')
const loadInspectorPanel = () => import('../widgets/inspector-panel/inspector-panel.js')
const loadLogViewer = () => import('../widgets/log-viewer/log-viewer.js')
const loadRendererWorkspacePanel = () => import('../features/extension-renderers/ui/renderer-workspace-panel.js')
const loadSettingsPanel = () => import('../widgets/settings-panel/settings-panel.js')
const loadUserResourcesPanel = () => import('../widgets/user-resources-panel/user-resources-panel.js')

export const LazyModelPanel = lazy(async () => ({ default: (await loadModelPanel()).ModelPanel }))
export const LazyPlayPanel = lazy(async () => ({ default: (await loadPlayPanel()).PlayPanel }))
export const LazyRecentPlayPanel = lazy(async () => ({ default: (await loadPlayPanel()).RecentPlayPanel }))
export const LazySessionsPanel = lazy(async () => ({ default: (await loadSessionsPanel()).SessionsPanel }))
export const LazyCharacterPanel = lazy(async () => ({ default: (await loadCharacterPanel()).CharacterPanel }))
export const LazyPresetWorkbench = lazy(async () => ({ default: (await loadPresetWorkbench()).PresetWorkbench }))
export const LazyContextWorkbench = lazy(async () => ({ default: (await loadContextWorkbench()).ContextWorkbench }))
export const LazyStudioStatePanel = lazy(async () => ({ default: (await loadStudioStatePanel()).StudioStatePanel }))
export const LazyMacroPanel = lazy(async () => ({ default: (await loadMacroPanel()).StudioMacroPanel }))
export const LazyTextTransformPanel = lazy(async () => ({ default: (await loadTextTransformPanel()).StudioTextTransformPanel }))
export const LazyInspectorPanel = lazy(async () => ({ default: (await loadInspectorPanel()).InspectorPanel }))
export const LazyLogViewer = lazy(async () => ({ default: (await loadLogViewer()).LogViewer }))
export const LazyRendererWorkspacePanel = lazy(async () => ({ default: (await loadRendererWorkspacePanel()).RendererWorkspacePanel }))
export const LazySettingsPanel = lazy(async () => ({ default: (await loadSettingsPanel()).SettingsPanel }))
export const LazyUserResourcesPanel = lazy(async () => ({ default: (await loadUserResourcesPanel()).UserResourcesPanel }))

const panelLoaders: Record<StudioPanelId, () => Promise<unknown>> = {
  model: loadModelPanel,
  agent: loadPresetWorkbench,
  user: loadUserResourcesPanel,
  play: () => Promise.all([loadPlayPanel(), loadCharacterPanel(), loadSessionsPanel()]),
  recent: loadPlayPanel,
  sessions: loadSessionsPanel,
  character: loadCharacterPanel,
  preset: loadPresetWorkbench,
  resource: loadContextWorkbench,
  state: loadStudioStatePanel,
  macro: loadMacroPanel,
  'text-transform': loadTextTransformPanel,
  inspector: loadInspectorPanel,
  logs: loadLogViewer,
  extensions: loadRendererWorkspacePanel,
  settings: loadSettingsPanel,
}

export function preloadStudioPanel(panel: StudioPanelId): void {
  void panelLoaders[panel]().catch(() => undefined)
}
