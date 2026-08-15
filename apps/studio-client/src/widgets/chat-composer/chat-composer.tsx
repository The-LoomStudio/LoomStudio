import { useLayoutEffect, useRef, type FormEvent, type ReactNode } from 'react'
import { ArrowUp, BringToFront, ChevronUp, Plus, RotateCcw } from 'lucide-react'
import styles from './chat-composer.module.scss'

type ChatComposerProps = {
  canPreviewPrompt: boolean
  canSend: boolean
  expanded?: boolean
  expansion?: ReactNode
  input: string
  onChangeInput: (value: string) => void
  onHeightChange?: (height: number) => void
  onPreviewPrompt: () => void
  onSubmit: (event: FormEvent) => void
  moreLabel: string
  placeholder?: string
  previewLabel: string
  retryLabel: string
  sendLabel: string
  sendLeadingAction?: ReactNode
  targetActionLabel?: string
  targetActive?: boolean
  targetLabel?: string
  textareaDisabled: boolean
  textareaLabel: string
  toggleExpandedLabel?: string
  onTargetAction?: () => void
  onToggleExpanded?: () => void
}

export function ChatComposer(props: ChatComposerProps) {
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
    <form className={`${styles.composer} ${props.expanded ? styles.composerExpanded : ''}`} data-loom-component="chat-composer" ref={composerRef} onSubmit={props.onSubmit}>
      <div className={styles.composerBody}>
        <div className={styles.inputSurface} data-loom-anchor="narrative-composer-surface">
          {props.expansion ? (
            <div aria-hidden={!props.expanded} className={styles.expansionShell}>
              <div className={styles.expansionContent}>{props.expansion}</div>
            </div>
          ) : null}
          <div ref={baseContentRef} className={styles.baseContent} data-loom-anchor="narrative-composer-base">
            <textarea
              aria-label={props.textareaLabel}
              placeholder={props.placeholder}
              value={props.input}
              onChange={event => props.onChangeInput(event.target.value)}
              disabled={props.textareaDisabled}
            />
            <div className={styles.composerFooter}>
              <div className={styles.quickActions}>
                {props.onToggleExpanded && props.toggleExpandedLabel ? (
                  <button
                    aria-expanded={props.expanded}
                    aria-label={props.toggleExpandedLabel}
                    className={`${styles.utilityButton} ${styles.expansionToggle}`}
                    title={props.toggleExpandedLabel}
                    type="button"
                    onClick={props.onToggleExpanded}
                  >
                    <ChevronUp aria-hidden="true" strokeWidth={1.7} />
                  </button>
                ) : null}
                <button aria-label={props.moreLabel} className={styles.utilityButton} disabled title={props.moreLabel} type="button">
                  <Plus aria-hidden="true" strokeWidth={1.7} />
                </button>
                <button aria-label={props.retryLabel} className={styles.utilityButton} disabled title={props.retryLabel} type="button">
                  <RotateCcw aria-hidden="true" strokeWidth={1.7} />
                </button>
              </div>
              <div className={styles.composerActions}>
                {props.targetLabel ? (
                  props.onTargetAction && props.targetActionLabel ? (
                    <button
                      aria-label={props.targetActionLabel}
                      aria-pressed={props.targetActive}
                      className={styles.targetButton}
                      title={props.targetActionLabel}
                      type="button"
                      onClick={props.onTargetAction}
                    >
                      <span>{props.targetLabel}</span>
                      <BringToFront aria-hidden="true" />
                    </button>
                  ) : <span className={styles.targetLabel}>{props.targetLabel}</span>
                ) : (
                  <button
                    className={styles.previewButton}
                    onClick={props.onPreviewPrompt}
                    disabled={!props.canPreviewPrompt}
                    type="button"
                  >
                    {props.previewLabel}
                  </button>
                )}
                {props.sendLeadingAction}
                <button aria-label={props.sendLabel} className={styles.sendButton} type="submit" disabled={!props.canSend} title={props.sendLabel}>
                  <ArrowUp aria-hidden="true" absoluteStrokeWidth strokeWidth={1.7} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </form>
  )
}
