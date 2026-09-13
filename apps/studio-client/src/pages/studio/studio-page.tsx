import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { AlignLeft, ChevronDown, ImageOff, PanelRight, PanelRightClose } from 'lucide-react'
import type { AgentProfile, AgentSession, AgentTranscriptEntry, ProviderAccount } from '../../entities/index.js'
import type { ClientRendererHost } from '../../features/extension-renderers/model/client-renderer-host.js'
import type { Translator } from '../../shared/i18n/index.js'
import { AgentChatPanel } from '../../widgets/agent-chat-panel/agent-chat-panel.js'
import { StudioPanelRight } from './studio-panel-right.js'
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
  agentChatBusy?: boolean
  agentChatInput?: string
  agentChatMessages?: AgentTranscriptEntry[]
  agentChatSession?: AgentSession
  agentChatSessions?: AgentSession[]
  agentChatSessionReady?: boolean
  agentPanelOpen?: boolean
  agentProfiles?: AgentProfile[]
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
  panelHeaders?: Partial<Record<StudioPanelId, ReactNode>>
  panels: Record<StudioPanelId, (active: boolean) => ReactNode>
  providerAccounts?: ProviderAccount[]
  recentSessions?: ReactNode
  rendererHost?: ClientRendererHost
  selectedAgentProfileId?: string
  t: Translator
  uiScale: number
  onChangeAgentChatInput?(value: string): void
  onRedo(): void
  onSelectAgentProfile?(id: string): void
  onSelectAgentSession?(id: string): void
  onNewAgentSession?(): void
  onRefreshAgentSessions?(): void
  onSubmitAgentChat?(event: FormEvent): void
  onToggleAgentPanel?(): void
  onUndo(): void
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
  const toggleDockPinned = useStudioLayoutStore(state => state.toggleDockPinned)
  const togglePanel = useStudioPanelStore(state => state.togglePanel)
  const togglePanelWindowMode = useStudioLayoutStore(state => state.togglePanelWindowMode)
  const isImmersive = activePanel !== null && panelWindowMode === 'immersive'
  const windowResize = useStudioWindowResize({ activePanel, dockRef, setPanelWindowSize, stageRef })

  const [localAgentPanelOpen, setLocalAgentPanelOpen] = useState(false)
  const isAgentPanelOpen = props.agentPanelOpen !== undefined ? props.agentPanelOpen : localAgentPanelOpen
  const toggleAgentPanel = props.onToggleAgentPanel ?? (() => setLocalAgentPanelOpen(prev => !prev))
  const [agentPanelWidth, setAgentPanelWidth] = useState<number | undefined>(undefined)

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
  const dockStyle = activePanelWindowSize && !isImmersive
    ? { width: `${activePanelWindowSize.width}px` } as CSSProperties
    : undefined
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
          <img
            alt="LoomStudio"
            className={styles.dockBrandIcon}
            src="/images/favicon.ico"
          />
        </button>
        <button
          aria-label={dockPinned ? props.t('rail.unpinDock') : props.t('rail.pinDock')}
          aria-pressed={dockPinned}
          className={[
            styles.dockBrandTextButton,
            dockPinned ? styles.dockBrandTextButtonPinned : '',
          ].filter(Boolean).join(' ')}
          title={dockPinned ? props.t('rail.unpinDock') : props.t('rail.pinDock')}
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

        <header className={styles.stageFloatingHeader} data-loom-component="stage-floating-header">
          <div className={styles.stageHeaderLeft}>
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
            <button
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
            busy={props.agentChatBusy ?? false}
            input={props.agentChatInput ?? ''}
            messages={props.agentChatMessages ?? []}
            profiles={props.agentProfiles ?? []}
            providerAccounts={props.providerAccounts ?? []}
            rendererHost={props.rendererHost}
            selectedProfileId={props.selectedAgentProfileId}
            session={props.agentChatSession}
            sessions={props.agentChatSessions}
            sessionReady={props.agentChatSessionReady}
            sessionTail={props.agentSessionTail}
            t={props.t}
            onChangeInput={props.onChangeAgentChatInput ?? (() => {})}
            onSelectProfile={props.onSelectAgentProfile ?? (() => {})}
            onSelectSession={props.onSelectAgentSession}
            onNewSession={props.onNewAgentSession}
            onRefreshSessions={props.onRefreshAgentSessions}
            onSubmit={props.onSubmitAgentChat ?? (() => {})}
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
            <WindowResizeHandle axis="horizontal" className={styles.windowResizeRight} label={props.t('window.resizeWidth')} resize={windowResize} />
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
