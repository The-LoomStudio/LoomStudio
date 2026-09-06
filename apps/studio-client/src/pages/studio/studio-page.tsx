import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { AlignLeft, ChevronDown, ImageOff, PanelRight, PanelRightClose, Plus, X } from 'lucide-react'
import type { Translator } from '../../shared/i18n/index.js'
import { ChatComposer } from '../../widgets/chat-composer/chat-composer.js'
import { StudioPanelRight } from './studio-panel-right.js'
import { ConversationMarkdown } from '../../shared/ui/conversation-markdown/conversation-markdown.js'
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
  busy: boolean
  canRedo: boolean
  canUndo: boolean
  canvas: ReactNode
  characterAvatarUrl?: string
  characterName?: string
  customCss: string
  modelConfigured?: boolean
  onRedo(): void
  onUndo(): void
  panelHeaders?: Partial<Record<StudioPanelId, ReactNode>>
  panels: Record<StudioPanelId, (active: boolean) => ReactNode>
  t: Translator
  uiScale: number
}

type MockAgentMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  time: string
}

const INITIAL_MOCK_AGENT_MESSAGES: MockAgentMessage[] = [
  {
    id: 'mock-1',
    role: 'user',
    content: '帮我分析一下当前章节的剧情节奏与角色动机。',
    time: '17:36',
  },
  {
    id: 'mock-2',
    role: 'assistant',
    content: `已对当前剧情分支进行全流程溯源分析：

1. **核心动机冲突**：角色在面对旧信物时表现出克制与犹豫，建议在后续对话中增加一段微小的心理动作刻画。
2. **伏笔呼应**：前序章节提到的信物在此处可作为关键线索激活。

\`\`\`markdown
> 示例：“她握紧了掌心中的铜镜，镜面泛起微弱的光芒，终究没有回头。”
\`\`\`

你可以继续探索其他分支，或者直接告诉我需要修改的方向。`,
    time: '17:36',
  },
]

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

  const [agentPanelOpen, setAgentPanelOpen] = useState(false)
  const [agentPanelWidth, setAgentPanelWidth] = useState<number | undefined>(undefined)
  const [agentMockInput, setAgentMockInput] = useState('')
  const [mockAgentMessages, setMockAgentMessages] = useState<MockAgentMessage[]>(INITIAL_MOCK_AGENT_MESSAGES)
  const agentTimelineRef = useRef<HTMLDivElement>(null)

  const handleSendAgentMockMessage = () => {
    const trimmed = agentMockInput.trim()
    if (!trimmed) return
    const userMsg: MockAgentMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: trimmed,
      time: '刚刚',
    }
    setMockAgentMessages(prev => [...prev, userMsg])
    setAgentMockInput('')
    setTimeout(() => {
      const assistantMsg: MockAgentMessage = {
        id: `msg-${Date.now() + 1}`,
        role: 'assistant',
        content: `收到你的指示：“${trimmed}”。\n\n已完成分析并更新当前侧边上下文，你可以随时让我调整草稿或应用到正文中。`,
        time: '刚刚',
      }
      setMockAgentMessages(prev => [...prev, assistantMsg])
    }, 450)
  }

  useEffect(() => {
    if (!agentPanelOpen) return
    const el = agentTimelineRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [agentPanelOpen, mockAgentMessages.length])

  const codeBlockLabels = {
    copied: props.t('longTextEditor.copied'),
    copy: props.t('longTextEditor.copy'),
    copyFailed: props.t('longTextEditor.copyFailed'),
    disableWrap: props.t('markdown.code.disableWrap'),
    enableWrap: props.t('markdown.code.enableWrap'),
  }

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
      ? { width: `${activePanelWindowSize.width}px` }
      : {}),
  } as CSSProperties
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
            {agentPanelOpen ? (
              <button
                type="button"
                className={styles.stageHeaderButton}
                title="新建对话"
                onClick={() => {
                  setMockAgentMessages([
                    {
                      id: `init-${Date.now()}`,
                      role: 'assistant',
                      content: '你好！我是你的创作助手。已建立新的临时侧边对话，你可以随时向我提问剧情、分析设定或调试节点。',
                      time: '刚刚',
                    },
                  ])
                }}
              >
                <Plus aria-hidden="true" className={styles.stageHeaderButtonIcon} />
              </button>
            ) : null}
            <button
              aria-label={agentPanelOpen ? '关闭侧边面板' : '打开侧边面板'}
              className={[
                styles.stageHeaderButton,
                agentPanelOpen ? styles.stageHeaderButtonActive : '',
              ].filter(Boolean).join(' ')}
              title={agentPanelOpen ? '关闭侧边面板' : '打开侧边面板'}
              type="button"
              onClick={() => setAgentPanelOpen(prev => !prev)}
            >
              {agentPanelOpen ? (
                <PanelRightClose aria-hidden="true" className={styles.stageHeaderButtonIcon} />
              ) : (
                <PanelRight aria-hidden="true" className={styles.stageHeaderButtonIcon} />
              )}
            </button>
          </div>
        </header>

        <StudioPanelRight
          open={agentPanelOpen}
          width={agentPanelWidth}
          onClose={() => setAgentPanelOpen(false)}
          onWidthChange={setAgentPanelWidth}
          footer={(
            <div
              onKeyDownCapture={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSendAgentMockMessage()
                }
              }}
            >
              <ChatComposer
                canPreviewPrompt={false}
                canSend={Boolean(agentMockInput.trim())}
                input={agentMockInput}
                moreLabel={props.t('composer.more')}
                placeholder="随心输入，Shift + Enter 换行..."
                previewLabel={props.t('composer.preview')}
                retryLabel={props.t('composer.retry')}
                sendLabel={props.t('composer.send')}
                textareaDisabled={false}
                textareaLabel={props.t('composer.inputLabel')}
                onChangeInput={setAgentMockInput}
                onPreviewPrompt={() => {}}
                onSubmit={e => {
                  e.preventDefault()
                  handleSendAgentMockMessage()
                }}
              />
            </div>
          )}
        >
          <div className={styles.pseudoAgentTimeline} ref={agentTimelineRef}>
            <div className={styles.pseudoAgentWelcome}>
              <div className={styles.pseudoAgentWelcomeIconWrap}>
                <PanelRight aria-hidden="true" size={22} />
              </div>
              <div className={styles.pseudoAgentWelcomeTitle}>侧边对话</div>
              <div className={styles.pseudoAgentWelcomeSubtitle}>
                侧边对话为独立浮层，不挤占正文排版，关闭或刷新后可清空。
              </div>
            </div>

            {mockAgentMessages.map(msg => (
              <article
                key={msg.id}
                className={`${styles.pseudoAgentMessage} ${styles[msg.role]}`}
              >
                <div className={styles.pseudoAgentMessageSurface}>
                  {msg.role === 'assistant' ? (
                    <div className={styles.pseudoAgentMessageHeader}>
                      <span className={styles.pseudoAgentSender}>Agent</span>
                      <span className={styles.pseudoAgentTime}>{msg.time}</span>
                    </div>
                  ) : null}
                  <div className={styles.pseudoAgentMessageBody}>
                    <ConversationMarkdown
                      codeBlockLabels={codeBlockLabels}
                      role={msg.role}
                      value={msg.content}
                    />
                  </div>
                </div>
              </article>
            ))}
          </div>
        </StudioPanelRight>

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
