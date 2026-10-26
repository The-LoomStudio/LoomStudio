// @vitest-environment happy-dom
import { createElement, createRef, type ComponentProps } from 'react'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CodeMirrorEditor, type CodeMirrorEditorHandle } from '../../../apps/studio-client/src/shared/ui/long-text-editor/code-mirror-editor.js'
import { LongTextEditor } from '../../../apps/studio-client/src/shared/ui/long-text-editor/long-text-editor.js'
import { ContextAssetDetail } from '../../../apps/studio-client/src/features/prompt-resources/ui/context-asset-detail/context-asset-detail.js'

let root: Root | undefined
let container: HTMLDivElement | undefined

afterEach(() => {
  if (root) flushSync(() => root!.unmount())
  container?.remove()
  root = undefined
  container = undefined
  vi.restoreAllMocks()
})

function mount() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  return root
}

describe('search result body reveal', () => {
  it('clears global highlights without changing content', () => {
    const root = mount()
    const props = { labelledBy: 'body', value: '世界与世界观', onChange: vi.fn(), onCommit: vi.fn() }
    flushSync(() => root.render(createElement(CodeMirrorEditor, { ...props, revealMatch: { query: '世界', requestId: 1 } })))
    expect(container!.querySelectorAll('.cm-searchMatch')).toHaveLength(2)
    flushSync(() => root.render(createElement(CodeMirrorEditor, props)))
    expect(container!.querySelector('.cm-searchMatch')).toBeNull()
    expect(container!.querySelector('.cm-content')?.textContent).toBe(props.value)
    expect(props.onChange).not.toHaveBeenCalled()
    expect(props.onCommit).not.toHaveBeenCalled()
  })

  it('highlights literal query terms, selects the first body match, and never writes or creates undo history', () => {
    const root = mount()
    const handle = createRef<CodeMirrorEditorHandle>()
    const onChange = vi.fn()
    const onCommit = vi.fn()
    const onUndoAvailabilityChange = vi.fn()
    const value = 'Before a+b, then TITLE and A+B.'
    const render = (query: string, requestId: number) => flushSync(() => root.render(createElement(CodeMirrorEditor, {
      ref: handle, labelledBy: 'body', value, onChange, onCommit, onUndoAvailabilityChange,
      revealMatch: { query, requestId },
    })))

    render('metadata a+b title', 1)
    expect([...container!.querySelectorAll('.cm-searchMatch')].map(item => item.textContent)).toEqual(['a+b', 'TITLE', 'A+B'])
    expect(container!.querySelector('.cm-searchMatch-selected')?.textContent).toBe('a+b')
    expect(container!.querySelector('.cm-search')).toBeNull()

    container!.querySelector('.cm-content')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(container!.querySelector('.cm-searchMatch-selected')).toBeNull()
    render('metadata a+b title', 2)
    expect(container!.querySelector('.cm-searchMatch-selected')?.textContent).toBe('a+b')
    render('title', 3)
    expect(container!.querySelector('.cm-searchMatch-selected')?.textContent).toBe('TITLE')
    render('metadata a+b title', 4)
    expect(container!.querySelector('.cm-searchMatch-selected')?.textContent).toBe('a+b')

    expect(container!.querySelector('.cm-content')?.textContent).toBe(value)
    expect(handle.current?.undo()).toBe(false)
    expect(onUndoAvailabilityChange.mock.calls.every(([available]) => available === false)).toBe(true)
    expect(onChange).not.toHaveBeenCalled()
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('does not highlight or edit the document when a new query has no body match', () => {
    const root = mount()
    const props = { labelledBy: 'body', value: 'Only body text.', onChange: vi.fn(), onCommit: vi.fn() }
    flushSync(() => root.render(createElement(CodeMirrorEditor, { ...props, revealMatch: { query: 'body', requestId: 1 } })))
    expect(container!.querySelector('.cm-searchMatch-selected')?.textContent).toBe('body')
    flushSync(() => root.render(createElement(CodeMirrorEditor, { ...props, revealMatch: { query: 'title-only', requestId: 2 } })))
    expect(container!.querySelector('.cm-searchMatch')).toBeNull()
    expect(container!.querySelector('.cm-content')?.textContent).toBe(props.value)
    expect(props.onChange).not.toHaveBeenCalled()
    expect(props.onCommit).not.toHaveBeenCalled()
  })

  it('requests source mode only when a new reveal request matches the preview body', () => {
    const root = mount()
    const onModeChange = vi.fn()
    const props = {
      mode: 'preview', value: 'The a+b body.', onChange: vi.fn(), onCommit: vi.fn(), onModeChange,
      clearLabel: '', clearedLabel: '', copiedLabel: '', copyFailedLabel: '', copyLabel: '',
      label: '', restoreInitialLabel: '', undoEditLabel: '', undoLabel: '',
      disableCodeWrapLabel: '', enableCodeWrapLabel: '', previewEmptyLabel: '',
      previewModeLabel: '', sourceModeLabel: '',
    } satisfies ComponentProps<typeof LongTextEditor>
    const render = (query: string, requestId: number) => flushSync(() => root.render(createElement(LongTextEditor, {
      ...props, revealMatch: { query, requestId },
    })))

    render('title-only', 1)
    expect(onModeChange).not.toHaveBeenCalled()
    render('metadata a+b', 2)
    expect(onModeChange).toHaveBeenCalledExactlyOnceWith('source')
    render('metadata a+b', 2)
    expect(onModeChange).toHaveBeenCalledTimes(1)
    render('metadata a+b', 3)
    expect(onModeChange).toHaveBeenCalledTimes(2)
    flushSync(() => root.render(createElement(LongTextEditor, props)))
    render('metadata a+b', 3)
    expect(onModeChange).toHaveBeenCalledTimes(3)
    render('body', 3)
    expect(onModeChange).toHaveBeenCalledTimes(4)
    expect(props.onChange).not.toHaveBeenCalled()
    expect(props.onCommit).not.toHaveBeenCalled()
  })

  it('reveals compact virtual notes through native selection without focus or writes', () => {
    const root = mount()
    const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {})
    const props = {
      compactVirtualNotes: true, editorMode: 'source', metadataOpen: false,
      node: { id: 'notes', kind: 'virtual', label: '@notes', body: 'Before a+b notes.' },
      onChangeNode: vi.fn(), onCommitNode: vi.fn(), onEditorModeChange: vi.fn(), onMetadataOpenChange: vi.fn(),
      t: key => key,
    } satisfies ComponentProps<typeof ContextAssetDetail>
    const render = (query: string, requestId: number) => flushSync(() => root.render(createElement(ContextAssetDetail, {
      ...props, revealMatch: { query, requestId },
    })))

    render('metadata a+b', 1)
    const input = container!.querySelector<HTMLInputElement>('input[aria-label="context.notesLabel"]')!
    expect([input.selectionStart, input.selectionEnd]).toEqual([7, 10])
    expect(document.activeElement).not.toBe(input)
    input.setSelectionRange(0, 0)
    render('metadata a+b', 2)
    expect([input.selectionStart, input.selectionEnd]).toEqual([7, 10])
    flushSync(() => root.render(createElement(ContextAssetDetail, props)))
    input.setSelectionRange(0, 0)
    render('metadata a+b', 2)
    expect([input.selectionStart, input.selectionEnd]).toEqual([7, 10])
    render('notes', 2)
    expect([input.selectionStart, input.selectionEnd]).toEqual([11, 16])
    scrollIntoView.mockClear()
    render('title-only', 3)
    expect([input.selectionStart, input.selectionEnd]).toEqual([11, 16])
    expect(scrollIntoView).not.toHaveBeenCalled()
    expect(input.value).toBe(props.node.body)
    expect(props.onChangeNode).not.toHaveBeenCalled()
    expect(props.onCommitNode).not.toHaveBeenCalled()
  })
})
