import { Check, ChevronDown, Copy, Plus, RefreshCw } from 'lucide-react'
import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import type {
  AgentTranscriptEntry as AgentTranscriptEntryEntity,
  AgentProfile,
  AgentSession,
  ProviderAccount,
} from '../../entities/index.js'
import type { Translator } from '../../shared/i18n/index.js'
import { tryWriteClipboardText } from '../../shared/browser/clipboard.js'
import type { MarkdownCodeBlockLabels } from '../../shared/ui/markdown-content/markdown-code-block.js'
import { SkeletonText } from '../../shared/ui/skeleton/skeleton.js'
import {
  ConversationMessageAction,
  ConversationMessageChrome,
} from '../../shared/ui/conversation-message-chrome/conversation-message-chrome.js'
import { ChatComposer } from '../chat-composer/chat-composer.js'
import type { ClientRendererHost } from '../../features/extension-renderers/model/client-renderer-host.js'
import { RendererNodeMountHost } from '../../features/extension-renderers/ui/renderer-node-mount-host.js'
import styles from './agent-chat-panel.module.scss'

const ConversationMarkdown = lazy(async () => {
  const module = await import('../../shared/ui/conversation-markdown/conversation-markdown.js')
  return { default: module.ConversationMarkdown }
})

export type AgentChatPanelProps = {
  busy: boolean
  input: string
  messages: AgentTranscriptEntryEntity[]
  profiles: AgentProfile[]
  providerAccounts: ProviderAccount[]
  rendererHost?: ClientRendererHost
  selectedProfileId?: string
  session?: AgentSession
  sessions?: AgentSession[]
  sessionReady?: boolean
  sessionTail?: ReactNode
  t: Translator
  onChangeInput(value: string): void
  onSelectProfile(id: string): void
  onSelectSession?(id: string): void
  onNewSession?(): void
  onRefreshSessions?(): void
  onSubmit(event: FormEvent): void
}

export function AgentChatPanel(props: AgentChatPanelProps) {
  const conversationRef = useRef<HTMLDivElement>(null)
  const [copyState, setCopyState] = useState<{ id: string; copied: boolean }>()
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
  }, [])

  useEffect(() => {
    const conversation = conversationRef.current
    if (conversation) {
      conversation.scrollTop = conversation.scrollHeight
    }
  }, [props.busy, props.messages.length])

  async function copyMessage(message: AgentTranscriptEntryEntity, content: string) {
    setCopyState({ id: message.id, copied: await tryWriteClipboardText(content) })
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    copyTimerRef.current = setTimeout(() => setCopyState(undefined), 1600)
  }

  const codeBlockLabels: MarkdownCodeBlockLabels = {
    copied: props.t('longTextEditor.copied'),
    copy: props.t('longTextEditor.copy'),
    copyFailed: props.t('longTextEditor.copyFailed'),
    disableWrap: props.t('markdown.code.disableWrap'),
    enableWrap: props.t('markdown.code.enableWrap'),
  }

  return (
    <div className={styles.panel} data-loom-component="agent-chat-panel">
      <header className={styles.sessionBar}>
        <select
          aria-label={props.t('agent.session')}
          className={styles.sessionSelect}
          disabled={props.busy}
          value={props.session?.id ?? ''}
          onChange={event => props.onSelectSession?.(event.target.value)}
        >
          <option disabled value="">{props.t('agent.sessionPending')}</option>
          {(props.sessions ?? (props.session ? [props.session] : [])).map(session => (
            <option key={session.id} value={session.id}>
              {session.title ?? props.t('sessions.untitledAgentSession')} · {new Date(session.updatedAt).toLocaleString()}
            </option>
          ))}
        </select>
        <button className={styles.sessionAction} type="button" disabled={props.busy}
          title={props.t('agent.sessionNew')} aria-label={props.t('agent.sessionNew')} onClick={props.onNewSession}>
          <Plus aria-hidden="true" />
        </button>
        <button className={styles.sessionAction} type="button" disabled={props.busy}
          title={props.t('agent.sessionRefresh')} aria-label={props.t('agent.sessionRefresh')} onClick={props.onRefreshSessions}>
          <RefreshCw aria-hidden="true" />
        </button>
      </header>

      <div className={styles.conversation} ref={conversationRef}>
        <Suspense fallback={<div aria-busy="true" className={styles.loading}><SkeletonText lines={5} /></div>}>
          {!props.busy && props.sessionReady === false ? (
            <p className={styles.empty} role="alert">{props.t('agent.sessionLoadFailed')}</p>
          ) : props.messages.length === 0 && !props.busy ? (
            <p className={styles.empty}>{props.t('agent.sessionEmpty')}</p>
          ) : null}

          {props.messages.map((message) => {
            const display = readAgentTranscriptEntryDisplay(message)
            if (display.kind === 'event') {
              return <AgentTranscriptEvent key={message.id} message={message} />
            }
            return (
              <AgentTranscriptEntry
                agentSessionId={props.session?.id}
                codeBlockLabels={codeBlockLabels}
                content={display.content}
                copyState={copyState?.id === message.id ? copyState.copied : undefined}
                index={countMessageEntriesThrough(props.messages, message.sequence) - 1}
                key={message.id}
                message={message}
                rendererHost={props.rendererHost}
                role={display.role}
                t={props.t}
                onCopy={() => void copyMessage(message, display.content)}
              />
            )
          })}

          {props.busy ? (
            <div aria-busy="true" className={styles.loading}>
              <SkeletonText lines={2} />
            </div>
          ) : null}

          {props.sessionTail ? (
            <div data-loom-surface="agent.session.tail">{props.sessionTail}</div>
          ) : null}
        </Suspense>
      </div>

      <footer className={styles.footer}>
        <ChatComposer
          canPreviewPrompt={false}
          canSend={Boolean(props.input.trim()) && !props.busy && props.sessionReady !== false && Boolean(props.selectedProfileId)}
          input={props.input}
          moreLabel={props.t('composer.more')}
          placeholder={props.t('agent.composerPlaceholder')}
          previewLabel={props.t('composer.preview')}
          retryLabel={props.t('composer.retry')}
          sendLabel={props.t('agent.send')}
          sendLeadingAction={(
            <AgentProfilePicker
              disabled={props.busy}
              profiles={props.profiles}
              providers={props.providerAccounts}
              selectedId={props.selectedProfileId}
              t={props.t}
              onSelect={props.onSelectProfile}
            />
          )}
          textareaDisabled={props.busy || !props.selectedProfileId}
          textareaLabel={props.t('agent.composerLabel')}
          onChangeInput={props.onChangeInput}
          onPreviewPrompt={() => {}}
          onSubmit={props.onSubmit}
        />
      </footer>
    </div>
  )
}

function AgentTranscriptEntry(props: {
  agentSessionId?: string
  codeBlockLabels: MarkdownCodeBlockLabels
  content: string
  copyState?: boolean
  index: number
  message: AgentTranscriptEntryEntity
  rendererHost?: ClientRendererHost
  role: 'user' | 'assistant'
  t: Translator
  onCopy(): void
}) {
  return (
    <article className={`${styles.message} ${styles[props.role]}`}>
      <div className={styles.messageSurface}>
        {props.rendererHost && props.agentSessionId ? (
          <RendererNodeMountHost
            agentSessionId={props.agentSessionId}
            host={props.rendererHost}
            messageId={props.message.id}
            rawText={props.content}
            surface="agent-message"
          >
            <ConversationMarkdown
              className={styles.messageBody}
              codeBlockLabels={props.codeBlockLabels}
              role={props.role}
              value={props.content}
            />
          </RendererNodeMountHost>
        ) : (
          <ConversationMarkdown
            className={styles.messageBody}
            codeBlockLabels={props.codeBlockLabels}
            role={props.role}
            value={props.content}
          />
        )}
      </div>
      <ConversationMessageChrome
        actions={(
          <ConversationMessageAction
            label={props.t(
              props.copyState === undefined
                ? 'timeline.copy'
                : props.copyState
                  ? 'timeline.copied'
                  : 'timeline.copyFailed',
            )}
            onClick={props.onCopy}
          >
            {props.copyState ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          </ConversationMessageAction>
        )}
        createdAt={props.message.createdAt}
        index={props.index}
      />
    </article>
  )
}

function AgentTranscriptEvent(props: { message: AgentTranscriptEntryEntity }) {
  const entry = props.message.entry
  const detail =
    entry.kind === 'tool-invocation' || entry.kind === 'tool-result'
      ? String(entry.toolId ?? '')
      : entry.kind === 'run-state'
        ? String(entry.state ?? '')
        : ''

  return (
    <details className={styles.transcriptEvent}>
      <summary>
        <span className={styles.eventKindBadge} data-kind={entry.kind}>
          {entry.kind}
        </span>
        {detail ? <code className={styles.eventDetail}>{detail}</code> : null}
      </summary>
      <pre>{JSON.stringify(entry, null, 2)}</pre>
    </details>
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
      <summary
        aria-disabled={props.disabled}
        title={props.t('agent.profile.choose')}
        onClick={event => {
          if (props.disabled) event.preventDefault()
        }}
      >
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
        {props.profiles.length === 0 ? (
          <p>{props.t('agent.profile.configureFirst')}</p>
        ) : (
          props.profiles.map(profile => {
            const provider = props.providers.find(item => item.id === profile.model.providerProfileId)
            return (
              <button
                aria-pressed={profile.id === props.selectedId}
                disabled={props.disabled}
                key={profile.id}
                type="button"
                onClick={() => {
                  props.onSelect(profile.id)
                  if (detailsRef.current) detailsRef.current.open = false
                }}
              >
                <strong>{profile.name}</strong>
                <span>
                  {provider?.displayName ?? profile.model.providerProfileId} · {profile.model.modelId}
                </span>
              </button>
            )
          })
        )}
      </div>
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
