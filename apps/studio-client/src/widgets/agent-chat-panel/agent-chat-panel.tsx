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
  RotateCcw,
  Search,
  Terminal,
  X,
} from 'lucide-react'
import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
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
import type { ActiveAgentRun } from '../../features/narrative-runtime/model/use-narrative-runtime.js'
import { tryWriteClipboardText } from '../../shared/browser/clipboard.js'
import type { MarkdownCodeBlockLabels } from '../../shared/ui/markdown-content/markdown-code-block.js'
import { SkeletonText } from '@loom-studio/ui'
import {
  ConversationMessageAction,
  ConversationMessageChrome,
} from '../../shared/ui/conversation-message-chrome/conversation-message-chrome.js'
import { ChatComposer } from '../chat-composer/chat-composer.js'
import type { ClientRendererHost } from '../../shared/extension-renderer-runtime/client-renderer-host.js'
import { RendererNodeMountHost } from '../../features/extension-renderers/ui/renderer-node-mount-host.js'
import { useEffectiveMotion } from '../../shared/hooks/use-motion-preference.js'
import styles from './agent-chat-panel.module.scss'

const ConversationMarkdown = lazy(async () => {
  const module = await import('../../shared/ui/conversation-markdown/conversation-markdown.js')
  return { default: module.ConversationMarkdown }
})

// ponytail: [临时 Mock 测试数据，精准模拟多层各自成块：执行块 -> AI思考 -> 正文 -> 工具 -> AI思考 -> 工具 -> 正文]
const MOCK_AGENT_ENTRIES: AgentTranscriptEntryEntity[] = [
  {
    id: 'mock-msg-user-1',
    agentSessionId: 'mock-session',
    sequence: 1,
    createdAt: new Date(Date.now() - 60000).toISOString(),
    entry: {
      kind: 'message',
      role: 'user',
      content: '帮我检查当前夜之城的世界观设定，并将治安官阵营的好感度重置为初始状态。',
    },
  },
  {
    id: 'mock-tool-inv-1',
    agentSessionId: 'mock-session',
    sequence: 2,
    createdAt: new Date(Date.now() - 52000).toISOString(),
    entry: {
      kind: 'tool-invocation',
      invocationId: 'call_read_wb_01',
      toolId: 'read_worldbook_entry',
      exposedName: '读取世界书条目 夜之城世界观条目',
      status: 'completed',
      arguments: {
        entryTitle: '夜之城世界观条目',
        keys: ['夜之城', '治安官', '新都'],
      },
    },
  },
  {
    id: 'mock-tool-res-1',
    agentSessionId: 'mock-session',
    sequence: 3,
    createdAt: new Date(Date.now() - 50000).toISOString(),
    entry: {
      kind: 'tool-result',
      invocationId: 'call_read_wb_01',
      toolId: 'read_worldbook_entry',
      status: 'success',
      content: [
        {
          type: 'text',
          text: '$ 读取世界书条目 夜之城世界观条目 (read_worldbook_entry)\n{\n  "entryTitle": "夜之城世界观条目",\n  "keys": ["夜之城", "治安官", "新都"],\n  "status": "active"\n}\n已命中词条：阵营市政安全防卫部，基准好感度：50。',
        },
      ],
    },
  },
  {
    id: 'mock-tool-inv-2',
    agentSessionId: 'mock-session',
    sequence: 4,
    createdAt: new Date(Date.now() - 48000).toISOString(),
    entry: {
      kind: 'tool-invocation',
      invocationId: 'call_search_char_02',
      toolId: 'search_character_entities',
      exposedName: '在工作区搜索“治安官雷恩”',
      status: 'completed',
      arguments: {
        query: '治安官雷恩',
        scope: 'workspace',
      },
    },
  },
  {
    id: 'mock-tool-res-2',
    agentSessionId: 'mock-session',
    sequence: 5,
    createdAt: new Date(Date.now() - 46000).toISOString(),
    entry: {
      kind: 'tool-result',
      invocationId: 'call_search_char_02',
      toolId: 'search_character_entities',
      status: 'success',
      content: [
        {
          type: 'text',
          text: '$ search_character_entities\n{\n  "character": "char-sheriff-09",\n  "name": "治安官雷恩",\n  "boundVariable": "sheriff_affinity"\n}',
        },
      ],
    },
  },
  {
    id: 'mock-reasoning-1',
    agentSessionId: 'mock-session',
    sequence: 6,
    createdAt: new Date(Date.now() - 40000).toISOString(),
    entry: {
      kind: 'reasoning',
      content: '哥哥，我先检查是不是世界观冲突把治安官好感度拉低了。基准设定应该被尊重，只有明确配置或剧本冲突时才允许动态覆盖。',
    },
  },
  {
    id: 'mock-msg-assistant-interim',
    agentSessionId: 'mock-session',
    sequence: 7,
    createdAt: new Date(Date.now() - 35000).toISOString(),
    entry: {
      kind: 'message',
      role: 'assistant',
      content: '已检索到角色【治安官雷恩】（阵营：市政安全防卫部）。正在核查其在运行时的变量状态...',
    },
  },
  {
    id: 'mock-tool-inv-3',
    agentSessionId: 'mock-session',
    sequence: 8,
    createdAt: new Date(Date.now() - 30000).toISOString(),
    entry: {
      kind: 'tool-invocation',
      invocationId: 'call_run_script_03',
      toolId: 'run_runtime_check',
      exposedName: '运行校验脚本 check_runtime_affinity.js',
      status: 'completed',
      arguments: {
        script: 'check_runtime_affinity.js',
        target: 'sheriff_affinity',
      },
    },
  },
  {
    id: 'mock-tool-res-3',
    agentSessionId: 'mock-session',
    sequence: 9,
    createdAt: new Date(Date.now() - 28000).toISOString(),
    entry: {
      kind: 'tool-result',
      invocationId: 'call_run_script_03',
      toolId: 'run_runtime_check',
      status: 'success',
      content: [
        {
          type: 'text',
          text: '$ node check_affinity.js\n{\n  "pid": 32129,\n  "variable": "sheriff_affinity",\n  "current": 12,\n  "base": 50,\n  "status": "conflict"\n}',
        },
      ],
    },
  },
  {
    id: 'mock-reasoning-2',
    agentSessionId: 'mock-session',
    sequence: 10,
    createdAt: new Date(Date.now() - 20000).toISOString(),
    entry: {
      kind: 'reasoning',
      content: '没有找到要求好感度常驻为 12 的配置，但历史会话中存在冲突覆盖。我会重置为基准值 50，并在更新后同步状态。',
    },
  },
  {
    id: 'mock-tool-inv-4',
    agentSessionId: 'mock-session',
    sequence: 11,
    createdAt: new Date(Date.now() - 15000).toISOString(),
    entry: {
      kind: 'tool-invocation',
      invocationId: 'call_patch_vars_04',
      toolId: 'patch_runtime_variables',
      exposedName: '修改运行时变量 sheriff_affinity 从 12 重置为 50',
      status: 'completed',
      arguments: {
        scope: 'global',
        patches: [
          {
            key: 'sheriff_affinity',
            from: 12,
            to: 50,
            reason: '重置至基准好感度',
          },
        ],
      },
    },
  },
  {
    id: 'mock-tool-res-4',
    agentSessionId: 'mock-session',
    sequence: 12,
    createdAt: new Date(Date.now() - 12000).toISOString(),
    entry: {
      kind: 'tool-result',
      invocationId: 'call_patch_vars_04',
      toolId: 'patch_runtime_variables',
      status: 'success',
      content: [
        {
          type: 'text',
          text: '$ patch_runtime_variables\n{\n  "key": "sheriff_affinity",\n  "old": 12,\n  "new": 50,\n  "status": "applied"\n}',
        },
      ],
    },
  },
  {
    id: 'mock-msg-assistant-1',
    agentSessionId: 'mock-session',
    sequence: 13,
    createdAt: new Date(Date.now() - 10000).toISOString(),
    entry: {
      kind: 'message',
      role: 'assistant',
      content: `已为你检查夜之城世界观并完成变量重置：

### 1. 实体与词条核验
- **世界书词条**：\`夜之城世界观条目\`（已命中关键词：\`夜之城\`、\`治安官\`）
- **目标角色**：**治安官雷恩**（阵营：*市政安全防卫部*）
- **基准设定**：基准好感度常驻设定值为 \`50\`

### 2. 状态修补与同步代码
通过运行时补丁，已纠正历史会话遗留的冲突覆盖：

\`\`\`typescript
// 校验并同步治安官好感度设定
await runtime.patchVariables({
  scope: 'global',
  patches: [{
    key: 'sheriff_affinity',
    from: 12,
    to: 50,
    reason: 'reset_to_worldbook_base',
  }],
})
\`\`\`

> **提示**：全局变量 \`sheriff_affinity\` 现已成功恢复为 \`50\`。你可以在左侧工作台直接查看变动，或者随时告诉我接下来的剧本走向。`,
    },
  },
]

export const FINAL_ASSISTANT_CONTENT = (MOCK_AGENT_ENTRIES[12].entry as { content: string }).content

/**
 * 健壮补全未闭合的 Markdown 代码块标签，提前撑开 UI 骨架，杜绝布局跳动 (Layout Shift)
 */
export function patchIncompleteMarkdown(rawText: string): string {
  if (!rawText) return rawText
  let textToParse = rawText
  const codeBlockMatches = textToParse.match(/```/g) || []
  if (codeBlockMatches.length % 2 !== 0) {
    textToParse += '\n```'
  }
  return textToParse
}

export type StepToolItem = {
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
      artifactCard?: {
        title: string
        adds?: number
        removes?: number
      }
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

function buildRenderItems(
  entries: AgentTranscriptEntryEntity[],
  options?: {
    showFinalArtifact?: boolean
    isTypingFinal?: boolean
    activeReasoningId?: string
  },
): RenderItem[] {
  const showFinalArtifact = options?.showFinalArtifact ?? true
  const isTypingFinal = options?.isTypingFinal ?? false
  const activeReasoningId = options?.activeReasoningId

  const toolResultsByInvocationId = new Map<string, Record<string, unknown>>()
  for (const msg of entries) {
    if (msg.entry.kind === 'tool-result' && msg.entry.invocationId) {
      toolResultsByInvocationId.set(String(msg.entry.invocationId), msg.entry as Record<string, unknown>)
    }
  }

  const items: RenderItem[] = []
  let pendingTools: StepToolItem[] = []
  let messageIndex = 0

  const flushTools = (keyId: string) => {
    if (pendingTools.length === 0) return
    const toolCount = pendingTools.length
    const label = toolCount === 1 ? pendingTools[0].label : `已执行 ${toolCount} 个操作`
    items.push({
      kind: 'tool-group',
      id: `tool-group-${keyId}`,
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
            ? pairedResult.content.map((c: any) => c?.text || JSON.stringify(c)).join('\n')
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
      flushTools(msg.id)
      items.push({
        kind: 'reasoning',
        id: msg.id,
        duration: msg.id.includes('2') ? 'Thought for 9s' : 'Thought for 4s',
        content: entry.content,
        isThinking: activeReasoningId === msg.id,
      })
    } else if (entry.kind === 'message' && typeof entry.content === 'string') {
      const isAssistant = entry.role === 'assistant'
      const isFinalAssistant = msg.id === 'mock-msg-assistant-1'
      const isInterim = msg.id === 'mock-msg-assistant-interim'
      const isStreamingFinal = isFinalAssistant && isTypingFinal
      const artifactCard = (isFinalAssistant && showFinalArtifact)
        ? {
            title: '已更新变量 sheriff_affinity',
            adds: 1,
            removes: 1,
          }
        : undefined

      // 如果是 Assistant 消息，但内容纯空、非流式中且无产物卡片，说明是无输出中断，不建立空楼层
      if (isAssistant && !entry.content.trim() && !isStreamingFinal && !artifactCard) {
        continue
      }

      flushTools(msg.id)
      items.push({
        kind: 'message',
        id: msg.id,
        message: msg,
        role: isAssistant ? 'assistant' : 'user',
        content: entry.content,
        index: messageIndex++,
        showChrome: !isInterim && (!isFinalAssistant || !isTypingFinal),
        isStreaming: isStreamingFinal,
        artifactCard,
      })
    } else if (entry.kind === 'tool-result') {
      // 聚合至 tool-invocation
    }
  }

  flushTools('final')
  return items
}

export type AgentChatPanelProps = {
  busy: boolean
  activeRun?: ActiveAgentRun
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
  onCancelRun?(): void
  onPauseRun?(): void
  onResumeRun?(): void
  onApproveMutation?(allow: boolean, reason?: string): void
}

export function AgentChatPanel(props: AgentChatPanelProps) {
  const conversationRef = useRef<HTMLDivElement>(null)
  const [approvalReason, setApprovalReason] = useState('')
  const approval = props.activeRun?.approval
  const [copyState, setCopyState] = useState<{ id: string; copied: boolean }>()
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // ponytail: [流式模拟状态机：放慢节奏、真实秒数思考计时、高频字符平滑流式输出]
  const [mockVisibleIndex, setMockVisibleIndex] = useState(1)
  const [activeReasoningId, setActiveReasoningId] = useState<string | undefined>(undefined)
  const [thinkingSeconds, setThinkingSeconds] = useState(1)
  const [streamCharLength, setStreamCharLength] = useState(0)
  const isMockActive = props.messages.length === 0

  useEffect(() => {
    if (!isMockActive) return

    let cancelled = false
    const timerList: Array<ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>> = []

    const wait = (ms: number) => new Promise<void>(resolve => {
      const id = setTimeout(() => resolve(), ms)
      timerList.push(id)
    })

    const runSimulation = async () => {
      // 0. 初始停顿，展现响应开始
      await wait(600)
      if (cancelled) return

      // 1. 工具组 1 (读取世界书 + 搜索角色)
      setMockVisibleIndex(5)
      await wait(900)
      if (cancelled) return

      // 2. 思维链 1 启动：Thought for Xs 并开始秒数递增
      setMockVisibleIndex(6)
      setActiveReasoningId('mock-reasoning-1')
      setThinkingSeconds(1)

      const thinkTimer1 = setInterval(() => {
        setThinkingSeconds(s => s + 1)
      }, 950)
      timerList.push(thinkTimer1)

      // 持续沉静思考 3 秒
      await wait(3000)
      clearInterval(thinkTimer1)
      if (cancelled) return

      // 思维链 1 完成，就地收拢
      setActiveReasoningId(undefined)
      await wait(450)
      if (cancelled) return

      // 3. 中间正文汇报淡入
      setMockVisibleIndex(7)
      await wait(1000)
      if (cancelled) return

      // 4. 脚本校验工具 2 运行完成
      setMockVisibleIndex(9)
      await wait(900)
      if (cancelled) return

      // 5. 思维链 2 启动：Thought for Xs 并计时
      setMockVisibleIndex(10)
      setActiveReasoningId('mock-reasoning-2')
      setThinkingSeconds(1)

      const thinkTimer2 = setInterval(() => {
        setThinkingSeconds(s => s + 1)
      }, 950)
      timerList.push(thinkTimer2)

      // 思考持续 3 秒
      await wait(3000)
      clearInterval(thinkTimer2)
      if (cancelled) return

      // 思维链 2 完成，就地收拢
      setActiveReasoningId(undefined)
      await wait(450)
      if (cancelled) return

      // 6. 变量重置工具 3 运行完成
      setMockVisibleIndex(12)
      await wait(850)
      if (cancelled) return

      // 7. 最终正文汇报：高频微步流式出字（平滑如流水，绝无段落跳跃卡顿）
      setMockVisibleIndex(13)
      setStreamCharLength(0)

      let charIdx = 0
      const totalLen = FINAL_ASSISTANT_CONTENT.length

      await new Promise<void>(resolve => {
        const streamInterval = setInterval(() => {
          if (cancelled) {
            clearInterval(streamInterval)
            resolve()
            return
          }
          if (charIdx >= totalLen) {
            clearInterval(streamInterval)
            setStreamCharLength(totalLen)
            resolve()
            return
          }
          // 自然节奏推进 1~3 字符
          const step = charIdx < 20 ? 1 : Math.random() > 0.45 ? 3 : 2
          charIdx = Math.min(totalLen, charIdx + step)
          setStreamCharLength(charIdx)
        }, 28)
        timerList.push(streamInterval)
      })
    }

    void runSimulation()

    return () => {
      cancelled = true
      timerList.forEach(t => clearTimeout(t))
    }
  }, [isMockActive])

  const effectiveMessages = useMemo(() => {
    if (!isMockActive) return props.messages

    const sliced = MOCK_AGENT_ENTRIES.slice(0, mockVisibleIndex)
    if (mockVisibleIndex >= 13) {
      const finalMsg = MOCK_AGENT_ENTRIES[12]
      if (finalMsg && finalMsg.entry.kind === 'message') {
        const currentLen = streamCharLength > 0 ? streamCharLength : FINAL_ASSISTANT_CONTENT.length
        const currentText = FINAL_ASSISTANT_CONTENT.slice(0, currentLen)
        const updatedFinal: AgentTranscriptEntryEntity = {
          ...finalMsg,
          entry: {
            ...finalMsg.entry,
            content: currentText,
          },
        }
        return [...sliced.slice(0, 12), updatedFinal]
      }
    }
    return sliced
  }, [isMockActive, mockVisibleIndex, streamCharLength, props.messages])

  const isFinalDone = !isMockActive || streamCharLength >= FINAL_ASSISTANT_CONTENT.length
  const isTypingFinal = isMockActive && mockVisibleIndex >= 13 && !isFinalDone

  const renderItems = buildRenderItems(effectiveMessages, {
    showFinalArtifact: isFinalDone,
    isTypingFinal,
    activeReasoningId,
  })

  useEffect(() => () => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
  }, [])

  useEffect(() => {
    const conversation = conversationRef.current
    if (conversation) {
      conversation.scrollTop = conversation.scrollHeight
    }
  }, [effectiveMessages.length, streamCharLength])

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
                  defaultOpen={item.id.includes('call_read_wb_01') || item.id.includes('mock-tool-inv-1')}
                />
              )
            }
            if (item.kind === 'reasoning') {
              return (
                <AgentReasoningBlock
                  key={item.id}
                  duration={item.duration}
                  content={item.content}
                  isThinking={item.isThinking}
                  elapsedSeconds={item.isThinking ? thinkingSeconds : undefined}
                />
              )
            }
            if (item.kind === 'message') {
              return (
                <AgentTranscriptEntry
                  agentSessionId={props.session?.id}
                  codeBlockLabels={codeBlockLabels}
                  content={item.content}
                  copyState={copyState?.id === item.id ? copyState.copied : undefined}
                  index={item.index}
                  key={item.id}
                  message={item.message}
                  rendererHost={props.rendererHost}
                  role={item.role}
                  showChrome={item.showChrome}
                  isStreaming={item.isStreaming}
                  t={props.t}
                  artifactCard={item.artifactCard}
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
          <section aria-label="确认资源修改" className={styles.mutationApproval} role="dialog" aria-modal="true">
            <header className={styles.mutationApprovalHeader}>
              <div>
                <strong>确认资源修改</strong>
                <span>{approval.preview.action === 'patch' ? '局部 Patch' : '完整替换'} · {approval.preview.path}</span>
              </div>
              <button
                aria-label="拒绝修改"
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
            <div className={styles.mutationApprovalDiff}>
              <div>
                <span>修改前</span>
                <pre>{approval.preview.before}</pre>
              </div>
              <div>
                <span>修改后</span>
                <pre>{approval.preview.after}</pre>
              </div>
            </div>
            {approval.preview.kind === 'state' && approval.preview.pointer ? (
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
          canSend={Boolean(props.input.trim()) && !props.busy && props.sessionReady !== false && Boolean(props.selectedProfileId)}
          input={props.input}
          moreLabel={props.t('composer.more')}
          placeholder={props.t('agent.composerPlaceholder')}
          previewLabel={props.t('composer.preview')}
          retryLabel={props.t('composer.retry')}
          sendLabel={props.t('agent.send')}
          pauseLabel={props.t('agent.run.pause')}
          resumeLabel={props.t('agent.run.resume')}
          runStatus={props.busy || props.activeRun?.status === 'running' ? 'running' : props.activeRun?.status === 'suspended' ? 'suspended' : 'idle'}
          onPause={props.onPauseRun}
          onResume={props.onResumeRun}
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

/**
 * 统一 FLIP 展开收起容器组件
 * 遵循项目动画规范：cubic-bezier(0.2, 0, 0.2, 1)，优雅支持平滑展开与收起
 */
function FlipCollapse(props: {
  open: boolean
  className?: string
  children: ReactNode
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [rendered, setRendered] = useState(props.open)
  const effectiveMotion = useEffectiveMotion()
  const animationRef = useRef<Animation | null>(null)
  const isInitialMount = useRef(true)

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false
      return
    }

    const el = containerRef.current
    if (!el || effectiveMotion === 'reduce') {
      setRendered(props.open)
      return
    }

    animationRef.current?.cancel()

    if (props.open) {
      setRendered(true)
    } else {
      const currentHeight = el.getBoundingClientRect().height
      const anim = el.animate(
        [
          { height: `${currentHeight}px`, opacity: 1, overflow: 'hidden' },
          { height: '0px', opacity: 0, overflow: 'hidden' },
        ],
        {
          duration: 180,
          easing: 'cubic-bezier(0.2, 0, 0.2, 1)',
        },
      )
      animationRef.current = anim
      anim.finished
        .then(() => {
          if (animationRef.current === anim) {
            setRendered(false)
          }
        })
        .catch(() => {})
    }
  }, [props.open, effectiveMotion])

  useLayoutEffect(() => {
    if (isInitialMount.current || !props.open) return
    const el = containerRef.current
    if (!el || effectiveMotion === 'reduce') return

    const targetHeight = el.scrollHeight
    const anim = el.animate(
      [
        { height: '0px', opacity: 0, overflow: 'hidden' },
        { height: `${targetHeight}px`, opacity: 1, overflow: 'hidden' },
      ],
      {
        duration: 220,
        easing: 'cubic-bezier(0.2, 0, 0.2, 1)',
      },
    )
    animationRef.current = anim
    anim.finished
      .then(() => {
        if (animationRef.current === anim) {
          el.style.height = ''
          el.style.overflow = ''
        }
      })
      .catch(() => {})
  }, [props.open, rendered, effectiveMotion])

  if (!rendered && !props.open) {
    return null
  }

  return (
    <div ref={containerRef} className={props.className}>
      {props.children}
    </div>
  )
}

/**
 * 独立 AI 思考块 (ThinkingReasoning - aicss 规范体系)
 * 思考时实时展开、秒数计时并展现微光 Shimmer；思考完成后自动收拢折叠进 summary
 */
function AgentReasoningBlock(props: {
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
          Thought for {isThinking ? `${props.elapsedSeconds ? `${props.elapsedSeconds}s` : '1s'}` : (props.duration ? props.duration.replace(/^Thought\s+(for\s+)?/i, '') : '4s')}
        </span>
        {!isThinking && (
          <ChevronDown
            className={styles.reasoningChevron}
            style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
            aria-hidden="true"
          />
        )}
      </button>

      <div className={`${styles.trCollapsible} ${expanded ? '' : styles.isCollapsed}`}>
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

      <FlipCollapse open={open}>
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
      </FlipCollapse>
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

  if (props.tools.length === 1) {
    return (
      <div className={styles.toolGroupBlock}>
        <AgentToolActionItem {...props.tools[0]} defaultOpen={props.defaultOpen} />
      </div>
    )
  }

  return (
    <div className={styles.toolGroupBlock}>
      <button
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
      </button>

      <FlipCollapse open={open}>
        <div className={styles.toolGroupViewport}>
          {props.tools.map((tool, index) => (
            <AgentToolActionItem
              key={tool.id}
              {...tool}
              defaultOpen={index === 0 && props.defaultOpen}
            />
          ))}
        </div>
      </FlipCollapse>
    </div>
  )
}

function AgentArtifactSummaryCard(props: {
  title: string
  adds?: number
  removes?: number
  onUndo?: () => void
  onReview?: () => void
}) {
  const [status, setStatus] = useState<'idle' | 'undone' | 'reviewed'>('idle')

  return (
    <div className={styles.artifactSummaryCard}>
      <div className={styles.artifactInfo}>
        <div className={styles.artifactIconBox}>
          <FileCode aria-hidden="true" />
        </div>
        <div className={styles.artifactMeta}>
          <span className={styles.artifactTitle}>{props.title}</span>
          <div className={styles.artifactDiff}>
            {props.adds !== undefined && <span className={styles.diffAdd}>+{props.adds}</span>}
            {props.removes !== undefined && <span className={styles.diffRemove}>-{props.removes}</span>}
          </div>
        </div>
      </div>
      <div className={styles.artifactActions}>
        <button
          type="button"
          className={styles.artifactBtnUndo}
          onClick={() => {
            setStatus('undone')
            props.onUndo?.()
          }}
          disabled={status === 'undone'}
        >
          <RotateCcw aria-hidden="true" />
          <span>{status === 'undone' ? '已撤销' : '撤销'}</span>
        </button>
        <button
          type="button"
          className={styles.artifactBtnReview}
          onClick={() => {
            setStatus('reviewed')
            props.onReview?.()
          }}
        >
          {status === 'reviewed' ? '已审核' : '审核'}
        </button>
      </div>
    </div>
  )
}

function AgentTranscriptEntry(props: {
  agentSessionId?: string
  codeBlockLabels: MarkdownCodeBlockLabels
  content: string
  copyState?: boolean
  index: number
  isStreaming?: boolean
  message: AgentTranscriptEntryEntity
  rendererHost?: ClientRendererHost
  role: 'user' | 'assistant'
  showChrome?: boolean
  t: Translator
  artifactCard?: {
    title: string
    adds?: number
    removes?: number
  }
  onCopy(): void
}) {
  const displayContent = props.isStreaming
    ? patchIncompleteMarkdown(props.content)
    : props.content

  return (
    <article className={`${styles.message} ${styles[props.role]}`}>
      <div className={styles.messageSurface}>
        {props.rendererHost && props.agentSessionId ? (
          <RendererNodeMountHost
            agentSessionId={props.agentSessionId}
            host={props.rendererHost}
            messageId={props.message.id}
            rawText={displayContent}
            surface="agent-message"
          >
            <ConversationMarkdown
              className={styles.messageBody}
              codeBlockLabels={props.codeBlockLabels}
              role={props.role}
              value={displayContent}
            />
          </RendererNodeMountHost>
        ) : (
          <ConversationMarkdown
            className={styles.messageBody}
            codeBlockLabels={props.codeBlockLabels}
            role={props.role}
            value={displayContent}
          />
        )}
        {props.role === 'assistant' && props.artifactCard && (
          <AgentArtifactSummaryCard
            title={props.artifactCard.title}
            adds={props.artifactCard.adds}
            removes={props.artifactCard.removes}
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
