import { Check, Copy, RotateCcw, Trash2, X } from 'lucide-react'
import { forwardRef, useEffect, useId, useReducer } from 'react'
import {
  INITIAL_LONG_TEXT_EDITOR_STATE,
  reduceLongTextEditorState,
} from './long-text-editor-model.js'
import styles from './long-text-editor.module.scss'

type LongTextEditorProps = {
  clearLabel: string
  clearedLabel: string
  copiedLabel: string
  copyFailedLabel: string
  copyLabel: string
  disabled?: boolean
  label: string
  onChange(value: string): void
  onCommit(value: string): void
  placeholder?: string
  spellCheck?: boolean
  undoLabel: string
  value: string
}

export const LongTextEditor = forwardRef<HTMLTextAreaElement, LongTextEditorProps>(function LongTextEditor(props, ref) {
  const textareaId = useId()
  const [state, dispatch] = useReducer(reduceLongTextEditorState, INITIAL_LONG_TEXT_EDITOR_STATE)

  useEffect(() => {
    if (state.copyStatus === 'idle') return
    const timeout = window.setTimeout(() => dispatch({ type: 'reset-copy' }), 1600)
    return () => window.clearTimeout(timeout)
  }, [state.copyStatus])

  useEffect(() => {
    if (state.undoValue === undefined) return
    const timeout = window.setTimeout(() => dispatch({ type: 'expire-undo' }), 8000)
    return () => window.clearTimeout(timeout)
  }, [state.undoValue])

  async function copyValue() {
    try {
      await navigator.clipboard.writeText(props.value)
      dispatch({ type: 'copy', status: 'copied' })
    } catch {
      dispatch({ type: 'copy', status: 'failed' })
    }
  }

  function clearValue() {
    if (!props.value) return
    dispatch({ type: 'clear', value: props.value })
    props.onChange('')
    props.onCommit('')
  }

  function undoClear() {
    if (state.undoValue === undefined) return
    const value = state.undoValue
    dispatch({ type: 'undo' })
    props.onChange(value)
    props.onCommit(value)
  }

  const copyFeedback = state.copyStatus === 'copied'
    ? props.copiedLabel
    : state.copyStatus === 'failed'
      ? props.copyFailedLabel
      : ''
  const liveFeedback = copyFeedback || (state.undoValue === undefined ? '' : props.clearedLabel)

  return (
    <section
      className={styles.editor}
      data-copy-state={state.copyStatus}
      data-disabled={props.disabled ? 'true' : 'false'}
      data-loom-component="long-text-editor"
      data-undo-available={state.undoValue === undefined ? 'false' : 'true'}
    >
      <header className={styles.toolbar}>
        <label className={styles.label} htmlFor={textareaId}>{props.label}</label>
        <div className={styles.actions}>
          <button
            aria-label={state.copyStatus === 'idle' ? props.copyLabel : copyFeedback}
            className={`${styles.action} ${state.copyStatus === 'failed' ? styles.actionFailed : ''}`}
            disabled={!props.value}
            title={state.copyStatus === 'idle' ? props.copyLabel : copyFeedback}
            type="button"
            onClick={() => void copyValue()}
            onMouseDown={event => event.preventDefault()}
          >
            {state.copyStatus === 'copied' ? <Check aria-hidden="true" /> : state.copyStatus === 'failed' ? <X aria-hidden="true" /> : <Copy aria-hidden="true" />}
          </button>
          {state.undoValue === undefined ? (
            <button
              aria-label={props.clearLabel}
              className={styles.action}
              disabled={props.disabled || !props.value}
              title={props.clearLabel}
              type="button"
              onClick={clearValue}
              onMouseDown={event => event.preventDefault()}
            >
              <Trash2 aria-hidden="true" />
            </button>
          ) : (
            <button
              aria-label={props.undoLabel}
              className={`${styles.action} ${styles.undoAction}`}
              title={props.undoLabel}
              type="button"
              onClick={undoClear}
              onMouseDown={event => event.preventDefault()}
            >
              <RotateCcw aria-hidden="true" />
            </button>
          )}
        </div>
      </header>
      <textarea
        ref={ref}
        className={styles.textarea}
        disabled={props.disabled}
        id={textareaId}
        placeholder={props.placeholder}
        spellCheck={props.spellCheck}
        value={props.value}
        onBlur={event => props.onCommit(event.target.value)}
        onChange={event => {
          dispatch({ type: 'edit' })
          props.onChange(event.target.value)
        }}
      />
      <span className={styles.liveRegion} aria-live="polite">{liveFeedback}</span>
    </section>
  )
})
