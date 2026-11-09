import { EditorView } from '@codemirror/view'

export const loomEditorTheme = EditorView.theme({
  '&': {
    height: '100%',
    minHeight: 'var(--loom-long-text-editor-content-min-height, 180px)',
    color: 'var(--loom-color-text)',
    backgroundColor: 'transparent',
    fontSize: 'var(--loom-font-size-body)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    minHeight: 'var(--loom-long-text-editor-content-min-height, 180px)',
    overflow: 'auto',
    scrollbarColor: 'color-mix(in srgb, var(--loom-color-text-subtle) 34%, var(--loom-color-surface-subtle)) var(--loom-color-surface-subtle)',
    scrollbarWidth: 'thin',
    fontFamily: 'var(--loom-long-text-editor-font-family, var(--loom-font-family-mono))',
    lineHeight: 'var(--loom-long-text-editor-line-height, 1.72)',
  },
  '.cm-scroller::-webkit-scrollbar': { width: '8px', height: '8px' },
  '.cm-scroller::-webkit-scrollbar-track': { backgroundColor: 'var(--loom-color-surface-subtle)' },
  '.cm-scroller::-webkit-scrollbar-thumb': {
    border: '2px solid var(--loom-color-surface-subtle)',
    borderRadius: '999px',
    backgroundColor: 'color-mix(in srgb, var(--loom-color-text-subtle) 34%, var(--loom-color-surface-subtle))',
  },
  '.cm-content': {
    padding: '4px 0 20px',
    fontFamily: 'var(--loom-long-text-editor-font-family, var(--loom-font-family-mono))',
    fontSize: 'var(--loom-font-size-body)',
    lineHeight: 'var(--loom-long-text-editor-line-height, 1.72)',
    overflowWrap: 'anywhere',
  },
  '.cm-line': { padding: '0 4px' },
  '.cm-gutters': {
    border: '0',
    color: 'var(--loom-color-text-subtle)',
    backgroundColor: 'transparent',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    minWidth: '34px',
    padding: '0 8px 0 4px',
    fontSize: 'var(--loom-font-size-body)',
    textAlign: 'left',
  },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--loom-color-accent-strong)' },
  '& > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
    backgroundColor: 'var(--loom-color-selection-background)',
  },
  '.cm-placeholder': { color: 'var(--loom-color-text-subtle)', opacity: '0.48' },
  '.cm-loom-yaml-string': { color: 'var(--loom-color-syntax-string)' },
  '.cm-loom-yaml-number': { color: 'var(--loom-color-syntax-number)' },
  '.cm-loom-yaml-constant': { color: 'var(--loom-color-syntax-constant)' },
  '.cm-panels': {
    border: '0',
    color: 'var(--loom-color-text-muted)',
    backgroundColor: 'var(--loom-color-surface-subtle)',
  },
  '.cm-search': { display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 0' },
  '.cm-search label': { display: 'flex', alignItems: 'center', gap: '3px', fontSize: 'var(--loom-font-size-1)' },
  '.cm-search input': {
    minHeight: '24px',
    border: '0',
    borderBottom: '1px solid var(--loom-color-divider)',
    borderRadius: '0',
    padding: '2px 0',
    color: 'var(--loom-color-text)',
    backgroundColor: 'transparent',
  },
  '.cm-search input:focus': { borderBottomColor: 'var(--loom-color-accent)', boxShadow: 'none' },
  '.cm-search button': {
    minHeight: '24px',
    border: '0',
    padding: '2px 5px',
    color: 'var(--loom-color-text-subtle)',
    backgroundImage: 'none',
    backgroundColor: 'transparent',
    fontSize: 'var(--loom-font-size-1)',
  },
  '.cm-search button:hover': { color: 'var(--loom-color-text)' },
  '.cm-search button[name=close]': { position: 'static', marginLeft: 'auto' },
  '.cm-loom-line-added': {
    borderRadius: '0 4px 4px 0',
    backgroundColor: 'color-mix(in srgb, var(--loom-color-success-background) 62%, transparent)',
  },
  '.cm-loom-line-modified': {
    borderRadius: '0 4px 4px 0',
    backgroundColor: 'color-mix(in srgb, var(--loom-color-success-background) 62%, transparent)',
  },
  '.cm-loom-line-deleted': {
    borderRadius: '0 4px 4px 0',
    backgroundColor: 'color-mix(in srgb, var(--loom-color-danger-background) 52%, transparent)',
  },
  '.cm-loom-gutter-added': {
    borderRadius: '4px 0 0 4px',
    backgroundColor: 'color-mix(in srgb, var(--loom-color-success-background) 62%, transparent)',
  },
  '.cm-loom-gutter-modified': {
    borderRadius: '4px 0 0 4px',
    backgroundColor: 'color-mix(in srgb, var(--loom-color-success-background) 62%, transparent)',
  },
  '.cm-loom-gutter-deleted': {
    borderRadius: '4px 0 0 4px',
    backgroundColor: 'color-mix(in srgb, var(--loom-color-danger-background) 52%, transparent)',
  },
  '.cm-loom-gutter-active': {
    color: 'var(--loom-color-info)',
    fontWeight: 'var(--loom-font-weight-7)',
  },
  '.cm-loom-gutter-active.cm-loom-gutter-added, .cm-loom-gutter-active.cm-loom-gutter-modified': {
    backgroundColor: 'color-mix(in srgb, var(--loom-color-success-background) 72%, transparent)',
  },
  '.cm-loom-gutter-active.cm-loom-gutter-deleted': {
    backgroundColor: 'color-mix(in srgb, var(--loom-color-danger-background) 62%, transparent)',
  },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-activeLine.cm-loom-line-added, .cm-activeLine.cm-loom-line-modified': {
    backgroundColor: 'color-mix(in srgb, var(--loom-color-success-background) 72%, transparent)',
  },
  '.cm-activeLine.cm-loom-line-deleted': {
    backgroundColor: 'color-mix(in srgb, var(--loom-color-danger-background) 62%, transparent)',
  },
}, { dark: true })
