import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { AlignLeft, ChevronDown, ImageOff, PanelRight, PanelRightClose } from 'lucide-react'
import type { AgentPreset, AgentSession, AgentTranscriptEntry, ProviderAccount } from '../../entities/index.js'
import type { ActiveAgentRun } from '../../features/narrative-runtime/model/use-narrative-runtime.js'
import type { RunRecoveryControlsProps } from '../../features/narrative-runtime/ui/run-recovery-controls.js'
import type { ClientRendererHost } from '../../shared/extension-renderer-runtime/client-renderer-host.js'
import type { Translator } from '../../shared/i18n/index.js'
import { AgentChatPanel } from '../../widgets/agent-chat-panel/agent-chat-panel.js'
import { StudioPanelRight } from './studio-panel-right.js'
import { useStudioLayoutStore, type StudioPanelId } from '../../shared/studio-shell/studio-layout-store.js'
import type { useStudioNavigation } from '../../shared/studio-shell/use-studio-navigation.js'
import { StudioPanelHost } from './studio-panel-host.js'
import { StudioWindowHeader } from './studio-window-header.js'
import { StudioWindowHeaderProvider } from '../../shared/studio-shell/studio-window-header-context.js'
import { StudioRail } from './studio-rail.js'
import { useStudioShortcuts } from './use-studio-shortcuts.js'
import { useStudioLayoutAnchors } from './use-studio-layout-anchors.js'
import { useStudioWindowResize } from './use-studio-window-resize.js'
import { useEffectiveMotion } from '../../shared/hooks/use-motion-preference.js'
import { resolveRailPresentation } from './studio-shell-layout.js'
import type { WindowResizeAxis } from '../../shared/studio-shell/window-resize.js'
import styles from './studio-page.module.scss'
import type { DisplayProjection } from '../../features/message-content/model/use-display-projection.js'

type StudioPageProps = RunRecoveryControlsProps & {
  navigation: ReturnType<typeof useStudioNavigation>
  agentChatBusy?: boolean
  agentActiveRun?: ActiveAgentRun
  agentChatInput?: string
  agentChatMessages?: AgentTranscriptEntry[]
  agentDisplay?: DisplayProjection
  agentChatSession?: AgentSession
  agentChatSessions?: AgentSession[]
  agentChatSessionReady?: boolean
  agentPanelOpen?: boolean
  agentPresets?: AgentPreset[]
  agentSessionTail?: ReactNode
  assetWorkspaceId: string
  background?: ReactNode
  busy: boolean
  canRedo: boolean
  canUndo: boolean
  canvas: ReactNode
  characterAvatarUrl?: string
  characterName?: string
  customCss: string
  modelConfigured?: boolean
  panelHeaderActions?: Partial<Record<StudioPanelId, ReactNode>>
  panelHeaderMain?: Partial<Record<StudioPanelId, ReactNode>>
  headerActions?: ReactNode
  panels: Record<StudioPanelId, (active: boolean) => ReactNode>
  preloadPanel?(panel: StudioPanelId): void
  providerAccounts?: ProviderAccount[]
  recentSessions?: ReactNode
  rendererHost?: ClientRendererHost
  selectedAgentPresetId?: string
  t: Translator
  uiScale: number
  onChangeAgentChatInput?(value: string): void
  onRedo(): void
  onSelectAgentPreset?(id: string): void
  onSelectAgentSession?(id: string): void
  onNewAgentSession?(): void
  onRefreshAgentSessions?(): void
  onSubmitAgentChat?(event: FormEvent): void
  onCancelAgentRun?(): void
  onPauseAgentRun?(): void
  onResumeAgentRun?(): void
  onApproveAgentMutation?(allow: boolean, reason?: string): void
  onToggleAgentPanel?(): void
  onUndo(): void
}

export function StudioPage(props: StudioPageProps) {
  const stageRef = useRef<HTMLElement>(null)
  const dockRef = useRef<HTMLElement>(null)
  const agentPanelToggleRef = useRef<HTMLButtonElement>(null)
  useStudioLayoutAnchors(stageRef)
  const activePanel = props.navigation.route.panel
  const effectiveMotion = useEffectiveMotion()
  const [displayedPanel, setDisplayedPanel] = useState(activePanel)
  const [panelMotion, setPanelMotion] = useState<'closing' | 'idle'>('idle')
  const displayedPanelRef = useRef(activePanel)
  const panelCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previousDockRectRef = useRef<DOMRect | null>(null)
  const workspaceMotionRef = useRef<HTMLDivElement>(null)
  const workspaceAnimationRef = useRef<Animation | null>(null)
  const historyMotionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
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
  const [historyMotion, setHistoryMotion] = useState<{ direction: 'back' | 'forward'; panel: StudioPanelId | null } | null>(null)
  useEffect(() => {
    const direction = requestedHistoryDirection.current
    requestedHistoryDirection.current = undefined
    if (!direction || props.navigation.historyAction !== 'POP') return
    if (historyMotionTimerRef.current) clearTimeout(historyMotionTimerRef.current)
    setHistoryMotion({ direction, panel: activePanel })
    historyMotionTimerRef.current = setTimeout(() => {
      setHistoryMotion(null)
      historyMotionTimerRef.current = null
    }, 240)
  }, [props.navigation.locationKey, props.navigation.historyAction, activePanel])

  useEffect(() => {
    if (isAgentPanelOpen) return
    const panel = document.getElementById('studio-panel-right')
    if (panel?.contains(document.activeElement)) agentPanelToggleRef.current?.focus()
  }, [isAgentPanelOpen])

  const [dockHovered, setDockHovered] = useState(false)
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false)
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (panelCloseTimerRef.current) clearTimeout(panelCloseTimerRef.current)
    if (activePanel !== null) {
      displayedPanelRef.current = activePanel
      setDisplayedPanel(activePanel)
      setPanelMotion('idle')
      return
    }
    if (displayedPanelRef.current === null || effectiveMotion === 'reduce') {
      displayedPanelRef.current = null
      setDisplayedPanel(null)
      setPanelMotion('idle')
      return
    }
    setPanelMotion('closing')
    panelCloseTimerRef.current = setTimeout(() => {
      displayedPanelRef.current = null
      setDisplayedPanel(null)
      setPanelMotion('idle')
      panelCloseTimerRef.current = null
    }, 240)
  }, [activePanel, effectiveMotion])

  useEffect(() => () => {
    if (panelCloseTimerRef.current) clearTimeout(panelCloseTimerRef.current)
    workspaceAnimationRef.current?.cancel()
    if (historyMotionTimerRef.current) clearTimeout(historyMotionTimerRef.current)
  }, [])

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

  const [isMobile, setIsMobile] = useState(() => (typeof window !== 'undefined' ? window.innerWidth <= 768 : false))

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const isDockVisible = isMobile
    ? (activePanel !== null || mobileDrawerOpen)
    : (activePanel !== null || dockPinned || dockHovered)



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
    mobileDrawerOpen && activePanel === null ? styles.floatingDockMobileOpen : '',
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
  const dockStyle = {
    '--loom-shell-rail-preferred-width': `${railPresentation.preferredWidth}px`,
    ...(dockWindowSize && !isDisplayedImmersive ? { width: `${dockWindowSize.width}px` } : {}),
  } as CSSProperties
  useLayoutEffect(() => {
    const dock = dockRef.current
    if (!dock) return
    const nextRect = dock.getBoundingClientRect()
    const previousRect = previousDockRectRef.current
    previousDockRectRef.current = nextRect
    const workspace = workspaceMotionRef.current
    workspaceAnimationRef.current?.cancel()
    workspaceAnimationRef.current = null
    if (!workspace || !previousRect || effectiveMotion === 'reduce' || windowResize.resizing) return
    const insets = {
      top: Math.max(0, previousRect.top - nextRect.top),
      right: Math.max(0, nextRect.right - previousRect.right),
      bottom: Math.max(0, nextRect.bottom - previousRect.bottom),
      left: Math.max(0, previousRect.left - nextRect.left),
    }
    if (insets.top === 0 && insets.right === 0 && insets.bottom === 0 && insets.left === 0) return
    workspaceAnimationRef.current = workspace.animate([
      { clipPath: `inset(${insets.top}px ${insets.right}px ${insets.bottom}px ${insets.left}px)` },
      { clipPath: 'inset(0)' },
    ], {
      duration: 320,
      easing: 'cubic-bezier(0.2, 0, 0.2, 1)',
    })
  }, [displayedPanel, dockWindowSize, effectiveMotion, isDisplayedImmersive, windowResize.resizing])
  const dockSidebar = (
    <div className={styles.dockSidebar}>
      <header className={styles.dockHeader} data-loom-component="page-header">
        <button
          aria-label={props.t('rail.closePanel')}
          className={styles.dockBrandIconButton}
          title={props.t('rail.closePanel')}
          type="button"
          onClick={() => {
            if (activePanel !== null) {
              closePanel()
            } else if (mobileDrawerOpen) {
              setMobileDrawerOpen(false)
            } else if (dockPinned) {
              toggleDockPinned()
            }
          }}
        >
          <AlignLeft aria-hidden="true" className={styles.stageHeaderButtonIcon} />
        </button>
        <button
          aria-label={dockPinned ? props.t('rail.unpinDock') : props.t('rail.pinDock')}
          aria-hidden={railPresentation.compact}
          aria-pressed={dockPinned}
          className={[
            styles.dockBrandTextButton,
            dockPinned ? styles.dockBrandTextButtonPinned : '',
          ].filter(Boolean).join(' ')}
          title={dockPinned ? props.t('rail.unpinDock') : props.t('rail.pinDock')}
          tabIndex={railPresentation.compact ? -1 : 0}
          type="button"
          onClick={() => toggleDockPinned()}
        >
          <span className={styles.dockBrandText}>LoomStudio</span>
        </button>
      </header>
      <div className={styles.dockHeaderDivider} aria-hidden="true">
        <span className="loom-divider" />
      </div>
      <StudioRail
        activePanel={activePanel}
        modelConfigured={props.modelConfigured}
        recentSessions={props.recentSessions}
        t={props.t}
        preloadPanel={props.preloadPanel}
        togglePanel={panel => {
          setMobileDrawerOpen(false)
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
        main={props.panelHeaderMain?.[displayedPanel]}
        t={props.t}
        onPanelHistory={direction => {
          requestedHistoryDirection.current = direction
          if (direction === 'back') void props.navigation.goBack()
          else void props.navigation.goForward()
        }}
      /> : null}
      <StudioPanelHost activePanel={displayedPanel} historyMotion={historyMotion} panels={props.panels} />
    </div>
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

        <header className={styles.stageFloatingHeader} data-loom-component="stage-floating-header">
          <div className={styles.stageHeaderLeft} data-dock-open={isDockVisible ? 'true' : undefined}>
            <button
              aria-label={props.t('rail.label')}
              className={styles.stageHeaderButton}
              title={props.t('rail.label')}
              type="button"
              onClick={() => {
                if (isMobile) {
                  setMobileDrawerOpen(true)
                } else {
                  toggleDockPinned()
                }
              }}
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
            >
              <AlignLeft aria-hidden="true" className={styles.stageHeaderButtonIcon} />
            </button>

            {props.characterName ? (
              <button
                aria-label={`${props.characterName} - ${props.t('rail.character')}`}
                className={[
                  styles.stageCharacterCapsule,
                  activePanel === 'character' ? styles.stageCharacterCapsuleActive : '',
                ].filter(Boolean).join(' ')}
                title={`${props.characterName} (${props.t('rail.character')})`}
                type="button"
                onFocus={() => props.preloadPanel?.('character')}
                onMouseEnter={() => props.preloadPanel?.('character')}
                onPointerDown={() => props.preloadPanel?.('character')}
                onClick={() => togglePanel('character')}
              >
                <span aria-hidden="true" className={styles.stageCharacterCapsuleAvatar}>
                  <StageCharacterAvatar avatarUrl={props.characterAvatarUrl} name={props.characterName} />
                </span>
                <span className={styles.stageCharacterCapsuleName}>{props.characterName}</span>
                <ChevronDown aria-hidden="true" className={styles.stageCharacterCapsuleArrow} />
              </button>
            ) : null}
          </div>

          <div className={styles.stageHeaderRight}>
            {props.headerActions}
            <button
              ref={agentPanelToggleRef}
              aria-label={isAgentPanelOpen ? '关闭侧边面板' : '打开侧边面板'}
              className={[
                styles.stageHeaderButton,
                isAgentPanelOpen ? styles.stageHeaderButtonActive : '',
              ].filter(Boolean).join(' ')}
              title={isAgentPanelOpen ? '关闭侧边面板' : '打开侧边面板'}
              type="button"
              onClick={toggleAgentPanel}
            >
              {isAgentPanelOpen ? (
                <PanelRightClose aria-hidden="true" className={styles.stageHeaderButtonIcon} />
              ) : (
                <PanelRight aria-hidden="true" className={styles.stageHeaderButtonIcon} />
              )}
            </button>
          </div>
        </header>

        <StudioPanelRight
          open={isAgentPanelOpen}
          width={agentPanelWidth}
          onClose={toggleAgentPanel}
          onWidthChange={setAgentPanelWidth}
        >
          <AgentChatPanel
            displayProjection={props.agentDisplay}
            runRecovery={props.runRecovery}
            runRecoveryBusy={props.runRecoveryBusy}
            canRestoreRunInput={props.canRestoreRunInput}
            reconnectAgentRun={props.reconnectAgentRun}
            restoreRunInput={props.restoreRunInput}
            busy={props.agentChatBusy ?? false}
            activeRun={props.agentActiveRun}
            input={props.agentChatInput ?? ''}
            messages={props.agentChatMessages ?? []}
            profiles={props.agentPresets ?? []}
            providerAccounts={props.providerAccounts ?? []}
            rendererHost={props.rendererHost}
            selectedProfileId={props.selectedAgentPresetId}
            session={props.agentChatSession}
            sessions={props.agentChatSessions}
            sessionReady={props.agentChatSessionReady}
            sessionTail={props.agentSessionTail}
            t={props.t}
            onChangeInput={props.onChangeAgentChatInput ?? (() => {})}
            onSelectProfile={props.onSelectAgentPreset ?? (() => {})}
            onSelectSession={props.onSelectAgentSession}
            onNewSession={props.onNewAgentSession}
            onRefreshSessions={props.onRefreshAgentSessions}
            onSubmit={props.onSubmitAgentChat ?? (() => {})}
            onCancelRun={props.onCancelAgentRun}
            onPauseRun={props.onPauseAgentRun}
            onResumeRun={props.onResumeAgentRun}
            onApproveMutation={props.onApproveAgentMutation}
          />
        </StudioPanelRight>

        {isMobile && (activePanel !== null || mobileDrawerOpen) ? (
          <div
            className={styles.mobileBackdrop}
            aria-hidden="true"
            onClick={() => {
              if (activePanel !== null) {
                closePanel()
              } else if (mobileDrawerOpen) {
                setMobileDrawerOpen(false)
              }
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
          <div ref={workspaceMotionRef} className={styles.workspaceMotionClip}>
            <div className={styles.workspaceShellLayout} data-rail-compact={railPresentation.compact}>
              <div className={styles.workspaceRail}>{dockSidebar}</div>
              <div className={styles.workspacePanel} hidden={displayedPanel === null}
                style={displayedPanel === null ? { display: 'none' } : undefined}>{panelHost}</div>
            </div>
          </div>

          {activePanel !== null && !isImmersive ? (
            <WindowResizeHandle axis="horizontal" className={styles.windowResizeRight} label={props.t('window.resizeWidth')} resize={windowResize} />
          ) : null}
        </aside>
        </StudioWindowHeaderProvider>

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
  if (panel === 'model' || panel === 'agent' || panel === 'play' || panel === 'sessions' || panel === 'character') return 'beside-narrative'
  return 'cover-narrative'
}

function StageCharacterAvatar(props: { avatarUrl?: string; name?: string }) {
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    setLoadError(false)
  }, [props.avatarUrl])

  if (props.avatarUrl && !loadError) {
    return (
      <img
        alt=""
        src={props.avatarUrl}
        onError={() => setLoadError(true)}
      />
    )
  }
  return <ImageOff aria-hidden="true" className={styles.stageAvatarFallbackIcon} />
}
