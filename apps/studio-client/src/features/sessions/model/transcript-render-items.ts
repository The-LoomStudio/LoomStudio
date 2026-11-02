import type { AgentTranscriptEntry as AgentTranscriptEntryEntity } from '../../../entities/index.js'
type SessionActiveRun = { runId: string; status: string }
export type StepToolItem = {
  id: string
  iconType: 'file' | 'search' | 'web' | 'terminal' | 'edit'
  label: string
  inputs: Array<{ label: string; content: string }>
  resultContent?: string
  errorContent?: string
  status?: 'success' | 'error' | 'running' | 'preparing' | 'interrupted'
}

export type RenderItem =
  | { kind: 'summary'; id: string; label: string; content: string }

  | {
      kind: 'message'
      id: string
      message: AgentTranscriptEntryEntity
      role: 'user' | 'assistant'
      content: string
      index: number
      interjectionStatus?: 'pending' | 'applied' | 'discarded'
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
      isStreaming: boolean
    }

export function buildRenderItems(entries: AgentTranscriptEntryEntity[], activeRun?: SessionActiveRun): RenderItem[] {
  const runStates = new Map<string, string>()
  let latestRunId: string | undefined
  for (const message of entries) {
    if (message.runId && message.entry.kind === 'run-state') {
      runStates.set(message.runId, message.entry.state)
      latestRunId = message.runId
    }
  }
  if (activeRun) {
    runStates.set(activeRun.runId, activeRun.status)
    latestRunId = activeRun.runId
  }

  const toolResultsByInvocationId = new Map<string, Extract<AgentTranscriptEntryEntity['entry'], { kind: 'tool-result' }>>()
  for (const msg of entries) {
    if (msg.entry.kind === 'tool-result') {
      toolResultsByInvocationId.set(msg.entry.invocationId, msg.entry)
    }
  }

  const discarded = new Set(entries.flatMap(item => item.entry.kind === 'interjection-discarded' ? [item.entry.requestId] : []))
  const applied = new Set(entries.flatMap(item => item.entry.kind === 'interjection-applied' ? [item.entry.requestId] : []))
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

    if (entry.kind === 'user-interjection') {
      if (entry.withdrawn) continue;
      if (entries.some(item => item.entry.kind === 'message' && item.entry.interjectionRequestId === entry.requestId)) continue
      flushTools()
      items.push({ kind: 'message', id: msg.id, message: msg, role: 'user', content: entry.content, index: messageIndex++, interjectionStatus: discarded.has(entry.requestId) ? 'discarded' : applied.has(entry.requestId) ? 'applied' : 'pending' })
    } else if (entry.kind === 'work-summary') {
      flushTools()
      items.push({ kind: 'summary', id: msg.id, label: '已保存交接摘要', content: entry.content })
    } else if (entry.kind === 'tool-input') {
      const interrupted = entry.status === 'interrupted' || Boolean(msg.runId && runStates.has(msg.runId)
        && (runStates.get(msg.runId) !== 'running' || msg.runId !== latestRunId))
      pendingTools.push({
        id: msg.id, iconType: 'terminal',
        label: `${entry.exposedName ?? '工具调用'} · ${interrupted ? '参数生成已中断，尚未执行' : '正在准备参数'}`,
        inputs: [{ label: '参数草稿', content: entry.rawInput }],
        status: interrupted ? 'interrupted' : 'preparing',
      })
    } else if (entry.kind === 'tool-invocation') {
      const toolId = entry.toolId
      const exposedName = entry.exposedName || entry.toolId || '执行工具'
      const invocationId = entry.invocationId
      const pairedResult = toolResultsByInvocationId.get(invocationId)

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
        if (toolId.includes('codeact') && typeof entry.arguments.code === 'string') {
          const { code, ...parameters } = entry.arguments
          inputs.push({ label: '代码', content: code })
          if (Object.keys(parameters).length) inputs.push({ label: '参数', content: JSON.stringify(parameters, null, 2) })
        } else inputs.push({ label: '参数', content: JSON.stringify(entry.arguments, null, 2) })
      }
      if (entry.rawInput !== undefined) {
        inputs.push({
          label: toolId.includes('codeact') ? '代码' : '输入',
          content: entry.rawInput,
        })
      }
      if (!inputs.length) inputs.push({ label: '调用', content: '未记录调用内容' })

      const resultContent = pairedResult?.content.map(part => part.type === 'text' && part.text ? part.text : JSON.stringify(part)).join('\n')
      const error = pairedResult?.error
      const errorContent = error ? [error.code, error.message].filter(Boolean).join(': ') : undefined

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
    } else if (entry.kind === 'reasoning') {
      flushTools()
      items.push({
        kind: 'reasoning',
        id: msg.presentationId ?? msg.id,
        content: entry.content,
        isStreaming: msg.id.startsWith('streaming-reasoning-') && entry.state !== 'completed' && activeRun?.runId === msg.runId && activeRun?.status === 'running',
      })
    } else if (entry.kind === 'message') {
      const isAssistant = entry.role === 'assistant'
      const isStreamingFinal = entry.state === 'partial' && (!activeRun || activeRun.runId === msg.runId && activeRun.status === 'running')

      // 如果是 Assistant 消息，但内容纯空、非流式中且无产物卡片，说明是无输出中断，不建立空楼层
      if (isAssistant && !entry.content.trim() && !isStreamingFinal) {
        continue
      }

      flushTools()
      items.push({
        kind: 'message',
        id: msg.presentationId ?? msg.id,
        message: msg,
        role: isAssistant ? 'assistant' : 'user',
        content: entry.content,
        index: messageIndex++,
        interjectionStatus: entry.interjectionRequestId ? 'applied' : undefined,
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

