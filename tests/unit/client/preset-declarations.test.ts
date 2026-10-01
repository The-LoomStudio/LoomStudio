import { describe, expect, it } from 'vitest'
import { presetAnchorDeclarations } from '../../../apps/studio-client/src/features/context-assets/model/preset-declarations.js'
import type { PromptResource, SettingMount } from '../../../apps/studio-client/src/entities/index.js'

const resource = {
  id: 'setting-a', resourceKind: 'setting', version: 1,
  rootNode: { id: 'root', kind: 'folder', label: 'World', children: [
    { id: 'folder', kind: 'folder', label: 'Harbor', enabled: false, children: [
      { id: 'entry', kind: 'entry', label: 'Old Port', capabilities: { targetAnchorId: '@setting.stable', activation: { kind: 'keyword', keywords: ['port'] } } },
    ] },
    { id: 'other', kind: 'entry', label: 'Elsewhere', capabilities: { targetAnchorId: '@setting.other' } },
  ] },
} as PromptResource

describe('preset anchor declarations', () => {
  it('retains folders and inactive atomic targets under their declared source', () => {
    const mount = { id: 'mount', settingResourceId: resource.id, source: { kind: 'manual' }, orderIndex: 0 } as SettingMount
    const result = presetAnchorDeclarations({
      anchor: { id: 'anchor', kind: 'virtual', label: '@setting.stable' },
      presetId: 'preset', resources: [resource], settingMounts: [mount],
    })
    expect(result.nodes[0]?.id).toBe('source:global')
    expect(result.nodes[0]?.children?.[0]?.children?.[0]?.label).toBe('Harbor')
    expect([...result.targets.keys()]).toEqual(['setting-a:entry'])
    expect(result.targets.get('setting-a:entry')).toMatchObject({ enabled: false, source: 'global' })
    expect(result.targets.has('setting-a:folder')).toBe(false)
  })

  it('does not walk candidate bodies until an anchor is selected', () => {
    let reads = 0
    const candidates = Array.from({ length: 500 }, (_, index) => ({
      ...resource, id: `setting-${index}`,
      rootNode: { ...resource.rootNode, get children() { reads++; return resource.rootNode.children } },
    }))
    const authorTree = { id: 'preset', kind: 'folder', label: 'Preset', children: [{ id: 'anchor', kind: 'virtual', label: '@setting.stable' }] }
    expect(authorTree.children).toHaveLength(1)
    expect(reads).toBe(0)
    presetAnchorDeclarations({
      anchor: authorTree.children[0] as typeof resource.rootNode,
      presetId: 'preset', resources: candidates, settingMounts: candidates.map((item, index) => ({
        id: `mount-${index}`, settingResourceId: item.id, source: { kind: 'manual' }, orderIndex: index,
      } as SettingMount)),
    })
    expect(reads).toBe(500)
  })
})
