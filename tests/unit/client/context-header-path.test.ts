import { describe, expect, it, vi } from 'vitest'
import { buildContextPathSegments } from '../../../apps/studio-client/src/features/prompt-resources/ui/context-asset-header/build-context-path-segments.js'
import type { ContextAssetNode } from '../../../apps/studio-client/src/entities/index.js'
import { findContextAssetByVirtualPath, findContextAssetPath, resolveContextAssetUri } from '../../../apps/studio-client/src/features/prompt-resources/model/context-asset-tree.js'

describe('workbench header path', () => {
  it('round trips full paths without falling back to a same-named leaf', () => {
    const a: ContextAssetNode = { id: 'a-leaf', label: 'Common', kind: 'entry' }
    const b: ContextAssetNode = { ...a, id: 'b-leaf' }
    const rootLeaf: ContextAssetNode = { ...a, id: 'root-leaf' }
    const nodes: ContextAssetNode[] = [{ id: 'root', label: 'Root', kind: 'folder', children: [
      { id: 'a', label: 'A', kind: 'folder', children: [a] },
      { id: 'b', label: 'B', kind: 'folder', children: [b] },
      rootLeaf,
    ] }]
    for (const node of [a, b, rootLeaf]) {
      const uri = resolveContextAssetUri(node, findContextAssetPath(nodes, node.id))
      expect(findContextAssetByVirtualPath(nodes, uri)).toBe(node)
    }
    expect(findContextAssetByVirtualPath(nodes, '@/Missing/Common.md')).toBeUndefined()
    expect(findContextAssetByVirtualPath(nodes, 'Common.md')).toBe(a)
    nodes[0]!.children!.push({ ...rootLeaf, id: 'duplicate' })
    expect(findContextAssetByVirtualPath(nodes, '@/Common.md')).toBeUndefined()
  })

  it('resolves anchored asset directories with the same URI contract', () => {
    const leaf: ContextAssetNode = { id: 'leaf', label: 'Map', kind: 'entry' }
    const nodes: ContextAssetNode[] = [{ id: 'root', label: '@assets', kind: 'folder', children: [leaf] }]
    const uri = resolveContextAssetUri(leaf, findContextAssetPath(nodes, leaf.id))
    expect(uri).toBe('@assets/Map.md')
    expect(findContextAssetByVirtualPath(nodes, uri)).toBe(leaf)
    expect(findContextAssetByVirtualPath(nodes, '@other/Map.md')).toBeUndefined()
  })
  it('omits the root and keeps each level bound to its own siblings and selection callback', () => {
    const leaf: ContextAssetNode = { id: 'leaf', label: 'Leaf', kind: 'entry' }
    const sibling: ContextAssetNode = { id: 'sibling', label: 'Sibling', kind: 'entry' }
    const folder: ContextAssetNode = { id: 'folder', label: 'Folder', kind: 'folder', children: [leaf, sibling] }
    const root: ContextAssetNode = { id: 'root', label: 'Root', kind: 'folder', children: [folder] }
    const select = vi.fn()
    const segments = buildContextPathSegments([root, folder, leaf], select)
    expect(segments.map(segment => segment.id)).toEqual(['folder', 'leaf'])
    expect(segments[0].options?.map(option => option.id)).toEqual(['folder'])
    expect(segments[1].options?.map(option => option.id)).toEqual(['leaf', 'sibling'])
    segments[1].onSelect?.('sibling')
    expect(select).toHaveBeenCalledWith('sibling')
    expect(buildContextPathSegments([root], select)).toEqual([])
  })
})
