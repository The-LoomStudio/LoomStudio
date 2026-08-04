import type { FormEvent } from 'react'
import { ArrowUp } from 'lucide-react'
import styles from './input-dashboard.module.scss'

type InputDashboardProps = {
  canPreviewPrompt: boolean
  canSend: boolean
  composerHint: string
  input: string
  onChangeInput: (value: string) => void
  onPreviewPrompt: () => void
  onSubmit: (event: FormEvent) => void
  previewLabel: string
  sendLabel: string
  textareaDisabled: boolean
}

export function InputDashboard(props: InputDashboardProps) {
  return (
    <form className={styles.composer} data-loom-component="input-dashboard" onSubmit={props.onSubmit}>
      <div className={styles.composerBody}>
        <div className={styles.inputSurface}>
          <textarea
            value={props.input}
            onChange={event => props.onChangeInput(event.target.value)}
            disabled={props.textareaDisabled}
          />
          <div className={styles.composerFooter}>
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
                <ArrowUp aria-hidden="true" absoluteStrokeWidth size={18} strokeWidth={1.7} />
              </button>
            </div>
          </div>
        </div>
        <small>{props.composerHint}</small>
      </div>
    </form>
  )
}
