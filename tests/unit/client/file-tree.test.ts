import { findNodeById, readDropPosition } from '../../../apps/studio-client/src/shared/ui/file-tree/file-tree-model.js'
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
