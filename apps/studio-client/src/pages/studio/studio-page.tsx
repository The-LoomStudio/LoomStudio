import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Lock, Menu, PanelLeftClose } from 'lucide-react'
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
  const dockPinned = useStudioLayoutStore(state => state.dockPinned)
  const panelWindowMode = useStudioLayoutStore(state => state.panelWindowMode)
  const panelWindowSizes = useStudioLayoutStore(state => state.panelWindowSizes)
  const setPanelWindowSize = useStudioLayoutStore(state => state.setPanelWindowSize)
  const setAssetMetadataOpen = useStudioLayoutStore(state => state.setAssetMetadataOpen)
  const toggleDock = useStudioLayoutStore(state => state.toggleDock)
  const toggleDockPinned = useStudioLayoutStore(state => state.toggleDockPinned)
  const togglePanel = useStudioPanelStore(state => state.togglePanel)
  const togglePanelWindowMode = useStudioLayoutStore(state => state.togglePanelWindowMode)
  const isImmersive = activePanel !== null && panelWindowMode === 'immersive'
  const windowResize = useStudioWindowResize({ activePanel, dockRef, setPanelWindowSize, stageRef })

  const [dockHovered, setDockHovered] = useState(false)
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false)
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleMouseEnter = () => {
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current)
      leaveTimerRef.current = null
    }
    setDockHovered(true)
  }

  const handleMouseLeave = () => {
    if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current)
    leaveTimerRef.current = setTimeout(() => {
      setDockHovered(false)
    }, 260)
  }

  useEffect(() => {
    return () => {
      if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current)
    }
  }, [])

  const isDockVisible = activePanel !== null || dockPinned || dockHovered || mobileDrawerOpen

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
    mobileDrawerOpen && activePanel === null ? styles.floatingDockMobileOpen : '',
    activePanel !== null ? styles.floatingDockActive : (isDockVisible ? styles.floatingDockVisible : styles.floatingDockHidden),
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
  const dockStyle = {
    '--loom-window-rail-width': '160px',
    ...(activePanelWindowSize && !isImmersive
      ? { width: `${activePanelWindowSize.width}px`, height: `${activePanelWindowSize.height}px` }
      : {}),
  } as CSSProperties
  const dockSidebar = (
    <div className={styles.dockSidebar}>
      <header className={styles.dockHeader} data-loom-component="page-header">
        <button
          aria-label={activePanel === null
            ? props.t(dockPinned ? 'rail.unpinDock' : 'rail.pinDock')
            : props.t('rail.label')}
          aria-expanded={activePanel !== null || dockPinned || mobileDrawerOpen}
          className={`${styles.dockToggle} ${activePanel === null && dockPinned ? styles.dockTogglePinned : ''}`}
          title={activePanel === null
            ? props.t(dockPinned ? 'rail.unpinDock' : 'rail.pinDock')
            : props.t('rail.label')}
          type="button"
          onClick={() => {
            if (activePanel !== null) {
              closePanel()
            } else if (mobileDrawerOpen) {
              setMobileDrawerOpen(false)
            } else {
              toggleDockPinned()
            }
          }}
        >
          {activePanel === null && dockPinned ? <Lock aria-hidden="true" /> : <Menu aria-hidden="true" />}
        </button>
        <span className={`loom-page-header-title ${styles.dockTitle}`}>{props.t('rail.label')}</span>
        {activePanel !== null ? (
          <button
            aria-controls={`studio-${activePanel}-panel`}
            aria-expanded="true"
            aria-label={props.t('rail.closePanel')}
            className={styles.dockWorkspaceToggle}
            title={props.t('rail.closePanel')}
            type="button"
            onClick={closePanel}
          >
            <PanelLeftClose aria-hidden="true" />
          </button>
        ) : null}
      </header>
      <div className={styles.dockHeaderDivider} aria-hidden="true">
        <span className="loom-divider" />
      </div>
      <StudioRail
        activePanel={activePanel}
        modelConfigured={props.modelConfigured}
        t={props.t}
        togglePanel={panel => {
          setMobileDrawerOpen(false)
          togglePanel(panel)
        }}
      />
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

        {activePanel === null && !mobileDrawerOpen ? (
          <button
            aria-label={props.t('rail.label')}
            className={styles.mobileMenuTrigger}
            title={props.t('rail.label')}
            type="button"
            onClick={() => setMobileDrawerOpen(true)}
          >
            <Menu aria-hidden="true" />
          </button>
        ) : null}

        {activePanel === null && mobileDrawerOpen ? (
          <div
            className={styles.mobileBackdrop}
            aria-hidden="true"
            onClick={() => setMobileDrawerOpen(false)}
          />
        ) : null}

        {activePanel === null && !dockPinned ? (
          <div
            className={styles.dockTriggerZone}
            aria-hidden="true"
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          />
        ) : null}

        <aside
          ref={dockRef}
          className={dockClassName}
          style={dockStyle}
          data-loom-component="floating-widget-dock"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {activePanel === null ? dockSidebar : (
            <WindowColumnLayout
              className={styles.workspaceColumnLayout}
              columns={[
                {
                  content: dockSidebar,
                  divider: true,
                  id: 'navigation',
                  minSize: 42,
                  resizable: false,
                  size: 42,
                },
                { content: panelHost, fill: true, id: 'panel', minSize: 320 },
              ]}
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
