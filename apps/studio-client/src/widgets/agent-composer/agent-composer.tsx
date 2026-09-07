import type { FormEvent, ReactNode } from 'react'
import type { Translator } from '../../shared/i18n/index.js'
import { ChatComposer, type ChatComposerQuickAction } from '../chat-composer/chat-composer.js'
import styles from './agent-composer.module.scss'

const AGENT_EXPANSION_MIN_HEIGHT = 220
const AGENT_EXPANSION_MAX_HEIGHT = 720

export type AgentComposerProps = {
  canPreviewPrompt: boolean
  canSendNarrative: boolean
  composerSheet?: ReactNode
  narrativeInput: string
  narrativeTextareaDisabled: boolean
  quickActions?: readonly ChatComposerQuickAction[]
  t: Translator
  agentPanelOpen?: boolean
  onToggleAgentPanel?(): void
  onChangeNarrativeInput(value: string): void
  onHeightChange?(height: number): void
  onPreviewPrompt(): void
  onSubmitNarrative(event: FormEvent): void
}

export function AgentComposer(props: AgentComposerProps) {
  return (
    <div className={styles.layer} data-loom-object="agent-composer-layer">
      <ChatComposer
        canPreviewPrompt={props.canPreviewPrompt}
        canSend={props.canSendNarrative}
        expanded={props.agentPanelOpen}
        input={props.narrativeInput}
        moreLabel={props.t('composer.more')}
        previewLabel={props.t('composer.preview')}
        quickActions={props.quickActions}
        retryLabel={props.t('composer.retry')}
        sheet={props.composerSheet}
        sendLabel={props.t('composer.send')}
        textareaDisabled={props.narrativeTextareaDisabled}
        textareaLabel={props.t('composer.inputLabel')}
        toggleExpandedLabel={props.agentPanelOpen ? props.t('agent.hide') : props.t('agent.open')}
        onChangeInput={props.onChangeNarrativeInput}
        onHeightChange={props.onHeightChange}
        onPreviewPrompt={props.onPreviewPrompt}
        onSubmit={props.onSubmitNarrative}
        onToggleExpanded={props.onToggleAgentPanel}
      />
    </div>
  )
}

export function clampAgentExpansionHeight(height: number, maximumHeight: number): number {
  return Math.min(Math.max(AGENT_EXPANSION_MIN_HEIGHT, height), maximumHeight)
}
