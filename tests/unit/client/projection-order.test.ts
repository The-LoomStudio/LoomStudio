import type { ContextAssetNode } from '../../../apps/studio-client/src/entities/index.js'
import {
  buildProjectionOrder,
  buildProjectionRows,
} from '../../../apps/studio-client/src/features/context-assets/model/projection-order.js'
import { transformForProjectionView } from '../../../apps/studio-client/src/features/context-assets/model/projection-view.js'
import {
  buildProjectionWorkbenchModel,
  readContextProjectionMoveUpdate,
  readPresetProjectionMoveUpdates,
} from '../../../apps/studio-client/src/features/context-assets/model/projection-workbench.js'
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

    expect(presetView.children?.flatMap(zone => zone.children?.map(node => node.id) ?? [])).toEqual([
      'preset-entry',
      'setting-entry-a',
      'setting-entry-b',
    ])
    expect(contextView.children?.flatMap(zone => zone.children?.map(node => node.id) ?? [])).toEqual([
      'preset-entry',
      'projection-module-slot-setting-layer:city-layers-main@setting.stable',
    ])
  })

  it('returns a patch for same-slot context projection moves', () => {
    const nodes = projectionNodes()
    const entries = buildProjectionOrder(nodes)
    const update = readContextProjectionMoveUpdate(nodes, entries, 'setting-entry-b', 'setting-entry-a', 'before')

    expect(update?.id).toBe('setting-entry-b')
    expect(update?.partial.projection?.entryOrder).toBe(0)
  })

  it('returns zone and order patches for preset projection moves', () => {
    const nodes = projectionNodesWithOrder()
    const model = buildProjectionWorkbenchModel(nodes)
    const updates = readPresetProjectionMoveUpdates({
      draggedId: 'preset-entry',
      nodes,
      orderedProjectionEntries: model.orderedProjectionEntries,
      orderNode: model.orderNode,
      position: 'inside',
      projectionEntries: model.projectionEntries,
      projectionOrderIds: model.projectionOrderIds,
      targetId: 'projection-module-zone-fresh.tail',
    })

    expect(updates.map(update => update.id)).toEqual(['preset-entry', 'projection-order'])
    expect(updates[0]?.partial.projection?.zoneId).toBe('fresh.tail')
    expect(updates[1]?.partial.orderList).toEqual(['setting-entry-a', 'setting-entry-b', 'preset-entry'])
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

function projectionNodesWithOrder(): ContextAssetNode[] {
  const [module] = projectionNodes()
  return [{
    ...module!,
    children: [
      {
        id: 'projection-order',
        label: 'Projection Order',
        kind: 'order',
        orderList: ['preset-entry', 'setting-entry-a', 'setting-entry-b'],
      },
      ...(module?.children ?? []),
    ],
  }]
}

function entry(id: string, label: string, zoneId: string, slotKey: string, entryOrder: number, slotOrder: number): ContextAssetNode {
  return {
    id,
    label,
    kind: 'entry',
    body: label,
    projection: {
      entryOrder,
      lifecycle: 'always',
      order: `entry: ${entryOrder}`,
      slotKey,
      slotOrder,
      sourceKind: 'actual',
      zoneId,
    },
  }
}
