import { describe, expect, it } from 'vitest'
import { readFileTreeKeyboardTarget, readVisibleFileTreeNodes, type FileTreeNode } from './file-tree-model.js'

const nodes: FileTreeNode[] = [
  {
    id: 'section',
    label: 'Section',
    isSection: true,
    children: [
      {
        id: 'parent',
        label: 'Parent',
        children: [
          { id: 'child-a', label: 'Child A' },
          { id: 'child-b', label: 'Child B' },
        ],
      },
      { id: 'sibling', label: 'Sibling' },
    ],
  },
]

describe('file tree keyboard model', () => {
  it('flattens only visible treeitems and keeps visual sections outside the treeitem order', () => {
    expect(readVisibleFileTreeNodes(nodes, new Set()).map(item => [item.node.id, item.level, item.parentId])).toEqual([
      ['parent', 1, undefined],
      ['sibling', 1, undefined],
    ])
    expect(readVisibleFileTreeNodes(nodes, new Set(['parent'])).map(item => [item.node.id, item.level, item.parentId])).toEqual([
      ['parent', 1, undefined],
      ['child-a', 2, 'parent'],
      ['child-b', 2, 'parent'],
      ['sibling', 1, undefined],
    ])
  })

  it('moves through visible order with arrows, Home and End', () => {
    const expandedIds = new Set(['parent'])
    const visibleNodes = readVisibleFileTreeNodes(nodes, expandedIds)

    expect(readFileTreeKeyboardTarget({ expandedIds, key: 'ArrowDown', nodeId: 'parent', visibleNodes })).toEqual({ focusId: 'child-a' })
    expect(readFileTreeKeyboardTarget({ expandedIds, key: 'ArrowUp', nodeId: 'sibling', visibleNodes })).toEqual({ focusId: 'child-b' })
    expect(readFileTreeKeyboardTarget({ expandedIds, key: 'Home', nodeId: 'child-b', visibleNodes })).toEqual({ focusId: 'parent' })
    expect(readFileTreeKeyboardTarget({ expandedIds, key: 'End', nodeId: 'parent', visibleNodes })).toEqual({ focusId: 'sibling' })
  })

  it('expands, enters children, collapses and returns to the parent with horizontal arrows', () => {
    const collapsedIds = new Set<string>()
    const collapsedNodes = readVisibleFileTreeNodes(nodes, collapsedIds)
    expect(readFileTreeKeyboardTarget({ expandedIds: collapsedIds, key: 'ArrowRight', nodeId: 'parent', visibleNodes: collapsedNodes })).toEqual({ toggleId: 'parent' })

    const expandedIds = new Set(['parent'])
    const visibleNodes = readVisibleFileTreeNodes(nodes, expandedIds)
    expect(readFileTreeKeyboardTarget({ expandedIds, key: 'ArrowRight', nodeId: 'parent', visibleNodes })).toEqual({ focusId: 'child-a' })
    expect(readFileTreeKeyboardTarget({ expandedIds, key: 'ArrowLeft', nodeId: 'parent', visibleNodes })).toEqual({ toggleId: 'parent' })
    expect(readFileTreeKeyboardTarget({ expandedIds, key: 'ArrowLeft', nodeId: 'child-b', visibleNodes })).toEqual({ focusId: 'parent' })
  })
})
