import type { AttachmentComposerProps } from '../../features/attachments/use-attachment-drafts.js'
import { ContextWindowInfo } from './context-window-info.js'
import { useRef, useState, type FormEvent, type ReactNode, type Ref } from 'react'
import type { Translator } from '../../shared/i18n/index.js'
import { ChatComposer, type ChatComposerQuickAction } from '../chat-composer/chat-composer.js'
import styles from './agent-composer.module.scss'
import { RunRecoveryControls, type RunRecoveryControlsProps } from '../../features/narrative-runtime/ui/run-recovery-controls.js'

export type AgentComposerProps = RunRecoveryControlsProps & AttachmentComposerProps & {
  inputMode?: 'roleplay' | 'discussion'
  onInputModeChange?(mode: 'roleplay' | 'discussion'): void
  sendLeadingAction?: ReactNode
  runStatus?: 'idle' | 'running' | 'suspended'
  onPause?(): void
  onResume?(): void
  inputRef?: Ref<HTMLTextAreaElement>
  canPreviewPrompt: boolean
  canSendNarrative: boolean
  canRetryNarrativeInput?: boolean
  onRetryNarrativeInput?(): void
  actionsHostRef?: Ref<HTMLDivElement>
  taskCard?: ReactNode
  composerSheet?: ReactNode
  narrativeInput: string
  narrativeTextareaDisabled: boolean
  quickActions?: readonly ChatComposerQuickAction[]
  t: Translator
  pinned?: boolean
  onTogglePinned?(): void
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

  const hasContent = Boolean(props.narrativeInput?.trim() || props.attachments?.length)
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
      <div className={styles.taskCard}>
        {recovery ? <div className={styles.floatingRecovery}><RunRecoveryControls {...props} runRecovery={recovery} /></div> : null}
        <div className={styles.taskCapsule}>{props.taskCard}</div>
        <div ref={props.actionsHostRef} className={styles.timelineActions} />
      </div>
      <div className={styles.foreground}>
      <ChatComposer
        t={props.t}
        attachmentNotice={props.attachmentNotice} onRetryAttachment={props.onRetryAttachment} attachments={props.attachments} onAddAttachments={props.onAddAttachments} onRemoveAttachment={props.onRemoveAttachment}
        inputRef={props.inputRef}
        inputMode={props.inputMode}
        onInputModeChange={props.onInputModeChange}
        sendLeadingAction={<><ContextWindowInfo />{props.sendLeadingAction}</>}
        runStatus={props.runStatus}
        resumeWithInput={false}
        onPause={props.onPause}
        onResume={props.onResume}
        canPreviewPrompt={props.canPreviewPrompt}
        canSend={props.canSendNarrative && !disconnected && !props.runRecoveryBusy}
        input={props.narrativeInput}
        moreLabel={props.t('composer.more')}
        pinLabel={props.t('composer.pin')}
        pinned={props.pinned}
        previewLabel={props.t('composer.preview')}
        quickActions={props.quickActions}
        retryLabel={props.inputMode === 'discussion' ? '重试这次沟通' : props.t('swipe.reset')}
        canRetry={props.canRetryNarrativeInput && !disconnected && !props.runRecoveryBusy}
        onRetry={props.onRetryNarrativeInput}
        sheet={props.composerSheet}
        pauseLabel={props.t('agent.run.pause')}
        resumeLabel={props.t('agent.run.resume')}
        sendLabel={props.t('composer.send')}
        textareaDisabled={!disconnected && props.narrativeTextareaDisabled}
        textareaLabel={props.inputMode ? props.inputMode === 'discussion' ? '沟通输入' : '扮演输入' : props.t('composer.inputLabel')}
        placeholder={props.inputMode ? props.inputMode === 'discussion' ? '告诉 Agent 你想调整哪里……' : '你会怎么做？' : undefined}
        unpinLabel={props.t('composer.unpin')}
        onChangeInput={props.onChangeNarrativeInput}
        onHeightChange={props.onHeightChange}
        onSubmit={event => {
          if (disconnected || props.runRecoveryBusy) { event.preventDefault(); return }
          props.onSubmitNarrative(event)
        }}
        onTogglePinned={props.onTogglePinned}
      />
      </div>
      </div>
    </>
  )
}
