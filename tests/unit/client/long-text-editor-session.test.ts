import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ComponentProps, type ReactElement } from 'react'
import { LongTextEditor } from '../../../apps/studio-client/src/shared/ui/long-text-editor/long-text-editor.js'

const hooks = vi.hoisted(() => ({
  cursor: 0,
  values: [] as unknown[],
  effects: [] as (() => void)[],
}))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useId: () => 'editor-label',
  useImperativeHandle: () => undefined,
  useEffect: (effect: () => void) => { hooks.effects.push(effect) },
  useReducer: (_reduce: unknown, initial: unknown) => [initial, vi.fn()],
  useRef: (initial: unknown) => {
    const index = hooks.cursor++
    if (!(index in hooks.values)) hooks.values[index] = { current: initial }
    return hooks.values[index]
  },
  useState: (initial: unknown) => {
    const index = hooks.cursor++
    if (!(index in hooks.values)) hooks.values[index] = initial
    return [hooks.values[index], (value: unknown) => { hooks.values[index] = value }]
  },
}))

type Element = ReactElement<Record<string, unknown>>
const props: ComponentProps<typeof LongTextEditor> = {
  mode: 'preview', value: 'Original',
  clearLabel: '', clearedLabel: '', copiedLabel: '', copyFailedLabel: '', copyLabel: '',
  label: '', restoreInitialLabel: '', undoEditLabel: '', undoLabel: '',
  disableCodeWrapLabel: '', enableCodeWrapLabel: '', previewEmptyLabel: '',
  previewModeLabel: '', sourceModeLabel: '',
  onChange: vi.fn(), onCommit: vi.fn(), onModeChange: vi.fn(),
}

function render(mode: 'source' | 'preview', value = 'Original') {
  hooks.cursor = 0
  const component = LongTextEditor as unknown as {
    render(props: ComponentProps<typeof LongTextEditor>, ref: null): Element
  }
  const tree = component.render({ ...props, mode, value }, null)
  for (const effect of hooks.effects.splice(0)) effect()
  const children = tree.props.children as unknown[]
  const editorSlot = children.findIndex(child =>
    isValidElement<Record<string, unknown>>(child)
    && isValidElement<Record<string, unknown>>(child.props.children)
    && 'labelledBy' in child.props.children.props)
  const boundary = children[editorSlot] as Element | undefined
  return { editorSlot, boundary, editor: boundary?.props.children as Element | undefined }
}

beforeEach(() => { hooks.cursor = 0; hooks.values = []; hooks.effects = [] })

describe('LongTextEditor document session', () => {
  it('does not load source for a preview-only document, and retains its editor after visiting source', () => {
    expect(render('preview').editor).toBeUndefined()
    const source = render('source')
    const preview = render('preview', 'Edited')
    const returned = render('source', 'Edited')
    for (const next of [preview, returned]) {
      expect(next.editorSlot).toBe(source.editorSlot)
      expect(next.boundary?.type).toBe(source.boundary?.type)
      expect(next.editor?.type).toBe(source.editor?.type)
      expect(next.editor?.key).toBe(source.editor?.key)
      expect(next.editor?.props.value).toBe('Edited')
    }
    expect(preview.editor?.props.hidden).toBe(true)
    expect(returned.editor?.props.hidden).toBe(false)
  })

  it('retains an initially open source but does not carry its session into a new document mount', () => {
    const source = render('source')
    expect(render('preview').editor?.type).toBe(source.editor?.type)
    hooks.values = []
    expect(render('preview', 'Other document').editor).toBeUndefined()
  })
})
