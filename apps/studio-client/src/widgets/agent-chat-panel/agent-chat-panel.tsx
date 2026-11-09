import { UserInputEditor, type ReviseUserInput } from '../../features/attachments/user-input-editor.js'
import { MessageAttachments } from '../../features/attachments/message-attachments.js'
import type { AttachmentComposerProps } from '../../features/attachments/use-attachment-drafts.js'
import { extensionInstallationId } from '@loom-studio/extension-sdk'
import { ExtensionIcon, presetIconUrl, useExtensionIdentities } from '../../shared/ui/extension-icon/extension-icon.js'
import { type RenderItem } from '../../features/sessions/model/transcript-render-items.js'
import { buildRenderItems } from '../../features/sessions/model/transcript-render-items.js'
import { ToolCollapse, type RowExpansion } from '../../features/sessions/ui/agent-tool-blocks.js'
import { AgentToolGroupBlock } from '../../features/sessions/ui/agent-tool-blocks.js'
import { StreamingViewport } from '../../shared/ui/streaming-viewport/streaming-viewport.js'
import { UserIdentity, type UserIdentityView } from '../../shared/ui/user-identity/user-identity.js'
import { ContentErrorBoundary } from '../../shared/ui/content-error-boundary.js'
import { SelectionToolbar, appendQuote } from '../../shared/ui/selection-toolbar/selection-toolbar.js'
import { BookOpen, Check, Pencil, ChevronDown, Copy, Plus, Trash2 } from 'lucide-react'
import { lazy, memo, Suspense, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { AgentTranscriptEntry as AgentTranscriptEntryEntity, AgentPreset, AgentSession, CardSummary, NarrativeTimeline, ProviderAccount } from '../../entities/index.js'
import type { Translator } from '../../shared/i18n/index.js'
import type { ActiveAgentRun } from '../../features/narrative-runtime/model/use-narrative-runtime.js'
import { useCopyFeedback } from '../../shared/hooks/use-copy-feedback.js'
import { DisplayProjectionStatus } from '../../features/message-content/ui/display-projection-status.js'
import { messageCodeBlockLabels } from '../../features/message-content/ui/message-code-block-labels.js'
import { useConversationViewport } from '../../shared/ui/conversation-viewport/use-conversation-viewport.js'
import type { MarkdownCodeBlockLabels } from '../../shared/ui/markdown-content/markdown-code-block.js'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, SearchField, SkeletonText } from '@loom-studio/ui'
import { confirm } from '../../shared/ui/confirm-dialog/index.js'
import { ConversationMessageAction, ConversationMessageChrome } from '../../shared/ui/conversation-message-chrome/conversation-message-chrome.js'
import { ChatComposer } from '../chat-composer/chat-composer.js'
import { AgentMutationApprovalDialog } from './agent-mutation-approval-dialog.js'
import { RunRecoveryControls, type RunRecoveryControlsProps } from '../../features/narrative-runtime/ui/run-recovery-controls.js'
import type { ClientRendererHost } from '../../shared/extension-renderer-runtime/client-renderer-host.js'
import { RendererNodeMountHost } from '../../features/extension-renderers/ui/renderer-node-mount-host.js'
import styles from './agent-chat-panel.module.scss'
import { AgentSessionCreateDialog } from '../../features/sessions/ui/agent-session-create-dialog.js'
import { AgentSessionPicker } from './agent-session-picker.js'
import { displayText, isTransientAgentEntryId, type DisplayProjection } from '../../features/message-content/model/use-display-projection.js'

const ConversationMarkdown = lazy(async () => {
  const module = await import('../../features/message-content/ui/message-content.js')
  return { default: module.MessageContent }
})

export type AgentChatPanelProps = RunRecoveryControlsProps & AttachmentComposerProps & {
  onReviseInput?: ReviseUserInput
  userIdentity?: UserIdentityView
  active?: boolean
  scrollRestorationScope?: string
  onboardingHint?: ReactNode
  initialCreatePresetId?: string
  displayProjection?: DisplayProjection
  busy: boolean
  activeRun?: ActiveAgentRun
  input: string
  messages: AgentTranscriptEntryEntity[]
  profiles: AgentPreset[]
  providerAccounts: ProviderAccount[]
  rendererHost?: ClientRendererHost
  selectedProfileId?: string
  session?: AgentSession
  sessions?: AgentSession[]
  cards?: CardSummary[]
  timelines?: NarrativeTimeline[]
  sessionReady?: boolean
  sessionTail?: ReactNode
  summaryCoverage?: { retiredThroughSequence: number; sourceThroughSequence: number; messages: { retired: number; source: number; total: number } }
  summaryRows?: { id: string; sourceThroughSequence: number; adopted: boolean; content: ReactNode }[]
  summaryControl?: { state: 'running' | 'suspended' | 'idle'; stop(): void; resume(): void }
  t: Translator
  onOpenMemory?(): void
  onChangeInput(value: string): void
  onSelectProfile(id: string): void
  onSelectSession?(id: string): void
  onNewSession?(): void
  onCreateSession?(presetId: string): Promise<AgentSession | undefined>
  primarySessionId?: string
  onRenameSession?(id: string, title: string): Promise<AgentSession | undefined>
  onDeleteSession?(id: string): void
  onSubmit(event: FormEvent): void
  onCancelRun?(): void
  onPauseRun?(): void
  onResumeRun?(): void
  onApproveMutation?(allow: boolean, reason?: string): Promise<boolean>
}

export const AgentChatPanel = memo(function AgentChatPanel(props: AgentChatPanelProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const summaryControl = !props.busy && props.activeRun?.status !== 'running' && props.activeRun?.status !== 'suspended' ? props.summaryControl : undefined
  const recovery = props.runRecovery?.target === 'agent' ? props.runRecovery : undefined
  const disconnected = props.runRecovery?.status === 'disconnected'
  const canSend = Boolean(props.input.trim() || props.attachments?.length) && (props.attachments ?? []).every(item => item.attachment) && !disconnected && !props.runRecoveryBusy && props.sessionReady !== false && Boolean(props.selectedProfileId)
  const [createOpen, setCreateOpen] = useState(false)
  const approval = props.activeRun?.approval
  const approvalKey = approval ? `${props.activeRun!.runId}:${approval.requestId}` : undefined
  const [hiddenApproval, setHiddenApproval] = useState<string>()
  const { feedback: copyState, copy: copyText } = useCopyFeedback()

  const effectiveMessages = props.messages
  const renderItems = useMemo(() => {
    const rows = props.summaryRows ?? []
    const mergedSources = new Set<number>()
    const entries = effectiveMessages.filter(message => {
      if (message.entry.kind !== 'work-summary') return true
      const boundary = message.entry.boundary
      if (!boundary) return true
      const source = boundary.sourceThroughSequence
      if (mergedSources.has(source)) return true
      if (!rows.some(row => row.adopted && row.sourceThroughSequence === source)) return true
      mergedSources.add(source)
      return false
    })
    const base = buildRenderItems(entries, props.activeRun)
    const sequence = new Map(entries.map(entry => [entry.presentationId ?? entry.id, entry.sequence]))
    const result: (RenderItem | { kind: 'summary-activity'; id: string; content: ReactNode })[] = []
    const pending = [...rows]
    const coverage = props.summaryCoverage
    if (coverage && coverage.retiredThroughSequence > 0) {
      pending.push({ id: 'summary-retired-start', sourceThroughSequence: 0, adopted: false,
        content: <div className={styles.contextBoundary}><strong>已由摘要替代的历史</strong><span>会话消息 #1–#{coverage.messages.retired} 及对应工具记录不再以原文注入，仍可在此查阅。</span></div> })
      pending.push({ id: 'summary-retired-end', sourceThroughSequence: coverage.retiredThroughSequence, adopted: false,
        content: <div className={styles.contextBoundary}><strong>{coverage.sourceThroughSequence > coverage.retiredThroughSequence ? '原文缓冲区' : '以下保留原文'}</strong><span>此前的工作由会话摘要接续；以下工作仍保留完整上下文。</span></div> })
      if (coverage.sourceThroughSequence > coverage.retiredThroughSequence) pending.push({ id: 'summary-buffer-end', sourceThroughSequence: coverage.sourceThroughSequence, adopted: false,
        content: <div className={styles.contextBoundary}><strong>交接后新增工作</strong><span>以上为此次交接保留的缓冲区；以下是后续新工作。</span></div> })
    }
    pending.sort((a, b) => a.sourceThroughSequence - b.sourceThroughSequence)
    for (const item of base) {
      const start = sequence.get(item.kind === 'tool-group' ? item.tools[0].id : item.id) ?? Infinity
      while (pending.length && pending[0].sourceThroughSequence < start) {
        const row = pending.shift()!
        result.push({ kind: 'summary-activity', id: row.id, content: row.content })
      }
      result.push(item)
    }
    for (const row of pending) result.push({ kind: 'summary-activity', id: row.id, content: row.content })
    return result
  }, [effectiveMessages, props.summaryRows, props.summaryCoverage, props.activeRun])
  const { scrollRef: conversationRef, contentRef, listRef, headerRef, virtualizer, scrollMargin, onScroll, smooth } = useConversationViewport({
    items: renderItems,
    restoration: props.scrollRestorationScope ? { view: 'session', scope: props.scrollRestorationScope } : undefined,
    active: props.active,
    scopeId: props.session?.id,
  })
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({})
  const liveExpandedRows = useRef(new Set<string>())
  const expansionKey = (id: string) => JSON.stringify([props.session?.id, id])
  for (const item of renderItems) {
    if (item.kind === 'reasoning' && item.isStreaming) liveExpandedRows.current.add(expansionKey(item.id))
    if (item.kind === 'tool-group') for (const tool of item.tools) {
      if (tool.status === 'preparing' || tool.status === 'running') {
        liveExpandedRows.current.add(expansionKey(item.id))
        liveExpandedRows.current.add(expansionKey(tool.id))
      }
    }
  }
  const initiallyOpen = (id: string) => liveExpandedRows.current.has(expansionKey(id))
  const expansion: RowExpansion = {
    isOpen: (id, initial = false) => expandedRows[expansionKey(id)] ?? initial,
    toggle: (id, initial = false) => setExpandedRows(previous => ({
      ...previous, [expansionKey(id)]: !(previous[expansionKey(id)] ?? initial),
    })),
  }

  async function copyMessage(message: AgentTranscriptEntryEntity, content: string) {
    await copyText(content, message.id)
  }

  const codeBlockLabels = messageCodeBlockLabels(props.t)

  return (
    <div data-smooth-follow className={styles.panel} data-loom-component="agent-chat-panel">
      <SelectionToolbar key={props.session?.id} containerRef={conversationRef} inputRef={inputRef} t={props.t}
        onQuote={text => props.onChangeInput(appendQuote(props.input, text))} />
      <header className={styles.sessionBar}>
        <AgentSessionPicker session={props.session}
          sessions={props.sessions ?? (props.session ? [props.session] : [])}
          presets={props.profiles} cards={props.cards} timelines={props.timelines} t={props.t}
          disabled={props.busy}
          sessionReady={props.sessionReady} primarySessionId={props.primarySessionId}
          onRename={props.onRenameSession} />
        <div className={styles.sessionActions}>
          {props.onOpenMemory && <button className={styles.sessionAction} type="button" disabled={!props.session || props.sessionReady === false}
            title="会话记忆" aria-label="会话记忆" onClick={props.onOpenMemory}><BookOpen aria-hidden="true" /></button>}
          <button className={styles.sessionAction} type="button" disabled={props.busy || (!props.onCreateSession && !props.onNewSession)}
            title={props.t('agent.sessionNew')} aria-label={props.t('agent.sessionNew')}
            onClick={() => props.onCreateSession ? setCreateOpen(true) : props.onNewSession?.()}>
            <Plus aria-hidden="true" />
          </button>
          <button className={styles.sessionAction} type="button"
            disabled={props.busy || !props.session || !props.onDeleteSession || props.sessionReady === false
              || props.activeRun?.status === 'running' || props.activeRun?.status === 'suspended'}
            title={props.t('sessions.delete')} aria-label={props.t('sessions.delete')}
            onClick={() => {
              void (async () => {
                if (props.session && await confirm({
                  title: '删除会话',
                  message: props.t('sessions.confirmDeleteSession', {
                    title: props.session.title ?? props.t('sessions.untitledAgentSession'),
                  }),
                  danger: true,
                })) {
                  props.onDeleteSession?.(props.session.id)
                }
              })()
            }}>
            <Trash2 aria-hidden="true" />
          </button>
        </div>
      </header>
      {props.onboardingHint}
      {createOpen && props.onCreateSession ? <AgentSessionCreateDialog
        t={props.t}
        presets={props.profiles}
        initialPresetId={props.initialCreatePresetId ?? props.selectedProfileId}
        onCreate={props.onCreateSession}
        onCreated={session => props.onSelectSession?.(session.id)}
        onClose={() => setCreateOpen(false)}
      /> : null}

      {!smooth.following && <button type="button" className={styles.followLatest} onClick={smooth.resume}><ChevronDown aria-hidden="true" />回到最新进度</button>}
      <div className={styles.conversation} ref={conversationRef} aria-busy={props.displayProjection?.refreshing}
        onScroll={onScroll}>
        <div className={styles.conversationContent} ref={contentRef}>
        <div ref={headerRef}>
        <DisplayProjectionStatus projection={props.displayProjection} retryLabel={props.t('textTransform.refresh')} />
          {!props.busy && props.sessionReady === false ? (
            <p className={styles.empty} role="alert">{props.t('agent.sessionLoadFailed')}</p>
          ) : effectiveMessages.length === 0 && !props.busy ? (
            <p className={styles.empty}>{props.t('agent.sessionEmpty')}</p>
          ) : null}

        </div>
          <div ref={listRef} className={styles.virtualList} style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map(row => {
            const item = renderItems[row.index]
            const entry = item.kind === 'message' ? item.message.entry : undefined
            const inputIdentity = entry?.kind === 'user-interjection' ? entry.requestId : entry?.kind === 'message' ? entry.interjectionRequestId : undefined
            const rowKey = inputIdentity ? `input:${inputIdentity}` : item.id
            let content: ReactNode
            if (item.kind === 'summary-activity') content = item.content
            if (item.kind === 'tool-group') {
              content = (
                <AgentToolGroupBlock
                  key={rowKey}
                  id={item.id}
                  expansion={expansion}
                  label={item.label}
                  tools={item.tools}
                  followWork
                  defaultOpen={initiallyOpen(item.id)}
                  isInitiallyOpen={initiallyOpen}
                  onInspect={smooth.pause}
                  t={props.t}
                />
              )
            }
            if (item.kind === 'summary') {
              content = <details style={{ margin: '10px 16px', fontSize: 'var(--loom-font-size-2)' }}>
                <summary>{item.label}</summary>
                <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item.content}</p>
                <button type="button" onClick={props.onOpenMemory}>查看当前生效摘要</button>
              </details>
            }
            if (item.kind === 'reasoning') {
              content = (
                <AgentReasoningBlock
                  key={rowKey}
                  open={expansion.isOpen(item.id, initiallyOpen(item.id))}
                  followWork
                  streaming={props.activeRun?.status === 'running'}
                  onInspect={smooth.pause}
                  onToggle={() => { smooth.pause(); expansion.toggle(item.id, initiallyOpen(item.id)) }}
                  content={item.content}
                  label={props.t('agent.reasoning')}
                />
              )
            }
            if (item.kind === 'message') {
              content = (
                <AgentTranscriptEntry
                  agentSessionId={props.session?.id}
                  codeBlockLabels={codeBlockLabels}
                  onReviseInput={item.role === 'user' && item.interjectionStatus !== 'discarded' && item.id === renderItems.findLast(row => row.kind === 'message' && row.role === 'user')?.id ? props.onReviseInput : undefined}
                  editBlocked={item.interjectionStatus !== 'pending' && props.activeRun?.status === 'running'}
                  interjectionStatus={item.interjectionStatus}
                  content={item.content}
                  displayContent={displayText(props.displayProjection, item.id, item.content, item.isStreaming || isTransientAgentEntryId(item.id))}
                  displayProjectionError={Boolean(props.displayProjection?.error)}
                  displayProjectionPending={Boolean(props.displayProjection?.pending)}
                  copyState={copyState?.id === item.id ? copyState.status === 'copied' : undefined}
                  index={item.index}
                  key={rowKey}
                  message={item.message}
                  rendererHost={props.rendererHost}
                  role={item.role}
                  userIdentity={props.userIdentity}
                  showChrome={item.showChrome}
                  isStreaming={item.isStreaming}
                  t={props.t}
                  onCopy={() => void copyMessage(item.message, item.content)}
                />
              )
            }
            return <div key={rowKey} data-index={row.index} ref={virtualizer.measureElement}
              className={styles.virtualRow} style={{ transform: `translateY(${row.start - scrollMargin}px)` }}>
              <ContentErrorBoundary resetKey={item} fallback={error => <p role="alert">{error.message}</p>}><Suspense fallback={<div aria-busy="true"><SkeletonText lines={5} /></div>}>{content}</Suspense></ContentErrorBoundary>
            </div>
          })}
          </div>

          {props.sessionTail ? (
            <div data-loom-surface="agent.session.tail">{props.sessionTail}</div>
          ) : null}
        </div>
      </div>

      {approval && hiddenApproval !== approvalKey ? <AgentMutationApprovalDialog key={`${props.activeRun!.runId}:${approval.requestId}`}
        approval={approval} onApprove={props.onApproveMutation} onClose={() => setHiddenApproval(approvalKey)} t={props.t} /> : null}

      <footer className={styles.footer}>
        {approval ? <button type="button" className={styles.pendingApproval} onClick={() => setHiddenApproval(undefined)}>
          {props.t('agent.approvalPending')} · {props.t('agent.approvalReview')}
        </button> : null}
        {recovery ? <div className={styles.floatingRecovery}><RunRecoveryControls {...props} runRecovery={recovery} /></div> : null}
        <ChatComposer
        t={props.t}
        attachmentNotice={props.attachmentNotice} onRetryAttachment={props.onRetryAttachment} attachments={props.attachments} onAddAttachments={props.onAddAttachments} onRemoveAttachment={props.onRemoveAttachment}
          inputRef={inputRef}
          canPreviewPrompt={false}
          canSend={canSend}
          input={props.input}
          moreLabel={props.t('composer.more')}
          placeholder={props.t('agent.composerPlaceholder')}
          previewLabel={props.t('composer.preview')}
          retryLabel={props.t('composer.retry')}
          sendLabel={props.t('agent.send')}
          pauseLabel={summaryControl?.state === 'running' ? '终止总结' : props.t('agent.run.pause')}
          resumeLabel={summaryControl?.state === 'suspended' ? '继续总结' : props.t('agent.run.resume')}
          runStatus={summaryControl && summaryControl.state !== 'idle' ? summaryControl.state : disconnected ? 'idle' : props.busy || props.activeRun?.status === 'running' ? 'running' : props.activeRun?.status === 'suspended' ? 'suspended' : 'idle'}
          stopAction={summaryControl?.state === 'running'}
          onPause={summaryControl?.state === 'running' ? summaryControl.stop : props.onPauseRun}
          onResume={summaryControl?.state === 'suspended' ? summaryControl.resume : props.onResumeRun}
          sendLeadingAction={(
            <AgentPresetPicker
              disabled={props.busy || props.sessionReady === false || props.activeRun?.status === 'suspended'}
              profiles={props.profiles}
              providers={props.providerAccounts}
              selectedId={props.selectedProfileId}
              t={props.t}
              onSelect={props.onSelectProfile}
            />
          )}
          textareaDisabled={!props.selectedProfileId}
          textareaLabel={props.t('agent.composerLabel')}
          onChangeInput={props.onChangeInput}
          onSubmit={event => {
            if (!canSend) { event.preventDefault(); return }
            props.onSubmit(event)
          }}
        />
      </footer>
    </div>
  )
}, (previous, next) => previous.active === false && next.active === false)

function AgentReasoningBlock(props: {
  streaming?: boolean
  label: string
  content: string
  open: boolean
  onToggle(): void
  followWork?: boolean
  onInspect?(): void
}) {
  const open = props.open

  const sentences = useMemo(() => {
    return props.content.split(/(?<=[。！？.!?\n])\s*/).filter(Boolean)
  }, [props.content])

  return (
    <div className={styles.reasoningBlock}>
      <button
        type="button"
        className={styles.reasoningHeader}
        onClick={props.onToggle}
        aria-expanded={open}
      >
        <span className={styles.reasoningLabel}>
          {props.label}
        </span>
        <ChevronDown
            className={styles.reasoningChevron}
            style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
            aria-hidden="true"
          />
      </button>

      <ToolCollapse open={open} className={styles.reasoningCollapse}>
          {props.followWork ? <StreamingViewport label="思考内容" active={open} streaming={props.streaming} onInspect={props.onInspect}>
            {sentences.map((line, idx) => <p key={idx} className={styles.reasoningSentence}>{line}</p>)}
          </StreamingViewport> : <div className={styles.reasoningViewport}>
            {sentences.map((line, idx) => (
              <p key={idx} className={styles.reasoningSentence}>
                {line}
              </p>
            ))}
          </div>}
      </ToolCollapse>
    </div>
  )
}

/**
 * 单个工具操作条目
 * 展开后严格符合图 3：单层深色全宽卡片，无套娃，纯净等宽代码输出，右下角成功/失败状态
 */
function AgentTranscriptEntry(props: {
  onReviseInput?: ReviseUserInput
  editBlocked?: boolean
  userIdentity?: UserIdentityView
  agentSessionId?: string
  codeBlockLabels: MarkdownCodeBlockLabels
  content: string
  displayContent?: string
  displayProjectionError?: boolean
  displayProjectionPending?: boolean
  copyState?: boolean
  index: number
  isStreaming?: boolean
  message: AgentTranscriptEntryEntity
  rendererHost?: ClientRendererHost
  role: 'user' | 'assistant'
  showChrome?: boolean
  interjectionStatus?: 'pending' | 'applied' | 'discarded'
  t: Translator
  onCopy(): void
}) {
  const [editing, setEditing] = useState(false)
  const editCallback = useRef(props.onReviseInput)
  if (props.onReviseInput) editCallback.current = props.onReviseInput
  const lastDisplay = useRef<{ raw: string; text: string } | undefined>(undefined)
  if (props.displayContent !== undefined) {
    lastDisplay.current = { raw: props.content, text: props.displayContent }
  }
  const displayContent = props.displayContent ?? (
    lastDisplay.current?.raw === props.content
      ? lastDisplay.current.text
      : props.displayProjectionError
        ? props.content
        : props.displayProjectionPending
          ? ''
          : props.content
  )
  const body = <ConversationMarkdown
    className={styles.messageBody}
    codeBlockLabels={props.codeBlockLabels}
    role={props.role}
    value={displayContent}
    streaming={props.isStreaming}
  />

  const attachments = props.message.entry.kind === 'message' || props.message.entry.kind === 'user-interjection' ? props.message.entry.attachments : undefined
  if (editing && editCallback.current) return <UserInputEditor entryId={props.message.id} content={props.content} attachments={attachments}
    pending={props.interjectionStatus === 'pending'} blocked={props.editBlocked || !props.onReviseInput} onSave={editCallback.current} onClose={() => setEditing(false)} />
  return (
    <article aria-busy={props.displayContent === undefined && props.displayProjectionPending} className={`${styles.message} ${styles[props.role]}`}>
      {props.role === 'user' && props.userIdentity ? <header className={styles.userIdentity}><UserIdentity {...props.userIdentity} /></header> : null}
      {props.interjectionStatus ? <small role="status">{props.interjectionStatus === 'discarded' ? '未接入（已放弃）' : props.interjectionStatus === 'pending' ? '待接入' : '已接入'}</small> : null}
      <div className={styles.messageSurface}>
        {props.rendererHost && props.agentSessionId ? (
          <RendererNodeMountHost
            agentSessionId={props.agentSessionId}
            host={props.rendererHost}
            messageId={props.message.id}
            rawText={props.content}
            displayText={displayContent}
            surface="agent-message"
          >
            {body}
          </RendererNodeMountHost>
        ) : (
          body
        )}
      </div>
      <MessageAttachments align={props.role === 'user' ? 'end' : 'start'} t={props.t} attachments={props.message.entry.kind === 'message' || props.message.entry.kind === 'user-interjection' ? props.message.entry.attachments : undefined} />
      {props.onReviseInput ? <ConversationMessageAction label="编辑用户输入" onClick={() => setEditing(true)}><Pencil aria-hidden="true" /></ConversationMessageAction> : null}
      {props.showChrome !== false && (
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
      )}
    </article>
  )
}

export function AgentPresetPicker(props: {
  disabled: boolean
  profiles: AgentPreset[]
  providers: ProviderAccount[]
  selectedId?: string
  t: Translator
  onSelect(id: string): void
}) {
  const [query, setQuery] = useState('')
  const identities = useExtensionIdentities()
  const sourceOf = (profile: AgentPreset) => {
    const origin = profile.origin
    if (origin?.kind === 'extension-package') {
      const identity = identities.find(item => item.packageId === origin.packageId
        && extensionInstallationId(item.packageId, item.target ?? { kind: 'global' }) === (origin.installationId ?? extensionInstallationId(origin.packageId, { kind: 'global' })))
      const scope = identity?.target?.kind === 'card' ? '角色' : identity || !origin.installationId ? '全局' : '安装来源未解析'
      return { id: `${origin.packageId}:${origin.installationId ?? ''}`, label: `${identity?.displayName ?? origin.packageId} · ${scope}` }
    }
    return origin?.kind === 'builtin' ? { id: 'builtin', label: '官方 · Loom Studio' } : { id: 'personal', label: '我的预设' }
  }
  const groups = new Map<string, { label: string; profiles: AgentPreset[] }>()
  for (const profile of props.profiles) {
    const source = sourceOf(profile)
    if (![profile.rootNode.label, source.label, profile.model?.modelId].join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) continue
    const group = groups.get(source.id) ?? { label: source.label, profiles: [] }
    group.profiles.push(profile)
    groups.set(source.id, group)
  }
  const selected = props.profiles.find(profile => profile.id === props.selectedId)
  const selectedProvider = selected && props.providers.find(provider => provider.id === selected.model?.providerProfileId)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className={styles.profilePicker} type="button" disabled={props.disabled}
          title={props.t('agent.profile.choose')}>
          <ExtensionIcon iconUrl={selected ? presetIconUrl(selected, identities) : undefined} size={18} />
          <span>{selected?.rootNode.label ?? props.t('agent.profile.unselected')}</span>
          <ChevronDown aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className={styles.profileMenu} align="end" side="top"
        sideOffset={8} collisionPadding={12}>
        {selected ? (
          <div className={styles.profileCurrent}>
            <strong>{selectedProvider?.displayName ?? selected.model?.providerProfileId}</strong>
            <span>{selected.model?.modelId}</span>
          </div>
        ) : null}
        <SearchField
          containerClassName={styles.profileSearch}
          aria-label="搜索预设或来源"
          placeholder="搜索预设或来源…"
          value={query}
          clearLabel="清除搜索"
          onClear={() => setQuery('')}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={event => { if (event.key !== 'Escape' && event.key !== 'Tab') event.stopPropagation() }}
        />
        {groups.size === 0 ? <p>{props.profiles.length ? '没有匹配的预设' : props.t('agent.profile.configureFirst')}</p> : [...groups.entries()].map(([id, group]) => <div key={id} role="group" aria-label={group.label}>
          <div className={styles.profileSource}>{group.label}</div>
          {group.profiles.map(profile => {
            const provider = props.providers.find(item => item.id === profile.model?.providerProfileId)
            return <DropdownMenuItem className={styles.profileOption}
              icon={<ExtensionIcon iconUrl={presetIconUrl(profile, identities)} size={24} />}
              data-selected={profile.id === props.selectedId || undefined} disabled={props.disabled} key={profile.id} onSelect={() => props.onSelect(profile.id)}>
              <span className={styles.profileName}><strong>{profile.rootNode.label}</strong>{profile.id === props.selectedId && <Check aria-label="已选中" />}</span>
              <span>{profile.model?.modelId ? [provider?.displayName ?? profile.model.providerProfileId, profile.model.modelId].filter(Boolean).join(' · ') : '未绑定模型'}</span>
            </DropdownMenuItem>
          })}
        </div>)}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
