import { Check, Code2, Copy, Eye, History, RotateCcw, Trash2, Undo2, X } from 'lucide-react'
import { forwardRef, lazy, Suspense, useEffect, useId, useImperativeHandle, useReducer, useRef } from 'react'
import type { CodeMirrorEditorHandle } from './code-mirror-editor.js'
import {
  INITIAL_LONG_TEXT_EDITOR_STATE,
  reduceLongTextEditorState,
  type LongTextEditorMode,
} from './long-text-editor-model.js'
import styles from './long-text-editor.module.scss'

const CodeMirrorEditor = lazy(async () => {
  const module = await import('./code-mirror-editor.js')
  return { default: module.CodeMirrorEditor }
})

const MarkdownPreview = lazy(async () => {
  const module = await import('./markdown-preview.js')
  return { default: module.MarkdownPreview }
})

type LongTextEditorProps = {
  clearLabel: string
  clearedLabel: string
  copiedLabel: string
  copyFailedLabel: string
  copyLabel: string
  disabled?: boolean
  label: string
  mode: LongTextEditorMode
  onChange(value: string): void
  onCommit(value: string): void
  placeholder?: string
  previewEmptyLabel: string
  previewModeLabel: string
  spellCheck?: boolean
  sourceModeLabel: string
  restoreInitialLabel: string
  undoEditLabel: string
  undoLabel: string
  value: string
  onModeChange(mode: LongTextEditorMode): void
}

export type LongTextEditorHandle = CodeMirrorEditorHandle

export const LongTextEditor = forwardRef<LongTextEditorHandle, LongTextEditorProps>(function LongTextEditor(props, ref) {
  const labelId = useId()
  const codeEditorRef = useRef<CodeMirrorEditorHandle>(null)
  const initialValueRef = useRef(props.value)
  const [state, dispatch] = useReducer(reduceLongTextEditorState, INITIAL_LONG_TEXT_EDITOR_STATE)
  const hasChanges = props.value !== initialValueRef.current

  useImperativeHandle(ref, () => ({
    focus: () => codeEditorRef.current?.focus(),
    undo: () => codeEditorRef.current?.undo() ?? false,
  }), [])

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

  function restoreInitialValue() {
    if (!hasChanges) return
    dispatch({ type: 'edit' })
    props.onChange(initialValueRef.current)
    props.onCommit(initialValueRef.current)
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
      data-mode={props.mode}
      data-undo-available={state.undoValue === undefined ? 'false' : 'true'}
    >
      <span className={styles.label} id={labelId}>{props.label}</span>
      <header className={styles.toolbar}>
        <div className={styles.actions}>
          <button
            aria-label={props.mode === 'source' ? props.previewModeLabel : props.sourceModeLabel}
            aria-pressed={props.mode === 'preview'}
            className={`${styles.action} ${props.mode === 'preview' ? styles.modeActionActive : ''}`}
            title={props.mode === 'source' ? props.previewModeLabel : props.sourceModeLabel}
            type="button"
            onClick={() => props.onModeChange(props.mode === 'source' ? 'preview' : 'source')}
            onMouseDown={event => event.preventDefault()}
          >
            {props.mode === 'source' ? <Eye aria-hidden="true" /> : <Code2 aria-hidden="true" />}
          </button>
          <button
            aria-label={props.undoEditLabel}
            className={styles.action}
            disabled={props.disabled || props.mode === 'preview' || !hasChanges}
            title={props.undoEditLabel}
            type="button"
            onClick={() => codeEditorRef.current?.undo()}
            onMouseDown={event => event.preventDefault()}
          >
            <Undo2 aria-hidden="true" />
          </button>
          <button
            aria-label={props.restoreInitialLabel}
            className={styles.action}
            disabled={props.disabled || props.mode === 'preview' || !hasChanges}
            title={props.restoreInitialLabel}
            type="button"
            onClick={restoreInitialValue}
            onMouseDown={event => event.preventDefault()}
          >
            <History aria-hidden="true" />
          </button>
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
              disabled={props.disabled || props.mode === 'preview' || !props.value}
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
      {props.mode === 'source' ? (
        <Suspense fallback={<div aria-busy="true" className={styles.editorHost} data-loom-component="code-editor-loading" />}>
          <CodeMirrorEditor
            ref={codeEditorRef}
            disabled={props.disabled}
            labelledBy={labelId}
            placeholder={props.placeholder}
            spellCheck={props.spellCheck}
            value={props.value}
            onCommit={props.onCommit}
            onChange={value => {
              dispatch({ type: 'edit' })
              props.onChange(value)
            }}
          />
        </Suspense>
      ) : (
        <Suspense fallback={<div aria-busy="true" className={styles.preview} data-loom-component="markdown-preview-loading" />}>
          <MarkdownPreview emptyLabel={props.previewEmptyLabel} value={props.value} />
        </Suspense>
      )}
      <span className={styles.liveRegion} aria-live="polite">{liveFeedback}</span>
    </section>
  )
})
