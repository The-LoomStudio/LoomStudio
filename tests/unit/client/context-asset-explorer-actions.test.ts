import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ComponentProps, type ReactElement } from 'react'
import { ContextAssetExplorer } from '../../../apps/studio-client/src/features/context-assets/ui/context-asset-workbench.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'

const hooks = vi.hoisted(() => ({ cursor: 0, values: [] as unknown[], cleanups: [] as (() => void)[] }))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++
    if (!(index in hooks.values)) hooks.values[index] = initial
    return [hooks.values[index], (value: unknown) => {
      hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value
    }]
  },
  useRef: (initial: unknown) => {
    const index = hooks.cursor++
    if (!(index in hooks.values)) hooks.values[index] = { current: initial }
    return hooks.values[index]
  },
  useEffect: (effect: () => (() => void)) => { hooks.cleanups.push(effect()) },
}))
vi.mock('../../../apps/studio-client/src/shared/hooks/use-restorable-scroll.js', () => ({
  useRestorableScroll: () => ({ ref: { current: null }, onScroll() {} }),
}))
beforeEach(() => { hooks.cursor = 0; hooks.values = []; hooks.cleanups = [] })

type Element = ReactElement<Record<string, unknown>>
function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements)
  if (!isValidElement<Record<string, unknown>>(value)) return []
  return [value, ...Object.values(value.props).flatMap(elements)]
}

function fixture() {
  const failure = new Error('Write rejected')
  const root = { id: 'root', kind: 'folder' as const, label: 'Folder' }
  const props: ComponentProps<typeof ContextAssetExplorer> = {
    displayNodes: [root], query: '', selectedId: 'root', t: createTranslator('en-US'),
    scrollKey: 'test', workspaceId: 'test',
    onAddNode: vi.fn().mockRejectedValue(failure),
    onDeleteNode: vi.fn().mockRejectedValue(failure),
    onDuplicateNode: vi.fn().mockRejectedValue(failure),
    onRenameNode: vi.fn().mockRejectedValue(failure),
    onExpandedIdsChange: vi.fn(), onMoveNode: vi.fn(), onQueryChange: vi.fn(),
    onSelectId: vi.fn(), onToggleEnabled: vi.fn(),
  }
  const render = () => {
    hooks.cursor = 0
    return elements(ContextAssetExplorer(props))
  }
  const tree = () => render().find(element => typeof element.props.getActions === 'function')!
  const action = (id: string) => {
    const actions = (tree().props.getActions as (node: typeof root) => Array<{ id: string; onSelect(): unknown }>)(root)
    return actions.find(action => action.id === id)!.onSelect()
  }
  return { props, render, tree, action }
}

describe('Context Asset explorer action outcomes', () => {
  it.each(['add', 'duplicate', 'delete'])('keeps the current selection on failed %s', async action => {
    const state = fixture()
    await state.action(action)
    expect(state.props.onSelectId).not.toHaveBeenCalled()
    expect(state.render().find(element => element.props.role === 'alert')?.props.children).toBe('Write rejected')
  })

  it('keeps rename editing open when saving fails', async () => {
    const state = fixture()
    await state.action('rename')
    await (state.tree().props.onEditCommit as (id: string, label: string) => Promise<void>)('root', 'New title')
    expect(state.props.onRenameNode).toHaveBeenCalledWith('root', 'New title')
    expect(state.tree().props.editingId).toBe('root')
  })

  it('does not select a created node after its source workspace unmounts', async () => {
    const state = fixture()
    let resolve!: (id: string) => void
    state.props.onAddNode = vi.fn(() => new Promise(accept => { resolve = accept }))
    const pending = state.action('add')
    hooks.cleanups.forEach(cleanup => cleanup())
    resolve('created')
    await pending
    expect(state.props.onSelectId).not.toHaveBeenCalled()
  })
})
