import { Check, Copy, GitBranch, Wrench } from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { Translator } from '../../shared/i18n/index.js'
import { SkeletonText } from '../../shared/ui/skeleton/skeleton.js'
import { ChatComposer } from '../chat-composer/chat-composer.js'
import {
  appendMockAgentTurn,
  forkMockAgentBranch,
  INITIAL_AGENT_BRANCHES,
  type MockAgentMessage,
  type MockAgentToolCall,
} from './agent-composer-model.js'
import styles from './agent-composer.module.scss'

const ConversationMarkdown = lazy(async () => {
  const module = await import('../../shared/ui/conversation-markdown/conversation-markdown.js')
  return { default: module.ConversationMarkdown }
})

type AgentComposerProps = {
  canPreviewPrompt: boolean
  canSendNarrative: boolean
  narrativeInput: string
  narrativeTextareaDisabled: boolean
  workspaceOpen: boolean
  t: Translator
  onChangeNarrativeInput(value: string): void
  onExpandedChange(expanded: boolean): void
  onHeightChange(height: number): void
  onPreviewPrompt(): void
  onSubmitNarrative(event: FormEvent): void
}

export function AgentComposer(props: AgentComposerProps) {
  const [agentDraft, setAgentDraft] = useState('')
  const [agentOpen, setAgentOpen] = useState(false)
  const [agentRaised, setAgentRaised] = useState(false)
  const [branches, setBranches] = useState(INITIAL_AGENT_BRANCHES)
  const [activeBranchId, setActiveBranchId] = useState(INITIAL_AGENT_BRANCHES[0]?.id ?? 'main')
  const [copyState, setCopyState] = useState<{ id: string; copied: boolean }>()
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const conversationRef = useRef<HTMLDivElement>(null)
  const activeBranch = useMemo(
    () => branches.find(branch => branch.id === activeBranchId) ?? branches[0],
    [activeBranchId, branches],
  )

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
  }, [activeBranch?.items.length, activeBranchId, agentOpen])

  function toggleAgent() {
    if (agentOpen) setAgentRaised(false)
    const nextOpen = !agentOpen
    setAgentOpen(nextOpen)
    props.onExpandedChange(nextOpen)
  }

  function submitAgent(event: FormEvent) {
    event.preventDefault()
    const content = agentDraft.trim()
    if (!content || !activeBranch) return
    setBranches(current => appendMockAgentTurn(current, activeBranch.id, content, String(Date.now())))
    setAgentDraft('')
  }

  function forkMessage(message: MockAgentMessage) {
    if (!activeBranch) return
    const branchNumber = branches.length
    const branchId = `branch-${Date.now()}`
    setBranches(current => forkMockAgentBranch(
      current,
      activeBranch.id,
      message.id,
      branchId,
      props.t('agent.branchNumber', { number: branchNumber }),
    ))
    setActiveBranchId(branchId)
  }

  async function copyMessage(message: MockAgentMessage) {
    try {
      await navigator.clipboard.writeText(message.content)
      setCopyState({ id: message.id, copied: true })
    } catch {
      setCopyState({ id: message.id, copied: false })
    }
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    copyTimerRef.current = setTimeout(() => setCopyState(undefined), 1600)
  }

  const codeBlockLabels = {
    copied: props.t('longTextEditor.copied'),
    copy: props.t('longTextEditor.copy'),
    copyFailed: props.t('longTextEditor.copyFailed'),
    disableWrap: props.t('markdown.code.disableWrap'),
    enableWrap: props.t('markdown.code.enableWrap'),
  }

  return (
    <div
      className={styles.layer}
      data-agent-raised={agentRaised ? 'true' : 'false'}
      data-loom-object="agent-composer-layer"
    >
      <ChatComposer
        canPreviewPrompt={!agentOpen && props.canPreviewPrompt}
        canSend={agentOpen ? Boolean(agentDraft.trim()) : props.canSendNarrative}
        expanded={agentOpen}
        expansion={(
          <div className={styles.session}>
            <nav aria-label={props.t('agent.branchLabel')} className={styles.branchBar}>
              <span className={styles.sessionLabel}>{props.t('agent.session')}</span>
              <div className={styles.branchList}>
                <GitBranch aria-hidden="true" />
                {branches.map(branch => (
                  <button
                    aria-pressed={branch.id === activeBranch?.id}
                    className={styles.branchButton}
                    key={branch.id}
                    type="button"
                    onClick={() => setActiveBranchId(branch.id)}
                  >
                    {branch.label}
                  </button>
                ))}
              </div>
            </nav>
            <div className={styles.conversation} ref={conversationRef}>
              <Suspense fallback={(
                <div aria-busy="true" className={styles.loading}>
                  <SkeletonText lines={5} />
                </div>
              )}>
                {activeBranch?.items.map((item, index) => item.type === 'message' ? (
                  <AgentMessage
                    copyState={copyState?.id === item.id ? copyState.copied : undefined}
                    index={index}
                    key={item.id}
                    message={item}
                    t={props.t}
                    onCopy={() => void copyMessage(item)}
                    onFork={() => forkMessage(item)}
                  />
                ) : (
                  <AgentToolCall codeBlockLabels={codeBlockLabels} item={item} key={item.id} t={props.t} />
                ))}
              </Suspense>
            </div>
          </div>
        )}
        input={agentOpen ? agentDraft : props.narrativeInput}
        moreLabel={props.t('composer.more')}
        placeholder={agentOpen ? props.t('agent.composerPlaceholder') : undefined}
        previewLabel={props.t('composer.preview')}
        retryLabel={props.t('composer.retry')}
        sendLabel={props.t(agentOpen ? 'agent.send' : 'composer.send')}
        targetActionLabel={agentOpen && props.workspaceOpen ? props.t(agentRaised ? 'agent.lower' : 'agent.raise') : undefined}
        targetActive={agentRaised}
        targetLabel={agentOpen ? props.t('agent.title') : undefined}
        textareaDisabled={agentOpen ? false : props.narrativeTextareaDisabled}
        textareaLabel={props.t(agentOpen ? 'agent.composerLabel' : 'composer.inputLabel')}
        toggleExpandedLabel={props.t(agentOpen ? 'agent.hide' : 'agent.open')}
        onChangeInput={agentOpen ? setAgentDraft : props.onChangeNarrativeInput}
        onPreviewPrompt={props.onPreviewPrompt}
        onHeightChange={agentOpen ? undefined : props.onHeightChange}
        onSubmit={agentOpen ? submitAgent : props.onSubmitNarrative}
        onTargetAction={agentOpen && props.workspaceOpen ? () => setAgentRaised(raised => !raised) : undefined}
        onToggleExpanded={toggleAgent}
      />
    </div>
  )
}

function AgentMessage(props: {
  copyState?: boolean
  index: number
  message: MockAgentMessage
  t: Translator
  onCopy(): void
  onFork(): void
}) {
  return (
    <article className={`${styles.message} ${styles[props.message.role]}`}>
      <div className={styles.messageSurface}>
        <ConversationMarkdown
          className={styles.messageBody}
          codeBlockLabels={{
            copied: props.t('longTextEditor.copied'),
            copy: props.t('longTextEditor.copy'),
            copyFailed: props.t('longTextEditor.copyFailed'),
            disableWrap: props.t('markdown.code.disableWrap'),
            enableWrap: props.t('markdown.code.enableWrap'),
          }}
          role={props.message.role}
          value={props.message.content}
        />
      </div>
      <footer className={styles.messageFooter}>
        <span className={styles.messageTimestamp} title={formatFullTimestamp(props.message.createdAt)}>
          #{props.index + 1} · {formatTimestamp(props.message.createdAt)}
        </span>
        <div className={styles.messageActions}>
          <MessageAction
            label={props.t(props.copyState === undefined
              ? 'timeline.copy'
              : props.copyState ? 'timeline.copied' : 'timeline.copyFailed')}
            onClick={props.onCopy}
          >
            {props.copyState ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          </MessageAction>
          <MessageAction label={props.t('agent.fork')} onClick={props.onFork}>
            <GitBranch aria-hidden="true" />
          </MessageAction>
        </div>
      </footer>
    </article>
  )
}

function AgentToolCall(props: {
  codeBlockLabels: {
    copied: string
    copy: string
    copyFailed: string
    disableWrap: string
    enableWrap: string
  }
  item: MockAgentToolCall
  t: Translator
}) {
  const argumentsMarkdown = `\`\`\`json\n${JSON.stringify(props.item.arguments, null, 2)}\n\`\`\``
  return (
    <article className={styles.toolCall} data-tool-status={props.item.status}>
      <header className={styles.toolHeader}>
        <span className={styles.toolIdentity}><Wrench aria-hidden="true" />{props.item.name}</span>
        <span className={styles.toolStatus}><Check aria-hidden="true" />{props.t('agent.toolCompleted')}</span>
      </header>
      <p className={styles.toolSummary}>{props.item.summary}</p>
      <details className={styles.toolDetails}>
        <summary>{props.t('agent.toolArguments')}</summary>
        <ConversationMarkdown
          className={styles.toolPayload}
          codeBlockLabels={props.codeBlockLabels}
          role="assistant"
          value={argumentsMarkdown}
        />
      </details>
      <p className={styles.toolResult}>{props.item.result}</p>
    </article>
  )
}

function MessageAction(props: { children: ReactNode; label: string; onClick(): void }) {
  return (
    <button aria-label={props.label} className={styles.messageAction} title={props.label} type="button" onClick={props.onClick}>
      {props.children}
    </button>
  )
}

function formatTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--:--'
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatFullTimestamp(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}
