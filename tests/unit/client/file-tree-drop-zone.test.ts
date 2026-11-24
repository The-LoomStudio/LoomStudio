// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FileTree, type FileTreeNode } from '../../../apps/studio-client/src/shared/ui/file-tree/file-tree.js'

type DropPosition = 'before' | 'inside' | 'after'
type CanDrop = (sourceId: string, targetId: string, position: DropPosition) => boolean

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
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

function row(id: string) {
  return container.querySelector<HTMLElement>(`[data-file-tree-node-id="${id}"]`)!
}

async function setup(canDrop: CanDrop = () => true) {
  const onMoveNode = vi.fn()
  const nodes: FileTreeNode[] = [
    { id: 'before', label: 'Before', kind: 'entry' },
    { id: 'folder', label: 'Folder', kind: 'folder', children: [
      { id: 'child', label: 'Child', kind: 'entry' },
    ] },
    { id: 'after', label: 'After', kind: 'entry' },
  ]
  await act(async () => root.render(createElement(FileTree, {
    ariaLabel: 'Resources',
    nodes,
    expandedIds: ['folder'],
    onExpandedIdsChange: vi.fn(),
    onSelect: vi.fn(),
    onMoveNode,
    canDrop,
    getDisclosureLabel: node => node.label,
    getDragLabel: node => node.label,
    moreActionsLabel: 'More',
  })))
  return { onMoveNode }
}

function createTransfer() {
  const values = new Map<string, string>()
  return {
    dropEffect: 'none',
    effectAllowed: 'none',
    setData(type: string, value: string) { values.set(type, value) },
    getData(type: string) { return values.get(type) ?? '' },
  } as DataTransfer
}

async function startDrag(sourceId: string) {
  const transfer = createTransfer()
  const handle = row(sourceId).querySelector<HTMLButtonElement>('button[draggable="true"]')!
  await act(async () => {
    const event = new Event('dragstart', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', { value: transfer })
    handle.dispatchEvent(event)
  })
  return transfer
}

function mockRowRect(id: string, top = 100, height = 40) {
  vi.spyOn(row(id), 'getBoundingClientRect').mockReturnValue({
    top,
    height,
    bottom: top + height,
    left: 0,
    right: 200,
    width: 200,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect)
}

async function dragOver(targetId: string, clientY: number, transfer: DataTransfer) {
  let event!: MouseEvent
  await act(async () => {
    event = new MouseEvent('dragover', { bubbles: true, cancelable: true, clientY })
    Object.defineProperty(event, 'dataTransfer', { value: transfer })
    row(targetId).dispatchEvent(event)
  })
  return event
}

async function drop(targetId: string, clientY: number, transfer: DataTransfer) {
  let event!: MouseEvent
  await act(async () => {
    event = new MouseEvent('drop', { bubbles: true, cancelable: true, clientY })
    Object.defineProperty(event, 'dataTransfer', { value: transfer })
    row(targetId).dispatchEvent(event)
  })
  return event
}

describe('file tree container drop zones', () => {
  it('drops before a folder when the pointer is near the top edge', async () => {
    const { onMoveNode } = await setup()
    const transfer = await startDrag('before')
    mockRowRect('folder')

    const over = await dragOver('folder', 104, transfer)
    expect(over.defaultPrevented).toBe(true)
    expect(transfer.dropEffect).toBe('move')
    expect(row('folder').dataset.fileTreeDropPosition).toBe('before')

    await drop('folder', 104, transfer)
    expect(onMoveNode).toHaveBeenCalledWith('before', 'folder', 'before')
    expect(row('folder').dataset.fileTreeDropPosition).toBeUndefined()
  })

  it('keeps the center of a folder as an inside drop', async () => {
    const { onMoveNode } = await setup()
    const transfer = await startDrag('before')
    mockRowRect('folder')

    await dragOver('folder', 120, transfer)
    expect(row('folder').dataset.fileTreeDropPosition).toBe('inside')

    await drop('folder', 120, transfer)
    expect(onMoveNode).toHaveBeenCalledWith('before', 'folder', 'inside')
  })

  it('drops after a folder when the pointer is near the bottom edge', async () => {
    const { onMoveNode } = await setup()
    const transfer = await startDrag('before')
    mockRowRect('folder')

    await dragOver('folder', 136, transfer)
    expect(row('folder').dataset.fileTreeDropPosition).toBe('after')

    await drop('folder', 136, transfer)
    expect(onMoveNode).toHaveBeenCalledWith('before', 'folder', 'after')
  })

  it('updates the insertion marker when the pointer crosses the center of the same row', async () => {
    const { onMoveNode } = await setup()
    const transfer = await startDrag('before')
    mockRowRect('folder')

    await dragOver('folder', 104, transfer)
    expect(row('folder').dataset.fileTreeDropPosition).toBe('before')
    await dragOver('folder', 136, transfer)
    expect(row('folder').dataset.fileTreeDropPosition).toBe('after')

    await drop('folder', 136, transfer)
    expect(onMoveNode).toHaveBeenCalledWith('before', 'folder', 'after')
  })

  it('does not fall back to inside when an edge position is rejected', async () => {
    const { onMoveNode } = await setup((_sourceId, _targetId, position) => position === 'inside')
    const transfer = await startDrag('before')
    mockRowRect('folder')

    const over = await dragOver('folder', 104, transfer)
    expect(over.defaultPrevented).toBe(false)
    expect(transfer.dropEffect).toBe('none')
    expect(row('folder').dataset.fileTreeDropPosition).toBeUndefined()

    await drop('folder', 104, transfer)
    expect(onMoveNode).not.toHaveBeenCalled()
  })

  it('uses the upper and lower halves when the container does not allow inside drops', async () => {
    const { onMoveNode } = await setup((_sourceId, _targetId, position) => position !== 'inside')
    const transfer = await startDrag('before')
    mockRowRect('folder')

    await dragOver('folder', 119, transfer)
    expect(row('folder').dataset.fileTreeDropPosition).toBe('before')
    await dragOver('folder', 120, transfer)
    expect(row('folder').dataset.fileTreeDropPosition).toBe('after')

    await drop('folder', 120, transfer)
    expect(onMoveNode).toHaveBeenCalledWith('before', 'folder', 'after')
  })
})
