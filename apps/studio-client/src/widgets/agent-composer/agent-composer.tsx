import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { Translator } from '../../shared/i18n/index.js'
import { ChatComposer, type ChatComposerQuickAction } from '../chat-composer/chat-composer.js'
import styles from './agent-composer.module.scss'

const AGENT_EXPANSION_MIN_HEIGHT = 220

export type AgentComposerProps = {
  canPreviewPrompt: boolean
  canSendNarrative: boolean
  composerSheet?: ReactNode
  narrativeInput: string
  narrativeTextareaDisabled: boolean
  quickActions?: readonly ChatComposerQuickAction[]
  t: Translator
  agentPanelOpen?: boolean
  pinned?: boolean
  onTogglePinned?(): void
  onToggleAgentPanel?(): void
  onChangeNarrativeInput(value: string): void
  onHeightChange?(height: number): void
  onPreviewPrompt(): void
  onSubmitNarrative(event: FormEvent): void
}

export function AgentComposer(props: AgentComposerProps) {
  const [hovered, setHovered] = useState(false)
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleMouseEnter = () => {
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current)
      leaveTimerRef.current = null
    }
    setHovered(true)
  }

  const handleMouseLeave = () => {
    if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current)
    leaveTimerRef.current = setTimeout(() => {
      setHovered(false)
    }, 240)
  }

  const hasContent = Boolean(props.narrativeInput?.trim())
  const isActive = Boolean(props.pinned || hovered || hasContent || props.agentPanelOpen)

  return (
    <>
      {!props.pinned && !props.agentPanelOpen ? (
        <div
          className={styles.triggerZone}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          aria-hidden="true"
        />
      ) : null}
      <div
        className={styles.layer}
        data-loom-object="agent-composer-layer"
        data-active={isActive ? 'true' : undefined}
        data-pinned={props.pinned ? 'true' : undefined}
        data-has-content={hasContent ? 'true' : undefined}
        data-expanded={props.agentPanelOpen ? 'true' : undefined}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
      <ChatComposer
        canPreviewPrompt={props.canPreviewPrompt}
        canSend={props.canSendNarrative}
        expanded={props.agentPanelOpen}
        input={props.narrativeInput}
        moreLabel={props.t('composer.more')}
        pinLabel={props.t('composer.pin')}
        pinned={props.pinned}
        previewLabel={props.t('composer.preview')}
        quickActions={props.quickActions}
        retryLabel={props.t('composer.retry')}
        sheet={props.composerSheet}
        sendLabel={props.t('composer.send')}
        textareaDisabled={props.narrativeTextareaDisabled}
        textareaLabel={props.t('composer.inputLabel')}
        toggleExpandedLabel={props.agentPanelOpen ? props.t('agent.hide') : props.t('agent.open')}
        unpinLabel={props.t('composer.unpin')}
        onChangeInput={props.onChangeNarrativeInput}
        onHeightChange={props.onHeightChange}
        onPreviewPrompt={props.onPreviewPrompt}
        onSubmit={props.onSubmitNarrative}
        onToggleExpanded={props.onToggleAgentPanel}
        onTogglePinned={props.onTogglePinned}
      />
      </div>
    </>
  )
}

export function clampAgentExpansionHeight(height: number, maximumHeight: number): number {
  return Math.min(Math.max(AGENT_EXPANSION_MIN_HEIGHT, height), maximumHeight)
}
