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
const props = {
  mode: 'preview', value: 'Original',
  clearLabel: '', clearedLabel: '', copiedLabel: '', copyFailedLabel: '', copyLabel: '',
  label: '', restoreInitialLabel: 'Restore initial', undoEditLabel: 'Undo edit', undoLabel: '',
  disableCodeWrapLabel: '', enableCodeWrapLabel: '', previewEmptyLabel: '',
  previewModeLabel: '', sourceModeLabel: '',
  onChange: vi.fn(), onCommit: vi.fn(), onModeChange: vi.fn(),
} satisfies ComponentProps<typeof LongTextEditor>

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
  return { tree, editorSlot, boundary, editor: boundary?.props.children as Element | undefined }
}

beforeEach(() => { hooks.cursor = 0; hooks.values = []; hooks.effects = [] })

describe('LongTextEditor document session', () => {
  it('keeps Undo enabled when history exists even after text returns to its initial content', () => {
    const collect = (value: unknown): Element[] => {
      if (Array.isArray(value)) return value.flatMap(collect)
      if (!isValidElement<Record<string, unknown>>(value)) return []
      return [value, ...Object.values(value.props).flatMap(collect)]
    }
    const source = render('source')
    ;(source.editor!.props.onUndoAvailabilityChange as (available: boolean) => void)(true)
    const controls = collect(render('source', 'Original').tree)
    expect(controls.find(item => item.props['aria-label'] === 'Undo edit')?.props.disabled).toBe(false)
    expect(controls.find(item => item.props['aria-label'] === 'Restore initial')?.props.disabled).toBe(true)
  })
  it('prevents default mouse-down behavior on toolbar actions without committing', () => {
    const collect = (value: unknown): Element[] => {
      if (Array.isArray(value)) return value.flatMap(collect)
      if (!isValidElement<Record<string, unknown>>(value)) return []
      return [value, ...Object.values(value.props).flatMap(collect)]
    }
    const actions = collect(render('source').tree).filter(element => element.props.onMouseDown)
    expect(actions.length).toBeGreaterThan(0)
    for (const action of actions) {
      const preventDefault = vi.fn()
      ;(action.props.onMouseDown as (event: { preventDefault(): void }) => void)({ preventDefault })
      expect(preventDefault).toHaveBeenCalledOnce()
    }
    expect(props.onCommit).not.toHaveBeenCalled()
  })

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

  it('enables the diff action only when changes exist', () => {
    const collect = (value: unknown): Element[] => {
      if (Array.isArray(value)) return value.flatMap(collect)
      if (!isValidElement<Record<string, unknown>>(value)) return []
      return [value, ...Object.values(value.props).flatMap(collect)]
    }
    const initialTree = collect(render('source', 'Original').tree)
    const diffInitial = initialTree.find(item => item.props['aria-label'] === '查看差异')
    expect(diffInitial?.props.disabled).toBe(true)

    const editedTree = collect(render('source', 'Modified').tree)
    const diffEdited = editedTree.find(item => item.props['aria-label'] === '查看差异')
    expect(diffEdited?.props.disabled).toBe(false)
  })
})
