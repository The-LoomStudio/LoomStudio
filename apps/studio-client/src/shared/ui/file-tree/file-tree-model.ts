export type FileTreeNode = {
  children?: FileTreeNode[]
  id: string
  label: string
  meta?: string
  isSection?: boolean
}

export type VisibleFileTreeNode = {
  node: FileTreeNode
  level: number
  parentId?: string
}

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

export function readVisibleFileTreeNodes(nodes: FileTreeNode[], expandedIds: Set<string>): VisibleFileTreeNode[] {
  return nodes.flatMap(node => readVisibleNode(node, expandedIds, 1))
}

export function readFileTreeKeyboardTarget(input: {
  expandedIds: Set<string>
  key: string
  nodeId: string
  visibleNodes: VisibleFileTreeNode[]
}): { focusId?: string; toggleId?: string } {
  const index = input.visibleNodes.findIndex(item => item.node.id === input.nodeId)
  const current = input.visibleNodes[index]
  if (!current) return {}

  if (input.key === 'Home') return { focusId: input.visibleNodes[0]?.node.id }
  if (input.key === 'End') return { focusId: input.visibleNodes.at(-1)?.node.id }
  if (input.key === 'ArrowDown') return { focusId: input.visibleNodes[index + 1]?.node.id ?? current.node.id }
  if (input.key === 'ArrowUp') return { focusId: input.visibleNodes[index - 1]?.node.id ?? current.node.id }
  if (input.key === 'ArrowRight') {
    if (current.node.children?.length && !input.expandedIds.has(current.node.id)) return { toggleId: current.node.id }
    const child = input.visibleNodes[index + 1]
    return { focusId: child?.parentId === current.node.id ? child.node.id : current.node.id }
  }
  if (input.key === 'ArrowLeft') {
    if (current.node.children?.length && input.expandedIds.has(current.node.id)) return { toggleId: current.node.id }
    return { focusId: current.parentId ?? current.node.id }
  }
  return {}
}

function flattenNodeIds(nodes: FileTreeNode[]): string[] {
  return nodes.flatMap(node => [node.id, ...flattenNodeIds(node.children ?? [])])
}

function readVisibleNode(
  node: FileTreeNode,
  expandedIds: Set<string>,
  level: number,
  parentId?: string,
): VisibleFileTreeNode[] {
  if (node.isSection) {
    return (node.children ?? []).flatMap(child => readVisibleNode(child, expandedIds, level, parentId))
  }

  const current = { node, level, parentId }
  if (!node.children?.length || !expandedIds.has(node.id)) return [current]
  return [current, ...node.children.flatMap(child => readVisibleNode(child, expandedIds, level + 1, node.id))]
}
