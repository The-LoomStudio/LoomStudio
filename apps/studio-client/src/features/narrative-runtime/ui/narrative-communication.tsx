import type { NarrativeSessionExecution } from '../model/narrative-execution-view.js'
import { useLayoutEffect, useRef, useState } from 'react'
import { Button } from '@loom-studio/ui'
import { Pencil, RotateCcw } from 'lucide-react'
import { ConversationMarkdown } from '../../../shared/ui/conversation-markdown/conversation-markdown.js'
import { NarrativeExecutionFlow } from './narrative-execution-flow.js'

import styles from './narrative-communication.module.scss'

const codeLabels = { copy: '复制', copied: '已复制', copyFailed: '复制失败', enableWrap: '自动换行', disableWrap: '关闭换行' }

export function communicationMessageCount(candidate: { execution: NarrativeSessionExecution; discussions: NarrativeSessionExecution[] }): number {
  return candidate.execution.steps.filter(step => step.kind === 'reply').length + candidate.discussions.reduce((count, execution) => count + (execution.input ? 1 : 0) + execution.steps.filter(step => step.kind === 'reply').length, 0)
}

/** Mode changes reveal or collapse threads; later manual choices remain independent. */
export function useCommunicationExpansion(mode: 'roleplay' | 'discussion', keys: readonly string[]) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const previousMode = useRef(mode)
  useLayoutEffect(() => {
    const entering = previousMode.current !== mode
    previousMode.current = mode
    if (mode === 'roleplay') {
      if (entering) setExpanded({})
      return
    }
    setExpanded(current => {
      let next = current
      for (const key of keys) if (entering || current[key] === undefined) {
        if (next === current) next = { ...current }
        next[key] = true
      }
      return next
    })
  }, [mode, keys])
  return [expanded, setExpanded] as const
}

/** Candidate-bound communication stays in the reading flow beneath its prose. */
export function NarrativeCommunication({ candidate, round, selected, onReply, onReturnCurrent, onInspect, followWork, onRetryInput, onContinue, activeRunId, actionsDisabled }: {
  candidate: { execution: NarrativeSessionExecution; discussions: NarrativeSessionExecution[] }
  round: number
  selected?: number
  followWork?: boolean
  onInspect?(): void
  onReply?(): void
  onReturnCurrent?(): void
  onRetryInput?(entryId: string, content: string): Promise<boolean>
  onContinue?(): Promise<boolean>
  activeRunId?: string
  actionsDisabled?: boolean
}) {
  return <section className={styles.thread} data-communication-current={!!onReply} aria-label={round ? `第 ${round} 轮${selected === undefined ? '' : `候选 ${selected + 1}`}的创作沟通` : '创作准备沟通'}>
    <div className={styles.messages}>
      {candidate.execution.steps.filter(step => step.kind === 'reply').map(step => <div key={step.id} className={step.role === 'user' ? styles.user : styles.assistant} data-communication-role={step.role ?? 'assistant'}>
        <span className={styles.speaker}>{step.role === 'user' ? '你' : 'Agent'}</span>
        <ConversationMarkdown className={step.role === 'user' ? styles.bubble : undefined} role={step.role ?? 'assistant'} value={step.content} codeBlockLabels={codeLabels} />
      </div>)}
      {candidate.discussions.map(execution => <CommunicationExchange key={execution.id} execution={execution} followWork={followWork} onInspect={onInspect}
        disabled={actionsDisabled} onRetryInput={onRetryInput} onContinue={execution.runId === activeRunId ? onContinue : undefined} />)}
      {communicationMessageCount(candidate) === 0 && <p className={styles.empty}>在这里讨论写法、提出修改，正文留在上方。</p>}
    </div>
    {(onReply || onReturnCurrent) && <div className={styles.actions}>
      {onReturnCurrent ? <Button size="small" onClick={onReturnCurrent}>回到当前轮</Button> : <Button size="small" onClick={onReply}>回复</Button>}
    </div>}
  </section>
}

function CommunicationExchange({ execution, followWork, onInspect, onRetryInput, onContinue, disabled }: {
  execution: NarrativeSessionExecution
  followWork?: boolean
  onInspect?(): void
  onRetryInput?(entryId: string, content: string): Promise<boolean>
  onContinue?(): Promise<boolean>
  disabled?: boolean
}) {
  const [draft, setDraft] = useState<{ content: string; width: number }>()
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const [error, setError] = useState<string>()
  const editButton = useRef<HTMLButtonElement>(null)
  const bubble = useRef<HTMLParagraphElement>(null)
  const restoreFocus = useRef(false)
  useLayoutEffect(() => {
    if (draft === undefined && restoreFocus.current) { restoreFocus.current = false; editButton.current?.focus() }
  }, [draft])
  const canEdit = !!(execution.inputEntryId && execution.retryable && onRetryInput)
  const cancel = () => { restoreFocus.current = true; setDraft(undefined); setError(undefined) }
  const retry = async (content: string, continuing = false) => {
    if (pending.current || disabled) return
    pending.current = true
    setBusy(true)
    setError(undefined)
    try {
      const accepted = continuing ? await onContinue?.() : await onRetryInput?.(execution.inputEntryId!, content)
      if (accepted) cancel()
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { pending.current = false; setBusy(false) }
  }
  return <div className={styles.exchange}>
    {execution.input && <div className={styles.user} data-communication-role="user" style={draft ? { width: draft.width } : undefined}>
      <span className={styles.speaker}>你</span>
      {draft === undefined ? <p ref={bubble} className={styles.bubble}>{execution.input}</p> : <form className={styles.editor} onSubmit={event => {
        event.preventDefault()
        if (draft.content.trim() && draft.content !== execution.input) void retry(draft.content)
      }}>
        <textarea aria-label="编辑沟通输入" autoFocus value={draft.content} disabled={busy} onChange={event => setDraft({ ...draft, content: event.target.value })} onKeyDown={event => {
          if (event.key === 'Escape' && !busy) { event.preventDefault(); cancel() }
        }} />
        <div className={styles.actions}><Button size="small" disabled={busy} onClick={cancel}>取消</Button>
          <Button size="small" type="submit" disabled={busy || disabled || !draft.content.trim() || draft.content === execution.input}>保存并重试</Button></div>
      </form>}
      {canEdit && draft === undefined && <div className={styles.actions}>
        <button ref={editButton} type="button" aria-label="编辑沟通输入" title="编辑后重试" disabled={busy || disabled} onClick={() => {
          onInspect?.()
          setDraft({ content: execution.input!, width: bubble.current!.getBoundingClientRect().width })
        }}><Pencil /></button>
      </div>}
    </div>}
    <div className={styles.assistant} data-communication-role="assistant"><span className={styles.speaker}>Agent</span><NarrativeExecutionFlow execution={execution} reading={false} followWork={followWork} onInspect={onInspect} /></div>
    <div className={styles.actions}>
      {execution.resumable && onContinue && <Button size="small" disabled={busy || disabled} onClick={() => { void retry('', true) }}>继续</Button>}
      {canEdit && <button type="button" aria-label="重试沟通" title="重试这次沟通" disabled={busy || disabled} onClick={() => { void retry(execution.input!) }}><RotateCcw /></button>}
    </div>
    {error && <p role="alert">{error}</p>}
  </div>
}
