import type { FormEvent } from 'react'
import styles from './input-dashboard.module.css'

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
      <div className={styles.composerMeta} aria-hidden="true">
        <span>MODEL / LOCAL RUNTIME</span>
        <span>0.8 TEMP</span>
        <span>CONTEXT READY</span>
      </div>
      <div className={styles.composerBody}>
        <div className={styles.inputSurface}>
          <textarea
            value={props.input}
            onChange={event => props.onChangeInput(event.target.value)}
            disabled={props.textareaDisabled}
          />
          <div className={styles.composerActions}>
            <button type="button" onClick={props.onPreviewPrompt} disabled={!props.canPreviewPrompt}>
              {props.previewLabel}
            </button>
            <button type="submit" disabled={!props.canSend}>
              {props.sendLabel}
            </button>
          </div>
        </div>
        <small>{props.composerHint}</small>
      </div>
    </form>
  )
}
