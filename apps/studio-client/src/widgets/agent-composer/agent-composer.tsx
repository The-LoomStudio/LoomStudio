import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { Translator } from '../../shared/i18n/index.js'
import { ChatComposer, type ChatComposerQuickAction } from '../chat-composer/chat-composer.js'
import styles from './agent-composer.module.scss'
import { RunRecoveryControls, type RunRecoveryControlsProps } from '../../features/narrative-runtime/ui/run-recovery-controls.js'

const AGENT_EXPANSION_MIN_HEIGHT = 220

export type AgentComposerProps = RunRecoveryControlsProps & {
  canPreviewPrompt: boolean
  canSendNarrative: boolean
  canRetryNarrativeInput?: boolean
  onRetryNarrativeInput?(): void
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
  const recovery = props.runRecovery?.target === 'narrative' ? props.runRecovery : undefined
  const disconnected = props.runRecovery?.status === 'disconnected'
  const isActive = Boolean(props.pinned || hovered || hasContent || recovery)

  return (
    <>
      {!props.pinned ? (
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
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
      <ChatComposer
        canPreviewPrompt={props.canPreviewPrompt}
        canSend={props.canSendNarrative && !disconnected && !props.runRecoveryBusy}
        expanded={props.agentPanelOpen}
        input={props.narrativeInput}
        moreLabel={props.t('composer.more')}
        pinLabel={props.t('composer.pin')}
        pinned={props.pinned}
        previewLabel={props.t('composer.preview')}
        quickActions={props.quickActions}
        retryLabel={props.t('composer.resendNarrativeInput')}
        canRetry={props.canRetryNarrativeInput && !disconnected && !props.runRecoveryBusy}
        onRetry={props.onRetryNarrativeInput}
        sheet={recovery ? <><RunRecoveryControls {...props} runRecovery={recovery} />{props.composerSheet}</> : props.composerSheet}
        sendLabel={props.t('composer.send')}
        textareaDisabled={!disconnected && props.narrativeTextareaDisabled}
        textareaLabel={props.t('composer.inputLabel')}
        toggleExpandedLabel={props.agentPanelOpen ? props.t('agent.hide') : props.t('agent.open')}
        unpinLabel={props.t('composer.unpin')}
        onChangeInput={props.onChangeNarrativeInput}
        onHeightChange={props.onHeightChange}
        onPreviewPrompt={props.onPreviewPrompt}
        onSubmit={event => {
          if (disconnected || props.runRecoveryBusy) { event.preventDefault(); return }
          props.onSubmitNarrative(event)
        }}
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
