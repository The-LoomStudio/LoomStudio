import { defaultKeymap, history, historyKeymap, undo as undoChange } from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'
import { markdown } from '@codemirror/lang-markdown'
import { xml } from '@codemirror/lang-xml'
import { yaml } from '@codemirror/lang-yaml'
import { HighlightStyle, LanguageDescription, syntaxHighlighting } from '@codemirror/language'
import { Chunk } from '@codemirror/merge'
import { search, searchKeymap } from '@codemirror/search'
import { Annotation, Compartment, EditorState, RangeSet, StateField, Text, Transaction } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  drawSelection,
  EditorView,
  GutterMarker,
  gutterLineClass,
  highlightActiveLine,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  placeholder,
} from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react'
import {
  buildChangedChunks,
  CHANGE_TRACKING_DIFF_CONFIG,
  readChangedLines,
  readSelectionBoundaryLines,
} from './code-mirror-change-tracking.js'
import styles from './long-text-editor.module.scss'

export type CodeMirrorEditorHandle = {
  focus(): void
  undo(): boolean
}

type CodeMirrorEditorProps = {
  autoFocus?: boolean
  disabled?: boolean
  labelledBy: string
  onCancel?(): void
  onChange(value: string): void
  onCommit(value: string): void
  onSubmit?(value: string): void
  placeholder?: string
  showLineNumbers?: boolean
  spellCheck?: boolean
  value: string
}

const externalValueUpdate = Annotation.define<boolean>()

const loomHighlightStyle = HighlightStyle.define([
  { tag: tags.heading, color: 'var(--loom-syntax-heading)', fontWeight: '650' },
  { tag: tags.strong, color: 'var(--loom-syntax-strong)', fontWeight: '650' },
  { tag: tags.emphasis, color: 'var(--loom-syntax-emphasis)' },
  { tag: tags.quote, color: 'var(--loom-syntax-quote)' },
  { tag: [tags.link, tags.url], color: 'var(--loom-syntax-link)', textDecoration: 'none' },
  { tag: tags.keyword, color: 'var(--loom-syntax-keyword)' },
  { tag: [tags.atom, tags.bool, tags.null], color: 'var(--loom-syntax-constant)' },
  { tag: [tags.string, tags.attributeValue, tags.regexp, tags.monospace, tags.inserted], color: 'var(--loom-syntax-string)' },
  { tag: tags.number, color: 'var(--loom-syntax-number)' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--loom-syntax-function)' },
  { tag: [tags.typeName, tags.className], color: 'var(--loom-syntax-type)' },
  { tag: tags.variableName, color: 'var(--loom-syntax-variable)' },
  { tag: tags.propertyName, color: 'var(--loom-syntax-property)' },
  { tag: tags.tagName, color: 'var(--loom-syntax-tag)' },
  { tag: tags.attributeName, color: 'var(--loom-syntax-attribute)' },
  { tag: tags.operator, color: 'var(--loom-syntax-operator)' },
  { tag: tags.punctuation, color: 'var(--loom-syntax-punctuation)' },
  { tag: tags.meta, color: 'var(--loom-syntax-meta)' },
  { tag: tags.comment, color: 'var(--loom-syntax-comment)' },
  { tag: [tags.invalid, tags.deleted], color: 'var(--loom-syntax-invalid)' },
])

const codeLanguages = [
  LanguageDescription.of({ name: 'JavaScript', alias: ['js', 'jsx'], support: javascript({ jsx: true }) }),
  LanguageDescription.of({ name: 'TypeScript', alias: ['ts', 'tsx'], support: javascript({ jsx: true, typescript: true }) }),
  LanguageDescription.of({ name: 'XML', alias: ['xml'], support: xml() }),
  LanguageDescription.of({ name: 'YAML', alias: ['yaml', 'yml'], support: yaml() }),
]

const loomEditorTheme = EditorView.theme({
  '&': {
    height: '100%',
    minHeight: 'var(--loom-long-text-editor-content-min-height, 180px)',
    color: 'var(--loom-text)',
    backgroundColor: 'transparent',
    fontSize: 'var(--loom-font-size-body)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    minHeight: 'var(--loom-long-text-editor-content-min-height, 180px)',
    overflow: 'auto',
    scrollbarColor: 'color-mix(in srgb, var(--loom-text-subtle) 34%, var(--loom-surface)) var(--loom-surface)',
    scrollbarWidth: 'thin',
    fontFamily: 'var(--loom-long-text-editor-font-family, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)',
    lineHeight: 'var(--loom-long-text-editor-line-height, 1.72)',
  },
  '.cm-scroller::-webkit-scrollbar': { width: '8px', height: '8px' },
  '.cm-scroller::-webkit-scrollbar-track': { backgroundColor: 'var(--loom-surface)' },
  '.cm-scroller::-webkit-scrollbar-thumb': {
    border: '2px solid var(--loom-surface)',
    borderRadius: '999px',
    backgroundColor: 'color-mix(in srgb, var(--loom-text-subtle) 34%, var(--loom-surface))',
  },
  '.cm-content': {
    padding: '4px 0 20px',
    fontFamily: 'var(--loom-long-text-editor-font-family, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)',
    fontSize: 'var(--loom-font-size-body)',
    lineHeight: 'var(--loom-long-text-editor-line-height, 1.72)',
  },
  '.cm-line': { padding: '0 4px' },
  '.cm-gutters': {
    border: '0',
    color: 'var(--loom-text-subtle)',
    backgroundColor: 'transparent',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    minWidth: '34px',
    padding: '0 8px 0 4px',
    fontSize: 'var(--loom-font-size-body)',
    textAlign: 'left',
  },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--loom-accent-strong)' },
  '& > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
    backgroundColor: 'var(--loom-selection-bg)',
  },
  '.cm-placeholder': { color: 'var(--loom-text-subtle)', opacity: '0.48' },
  '.cm-panels': {
    border: '0',
    color: 'var(--loom-text-muted)',
    backgroundColor: 'var(--loom-surface)',
  },
  '.cm-search': { display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 0' },
  '.cm-search label': { display: 'flex', alignItems: 'center', gap: '3px', fontSize: '10px' },
  '.cm-search input': {
    minHeight: '24px',
    border: '0',
    borderBottom: '1px solid var(--loom-divider-color)',
    borderRadius: '0',
    padding: '2px 0',
    color: 'var(--loom-text)',
    backgroundColor: 'transparent',
  },
  '.cm-search input:focus': { borderBottomColor: 'var(--loom-accent)', boxShadow: 'none' },
  '.cm-search button': {
    minHeight: '24px',
    border: '0',
    padding: '2px 5px',
    color: 'var(--loom-text-subtle)',
    backgroundImage: 'none',
    backgroundColor: 'transparent',
    fontSize: '10px',
  },
  '.cm-search button:hover': { color: 'var(--loom-text)' },
  '.cm-search button[name=close]': { position: 'static', marginLeft: 'auto' },
  '.cm-loom-line-added': {
    borderRadius: '0 4px 4px 0',
    backgroundColor: 'color-mix(in srgb, var(--loom-success-bg) 62%, transparent)',
  },
  '.cm-loom-line-modified': {
    borderRadius: '0 4px 4px 0',
    backgroundColor: 'color-mix(in srgb, var(--loom-success-bg) 62%, transparent)',
  },
  '.cm-loom-line-deleted': {
    borderRadius: '0 4px 4px 0',
    backgroundColor: 'color-mix(in srgb, var(--loom-danger-bg) 52%, transparent)',
  },
  '.cm-loom-gutter-added': {
    borderRadius: '4px 0 0 4px',
    backgroundColor: 'color-mix(in srgb, var(--loom-success-bg) 62%, transparent)',
  },
  '.cm-loom-gutter-modified': {
    borderRadius: '4px 0 0 4px',
    backgroundColor: 'color-mix(in srgb, var(--loom-success-bg) 62%, transparent)',
  },
  '.cm-loom-gutter-deleted': {
    borderRadius: '4px 0 0 4px',
    backgroundColor: 'color-mix(in srgb, var(--loom-danger-bg) 52%, transparent)',
  },
  '.cm-loom-gutter-active': {
    color: 'var(--loom-info)',
    fontWeight: '650',
  },
  '.cm-loom-gutter-active.cm-loom-gutter-added, .cm-loom-gutter-active.cm-loom-gutter-modified, .cm-loom-gutter-active.cm-loom-gutter-deleted': {
    backgroundColor: 'transparent',
  },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-activeLine.cm-loom-line-added, .cm-activeLine.cm-loom-line-modified, .cm-activeLine.cm-loom-line-deleted': {
    backgroundColor: 'transparent',
  },
}, { dark: true })

class ChangeGutterMarker extends GutterMarker {
  override readonly elementClass: string

  constructor(readonly kind: 'added' | 'modified' | 'deleted') {
    super()
    this.elementClass = `cm-loom-gutter-${kind}`
  }

  override eq(other: ChangeGutterMarker) {
    return other.kind === this.kind
  }
}

const changeGutterMarkers = {
  added: new ChangeGutterMarker('added'),
  modified: new ChangeGutterMarker('modified'),
  deleted: new ChangeGutterMarker('deleted'),
} as const

class ActiveLineGutterMarker extends GutterMarker {
  override readonly elementClass = 'cm-loom-gutter-active'
}

const activeLineGutterMarker = new ActiveLineGutterMarker()

function changeTracking(baseline: Text) {
  return StateField.define<{
    chunks: readonly Chunk[]
    decorations: DecorationSet
    gutterMarkers: RangeSet<GutterMarker>
  }>({
    create(state) {
      const chunks = buildChangedChunks(baseline, state.doc)
      return { chunks, ...buildChangeMarks(state.doc, chunks) }
    },
    update(value, transaction) {
      if (!transaction.docChanged) return value
      const chunks = Chunk.updateB(
        value.chunks,
        baseline,
        transaction.newDoc,
        transaction.changes,
        CHANGE_TRACKING_DIFF_CONFIG,
      )
      return { chunks, ...buildChangeMarks(transaction.newDoc, chunks) }
    },
    provide: field => [
      EditorView.decorations.from(field, value => value.decorations),
      gutterLineClass.from(field, value => value.gutterMarkers),
    ],
  })
}

function buildChangeMarks(current: Text, chunks: readonly Chunk[]) {
  const changes = readChangedLines(current, chunks)
  return {
    decorations: Decoration.set(changes.map(change => (
      Decoration.line({ class: `cm-loom-line-${change.kind}` }).range(current.line(change.line).from)
    )), true),
    gutterMarkers: RangeSet.of(changes.map(change => (
      changeGutterMarkers[change.kind].range(current.line(change.line).from)
    )), true),
  }
}

function selectionBoundaryTracking() {
  return gutterLineClass.compute(['doc', 'selection'], buildSelectionBoundaryMarkers)
}

function buildSelectionBoundaryMarkers(state: EditorState) {
  return RangeSet.of(readSelectionBoundaryLines(state.doc, state.selection.ranges).map(line => (
    activeLineGutterMarker.range(state.doc.line(line).from)
  )))
}

export const CodeMirrorEditor = forwardRef<CodeMirrorEditorHandle, CodeMirrorEditorProps>(function CodeMirrorEditor(props, ref) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView>(null)
  const callbacksRef = useRef({
    onCancel: props.onCancel,
    onChange: props.onChange,
    onCommit: props.onCommit,
    onSubmit: props.onSubmit,
  })
  const initialValueRef = useRef(props.value)
  const readOnlyCompartmentRef = useRef(new Compartment())
  const placeholderCompartmentRef = useRef(new Compartment())
  const attributesCompartmentRef = useRef(new Compartment())
  callbacksRef.current = {
    onCancel: props.onCancel,
    onChange: props.onChange,
    onCommit: props.onCommit,
    onSubmit: props.onSubmit,
  }

  useImperativeHandle(ref, () => ({
    focus: () => viewRef.current?.focus(),
    undo: () => viewRef.current ? undoChange(viewRef.current) : false,
  }), [])

  useLayoutEffect(() => {
    if (!hostRef.current) return

    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: initialValueRef.current,
        extensions: [
          history(),
          keymap.of([
            {
              key: 'Mod-Enter',
              run: currentView => {
                callbacksRef.current.onSubmit?.(currentView.state.doc.toString())
                return Boolean(callbacksRef.current.onSubmit)
              },
            },
            {
              key: 'Escape',
              run: () => {
                callbacksRef.current.onCancel?.()
                return Boolean(callbacksRef.current.onCancel)
              },
            },
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
          ]),
          ...(props.showLineNumbers === false ? [] : [lineNumbers()]),
          highlightSpecialChars(),
          highlightActiveLine(),
          drawSelection(),
          search(),
          markdown({ codeLanguages }),
          syntaxHighlighting(loomHighlightStyle),
          EditorView.lineWrapping,
          loomEditorTheme,
          changeTracking(Text.of(initialValueRef.current.split('\n'))),
          selectionBoundaryTracking(),
          readOnlyCompartmentRef.current.of([
            EditorState.readOnly.of(Boolean(props.disabled)),
            EditorView.editable.of(!props.disabled),
          ]),
          placeholderCompartmentRef.current.of(placeholder(props.placeholder ?? '')),
          attributesCompartmentRef.current.of(EditorView.contentAttributes.of({
            'aria-labelledby': props.labelledBy,
            spellcheck: props.spellCheck ? 'true' : 'false',
          })),
          EditorView.updateListener.of(update => {
            if (!update.docChanged || update.transactions.some(transaction => transaction.annotation(externalValueUpdate))) return
            callbacksRef.current.onChange(update.state.doc.toString())
          }),
          EditorView.domEventHandlers({
            blur: (_event, currentView) => callbacksRef.current.onCommit(currentView.state.doc.toString()),
          }),
        ],
      }),
    })

    viewRef.current = view
    if (props.autoFocus) view.focus()
    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view || view.state.doc.toString() === props.value) return
    view.dispatch({
      annotations: [externalValueUpdate.of(true), Transaction.addToHistory.of(false)],
      changes: { from: 0, to: view.state.doc.length, insert: props.value },
    })
  }, [props.value])

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: readOnlyCompartmentRef.current.reconfigure([
        EditorState.readOnly.of(Boolean(props.disabled)),
        EditorView.editable.of(!props.disabled),
      ]),
    })
  }, [props.disabled])

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: placeholderCompartmentRef.current.reconfigure(placeholder(props.placeholder ?? '')),
    })
  }, [props.placeholder])

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: attributesCompartmentRef.current.reconfigure(EditorView.contentAttributes.of({
        'aria-labelledby': props.labelledBy,
        spellcheck: props.spellCheck ? 'true' : 'false',
      })),
    })
  }, [props.labelledBy, props.spellCheck])

  return <div className={styles.editorHost} data-loom-component="code-editor" ref={hostRef} />
})
