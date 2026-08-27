import { Check, ChevronDown, Copy } from 'lucide-react'
import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { AgentTranscriptEntry as AgentTranscriptEntryEntity, AgentProfile, AgentSession, ProviderAccount } from '../../entities/index.js'
import type { Translator } from '../../shared/i18n/index.js'
import { tryWriteClipboardText } from '../../shared/browser/clipboard.js'
import type { MarkdownCodeBlockLabels } from '../../shared/ui/markdown-content/markdown-code-block.js'
import { SkeletonText } from '../../shared/ui/skeleton/skeleton.js'
import { ConversationMessageAction, ConversationMessageChrome } from '../../shared/ui/conversation-message-chrome/conversation-message-chrome.js'
import { ChatComposer } from '../chat-composer/chat-composer.js'
import styles from './agent-composer.module.scss'

const ConversationMarkdown = lazy(async () => {
  const module = await import('../../shared/ui/conversation-markdown/conversation-markdown.js')
  return { default: module.ConversationMarkdown }
})

const AGENT_EXPANSION_MIN_HEIGHT = 220
const AGENT_EXPANSION_MAX_HEIGHT = 720
const AGENT_EXPANSION_KEYBOARD_STEP = 24

type AgentComposerProps = {
  canPreviewPrompt: boolean
  canSendAgent: boolean
  canSendNarrative: boolean
  agentBusy: boolean
  agentExpansionHeight: number
  agentInput: string
  agentMessages: AgentTranscriptEntryEntity[]
  agentSession?: AgentSession
  narrativeInput: string
  narrativeTextareaDisabled: boolean
  agentProfiles: AgentProfile[]
  providerAccounts: ProviderAccount[]
  selectedAgentProfileId?: string
  workspaceOpen: boolean
  t: Translator
  onChangeAgentInput(value: string): void
  onChangeNarrativeInput(value: string): void
  onExpansionHeightChange(height: number): void
  onExpandedChange(expanded: boolean): void
  onHeightChange(height: number): void
  onPreviewPrompt(): void
  onSelectAgentProfile(id: string): void
  onSubmitAgent(event: FormEvent): void
  onSubmitNarrative(event: FormEvent): void
}

export function AgentComposer(props: AgentComposerProps) {
  const [agentOpen, setAgentOpen] = useState(false)
  const [agentRaised, setAgentRaised] = useState(false)
  const [copyState, setCopyState] = useState<{ id: string; copied: boolean }>()
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const conversationRef = useRef<HTMLDivElement>(null)
  const resizeDragRef = useRef<{
    canvas: HTMLElement
    currentHeight: number
    pointerId: number
    startHeight: number
    startY: number
  } | undefined>(undefined)

  useEffect(() => {
    if (!props.workspaceOpen) setAgentRaised(false)
  }, [props.workspaceOpen])

  useEffect(() => () => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
  }, [])

  useEffect(() => {
    if (!agentOpen) return
    const conversation = conversationRef.current
    if (conversation) conversation.scrollTop = conversation.scrollHeight
  }, [agentOpen, props.agentBusy, props.agentMessages.length])

  function toggleAgent() {
    if (agentOpen) setAgentRaised(false)
    const nextOpen = !agentOpen
    setAgentOpen(nextOpen)
    props.onExpandedChange(nextOpen)
  }

  async function copyMessage(message: AgentTranscriptEntryEntity, content: string) {
    setCopyState({ id: message.id, copied: await tryWriteClipboardText(content) })
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    copyTimerRef.current = setTimeout(() => setCopyState(undefined), 1600)
  }

  function resizeAgentPanel(height: number) {
    props.onExpansionHeightChange(clampAgentExpansionHeight(height, readAgentExpansionMaxHeight()))
  }

  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    const canvas = event.currentTarget.closest<HTMLElement>('[data-loom-object="agent-composer-layer"]')?.parentElement
    if (!canvas) return
    event.preventDefault()
    canvas.style.setProperty('--loom-agent-expansion-transition-duration', '0ms')
    resizeDragRef.current = {
      canvas,
      currentHeight: props.agentExpansionHeight,
      pointerId: event.pointerId,
      startHeight: props.agentExpansionHeight,
      startY: event.clientY,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function continueResize(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = resizeDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    drag.currentHeight = clampAgentExpansionHeight(
      drag.startHeight + drag.startY - event.clientY,
      readAgentExpansionMaxHeight(),
    )
    drag.canvas.style.setProperty('--loom-agent-expansion-height', `${drag.currentHeight}px`)
  }

  function finishResize(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = resizeDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    resizeDragRef.current = undefined
    drag.canvas.style.removeProperty('--loom-agent-expansion-transition-duration')
    props.onExpansionHeightChange(drag.currentHeight)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  function resizeWithKeyboard(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    resizeAgentPanel(props.agentExpansionHeight + (event.key === 'ArrowUp' ? AGENT_EXPANSION_KEYBOARD_STEP : -AGENT_EXPANSION_KEYBOARD_STEP))
  }

  const codeBlockLabels = {
    copied: props.t('longTextEditor.copied'),
    copy: props.t('longTextEditor.copy'),
    copyFailed: props.t('longTextEditor.copyFailed'),
    disableWrap: props.t('markdown.code.disableWrap'),
    enableWrap: props.t('markdown.code.enableWrap'),
  }

  return (
    <div className={styles.layer} data-agent-raised={agentRaised ? 'true' : 'false'} data-loom-object="agent-composer-layer">
      <ChatComposer
        canPreviewPrompt={!agentOpen && props.canPreviewPrompt}
        canSend={agentOpen ? props.canSendAgent : props.canSendNarrative}
        expanded={agentOpen}
        expansion={(
          <div className={styles.session}>
            <div
              aria-label={props.t('agent.resize')}
              aria-orientation="horizontal"
              aria-valuemax={readAgentExpansionMaxHeight()}
              aria-valuemin={AGENT_EXPANSION_MIN_HEIGHT}
              aria-valuenow={props.agentExpansionHeight}
              className={styles.resizeHandle}
              role="separator"
              tabIndex={0}
              onKeyDown={resizeWithKeyboard}
              onLostPointerCapture={finishResize}
              onPointerCancel={finishResize}
              onPointerDown={startResize}
              onPointerMove={continueResize}
              onPointerUp={finishResize}
            />
            <header className={styles.sessionBar}>
              <span className={styles.sessionLabel}>{props.t('agent.session')}</span>
              {props.agentSession ? <code>{props.agentSession.id.slice(0, 18)}</code> : <span>{props.t('agent.sessionPending')}</span>}
            </header>
            <div className={styles.conversation} ref={conversationRef}>
              <Suspense fallback={<div aria-busy="true" className={styles.loading}><SkeletonText lines={5} /></div>}>
                {props.agentMessages.length === 0 && !props.agentBusy ? <p className={styles.empty}>{props.t('agent.sessionEmpty')}</p> : null}
                {props.agentMessages.map((message) => {
                  const display = readAgentTranscriptEntryDisplay(message)
                  if (display.kind === 'event') return <AgentTranscriptEvent key={message.id} message={message} />
                  return (
                    <AgentTranscriptEntry
                      codeBlockLabels={codeBlockLabels}
                      content={display.content}
                      copyState={copyState?.id === message.id ? copyState.copied : undefined}
                      index={countMessageEntriesThrough(props.agentMessages, message.sequence) - 1}
                      key={message.id}
                      message={message}
                      role={display.role}
                      t={props.t}
                      onCopy={() => void copyMessage(message, display.content)}
                    />
                  )
                })}
                {props.agentBusy ? <div aria-busy="true" className={styles.loading}><SkeletonText lines={2} /></div> : null}
              </Suspense>
            </div>
          </div>
        )}
        input={agentOpen ? props.agentInput : props.narrativeInput}
        moreLabel={props.t('composer.more')}
        placeholder={agentOpen ? props.t('agent.composerPlaceholder') : undefined}
        previewLabel={props.t('composer.preview')}
        retryLabel={props.t('composer.retry')}
        sendLabel={props.t(agentOpen ? 'agent.send' : 'composer.send')}
        sendLeadingAction={agentOpen ? (
          <AgentProfilePicker
            profiles={props.agentProfiles}
            providers={props.providerAccounts}
            selectedId={props.selectedAgentProfileId}
            t={props.t}
            disabled={props.agentBusy}
            onSelect={props.onSelectAgentProfile}
          />
        ) : undefined}
        targetActionLabel={agentOpen && props.workspaceOpen ? props.t(agentRaised ? 'agent.lower' : 'agent.raise') : undefined}
        targetActive={agentRaised}
        targetLabel={agentOpen ? props.t('agent.title') : undefined}
        textareaDisabled={agentOpen ? props.agentBusy || !props.selectedAgentProfileId : props.narrativeTextareaDisabled}
        textareaLabel={props.t(agentOpen ? 'agent.composerLabel' : 'composer.inputLabel')}
        toggleExpandedLabel={props.t(agentOpen ? 'agent.hide' : 'agent.open')}
        onChangeInput={agentOpen ? props.onChangeAgentInput : props.onChangeNarrativeInput}
        onHeightChange={agentOpen ? undefined : props.onHeightChange}
        onPreviewPrompt={props.onPreviewPrompt}
        onSubmit={agentOpen ? props.onSubmitAgent : props.onSubmitNarrative}
        onTargetAction={agentOpen && props.workspaceOpen ? () => setAgentRaised(raised => !raised) : undefined}
        onToggleExpanded={toggleAgent}
      />
    </div>
  )
}

export function clampAgentExpansionHeight(height: number, maximumHeight: number): number {
  return Math.min(Math.max(AGENT_EXPANSION_MIN_HEIGHT, height), maximumHeight)
}

function readAgentExpansionMaxHeight(): number {
  if (typeof window === 'undefined') return AGENT_EXPANSION_MAX_HEIGHT
  return Math.max(
    AGENT_EXPANSION_MIN_HEIGHT,
    Math.min(AGENT_EXPANSION_MAX_HEIGHT, Math.floor(window.innerHeight * 0.72)),
  )
}

function AgentProfilePicker(props: {
  disabled: boolean
  profiles: AgentProfile[]
  providers: ProviderAccount[]
  selectedId?: string
  t: Translator
  onSelect(id: string): void
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const selected = props.profiles.find(profile => profile.id === props.selectedId)
  const selectedProvider = selected && props.providers.find(provider => provider.id === selected.model.providerProfileId)

  return (
    <details className={styles.profilePicker} ref={detailsRef}>
      <summary aria-disabled={props.disabled} title={props.t('agent.profile.choose')} onClick={event => {
        if (props.disabled) event.preventDefault()
      }}>
        <span>{selected?.name ?? props.t('agent.profile.unselected')}</span>
        <ChevronDown aria-hidden="true" />
      </summary>
      <div className={styles.profileMenu}>
        {selected ? (
          <div className={styles.profileCurrent}>
            <strong>{selectedProvider?.displayName ?? selected.model.providerProfileId}</strong>
            <span>{selected.model.modelId}</span>
          </div>
        ) : null}
        {props.profiles.length === 0 ? <p>{props.t('agent.profile.configureFirst')}</p> : props.profiles.map(profile => {
          const provider = props.providers.find(item => item.id === profile.model.providerProfileId)
          return (
            <button aria-pressed={profile.id === props.selectedId} disabled={props.disabled} key={profile.id} type="button" onClick={() => {
              props.onSelect(profile.id)
              if (detailsRef.current) detailsRef.current.open = false
            }}>
              <strong>{profile.name}</strong>
              <span>{provider?.displayName ?? profile.model.providerProfileId} · {profile.model.modelId}</span>
            </button>
          )
        })}
      </div>
    </details>
  )
}

function AgentTranscriptEntry(props: { codeBlockLabels: MarkdownCodeBlockLabels; content: string; copyState?: boolean; index: number; message: AgentTranscriptEntryEntity; role: 'user' | 'assistant'; t: Translator; onCopy(): void }) {
  return (
    <article className={`${styles.message} ${styles[props.role]}`}>
      <div className={styles.messageSurface}><ConversationMarkdown className={styles.messageBody} codeBlockLabels={props.codeBlockLabels} role={props.role} value={props.content} /></div>
      <ConversationMessageChrome createdAt={props.message.createdAt} index={props.index} actions={<ConversationMessageAction label={props.t(props.copyState === undefined ? 'timeline.copy' : props.copyState ? 'timeline.copied' : 'timeline.copyFailed')} onClick={props.onCopy}>{props.copyState ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}</ConversationMessageAction>} />
    </article>
  )
}

function AgentTranscriptEvent(props: { message: AgentTranscriptEntryEntity }) {
  const entry = props.message.entry
  const detail = entry.kind === 'tool-invocation' || entry.kind === 'tool-result'
    ? String(entry.toolId ?? '')
    : entry.kind === 'run-state'
      ? String(entry.state ?? '')
      : ''
  return (
    <details className={styles.transcriptEvent}>
      <summary><span>{entry.kind}</span>{detail ? <code>{detail}</code> : null}</summary>
      <pre>{JSON.stringify(entry, null, 2)}</pre>
    </details>
  )
}

function readAgentTranscriptEntryDisplay(message: AgentTranscriptEntryEntity):
  | { kind: 'message'; role: 'user' | 'assistant'; content: string }
  | { kind: 'event' } {
  if (message.entry.kind === 'message' && message.entry.content) {
    if (message.entry.role === 'user') return { kind: 'message', role: 'user', content: message.entry.content }
    if (message.entry.role === 'assistant') return { kind: 'message', role: 'assistant', content: message.entry.content }
  }
  return { kind: 'event' }
}

function countMessageEntriesThrough(entries: AgentTranscriptEntryEntity[], sequence: number): number {
  return entries.filter(entry => entry.sequence <= sequence && entry.entry.kind === 'message').length
}
