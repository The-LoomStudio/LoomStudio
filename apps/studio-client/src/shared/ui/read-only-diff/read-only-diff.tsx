import { useEffect, useMemo, useRef, useState } from 'react'
import { Compartment, EditorState, Text } from '@codemirror/state'
import { EditorView, lineNumbers } from '@codemirror/view'
import { Chunk, unifiedMergeView } from '@codemirror/merge'
import { syntaxHighlighting } from '@codemirror/language'
import { IconButton } from '@loom-studio/ui'
import { Check, Copy, FoldVertical, UnfoldVertical, WrapText } from 'lucide-react'
import type { Translator } from '../../i18n/index.js'
import { useCopyFeedback } from '../../hooks/use-copy-feedback.js'
import { loomEditorTheme } from '../long-text-editor/code-mirror-theme.js'
import { CHANGE_TRACKING_DIFF_CONFIG } from '../long-text-editor/code-mirror-change-tracking.js'
import { editorLanguage, loomHighlightStyle } from '../long-text-editor/code-mirror-editor.js'
import styles from './read-only-diff.module.scss'

const diffTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'transparent',
  },
  '.cm-scroller': {
    fontFamily: 'var(--loom-font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)',
    fontSize: '13px',
    lineHeight: '1.5',
  },
  '.cm-gutters': {
    display: 'flex !important',
    backgroundColor: 'transparent',
    borderRight: '1px solid var(--loom-color-divider)',
  },
  '.cm-lineNumbers': {
    width: '38px !important',
    minWidth: '38px !important',
    flex: '0 0 38px !important',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    width: '38px !important',
    minWidth: '38px !important',
    boxSizing: 'border-box',
    padding: '0 6px !important',
    fontSize: '12px',
    textAlign: 'right !important',
    color: 'var(--loom-color-text-subtle)',
  },
  '.cm-changeGutter': {
    width: '4px !important',
    minWidth: '4px !important',
    flex: '0 0 4px !important',
    padding: '0 !important',
    margin: '0 !important',
  },
  '.cm-changedLineGutter': {
    backgroundColor: 'var(--loom-color-success) !important',
    width: '3px !important',
    minWidth: '3px !important',
  },
  '.cm-deletedLineGutter': {
    backgroundColor: 'var(--loom-color-danger) !important',
    width: '3px !important',
    minWidth: '3px !important',
  },
  '&.cm-merge-b .cm-changedLine': {
    backgroundColor: 'color-mix(in srgb, var(--loom-color-success) 12%, transparent)',
    paddingLeft: '8px !important',
  },
  '&.cm-merge-b .cm-changedText': {
    background: 'color-mix(in srgb, var(--loom-color-success) 24%, transparent)',
    borderRadius: '2px',
  },
  '.cm-deletedChunk': {
    color: 'var(--loom-color-text-muted)',
    backgroundColor: 'color-mix(in srgb, var(--loom-color-danger) 11%, transparent)',
    paddingLeft: '8px !important',
  },
  '&.cm-merge-b .cm-deletedText': {
    background: 'color-mix(in srgb, var(--loom-color-danger) 24%, transparent)',
    borderRadius: '2px',
  },
  '&.cm-merge-b .cm-collapsedLines': {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    height: '24px',
    lineHeight: '24px',
    boxSizing: 'border-box',
    margin: '0',
    padding: '0 8px !important',
    color: 'var(--loom-color-text-subtle)',
    background: 'color-mix(in srgb, var(--loom-color-surface-raised) 70%, transparent)',
    fontSize: '12px',
    fontFamily: 'inherit',
    cursor: 'pointer',
    userSelect: 'none',
    transition: 'background 120ms ease, color 120ms ease',
    '&::after': {
      content: 'none !important',
      display: 'none !important',
    },
    '&::before': {
      content: '"" !important',
      position: 'absolute',
      left: '-4px',
      top: '0',
      bottom: '0',
      width: '3px',
      backgroundColor: 'var(--loom-color-border-strong) !important',
      margin: '0 !important',
    },
  },
  '&.cm-merge-b .cm-collapsedLines:hover': {
    color: 'var(--loom-color-text)',
    background: 'var(--loom-color-surface-raised)',
    '&::before': {
      backgroundColor: 'var(--loom-color-text-subtle) !important',
    },
  },
})

function computeDiffStats(before: string, after: string) {
  if (before === after) return { added: 0, deleted: 0, hasChanges: false }
  const textA = Text.of(before.split('\n'))
  const textB = Text.of(after.split('\n'))
  const chunks = Chunk.build(textA, textB, CHANGE_TRACKING_DIFF_CONFIG)
  let added = 0
  let deleted = 0
  for (const chunk of chunks) {
    for (const change of chunk.changes) {
      const fromA = chunk.fromA + change.fromA
      const toA = chunk.fromA + change.toA
      const fromB = chunk.fromB + change.fromB
      const toB = chunk.fromB + change.toB
      if (fromA < toA) {
        const startLineA = textA.lineAt(fromA).number
        const endLineA = textA.lineAt(Math.max(fromA, toA - 1)).number
        deleted += endLineA - startLineA + 1
      }
      if (fromB < toB) {
        const startLineB = textB.lineAt(fromB).number
        const endLineB = textB.lineAt(Math.max(fromB, toB - 1)).number
        added += endLineB - startLineB + 1
      }
    }
  }
  return { added, deleted, hasChanges: chunks.length > 0 }
}

export type ReadOnlyDiffProps = {
  before: string
  after: string
  t: Translator
  language?: 'markdown' | 'javascript' | 'loom-script' | 'loom-rule'
  flow?: boolean
  defaultExpanded?: boolean
  defaultWrap?: boolean
  hideToolbar?: boolean
  className?: string
}

export function ReadOnlyDiff(props: ReadOnlyDiffProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const wrapCompartment = useRef(new Compartment())
  const [expanded, setExpanded] = useState(props.defaultExpanded ?? false)
  const [wrap, setWrap] = useState(props.defaultWrap ?? true)
  const { copy, feedback } = useCopyFeedback()

  const label = props.t('agent.diffPreview')
  const unchangedPhrase = props.t('agent.diffUnchanged', { count: '$' })
  const stats = useMemo(() => computeDiffStats(props.before, props.after), [props.before, props.after])

  useEffect(() => {
    if (!hostRef.current) return
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: props.after,
        extensions: [
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          EditorView.contentAttributes.of({ 'aria-label': label, tabindex: '0' }),
          EditorState.phrases.of({ '$ unchanged lines': unchangedPhrase }),
          lineNumbers(),
          unifiedMergeView({
            original: props.before,
            mergeControls: false,
            syntaxHighlightDeletions: false,
            diffConfig: CHANGE_TRACKING_DIFF_CONFIG,
            collapseUnchanged: expanded ? undefined : { margin: 1, minSize: 1 },
          }),
          syntaxHighlighting(loomHighlightStyle),
          ...editorLanguage(props.language),
          wrapCompartment.current.of(wrap ? [EditorView.lineWrapping] : []),
          loomEditorTheme,
          diffTheme,
          ...(props.flow ? [EditorView.theme({
            '&': { height: 'auto', minHeight: '0' },
            '.cm-scroller': { overflow: 'visible', minHeight: '0' },
          })] : []),
        ],
      }),
    })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [props.before, props.after, expanded, label, unchangedPhrase, props.flow, props.language])

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: wrapCompartment.current.reconfigure(wrap ? [EditorView.lineWrapping] : []),
    })
  }, [wrap])

  return (
    <section
      className={`${styles.diff} ${props.flow ? styles.flow : ''} ${props.className ?? ''}`}
      aria-label={label}
      data-loom-component="read-only-diff"
    >
      {!props.hideToolbar && (
        <header className={styles.toolbar}>
          <div className={styles.heading}>
            <span className={styles.label}>{label}</span>
            {stats.hasChanges ? (
              <div className={styles.stats}>
                {stats.added > 0 && <span className={styles.addedBadge}>+{stats.added}</span>}
                {stats.deleted > 0 && <span className={styles.deletedBadge}>-{stats.deleted}</span>}
              </div>
            ) : (
              <span className={styles.noChanges}>未检测到内容差异</span>
            )}
          </div>
          <div className={styles.actions}>
            <IconButton
              size="small"
              className={`${styles.action} ${!expanded ? styles.actionActive : ''}`}
              aria-label={props.t(expanded ? 'agent.diffCollapse' : 'agent.diffExpand')}
              aria-expanded={expanded}
              title={props.t(expanded ? 'agent.diffCollapse' : 'agent.diffExpand')}
              onClick={() => setExpanded(v => !v)}
            >
              {expanded ? <FoldVertical size={14} aria-hidden="true" /> : <UnfoldVertical size={14} aria-hidden="true" />}
            </IconButton>
            <IconButton
              size="small"
              className={`${styles.action} ${wrap ? styles.actionActive : ''}`}
              aria-label={wrap ? '关闭自动换行' : '开启自动换行'}
              title={wrap ? '关闭自动换行' : '开启自动换行'}
              onClick={() => setWrap(v => !v)}
            >
              <WrapText size={14} aria-hidden="true" />
            </IconButton>
            <IconButton
              size="small"
              className={styles.action}
              title={feedback?.status === 'copied' ? '已复制' : '复制最新内容'}
              aria-label={feedback?.status === 'copied' ? '已复制' : '复制最新内容'}
              onClick={() => void copy(props.after)}
            >
              {feedback?.status === 'copied' ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
            </IconButton>
          </div>
        </header>
      )}
      <div className={styles.editor} ref={hostRef} />
    </section>
  )
}
