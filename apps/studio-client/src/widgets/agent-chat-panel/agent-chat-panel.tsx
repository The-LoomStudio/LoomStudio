import { UserIdentity, type UserIdentityView } from '../../shared/ui/user-identity/user-identity.js'
import { ContentErrorBoundary } from '../../shared/ui/content-error-boundary.js'
import { SelectionToolbar, appendQuote } from '../../shared/ui/selection-toolbar/selection-toolbar.js'
import {
  AlertCircle,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  FileCode,
  Globe,
  Plus,
  RefreshCw,
  Search,
  Terminal,
  Trash2,
} from 'lucide-react'
import {
  lazy,
  memo,
  Suspense,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import type {
  AgentTranscriptEntry as AgentTranscriptEntryEntity,
  AgentPreset,
  AgentSession,
  CardSummary,
  NarrativeTimeline,
  ProviderAccount,
} from '../../entities/index.js'
import type { Translator } from '../../shared/i18n/index.js'
import type { ActiveAgentRun } from '../../features/narrative-runtime/model/use-narrative-runtime.js'
import { useCopyFeedback } from '../../shared/hooks/use-copy-feedback.js'
import { DisplayProjectionStatus } from '../../features/message-content/ui/display-projection-status.js'
import { messageCodeBlockLabels } from '../../features/message-content/ui/message-code-block-labels.js'
import { useConversationViewport } from '../../shared/ui/conversation-viewport/use-conversation-viewport.js'
import type { MarkdownCodeBlockLabels } from '../../shared/ui/markdown-content/markdown-code-block.js'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  SkeletonText,
} from '@loom-studio/ui'
import {
  ConversationMessageAction,
  ConversationMessageChrome,
} from '../../shared/ui/conversation-message-chrome/conversation-message-chrome.js'
import { ChatComposer } from '../chat-composer/chat-composer.js'
import { AgentMutationApprovalDialog } from './agent-mutation-approval-dialog.js'
import { RunRecoveryControls, type RunRecoveryControlsProps } from '../../features/narrative-runtime/ui/run-recovery-controls.js'
import type { ClientRendererHost } from '../../shared/extension-renderer-runtime/client-renderer-host.js'
import { RendererNodeMountHost } from '../../features/extension-renderers/ui/renderer-node-mount-host.js'
import styles from './agent-chat-panel.module.scss'
import { AgentSessionCreateDialog } from './agent-session-create-dialog.js'
import { AgentSessionPicker } from './agent-session-picker.js'
import { displayText, isTransientAgentEntryId, type DisplayProjection } from '../../features/message-content/model/use-display-projection.js'

const ConversationMarkdown = lazy(async () => {
  const module = await import('../../features/message-content/ui/message-content.js')
  return { default: module.MessageContent }
})

type StepToolItem = {
  id: string
  iconType: 'file' | 'search' | 'web' | 'terminal' | 'edit'
  label: string
  inputs: Array<{ label: string; content: string }>
  resultContent?: string
  errorContent?: string
  status?: 'success' | 'error' | 'running' | 'preparing' | 'interrupted'
}

type RenderItem =
  | { kind: 'summary'; id: string; label: string; content: string }

  | {
      kind: 'message'
      id: string
      message: AgentTranscriptEntryEntity
      role: 'user' | 'assistant'
      content: string
      index: number
      showChrome?: boolean
      isStreaming?: boolean
    }
  | {
      kind: 'tool-group'
      id: string
      label: string
      tools: StepToolItem[]
    }
  | {
      kind: 'reasoning'
      id: string
      content: string
    }

export function buildRenderItems(entries: AgentTranscriptEntryEntity[], activeRun?: ActiveAgentRun): RenderItem[] {
  const runStates = new Map<string, string>()
  let latestRunId: string | undefined
  for (const message of entries) {
    if (message.runId && message.entry.kind === 'run-state' && typeof message.entry.state === 'string') {
      runStates.set(message.runId, message.entry.state)
      latestRunId = message.runId
    }
  }
  if (activeRun) {
    runStates.set(activeRun.runId, activeRun.status)
    latestRunId = activeRun.runId
  }

  const toolResultsByInvocationId = new Map<string, AgentTranscriptEntryEntity['entry']>()
  for (const msg of entries) {
    if (msg.entry.kind === 'tool-result' && msg.entry.invocationId) {
      toolResultsByInvocationId.set(String(msg.entry.invocationId), msg.entry)
    }
  }

  const items: RenderItem[] = []
  let pendingTools: StepToolItem[] = []
  let messageIndex = 0

  const flushTools = () => {
    if (pendingTools.length === 0) return
    const toolCount = pendingTools.length
    const label = toolCount === 1 ? pendingTools[0].label
      : pendingTools.some(tool => tool.status === 'preparing') ? `正在准备 ${toolCount} 个操作`
        : pendingTools.some(tool => tool.status === 'running') ? `正在执行 ${toolCount} 个操作` : pendingTools.some(tool => tool.status === 'interrupted') ? `${toolCount} 个操作（含中断）` : `已执行 ${toolCount} 个操作`
    items.push({
      kind: 'tool-group',
      id: `tool-group-${pendingTools[0].id}`,
      label,
      tools: [...pendingTools],
    })
    pendingTools = []
  }

  for (const msg of entries) {
    const entry = msg.entry

    // 过滤底层遥测与内部运行状态流转事件（provider-observation, run-state），既不打断连续工具链，也不在时间线展示多余胶囊
    if (entry.kind === 'provider-observation' || entry.kind === 'request-measurement' || entry.kind === 'run-state') {
      continue
    }

    if (entry.kind === 'work-summary') {
      flushTools()
      items.push({ kind: 'summary', id: msg.id, label: '已保存交接摘要', content: String(entry.content ?? '') })
    } else if (entry.kind === 'tool-input') {
      const interrupted = entry.status === 'interrupted' || Boolean(msg.runId && runStates.has(msg.runId)
        && (runStates.get(msg.runId) !== 'running' || msg.runId !== latestRunId))
      pendingTools.push({
        id: msg.id, iconType: 'terminal',
        label: `${entry.exposedName ?? '工具调用'} · ${interrupted ? '参数生成已中断，尚未执行' : '正在准备参数'}`,
        inputs: [{ label: '参数草稿', content: String(entry.rawInput ?? '') }],
        status: interrupted ? 'interrupted' : 'preparing',
      })
    } else if (entry.kind === 'tool-invocation') {
      const toolId = String(entry.toolId || '')
      const exposedName = String(entry.exposedName || entry.toolId || '执行工具')
      const invocationId = String(entry.invocationId ?? '')
      const pairedResult = invocationId ? toolResultsByInvocationId.get(invocationId) : undefined

      let iconType: StepToolItem['iconType'] = 'terminal'
      if (toolId.includes('search') || exposedName.includes('搜索') || exposedName.includes('检索')) {
        iconType = 'search'
      } else if (toolId.includes('read') || toolId.includes('worldbook') || exposedName.includes('读取') || exposedName.includes('世界书')) {
        iconType = 'file'
      } else if (toolId.includes('web') || toolId.includes('http') || exposedName.includes('网页')) {
        iconType = 'web'
      } else if (toolId.includes('patch') || toolId.includes('write') || toolId.includes('edit') || exposedName.includes('修改') || exposedName.includes('编辑')) {
        iconType = 'edit'
      }

      const inputs: StepToolItem['inputs'] = []
      if (entry.arguments !== undefined) {
        inputs.push({ label: '参数', content: JSON.stringify(entry.arguments, null, 2) })
      }
      if (typeof entry.rawInput === 'string') {
        inputs.push({
          label: toolId.includes('codeact') ? '代码' : '输入',
          content: entry.rawInput,
        })
      }
      if (!inputs.length) inputs.push({ label: '调用', content: '未记录调用内容' })

      let resultContent: string | undefined
      if (pairedResult) {
        resultContent = typeof pairedResult.content === 'string'
          ? pairedResult.content
          : Array.isArray(pairedResult.content)
            ? pairedResult.content.map(c => (c && typeof c === 'object' && 'text' in c && c.text) || JSON.stringify(c)).join('\n')
            : pairedResult.content === undefined ? undefined : JSON.stringify(pairedResult.content, null, 2)
      }
      const error = pairedResult?.error
      const errorContent = error && typeof error === 'object' && !Array.isArray(error)
        ? [typeof error.code === 'string' ? error.code : '', typeof error.message === 'string' ? error.message : ''].filter(Boolean).join(': ')
        : undefined

      const runState = msg.runId ? runStates.get(msg.runId) : undefined
      const interrupted = Boolean(runState && (runState !== 'running' && runState !== 'created' || msg.runId !== latestRunId))
      const incompleteInput = entry.status === 'suspended' && pairedResult?.syntheticReason === 'interrupt'
      pendingTools.push({
        id: msg.presentationId ?? msg.id,
        iconType,
        label: incompleteInput ? `${exposedName} · 参数生成已中断，尚未执行`
          : pairedResult && !exposedName.startsWith('已') ? `已${exposedName}` : exposedName,
        inputs,
        resultContent,
        errorContent: errorContent || undefined,
        status: incompleteInput ? 'interrupted' : !pairedResult ? interrupted ? 'interrupted' : 'running' : pairedResult.status === 'completed' ? 'success' : 'error',
      })
    } else if (entry.kind === 'reasoning' && typeof entry.content === 'string') {
      flushTools()
      items.push({
        kind: 'reasoning',
        id: msg.id,
        content: entry.content,
      })
    } else if (entry.kind === 'message' && typeof entry.content === 'string') {
      const isAssistant = entry.role === 'assistant'
      const isStreamingFinal = entry.state === 'partial'

      // 如果是 Assistant 消息，但内容纯空、非流式中且无产物卡片，说明是无输出中断，不建立空楼层
      if (isAssistant && !entry.content.trim() && !isStreamingFinal) {
        continue
      }

      flushTools()
      items.push({
        kind: 'message',
        id: msg.id,
        message: msg,
        role: isAssistant ? 'assistant' : 'user',
        content: entry.content,
        index: messageIndex++,
        showChrome: !isStreamingFinal,
        isStreaming: isStreamingFinal,
      })
    } else if (entry.kind === 'tool-result') {
      // 聚合至 tool-invocation
    }
  }

  flushTools()
  return items
}

export type AgentChatPanelProps = RunRecoveryControlsProps & {
  userIdentity?: UserIdentityView
  active?: boolean
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
  onCreateSession?(presetId: string, makePrimary: boolean): Promise<AgentSession | undefined>
  canMakePrimary?: boolean
  primarySessionId?: string
  timelineId?: string
  onSetPrimary?(session: AgentSession): Promise<void>
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
  const canSend = Boolean(props.input.trim()) && !props.busy && props.summaryControl?.state !== 'running' && !disconnected && !props.runRecoveryBusy && props.sessionReady !== false && Boolean(props.selectedProfileId)
    && props.activeRun?.status !== 'running' && props.activeRun?.status !== 'suspended'
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
      const boundary = message.entry.boundary
      if (message.entry.kind !== 'work-summary' || !boundary || typeof boundary !== 'object' || Array.isArray(boundary)) return true
      const source = boundary.sourceThroughSequence
      if (typeof source !== 'number' || mergedSources.has(source)) return true
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
  const { scrollRef: conversationRef, contentRef, listRef, headerRef, virtualizer, scrollMargin, onScroll } = useConversationViewport({
    items: renderItems,
    active: props.active,
    scopeId: props.session?.id,
  })
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({})
  const expansionKey = (id: string) => JSON.stringify([props.session?.id, id])
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
    <div className={styles.panel} data-loom-component="agent-chat-panel">
      <SelectionToolbar key={props.session?.id} containerRef={conversationRef} inputRef={inputRef} t={props.t}
        onQuote={text => props.onChangeInput(appendQuote(props.input, text))} />
      <header className={styles.sessionBar}>
        <AgentSessionPicker session={props.session}
          sessions={props.sessions ?? (props.session ? [props.session] : [])}
          presets={props.profiles} cards={props.cards} timelines={props.timelines} t={props.t}
          disabled={props.busy}
          sessionReady={props.sessionReady} primarySessionId={props.primarySessionId} timelineId={props.timelineId}
          onRename={props.onRenameSession} onSetPrimary={props.onSetPrimary} />
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
              if (props.session && window.confirm(props.t('sessions.confirmDeleteSession', {
                title: props.session.title ?? props.t('sessions.untitledAgentSession'),
              }))) {
                props.onDeleteSession?.(props.session.id)
              }
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
        canMakePrimary={props.canMakePrimary === true}
        onCreate={props.onCreateSession}
        onCreated={session => props.onSelectSession?.(session.id)}
        onClose={() => setCreateOpen(false)}
      /> : null}

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
            let content: ReactNode
            if (item.kind === 'summary-activity') content = item.content
            if (item.kind === 'tool-group') {
              content = (
                <AgentToolGroupBlock
                  key={item.id}
                  id={item.id}
                  expansion={expansion}
                  label={item.label}
                  tools={item.tools}
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
                  key={item.id}
                  open={expansion.isOpen(item.id)}
                  onToggle={() => expansion.toggle(item.id)}
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
                  content={item.content}
                  displayContent={displayText(props.displayProjection, item.id, item.content, item.isStreaming || isTransientAgentEntryId(item.id))}
                  displayProjectionError={Boolean(props.displayProjection?.error)}
                  displayProjectionPending={Boolean(props.displayProjection?.pending)}
                  copyState={copyState?.id === item.id ? copyState.status === 'copied' : undefined}
                  index={item.index}
                  key={item.id}
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
            return <div key={item.id} data-index={row.index} ref={virtualizer.measureElement}
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

function ToolCollapse(props: {
  open: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={`${styles.toolCollapse} ${props.className ?? ''}`}
      data-open={props.open}
      aria-hidden={!props.open}
      inert={!props.open}
    >
      <div className={styles.toolCollapseInner}>{props.children}</div>
    </div>
  )
}

function AgentReasoningBlock(props: {
  label: string
  content: string
  open: boolean
  onToggle(): void
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
          <div className={styles.reasoningViewport}>
            {sentences.map((line, idx) => (
              <p key={idx} className={styles.reasoningSentence}>
                {line}
              </p>
            ))}
          </div>
      </ToolCollapse>
    </div>
  )
}

/**
 * 单个工具操作条目
 * 展开后严格符合图 3：单层深色全宽卡片，无套娃，纯净等宽代码输出，右下角成功/失败状态
 */
type RowExpansion = {
  isOpen(id: string, initial?: boolean): boolean
  toggle(id: string, initial?: boolean): void
}

export function AgentToolActionItem(props: StepToolItem & { defaultOpen?: boolean; expansion?: RowExpansion; t?: Translator }) {
  const [localOpen, setLocalOpen] = useState(props.defaultOpen ?? false)
  const open = props.expansion?.isOpen(props.id, props.defaultOpen) ?? localOpen
  const duplicateResult = Boolean(props.errorContent && props.resultContent?.trim() === props.errorContent.trim())

  const renderIcon = () => {
    switch (props.iconType) {
      case 'file':
        return <BookOpen aria-hidden="true" />
      case 'search':
        return <Search aria-hidden="true" />
      case 'web':
        return <Globe aria-hidden="true" />
      case 'terminal':
        return <Terminal aria-hidden="true" />
      case 'edit':
        return <FileCode aria-hidden="true" />
      default:
        return <Terminal aria-hidden="true" />
    }
  }

  return (
    <div className={styles.toolItem}>
      <button
        type="button"
        className={styles.toolItemHeader}
        onClick={() => props.expansion ? props.expansion.toggle(props.id, props.defaultOpen) : setLocalOpen(prev => !prev)}
        aria-expanded={open}
      >
        <span className={styles.toolItemIcon}>{props.status === 'running' || props.status === 'preparing' ? <RefreshCw className={styles.toolSpinner} aria-hidden="true" /> : renderIcon()}</span>
        <span className={styles.toolItemLabel}>{props.label}</span>
        {open ? (
          <ChevronDown className={styles.toolItemChevron} aria-hidden="true" />
        ) : (
          <ChevronRight className={styles.toolItemChevron} aria-hidden="true" />
        )}
      </button>

      <ToolCollapse open={open}>
        <div className={styles.toolDetailCard}>
          {props.inputs.map((input, index) => (
            <div className={styles.toolDetailSection} key={`${input.label}-${index}`}>
              <span className={styles.toolDetailTag}>{input.label}</span>
              <pre className={styles.toolDetailCode}>{input.content}</pre>
            </div>
          ))}
          {props.errorContent ? (
            <div className={styles.toolDetailSection}>
              <span className={styles.toolDetailTag}>{props.t ? props.t('agent.tool.error') : '错误'}</span>
              <pre className={`${styles.toolDetailCode} ${styles.toolDetailError}`}>{props.errorContent}</pre>
            </div>
          ) : null}
          {props.resultContent !== undefined && !duplicateResult && (props.resultContent || !props.errorContent) ? (
            <div className={styles.toolDetailSection}>
              <span className={styles.toolDetailTag}>{props.t ? props.t('agent.tool.result') : '结果'}</span>
              <pre className={styles.toolDetailCode}>{props.resultContent || (props.t ? props.t('agent.tool.noOutput') : '无输出')}</pre>
            </div>
          ) : null}
          <div
            className={styles.toolDetailFooter}
            data-status={props.status ?? 'running'}
          >
            {props.status === 'error' ? (
              <>
                <AlertCircle aria-hidden="true" />
                <span>{props.t ? props.t('agent.tool.failed') : '失败'}</span>
              </>
            ) : props.status === 'interrupted' ? (
              <>
                <AlertCircle aria-hidden="true" />
                <span>{props.t ? props.t('agent.tool.interrupted') : '已中断'}</span>
              </>
            ) : props.status === 'preparing' ? (
              <><RefreshCw aria-hidden="true" /><span>{props.t ? props.t('agent.tool.preparing') : '正在准备参数，尚未执行'}</span></>
            ) : props.status === 'running' ? (
              <>
                <RefreshCw aria-hidden="true" />
                <span>{props.t ? props.t('agent.tool.running') : '执行中'}</span>
              </>
            ) : (
              <>
                <CheckCircle2 aria-hidden="true" />
                <span>{props.t ? props.t('agent.tool.success') : '成功'}</span>
              </>
            )}
          </div>
        </div>
      </ToolCollapse>
    </div>
  )
}

/**
 * 连续工具聚合块 (Tool Group Block)
 * 只要有工具连在一起，就是一个单独的滚动区间 (上限 260px)
 * 若仅有单工具，直接展示单工具项，避免形式主义套壳
 */
export function AgentToolGroupBlock(props: {
  id?: string
  label: string
  tools: StepToolItem[]
  defaultOpen?: boolean
  expansion?: RowExpansion
  t?: Translator
}) {
  const [localOpen, setLocalOpen] = useState(props.defaultOpen ?? false)
  const open = props.id && props.expansion ? props.expansion.isOpen(props.id, props.defaultOpen) : localOpen

  return (
    <div className={styles.toolGroupBlock}>
      {props.tools.length > 1 ? <button
        type="button"
        className={styles.toolGroupHeader}
        onClick={() => props.id && props.expansion ? props.expansion.toggle(props.id, props.defaultOpen) : setLocalOpen(prev => !prev)}
        aria-expanded={open}
      >
        <span className={styles.toolItemIcon}>
          <BookOpen aria-hidden="true" />
        </span>
        <span>{props.label}</span>
        {open ? (
          <ChevronDown className={styles.toolGroupChevron} aria-hidden="true" />
        ) : (
          <ChevronRight className={styles.toolGroupChevron} aria-hidden="true" />
        )}
      </button> : null}

      <ToolCollapse open={props.tools.length === 1 || open}>
        <div className={styles.toolGroupViewport}>
          {props.tools.map((tool, index) => (
            <AgentToolActionItem
              key={tool.id}
              {...tool}
              expansion={props.expansion}
              defaultOpen={index === 0 && props.defaultOpen}
              t={props.t}
            />
          ))}
        </div>
      </ToolCollapse>
    </div>
  )
}

function AgentTranscriptEntry(props: {
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
  t: Translator
  onCopy(): void
}) {
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

  return (
    <article aria-busy={props.displayContent === undefined && props.displayProjectionPending} className={`${styles.message} ${styles[props.role]}`}>
      {props.role === 'user' && props.userIdentity ? <header className={styles.userIdentity}><UserIdentity {...props.userIdentity} /></header> : null}
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

function AgentPresetPicker(props: {
  disabled: boolean
  profiles: AgentPreset[]
  providers: ProviderAccount[]
  selectedId?: string
  t: Translator
  onSelect(id: string): void
}) {
  const selected = props.profiles.find(profile => profile.id === props.selectedId)
  const selectedProvider = selected && props.providers.find(provider => provider.id === selected.model?.providerProfileId)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className={styles.profilePicker} type="button" disabled={props.disabled}
          title={props.t('agent.profile.choose')}>
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
        {props.profiles.length === 0 ? (
          <p>{props.t('agent.profile.configureFirst')}</p>
        ) : (
          props.profiles.map(profile => {
            const provider = props.providers.find(item => item.id === profile.model?.providerProfileId)
            return (
              <DropdownMenuItem
                className={styles.profileOption}
                icon={<Check aria-hidden="true" />}
                data-selected={profile.id === props.selectedId || undefined}
                disabled={props.disabled}
                key={profile.id}
                onSelect={() => props.onSelect(profile.id)}
              >
                <strong>{profile.rootNode.label}</strong>
                <span>
                  {provider?.displayName ?? profile.model?.providerProfileId} · {profile.model?.modelId}
                </span>
              </DropdownMenuItem>
            )
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
