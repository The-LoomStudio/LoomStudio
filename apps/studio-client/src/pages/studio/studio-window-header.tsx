import { ArrowLeft, ArrowRight, Columns2, FilePenLine, Maximize2, Minimize2 } from 'lucide-react'
import type { ReactNode, RefCallback } from 'react'
import type { Translator } from '../../shared/i18n/index.js'
import { DEFAULT_ASSET_VIEW_STATE, useStudioLayoutStore, type AssetLayoutId, type StudioPanelId } from '../../shared/studio-shell/studio-layout-store.js'
import { STUDIO_PANEL_PRESENTATION } from '../../shared/studio-shell/studio-panel-presentation.js'
import styles from './studio-page.module.scss'

export function StudioWindowHeader(props: {
  activePanel: StudioPanelId
  actions?: ReactNode
  actionsTargetRef: RefCallback<HTMLDivElement>
  assetWorkspaceId: string
  main?: ReactNode
  onPanelHistory(direction: 'back' | 'forward'): void
  t: Translator
}) {
  const activeAssetLayoutId = readAssetLayoutId(props.activePanel)
  const activeAssetViewMode = useStudioLayoutStore(state => activeAssetLayoutId === null
    ? null
    : (state.assetLayouts[activeAssetLayoutId].views[props.assetWorkspaceId] ?? DEFAULT_ASSET_VIEW_STATE).viewMode)
  const activeAssetPane = useStudioLayoutStore(state => activeAssetLayoutId === null
    ? null
    : (state.assetPanes[activeAssetLayoutId][props.assetWorkspaceId] ?? 'explorer'))
  const panelWindowMode = useStudioLayoutStore(state => state.panelWindowMode)
  const setAssetPane = useStudioLayoutStore(state => state.setAssetPane)
  const setAssetViewMode = useStudioLayoutStore(state => state.setAssetViewMode)
  const togglePanelWindowMode = useStudioLayoutStore(state => state.togglePanelWindowMode)
  const definition = STUDIO_PANEL_PRESENTATION[props.activePanel]
  const ActivePanelIcon = definition.Icon
  const canGoBackAsset = activeAssetLayoutId !== null && activeAssetViewMode === 'drilldown' && activeAssetPane === 'detail'
  const isImmersive = panelWindowMode === 'immersive'

  return (
    <header
      className={`loom-page-header ${styles.workspaceHeader}`}
      data-asset-pane={activeAssetPane ?? undefined}
      data-asset-view-mode={activeAssetViewMode ?? undefined}
      data-loom-component="window-header"
    >
      <div className={styles.headerNavigation} data-loom-component="navigation-history">
        <button
          aria-label={props.t('navigation.back')}
          className={styles.headerNavigationButton}
          title={props.t('navigation.back')}
          type="button"
          onClick={() => {
            if (canGoBackAsset && activeAssetLayoutId) {
              setAssetPane(activeAssetLayoutId, props.assetWorkspaceId, 'explorer')
              return
            }
            props.onPanelHistory('back')
          }}
        >
          <ArrowLeft aria-hidden="true" />
        </button>
        <button
          aria-label={props.t('navigation.forward')}
          className={styles.headerNavigationButton}
          title={props.t('navigation.forward')}
          type="button"
          onClick={() => {
            props.onPanelHistory('forward')
          }}
        >
          <ArrowRight aria-hidden="true" />
        </button>
      </div>

      <div className={styles.headerMain}>
        {props.main ?? (
          <div className={styles.headerTitle}>
            <ActivePanelIcon aria-hidden="true" />
            <span className="loom-page-header-title">{props.t(definition.labelKey)}</span>
          </div>
        )}
      </div>

      {activeAssetLayoutId && activeAssetViewMode ? (
        <div aria-label={props.t('context.viewModeLabel')} className={styles.viewModeControl} data-loom-component="asset-view-mode-control" role="group">
          <button
            aria-label={props.t(activeAssetViewMode === 'master-detail' ? 'context.viewModeDrilldown' : 'context.viewModeMasterDetail')}
            aria-pressed={activeAssetViewMode === 'drilldown'}
            className={activeAssetViewMode === 'drilldown' ? styles.viewModeButtonActive : styles.viewModeButton}
            title={props.t(activeAssetViewMode === 'master-detail' ? 'context.viewModeDrilldown' : 'context.viewModeMasterDetail')}
            type="button"
            onClick={() => setAssetViewMode(activeAssetLayoutId, props.assetWorkspaceId, activeAssetViewMode === 'master-detail' ? 'drilldown' : 'master-detail')}
          >
            <span aria-hidden="true" className={styles.viewModeIconSwap}>
              <Columns2 className={activeAssetViewMode === 'master-detail' ? styles.viewModeIconVisible : styles.viewModeIconHidden} />
              <FilePenLine className={activeAssetViewMode === 'drilldown' ? styles.viewModeIconVisible : styles.viewModeIconHidden} />
            </span>
          </button>
        </div>
      ) : null}

      <div className={styles.headerActions} data-loom-component="page-header-actions">
        {props.actions}
        <div className={styles.headerActionsPortal} ref={props.actionsTargetRef} />
      </div>
      <button
        aria-label={props.t(isImmersive ? 'window.exitImmersive' : 'window.enterImmersive')}
        aria-pressed={isImmersive}
        className={`${styles.windowModeButton} ${isImmersive ? styles.windowModeButtonActive : ''}`}
        data-loom-component="window-mode-toggle"
        title={props.t(isImmersive ? 'window.exitImmersive' : 'window.enterImmersive')}
        type="button"
        onClick={() => togglePanelWindowMode()}
      >
        {isImmersive ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
      </button>
    </header>
  )
}

function readAssetLayoutId(panel: StudioPanelId): AssetLayoutId | null {
  if (panel === 'preset' || panel === 'agent') return 'preset'
  if (panel === 'resource') return 'resources'
  return null
}
