import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { BotMessageSquare, Columns2, FilePenLine, FlaskConical, ListTree, Maximize2, Menu, Minimize2, PanelLeftClose, PanelLeftOpen, PencilLine, Plug, ScrollText, Users, type LucideIcon } from 'lucide-react'
import type { Translator } from '../../shared/i18n/index.js'
import { DEFAULT_ASSET_VIEW_STATE, useStudioLayoutStore, type AssetLayoutId, type AssetViewMode, type StudioPanelId } from './model/studio-layout-store.js'
import { resizeWindow, type WindowResizeAxis, type WindowSize } from './window-resize.js'
import styles from './studio-page.module.scss'

type StudioPageProps = {
  assetWorkspaceId: string
  busy: boolean
  canRedo: boolean
  canUndo: boolean
  canvas: ReactNode
  customCss: string
  editorPanel: ReactNode
  error?: string
  inspector: ReactNode
  logsPanel: ReactNode
  onRedo(): void
  onUndo(): void
  apiPanel: ReactNode
  presetPanel: ReactNode
  resourcePanel: ReactNode
  t: Translator
}

type WindowResizeSession = {
  axis: WindowResizeAxis
  bounds: WindowSize
  current: WindowSize
  initial: WindowSize
  panel: StudioPanelId
  pointerId: number
  startX: number
  startY: number
}

type WindowResizePreview = {
  panel: StudioPanelId
  size: WindowSize
}

export function StudioPage(props: StudioPageProps) {
  const stageRef = useRef<HTMLElement>(null)
  const dockRef = useRef<HTMLElement>(null)
  const windowResizeRef = useRef<WindowResizeSession | undefined>(undefined)
  const activePanel = useStudioLayoutStore(state => state.activePanel)
  const assetMetadataOpen = useStudioLayoutStore(state => state.assetMetadataOpen)
  const assetLayouts = useStudioLayoutStore(state => state.assetLayouts)
  const closeDock = useStudioLayoutStore(state => state.closeDock)
  const dockOpen = useStudioLayoutStore(state => state.dockOpen)
  const panelWindowModes = useStudioLayoutStore(state => state.panelWindowModes)
  const panelWindowSizes = useStudioLayoutStore(state => state.panelWindowSizes)
  const setPanelWindowSize = useStudioLayoutStore(state => state.setPanelWindowSize)
  const setAssetMetadataOpen = useStudioLayoutStore(state => state.setAssetMetadataOpen)
  const setAssetViewMode = useStudioLayoutStore(state => state.setAssetViewMode)
  const toggleDock = useStudioLayoutStore(state => state.toggleDock)
  const togglePanel = useStudioLayoutStore(state => state.togglePanel)
  const togglePanelWindowMode = useStudioLayoutStore(state => state.togglePanelWindowMode)
  const toggleWorkspace = useStudioLayoutStore(state => state.toggleWorkspace)
  const isImmersive = activePanel !== null && panelWindowModes[activePanel] === 'immersive'
  const [windowResizePreview, setWindowResizePreview] = useState<WindowResizePreview>()
  const [windowResizing, setWindowResizing] = useState(false)

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return
      if (event.key === 'Escape' && assetMetadataOpen && (activePanel === 'editor' || activePanel === 'preset')) {
        event.preventDefault()
        setAssetMetadataOpen(false)
        return
      }
      if (event.key === 'Escape' && activePanel !== null && isImmersive) {
        event.preventDefault()
        togglePanelWindowMode(activePanel)
        return
      }
      if (event.key === 'Escape' && (activePanel !== null || dockOpen)) {
        event.preventDefault()
        closeDock()
        return
      }
      if (props.busy || isEditableTarget(event.target)) return
      if (!event.metaKey && !event.ctrlKey) return

      const key = event.key.toLowerCase()
      if (key === 'z' && event.shiftKey && props.canRedo) {
        event.preventDefault()
        props.onRedo()
      } else if (key === 'z' && props.canUndo) {
        event.preventDefault()
        props.onUndo()
      } else if (key === 'y' && props.canRedo) {
        event.preventDefault()
        props.onRedo()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activePanel, assetMetadataOpen, closeDock, dockOpen, isImmersive, props.busy, props.canRedo, props.canUndo, props.onRedo, props.onUndo, setAssetMetadataOpen, togglePanelWindowMode])

  function beginWindowResize(axis: WindowResizeAxis, event: PointerEvent<HTMLButtonElement>) {
    if (!activePanel || !stageRef.current || !dockRef.current) return
    const stageBounds = stageRef.current.getBoundingClientRect()
    const dockBounds = dockRef.current.getBoundingClientRect()
    const availableHeight = stageBounds.bottom - dockBounds.top - 18
    const cssMaximumHeight = Number.parseFloat(getComputedStyle(dockRef.current).maxHeight)

    windowResizeRef.current = {
      axis,
      bounds: {
        width: stageBounds.right - dockBounds.left - 18,
        height: Number.isFinite(cssMaximumHeight) ? Math.min(availableHeight, cssMaximumHeight) : availableHeight,
      },
      current: { width: dockBounds.width, height: dockBounds.height },
      initial: { width: dockBounds.width, height: dockBounds.height },
      panel: activePanel,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
    setWindowResizing(true)
  }

  function handleWindowResize(event: PointerEvent<HTMLButtonElement>) {
    const session = windowResizeRef.current
    if (!session) return
    const size = resizeWindow(
      session.initial,
      { x: event.clientX - session.startX, y: event.clientY - session.startY },
      session.bounds,
      session.axis,
    )
    session.current = size
    setWindowResizePreview({ panel: session.panel, size })
  }

  function stopWindowResize(event: PointerEvent<HTMLButtonElement>) {
    finishWindowResize()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  function finishWindowResize() {
    const session = windowResizeRef.current
    if (session) setPanelWindowSize(session.panel, session.current)
    windowResizeRef.current = undefined
    setWindowResizePreview(undefined)
    setWindowResizing(false)
  }

  function resizeWindowWithKeyboard(axis: WindowResizeAxis, event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (!activePanel || !stageRef.current || !dockRef.current) return
    const horizontal = axis !== 'vertical'
    const vertical = axis !== 'horizontal'
    const delta = {
      x: horizontal && event.key === 'ArrowLeft' ? -16 : horizontal && event.key === 'ArrowRight' ? 16 : 0,
      y: vertical && event.key === 'ArrowUp' ? -16 : vertical && event.key === 'ArrowDown' ? 16 : 0,
    }
    if (delta.x === 0 && delta.y === 0) return

    const stageBounds = stageRef.current.getBoundingClientRect()
    const dockBounds = dockRef.current.getBoundingClientRect()
    const availableHeight = stageBounds.bottom - dockBounds.top - 18
    const cssMaximumHeight = Number.parseFloat(getComputedStyle(dockRef.current).maxHeight)
    const size = resizeWindow(
      { width: dockBounds.width, height: dockBounds.height },
      delta,
      {
        width: stageBounds.right - dockBounds.left - 18,
        height: Number.isFinite(cssMaximumHeight) ? Math.min(availableHeight, cssMaximumHeight) : availableHeight,
      },
      axis,
    )
    setPanelWindowSize(activePanel, size)
    event.preventDefault()
  }

  const activePanelHeader = activePanel === null ? null : readPanelHeader(activePanel, props.t)
  const activeAssetLayoutId = readAssetLayoutId(activePanel)
  const activeAssetViewMode = activeAssetLayoutId === null
    ? null
    : (assetLayouts[activeAssetLayoutId].views[props.assetWorkspaceId] ?? DEFAULT_ASSET_VIEW_STATE).viewMode
  const dockClassName = [
    styles.floatingDock,
    dockOpen ? styles.floatingDockOpen : '',
    activePanel !== null ? styles.floatingDockActive : '',
    activePanel === 'resources' || (activeAssetViewMode !== null && activeAssetViewMode !== 'explorer')
      ? styles.floatingDockWorkspace
      : '',
    isImmersive ? styles.floatingDockImmersive : '',
    windowResizing ? styles.floatingDockResizing : '',
  ].filter(Boolean).join(' ')
  const ActivePanelIcon = activePanelHeader?.Icon
  const activePanelWindowSize = activePanel === null
    ? undefined
    : windowResizePreview?.panel === activePanel
      ? windowResizePreview.size
      : panelWindowSizes[activePanel]
  const dockStyle = activePanelWindowSize && !isImmersive
    ? { width: `${activePanelWindowSize.width}px`, height: `${activePanelWindowSize.height}px` } as CSSProperties
    : undefined

  return (
    <main className={styles.workbench} data-loom-component="studio-host-poc">
      <style>{props.customCss}</style>
      <div className={styles.statusRegion} aria-live="polite">
        {props.error ? <div className={`${styles.status} ${styles.statusError}`}>{props.error}</div> : null}
        {props.busy ? <div className={styles.status}>{props.t('status.working')}</div> : null}
      </div>

      <section ref={stageRef} className={styles.studioStage} data-loom-component="application-layer-stage">
        <div className={styles.stageBase} data-loom-component="base-chat-canvas-layer">
          {props.canvas}
        </div>

        <aside
          ref={dockRef}
          className={dockClassName}
          style={dockStyle}
          data-loom-component="floating-widget-dock"
        >
          <button
            aria-label={props.t('rail.label')}
            aria-expanded={dockOpen || activePanel !== null}
            className={styles.dockToggle}
            title={props.t('rail.label')}
            type="button"
            onClick={toggleDock}
          >
            <Menu aria-hidden="true" />
          </button>
          <div className={styles.dockSidebar}>
            <header className={`loom-page-header ${styles.dockHeader}`} data-loom-component="page-header">
              <span className={`loom-page-header-title ${styles.dockTitle}`}>{props.t('rail.label')}</span>
              <button
                aria-label={props.t('rail.resources')}
                className={styles.dockWorkspaceToggle}
                title={props.t('rail.resources')}
                type="button"
                onClick={toggleWorkspace}
              >
                {activePanel === null ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
              </button>
            </header>
            <span className={`loom-divider ${styles.dockHeaderDivider}`} aria-hidden="true" />
            <nav className={styles.studioRail} aria-label={props.t('rail.label')} data-loom-component="utility-rail">
              <button
                aria-label={props.t('rail.api')}
                aria-controls="studio-api-panel"
                aria-expanded={activePanel === 'api'}
                className={activePanel === 'api' ? `${styles.railTab} ${styles.railTabActive}` : styles.railTab}
                title={props.t('rail.api')}
                type="button"
                onClick={() => togglePanel('api')}
              >
                <Plug aria-hidden="true" />
                <span className={styles.railLabel}>{props.t('rail.api')}</span>
              </button>
              <span className={`loom-divider ${styles.railDivider}`} aria-hidden="true" />
              <button
                aria-label={props.t('rail.resources')}
                aria-controls="studio-resource-panel"
                aria-expanded={activePanel === 'resources'}
                className={activePanel === 'resources' ? `${styles.railTab} ${styles.railTabActive}` : styles.railTab}
                title={props.t('rail.resources')}
                type="button"
                onClick={() => togglePanel('resources')}
              >
                <Users aria-hidden="true" />
                <span className={styles.railLabel}>{props.t('rail.resources')}</span>
              </button>
              <button
                aria-label={props.t('rail.preset')}
                aria-controls="studio-preset-panel"
                aria-expanded={activePanel === 'preset'}
                className={activePanel === 'preset' ? `${styles.railTab} ${styles.railTabActive}` : styles.railTab}
                title={props.t('rail.preset')}
                type="button"
                onClick={() => togglePanel('preset')}
              >
                <BotMessageSquare aria-hidden="true" />
                <span className={styles.railLabel}>{props.t('rail.preset')}</span>
              </button>
              <button
                aria-label={props.t('rail.editor')}
                aria-controls="studio-editor-panel"
                aria-expanded={activePanel === 'editor'}
                className={activePanel === 'editor' ? `${styles.railTab} ${styles.railTabActive}` : styles.railTab}
                title={props.t('rail.editor')}
                type="button"
                onClick={() => togglePanel('editor')}
              >
                <PencilLine aria-hidden="true" />
                <span className={styles.railLabel}>{props.t('rail.editor')}</span>
              </button>
              <span className={`loom-divider ${styles.railDivider}`} aria-hidden="true" />
              <button
                aria-label={props.t('rail.inspector')}
                aria-controls="studio-inspector-panel"
                aria-expanded={activePanel === 'inspector'}
                className={activePanel === 'inspector' ? `${styles.railTab} ${styles.railTabActive}` : styles.railTab}
                title={props.t('rail.inspector')}
                type="button"
                onClick={() => togglePanel('inspector')}
              >
                <FlaskConical aria-hidden="true" />
                <span className={styles.railLabel}>{props.t('rail.inspector')}</span>
              </button>
              <button
                aria-label={props.t('rail.logs')}
                aria-controls="studio-logs-panel"
                aria-expanded={activePanel === 'logs'}
                className={activePanel === 'logs' ? `${styles.railTab} ${styles.railTabActive}` : styles.railTab}
                title={props.t('rail.logs')}
                type="button"
                onClick={() => togglePanel('logs')}
              >
                <ScrollText aria-hidden="true" />
                <span className={styles.railLabel}>{props.t('rail.logs')}</span>
              </button>
            </nav>
          </div>

          <span className={styles.dockDivider} aria-hidden="true" />

          <div className={styles.dockPanelHost}>
            {activePanelHeader && ActivePanelIcon ? (
              <header className={`loom-page-header ${styles.workspaceHeader}`} data-loom-component="page-header">
                <ActivePanelIcon aria-hidden="true" />
                <span className="loom-page-header-title">{activePanelHeader.label}</span>
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
                    if (activePanel !== null) togglePanelWindowMode(activePanel)
                  }}
                >
                  {isImmersive ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
                </button>
              </header>
            ) : null}
            <span className={`loom-divider ${styles.workspaceHeaderDivider}`} aria-hidden="true" />

            <div className={styles.workspaceBody}>
              <div
                className={styles.stagePanel}
                id="studio-api-panel"
                aria-hidden={activePanel !== 'api'}
                hidden={activePanel !== 'api'}
                data-loom-component="overlay-api-layer"
              >
                {props.apiPanel}
              </div>

              <div
                className={styles.stagePanel}
                id="studio-resource-panel"
                aria-hidden={activePanel !== 'resources'}
                hidden={activePanel !== 'resources'}
                data-loom-component="overlay-resource-layer"
              >
                {props.resourcePanel}
              </div>

              <div
                className={styles.stagePanel}
                id="studio-preset-panel"
                aria-hidden={activePanel !== 'preset'}
                hidden={activePanel !== 'preset'}
                data-loom-component="overlay-preset-layer"
              >
                {props.presetPanel}
              </div>

              <div
                className={styles.stagePanel}
                id="studio-editor-panel"
                aria-hidden={activePanel !== 'editor'}
                hidden={activePanel !== 'editor'}
                data-loom-component="overlay-editor-layer"
              >
                {props.editorPanel}
              </div>

              <div
                className={styles.stagePanel}
                id="studio-inspector-panel"
                aria-hidden={activePanel !== 'inspector'}
                hidden={activePanel !== 'inspector'}
                data-loom-component="overlay-inspector-layer"
              >
                {props.inspector}
              </div>

              <div
                className={styles.stagePanel}
                id="studio-logs-panel"
                aria-hidden={activePanel !== 'logs'}
                hidden={activePanel !== 'logs'}
                data-loom-component="overlay-logs-layer"
              >
                {props.logsPanel}
              </div>
            </div>
          </div>

          {activePanel !== null && !isImmersive ? (
            <>
              <button
                aria-label={props.t('window.resizeWidth')}
                className={`${styles.windowResizeHandle} ${styles.windowResizeRight}`}
                type="button"
                onKeyDown={event => resizeWindowWithKeyboard('horizontal', event)}
                onPointerDown={event => beginWindowResize('horizontal', event)}
                onPointerMove={handleWindowResize}
                onPointerUp={stopWindowResize}
                onPointerCancel={stopWindowResize}
                onLostPointerCapture={() => {
                  finishWindowResize()
                }}
              />
              <button
                aria-label={props.t('window.resizeHeight')}
                className={`${styles.windowResizeHandle} ${styles.windowResizeBottom}`}
                type="button"
                onKeyDown={event => resizeWindowWithKeyboard('vertical', event)}
                onPointerDown={event => beginWindowResize('vertical', event)}
                onPointerMove={handleWindowResize}
                onPointerUp={stopWindowResize}
                onPointerCancel={stopWindowResize}
                onLostPointerCapture={() => {
                  finishWindowResize()
                }}
              />
              <button
                aria-label={props.t('window.resizeBoth')}
                className={`${styles.windowResizeHandle} ${styles.windowResizeCorner}`}
                type="button"
                onKeyDown={event => resizeWindowWithKeyboard('both', event)}
                onPointerDown={event => beginWindowResize('both', event)}
                onPointerMove={handleWindowResize}
                onPointerUp={stopWindowResize}
                onPointerCancel={stopWindowResize}
                onLostPointerCapture={() => {
                  finishWindowResize()
                }}
              />
            </>
          ) : null}
        </aside>
      </section>
    </main>
  )
}

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
  if (panel === 'editor') return 'resources'
  return null
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

function readPanelHeader(panel: StudioPanelId, t: Translator): { Icon: LucideIcon; label: string } {
  switch (panel) {
    case 'api': return { Icon: Plug, label: t('rail.api') }
    case 'resources': return { Icon: Users, label: t('rail.resources') }
    case 'preset': return { Icon: BotMessageSquare, label: t('rail.preset') }
    case 'editor': return { Icon: PencilLine, label: t('rail.editor') }
    case 'inspector': return { Icon: FlaskConical, label: t('rail.inspector') }
    case 'logs': return { Icon: ScrollText, label: t('rail.logs') }
  }
}
