import type { ContextAssetNode } from '../../../apps/studio-client/src/entities/index.js'
import {
  buildProjectionOrder,
  buildProjectionRows,
  transformForProjectionView,
} from '../../../apps/studio-client/src/features/context-assets/model/projection-order.js'
import { describe, expect, it } from 'vitest'

describe('studio client projection order selectors', () => {
  it('groups setting-layer entries as a slot row for the global order panel', () => {
    const rows = buildProjectionRows(buildProjectionOrder(projectionNodes()))

    expect(rows.map(row => ({ id: row.id, type: row.type, count: row.entries.length }))).toEqual([
      { id: 'preset-entry', type: 'entry', count: 1 },
      { id: 'setting-layer:city-layers-main@setting.stable', type: 'slot', count: 2 },
    ])
  })

  it('keeps preset projection view flat but groups context setting-layer slots when requested', () => {
    const [module] = projectionNodes()
    const orderedEntries = buildProjectionOrder(projectionNodes())
    const presetView = transformForProjectionView(module!, orderedEntries)
    const contextView = transformForProjectionView(module!, orderedEntries, { groupSettingLayerSlots: true })

    expect(presetView.children?.[0]?.children?.map(node => node.id)).toEqual([
      'preset-entry',
      'setting-entry-a',
      'setting-entry-b',
    ])
    expect(contextView.children?.[0]?.children?.map(node => node.id)).toEqual([
      'preset-entry',
      'projection-module-slot-setting-layer:city-layers-main@setting.stable',
    ])
  })
})

function projectionNodes(): ContextAssetNode[] {
  return [
    {
      id: 'projection-module',
      label: 'Projection',
      category: 'setting',
      kind: 'module',
      children: [
        entry('preset-entry', 'Preset', 'preset.system', 'preset:default-airp-preset@preset.system', 10, 100),
        entry('setting-entry-a', 'Rain Line Station', 'setting.stable', 'setting-layer:city-layers-main@setting.stable', 10, 200),
        entry('setting-entry-b', 'Clock Alley', 'setting.stable', 'setting-layer:city-layers-main@setting.stable', 20, 200),
      ],
    },
  ]
}

function entry(id: string, label: string, group: string, slotKey: string, entryOrder: number, slotOrder: number): ContextAssetNode {
  return {
    id,
    label,
    kind: 'entry',
    body: label,
    projection: {
      anchor: 'inside',
      entryOrder,
      group,
      lifecycle: 'always',
      order: `entry: ${entryOrder}`,
      slotKey,
      slotOrder,
      sourceKind: 'actual',
      zone: 'StablePrefix',
    },
  }
}
