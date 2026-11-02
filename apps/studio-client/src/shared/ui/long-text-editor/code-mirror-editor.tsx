import { yamlFrontmatter } from '@codemirror/lang-yaml'
import { buildSearchMatchPattern, searchRevealKey, type SearchReveal } from '../../lib/search-match.js'
import { defaultKeymap, history, historyKeymap, undo as undoChange, undoDepth } from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'
import { markdown } from '@codemirror/lang-markdown'
import { HighlightStyle, LanguageDescription, syntaxHighlighting, syntaxTree } from '@codemirror/language'
import { Chunk } from '@codemirror/merge'
import { getSearchQuery, search, searchKeymap, searchPanelOpen, SearchQuery, setSearchQuery } from '@codemirror/search'
import { Annotation, Compartment, EditorState, RangeSet, RangeSetBuilder, StateField, Text, Transaction } from '@codemirror/state'
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
import { readYamlScalarTokenClass } from '../../lib/yaml-scalar-highlight.js'
import {
  buildChangedChunks,
  CHANGE_TRACKING_DIFF_CONFIG,
  readChangedLines,
  readSelectionBoundaryLines,
} from './code-mirror-change-tracking.js'
import { loomEditorTheme } from './code-mirror-theme.js'
import { loomScriptMetadataHighlighting } from './loom-script-highlighting.js'
import styles from './long-text-editor.module.scss'

export type CodeMirrorEditorHandle = {
  focus(): void
  undo(): boolean
  revealLine(line: number): void
}

type CodeMirrorEditorProps = {
  language?: 'markdown' | 'javascript' | 'loom-script' | 'loom-rule'
  autoFocus?: boolean
  hidden?: boolean
  disabled?: boolean
  labelledBy: string
  onCancel?(): void
  onChange(value: string): void
  onUndoAvailabilityChange?(available: boolean): void
  onCommit(value: string): void
  onSubmit?(value: string): void
  placeholder?: string
  revealMatch?: SearchReveal
  showLineNumbers?: boolean
  spellCheck?: boolean
  value: string
}

const externalValueUpdate = Annotation.define<boolean>()

const loomHighlightStyle = HighlightStyle.define([
  { tag: tags.heading, color: 'var(--loom-color-syntax-heading)', fontWeight: 'var(--loom-font-weight-7)' },
  { tag: tags.strong, color: 'var(--loom-color-syntax-strong)', fontWeight: 'var(--loom-font-weight-7)' },
  { tag: tags.emphasis, color: 'var(--loom-color-syntax-emphasis)' },
  { tag: tags.quote, color: 'var(--loom-color-syntax-quote)' },
  { tag: [tags.link, tags.url], color: 'var(--loom-color-syntax-link)', textDecoration: 'none' },
  { tag: tags.keyword, color: 'var(--loom-color-syntax-keyword)' },
  { tag: [tags.atom, tags.bool, tags.null], color: 'var(--loom-color-syntax-constant)' },
  { tag: [tags.string, tags.attributeValue, tags.regexp, tags.monospace, tags.inserted], color: 'var(--loom-color-syntax-string)' },
  { tag: tags.number, color: 'var(--loom-color-syntax-number)' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--loom-color-syntax-function)' },
  { tag: [tags.typeName, tags.className], color: 'var(--loom-color-syntax-type)' },
  { tag: tags.variableName, color: 'var(--loom-color-syntax-variable)' },
  { tag: tags.propertyName, color: 'var(--loom-color-syntax-property)' },
  { tag: tags.tagName, color: 'var(--loom-color-syntax-tag)' },
  { tag: tags.attributeName, color: 'var(--loom-color-syntax-attribute)' },
  { tag: tags.operator, color: 'var(--loom-color-syntax-operator)' },
  { tag: tags.punctuation, color: 'var(--loom-color-syntax-punctuation)' },
  { tag: tags.meta, color: 'var(--loom-color-syntax-meta)' },
  { tag: tags.comment, color: 'var(--loom-color-syntax-comment)' },
  { tag: [tags.invalid, tags.deleted], color: 'var(--loom-color-syntax-invalid)' },
])

const codeLanguages = [
  LanguageDescription.of({ name: 'JavaScript', alias: ['js', 'jsx'], support: javascript({ jsx: true }) }),
  LanguageDescription.of({ name: 'TypeScript', alias: ['ts', 'tsx'], support: javascript({ jsx: true, typescript: true }) }),
  LanguageDescription.of({ name: 'XML', alias: ['xml'], load: async () => (await import('@codemirror/lang-xml')).xml() }),
  LanguageDescription.of({ name: 'YAML', alias: ['yaml', 'yml'], load: async () => (await import('@codemirror/lang-yaml')).yaml() }),
]


const yamlScalarHighlighting = EditorView.decorations.of(view => {
  const builder = new RangeSetBuilder<Decoration>()
  const tree = syntaxTree(view.state)

  for (const range of view.visibleRanges) {
    let position = range.from
    while (position < range.to) {
      const node = tree.resolveInner(position, 1)
      if (node.name === 'Literal' && node.parent?.name !== 'Key') {
        const value = view.state.sliceDoc(node.from, node.to)
        builder.add(node.from, node.to, Decoration.mark({ class: `cm-loom-yaml-${readYamlScalarTokenClass(value)}` }))
        position = node.to
      } else {
        position += 1
      }
    }
  }

  return builder.finish()
})

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

// CodeMirror's search highlighter only runs while its search panel is open.
const revealMatchHighlighting = EditorView.decorations.of(view => {
  const query = getSearchQuery(view.state)
  if (searchPanelOpen(view.state) || !query.valid) return Decoration.none
  const ranges = []
  for (const visible of view.visibleRanges) {
    const cursor = query.getCursor(view.state, visible.from, visible.to)
    for (let match = cursor.next(); !match.done; match = cursor.next()) {
      const { from, to } = match.value
      const selected = view.state.selection.ranges.some(range => range.from === from && range.to === to)
      ranges.push(Decoration.mark({ class: selected ? 'cm-searchMatch cm-searchMatch-selected' : 'cm-searchMatch' }).range(from, to))
    }
  }
  return Decoration.set(ranges)
})

export const CodeMirrorEditor = forwardRef<CodeMirrorEditorHandle, CodeMirrorEditorProps>(function CodeMirrorEditor(props, ref) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView>(null)
  const callbacksRef = useRef({
    onCancel: props.onCancel,
    onChange: props.onChange,
    onUndoAvailabilityChange: props.onUndoAvailabilityChange,
    onCommit: props.onCommit,
    onSubmit: props.onSubmit,
  })
  const initialValueRef = useRef(props.value)
  const readOnlyCompartmentRef = useRef(new Compartment())
  const placeholderCompartmentRef = useRef(new Compartment())
  const attributesCompartmentRef = useRef(new Compartment())
  const languageCompartmentRef = useRef(new Compartment())
  const revealMatchCompartmentRef = useRef(new Compartment())
  const revealedRequestRef = useRef<string | undefined>(undefined)
  const revealedQueryRef = useRef<SearchQuery | undefined>(undefined)
  callbacksRef.current = {
    onCancel: props.onCancel,
    onChange: props.onChange,
    onUndoAvailabilityChange: props.onUndoAvailabilityChange,
    onCommit: props.onCommit,
    onSubmit: props.onSubmit,
  }

  useImperativeHandle(ref, () => ({
    focus: () => viewRef.current?.focus(),
    undo: () => viewRef.current ? undoChange(viewRef.current) : false,
    revealLine: line => {
      const view = viewRef.current
      if (!view) return
      const target = view.state.doc.line(Math.max(1, Math.min(line, view.state.doc.lines)))
      view.dispatch({ selection: { anchor: target.from, head: target.to }, effects: EditorView.scrollIntoView(target.from, { y: 'center' }) })
      view.focus()
    },
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
          revealMatchCompartmentRef.current.of([]),
          languageCompartmentRef.current.of(editorLanguage(props.language)),
          syntaxHighlighting(loomHighlightStyle),
          yamlScalarHighlighting,
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
            callbacksRef.current.onUndoAvailabilityChange?.(undoDepth(update.state) > 0)
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
    callbacksRef.current.onUndoAvailabilityChange?.(undoDepth(view.state) > 0)
    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [])

  useEffect(() => {
    if (props.hidden) return
    viewRef.current?.requestMeasure()
    if (props.autoFocus) viewRef.current?.focus()
  }, [props.hidden, props.autoFocus])

  useEffect(() => {
    const view = viewRef.current
    if (!view || view.state.doc.toString() === props.value) return
    view.dispatch({
      annotations: [externalValueUpdate.of(true), Transaction.addToHistory.of(false)],
      changes: { from: 0, to: view.state.doc.length, insert: props.value },
    })
  }, [props.value])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const match = props.revealMatch
    if (!match) {
      if (revealedRequestRef.current === undefined) return
      revealedRequestRef.current = undefined
      const ownsQuery = revealedQueryRef.current && getSearchQuery(view.state).eq(revealedQueryRef.current)
      revealedQueryRef.current = undefined
      view.dispatch({ effects: [revealMatchCompartmentRef.current.reconfigure([]),
        ...(ownsQuery ? [setSearchQuery.of(new SearchQuery({ search: '' }))] : []),
      ] })
      return
    }
    const key = searchRevealKey(match)
    if (props.hidden || revealedRequestRef.current === key) return
    revealedRequestRef.current = key
    const query = new SearchQuery({ search: buildSearchMatchPattern(match.query), regexp: true, literal: true })
    revealedQueryRef.current = query
    const cursor = query.getCursor(view.state).next()
    view.dispatch({
      annotations: Transaction.addToHistory.of(false),
      effects: [
        setSearchQuery.of(query),
        revealMatchCompartmentRef.current.reconfigure(revealMatchHighlighting),
        ...(!cursor.done && query.valid ? [EditorView.scrollIntoView(cursor.value.from, { y: 'center' })] : []),
      ],
      ...(!cursor.done && query.valid ? { selection: { anchor: cursor.value.from, head: cursor.value.to } } : {}),
    })
  }, [props.hidden, props.revealMatch?.query, props.revealMatch?.requestId])

  useEffect(() => {
    viewRef.current?.dispatch({ effects: languageCompartmentRef.current.reconfigure(editorLanguage(props.language)) })
  }, [props.language])

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

  return <div hidden={props.hidden} className={styles.editorHost} data-loom-component="code-editor" ref={hostRef} />
})

function editorLanguage(language: CodeMirrorEditorProps['language']) {
  if (language === 'loom-rule') return [yamlFrontmatter({ content: markdown({ codeLanguages }) })]
  if (language === 'loom-script') return [javascript(), loomScriptMetadataHighlighting]
  if (language === 'javascript') return [javascript()]
  return [markdown({ codeLanguages })]
}
