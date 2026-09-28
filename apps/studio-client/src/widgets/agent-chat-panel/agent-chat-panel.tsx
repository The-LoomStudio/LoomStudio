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
  X,
} from 'lucide-react'
import {
  lazy,
  Suspense,
  useEffect,
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
  ProviderAccount,
} from '../../entities/index.js'
import type { Translator } from '../../shared/i18n/index.js'
import type { ActiveAgentRun } from '../../features/narrative-runtime/model/use-narrative-runtime.js'
import { tryWriteClipboardText } from '../../shared/browser/clipboard.js'
import type { MarkdownCodeBlockLabels } from '../../shared/ui/markdown-content/markdown-code-block.js'
import { SkeletonText } from '@loom-studio/ui'
import {
  ConversationMessageAction,
  ConversationMessageChrome,
} from '../../shared/ui/conversation-message-chrome/conversation-message-chrome.js'
import { ChatComposer } from '../chat-composer/chat-composer.js'
import { RunRecoveryControls, type RunRecoveryControlsProps } from '../../features/narrative-runtime/ui/run-recovery-controls.js'
import type { ClientRendererHost } from '../../shared/extension-renderer-runtime/client-renderer-host.js'
import { RendererNodeMountHost } from '../../features/extension-renderers/ui/renderer-node-mount-host.js'
import styles from './agent-chat-panel.module.scss'
import { displayText, type DisplayProjection } from '../../features/message-content/model/use-display-projection.js'

const ConversationMarkdown = lazy(async () => {
  const module = await import('../../features/message-content/ui/message-content.js')
  return { default: module.MessageContent }
})

type StepToolItem = {
  id: string
  iconType: 'file' | 'search' | 'web' | 'terminal' | 'edit'
  label: string
  detailTag?: string
  detailContent?: string
  status?: 'success' | 'error' | 'running'
}

type RenderItem =
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
      duration: string
      content: string
      isThinking?: boolean
    }

function buildRenderItems(entries: AgentTranscriptEntryEntity[]): RenderItem[] {

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
    const label = toolCount === 1 ? pendingTools[0].label : `已执行 ${toolCount} 个操作`
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
    if (entry.kind === 'provider-observation' || entry.kind === 'run-state') {
      continue
    }

    if (entry.kind === 'tool-invocation') {
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

      let detailContent = ''
      if (pairedResult) {
        const resText = typeof pairedResult.content === 'string'
          ? pairedResult.content
          : Array.isArray(pairedResult.content)
            ? pairedResult.content.map(c => (c && typeof c === 'object' && 'text' in c && c.text) || JSON.stringify(c)).join('\n')
            : JSON.stringify(pairedResult.content || pairedResult, null, 2)
        detailContent = resText
      } else if (entry.arguments) {
        detailContent = `$ ${exposedName} (${toolId})\n${JSON.stringify(entry.arguments, null, 2)}`
      }

      pendingTools.push({
        id: msg.id,
        iconType,
        label: exposedName.startsWith('已') ? exposedName : `已${exposedName}`,
        detailTag: iconType === 'terminal' ? 'Shell' : exposedName,
        detailContent: detailContent || `$ ${toolId}`,
        status: pairedResult?.status === 'error' ? 'error' : 'success',
      })
    } else if (entry.kind === 'reasoning' && typeof entry.content === 'string') {
      flushTools()
      items.push({
        kind: 'reasoning',
        id: msg.id,
        duration: '',
        content: entry.content,
        isThinking: false,
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
  sessionReady?: boolean
  sessionTail?: ReactNode
  t: Translator
  onChangeInput(value: string): void
  onSelectProfile(id: string): void
  onSelectSession?(id: string): void
  onNewSession?(): void
  onRefreshSessions?(): void
  onSubmit(event: FormEvent): void
  onCancelRun?(): void
  onPauseRun?(): void
  onResumeRun?(): void
  onApproveMutation?(allow: boolean, reason?: string): void
}

export function AgentChatPanel(props: AgentChatPanelProps) {
  const recovery = props.runRecovery?.target === 'agent' ? props.runRecovery : undefined
  const disconnected = props.runRecovery?.status === 'disconnected'
  const conversationRef = useRef<HTMLDivElement>(null)
  const [approvalReason, setApprovalReason] = useState('')
  const approval = props.activeRun?.approval
  const [copyState, setCopyState] = useState<{ id: string; copied: boolean }>()
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const effectiveMessages = props.messages
  const renderItems = buildRenderItems(effectiveMessages)

  useEffect(() => () => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
  }, [])

  useEffect(() => {
    const conversation = conversationRef.current
    if (conversation) {
      conversation.scrollTop = conversation.scrollHeight
    }
  }, [effectiveMessages])

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

      <div className={styles.conversation} ref={conversationRef} aria-busy={props.displayProjection?.refreshing}>
        {props.displayProjection?.warning ? <p role="status">Display: {props.displayProjection.warning}</p> : null}
        {props.displayProjection?.error ? <div role="alert">
          <span>Display: {props.displayProjection.error}</span>
          <button type="button" disabled={props.displayProjection.refreshing} onClick={props.displayProjection.retry}
            title={props.t('textTransform.refresh')} aria-label={props.t('textTransform.refresh')}><RefreshCw size={16} aria-hidden="true" /></button>
        </div> : null}
        <Suspense fallback={<div aria-busy="true" className={styles.loading}><SkeletonText lines={5} /></div>}>
          {!props.busy && props.sessionReady === false ? (
            <p className={styles.empty} role="alert">{props.t('agent.sessionLoadFailed')}</p>
          ) : effectiveMessages.length === 0 && !props.busy ? (
            <p className={styles.empty}>{props.t('agent.sessionEmpty')}</p>
          ) : null}

          {renderItems.map((item) => {
            if (item.kind === 'tool-group') {
              return (
                <AgentToolGroupBlock
                  key={item.id}
                  label={item.label}
                  tools={item.tools}
                />
              )
            }
            if (item.kind === 'reasoning') {
              return (
                <AgentReasoningBlock
                  key={item.id}
                  duration={item.duration}
                  content={item.content}
                  label={props.t('agent.reasoning')}
                  isThinking={item.isThinking}
                />
              )
            }
            if (item.kind === 'message') {
              return (
                <AgentTranscriptEntry
                  agentSessionId={props.session?.id}
                  codeBlockLabels={codeBlockLabels}
                  content={item.content}
                  displayContent={displayText(props.displayProjection, item.id, item.content, item.isStreaming)}
                  copyState={copyState?.id === item.id ? copyState.copied : undefined}
                  index={item.index}
                  key={item.id}
                  message={item.message}
                  rendererHost={props.rendererHost}
                  role={item.role}
                  showChrome={item.showChrome}
                  isStreaming={item.isStreaming}
                  t={props.t}
                  onCopy={() => void copyMessage(item.message, item.content)}
                />
              )
            }
            return null
          })}

          {props.sessionTail ? (
            <div data-loom-surface="agent.session.tail">{props.sessionTail}</div>
          ) : null}
        </Suspense>
      </div>

      {approval ? (
        <div className={styles.mutationApprovalBackdrop} role="presentation">
          <section aria-label={approval.action ? '允许读取历史正文' : '确认资源修改'} className={styles.mutationApproval} role="dialog" aria-modal="true">
            <header className={styles.mutationApprovalHeader}>
              <div>
                <strong>{approval.action ? '允许读取历史正文' : '确认资源修改'}</strong>
                <span>{approval.action ? '仅授权本次请求，不修改剧情或记忆范围' : `${approval.preview.action} · ${approval.preview.path}`}</span>
              </div>
              <button
                aria-label="拒绝请求"
                className={styles.iconButton}
                type="button"
                onClick={() => {
                  props.onApproveMutation?.(false, approvalReason.trim() || undefined)
                  setApprovalReason('')
                }}
              >
                <X aria-hidden="true" />
              </button>
            </header>
            {approval.action ? (
              <div className={styles.mutationApprovalDiff}>
                <div>
                  <span>读取范围</span>
                  <pre>{[
                    `Timeline: ${approval.action.timelineId}`,
                    `Branch: ${approval.action.branchId}`,
                    approval.action.selection.kind === 'tail'
                      ? `最近 ${approval.action.selection.count} 个节点`
                      : `起点（不含）: ${approval.action.selection.afterNodeId ?? '分支开头'}`,
                    `终点（包含）: ${approval.action.selection.throughNodeId ?? '请求时固定的 Head'}`,
                    `最多 ${approval.action.maxNodes} 个节点，${approval.action.maxCharacters} 个字符`,
                  ].join('\n')}</pre>
                </div>
              </div>
            ) : <div className={styles.mutationApprovalDiff}>
              <div>
                <span>修改前</span>
                <pre>{approval.preview.before}</pre>
              </div>
              <div>
                <span>修改后</span>
                <pre>{approval.preview.after}</pre>
              </div>
            </div>}
            {approval.preview?.kind === 'state' && approval.preview.pointer ? (
              <code className={styles.mutationApprovalPointer}>{approval.preview.pointer}</code>
            ) : null}
            <input
              aria-label="拒绝原因（可选）"
              className={styles.mutationApprovalReason}
              placeholder="拒绝原因（可选）"
              value={approvalReason}
              onChange={event => setApprovalReason(event.target.value)}
            />
            <footer className={styles.mutationApprovalActions}>
              <button
                type="button"
                onClick={() => {
                  props.onApproveMutation?.(false, approvalReason.trim() || undefined)
                  setApprovalReason('')
                }}
              >
                拒绝
              </button>
              <button
                type="button"
                onClick={() => {
                  props.onApproveMutation?.(true)
                  setApprovalReason('')
                }}
              >
                允许
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      <footer className={styles.footer}>
        <ChatComposer
          canPreviewPrompt={false}
          canSend={Boolean(props.input.trim()) && !props.busy && !disconnected && !props.runRecoveryBusy && props.sessionReady !== false && Boolean(props.selectedProfileId)}
          sheet={recovery ? <RunRecoveryControls {...props} runRecovery={recovery} /> : undefined}
          input={props.input}
          moreLabel={props.t('composer.more')}
          placeholder={props.t('agent.composerPlaceholder')}
          previewLabel={props.t('composer.preview')}
          retryLabel={props.t('composer.retry')}
          sendLabel={props.t('agent.send')}
          pauseLabel={props.t('agent.run.pause')}
          resumeLabel={props.t('agent.run.resume')}
          runStatus={disconnected ? 'idle' : props.busy || props.activeRun?.status === 'running' ? 'running' : props.activeRun?.status === 'suspended' ? 'suspended' : 'idle'}
          onPause={props.onPauseRun}
          onResume={props.onResumeRun}
          sendLeadingAction={(
            <AgentPresetPicker
              disabled={props.busy}
              profiles={props.profiles}
              providers={props.providerAccounts}
              selectedId={props.selectedProfileId}
              t={props.t}
              onSelect={props.onSelectProfile}
            />
          )}
          textareaDisabled={(!disconnected && props.busy) || !props.selectedProfileId}
          textareaLabel={props.t('agent.composerLabel')}
          onChangeInput={props.onChangeInput}
          onPreviewPrompt={() => {}}
          onSubmit={event => {
            if (disconnected || props.runRecoveryBusy) { event.preventDefault(); return }
            props.onSubmit(event)
          }}
        />
      </footer>
    </div>
  )
}

/**
 * 统一 FLIP 展开收起容器组件
 * 遵循项目动画规范：cubic-bezier(0.2, 0, 0.2, 1)，优雅支持平滑展开与收起
 */
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

/**
 * 独立 AI 思考块 (ThinkingReasoning - aicss 规范体系)
 * 思考时实时展开、秒数计时并展现微光 Shimmer；思考完成后自动收拢折叠进 summary
 */
function AgentReasoningBlock(props: {
  label: string
  duration?: string
  content: string
  defaultOpen?: boolean
  isThinking?: boolean
  elapsedSeconds?: number
}) {
  const [open, setOpen] = useState(props.defaultOpen ?? false)
  const isThinking = props.isThinking ?? false
  const expanded = isThinking || open

  const sentences = useMemo(() => {
    return props.content.split(/(?<=[。！？.!?\n])\s*/).filter(Boolean)
  }, [props.content])

  return (
    <div className={styles.reasoningBlock}>
      <button
        type="button"
        className={styles.reasoningHeader}
        onClick={() => {
          if (!isThinking) setOpen(prev => !prev)
        }}
        aria-expanded={expanded}
      >
        <span className={isThinking ? styles.shimmer : styles.reasoningLabel}>
          {props.label}
        </span>
        {!isThinking && (
          <ChevronDown
            className={styles.reasoningChevron}
            style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
            aria-hidden="true"
          />
        )}
      </button>

      <div
        className={`${styles.trCollapsible} ${expanded ? '' : styles.isCollapsed}`}
        aria-hidden={!expanded}
        inert={!expanded}
      >
        <div className={styles.trInner}>
          <div className={styles.reasoningViewport}>
            {sentences.map((line, idx) => (
              <p key={idx} className={styles.reasoningSentence}>
                {line}
              </p>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * 单个工具操作条目
 * 展开后严格符合图 3：单层深色全宽卡片，无套娃，纯净等宽代码输出，右下角成功/失败状态
 */
function AgentToolActionItem(props: StepToolItem & { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(props.defaultOpen ?? false)

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
        onClick={() => setOpen(prev => !prev)}
        aria-expanded={open}
      >
        <span className={styles.toolItemIcon}>{renderIcon()}</span>
        <span className={styles.toolItemLabel}>{props.label}</span>
        {open ? (
          <ChevronDown className={styles.toolItemChevron} aria-hidden="true" />
        ) : (
          <ChevronRight className={styles.toolItemChevron} aria-hidden="true" />
        )}
      </button>

      <ToolCollapse open={open}>
        <div className={styles.toolDetailCard}>
          <span className={styles.toolDetailTag}>{props.detailTag || 'Shell'}</span>
          <pre className={styles.toolDetailCode}>{props.detailContent}</pre>
          <div
            className={styles.toolDetailFooter}
            data-status={props.status === 'error' ? 'error' : 'success'}
          >
            {props.status === 'error' ? (
              <>
                <AlertCircle aria-hidden="true" />
                <span>失败</span>
              </>
            ) : (
              <>
                <CheckCircle2 aria-hidden="true" />
                <span>成功</span>
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
function AgentToolGroupBlock(props: {
  label: string
  tools: StepToolItem[]
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(props.defaultOpen ?? false)

  return (
    <div className={styles.toolGroupBlock}>
      {props.tools.length > 1 ? <button
        type="button"
        className={styles.toolGroupHeader}
        onClick={() => setOpen(prev => !prev)}
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
              defaultOpen={index === 0 && props.defaultOpen}
            />
          ))}
        </div>
      </ToolCollapse>
    </div>
  )
}

function AgentTranscriptEntry(props: {
  agentSessionId?: string
  codeBlockLabels: MarkdownCodeBlockLabels
  content: string
  displayContent?: string
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
  const displayContent = props.displayContent ?? ''

  return (
    <article aria-busy={props.displayContent === undefined} className={`${styles.message} ${styles[props.role]}`}>
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
            <ConversationMarkdown
              className={styles.messageBody}
              codeBlockLabels={props.codeBlockLabels}
              role={props.role}
              value={displayContent}
              streaming={props.isStreaming}
            />
          </RendererNodeMountHost>
        ) : (
          <ConversationMarkdown
            className={styles.messageBody}
            codeBlockLabels={props.codeBlockLabels}
            role={props.role}
            value={displayContent}
            streaming={props.isStreaming}
          />
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
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const selected = props.profiles.find(profile => profile.id === props.selectedId)
  const selectedProvider = selected && props.providers.find(provider => provider.id === selected.model?.providerProfileId)

  return (
    <details className={styles.profilePicker} ref={detailsRef}>
      <summary
        aria-disabled={props.disabled}
        title={props.t('agent.profile.choose')}
        onClick={event => {
          if (props.disabled) event.preventDefault()
        }}
      >
        <span>{selected?.rootNode.label ?? props.t('agent.profile.unselected')}</span>
        <ChevronDown aria-hidden="true" />
      </summary>
      <div className={styles.profileMenu}>
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
                <strong>{profile.rootNode.label}</strong>
                <span>
                  {provider?.displayName ?? profile.model?.providerProfileId} · {profile.model?.modelId}
                </span>
              </button>
            )
          })
        )}
      </div>
    </details>
  )
}
