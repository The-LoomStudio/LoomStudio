import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ComponentProps, type ReactElement } from 'react'
import { ContextAssetExplorer, ContextAssetEditor } from '../../../apps/studio-client/src/features/prompt-resources/ui/context-asset-workbench.js'
import { ContextAssetDetailHeader } from '../../../apps/studio-client/src/features/prompt-resources/ui/context-asset-detail-header/context-asset-detail-header.js'
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
  useRestorableScroll: () => ({ ref: { current: null }, attach() {}, onScroll() {} }),
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
  it('uses preset-root display nodes to expose Message and history actions instead of text actions', () => {
    const state = fixture()
    state.props.displayNodes = [{ id: 'root', kind: 'folder', category: 'preset-root', label: 'Preset', children: [] }]
    state.props.onAddMessageBlockNode = vi.fn()
    state.props.onAddMessageSequenceNode = vi.fn()
    const actions = (state.tree().props.getActions as (node: unknown) => Array<{ id: string }>)(state.props.displayNodes[0])
    expect(actions.map(action => action.id)).toContain('addMessageBlock')
    expect(actions.map(action => action.id)).toContain('addMessageSequence')
    expect(actions.map(action => action.id)).not.toContain('add')
    expect(actions.map(action => action.id)).not.toContain('duplicate')
  })

  it('toggles only a folder and displays inherited disabling without changing child switches', () => {
    const state = fixture()
    const onEntry = { id: 'on', kind: 'entry' as const, label: 'On', enabled: true }
    const offEntry = { id: 'off', kind: 'entry' as const, label: 'Off', enabled: false }
    const anchor = { id: 'anchor', kind: 'virtual' as const, label: '@custom.anchor' }
    const folder = { id: 'folder', kind: 'folder' as const, label: 'Optional group', enabled: false, children: [onEntry, offEntry, anchor] }
    state.props.displayNodes = [folder]
    const tree = state.tree().props
    const renderTrailing = tree.renderTrailing as (node: unknown) => unknown
    const isMuted = tree.isMuted as (node: unknown) => boolean
    expect([folder, ...folder.children].every(isMuted)).toBe(true)
    const folderToggle = elements(renderTrailing(folder)).find(element => element.type === 'button')!
    expect(folderToggle.props['aria-label']).toBe('Enable group Optional group')
    ;(folderToggle.props.onClick as (event: unknown) => void)({ stopPropagation() {} })
    expect(state.props.onToggleEnabled).toHaveBeenCalledExactlyOnceWith('folder', true)
    const childToggle = elements(renderTrailing(onEntry)).find(element => element.type === 'button')!
    expect(childToggle.props['aria-pressed']).toBe(true)
    expect(elements(renderTrailing(anchor)).find(element => element.props.role === 'img')?.props['aria-label']).toContain('Optional group')
    expect(elements(renderTrailing({ ...folder, category: 'preset-root' })).some(element => element.type === 'button')).toBe(false)
    expect(elements(renderTrailing({ ...folder, readOnly: true })).some(element => element.type === 'button')).toBe(false)

    const editor = elements(ContextAssetEditor({
      node: onEntry, pathNodes: [folder, onEntry], activationEditable: true, editorMode: 'source', metadataOpen: false,
      t: state.props.t, onChangeNode: vi.fn(), onCommitNode: vi.fn(), onEditorModeChange: vi.fn(), onMetadataOpenChange: vi.fn(),
    }))
    expect(editor.find(element => 'inheritedDisabled' in element.props)?.props.inheritedDisabled).toBe(true)
    const header = editor.find(element => element.type === ContextAssetDetailHeader)!
    const headerElements = elements(ContextAssetDetailHeader(header.props as ComponentProps<typeof ContextAssetDetailHeader>))
    expect(headerElements.find(element => element.props.role === 'status')?.props.children).toContain('Optional group')
    expect(headerElements.find(element => 'checked' in element.props)?.props.checked).toBe(true)

    folder.enabled = true
    const restoredIsMuted = state.tree().props.isMuted as (node: unknown) => boolean
    expect(restoredIsMuted(onEntry)).toBe(false)
    expect(restoredIsMuted(anchor)).toBe(false)
    expect(restoredIsMuted(offEntry)).toBe(true)
    expect(folder.children).toEqual([onEntry, offEntry, anchor])
    expect(onEntry.enabled).toBe(true)
    expect(offEntry.enabled).toBe(false)
  })

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
    state.props.onAddNode = vi.fn(() => new Promise<string>(accept => { resolve = accept }))
    const pending = state.action('add')
    hooks.cleanups.forEach(cleanup => cleanup())
    resolve('created')
    await pending
    expect(state.props.onSelectId).not.toHaveBeenCalled()
  })
})
