import { memo, useEffect, useState, type ReactNode } from 'react'
import { Columns2, FilePenLine, ListTree, Maximize2, Minimize2, type LucideIcon } from 'lucide-react'
import type { Translator } from '../../shared/i18n/index.js'
import { DEFAULT_ASSET_VIEW_STATE, STUDIO_PANEL_IDS, useStudioLayoutStore, type AssetLayoutId, type AssetViewMode, type StudioPanelId } from './model/studio-layout-store.js'
import { STUDIO_PANEL_PRESENTATION } from './model/studio-panel-presentation.js'
import styles from './studio-page.module.scss'

type StudioPanelHostProps = {
  activePanel: StudioPanelId | null
  assetWorkspaceId: string
  panelHeaders?: Partial<Record<StudioPanelId, ReactNode>>
  panels: Record<StudioPanelId, (active: boolean) => ReactNode>
  t: Translator
}

export function StudioPanelHost(props: StudioPanelHostProps) {
  const activeAssetLayoutId = readAssetLayoutId(props.activePanel)
  const activeAssetViewModePreference = useStudioLayoutStore(state => activeAssetLayoutId === null
    ? null
    : (state.assetLayouts[activeAssetLayoutId].views[props.assetWorkspaceId] ?? DEFAULT_ASSET_VIEW_STATE).viewMode)
  const activeAssetHasSelection = useStudioLayoutStore(state => activeAssetLayoutId !== null
    && Boolean(state.assetLayouts[activeAssetLayoutId].views[props.assetWorkspaceId]?.selectedId))
  const panelWindowMode = useStudioLayoutStore(state => state.panelWindowMode)
  const setAssetViewMode = useStudioLayoutStore(state => state.setAssetViewMode)
  const togglePanelWindowMode = useStudioLayoutStore(state => state.togglePanelWindowMode)
  const isImmersive = props.activePanel !== null && panelWindowMode === 'immersive'
  const definition = props.activePanel === null ? null : STUDIO_PANEL_PRESENTATION[props.activePanel]
  const ActivePanelIcon = definition?.Icon
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
              togglePanelWindowMode()
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
