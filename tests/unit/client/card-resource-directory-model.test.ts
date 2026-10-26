import { describe, expect, it } from 'vitest'
import type { Card, PromptResource } from '../../../apps/studio-client/src/entities/index.js'
import { readVisibleFileTreeNodes } from '../../../apps/studio-client/src/shared/ui/file-tree/file-tree-model.js'
import { buildCardResourceTree, classifyCardPromptResources, readCardLoreTarget } from '../../../apps/studio-client/src/widgets/character-panel/card-resource-directory-model.js'

const card: Card = {
  id: 'card-a', artifactId: 'fixture-artifact', version: 3, name: 'A', createdAt: '', updatedAt: '',
  opening: { id: 'root-opening', content: '' }, lore: { entries: [{ title: 'Inline setting', content: 'text' }] },
  promptResourceIds: ['owned', 'external', 'extension'],
  externalPromptResourceIds: ['external'],
}
const resource = (id: string, source: 'card' | 'user' | 'extension'): PromptResource => ({
  id, version: 1, resourceKind: 'lore', createdAt: '', updatedAt: '',
  rootNode: { id: `${id}-root`, label: 'Same title', kind: 'folder', children: [
    { id: `${id}-entry`, label: 'Content', kind: 'entry', body: id },
  ] },
  ...(source === 'card' ? { sourceArtifactRef: { artifactId: 'card-bundle', displayName: 'Card', format: 'loom.cardBundle', schemaVersion: 4, importedAt: '' } }
    : source === 'extension' ? { origin: { kind: 'extension-package', packageId: 'pkg', packageVersion: '1', contributionId: id } }
      : {}),
})

describe('card resource directory identity', () => {
  it('lists live Card Lore without a disk catalog and keeps ownership distinct', () => {
    const classified = classifyCardPromptResources(card, [
      resource('owned', 'card'), resource('external', 'user'), resource('extension', 'extension'),
    ])
    expect(classified.ownedLore.map(item => item.id)).toEqual(['owned'])
    expect(classified.references.map(item => item.id)).toEqual(['external'])
    expect(classified.extensionResources.map(item => item.id)).toEqual(['extension'])

    const { nodes, targets } = buildCardResourceTree([
      { key: 'lore', label: 'Lore', entries: [
        { id: 'card-lore:0', label: card.lore.entries[0]!.title! },
        { id: classified.ownedLore[0]!.id, label: 'Same title' },
      ] },
    ], new Map(classified.ownedLore.map(item => [item.id, item.rootNode])))
    expect(nodes[0]?.meta).toBe('2')
    const visible = readVisibleFileTreeNodes(nodes, new Set(['lore', 'lore:owned:owned-root']))
    expect(visible.map(item => item.node.label)).toEqual(['Lore', 'Inline setting', 'Same title', 'Content'])
    expect(targets.get('lore:card-lore:0')).toEqual({ folder: 'lore', item: 'card-lore:0' })
    expect(targets.get('lore:owned:owned-entry')).toEqual({
      folder: 'lore', item: 'owned', nodeId: 'owned-entry',
    })
    expect(readCardLoreTarget('lore:owned:owned-root', targets, classified.ownedLore))
      .toEqual({ resource: classified.ownedLore[0], nodeId: 'owned-root' })
    expect(readCardLoreTarget('lore:owned:owned-entry', targets, classified.ownedLore))
      .toEqual({ resource: classified.ownedLore[0], nodeId: 'owned-entry' })
    expect(readCardLoreTarget('lore:card-lore:0', targets, classified.ownedLore)).toBeUndefined()
    const extensionTree = buildCardResourceTree([
      { key: 'extensions', label: 'Extensions', entries: [{
        id: 'installed:pkg', label: 'Package',
        children: [{ id: 'resource:extension', label: 'Contribution' }],
      }] },
    ], new Map([['resource:extension', resource('extension', 'extension').rootNode]]))
    expect(readVisibleFileTreeNodes(extensionTree.nodes,
      new Set(['extensions', 'extensions:installed:pkg', 'extensions:resource:extension:extension-root']))
      .map(item => item.node.label)).toEqual(['Extensions', 'Package', 'Same title', 'Content'])
    expect(extensionTree.targets.get('extensions:resource:extension:extension-entry')).toEqual({
      folder: 'extensions', item: 'resource:extension', nodeId: 'extension-entry',
    })
    expect(readCardLoreTarget('extensions:resource:extension:extension-root', extensionTree.targets,
      classified.extensionResources)).toEqual({ resource: classified.extensionResources[0], nodeId: 'extension-root' })
  })
})
