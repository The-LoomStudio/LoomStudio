import { useLayoutEffect, useRef, type FormEvent } from 'react'
import { ArrowUp, Plus, RotateCcw } from 'lucide-react'
import styles from './chat-composer.module.scss'

type ChatComposerProps = {
  canPreviewPrompt: boolean
  canSend: boolean
  input: string
  onChangeInput: (value: string) => void
  onHeightChange: (height: number) => void
  onPreviewPrompt: () => void
  onSubmit: (event: FormEvent) => void
  moreLabel: string
  previewLabel: string
  retryLabel: string
  sendLabel: string
  textareaDisabled: boolean
}

export function ChatComposer(props: ChatComposerProps) {
  const composerRef = useRef<HTMLFormElement>(null)

  useLayoutEffect(() => {
    const composer = composerRef.current
    if (!composer) return

    let previousHeight = 0
    const reportHeight = () => {
      const height = Math.ceil(composer.getBoundingClientRect().height)
      if (height === previousHeight) return
      previousHeight = height
      props.onHeightChange(height)
    }

    reportHeight()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(reportHeight)
    observer.observe(composer)
    return () => observer.disconnect()
  }, [props.onHeightChange])

  return (
    <form className={styles.composer} data-loom-component="chat-composer" ref={composerRef} onSubmit={props.onSubmit}>
      <div className={styles.composerBody}>
        <div className={styles.inputSurface}>
          <textarea
            value={props.input}
            onChange={event => props.onChangeInput(event.target.value)}
            disabled={props.textareaDisabled}
          />
          <div className={styles.composerFooter}>
            <div className={styles.quickActions}>
              <button aria-label={props.moreLabel} className={styles.utilityButton} disabled title={props.moreLabel} type="button">
                <Plus aria-hidden="true" size={17} strokeWidth={1.7} />
              </button>
              <button aria-label={props.retryLabel} className={styles.utilityButton} disabled title={props.retryLabel} type="button">
                <RotateCcw aria-hidden="true" size={16} strokeWidth={1.7} />
              </button>
            </div>
            <div className={styles.composerActions}>
              <button
                className={styles.previewButton}
                onClick={props.onPreviewPrompt}
                disabled={!props.canPreviewPrompt}
                type="button"
              >
                {props.previewLabel}
              </button>
              <button aria-label={props.sendLabel} className={styles.sendButton} type="submit" disabled={!props.canSend} title={props.sendLabel}>
                <ArrowUp aria-hidden="true" absoluteStrokeWidth size={16} strokeWidth={1.7} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </form>
  )
}
