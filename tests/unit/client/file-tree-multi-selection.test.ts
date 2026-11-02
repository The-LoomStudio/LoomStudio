// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { FileTree, type FileTreeBatchAction, type FileTreeNode } from '../../../apps/studio-client/src/shared/ui/file-tree/file-tree.js'

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (this: HTMLDialogElement) { this.open = true })
  vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (this: HTMLDialogElement) { this.open = false })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
async function setup(actions?: FileTreeBatchAction[]) {
  const onSelect = vi.fn()
  const run = vi.fn(async (_nodes: FileTreeNode[]) => {})
  const nodes: FileTreeNode[] = [{ id: 'folder', label: 'Folder', kind: 'folder', children: [
    { id: 'a', label: 'A', kind: 'entry' }, { id: 'b', label: 'B', kind: 'entry' }, { id: 'c', label: 'C', kind: 'entry' },
  ] }, { id: 'hidden', label: 'Hidden', kind: 'folder', children: [{ id: 'd', label: 'D', kind: 'entry' }] }]
  await act(async () => root.render(createElement(FileTree, {
    ariaLabel: 'Resources', nodes, expandedIds: ['folder'], onExpandedIdsChange: vi.fn(), onSelect,
    getDisclosureLabel: node => node.label, getDragLabel: node => node.label, moreActionsLabel: 'More',
    getBatchActions: () => actions ?? [{ id: 'enable', label: 'Enable', run }],
  })))
  return { onSelect, run }
}
function row(id: string) { return container.querySelector<HTMLElement>(`[data-file-tree-node-id="${id}"]`)! }
function selected() { return [...container.querySelectorAll<HTMLElement>('[role="treeitem"][aria-selected="true"]')].map(item => item.dataset.fileTreeNodeId) }
it('reveals a target after its ancestors expand and keeps later refreshes from stealing focus', async () => {
  const nodes: FileTreeNode[] = [{ id: 'root', label: 'Root', children: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }]
  const render = (expandedIds: string[]) => root.render(createElement(FileTree, {
    ariaLabel: 'State', nodes: [...nodes], expandedIds, revealId: 'b',
    onExpandedIdsChange: vi.fn(), onSelect: vi.fn(),
    getDisclosureLabel: node => node.label, getDragLabel: node => node.label, moreActionsLabel: 'More',
  }))
  await act(async () => render([]))
  expect(document.activeElement).not.toBe(row('b'))
  await act(async () => render(['root']))
  await vi.waitFor(() => expect(document.activeElement).toBe(row('b')))
  row('a').focus()
  await act(async () => render(['root']))
  expect(document.activeElement).toBe(row('a'))
})

async function stroke(start: string, end?: string, shift = false) {
  await act(async () => row(start).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1, ctrlKey: !shift, shiftKey: shift })))
  if (end) await act(async () => row(end).dispatchEvent(new PointerEvent('pointermove', { bubbles: true, buttons: 1, pointerId: 1 })))
  await act(async () => {
    row(end ?? start).dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }))
    row(end ?? start).dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: !shift, shiftKey: shift }))
  })
}
it('paints the visible range, does not open an editor, and removes the range on a second stroke', async () => {
  const { onSelect } = await setup()
  await stroke('a', 'c')
  expect(selected()).toEqual(['a', 'b', 'c'])
  expect(onSelect).not.toHaveBeenCalled()
  expect(container.querySelector('[role="toolbar"]')).not.toBeNull()
  await stroke('a', 'b')
  expect(selected()).toEqual(['c'])
})
it('keeps Shift drag selection when the release click targets the common tree container', async () => {
  const { onSelect } = await setup()
  await act(async () => row('a').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1, shiftKey: true })))
  await act(async () => row('c').dispatchEvent(new PointerEvent('pointermove', { bubbles: true, buttons: 1, pointerId: 1, shiftKey: true })))
  const tree = container.querySelector('[role="tree"]')!
  await act(async () => {
    row('c').dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, shiftKey: true }))
    tree.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }))
  })
  expect(selected()).toEqual(['a', 'b', 'c'])
  expect(onSelect).not.toHaveBeenCalled()
  expect(container.querySelector('[role="toolbar"]')).not.toBeNull()
})
it('selects by Shift and keyboard without including collapsed children', async () => {
  await setup()
  await stroke('a')
  await stroke('c', undefined, true)
  expect(selected()).toEqual(['a', 'b', 'c'])
  await act(async () => row('a').dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true })))
  expect(selected()).toEqual(['a', 'b', 'c'])
  await act(async () => row('a').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(selected()).toEqual([])
})
it('runs only selected items and retains failed items for retry', async () => {
  const run = vi.fn(async (_nodes: FileTreeNode[]) => ({ failedIds: ['b'], error: 'B failed' }))
  await setup([{ id: 'enable', label: 'Enable', run }])
  await stroke('a', 'c')
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === 'Enable')!.click())
  expect(run.mock.calls[0]?.[0].map((node: FileTreeNode) => node.id)).toEqual(['a', 'b', 'c'])
  expect(selected()).toEqual(['b'])
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('B failed')
})
it('confirms deletion before invoking a batch mutation', async () => {
  const run = vi.fn(async (_nodes: FileTreeNode[]) => {})
  await setup([{ id: 'delete', label: 'Delete', tone: 'danger', confirm: true, run }])
  await stroke('a')
  await act(async () => [...container.querySelectorAll('button')].find(button => button.textContent === 'Delete')!.click())
  expect(run).not.toHaveBeenCalled()
  const dialog = container.querySelector('dialog[open]')!
  await act(async () => [...dialog.querySelectorAll('button')].find(button => button.textContent === 'Delete')!.click())
  expect(run).toHaveBeenCalledTimes(1)
})

it('uses the whole selection in the context menu', async () => {
  const { run } = await setup()
  await stroke('a', 'c')
  await act(async () => row('b').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 20, clientY: 20 })))
  const menuItem = document.querySelector<HTMLElement>('[role="menuitem"]')!
  expect(menuItem?.textContent).toContain('Enable')
  expect(container.querySelector('[role="toolbar"]')).toBeNull()
  await act(async () => menuItem.click())
  expect(run.mock.calls[0]?.[0].map((node: FileTreeNode) => node.id)).toEqual(['a', 'b', 'c'])
})

 it('expands folders without selecting them and opens details only through the explicit action', async () => {
  const onSelect = vi.fn()
  const onExpandedIdsChange = vi.fn()
  const folder: FileTreeNode = { id: 'folder', label: 'Folder', kind: 'folder', children: [{ id: 'file', label: 'File', kind: 'entry' }] }
  await act(async () => root.render(createElement(FileTree, {
    ariaLabel: 'Resources', nodes: [folder], expandedIds: ['folder'], onExpandedIdsChange, onSelect,
    canOpenFolderDetails: () => true,
    getDisclosureLabel: node => node.label, getDragLabel: node => node.label, moreActionsLabel: 'More',
  })))
  await act(async () => row('folder').click())
  expect(onExpandedIdsChange).toHaveBeenLastCalledWith([])
  expect(onSelect).not.toHaveBeenCalled()
  onExpandedIdsChange.mockClear()
  const details = row('folder').querySelector<HTMLButtonElement>('button[title]')!
  await act(async () => details.click())
  expect(onSelect).toHaveBeenLastCalledWith(folder)
  expect(onExpandedIdsChange).not.toHaveBeenCalled()
  await act(async () => row('file').click())
  expect(onSelect).toHaveBeenLastCalledWith(folder.children![0])
 })
 it('does not offer details for category folders', async () => {
  await setup()
  expect(row('folder').querySelector('svg.lucide-info')).toBeNull()
 })
