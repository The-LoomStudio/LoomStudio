import { ConversationMessageAction, ConversationMessageChrome } from '../../../shared/ui/conversation-message-chrome/conversation-message-chrome.js'
import { useCopyFeedback } from '../../../shared/hooks/use-copy-feedback.js'
import { AgentToolActionItem } from '../../sessions/ui/agent-tool-blocks.js'
import type { NarrativeSessionStep, NarrativeSessionExecution } from '../model/narrative-execution-view.js'
import { Fragment, useId, useState, type ReactNode } from 'react'
import { Check, Copy, ChevronRight, LoaderCircle, MessageCircle, Pause, Terminal } from 'lucide-react'
import { ConversationMarkdown } from '../../../shared/ui/conversation-markdown/conversation-markdown.js'

import base from './narrative-text.module.scss'
import styles from './narrative-execution-flow.module.scss'

const codeLabels = { copy: '复制', copied: '已复制', copyFailed: '复制失败', enableWrap: '自动换行', disableWrap: '关闭换行' }

function WorkDetail({ step, live, paused, onInspect, onReveal, followWork }: { step: NarrativeSessionStep; live: boolean; paused: boolean; onInspect?(): void; onReveal(): void; followWork?: boolean }) {
  const [choice, setChoice] = useState<boolean>()
  const open = choice ?? false
  const active = step.state === 'running'
  return <details className={styles.workDetail} data-work-step={step.id} data-work-live={live} open={open}>
    <summary aria-label={step.kind === 'thinking' ? `思考：${step.title}` : step.title} onClick={event => {
      event.preventDefault()
      setChoice(!open)
      if (!open) { onInspect?.(); onReveal() }
    }}>{active ? paused ? <Pause /> : <LoaderCircle className={styles.spin} /> : step.kind === 'thinking' ? null : <Terminal />}<span>{step.title}</span><ChevronRight /></summary>
    {step.kind === 'thinking' ? <p className={styles.reasoning}>{step.content}</p> : <pre>{step.content}</pre>}
  </details>
}

/** Execution details stay collapsed until the reader explicitly opens them. */
export function NarrativeExecutionFlow({ execution, reading, hideReplies = false, renderNarrative, onInspect, followWork, actions }: { execution: NarrativeSessionExecution; reading: boolean; actions?: ReactNode; hideReplies?: boolean; renderNarrative?(step: NarrativeSessionStep): ReactNode; onInspect?(): void; followWork?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const copy = useCopyFeedback()
  const id = useId()
  const working = execution.state === 'running' || execution.state === 'paused'
  const paused = execution.state === 'paused'
  const hasWork = execution.steps.some(step => step.kind === 'tool' || step.kind === 'thinking')
  const actionReplyIndex = execution.steps.findLastIndex(step => step.kind === 'reply' && step.role !== 'user' && !hideReplies && (!reading || step.presentation === 'question'))
  const toggle = () => { if (!expanded) onInspect?.(); setExpanded(value => !value) }
  return <div className={styles.flow} data-execution-state={execution.state} data-inset-work={!!renderNarrative}>
    {!reading && hasWork && <button type="button" className={styles.overview} aria-label="查看工作过程" aria-controls={id} aria-expanded={expanded} onClick={toggle}>
      <span>执行过程</span>
      <ChevronRight className={expanded ? styles.rotated : ''} />
    </button>}
    <div id={id} className={styles.sequence}>
      {execution.steps.map((step, index) => {
        const live = working && step.state === 'running'
        if (step.kind === 'tool' && step.tool) return !reading && expanded
          ? <div key={step.id} className={styles.toolDetail}><AgentToolActionItem {...step.tool} defaultOpen={false} onInspect={onInspect} /></div> : null
        if (step.kind === 'tool' || step.kind === 'thinking') return !reading && expanded ? <WorkDetail key={step.id} step={step} followWork={followWork} live={live} paused={paused} onInspect={onInspect} onReveal={() => setExpanded(true)} /> : null
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
          <ConversationMarkdown className={styles.replyContent} role={step.role ?? 'assistant'} value={step.content} codeBlockLabels={codeLabels} />
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
