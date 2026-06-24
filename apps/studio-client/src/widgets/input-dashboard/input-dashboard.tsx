import type { CSSProperties, FormEvent } from 'react'
import { activationModeOptions, activationTagOptions, type ActivationControlState, type ActivationMode, type ActivationTag } from '../../features/prompt-build/model/activation-control.js'
import type { Translator } from '../../shared/i18n/index.js'
import styles from './input-dashboard.module.css'

type InputDashboardProps = {
  activationControl: ActivationControlState
  canPreviewPrompt: boolean
  canSend: boolean
  composerHint: string
  input: string
  onChangeInput: (value: string) => void
  onChangeActivationMode: (mode: ActivationMode) => void
  onPreviewPrompt: () => void
  onSubmit: (event: FormEvent) => void
  onToggleActivationTag: (tag: ActivationTag) => void
  previewLabel: string
  sendLabel: string
  t: Translator
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
      <div className={styles.activationBar} aria-label={props.t('composer.activation.label')}>
        <div className={styles.segmented} role="group" aria-label={props.t('composer.activation.mode')}>
          {activationModeOptions.map(mode => (
            <button
              aria-pressed={props.activationControl.mode === mode}
              className={props.activationControl.mode === mode ? `${styles.segmentButton} ${styles.segmentButtonActive}` : styles.segmentButton}
              key={mode}
              onClick={() => props.onChangeActivationMode(mode)}
              type="button"
            >
              {props.t(mode === 'draft' ? 'composer.activation.mode.draft' : 'composer.activation.mode.finalize')}
            </button>
          ))}
        </div>
        <div className={styles.tagGroup} role="group" aria-label={props.t('composer.activation.tags')}>
          {activationTagOptions.map(option => {
            const active = props.activationControl.tags.includes(option.value)
            return (
              <button
                aria-pressed={active}
                className={active ? `${styles.tagButton} ${styles.tagButtonActive}` : styles.tagButton}
                key={option.value}
                onClick={() => props.onToggleActivationTag(option.value)}
                style={{ '--activation-color': option.color } as CSSProperties}
                type="button"
              >
                <span className={styles.tagDot} aria-hidden="true" />
                {props.t(option.labelKey)}
              </button>
            )
          })}
        </div>
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
