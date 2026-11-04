import { AttachmentCards } from '../../features/attachments/attachment-cards.js'
import type { Translator } from '../../shared/i18n/index.js'
import { useLayoutEffect, useRef, useState, type FormEvent, type ReactNode, type Ref } from 'react'
import { ArrowUp, Lock, MessageCircle, Swords, Pause, Square, Play, Plus, Paperclip, RotateCcw, Unlock } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@loom-studio/ui'
import type { AttachmentComposerProps } from '../../features/attachments/use-attachment-drafts.js'
import styles from './chat-composer.module.scss'

export type ChatComposerQuickAction = {
  disabled?: boolean
  icon?: ReactNode
  id: string
  label: string
  onSelect(): void
}

type ChatComposerProps = AttachmentComposerProps & {
  t?: Translator
  inputMode?: 'roleplay' | 'discussion'
  onInputModeChange?(mode: 'roleplay' | 'discussion'): void
  inputRef?: Ref<HTMLTextAreaElement>
  canPreviewPrompt: boolean
  canSend: boolean
  input: string
  onChangeInput: (value: string) => void
  onHeightChange?: (height: number) => void
  onPreviewPrompt?: () => void
  quickActions?: readonly ChatComposerQuickAction[]
  onSubmit: (event: FormEvent) => void
  moreLabel: string
  pinLabel?: string
  pinned?: boolean
  placeholder?: string
  previewLabel: string
  retryLabel: string
  onRetry?(): void
  canRetry?: boolean
  sheet?: ReactNode
  sendLabel: string
  sendLeadingAction?: ReactNode
  textareaDisabled: boolean
  textareaLabel: string
  unpinLabel?: string
  runStatus?: 'idle' | 'running' | 'suspended'
  stopAction?: boolean
  resumeWithInput?: boolean
  onPause?: () => void
  onResume?: () => void
  pauseLabel?: string
  resumeLabel?: string
  onTogglePinned?: () => void
}

export function ChatComposer(props: ChatComposerProps) {
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const baseContentRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLFormElement>(null)
  const chromeHeightRef = useRef<number | undefined>(undefined)

  useLayoutEffect(() => {
    const composer = composerRef.current
    const baseContent = baseContentRef.current
    if (!composer || !baseContent || !props.onHeightChange) return

    let previousHeight = 0
    const reportHeight = () => {
      const baseHeight = Math.ceil(baseContent.getBoundingClientRect().height)
      chromeHeightRef.current ??= Math.max(0, Math.ceil(composer.getBoundingClientRect().height) - baseHeight)
      const height = baseHeight + chromeHeightRef.current
      if (height === previousHeight) return
      previousHeight = height
      props.onHeightChange?.(height)
    }

    reportHeight()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(reportHeight)
    observer.observe(baseContent)
    return () => observer.disconnect()
  }, [props.onHeightChange])

  return (
    <form className={styles.composer} data-loom-component="chat-composer" ref={composerRef} onSubmit={props.onSubmit}>
      <div className={styles.composerBody}>
        <div className={styles.inputSurface} data-loom-anchor="narrative-composer-surface" data-dragging={dragging || undefined}
          onDragOver={event => { if (props.onAddAttachments && Array.from(event.dataTransfer.types).includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDragging(true) } }}
          onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false) }}
          onDrop={event => { setDragging(false); if (props.onAddAttachments && event.dataTransfer.files.length) { event.preventDefault(); props.onAddAttachments(Array.from(event.dataTransfer.files)) } }}>
          {dragging ? <div className={styles.dropHint}>松开以上传文件</div> : null}
          {props.sheet ? <div className={styles.sheet} data-loom-surface="composer.sheet">{props.sheet}</div> : null}
          <div ref={baseContentRef} className={styles.baseContent} data-loom-anchor="narrative-composer-base">
            {props.attachments?.length ? <AttachmentCards singleRow items={props.attachments} onRemove={props.onRemoveAttachment} onRetry={props.onRetryAttachment} t={props.t} /> : null}
            {props.attachmentNotice ? <p className={styles.attachmentNotice} role="status">{props.attachmentNotice}</p> : null}
            {props.attachments?.some(item => !item.attachment) ? <p className={styles.attachmentNotice} role="status">{props.attachments.filter(item => item.error).length ? `还有 ${props.attachments.filter(item => item.error).length} 个附件上传失败，请重试或移除后发送。` : '附件正在上传，完成后可发送。'}</p> : null}
            <textarea
              data-autofocus=""
              onPaste={event => {
                const files = Array.from(event.clipboardData.files)
                if (!files.length || !props.onAddAttachments) return
                event.preventDefault()
                props.onAddAttachments(files)
                const text = event.clipboardData.getData('text/plain')
                if (text) {
                  const input = event.currentTarget
                  const start = input.selectionStart
                  props.onChangeInput(props.input.slice(0, start) + text + props.input.slice(input.selectionEnd))
                  requestAnimationFrame(() => input.setSelectionRange(start + text.length, start + text.length))
                }
              }}
              ref={props.inputRef}
              aria-label={props.textareaLabel}
              placeholder={props.placeholder}
              value={props.input}
              onChange={event => props.onChangeInput(event.target.value)}
              onKeyDown={props.inputMode ? event => {
                if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return
                event.preventDefault()
                if (props.canSend && !props.textareaDisabled && !(props.runStatus === 'suspended' && !props.input.trim() && !props.attachments?.length)) event.currentTarget.form?.requestSubmit()
              } : undefined}
              disabled={props.textareaDisabled}
            />
            <div className={styles.composerFooter}>
              <div className={styles.quickActions}>
                {props.onAddAttachments ? <input ref={fileRef} type="file" hidden multiple accept="image/png,image/jpeg,image/webp,image/gif,.md,.markdown,.txt" onChange={event => { props.onAddAttachments?.(Array.from(event.target.files ?? [])); event.target.value = '' }} /> : null}
                {props.inputMode ? (
                  <button
                    aria-label={props.inputMode === 'discussion' ? '当前沟通，切换到扮演' : '当前扮演，切换到沟通'}
                    aria-pressed={props.inputMode === 'discussion'}
                    className={styles.utilityButton}
                    title={props.inputMode === 'discussion' ? '当前沟通，切换到扮演' : '当前扮演，切换到沟通'}
                    type="button"
                    disabled={!props.onInputModeChange}
                    onClick={event => {
                      props.onInputModeChange?.(props.inputMode === 'discussion' ? 'roleplay' : 'discussion')
                      event.currentTarget.form?.querySelector('textarea')?.focus()
                    }}
                  >
                    {props.inputMode === 'discussion' ? <MessageCircle aria-hidden="true" strokeWidth={1.7} /> : <Swords aria-hidden="true" strokeWidth={1.7} />}
                  </button>
                ) : null}
                {props.onAddAttachments || props.quickActions?.length ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button aria-label={props.moreLabel} className={styles.utilityButton} title={props.moreLabel} type="button">
                        <Plus aria-hidden="true" strokeWidth={1.7} />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" side="top">
                      {props.onAddAttachments ? <DropdownMenuItem icon={<Paperclip aria-hidden="true" size={16} />} onSelect={() => fileRef.current?.click()}>上传文件</DropdownMenuItem> : null}
                      {props.quickActions?.map(action => (
                        <DropdownMenuItem disabled={action.disabled} icon={action.icon} key={action.id} onSelect={action.onSelect}>
                          {action.label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <button aria-label={props.moreLabel} className={styles.utilityButton} disabled title={props.moreLabel} type="button">
                    <Plus aria-hidden="true" strokeWidth={1.7} />
                  </button>
                )}
                {props.onRetry ? <button aria-label={props.retryLabel} className={styles.utilityButton} disabled={!props.canRetry || !props.onRetry} onClick={props.onRetry} title={props.retryLabel} type="button">
                  <RotateCcw aria-hidden="true" strokeWidth={1.7} />
                </button> : null}
                {props.onTogglePinned ? (
                  <button
                    aria-label={props.pinned ? (props.unpinLabel ?? 'Unpin') : (props.pinLabel ?? 'Pin')}
                    aria-pressed={props.pinned}
                    className={`${styles.utilityButton} ${props.pinned ? styles.pinnedActive : ''}`}
                    title={props.pinned ? (props.unpinLabel ?? 'Unpin') : (props.pinLabel ?? 'Pin')}
                    type="button"
                    onClick={props.onTogglePinned}
                  >
                    {props.pinned ? (
                      <Lock aria-hidden="true" strokeWidth={1.7} />
                    ) : (
                      <Unlock aria-hidden="true" strokeWidth={1.7} />
                    )}
                  </button>
                ) : null}
              </div>
              <div className={styles.composerActions}>
                {props.onPreviewPrompt ? (
                  <button
                    className={styles.previewButton}
                    onClick={props.onPreviewPrompt}
                    disabled={!props.canPreviewPrompt}
                    type="button"
                  >
                    {props.previewLabel}
                  </button>
                ) : null}
                {props.sendLeadingAction}
                {props.runStatus === 'running' && !props.input.trim() && !props.attachments?.length ? (
                  <button
                    aria-label={props.pauseLabel ?? 'Pause'}
                    className={styles.sendButton}
                    data-run="running"
                    type="button"
                    onClick={props.onPause}
                    title={props.pauseLabel ?? 'Pause'}
                  >
                    {props.stopAction ? <Square aria-hidden="true" strokeWidth={2} /> : <Pause aria-hidden="true" strokeWidth={2} />}
                  </button>
                ) : props.runStatus === 'suspended' && (props.resumeWithInput || !props.input.trim() && !props.attachments?.length) ? (
                  <button
                    aria-label={props.resumeLabel ?? 'Resume'}
                    className={styles.sendButton}
                    data-run="suspended"
                    type="button"
                    onClick={props.onResume}
                    title={props.resumeLabel ?? 'Resume'}
                  >
                    <Play aria-hidden="true" strokeWidth={2} style={{ marginLeft: 2 }} />
                  </button>
                ) : (
                  <button
                    aria-label={props.sendLabel}
                    className={styles.sendButton}
                    type="submit"
                    disabled={!props.canSend}
                    title={props.sendLabel}
                  >
                    <ArrowUp aria-hidden="true" absoluteStrokeWidth strokeWidth={1.7} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </form>
  )
}
