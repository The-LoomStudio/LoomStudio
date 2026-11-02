import { UserInputEditor, type ReviseUserInput } from '../../attachments/user-input-editor.js'
import { MessageAttachments } from '../../attachments/message-attachments.js'
import { ConversationMessageAction, ConversationMessageChrome } from '../../../shared/ui/conversation-message-chrome/conversation-message-chrome.js'
import { useCopyFeedback } from '../../../shared/hooks/use-copy-feedback.js'
import type { NarrativeSessionExecution } from '../model/narrative-execution-view.js'
import { useLayoutEffect, useRef, useState, type SetStateAction } from 'react'
import { safeLocalStorage } from '../../../shared/browser/safe-local-storage.js'
import { Button, IconButton } from '@loom-studio/ui'
import { ArrowUp, CornerDownRight, Check, Copy, Pencil, RotateCcw } from 'lucide-react'
import { NarrativeExecutionFlow } from './narrative-execution-flow.js'

import styles from './narrative-communication.module.scss'


export function communicationMessageCount(candidate: { execution: NarrativeSessionExecution; discussions: NarrativeSessionExecution[] }): number {
  return candidate.execution.steps.filter(step => step.kind === 'reply').length + candidate.discussions.reduce((count, execution) => count + (execution.input ? 1 : 0) + execution.steps.filter(step => step.kind === 'reply').length, 0)
}

/** Expansion is user-owned; run progress and composer mode never change it. */
export function useCommunicationExpansion(_mode: 'roleplay' | 'discussion', keys: readonly string[], scope?: string) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const previousScope = useRef<string | undefined>(undefined)
  const storageKey = (key: string) => `loom:communication-expanded:v1:${JSON.stringify([scope, key])}`
  useLayoutEffect(() => {
    const changedScope = previousScope.current !== scope
    previousScope.current = scope
    setExpanded(previous => {
      const current = changedScope ? {} : previous
      const next = { ...current }
      for (const key of keys) {
        if (next[key] !== undefined || !scope) continue
        const stored = safeLocalStorage.getItem(storageKey(key))
        if (stored === 'true' || stored === 'false') next[key] = stored === 'true'
      }
      return Object.keys(next).length === Object.keys(current).length && Object.keys(next).every(key => next[key] === current[key]) ? current : next
    })
  }, [keys, scope])
  function update(action: SetStateAction<Record<string, boolean>>) {
    setExpanded(current => {
      const next = typeof action === 'function' ? action(current) : action
      if (scope) for (const [key, value] of Object.entries(next)) {
        if (current[key] !== value) safeLocalStorage.setItem(storageKey(key), String(value))
      }
      return next
    })
  }
  return [expanded, update] as const
}

/** Candidate-bound communication stays in the reading flow beneath its prose. */
export function NarrativeCommunication({ candidate, round, selected, onReply, onInspect, followWork, onRetryInput, onReviseInput, editRunning, onContinue, activeRunId, actionsDisabled, onSend }: {
  candidate: { execution: NarrativeSessionExecution; discussions: NarrativeSessionExecution[] }
  round: number
  selected?: number
  followWork?: boolean
  onInspect?(): void
  onReply?(): void
  onSend?(content: string): Promise<boolean>
  onReturnCurrent?(): void
  onRetryInput?(entryId: string, content: string): Promise<boolean>
  onContinue?(): Promise<boolean>
  onReviseInput?: ReviseUserInput
  editRunning?: boolean
  activeRunId?: string
  actionsDisabled?: boolean
}) {
  return <section className={styles.thread} data-communication-current={!!onReply} aria-label={round ? `第 ${round} 轮${selected === undefined ? '' : `候选 ${selected + 1}`}的创作沟通` : '创作准备沟通'}>
    <div className={styles.messages}>
      {candidate.execution.steps.length > 0 && <div className={styles.assistant} data-communication-role="assistant">
        <NarrativeExecutionFlow execution={candidate.execution} reading={false} followWork={followWork} onInspect={onInspect} />
      </div>}
      {candidate.discussions.map(execution => <CommunicationExchange key={execution.id} execution={execution} followWork={followWork} onInspect={onInspect}
        disabled={actionsDisabled} onReviseInput={onReviseInput} editRunning={editRunning} onRetryInput={onRetryInput} onContinue={execution.runId === activeRunId ? onContinue : undefined} />)}
      {communicationMessageCount(candidate) === 0 && candidate.execution.steps.length === 0 && <p className={styles.empty}>在这里讨论写法、提出修改，正文留在上方。</p>}
    </div>
    {onSend && <CommunicationInput onSend={onSend} disabled={actionsDisabled} />}
  </section>
}

function CommunicationInput({ onSend, disabled }: { onSend(content: string): Promise<boolean>; disabled?: boolean }) {
  const [value, setValue] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string>()
  const pending = useRef(false)
  async function send() {
    if (pending.current || disabled || !value.trim()) return
    pending.current = true
    setSending(true)
    setError(undefined)
    try {
      if (await onSend(value.trim())) setValue('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { pending.current = false; setSending(false) }
  }
  return <form className={styles.inlineReply} onSubmit={event => { event.preventDefault(); void send() }}>
    <CornerDownRight aria-hidden="true" />
    <textarea aria-label="继续与 Agent 对话" placeholder="继续与 Agent 对话…" rows={1} value={value} disabled={sending}
      onChange={event => setValue(event.target.value)} onKeyDown={event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send() }
      }} />
    <IconButton type="submit" aria-label="发送沟通" title="发送沟通" disabled={disabled || sending || !value.trim()}><ArrowUp aria-hidden="true" /></IconButton>
    {error && <p role="alert">{error}</p>}
  </form>
}

function CommunicationExchange({ execution, followWork, onInspect, onRetryInput, onReviseInput, editRunning, onContinue, disabled }: {
  execution: NarrativeSessionExecution
  onReviseInput?: ReviseUserInput
  editRunning?: boolean
  followWork?: boolean
  onInspect?(): void
  onRetryInput?(entryId: string, content: string): Promise<boolean>
  onContinue?(): Promise<boolean>
  disabled?: boolean
}) {
  const [draft, setDraft] = useState<{ content: string; width: number }>()
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const copy = useCopyFeedback()
  const [error, setError] = useState<string>()
  const editButton = useRef<HTMLButtonElement>(null)
  const bubble = useRef<HTMLParagraphElement>(null)
  const restoreFocus = useRef(false)
  useLayoutEffect(() => {
    if (draft === undefined && restoreFocus.current) { restoreFocus.current = false; editButton.current?.focus() }
  }, [draft])
  const canEdit = !!(execution.inputEntryId && execution.retryable && (onReviseInput || onRetryInput))
    && (!!onReviseInput || execution.state !== 'running' && !disabled)
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
    {(execution.input || execution.inputAttachments?.length) && <div className={styles.user} data-communication-role="user" style={draft ? { width: onReviseInput ? '100%' : draft.width } : undefined}>
      <span className={styles.speaker}>你{execution.interjectionStatus === 'discarded' ? ' · 未接入（已放弃）' : execution.interjectionStatus === 'pending' ? ' · 待接入' : ''}</span>
      {draft !== undefined && onReviseInput ? <UserInputEditor entryId={execution.inputEntryId!} content={execution.input ?? ''} attachments={execution.inputAttachments}
        pending={execution.interjectionStatus === 'pending'} blocked={!execution.retryable || execution.interjectionStatus !== 'pending' && editRunning} onSave={onReviseInput} onClose={cancel} /> : draft === undefined ? <p ref={bubble} className={styles.bubble}>{execution.input}</p> : <form className={styles.editor} onSubmit={event => {
        event.preventDefault()
        if (draft.content.trim() && draft.content !== execution.input) void retry(draft.content)
      }}>
        <textarea aria-label="编辑沟通输入" autoFocus value={draft.content} disabled={busy} onChange={event => setDraft({ ...draft, content: event.target.value })} onKeyDown={event => {
          if (event.key === 'Escape' && !busy) { event.preventDefault(); cancel() }
        }} />
        <div className={styles.actions}><Button size="small" disabled={busy} onClick={cancel}>取消</Button>
          <Button size="small" type="submit" disabled={busy || disabled || !draft.content.trim() || draft.content === execution.input}>保存并重试</Button></div>
      </form>}
      {draft === undefined && <MessageAttachments align="end" attachments={execution.inputAttachments} />}
      {draft === undefined && <ConversationMessageChrome actions={<>
        <ConversationMessageAction label={copy.feedback?.status === 'copied' ? '已复制' : copy.feedback?.status === 'failed' ? '复制失败，点击重试' : '复制输入'} onClick={() => { void copy.copy(execution.input!) }}>
          {copy.feedback?.status === 'copied' ? <Check /> : <Copy />}
        </ConversationMessageAction>
        {canEdit && <button ref={editButton} className={styles.messageAction} type="button" aria-label="编辑沟通输入" title="编辑后重试" disabled={busy} onClick={() => {
          onInspect?.()
          setDraft({ content: execution.input ?? '', width: bubble.current!.getBoundingClientRect().width })
        }}><Pencil /></button>}
      </>} />}
    </div>}
    <div className={styles.assistant} data-communication-role="assistant"><NarrativeExecutionFlow execution={execution} reading={false} followWork={followWork} onInspect={onInspect} actions={<>
      {execution.resumable && onContinue && <Button size="small" disabled={busy || disabled} onClick={() => { void retry('', true) }}>继续</Button>}
      {canEdit && execution.interjectionStatus !== 'pending' && onRetryInput && <ConversationMessageAction label="重试沟通" disabled={busy || disabled} onClick={() => { void retry(execution.input!) }}><RotateCcw /></ConversationMessageAction>}
    </>} /></div>
    {error && <p role="alert">{error}</p>}
  </div>
}
