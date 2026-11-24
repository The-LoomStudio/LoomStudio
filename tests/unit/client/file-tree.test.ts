import { findNodeById, readDragTopScrollSpeed, readDropPosition, readDropZone, readVisibleFileTreeNodes } from '../../../apps/studio-client/src/shared/ui/file-tree/file-tree-model.js'
import type { FileTreeNode } from '../../../apps/studio-client/src/shared/ui/file-tree/file-tree.js'
import { describe, expect, it } from 'vitest'

describe('file tree model', () => {
  it('finds nested nodes by id', () => {
    expect(findNodeById(nodes(), 'child-b')?.label).toBe('Child B')
    expect(findNodeById(nodes(), 'missing')).toBeUndefined()
  })

  it('reads drop position from flattened tree order', () => {
    expect(readDropPosition(nodes(), 'child-b', 'root-a')).toBe('before')
    expect(readDropPosition(nodes(), 'root-a', 'child-b')).toBe('after')
    expect(readDropPosition(nodes(), 'missing', 'child-b')).toBe('after')
  })

  it('uses edge zones when a container allows drops inside', () => {
    const row = { rowTop: 100, rowHeight: 40, insideAllowed: true }
    expect(readDropZone({ ...row, clientY: 104 })).toBe('before')
    expect(readDropZone({ ...row, clientY: 110 })).toBe('inside')
    expect(readDropZone({ ...row, clientY: 120 })).toBe('inside')
    expect(readDropZone({ ...row, clientY: 130 })).toBe('inside')
    expect(readDropZone({ ...row, clientY: 136 })).toBe('after')
  })

  it('splits the row when a container does not allow drops inside', () => {
    const row = { rowTop: 100, rowHeight: 40, insideAllowed: false }
    expect(readDropZone({ ...row, clientY: 104 })).toBe('before')
    expect(readDropZone({ ...row, clientY: 119 })).toBe('before')
    expect(readDropZone({ ...row, clientY: 120 })).toBe('after')
    expect(readDropZone({ ...row, clientY: 136 })).toBe('after')
  })

  it('handles rows without a measurable height without producing an inside drop when unsupported', () => {
    expect(readDropZone({ clientY: 100, rowTop: 100, rowHeight: 0, insideAllowed: true })).toBe('inside')
    expect(readDropZone({ clientY: 100, rowTop: 100, rowHeight: 0, insideAllowed: false })).toBe('before')
  })

  it('keeps large collapsed branches out of the virtualized visible model', () => {
    const children = Array.from({ length: 500 }, (_, index) => ({ id: `child-${index}`, label: `Child ${index}` }))
    const tree = [{ id: 'root', label: 'Root', children }]

    expect(readVisibleFileTreeNodes(tree, new Set())).toHaveLength(1)
    expect(readVisibleFileTreeNodes(tree, new Set(['root']))).toHaveLength(501)
  })

  it('scrolls toward the top while dragging over the search area, but not beyond the list width', () => {
    const rect = { left: 100, right: 400, top: 160 }
    expect(readDragTopScrollSpeed(200, 100, rect)).toBeGreaterThan(0)
    expect(readDragTopScrollSpeed(200, 175, rect)).toBeGreaterThan(0)
    expect(readDragTopScrollSpeed(90, 100, rect)).toBe(0)
    expect(readDragTopScrollSpeed(200, 60, rect)).toBe(0)
    expect(readDragTopScrollSpeed(200, 250, rect)).toBe(0)
  })
})

function nodes(): FileTreeNode[] {
  return [
    {
      id: 'root-a',
      label: 'Root A',
      children: [
        { id: 'child-a', label: 'Child A' },
        { id: 'child-b', label: 'Child B' },
      ],
    },
    { id: 'root-b', label: 'Root B' },
  ]
}
