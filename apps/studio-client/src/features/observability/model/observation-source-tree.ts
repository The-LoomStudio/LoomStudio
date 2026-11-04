import type { ObservationSource } from './observation-view.js'

export type SourceTreeNode = {
  id: string
  source?: ObservationSource
  title: string
  children: SourceTreeNode[]
  included: boolean
  count: number
}

/** Arrange recorded relationships only; names and paths never stand in for identity. */
export function buildSourceTree(sources: ObservationSource[], otherTitle: string): SourceTreeNode[] {
  const byId = new Map(sources.map(source => [source.id, source]))
  const anchors = sources.filter(source => source.nodeKind === 'virtual')
  const anchorById = new Map(anchors.flatMap(source => [source.id, ...(source.anchorIds ?? [])].map(id => [id, source] as const)))
  const roots: SourceTreeNode[] = []
  function create(id: string, title: string, source?: ObservationSource): SourceTreeNode {
    return { id, title: source ? sourceDisplayTitle(source) : title, source, children: [], included: false, count: 0 }
  }
  function ancestry(source: ObservationSource) {
    const path: ObservationSource[] = []
    const seen = new Set([source.id])
    let parent = source.parentId ? byId.get(source.parentId) : undefined
    while (parent && !seen.has(parent.id)) {
      seen.add(parent.id)
      path.unshift(parent)
      parent = parent.parentId ? byId.get(parent.parentId) : undefined
    }
    return path
  }
  function appendPath(path: ObservationSource[], parent?: SourceTreeNode): SourceTreeNode {
    for (const part of path) {
      const siblings = parent?.children ?? roots
      let node = siblings.find(item => item.source?.id === part.id)
      if (!node) {
        node = create(parent ? JSON.stringify([parent.id, part.id]) : part.id, part.title, part)
        siblings.push(node)
      }
      parent = node
    }
    return parent!
  }
  function ownPath(source: ObservationSource): SourceTreeNode {
    const path = [...ancestry(source), source]
    // Preserve the recorded skeleton, including containers above each anchor.
    // Only evidence without a complete structural origin belongs in the fallback.
    if (path[0].nodeKind && !path[0].parentId) return appendPath(path)
    let other = roots.find(node => node.id === 'unassigned')
    if (!other) { other = create('unassigned', otherTitle); roots.push(other) }
    return appendPath(path, other)
  }
  for (const anchor of anchors) ownPath(anchor)
  for (const source of sources) {
    const included = source.included ?? source.active
    if (source.nodeKind === 'virtual') {
      ownPath(source).included = included
      continue
    }
    // Containers provide structure; they are not rejected content entries.
    if (['module', 'folder', 'message'].includes(source.nodeKind ?? '') && !included) continue
    const parents = ancestry(source)
    const actual = source.injections?.map(item => item.targetAnchorId).filter((id): id is string => !!id) ?? []
    const declared = source.targetAnchorIds?.length ? source.targetAnchorIds : [...parents].reverse().find(item => item.targetAnchorIds?.length)?.targetAnchorIds ?? []
    const targets = [...new Set((included ? actual : declared).map(id => anchorById.get(id)).filter((anchor): anchor is ObservationSource => !!anchor))]
    if (!targets.length) {
      ownPath(source).included = included
      continue
    }
    for (const anchor of targets) {
      const parent = ownPath(anchor)
      const anchorPath = new Set([...ancestry(anchor), anchor].map(item => item.id))
      // An in-preset contribution must not repeat the preset above its target.
      const path = [...parents, source].filter(item => !anchorPath.has(item.id))
      if (path.length) appendPath(path, parent).included = included
    }
  }
  const sourceOrder = new Map(sources.map((source, index) => [source.id, index]))
  function sort(nodes: SourceTreeNode[]) {
    nodes.sort((a, b) => {
      if (a.id === 'unassigned') return 1
      if (b.id === 'unassigned') return -1
      const left = a.source!, right = b.source!
      // Older snapshots have no orderIndex; retain their captured source order.
      return (left.orderIndex ?? sourceOrder.get(left.id)!) - (right.orderIndex ?? sourceOrder.get(right.id)!)
    })
    nodes.forEach(node => sort(node.children))
  }

  function count(node: SourceTreeNode): number {
    const own = node.included ? 1 : 0
    node.count = own + node.children.reduce((sum, child) => sum + count(child), 0)
    node.included = node.count > 0
    return node.count
  }
  sort(roots)
  roots.forEach(count)
  return roots
}

export function sourceDisplayTitle(source: ObservationSource): string {
  if (source.nodeKind !== 'virtual') return source.title
  return source.anchorIds?.find(id => id.startsWith('@')) ?? source.anchorIds?.find(id => id !== source.id) ?? source.id
}

/** Keep ancestry for matching entries without exposing unrelated children or own content. */
export function filterSourceTree(nodes: SourceTreeNode[], query: string, sourceIds?: Set<string>, anchor?: string): SourceTreeNode[] {
  const needle = query.trim().toLocaleLowerCase()
  function visit(items: SourceTreeNode[], pathMatches = false): SourceTreeNode[] {
    return items.flatMap(node => {
      const source = node.source
      if (anchor !== undefined && source?.nodeKind === 'virtual' && source.id !== anchor && !source.anchorIds?.includes(anchor)) return []
      const matchesPath = pathMatches || (!!needle && node.title.toLocaleLowerCase().includes(needle))
      const textMatches = !needle || matchesPath || [source?.path, source?.original, source?.rendered, ...(source?.injections ?? []).flatMap(item => [item.role, item.rendered])].some(text => text?.toLocaleLowerCase().includes(needle))
      const own = !!source && (!sourceIds || sourceIds.has(source.id)) && textMatches
      const children = visit(node.children, matchesPath)
      if (!own && !children.length) return []
      const count = (own && (source?.included ?? source?.active) ? 1 : 0) + children.reduce((sum, child) => sum + child.count, 0)
      return [{ ...node, source: source && !own ? { ...source, included: false } : source, children, count, included: count > 0 }]
    })
  }
  return visit(nodes)
}

/** Sort siblings only; missing estimates follow measured entries and ties keep authored order. */
export function sortSourceTreeByTokens(nodes: SourceTreeNode[], counts: Map<string, number | undefined>): SourceTreeNode[] {
  function visit(items: SourceTreeNode[]): Array<{ node: SourceTreeNode; values: Map<string, number | undefined>; total?: number }> {
    return items.map(node => {
      const children = visit(node.children)
      const values = new Map(children.flatMap(child => [...child.values]))
      if (node.source && (node.source.included ?? node.source.active) && (!node.children.length || node.source.injections?.length)) values.set(node.source.id, counts.get(node.source.id))
      const known = [...values.values()]
      const total = known.length && known.every(value => value !== undefined) ? known.reduce<number>((sum, value) => sum + value!, 0) : undefined
      return { node: { ...node, children: children.map(child => child.node) }, values, total }
    }).sort((a, b) => (b.total ?? -1) - (a.total ?? -1))
  }
  return visit(nodes).map(item => item.node)
}
