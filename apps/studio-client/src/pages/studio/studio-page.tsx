import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { Blocks, Columns2, FilePenLine, Folders, ListOrdered, ListTree, Maximize2, Menu, Minimize2, PanelLeftClose, PanelLeftOpen, Plug, Settings, SquareTerminal, Users, Wrench, type LucideIcon } from 'lucide-react'
import type { Translator } from '../../shared/i18n/index.js'
import { DEFAULT_ASSET_VIEW_STATE, STUDIO_PANEL_IDS, useStudioLayoutStore, type AssetLayoutId, type AssetViewMode, type StudioPanelId } from './model/studio-layout-store.js'
import { resizeWindow, type WindowResizeAxis, type WindowSize } from './window-resize.js'
import styles from './studio-page.module.scss'

declare const __LOOM_STUDIO_VERSION__: string

const STUDIO_VERSION = typeof __LOOM_STUDIO_VERSION__ === 'string' ? __LOOM_STUDIO_VERSION__ : 'dev'

type StudioPageProps = {
  assetWorkspaceId: string
  modelConfigured?: boolean
  busy: boolean
  canRedo: boolean
  canUndo: boolean
  canvas: ReactNode
  customCss: string
  error?: string
  onRedo(): void
  onUndo(): void
  panelHeaders?: Partial<Record<StudioPanelId, ReactNode>>
  panels: Record<StudioPanelId, (active: boolean) => ReactNode>
  t: Translator
}

type PanelDefinition = {
  Icon: LucideIcon
  labelKey: 'rail.model' | 'rail.character' | 'rail.preset' | 'rail.resource' | 'rail.inspector' | 'rail.logs' | 'rail.settings'
}

const PANEL_DEFINITIONS = {
  model: { Icon: Plug, labelKey: 'rail.model' },
  character: { Icon: Users, labelKey: 'rail.character' },
  preset: { Icon: ListOrdered, labelKey: 'rail.preset' },
  resource: { Icon: Folders, labelKey: 'rail.resource' },
  inspector: { Icon: Wrench, labelKey: 'rail.inspector' },
  logs: { Icon: SquareTerminal, labelKey: 'rail.logs' },
  settings: { Icon: Settings, labelKey: 'rail.settings' },
} satisfies Record<StudioPanelId, PanelDefinition>

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
      if (event.key === 'Escape' && assetMetadataOpen && (activePanel === 'resource' || activePanel === 'preset')) {
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

  const activePanelDefinition = activePanel === null ? null : PANEL_DEFINITIONS[activePanel]
  const activePanelCustomHeader = activePanel === null ? null : props.panelHeaders?.[activePanel]
  const activeAssetLayoutId = readAssetLayoutId(activePanel)
  const activeAssetViewMode = activeAssetLayoutId === null
    ? null
    : (assetLayouts[activeAssetLayoutId].views[props.assetWorkspaceId] ?? DEFAULT_ASSET_VIEW_STATE).viewMode
  const dockClassName = [
    styles.floatingDock,
    dockOpen ? styles.floatingDockOpen : '',
    activePanel !== null ? styles.floatingDockActive : '',
    activePanel === 'character' || (activeAssetViewMode !== null && activeAssetViewMode !== 'explorer')
      ? styles.floatingDockWorkspace
      : '',
    isImmersive ? styles.floatingDockImmersive : '',
    windowResizing ? styles.floatingDockResizing : '',
  ].filter(Boolean).join(' ')
  const ActivePanelIcon = activePanelDefinition?.Icon
  const activePanelWindowSize = activePanel === null
    ? undefined
    : windowResizePreview?.panel === activePanel
      ? windowResizePreview.size
      : panelWindowSizes[activePanel]
  const dockStyle = activePanelWindowSize && !isImmersive
    ? { width: `${activePanelWindowSize.width}px`, height: `${activePanelWindowSize.height}px` } as CSSProperties
    : undefined

  return (
    <main className={styles.workbench} data-loom-component="studio-workspace-shell">
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
                aria-controls={activePanel === null ? 'studio-character-panel' : `studio-${activePanel}-panel`}
                aria-expanded={activePanel !== null}
                aria-label={props.t(activePanel === null ? 'rail.openCharacter' : 'rail.closeWorkspace')}
                className={styles.dockWorkspaceToggle}
                title={props.t(activePanel === null ? 'rail.openCharacter' : 'rail.closeWorkspace')}
                type="button"
                onClick={toggleWorkspace}
              >
                {activePanel === null ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
              </button>
            </header>
            <span className={`loom-divider ${styles.dockHeaderDivider}`} aria-hidden="true" />
            <nav className={styles.studioRail} aria-label={props.t('rail.label')} data-loom-component="utility-rail">
              <button
                aria-label={props.t(props.modelConfigured === false ? 'rail.modelIncomplete' : 'rail.model')}
                aria-controls="studio-model-panel"
                aria-expanded={activePanel === 'model'}
                className={[
                  styles.railTab,
                  activePanel === 'model' ? styles.railTabActive : '',
                  props.modelConfigured === false ? styles.railTabIncomplete : '',
                ].filter(Boolean).join(' ')}
                data-status={props.modelConfigured === undefined ? 'unknown' : props.modelConfigured ? 'configured' : 'incomplete'}
                title={props.t(props.modelConfigured === false ? 'rail.modelIncomplete' : 'rail.model')}
                type="button"
                onClick={() => togglePanel('model')}
              >
                <Plug aria-hidden="true" />
                <span className={styles.railLabel}>{props.t('rail.model')}</span>
              </button>
              <span className={`loom-divider ${styles.railDivider}`} aria-hidden="true" />
              <button
                aria-label={props.t('rail.character')}
                aria-controls="studio-character-panel"
                aria-expanded={activePanel === 'character'}
                className={activePanel === 'character' ? `${styles.railTab} ${styles.railTabActive}` : styles.railTab}
                title={props.t('rail.character')}
                type="button"
                onClick={() => togglePanel('character')}
              >
                <Users aria-hidden="true" />
                <span className={styles.railLabel}>{props.t('rail.character')}</span>
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
                <ListOrdered aria-hidden="true" />
                <span className={styles.railLabel}>{props.t('rail.preset')}</span>
              </button>
              <button
                aria-label={props.t('rail.resource')}
                aria-controls="studio-resource-panel"
                aria-expanded={activePanel === 'resource'}
                className={activePanel === 'resource' ? `${styles.railTab} ${styles.railTabActive}` : styles.railTab}
                title={props.t('rail.resource')}
                type="button"
                onClick={() => togglePanel('resource')}
              >
                <Folders aria-hidden="true" />
                <span className={styles.railLabel}>{props.t('rail.resource')}</span>
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
                <Wrench aria-hidden="true" />
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
                <SquareTerminal aria-hidden="true" />
                <span className={styles.railLabel}>{props.t('rail.logs')}</span>
              </button>
              <button
                aria-label={props.t('rail.extensions')}
                className={styles.railTab}
                disabled
                title={props.t('rail.extensions')}
                type="button"
              >
                <Blocks aria-hidden="true" />
                <span className={styles.railLabel}>{props.t('rail.extensions')}</span>
              </button>
              <button
                aria-label={props.t('rail.settings')}
                aria-controls="studio-settings-panel"
                aria-expanded={activePanel === 'settings'}
                className={activePanel === 'settings' ? `${styles.railTab} ${styles.railTabActive}` : styles.railTab}
                title={props.t('rail.settings')}
                type="button"
                onClick={() => togglePanel('settings')}
              >
                <Settings aria-hidden="true" />
                <span className={styles.railLabel}>{props.t('rail.settings')}</span>
              </button>
              <footer className={styles.railFooter}>
                <a
                  aria-label="LoomStudio GitHub"
                  className={styles.githubLink}
                  href="https://github.com/The-LoomStudio/LoomStudio.git"
                  rel="noreferrer"
                  target="_blank"
                >
                  <GitHubMark />
                  <span>GitHub</span>
                </a>
                <span className={styles.version}>v{STUDIO_VERSION}</span>
              </footer>
            </nav>
          </div>

          <span className={styles.dockDivider} aria-hidden="true" />

          <div className={styles.dockPanelHost}>
            {activePanelDefinition && ActivePanelIcon ? (
              <header className={`loom-page-header ${styles.workspaceHeader}`} data-loom-component="page-header">
                {activePanelCustomHeader ?? <><ActivePanelIcon aria-hidden="true" /><span className="loom-page-header-title">{props.t(activePanelDefinition.labelKey)}</span></>}
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
              {STUDIO_PANEL_IDS.map(panel => {
                const active = activePanel === panel
                return (
                  <div
                    key={panel}
                    className={styles.stagePanel}
                    id={`studio-${panel}-panel`}
                    aria-hidden={!active}
                    hidden={!active}
                    data-loom-component={`overlay-${panel}-layer`}
                  >
                    {props.panels[panel](active)}
                  </div>
                )
              })}
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
  if (panel === 'resource') return 'resources'
  return null
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

function GitHubMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path d="M8 0C3.58 0 0 3.64 0 8c0 3.54 2.29 6.53 5.47 7.59.4.08.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.38-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.59 1.23.83.72 1.23 1.87.88 2.33.67.07-.53.28-.88.51-1.08-1.78-.21-3.64-.91-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.22 2.2.82A7.65 7.65 0 0 1 8 3.87c.68 0 1.36.09 2 .27 1.53-1.05 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.05-1.87 3.74-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.47.55.38A8.01 8.01 0 0 0 16 8c0-4.36-3.58-8-8-8Z" />
    </svg>
  )
}
