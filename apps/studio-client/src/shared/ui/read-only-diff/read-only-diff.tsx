import { useEffect, useRef, useState } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, lineNumbers } from '@codemirror/view'
import { unifiedMergeView } from '@codemirror/merge'
import { Button } from '@loom-studio/ui'
import type { Translator } from '../../i18n/index.js'
import { loomEditorTheme } from '../long-text-editor/code-mirror-theme.js'
import { CHANGE_TRACKING_DIFF_CONFIG } from '../long-text-editor/code-mirror-change-tracking.js'
import styles from './read-only-diff.module.scss'

const diffTheme = EditorView.theme({
  '&.cm-merge-b .cm-changedLine': {
    backgroundColor: 'color-mix(in srgb, var(--loom-color-success) 13%, transparent)',
  },
  '&.cm-merge-b .cm-changedText': {
    background: 'color-mix(in srgb, var(--loom-color-success) 22%, transparent)',
  },
  '.cm-deletedChunk': {
    color: 'var(--loom-color-text-muted)',
    backgroundColor: 'color-mix(in srgb, var(--loom-color-danger) 12%, transparent)',
  },
  '&.cm-merge-b .cm-deletedText': {
    background: 'color-mix(in srgb, var(--loom-color-danger) 22%, transparent)',
  },
  '&.cm-merge-b .cm-changedLineGutter': { backgroundColor: 'var(--loom-color-success)' },
  '.cm-deletedLineGutter': { backgroundColor: 'var(--loom-color-danger)' },
  '&.cm-merge-b .cm-collapsedLines': {
    margin: '6px 4px',
    borderRadius: 'var(--loom-radius-control)',
    color: 'var(--loom-color-text-muted)',
    background: 'var(--loom-color-surface-raised)',
  },
})

export function ReadOnlyDiff(props: { before: string; after: string; t: Translator; flow?: boolean; defaultExpanded?: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(props.defaultExpanded ?? false)
  const label = props.t('agent.diffPreview')
  const unchangedPhrase = props.t('agent.diffUnchanged', { count: '$' })

  useEffect(() => {
    const view = new EditorView({
      parent: hostRef.current!,
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
            collapseUnchanged: expanded ? undefined : { margin: 3, minSize: 8 },
          }),
          loomEditorTheme,
          diffTheme,
          ...(props.flow ? [EditorView.lineWrapping, EditorView.theme({
            '&': { height: 'auto', minHeight: '0' },
            '.cm-scroller': { overflow: 'visible', minHeight: '0' },
          })] : []),
        ],
      }),
    })
    return () => view.destroy()
  }, [props.before, props.after, expanded, label, unchangedPhrase, props.flow])

  return <section className={`${styles.diff} ${props.flow ? styles.flow : ''}`} aria-label={label} data-loom-component="read-only-diff">
    <header className={styles.toolbar}>
      <span>{label}</span>
      <Button size="small" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
        {props.t(expanded ? 'agent.diffCollapse' : 'agent.diffExpand')}
      </Button>
    </header>
    <div className={styles.editor} ref={hostRef} />
  </section>
}
