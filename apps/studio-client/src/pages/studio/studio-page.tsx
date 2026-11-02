import { mobileMotionDuration, mobileMotionEasing } from '@loom-studio/ui'
import { useMobileNavigationGestures } from './use-mobile-navigation-gestures.js'
import { useMobileReadingChrome } from './use-mobile-reading-chrome.js'
import { styleMotion } from '../../features/themes/model/style-motion.js'
import { useWallpaper } from './use-wallpaper.js'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { AlignLeft, ArrowLeft, ArrowRight, PanelLeft, PanelLeftClose, Search, X } from 'lucide-react'
import type { Translator } from '../../shared/i18n/index.js'
import { StudioPanelRight } from './studio-panel-right.js'
import { DEFAULT_ASSET_VIEW_STATE, useStudioLayoutStore, type AssetLayoutId, type StudioPanelId } from '../../shared/studio-shell/studio-layout-store.js'
import type { useStudioNavigation } from '../../shared/studio-shell/use-studio-navigation.js'
import { StudioPanelHost } from './studio-panel-host.js'
import { readAssetLayoutId, StudioWindowHeader } from './studio-window-header.js'
import { StudioWindowHeaderProvider } from '../../shared/studio-shell/studio-window-header-context.js'
import { STUDIO_TOOL_IDS } from '../../shared/studio-shell/studio-tool.js'
import { STUDIO_PANEL_PRESENTATION } from '../../shared/studio-shell/studio-panel-presentation.js'
import { StudioToolDialog } from './studio-tool-dialog.js'
import { StudioRail } from './studio-rail.js'
import { useStudioShortcuts } from './use-studio-shortcuts.js'
import { useStudioLayoutAnchors } from './use-studio-layout-anchors.js'
import { useStudioWindowResize } from './use-studio-window-resize.js'
import { useEffectiveMotion } from '../../shared/hooks/use-motion-preference.js'
import { resolveRailPresentation } from './studio-shell-layout.js'
import type { WindowResizeAxis } from '../../shared/studio-shell/window-resize.js'
import type { AgentSession } from '../../entities/index.js'
import { StageAgentCapsule } from './stage-agent-capsule.js'
import styles from './studio-page.module.scss'

type StudioPageProps = {
  overlaysReady: boolean
  mobileChromeLocked?: boolean
  navigation: ReturnType<typeof useStudioNavigation>
  agentPanel: ReactNode
  agentPanelOpen?: boolean
  agentSession?: AgentSession
  agentSessionsCount?: number
  assetWorkspaceId: string
  background?: ReactNode
  busy: boolean
  canRedo: boolean
  canUndo: boolean
  canvas: ReactNode
  characterControl?: ReactNode
  modelConfigured?: boolean
  panelHeaderActions?: Partial<Record<StudioPanelId, ReactNode>>
  panelHeaderMain?: Partial<Record<StudioPanelId, ReactNode>>
  headerActions?: ReactNode
  panels: Record<StudioPanelId, (active: boolean, surface?: 'tool') => ReactNode>
  preloadPanel?(panel: StudioPanelId): void
  recentSessions?: ReactNode
  t: Translator
  wallpaperUrl?: string
  onRedo(): void
  onOpenDashboard(): void
  onOpenSearch(): void
  searchQuery?: string
  onClearSearch(): void
  onToggleAgentPanel?(): void
  onUndo(): void
}

export function StudioPage(props: StudioPageProps) {
  const stageRef = useRef<HTMLElement>(null)
  const dockRef = useRef<HTMLElement>(null)
  const mobileSidebarRef = useRef<HTMLElement>(null)
  const agentPanelToggleRef = useRef<HTMLButtonElement>(null)
  useStudioLayoutAnchors(stageRef)
  const { currentWallpaper, previousWallpaper } = useWallpaper(props.wallpaperUrl)

  const [isMobile, setIsMobile] = useState(() => (typeof window !== 'undefined' ? window.innerWidth <= 768 : false))
  const activePanel = props.navigation.route.panel
  const effectiveMotion = useEffectiveMotion()
  const [displayedPanel, setDisplayedPanel] = useState(activePanel)
  const [panelMotion, setPanelMotion] = useState<'closing' | 'idle'>('idle')
  const displayedPanelRef = useRef(activePanel)
  const panelVisualRef = useRef<HTMLDivElement>(null)
  const requestedHistoryDirection = useRef<'back' | 'forward' | undefined>(undefined)
  const assetMetadataOpen = useStudioLayoutStore(state => state.assetMetadataOpen)
  const closeDock = useStudioLayoutStore(state => state.closeDock)
  const closePanel = props.navigation.closePanel
  const dockOpen = useStudioLayoutStore(state => state.dockOpen)
  const dockPinned = useStudioLayoutStore(state => state.dockPinned)
  const panelWindowMode = useStudioLayoutStore(state => state.panelWindowMode)
  const railWidth = useStudioLayoutStore(state => state.railWidth)
  const displayedPanelWindowSize = useStudioLayoutStore(state => displayedPanel === null ? undefined : state.panelWindowSizes[displayedPanel])
  const setPanelWindowSize = useStudioLayoutStore(state => state.setPanelWindowSize)
  const setAssetMetadataOpen = useStudioLayoutStore(state => state.setAssetMetadataOpen)
  const toggleDockPinned = useStudioLayoutStore(state => state.toggleDockPinned)
  const togglePanel = props.navigation.togglePanel
  const togglePanelWindowMode = useStudioLayoutStore(state => state.togglePanelWindowMode)
  const isImmersive = activePanel !== null && panelWindowMode === 'immersive'
  const isDisplayedImmersive = displayedPanel !== null && panelWindowMode === 'immersive'
  const windowResize = useStudioWindowResize({ activePanel, dockRef, setPanelWindowSize, stageRef })

  const [localAgentPanelOpen, setLocalAgentPanelOpen] = useState(false)
  const isAgentPanelOpen = props.agentPanelOpen !== undefined ? props.agentPanelOpen : localAgentPanelOpen
  const toggleAgentPanel = props.onToggleAgentPanel ?? (() => setLocalAgentPanelOpen(prev => !prev))
  const [agentPanelWidth, setAgentPanelWidth] = useState<number | undefined>(undefined)
  const [headerActionsTarget, setHeaderActionsTarget] = useState<HTMLDivElement | null>(null)
  useEffect(() => {
    if (isAgentPanelOpen) return
    const panel = document.getElementById('studio-panel-right')
    if (panel?.contains(document.activeElement)) agentPanelToggleRef.current?.focus()
  }, [isAgentPanelOpen])

  const [dockHovered, setDockHovered] = useState(false)
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false)
  const [mobileDrawerProgress, setMobileDrawerProgress] = useState<number | null>(null)
  const drawerProgressRef = useRef<number | null>(null)
  const drawerAnimationRef = useRef<Animation | undefined>(undefined)
  const drawerBackdropAnimationRef = useRef<Animation | undefined>(undefined)
  const backdropRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const progress = drawerProgressRef.current ?? (mobileDrawerOpen ? 1 : 0)
    mobileSidebarRef.current?.style.setProperty('--loom-mobile-drawer-progress', String(progress))
    if (backdropRef.current) backdropRef.current.style.opacity = String(progress)
  }, [mobileDrawerProgress, mobileDrawerOpen, activePanel])
  useEffect(() => () => { drawerAnimationRef.current?.cancel(); drawerBackdropAnimationRef.current?.cancel() }, [])
  const [railHidden, setRailHidden] = useState(false)
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (activePanel === null && railHidden) {
      setRailHidden(false)
    }
  }, [activePanel, railHidden])

  useLayoutEffect(() => {
    if (activePanel !== null) {
      // Commit the workspace before retiring its full navigation surface.
      drawerAnimationRef.current?.cancel()
      drawerBackdropAnimationRef.current?.cancel()
      drawerProgressRef.current = null
      setMobileDrawerOpen(false)
      setMobileDrawerProgress(null)
      displayedPanelRef.current = activePanel
      setDisplayedPanel(activePanel)
      setPanelMotion('idle')
    } else if (displayedPanelRef.current !== null) {
      setPanelMotion('closing')
    }
  }, [activePanel])

  useLayoutEffect(() => {
    const element = panelVisualRef.current
    if (!element || displayedPanel === null) return
    if (activePanel !== null && (displayedPanel !== activePanel || panelMotion === 'closing')) return
    if (activePanel === null && panelMotion !== 'closing') return
    if (isMobile) {
      requestedHistoryDirection.current = undefined
      // Sidebar is an independent overlay. Sibling workspaces replace the base content.
      if (activePanel === null) {
        displayedPanelRef.current = null
        setDisplayedPanel(null)
        setPanelMotion('idle')
      }
      return
    }
    const controller = new AbortController()
    const direction = requestedHistoryDirection.current
    requestedHistoryDirection.current = undefined
    if (direction && props.navigation.historyAction === 'POP') element.dataset.historyDirection = direction
    const phase = activePanel === null ? 'exit' : 'enter'
    void styleMotion.run(element, phase, controller.signal).then(() => {
      if (controller.signal.aborted) return
      delete element.dataset.historyDirection
      if (phase === 'exit') {
        displayedPanelRef.current = null
        setDisplayedPanel(null)
        setPanelMotion('idle')
      }
    })
    return () => {
      controller.abort()
      delete element.dataset.historyDirection
    }
  }, [activePanel, displayedPanel, panelMotion, effectiveMotion, isMobile])

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

  const mobileReadingActive = isMobile && !props.mobileChromeLocked
    && activePanel === null && displayedPanel === null && !props.navigation.route.tool
    && !mobileDrawerOpen && mobileDrawerProgress === null && !isAgentPanelOpen
  useMobileReadingChrome(stageRef, mobileReadingActive,
    JSON.stringify([props.navigation.route, isAgentPanelOpen]))

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const isDockVisible = isMobile
    ? displayedPanel !== null
    : (activePanel !== null || dockPinned || dockHovered)

  const isWorkspaceOpen = isMobile
    ? displayedPanel !== null
    : (activePanel !== null || dockPinned)

  const hasOpenPage = activePanel !== null || Boolean(props.navigation.route.tool)
    || mobileDrawerOpen || mobileDrawerProgress !== null || isAgentPanelOpen || assetMetadataOpen
  const returnToReading = () => {
    void props.navigation.returnToReading()
    drawerAnimationRef.current?.cancel()
    drawerBackdropAnimationRef.current?.cancel()
    drawerAnimationRef.current = undefined
    drawerProgressRef.current = null
    setMobileDrawerProgress(null)
    setMobileDrawerOpen(false)
    setAssetMetadataOpen(false)
    setDockHovered(false)
    closeDock()
    if (isAgentPanelOpen) toggleAgentPanel()
  }

  const showMobileNavigation = () => {
    setMobileDrawerOpen(true)
  }
  useMobileNavigationGestures(isMobile, showMobileNavigation, {
    enabled: !props.navigation.route.tool && !isAgentPanelOpen,
    open: mobileDrawerOpen,
    getProgress: () => {
      const dock = mobileSidebarRef.current
      if (!dock) return mobileDrawerOpen ? 1 : 0
      const transform = getComputedStyle(dock).transform
      return transform === 'none' ? 1 : 1 + new DOMMatrixReadOnly(transform).m41 / dock.clientWidth
    },
    onProgress: progress => {
      drawerAnimationRef.current?.cancel()
      drawerBackdropAnimationRef.current?.cancel()
      drawerAnimationRef.current = undefined
      if (drawerProgressRef.current === null) setMobileDrawerProgress(0)
      drawerProgressRef.current = progress
      mobileSidebarRef.current?.style.setProperty('--loom-mobile-drawer-progress', String(progress))
      if (backdropRef.current) backdropRef.current.style.opacity = String(progress)
    },
    onEnd: (open, velocity = 0) => {
      const dock = mobileSidebarRef.current
      const finish = () => {
        drawerProgressRef.current = null
        setMobileDrawerOpen(open)
        setMobileDrawerProgress(null)
      }
      if (!dock) { finish(); return }
      const from = getComputedStyle(dock).transform
      const target = open ? 0 : -dock.clientWidth
      const progress = drawerProgressRef.current ?? (mobileDrawerOpen ? 1 : 0)
      const animation = dock.animate([{ transform: from }, { transform: `translate3d(${target}px,0,0)` }], {
        duration: mobileMotionDuration(((open ? 1 : 0) - progress) * dock.clientWidth, velocity), easing: mobileMotionEasing, fill: 'both',
      })
      drawerAnimationRef.current = animation
      drawerBackdropAnimationRef.current = backdropRef.current?.animate([{ opacity: progress }, { opacity: open ? 1 : 0 }], {
        duration: mobileMotionDuration(((open ? 1 : 0) - progress) * dock.clientWidth, velocity), easing: mobileMotionEasing, fill: 'both',
      })
      void animation.finished.then(() => {
        if (drawerAnimationRef.current !== animation) return
        dock.style.setProperty('--loom-mobile-drawer-progress', String(open ? 1 : 0))
        animation.cancel()
        if (backdropRef.current) backdropRef.current.style.opacity = String(open ? 1 : 0)
        drawerBackdropAnimationRef.current?.cancel()
        drawerAnimationRef.current = undefined
        finish()
      }, () => {})
    },
  })

  const handleToggleWorkspace = () => {
    if (isMobile) {
      setMobileDrawerOpen(prev => !prev)
    } else {
      if (activePanel !== null) {
        closePanel()
      } else {
        if (dockPinned) {
          toggleDockPinned()
          setDockHovered(false)
        } else {
          toggleDockPinned()
        }
      }
    }
  }

  const activeAssetLayoutId = displayedPanel ? readAssetLayoutId(displayedPanel) : null
  const activeAssetViewMode = useStudioLayoutStore(state => activeAssetLayoutId === null
    ? null
    : (state.assetLayouts[activeAssetLayoutId].views[props.assetWorkspaceId] ?? DEFAULT_ASSET_VIEW_STATE).viewMode)
  const activeAssetPane = useStudioLayoutStore(state => activeAssetLayoutId === null
    ? null
    : (state.assetPanes[activeAssetLayoutId][props.assetWorkspaceId] ?? 'explorer'))
  const activeAssetSelectedId = useStudioLayoutStore(state => activeAssetLayoutId === null
    ? undefined
    : (state.assetLayouts[activeAssetLayoutId].views[props.assetWorkspaceId] ?? DEFAULT_ASSET_VIEW_STATE).selectedId)
  const setAssetPane = useStudioLayoutStore(state => state.setAssetPane)
  const canGoBackAsset = activeAssetLayoutId !== null && activeAssetViewMode === 'drilldown' && activeAssetPane === 'detail'
  const assetForwardRef = useRef<{ layoutId: AssetLayoutId; workspaceId: string; selectedId?: string } | undefined>(undefined)
  const handleHistoryNavigation = (direction: 'back' | 'forward') => {
    const nav = useStudioLayoutStore.getState().workbenchNavigation
    if (direction === 'back') {
      if (nav?.canGoBack() && nav.goBack()) {
        return
      }
      if (canGoBackAsset && activeAssetLayoutId) {
        assetForwardRef.current = {
          layoutId: activeAssetLayoutId,
          workspaceId: props.assetWorkspaceId,
          selectedId: activeAssetSelectedId,
        }
        setAssetPane(activeAssetLayoutId, props.assetWorkspaceId, 'explorer')
        return
      }
      assetForwardRef.current = undefined
      requestedHistoryDirection.current = 'back'
      void props.navigation.goBack()
    } else {
      if (nav?.canGoForward?.() && nav.goForward?.()) {
        return
      }
      const forward = assetForwardRef.current
      if (activeAssetLayoutId && activeAssetViewMode === 'drilldown' && activeAssetPane === 'explorer'
        && forward?.layoutId === activeAssetLayoutId && forward.workspaceId === props.assetWorkspaceId
        && forward.selectedId === activeAssetSelectedId) {
        assetForwardRef.current = undefined
        setAssetPane(activeAssetLayoutId, props.assetWorkspaceId, 'detail')
        return
      }
      requestedHistoryDirection.current = 'forward'
      void props.navigation.goForward()
    }
  }



  const pointerDownOutsideRef = useRef(false)

  useEffect(() => {
    if (activePanel === null || dockPinned || isImmersive) return

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target) {
        pointerDownOutsideRef.current = false
        return
      }

      if (dockRef.current?.contains(target)) {
        pointerDownOutsideRef.current = false
        return
      }

      if (
        (target as Element).closest?.(
          '[data-radix-portal], [role="menu"], [role="dialog"], [role="alertdialog"], [data-radix-popper-content-wrapper], [data-radix-context-menu-content], [data-radix-dropdown-menu-content]'
        )
      ) {
        pointerDownOutsideRef.current = false
        return
      }

      if ((target as Element).closest?.(`.${styles.stageFloatingHeader}`)) {
        pointerDownOutsideRef.current = false
        return
      }

      pointerDownOutsideRef.current = true
    }

    const handleClick = (event: MouseEvent) => {
      if (!pointerDownOutsideRef.current || windowResize.resizing) return

      const target = event.target as Node | null
      if (!target) return

      if (dockRef.current?.contains(target)) return
      if (
        (target as Element).closest?.(
          '[data-radix-portal], [role="menu"], [role="dialog"], [role="alertdialog"], [data-radix-popper-content-wrapper], [data-radix-context-menu-content], [data-radix-dropdown-menu-content]'
        )
      ) {
        return
      }
      if ((target as Element).closest?.(`.${styles.stageFloatingHeader}`)) {
        return
      }

      event.stopPropagation()
      event.preventDefault()
      closePanel()
    }

    window.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('click', handleClick, true)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('click', handleClick, true)
    }
  }, [activePanel, dockPinned, isImmersive, windowResize.resizing, closePanel])

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

    displayedPanel !== null ? styles.floatingDockActive : (isDockVisible ? styles.floatingDockVisible : styles.floatingDockHidden),
    displayedPanel !== null && readPanelPlacement(displayedPanel) === 'beside-narrative' ? styles.floatingDockBesideNarrative : '',
    displayedPanel !== null && readPanelPlacement(displayedPanel) === 'cover-narrative' ? styles.floatingDockCoverNarrative : '',
    isDisplayedImmersive ? styles.floatingDockImmersive : '',
    windowResize.resizing ? styles.floatingDockResizing : '',
  ].filter(Boolean).join(' ')
  const railPresentation = resolveRailPresentation(activePanel, railWidth)
  const dockWindowSize = activePanel !== null && windowResize.preview?.panel === activePanel
    ? windowResize.preview.size
    : displayedPanelWindowSize
  const targetPanelWidth = dockWindowSize && !isDisplayedImmersive
    ? `${dockWindowSize.width}px`
    : isDisplayedImmersive
      ? 'calc(100vw - 12px)'
      : 'clamp(42rem, 52vw, 72rem)'
  const dockStyle = {
    '--loom-shell-rail-preferred-width': `${railPresentation.preferredWidth}px`,
    '--loom-shell-panel-target-width': targetPanelWidth,
    ...(dockWindowSize && !isDisplayedImmersive ? { width: `${dockWindowSize.width}px` } : {}),
  } as CSSProperties
  const renderDockSidebar = (compact = railPresentation.compact, fullNavigation = false) => (
    <div className={styles.dockSidebar}>
      <header className={styles.dockHeader} data-loom-component="page-header">
        {displayedPanel !== null && !fullNavigation ? (
          <button
            aria-label="收起导航栏"
            className={styles.dockCollapseButton}
            title="收起导航栏"
            type="button"
            onClick={() => setRailHidden(true)}
          >
            <PanelLeftClose aria-hidden="true" className={styles.dockCollapseButtonIcon} />
          </button>
        ) : (
          <button
            aria-label={dockPinned ? props.t('rail.unpinDock') : props.t('rail.pinDock')}
            aria-hidden={compact}
            aria-pressed={dockPinned}
            className={[
              styles.dockBrandTextButton,
              dockPinned ? styles.dockBrandTextButtonPinned : '',
            ].filter(Boolean).join(' ')}
            title={dockPinned ? props.t('rail.unpinDock') : props.t('rail.pinDock')}
            tabIndex={compact ? -1 : 0}
            type="button"
            onClick={() => toggleDockPinned()}
          >
            <span className={styles.dockBrandText}>LoomStudio</span>
          </button>
        )}
      </header>
      <StudioRail
        compact={compact}
        activePanel={props.navigation.route.tool ?? activePanel}
        modelConfigured={props.modelConfigured}
        recentSessions={props.recentSessions}
        t={props.t}
        preloadPanel={props.preloadPanel}
        onOpenDashboard={() => {
          setMobileDrawerOpen(false)
          props.onOpenDashboard()
        }}
        togglePanel={panel => {
          if (isMobile && activePanel === panel) { setMobileDrawerOpen(false); return }
          togglePanel(panel)
        }}
      />
    </div>
  )
  const panelHost = (
    <div className={styles.dockPanelHost}>
      {displayedPanel !== null ? <StudioWindowHeader
        actions={props.panelHeaderActions?.[displayedPanel]}
        actionsTargetRef={setHeaderActionsTarget}
        activePanel={displayedPanel}
        assetWorkspaceId={props.assetWorkspaceId}
        leading={isMobile ? undefined : (
          <div className={styles.dockExpandLeading} data-visible={isMobile || railHidden ? 'true' : 'false'}>
            <button
              aria-label="展开导航栏"
              className={styles.dockCollapseButton}
              title="展开导航栏"
              tabIndex={isMobile || railHidden ? 0 : -1}
              type="button"
              onClick={() => isMobile ? showMobileNavigation() : setRailHidden(false)}
            >
              <PanelLeft aria-hidden="true" className={styles.dockCollapseButtonIcon} />
            </button>
          </div>
        )}
        main={props.panelHeaderMain?.[displayedPanel]}
        t={props.t}
        onPanelHistory={direction => {
          requestedHistoryDirection.current = direction
          if (direction === 'back') void props.navigation.goBack()
          else void props.navigation.goForward()
        }}
      /> : null}
      <StudioPanelHost activePanel={displayedPanel} panels={props.panels} />
    </div>
  )
  return (
    <main className={styles.workbench} data-loom-component="studio-workspace-shell" data-loom-object="studio-shell">
      <section
        ref={stageRef}
        className={styles.studioStage}
        data-loom-component="application-layer-stage"
      >
        <div className={styles.stageWallpaperBackdrop} aria-hidden="true">
          {previousWallpaper ? (
            <div
              key={`previous:${previousWallpaper}`}
              className={currentWallpaper ? styles.stageWallpaperPrevious : styles.stageWallpaperExit}
              style={{ backgroundImage: `url(${JSON.stringify(previousWallpaper)})` }}
            />
          ) : null}
          {currentWallpaper ? (
            <div
              key={`current:${currentWallpaper}`}
              className={styles.stageWallpaperLayer}
              style={{ backgroundImage: `url(${JSON.stringify(currentWallpaper)})` }}
            />
          ) : null}
        </div>
        {props.background ? (
          <div className={styles.stageBackground} data-loom-component="shell-background-layer">
            {props.background}
          </div>
        ) : null}
        <div className={styles.stageBase} data-loom-component="base-chat-canvas-layer">
          {props.canvas}
        </div>

        <header className={styles.stageFloatingHeader} data-loom-component="stage-floating-header">
          <div className={styles.stageHeaderStart}>
          <div className={styles.stageHeaderLeft}>
            <button
              aria-label={isWorkspaceOpen ? props.t('rail.closePanel') : props.t('rail.label')}
              className={[
                styles.stageHeaderButton,
                isWorkspaceOpen ? styles.stageHeaderButtonActive : '',
              ].filter(Boolean).join(' ')}
              title={isWorkspaceOpen ? props.t('rail.closePanel') : props.t('rail.label')}
              type="button"
              onClick={handleToggleWorkspace}
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
            >
              <AlignLeft aria-hidden="true" className={styles.stageHeaderButtonIcon} />
            </button>
            <button
              aria-label={props.t('navigation.back')}
              className={styles.stageHeaderButton}
              title={props.t('navigation.back')}
              type="button"
              onClick={() => handleHistoryNavigation('back')}
            >
              <ArrowLeft aria-hidden="true" className={styles.stageHeaderButtonIcon} />
            </button>
            <button
              aria-label={props.t('navigation.forward')}
              className={styles.stageHeaderButton}
              title={props.t('navigation.forward')}
              type="button"
              onClick={() => handleHistoryNavigation('forward')}
            >
              <ArrowRight aria-hidden="true" className={styles.stageHeaderButtonIcon} />
            </button>
          </div>

            <div className={styles.stageSearchCapsule}>
              <button type="button" className={styles.stageSearchOpen} onClick={props.onOpenSearch} aria-label={props.t('search.open')} title={`${props.t('search.open')} (⌘K / Ctrl+K)`} aria-haspopup="dialog">
                <Search size={16} aria-hidden="true" />
                {props.searchQuery ? <span className={styles.stageSearchQuery} title={props.searchQuery}>{props.searchQuery}</span> : null}
              </button>
              {props.searchQuery ? <button type="button" className={styles.stageSearchClear} onClick={props.onClearSearch} aria-label={props.t('search.clearQuery')} title={props.t('search.clearQuery')}><X size={13} aria-hidden="true" /></button> : null}
            </div>
          </div>

          <div className={styles.stageHeaderCenter}>
            {props.characterControl}
          </div>

          <div className={styles.stageHeaderRight}>
            {props.headerActions}
            {hasOpenPage ? <button type="button" className={`${styles.stageHeaderButton} ${styles.stageReturnButton}`}
              aria-label="关闭页面，返回正文" title="关闭页面，返回正文" onClick={returnToReading}>
              <X aria-hidden="true" className={styles.stageHeaderButtonIcon} />
            </button> : null}
            <StageAgentCapsule
              ref={agentPanelToggleRef}
              open={isAgentPanelOpen}
              session={props.agentSession}
              sessionsCount={props.agentSessionsCount}
              t={props.t}
              onToggle={toggleAgentPanel}
            />
          </div>
        </header>

        <StudioPanelRight
          mobile={isMobile}
          showMobileHandle={mobileReadingActive}
          onOpen={() => { if (!isAgentPanelOpen) toggleAgentPanel() }}
          open={isAgentPanelOpen}
          width={agentPanelWidth}
          onClose={toggleAgentPanel}
          onWidthChange={setAgentPanelWidth}
        >
          {props.agentPanel}
        </StudioPanelRight>

        {isMobile && (mobileDrawerOpen || mobileDrawerProgress !== null) ? (
          <div
            ref={backdropRef}
            className={styles.mobileBackdrop}
            style={{ opacity: mobileDrawerProgress ?? (mobileDrawerOpen ? 1 : 0), transition: mobileDrawerProgress !== null ? 'none' : 'opacity 220ms ease' }}
            aria-hidden="true"
            onClick={() => {
              setMobileDrawerOpen(false)
            }}
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

        <StudioWindowHeaderProvider activePanel={activePanel} actionsTarget={headerActionsTarget}>
        <aside
          ref={dockRef}
          className={dockClassName}
          style={dockStyle}
          aria-hidden={!isDockVisible}
          data-loom-component="floating-widget-dock"
          data-panel-motion={panelMotion}
          inert={!isDockVisible}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <div className={styles.workspaceMotionClip}>
            <div
              className={styles.workspaceShellLayout}
              data-mobile-content={isMobile && displayedPanel !== null ? 'true' : undefined}
              data-rail-compact={railPresentation.compact}
              data-rail-hidden={railHidden && displayedPanel !== null ? 'true' : undefined}
            >
              <div className={styles.workspaceRail}>{renderDockSidebar()}</div>
              <div ref={panelVisualRef} data-loom-mobile-tab-scope="" data-loom-component="workbench-panel" className={styles.workspacePanel} hidden={displayedPanel === null}
                style={displayedPanel === null ? { display: 'none' } : undefined}>{panelHost}</div>
            </div>
          </div>

          {activePanel !== null && !isImmersive ? (
            <WindowResizeHandle axis="horizontal" className={styles.windowResizeRight} label={props.t('window.resizeWidth')} resize={windowResize} />
          ) : null}
        </aside>
        </StudioWindowHeaderProvider>
        {isMobile ? <aside ref={mobileSidebarRef} className={styles.mobileSidebar}
          data-mobile-drawer="true" data-open={mobileDrawerOpen || mobileDrawerProgress !== null}
          data-mobile-drawer-dragging={mobileDrawerProgress !== null ? 'true' : undefined}
          aria-hidden={!mobileDrawerOpen && mobileDrawerProgress === null} inert={!mobileDrawerOpen && mobileDrawerProgress === null}>
          {renderDockSidebar(false, true)}
        </aside> : null}

      </section>
      {STUDIO_TOOL_IDS.map(tool => {
        const { Icon, labelKey } = STUDIO_PANEL_PRESENTATION[tool]
        return <StudioToolDialog ready={props.overlaysReady} key={tool} id={`studio-${tool}-panel`}
          open={props.navigation.route.tool === tool} onClose={() => props.navigation.closeTool()} onReturnToReading={returnToReading}
          title={props.t(labelKey)} icon={<Icon />} closeLabel={props.t('agentTasks.close')}
          render={active => props.panels[tool](active, 'tool')} />
      })}
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
      className={`${styles.windowResizeHandle} ${props.className} ${props.resize.resizing ? styles.windowResizeActive : ''}`}
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
  if (panel === 'model' || panel === 'agent' || panel === 'play' || panel === 'recent' || panel === 'sessions' || panel === 'character') return 'beside-narrative'
  return 'cover-narrative'
}
