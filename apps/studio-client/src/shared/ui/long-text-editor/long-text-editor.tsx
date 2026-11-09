import { buildSearchMatchPattern, searchRevealKey, type SearchReveal } from '../../lib/search-match.js'
import { Check, Code2, Copy, Eye, GitCompare, History, RotateCcw, Trash2, Undo2, X } from 'lucide-react'
import { forwardRef, lazy, Suspense, useEffect, useId, useImperativeHandle, useReducer, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { CodeMirrorEditorHandle } from './code-mirror-editor.js'
import {
  INITIAL_LONG_TEXT_EDITOR_STATE,
  reduceLongTextEditorState,
  type LongTextEditorMode,
} from './long-text-editor-model.js'
import { Dialog, IconButton, SkeletonText } from '@loom-studio/ui'
import { createTranslator, type Translator } from '../../i18n/index.js'
import { useCopyFeedback } from '../../hooks/use-copy-feedback.js'
import styles from './long-text-editor.module.scss'

const CodeMirrorEditor = lazy(async () => {
  const module = await import('./code-mirror-editor.js')
  return { default: module.CodeMirrorEditor }
})

const MarkdownPreview = lazy(async () => {
  const module = await import('./markdown-preview.js')
  return { default: module.MarkdownPreview }
})

const LazyReadOnlyDiff = lazy(async () => {
  const module = await import('../read-only-diff/read-only-diff.js')
  return { default: module.ReadOnlyDiff }
})

type LongTextEditorBaseProps = {
  language?: 'markdown' | 'javascript' | 'loom-script' | 'loom-rule'
  hideLabel?: boolean
  headerExtra?: ReactNode
  clearLabel: string
  clearedLabel: string
  copiedLabel: string
  copyFailedLabel: string
  copyLabel: string
  autoFocus?: boolean
  compact?: boolean
  disabled?: boolean
  label: string
  minHeight?: number
  onChange(value: string): void
  onCommit(value: string): void
  placeholder?: string
  revealMatch?: SearchReveal
  spellCheck?: boolean
  restoreInitialLabel: string
  diffLabel?: string
  diffTitle?: string
  t?: Translator
  showLineNumbers?: boolean
  undoEditLabel: string
  undoLabel: string
  value: string
  onCancel?(): void
  onSubmit?(value: string): void
}

type LongTextEditorProps = LongTextEditorBaseProps & ({
  sourceOnly: true
  mode: 'source'
} | {
  sourceOnly?: false
  mode: LongTextEditorMode
  disableCodeWrapLabel: string
  enableCodeWrapLabel: string
  previewEmptyLabel: string
  previewModeLabel: string
  sourceModeLabel: string
  onModeChange(mode: LongTextEditorMode): void
})

export type LongTextEditorHandle = CodeMirrorEditorHandle

export const LongTextEditor = forwardRef<LongTextEditorHandle, LongTextEditorProps>(function LongTextEditor(props, ref) {
  const labelId = useId()
  const codeEditorRef = useRef<CodeMirrorEditorHandle>(null)
  const initialValueRef = useRef(props.value)
  const revealedRequestRef = useRef<string | undefined>(undefined)
  const [hasOpenedSource, setHasOpenedSource] = useState(props.mode === 'source')
  const [canUndo, setCanUndo] = useState(false)
  const [diffOpen, setDiffOpen] = useState(false)
  const [state, dispatch] = useReducer(reduceLongTextEditorState, INITIAL_LONG_TEXT_EDITOR_STATE)
  const hasChanges = props.value !== initialValueRef.current
  const translator = props.t ?? createTranslator('zh-CN')
  const diffLabel = props.diffLabel ?? translator('longTextEditor.diff')
  const { feedback, copy } = useCopyFeedback()
  const copyStatus = feedback?.status ?? 'idle'
  const onModeChange = props.sourceOnly ? undefined : props.onModeChange

  useEffect(() => {
    const match = props.revealMatch
    const key = searchRevealKey(match)
    if (!match) { revealedRequestRef.current = undefined; return }
    if (revealedRequestRef.current === key) return
    revealedRequestRef.current = key
    const pattern = buildSearchMatchPattern(match.query)
    if (props.mode === 'preview' && pattern && new RegExp(pattern, 'i').test(props.value)) {
      onModeChange?.('source')
    }
  }, [props.revealMatch?.requestId, props.revealMatch?.query, props.mode, props.value, onModeChange])

  useEffect(() => {
    if (props.mode === 'source') setHasOpenedSource(true)
  }, [props.mode])

  useImperativeHandle(ref, () => ({
    focus: () => codeEditorRef.current?.focus(),
    undo: () => codeEditorRef.current?.undo() ?? false,
    revealLine: line => codeEditorRef.current?.revealLine(line),
  }), [])

  useEffect(() => {
    if (state.undoValue === undefined) return
    const timeout = window.setTimeout(() => dispatch({ type: 'expire-undo' }), 8000)
    return () => window.clearTimeout(timeout)
  }, [state.undoValue])

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

  const copyFeedback = copyStatus === 'copied'
    ? props.copiedLabel
    : copyStatus === 'failed'
      ? props.copyFailedLabel
      : ''
  const liveFeedback = copyFeedback || (state.undoValue === undefined ? '' : props.clearedLabel)
  const editorStyle = props.minHeight === undefined
    ? undefined
    : {
        '--loom-long-text-editor-content-min-height': props.compact
          ? '0px'
          : `max(0px, calc(${props.minHeight}px - 46px))`,
        '--loom-long-text-editor-min-height': `${props.minHeight}px`,
      } as CSSProperties

  return (
    <section
      className={styles.editor}
      data-copy-state={copyStatus}
      data-compact={props.compact ? 'true' : 'false'}
      data-disabled={props.disabled ? 'true' : 'false'}
      data-loom-component="long-text-editor"
      data-mode={props.mode}
      data-source-only={props.sourceOnly ? 'true' : 'false'}
      data-undo-available={state.undoValue === undefined ? 'false' : 'true'}
      style={editorStyle}
    >
      <header className={styles.toolbar}>
        <div className={styles.heading}>
          <span className={props.hideLabel ? styles.hiddenLabel : styles.label} id={labelId}>{props.label}</span>
          {props.headerExtra}
        </div>
        <div className={styles.actions}>
          {props.sourceOnly ? null : (
            <IconButton
              aria-label={props.mode === 'source' ? props.previewModeLabel : props.sourceModeLabel}
              aria-pressed={props.mode === 'preview'}
              className={`${styles.action} ${props.mode === 'preview' ? styles.modeActionActive : ''}`}
              onClick={() => props.onModeChange?.(props.mode === 'source' ? 'preview' : 'source')}
              onMouseDown={event => event.preventDefault()}
            >
              {props.mode === 'source' ? <Eye aria-hidden="true" /> : <Code2 aria-hidden="true" />}
            </IconButton>
          )}
          <IconButton
            aria-label={props.undoEditLabel}
            className={styles.action}
            disabled={props.disabled || props.mode === 'preview' || !canUndo}
            onClick={() => codeEditorRef.current?.undo()}
            onMouseDown={event => event.preventDefault()}
          >
            <Undo2 aria-hidden="true" />
          </IconButton>
          <IconButton
            aria-label={props.restoreInitialLabel}
            className={styles.action}
            disabled={props.disabled || props.mode === 'preview' || !hasChanges}
            onClick={restoreInitialValue}
            onMouseDown={event => event.preventDefault()}
          >
            <History aria-hidden="true" />
          </IconButton>
          <IconButton
            aria-label={diffLabel}
            className={styles.action}
            disabled={props.disabled || !hasChanges}
            onClick={() => setDiffOpen(true)}
            onMouseDown={event => event.preventDefault()}
          >
            <GitCompare aria-hidden="true" />
          </IconButton>
          {!props.compact ? (
            <IconButton
              aria-label={copyStatus === 'idle' ? props.copyLabel : copyFeedback}
              className={`${styles.action} ${copyStatus === 'failed' ? styles.actionFailed : ''}`}
              disabled={!props.value}
              onClick={() => void copy(props.value)}
              onMouseDown={event => event.preventDefault()}
            >
              {copyStatus === 'copied' ? <Check aria-hidden="true" /> : copyStatus === 'failed' ? <X aria-hidden="true" /> : <Copy aria-hidden="true" />}
            </IconButton>
          ) : null}
          {state.undoValue === undefined ? (
            <IconButton
              aria-label={props.clearLabel}
              className={styles.action}
              disabled={props.disabled || props.mode === 'preview' || !props.value}
              onClick={clearValue}
              onMouseDown={event => event.preventDefault()}
            >
              <Trash2 aria-hidden="true" />
            </IconButton>
          ) : (
            <IconButton
              aria-label={props.undoLabel}
              className={`${styles.action} ${styles.undoAction}`}
              onClick={undoClear}
              onMouseDown={event => event.preventDefault()}
            >
              <RotateCcw aria-hidden="true" />
            </IconButton>
          )}
        </div>
      </header>
      {/* ponytail: Retain one visited editor per mounted document; release it with the document, not on preview toggles. */}
      {props.mode === 'source' || hasOpenedSource ? (
        <Suspense fallback={(
          <div hidden={props.mode !== 'source'} aria-busy="true" className={styles.editorHost} data-loom-component="code-editor-loading">
            <SkeletonText className={styles.editorSkeleton} lines={8} />
          </div>
        )}>
          <CodeMirrorEditor
            ref={codeEditorRef}
            language={props.language}
            autoFocus={props.autoFocus}
            hidden={props.mode !== 'source'}
            disabled={props.disabled}
            labelledBy={labelId}
            placeholder={props.placeholder}
            revealMatch={props.revealMatch}
            showLineNumbers={props.showLineNumbers}
            spellCheck={props.spellCheck}
            value={props.value}
            onCancel={props.onCancel}
            onUndoAvailabilityChange={setCanUndo}
            onCommit={props.onCommit}
            onChange={value => {
              dispatch({ type: 'edit' })
              props.onChange(value)
            }}
            onSubmit={props.onSubmit}
          />
        </Suspense>
      ) : null}
      {props.mode === 'preview' && !props.sourceOnly ? (
        <Suspense fallback={(
          <div aria-busy="true" className={styles.preview} data-loom-component="markdown-preview-loading">
            <SkeletonText className={styles.previewSkeleton} lines={5} />
          </div>
        )}>
          <MarkdownPreview
            codeBlockLabels={{
              copied: props.copiedLabel,
              copy: props.copyLabel,
              copyFailed: props.copyFailedLabel,
              disableWrap: props.disableCodeWrapLabel,
              enableWrap: props.enableCodeWrapLabel,
            }}
            emptyLabel={props.previewEmptyLabel}
            value={props.value}
          />
        </Suspense>
      ) : null}
      {diffOpen && (
        <Dialog
          open
          dismissible
          onClose={() => setDiffOpen(false)}
          title={props.diffTitle ?? (props.label ? `${props.label} · ${diffLabel}` : diffLabel)}
        >
          <div className={styles.diffDialogContent}>
            <Suspense fallback={<SkeletonText lines={6} />}>
              <LazyReadOnlyDiff
                before={initialValueRef.current}
                after={props.value}
                t={translator}
                defaultExpanded
              />
            </Suspense>
          </div>
        </Dialog>
      )}
      <span className={styles.liveRegion} aria-live="polite">{liveFeedback}</span>
    </section>
  )
})
