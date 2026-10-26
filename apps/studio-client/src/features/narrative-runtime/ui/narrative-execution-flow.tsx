import type { NarrativeSessionStep, NarrativeSessionExecution } from '../model/narrative-execution-view.js'
import { StreamingViewport } from '../../../shared/ui/streaming-viewport/streaming-viewport.js'
import { Fragment, useId, useState, type ReactNode } from 'react'
import { Brain, ChevronRight, LoaderCircle, MessageCircle, Pause, Terminal } from 'lucide-react'
import { ConversationMarkdown } from '../../../shared/ui/conversation-markdown/conversation-markdown.js'

import base from './narrative-text.module.scss'
import styles from './narrative-execution-flow.module.scss'

const codeLabels = { copy: '复制', copied: '已复制', copyFailed: '复制失败', enableWrap: '自动换行', disableWrap: '关闭换行' }

function WorkDetail({ step, live, paused, onInspect, onReveal, followWork }: { step: NarrativeSessionStep; live: boolean; paused: boolean; onInspect?(): void; onReveal(): void; followWork?: boolean }) {
  const [choice, setChoice] = useState<boolean>()
  const open = choice ?? (live && (step.kind === 'thinking' || followWork === true))
  const active = step.state === 'running'
  return <details className={styles.workDetail} data-work-step={step.id} data-work-live={live} open={open}>
    <summary aria-label={step.kind === 'thinking' ? `思考：${step.title}` : step.title} onClick={event => {
      event.preventDefault()
      setChoice(!open)
      if (!open) { onInspect?.(); onReveal() }
    }}>{active ? paused ? <Pause /> : <LoaderCircle className={styles.spin} /> : step.kind === 'thinking' ? <Brain /> : <Terminal />}<span>{step.title}</span><ChevronRight /></summary>
    {followWork ? <StreamingViewport label={step.kind === 'thinking' ? '思考内容' : '工具详情'} active={open} onInspect={() => { setChoice(true); onInspect?.(); onReveal() }}>
      {step.kind === 'thinking' ? <p className={styles.reasoning}>{step.content}</p> : <pre>{step.content}</pre>}
    </StreamingViewport> : step.kind === 'thinking' ? <p className={styles.reasoning}>{step.content}</p> : <pre>{step.content}</pre>}
  </details>
}

/** Live work is visible; output turns earlier work into one quiet disclosure. */
export function NarrativeExecutionFlow({ execution, reading, hideReplies = false, renderNarrative, onInspect, followWork }: { execution: NarrativeSessionExecution; reading: boolean; hideReplies?: boolean; renderNarrative?(step: NarrativeSessionStep): ReactNode; onInspect?(): void; followWork?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const id = useId()
  const working = execution.state === 'running' || execution.state === 'paused'
  const paused = execution.state === 'paused'
  const tools = execution.steps.filter(step => step.kind === 'tool').length
  const thought = execution.steps.some(step => step.kind === 'thinking')
  const hasWork = tools > 0 || thought
  const lastSettledOutput = execution.steps.findLastIndex(step => (step.kind === 'narrative' || step.kind === 'reply') && step.state === 'completed')
  const hasHistory = execution.steps.some((step, index) => (step.kind === 'thinking' || step.kind === 'tool') && (!working || index < lastSettledOutput))
  const summary = [thought ? '思考' : '', tools ? `${tools} 个工具` : ''].filter(Boolean).join(' · ')
  const toggle = () => { if (!expanded) onInspect?.(); setExpanded(value => !value) }
  return <div className={styles.flow} data-execution-state={execution.state}>
    {!reading && hasWork && (hasHistory || expanded) && <button type="button" className={styles.overview} aria-label="查看工作过程" aria-controls={id} aria-expanded={expanded} onClick={toggle}>
      <span>{summary}</span>
      <ChevronRight className={expanded ? styles.rotated : ''} />
    </button>}
    <div id={id} className={styles.sequence}>
      {execution.steps.map((step, index) => {
        const live = working && index > lastSettledOutput
        if (step.kind === 'tool' || step.kind === 'thinking') return !reading && (expanded || live) ? <WorkDetail key={step.id} step={step} followWork={followWork} live={live} paused={paused} onInspect={onInspect} onReveal={() => setExpanded(true)} /> : null
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
        return <section key={step.id} className={styles.reply} aria-label={step.role === 'user' ? '创作指导' : question ? 'Agent 询问' : 'Agent 回复'} data-message-role={step.role ?? 'assistant'}>
          {(question || step.role === 'user') && <div className={styles.replyHeading}><MessageCircle /><span>{step.role === 'user' ? '创作指导' : '创作讨论'}</span></div>}
          <ConversationMarkdown role={step.role ?? 'assistant'} value={step.content} codeBlockLabels={codeLabels} />
        </section>
      })}
    </div>
    {execution.failures?.map(failure => <p key={failure.id} className={styles.failure} role="status">请求失败：{failure.message}</p>)}
    {execution.error && !execution.failures?.some(failure => failure.message === execution.error)
      && execution.state !== 'completed' && <p className={styles.failure} role="status">{execution.error}</p>}
    {execution.state === 'paused' && <p className={styles.status}>执行已暂停，可以继续。</p>}
    {execution.state === 'failed' && !execution.error && !execution.failures?.length && <p className={styles.failure} role="status">执行失败。</p>}
    {execution.state === 'cancelled' && <p className={styles.status}>执行已结束。</p>}
  </div>
}
