import type { ClientRendererHost } from '../../../shared/extension-renderer-runtime/client-renderer-host.js'
import { RendererNodeMountHost } from '../../extension-renderers/ui/renderer-node-mount-host.js'
import { displayText, type DisplayProjection } from '../../message-content/model/use-display-projection.js'
import { MessageContent } from '../../message-content/ui/message-content.js'
import { ConversationMessageAction, ConversationMessageChrome } from '../../../shared/ui/conversation-message-chrome/conversation-message-chrome.js'
import { useCopyFeedback } from '../../../shared/hooks/use-copy-feedback.js'
import { AgentToolActionItem, ToolCollapse } from '../../sessions/ui/agent-tool-blocks.js'
import { executionActivity, type NarrativeSessionStep, type NarrativeSessionExecution } from '../model/narrative-execution-view.js'
import { Fragment, useEffect, useId, useState, type ReactNode } from 'react'
import { Check, Copy, ChevronRight, LoaderCircle, MessageCircle, Pause, Terminal } from 'lucide-react'
import { StreamingViewport } from '../../../shared/ui/streaming-viewport/streaming-viewport.js'
import { ConversationMarkdown } from '../../../shared/ui/conversation-markdown/conversation-markdown.js'

import base from './narrative-text.module.scss'
import styles from './narrative-execution-flow.module.scss'

const codeLabels = { copy: '复制', copied: '已复制', copyFailed: '复制失败', enableWrap: '自动换行', disableWrap: '关闭换行' }

function WorkDetail({ step, live, paused, onInspect, onReveal }: { step: NarrativeSessionStep; live: boolean; paused: boolean; onInspect?(): void; onReveal(): void }) {
  const [choice, setChoice] = useState<boolean>()
  const open = choice ?? false
  const active = step.state === 'running'
  return <div className={styles.workDetail} data-work-step={step.id} data-work-live={live} data-open={open}>
    <button type="button" aria-expanded={open} aria-label={step.kind === 'thinking' ? `思考：${step.title}` : step.title} onClick={event => {
      event.preventDefault()
      setChoice(!open)
      if (!open) { onInspect?.(); onReveal() }
    }}>{active ? paused ? <Pause /> : <LoaderCircle className={styles.spin} /> : step.kind === 'thinking' ? null : <Terminal />}<span>{step.title}</span><ChevronRight /></button>
    <ToolCollapse open={open}>
    <StreamingViewport showLatest={false} label={step.kind === 'thinking' ? '思考内容' : '工具内容'} active={open} streaming={active && !paused} onInspect={onInspect}>
      {step.kind === 'thinking' ? <p className={styles.reasoning}>{step.content}</p> : <pre>{step.content}</pre>}
    </StreamingViewport>
    </ToolCollapse>
  </div>
}

/** Execution details stay collapsed until the reader explicitly opens them. */
export function NarrativeExecutionFlow({ rendererHost, agentSessionId, displayProjection, execution, connecting, reading, hideReplies = false, renderNarrative, onInspect, followWork = true, actions }: { rendererHost?: ClientRendererHost; agentSessionId?: string; displayProjection?: DisplayProjection; execution: NarrativeSessionExecution; connecting?: boolean; reading: boolean; actions?: ReactNode; hideReplies?: boolean; renderNarrative?(step: NarrativeSessionStep): ReactNode; onInspect?(): void; followWork?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (execution.runningSince === undefined) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [execution.runningSince])
  const elapsed = (execution.durationMs ?? 0) + (execution.runningSince === undefined ? 0 : Math.max(0, now - execution.runningSince))
  const seconds = Math.floor(elapsed / 1000)
  const duration = seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${String(seconds % 60).padStart(2, '0')} 秒`
  const copy = useCopyFeedback()
  const id = useId()
  const working = execution.state === 'running' || execution.state === 'paused'
  const activity = connecting ? '正在连接' : working ? executionActivity(execution) : undefined
  const paused = execution.state === 'paused'
  const hasWork = execution.steps.some(step => step.kind === 'tool' || step.kind === 'thinking')
  const actionReplyIndex = execution.steps.findLastIndex(step => step.kind === 'reply' && step.role !== 'user' && !hideReplies && (!reading || step.presentation === 'question'))
  const toggle = () => { if (!expanded) onInspect?.(); setExpanded(value => !value) }
  return <div className={styles.flow} data-execution-state={execution.state} data-inset-work={!!renderNarrative}>
    {!reading && (hasWork || activity) && <button type="button" className={styles.overview} aria-label="查看工作过程" aria-controls={id} aria-expanded={expanded} onClick={toggle}>
      <span>已工作 {duration}</span>
      {activity && <span role="status">{activity}</span>}
      <ChevronRight className={expanded ? styles.rotated : ''} />
    </button>}
    <div id={id} className={styles.sequence}>
      {execution.steps.map((step, index) => {
        const live = working && step.state === 'running'
        if (step.kind === 'tool' && step.tool) return !reading
          ? <ToolCollapse key={step.id} open={expanded} className={styles.toolDetail}><div><AgentToolActionItem {...step.tool} followWork={followWork} defaultOpen={false} onInspect={onInspect} /></div></ToolCollapse> : null
        if (step.kind === 'tool' || step.kind === 'thinking') return !reading ? <ToolCollapse key={step.id} open={expanded} className={styles.workCollapse}><WorkDetail step={step} live={live} paused={paused} onInspect={onInspect} onReveal={() => setExpanded(true)} /></ToolCollapse> : null
        if (step.kind === 'narrative' && renderNarrative) {
          const content = renderNarrative(step)
          if (content !== undefined) return <Fragment key={step.id}>{content}</Fragment>
        }
        if (step.kind === 'narrative') return <article key={step.id} className={base.narrative} aria-label="剧情正文" aria-busy={step.state === 'running'}>
          <ConversationMarkdown role="assistant" value={step.content} codeBlockLabels={codeLabels} />
        </article>
        if (hideReplies) return null
        const question = step.presentation === 'question'
        if (reading && !question) return null
        const text = displayText(displayProjection, step.id, step.content, step.state === 'running') ?? ''
        const body = <MessageContent className={styles.replyContent} role={step.role ?? 'assistant'}
          value={text} streaming={step.state === 'running'} codeBlockLabels={codeLabels} />
        return <section key={step.id} className={styles.reply} aria-label={step.role === 'user' ? '创作指导' : question ? 'Agent 询问' : 'Agent 回复'} data-message-role={step.role ?? 'assistant'}>
          {(question || step.role === 'user') && <div className={styles.replyHeading}><MessageCircle /><span>{step.role === 'user' ? '创作指导' : '创作讨论'}</span></div>}
          {rendererHost && agentSessionId ? <RendererNodeMountHost host={rendererHost}
            surface="agent-message" agentSessionId={agentSessionId} messageId={step.id}
            rawText={step.content} displayText={text}>{body}</RendererNodeMountHost> : body}
          <ConversationMessageChrome actions={<><ConversationMessageAction
            label={copy.feedback?.id === step.id ? copy.feedback.status === 'copied' ? '已复制' : '复制失败，点击重试' : '复制回复'}
            onClick={() => { void copy.copy(step.content, step.id) }}>
            {copy.feedback?.id === step.id && copy.feedback.status === 'copied' ? <Check /> : <Copy />}
          </ConversationMessageAction>{index === actionReplyIndex ? actions : null}</>} />
        </section>
      })}
    </div>
    {actionReplyIndex === -1 && actions && <ConversationMessageChrome actions={actions} />}
  </div>
}
