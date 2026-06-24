import type { FileTreeNode } from './file-tree.js'

export function findNodeById(nodes: FileTreeNode[], id: string): FileTreeNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node
    if (node.children) {
      const found = findNodeById(node.children, id)
      if (found) return found
    }
  }
  return undefined
}

export function readDropPosition(nodes: FileTreeNode[], draggedId: string, overId: string): 'before' | 'after' {
  const ids = flattenNodeIds(nodes)
  const draggedIndex = ids.indexOf(draggedId)
  const overIndex = ids.indexOf(overId)
  if (draggedIndex < 0 || overIndex < 0) return 'after'
  return draggedIndex > overIndex ? 'before' : 'after'
}

function flattenNodeIds(nodes: FileTreeNode[]): string[] {
  return nodes.flatMap(node => [node.id, ...flattenNodeIds(node.children ?? [])])
}
