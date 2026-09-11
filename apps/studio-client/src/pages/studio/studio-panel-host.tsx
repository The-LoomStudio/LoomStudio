import { memo, useEffect, useState, type ReactNode } from 'react'
import { ArrowLeft, ArrowRight, Columns2, FilePenLine, Maximize2, Minimize2 } from 'lucide-react'
import type { Translator } from '../../shared/i18n/index.js'
import { DEFAULT_ASSET_VIEW_STATE, STUDIO_PANEL_IDS, useStudioLayoutStore, useStudioPanelStore, type AssetLayoutId, type StudioPanelId } from './model/studio-layout-store.js'
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
  const activeAssetViewMode = useStudioLayoutStore(state => activeAssetLayoutId === null
    ? null
    : (state.assetLayouts[activeAssetLayoutId].views[props.assetWorkspaceId] ?? DEFAULT_ASSET_VIEW_STATE).viewMode)
  const activeAssetPane = useStudioLayoutStore(state => activeAssetLayoutId === null
    ? null
    : (state.assetPanes[activeAssetLayoutId][props.assetWorkspaceId] ?? 'explorer'))
  const setAssetPane = useStudioLayoutStore(state => state.setAssetPane)
  const panelWindowMode = useStudioLayoutStore(state => state.panelWindowMode)
  const setAssetViewMode = useStudioLayoutStore(state => state.setAssetViewMode)
  const togglePanelWindowMode = useStudioLayoutStore(state => state.togglePanelWindowMode)
  const canGoBackPanel = useStudioPanelStore(state => state.canGoBack)
  const canGoForwardPanel = useStudioPanelStore(state => state.canGoForward)
  const goBackPanel = useStudioPanelStore(state => state.goBack)
  const goForwardPanel = useStudioPanelStore(state => state.goForward)
  const isImmersive = props.activePanel !== null && panelWindowMode === 'immersive'
  const definition = props.activePanel === null ? null : STUDIO_PANEL_PRESENTATION[props.activePanel]
  const ActivePanelIcon = definition?.Icon
  const customHeader = props.activePanel === null ? null : props.panelHeaders?.[props.activePanel]
  const canGoBackAsset = activeAssetLayoutId !== null && activeAssetViewMode === 'drilldown' && activeAssetPane === 'detail'
  const canGoBack = canGoBackAsset || canGoBackPanel
  return (
    <div className={styles.dockPanelHost}>
      {definition && ActivePanelIcon ? (
        <header
          className={`loom-page-header ${styles.workspaceHeader}`}
          data-asset-pane={activeAssetPane ?? undefined}
          data-asset-view-mode={activeAssetViewMode ?? undefined}
          data-loom-component="page-header"
        >
          <div className={styles.headerNavigation} data-loom-component="navigation-history">
            <button
              aria-label={props.t('navigation.back')}
              className={styles.headerNavigationButton}
              disabled={!canGoBack}
              title={props.t('navigation.back')}
              type="button"
              onClick={() => {
                if (canGoBackAsset && activeAssetLayoutId) {
                  setAssetPane(activeAssetLayoutId, props.assetWorkspaceId, 'explorer')
                  return
                }
                goBackPanel()
              }}
            >
              <ArrowLeft aria-hidden="true" />
            </button>
            <button
              aria-label={props.t('navigation.forward')}
              className={styles.headerNavigationButton}
              disabled={!canGoForwardPanel}
              title={props.t('navigation.forward')}
              type="button"
              onClick={goForwardPanel}
            >
              <ArrowRight aria-hidden="true" />
            </button>
          </div>
          {customHeader ?? <><ActivePanelIcon aria-hidden="true" /><span className="loom-page-header-title">{props.t(definition.labelKey)}</span></>}
          {activeAssetLayoutId && activeAssetViewMode ? (
            <div
              aria-label={props.t('context.viewModeLabel')}
              className={styles.viewModeControl}
              data-loom-component="asset-view-mode-control"
              role="group"
            >
              <button
                aria-label={props.t(activeAssetViewMode === 'master-detail' ? 'context.viewModeDrilldown' : 'context.viewModeMasterDetail')}
                aria-pressed={activeAssetViewMode === 'drilldown'}
                className={activeAssetViewMode === 'drilldown' ? styles.viewModeButtonActive : styles.viewModeButton}
                title={props.t(activeAssetViewMode === 'master-detail' ? 'context.viewModeDrilldown' : 'context.viewModeMasterDetail')}
                type="button"
                onClick={() => setAssetViewMode(
                  activeAssetLayoutId,
                  props.assetWorkspaceId,
                  activeAssetViewMode === 'master-detail' ? 'drilldown' : 'master-detail',
                )}
              >
                <span aria-hidden="true" className={styles.viewModeIconSwap}>
                  <Columns2 className={activeAssetViewMode === 'master-detail' ? styles.viewModeIconVisible : styles.viewModeIconHidden} />
                  <FilePenLine className={activeAssetViewMode === 'drilldown' ? styles.viewModeIconVisible : styles.viewModeIconHidden} />
                </span>
              </button>
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
      style={{ display: props.active ? undefined : 'none' }}
      data-loom-component={`overlay-${props.panel}-layer`}
      data-loom-object={`${props.panel}-panel`}
    >
      {visited || props.active ? props.render(props.active) : null}
    </div>
  )
}, (previous, next) => previous.panel === next.panel && !previous.active && !next.active)

function readAssetLayoutId(panel: StudioPanelId | null): AssetLayoutId | null {
  if (panel === 'preset') return 'preset'
  if (panel === 'resource') return 'resources'
  return null
}
