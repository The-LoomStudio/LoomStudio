import { useImperativeHandle, useLayoutEffect, useRef, type FormEvent, type ReactNode, type Ref } from 'react'
import { ArrowUp, Lock, MessageCircle, Pause, Play, Plus, RotateCcw, Swords, Unlock } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@loom-studio/ui'
import type { ChatComposerQuickAction } from '../../widgets/chat-composer/chat-composer.js'
import styles from './narrative-composer.module.scss'

export type NarrativeComposerProps = {
  input: string
  inputMode: 'roleplay' | 'discussion'
  inputRef?: Ref<HTMLTextAreaElement>
  onInputModeChange?(mode: 'roleplay' | 'discussion'): void
  onChangeInput(value: string): void
  onSubmit(event: FormEvent): void
  canSend: boolean
  disabled?: boolean
  presetControl?: ReactNode
  sheet?: ReactNode
  quickActions?: readonly ChatComposerQuickAction[]
  runStatus?: 'idle' | 'running' | 'suspended'
  onPause?(): void
  onResume?(): void
  onHeightChange?(height: number): void
  canRetry?: boolean
  onRetry?(): void
  canPreviewPrompt?: boolean
  onPreviewPrompt?(): void
  pinned?: boolean
  onTogglePinned?(): void
  moreLabel?: string
  retryLabel?: string
  previewLabel?: string
  pinLabel?: string
  unpinLabel?: string
  pauseLabel?: string
  resumeLabel?: string
}

/** Shared story input: presentation only; the caller owns drafts and execution. */
export function NarrativeComposer(props: NarrativeComposerProps) {
  const textarea = useRef<HTMLTextAreaElement>(null)
  const form = useRef<HTMLFormElement>(null)
  const composing = useRef(false)
  useImperativeHandle(props.inputRef, () => textarea.current!, [])
  useLayoutEffect(() => {
    const element = form.current
    if (!element || !props.onHeightChange) return
    let previous: number | undefined
    const report = () => {
      const height = Math.ceil(element.getBoundingClientRect().height)
      if (height === previous) return
      previous = height
      props.onHeightChange?.(height)
    }
    report()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(report)
    observer.observe(element)
    return () => observer.disconnect()
  }, [props.onHeightChange])

  const discussion = props.inputMode === 'discussion'
  const modeLabel = discussion ? '当前沟通，切换到扮演' : '当前扮演，切换到沟通'
  const running = props.runStatus === 'running'
  const suspended = props.runStatus === 'suspended'
  const canSubmit = props.canSend && !props.disabled && !running && !suspended
  return <form ref={form} className={styles.composer} data-loom-component="narrative-composer" data-input-mode={props.inputMode}
    onSubmit={event => { event.preventDefault(); if (canSubmit) props.onSubmit(event) }}>
    {props.sheet && <div className={styles.sheet} data-loom-surface="composer.sheet">{props.sheet}</div>}
    <textarea ref={textarea} aria-label={discussion ? '沟通输入' : '扮演输入'}
      placeholder={discussion ? '告诉 Agent 你想调整哪里……' : '你会怎么做？'} value={props.input} disabled={props.disabled}
      onChange={event => props.onChangeInput(event.target.value)}
      onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false }}
      onKeyDown={event => {
        if (event.key !== 'Enter' || event.shiftKey || composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return
        event.preventDefault()
        if (canSubmit) event.currentTarget.form?.requestSubmit()
      }} />
    <div className={styles.toolbar}>
      <div className={styles.tools}>
        <button className={styles.mode} type="button" aria-label={modeLabel} title={modeLabel} aria-pressed={discussion}
          disabled={!props.onInputModeChange} onClick={() => {
            props.onInputModeChange?.(discussion ? 'roleplay' : 'discussion')
            textarea.current?.focus()
          }}>{discussion ? <MessageCircle aria-hidden="true" /> : <Swords aria-hidden="true" />}<span>{discussion ? '沟通' : '扮演'}</span></button>
        {props.presetControl && <div className={styles.preset}>{props.presetControl}</div>}
        {props.quickActions?.length ? <DropdownMenu><DropdownMenuTrigger asChild>
          <button type="button" className={styles.utility} aria-label={props.moreLabel ?? '更多'} title={props.moreLabel ?? '更多'}><Plus aria-hidden="true" /></button>
        </DropdownMenuTrigger><DropdownMenuContent align="start" side="top">
          {props.quickActions.map(action => <DropdownMenuItem key={action.id} disabled={action.disabled} icon={action.icon} onSelect={action.onSelect}>{action.label}</DropdownMenuItem>)}
        </DropdownMenuContent></DropdownMenu> : null}
        {props.onRetry && <button type="button" className={styles.utility} aria-label={props.retryLabel ?? '重新尝试'} title={props.retryLabel ?? '重新尝试'} disabled={!props.canRetry} onClick={props.onRetry}><RotateCcw aria-hidden="true" /></button>}
        {props.onTogglePinned && <button type="button" className={styles.utility} aria-label={props.pinned ? props.unpinLabel ?? '取消固定' : props.pinLabel ?? '固定'} title={props.pinned ? props.unpinLabel ?? '取消固定' : props.pinLabel ?? '固定'} aria-pressed={props.pinned} onClick={props.onTogglePinned}>{props.pinned ? <Lock aria-hidden="true" /> : <Unlock aria-hidden="true" />}</button>}
      </div>
      <div className={styles.actions}>
        {props.onPreviewPrompt && <button type="button" className={styles.preview} disabled={!props.canPreviewPrompt} onClick={props.onPreviewPrompt}>{props.previewLabel ?? '预览'}</button>}
        <span className={styles.hint}>{running ? 'Agent 工作中' : suspended ? '已暂停' : 'Enter 发送'}</span>
        {running ? <button type="button" className={styles.send} aria-label={props.pauseLabel ?? '暂停'} title={props.pauseLabel ?? '暂停'} disabled={!props.onPause} onClick={props.onPause}><Pause aria-hidden="true" /></button>
          : suspended ? <button type="button" className={styles.send} aria-label={props.resumeLabel ?? '继续'} title={props.resumeLabel ?? '继续'} disabled={!props.onResume} onClick={props.onResume}><Play aria-hidden="true" /></button>
            : <button type="submit" className={styles.send} aria-label={discussion ? '发送沟通' : '发送扮演输入'} title={discussion ? '发送沟通' : '发送扮演输入'} disabled={!canSubmit}><ArrowUp aria-hidden="true" /></button>}
      </div>
    </div>
  </form>
}
