import { describe, expect, it } from 'vitest'
import type { Card, PromptResource } from '../../../apps/studio-client/src/entities/index.js'
import { readVisibleFileTreeNodes } from '../../../apps/studio-client/src/shared/ui/file-tree/file-tree-model.js'
import { buildCardResourceTree, classifyCardPromptResources, readCardSettingTarget } from '../../../apps/studio-client/src/widgets/character-panel/card-resource-directory-model.js'

const card: Card = {
  id: 'card-a', version: 3, name: 'A', createdAt: '', updatedAt: '',
  opening: { entries: [] }, settingLayer: { entries: [{ title: 'Inline setting', content: 'text' }] },
  promptResourceIds: ['owned', 'external', 'extension'],
  externalPromptResourceIds: ['external'],
}
const resource = (id: string, source: 'card' | 'user' | 'extension'): PromptResource => ({
  id, version: 1, resourceKind: 'setting', createdAt: '', updatedAt: '',
  rootNode: { id: `${id}-root`, label: 'Same title', kind: 'folder', children: [
    { id: `${id}-entry`, label: 'Content', kind: 'entry', body: id },
  ] },
  ...(source === 'card' ? { sourceArtifactRef: { artifactId: 'card-bundle' } }
    : source === 'extension' ? { origin: { kind: 'extension-package', packageId: 'pkg', packageVersion: '1', contributionId: id } }
      : {}),
})

describe('card resource directory identity', () => {
  it('lists live Card Settings without a disk catalog and keeps ownership distinct', () => {
    const classified = classifyCardPromptResources(card, [
      resource('owned', 'card'), resource('external', 'user'), resource('extension', 'extension'),
    ])
    expect(classified.ownedSettings.map(item => item.id)).toEqual(['owned'])
    expect(classified.references.map(item => item.id)).toEqual(['external'])
    expect(classified.extensionResources.map(item => item.id)).toEqual(['extension'])

    const { nodes, targets } = buildCardResourceTree([
      { key: 'settings', label: 'Settings', entries: [
        { id: 'card-setting:0', label: card.settingLayer.entries[0]!.title! },
        { id: classified.ownedSettings[0]!.id, label: 'Same title' },
      ] },
    ], new Map(classified.ownedSettings.map(item => [item.id, item.rootNode])))
    expect(nodes[0]?.meta).toBe('2')
    const visible = readVisibleFileTreeNodes(nodes, new Set(['settings', 'settings:owned:owned-root']))
    expect(visible.map(item => item.node.label)).toEqual(['Settings', 'Inline setting', 'Same title', 'Content'])
    expect(targets.get('settings:card-setting:0')).toEqual({ folder: 'settings', item: 'card-setting:0' })
    expect(targets.get('settings:owned:owned-entry')).toEqual({
      folder: 'settings', item: 'owned', nodeId: 'owned-entry',
    })
    expect(readCardSettingTarget('settings:owned:owned-root', targets, classified.ownedSettings))
      .toEqual({ resource: classified.ownedSettings[0], nodeId: 'owned-root' })
    expect(readCardSettingTarget('settings:owned:owned-entry', targets, classified.ownedSettings))
      .toEqual({ resource: classified.ownedSettings[0], nodeId: 'owned-entry' })
    expect(readCardSettingTarget('settings:card-setting:0', targets, classified.ownedSettings)).toBeUndefined()
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
    expect(readCardSettingTarget('extensions:resource:extension:extension-root', extensionTree.targets,
      classified.extensionResources)).toEqual({ resource: classified.extensionResources[0], nodeId: 'extension-root' })
  })
})
