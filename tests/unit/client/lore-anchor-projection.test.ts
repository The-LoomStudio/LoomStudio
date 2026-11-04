import { describe, expect, it } from 'vitest'
import { groupLoreByAnchor } from '../../../apps/studio-client/src/features/prompt-resources/model/lore-anchor-projection.js'
import type { ContextAssetNode } from '../../../apps/studio-client/src/entities/index.js'

describe('Lore anchor projection', () => {
  it('groups by first appearance, preserves tree order and distinguishes candidates from disabled entries', () => {
    const root: ContextAssetNode = { id: 'root', kind: 'folder', category: 'lore-root', label: 'People', children: [
      { id: 'bob', kind: 'folder', label: 'Bob', enabled: false, children: [
        { id: 'b-dynamic', kind: 'entry', label: 'Dynamic', capabilities: { targetAnchorId: '@lore.lower' } },
        { id: 'b-summary', kind: 'entry', label: 'Summary', capabilities: { targetAnchorId: '@lore.stable' } },
      ] },
      { id: 'alice', kind: 'folder', label: 'Alice', capabilities: { activation: { kind: 'keyword', keywords: ['alice'] } }, children: [
        { id: 'a-summary', kind: 'entry', label: 'Summary', capabilities: { targetAnchorId: '@lore.stable', activation: { kind: 'always' } } },
        { id: 'a-dynamic', kind: 'entry', label: 'Dynamic', capabilities: { targetAnchorId: '@lore.lower' } },
      ] },
      { id: 'unassigned', kind: 'entry', label: 'Unassigned' },
    ] }
    const groups = groupLoreByAnchor(root)
    expect(groups.map(group => group.anchorId)).toEqual(['@lore.lower', '@lore.stable', undefined])
    expect(groups[0]?.entries.map(entry => [entry.node.id, entry.enabled, entry.conditional]))
      .toEqual([['b-dynamic', false, false], ['a-dynamic', true, true]])
    expect(groups[1]?.entries.map(entry => entry.node.id)).toEqual(['b-summary', 'a-summary'])
    expect(groups[1]?.entries[1]?.path).toBe('People / Alice / Summary')
    expect(groupLoreByAnchor({ id: 'empty', kind: 'module', label: 'Empty' })).toEqual([])
  })
})
