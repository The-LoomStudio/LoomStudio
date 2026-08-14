import { memo, useEffect, useState, type ReactNode } from 'react'
import { Columns2, FilePenLine, Folders, ListOrdered, ListTree, Maximize2, Minimize2, Plug, Settings, SquareTerminal, Users, Wrench, type LucideIcon } from 'lucide-react'
import type { Translator } from '../../shared/i18n/index.js'
import { DEFAULT_ASSET_VIEW_STATE, STUDIO_PANEL_IDS, useStudioLayoutStore, type AssetLayoutId, type AssetViewMode, type StudioPanelId } from './model/studio-layout-store.js'
import styles from './studio-page.module.scss'

type StudioPanelHostProps = {
  activePanel: StudioPanelId | null
  assetWorkspaceId: string
  panelHeaders?: Partial<Record<StudioPanelId, ReactNode>>
  panels: Record<StudioPanelId, (active: boolean) => ReactNode>
  t: Translator
}

type PanelDefinition = {
  labelKey: 'rail.model' | 'rail.character' | 'rail.preset' | 'rail.resource' | 'rail.inspector' | 'rail.logs' | 'rail.settings'
}

const PANEL_DEFINITIONS = {
  model: { labelKey: 'rail.model' },
  character: { labelKey: 'rail.character' },
  preset: { labelKey: 'rail.preset' },
  resource: { labelKey: 'rail.resource' },
  inspector: { labelKey: 'rail.inspector' },
  logs: { labelKey: 'rail.logs' },
  settings: { labelKey: 'rail.settings' },
} satisfies Record<StudioPanelId, PanelDefinition>

const PANEL_ICONS: Record<StudioPanelId, LucideIcon> = {
  model: Plug,
  character: Users,
  preset: ListOrdered,
  resource: Folders,
  inspector: Wrench,
  logs: SquareTerminal,
  settings: Settings,
}

export function StudioPanelHost(props: StudioPanelHostProps) {
  const activeAssetLayoutId = readAssetLayoutId(props.activePanel)
  const activeAssetViewModePreference = useStudioLayoutStore(state => activeAssetLayoutId === null
    ? null
    : (state.assetLayouts[activeAssetLayoutId].views[props.assetWorkspaceId] ?? DEFAULT_ASSET_VIEW_STATE).viewMode)
  const activeAssetHasSelection = useStudioLayoutStore(state => activeAssetLayoutId !== null
    && Boolean(state.assetLayouts[activeAssetLayoutId].views[props.assetWorkspaceId]?.selectedId))
  const panelWindowModes = useStudioLayoutStore(state => state.panelWindowModes)
  const setAssetViewMode = useStudioLayoutStore(state => state.setAssetViewMode)
  const togglePanelWindowMode = useStudioLayoutStore(state => state.togglePanelWindowMode)
  const isImmersive = props.activePanel !== null && panelWindowModes[props.activePanel] === 'immersive'
  const definition = props.activePanel === null ? null : PANEL_DEFINITIONS[props.activePanel]
  const ActivePanelIcon = props.activePanel === null ? null : PANEL_ICONS[props.activePanel]
  const customHeader = props.activePanel === null ? null : props.panelHeaders?.[props.activePanel]
  const activeAssetViewMode = activeAssetViewModePreference === null
    ? null
    : activeAssetHasSelection ? activeAssetViewModePreference : 'explorer'

  return (
    <div className={styles.dockPanelHost}>
      {definition && ActivePanelIcon ? (
        <header className={`loom-page-header ${styles.workspaceHeader}`} data-loom-component="page-header">
          {customHeader ?? <><ActivePanelIcon aria-hidden="true" /><span className="loom-page-header-title">{props.t(definition.labelKey)}</span></>}
          {activeAssetLayoutId && activeAssetViewMode ? (
            <div
              aria-label={props.t('context.viewModeLabel')}
              className={styles.viewModeControl}
              data-loom-component="asset-view-mode-control"
              role="group"
            >
              {VIEW_MODES.map(({ Icon, mode, titleKey }) => (
                <button
                  key={mode}
                  aria-label={props.t(titleKey)}
                  aria-pressed={activeAssetViewMode === mode}
                  className={activeAssetViewMode === mode ? styles.viewModeButtonActive : styles.viewModeButton}
                  disabled={mode !== 'explorer' && !activeAssetHasSelection}
                  title={props.t(titleKey)}
                  type="button"
                  onClick={() => setAssetViewMode(activeAssetLayoutId, props.assetWorkspaceId, mode)}
                >
                  <Icon aria-hidden="true" />
                </button>
              ))}
            </div>
          ) : null}
          <button
            aria-label={props.t(isImmersive ? 'window.exitImmersive' : 'window.enterImmersive')}
            aria-pressed={isImmersive}
            className={`${styles.windowModeButton} ${isImmersive ? styles.windowModeButtonActive : ''}`}
            data-loom-component="window-mode-toggle"
            title={props.t(isImmersive ? 'window.exitImmersive' : 'window.enterImmersive')}
            type="button"
            onClick={() => {
              if (props.activePanel !== null) togglePanelWindowMode(props.activePanel)
            }}
          >
            {isImmersive ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
          </button>
        </header>
      ) : null}
      <span className={`loom-divider ${styles.workspaceHeaderDivider}`} aria-hidden="true" />
      <div className={styles.workspaceBody}>
        {STUDIO_PANEL_IDS.map(panel => (
          <StudioPanelStage key={panel} active={props.activePanel === panel} panel={panel} render={props.panels[panel]} />
        ))}
      </div>
    </div>
  )
}

const StudioPanelStage = memo(function StudioPanelStage(props: {
  active: boolean
  panel: StudioPanelId
  render(active: boolean): ReactNode
}) {
  const [visited, setVisited] = useState(props.active)

  useEffect(() => {
    if (props.active) setVisited(true)
  }, [props.active])

  return (
    <div
      className={styles.panelStage}
      id={`studio-${props.panel}-panel`}
      aria-hidden={!props.active}
      hidden={!props.active}
      data-loom-component={`overlay-${props.panel}-layer`}
      data-loom-object={`${props.panel}-panel`}
    >
      {visited || props.active ? props.render(props.active) : null}
    </div>
  )
}, (previous, next) => previous.panel === next.panel && !previous.active && !next.active)

const VIEW_MODES: Array<{
  Icon: LucideIcon
  mode: AssetViewMode
  titleKey: 'context.viewModeExplorer' | 'context.viewModeSplit' | 'context.viewModeEditor'
}> = [
  { Icon: ListTree, mode: 'explorer', titleKey: 'context.viewModeExplorer' },
  { Icon: Columns2, mode: 'split', titleKey: 'context.viewModeSplit' },
  { Icon: FilePenLine, mode: 'editor', titleKey: 'context.viewModeEditor' },
]

function readAssetLayoutId(panel: StudioPanelId | null): AssetLayoutId | null {
  if (panel === 'preset') return 'preset'
  if (panel === 'resource') return 'resources'
  return null
}
