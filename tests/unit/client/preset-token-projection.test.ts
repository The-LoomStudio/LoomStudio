import { describe, expect, it } from 'vitest'
import type { PromptResource } from '../../../apps/studio-client/src/entities/index.js'
import { buildPresetTokenProjection } from '../../../apps/studio-client/src/features/context-assets/model/preset-token-projection.js'
import { aggregateTokenCounts, collectTokenEntries } from '../../../apps/studio-client/src/features/context-assets/model/resource-token-counts.js'

describe('Preset anchor token projection', () => {
  const preset: PromptResource = {
    id: 'preset', version: 1, resourceKind: 'preset',
    rootNode: { id: 'root', kind: 'module', label: '', children: [
      { id: 'prefix', kind: 'entry', label: '', body: 'prefix' },
      { id: 'anchor', kind: 'virtual', label: '常驻设定', capabilities: { targetAnchorId: '@setting.stable' } },
    ] },
  }
  const setting: PromptResource = {
    id: 'setting', version: 1, resourceKind: 'setting',
    rootNode: { id: 's-root', kind: 'module', label: '', children: [
      { id: 's-entry', kind: 'entry', label: '', body: 'world' },
      { id: 's-conditional', kind: 'folder', label: '', capabilities: { activation: { kind: 'keyword', keywords: ['hit'] } }, children: [
        { id: 's-child', kind: 'entry', label: '', body: 'conditional' },
      ] },
    ] },
  }
  it('aggregates mounted Setting bodies into the anchor and its parent without modifying the Preset', () => {
    const result = buildPresetTokenProjection({ preset, resources: [preset, setting], settingMounts: [], timelinePromptResourceIds: ['setting', 'setting'] })
    const entries = collectTokenEntries([result.root])
    expect(entries.map(entry => entry.body)).toEqual(['prefix', 'world', 'conditional'])
    const counts = new Map(entries.map(entry => [entry.id, 10]))
    const summary = aggregateTokenCounts([result.root], counts)
    expect(summary.nodes.get('anchor')).toEqual({ total: 20, enabled: 20, resident: 10, nonresident: 10 })
    expect(summary.enabled).toBe(30)
    const ownSummary = aggregateTokenCounts([preset.rootNode], counts)
    expect(ownSummary.enabled).toBe(10)
    expect(ownSummary.resident).toBe(10)
    expect(ownSummary.nonresident).toBe(0)
    expect(preset.rootNode.children?.[1]?.children).toBeUndefined()
    expect(result.incompleteIds.size).toBe(0)
  })
  it('marks dynamic or missing-source anchors incomplete instead of declaring zero', () => {
    const input = { ...preset, rootNode: { id: 'root', kind: 'module', label: '', children: [
      { id: 'dynamic', kind: 'virtual', label: '@chat.narrative' },
    ] } } as PromptResource
    expect(buildPresetTokenProjection({ preset: input, resources: [input], settingMounts: [] }).incompleteIds.has('dynamic')).toBe(true)
    expect(buildPresetTokenProjection({ preset, resources: [preset], settingMounts: [], timelinePromptResourceIds: ['missing'] }).incompleteIds.has('anchor')).toBe(true)
  })
})
