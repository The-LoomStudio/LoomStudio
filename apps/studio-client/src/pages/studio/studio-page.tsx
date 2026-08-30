import { useRef, type CSSProperties, type ReactNode } from 'react'
import { Menu, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import type { Translator } from '../../shared/i18n/index.js'
import { WindowColumnLayout } from '../../shared/ui/window-column-layout/window-column-layout.js'
import { useStudioLayoutStore, useStudioPanelStore, type StudioPanelId } from './model/studio-layout-store.js'
import { StudioPanelHost } from './studio-panel-host.js'
import { StudioRail } from './studio-rail.js'
import { useStudioShortcuts } from './use-studio-shortcuts.js'
import { useStudioLayoutAnchors } from './use-studio-layout-anchors.js'
import { useStudioWindowResize } from './use-studio-window-resize.js'
import type { WindowResizeAxis } from './window-resize.js'
import styles from './studio-page.module.scss'

type StudioPageProps = {
  assetWorkspaceId: string
  background?: ReactNode
  modelConfigured?: boolean
  busy: boolean
  canRedo: boolean
  canUndo: boolean
  canvas: ReactNode
  customCss: string
  onRedo(): void
  onUndo(): void
  panelHeaders?: Partial<Record<StudioPanelId, ReactNode>>
  panels: Record<StudioPanelId, (active: boolean) => ReactNode>
  t: Translator
  uiScale: number
}

export function StudioPage(props: StudioPageProps) {
  const stageRef = useRef<HTMLElement>(null)
  const dockRef = useRef<HTMLElement>(null)
  useStudioLayoutAnchors(stageRef)
  const activePanel = useStudioPanelStore(state => state.activePanel)
  const assetMetadataOpen = useStudioLayoutStore(state => state.assetMetadataOpen)
  const closeDock = useStudioLayoutStore(state => state.closeDock)
  const closePanel = useStudioPanelStore(state => state.closePanel)
  const dockOpen = useStudioLayoutStore(state => state.dockOpen)
  const panelWindowModes = useStudioLayoutStore(state => state.panelWindowModes)
  const panelWindowSizes = useStudioLayoutStore(state => state.panelWindowSizes)
  const railWidth = useStudioLayoutStore(state => state.railWidth)
  const setPanelWindowSize = useStudioLayoutStore(state => state.setPanelWindowSize)
  const setRailWidth = useStudioLayoutStore(state => state.setRailWidth)
  const setAssetMetadataOpen = useStudioLayoutStore(state => state.setAssetMetadataOpen)
  const toggleDock = useStudioLayoutStore(state => state.toggleDock)
  const togglePanel = useStudioPanelStore(state => state.togglePanel)
  const togglePanelWindowMode = useStudioLayoutStore(state => state.togglePanelWindowMode)
  const isImmersive = activePanel !== null && panelWindowModes[activePanel] === 'immersive'
  const windowResize = useStudioWindowResize({ activePanel, dockRef, setPanelWindowSize, stageRef })
  useStudioShortcuts({
    activePanel,
    assetMetadataOpen,
    busy: props.busy,
    canRedo: props.canRedo,
    canUndo: props.canUndo,
    closeDock,
    closePanel,
    dockOpen,
    isImmersive,
    onRedo: props.onRedo,
    onUndo: props.onUndo,
    setAssetMetadataOpen,
    togglePanelWindowMode,
  })

  const dockClassName = [
    styles.floatingDock,
    dockOpen ? styles.floatingDockOpen : '',
    activePanel !== null ? styles.floatingDockActive : '',
    activePanel !== null && readPanelPlacement(activePanel) === 'beside-narrative' ? styles.floatingDockBesideNarrative : '',
    activePanel !== null && readPanelPlacement(activePanel) === 'cover-narrative' ? styles.floatingDockCoverNarrative : '',
    isImmersive ? styles.floatingDockImmersive : '',
    windowResize.resizing ? styles.floatingDockResizing : '',
  ].filter(Boolean).join(' ')
  const activePanelWindowSize = activePanel === null
    ? undefined
    : windowResize.preview?.panel === activePanel
      ? windowResize.preview.size
      : panelWindowSizes[activePanel]
  const visibleRailWidth = activePanel === null && dockOpen && railWidth < 96 ? 160 : railWidth
  const dockStyle = {
    '--loom-window-rail-width': `${visibleRailWidth}px`,
    ...(activePanelWindowSize && !isImmersive
      ? { width: `${activePanelWindowSize.width}px`, height: `${activePanelWindowSize.height}px` }
      : {}),
  } as CSSProperties
  const dockSidebar = (
    <div className={styles.dockSidebar}>
      <header className={styles.dockHeader} data-loom-component="page-header">
        <button
          aria-label={props.t('rail.label')}
          aria-expanded={dockOpen || activePanel !== null}
          className={styles.dockToggle}
          title={props.t('rail.label')}
          type="button"
          onClick={() => activePanel === null ? toggleDock() : closePanel()}
        >
          <Menu aria-hidden="true" />
        </button>
        <span className={`loom-page-header-title ${styles.dockTitle}`}>{props.t('rail.label')}</span>
        <button
          aria-controls={activePanel === null ? 'studio-character-panel' : `studio-${activePanel}-panel`}
          aria-expanded={activePanel !== null}
          aria-label={props.t(activePanel === null ? 'rail.openCharacter' : 'rail.closePanel')}
          className={styles.dockWorkspaceToggle}
          title={props.t(activePanel === null ? 'rail.openCharacter' : 'rail.closePanel')}
          type="button"
          onClick={() => activePanel === null ? togglePanel('character') : closePanel()}
        >
          {activePanel === null ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
        </button>
      </header>
      <div className={styles.dockHeaderDivider} aria-hidden="true">
        <span className="loom-divider" />
      </div>
      <StudioRail activePanel={activePanel} modelConfigured={props.modelConfigured} t={props.t} togglePanel={togglePanel} />
    </div>
  )
  const panelHost = (
    <StudioPanelHost
      activePanel={activePanel}
      assetWorkspaceId={props.assetWorkspaceId}
      panelHeaders={props.panelHeaders}
      panels={props.panels}
      t={props.t}
    />
  )
  return (
    <main className={styles.workbench} data-loom-component="studio-workspace-shell" data-loom-object="studio-shell">
      <style>{`:root { --loom-ui-scale: ${props.uiScale / 100}; }`}</style>
      <style>{props.customCss}</style>
      <section
        ref={stageRef}
        className={styles.studioStage}
        data-loom-component="application-layer-stage"
      >
        {props.background ? (
          <div className={styles.stageBackground} data-loom-component="shell-background-layer">
            {props.background}
          </div>
        ) : null}
        <div className={styles.stageBase} data-loom-component="base-chat-canvas-layer">
          {props.canvas}
        </div>

        <aside
          ref={dockRef}
          className={dockClassName}
          style={dockStyle}
          data-loom-component="floating-widget-dock"
        >
          {activePanel === null ? dockSidebar : (
            <WindowColumnLayout
              className={styles.workspaceColumnLayout}
              columns={[
                {
                  collapsedSize: 42,
                  content: dockSidebar,
                  id: 'navigation',
                  maxSize: 320,
                  minSize: 96,
                  resizeLabel: props.t('window.resizeNavigation'),
                  shrinkPriority: 100,
                  size: railWidth,
                  snapThreshold: 96,
                },
                { content: panelHost, fill: true, id: 'panel', minSize: 320 },
              ]}
              onColumnSizeChange={(columnId, size) => {
                if (columnId === 'navigation') setRailWidth(size)
              }}
            />
          )}

          {activePanel !== null && !isImmersive ? (
            <>
              <WindowResizeHandle axis="horizontal" className={styles.windowResizeRight} label={props.t('window.resizeWidth')} resize={windowResize} />
              <WindowResizeHandle axis="vertical" className={styles.windowResizeBottom} label={props.t('window.resizeHeight')} resize={windowResize} />
              <WindowResizeHandle axis="both" className={styles.windowResizeCorner} label={props.t('window.resizeBoth')} resize={windowResize} />
            </>
          ) : null}
        </aside>

      </section>
    </main>
  )
}

function WindowResizeHandle(props: {
  axis: WindowResizeAxis
  className: string
  label: string
  resize: ReturnType<typeof useStudioWindowResize>
}) {
  return (
    <button
      aria-label={props.label}
      className={`${styles.windowResizeHandle} ${props.className}`}
      type="button"
      onKeyDown={event => props.resize.resizeWithKeyboard(props.axis, event)}
      onPointerDown={event => props.resize.begin(props.axis, event)}
      onPointerMove={props.resize.move}
      onPointerUp={props.resize.stop}
      onPointerCancel={props.resize.stop}
      onLostPointerCapture={props.resize.finish}
    />
  )
}

function readPanelPlacement(panel: StudioPanelId): 'beside-narrative' | 'cover-narrative' {
  if (panel === 'model' || panel === 'agent' || panel === 'sessions' || panel === 'character') return 'beside-narrative'
  return 'cover-narrative'
}
