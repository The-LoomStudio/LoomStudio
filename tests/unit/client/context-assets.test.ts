import {
  addContextAssetNode,
  deleteContextAssetNode,
  duplicateContextAssetNode,
} from '../../../apps/studio-client/src/features/context-assets/model/tree-ops.js'
import { normalizeContextAssets } from '../../../apps/studio-client/src/features/context-assets/model/context-asset-normalization.js'
import { DemoData } from '../../../apps/studio-client/src/app/demo-data.js'
import type { ContextAssetNode } from '../../../apps/studio-client/src/entities/index.js'
import { describe, expect, it } from 'vitest'

describe('studio client context asset helpers', () => {
  it('adds a setting entry with a backend-shaped projection', () => {
    const result = addContextAssetNode(baseNodes(), 'setting-folder', idSequence('new-entry'))
    const folder = findNode(result.nodes, 'setting-folder')
    const added = findNode(result.nodes, 'new-entry')

    expect(result.selectedId).toBe('new-entry')
    expect(folder?.children?.map(node => node.id)).toEqual(['setting-entry', 'new-entry'])
    expect(added?.projection).toMatchObject({
      group: 'setting.stable',
      slotKey: 'setting-layer:city-layers-main@setting.stable',
      entryOrder: 20,
      sourceKind: 'actual',
    })
    expect(added?.capabilities?.projection).toMatchObject({
      injectionGroupKey: 'setting.stable',
      slotKey: 'setting-layer:city-layers-main@setting.stable',
      entryOrderHint: 20,
      sourceKind: 'actual',
    })
  })

  it('duplicates an editable entry beside the source node', () => {
    const result = duplicateContextAssetNode(baseNodes(), 'setting-entry', idSequence('copy-entry'))
    const folder = findNode(result.nodes, 'setting-folder')
    const copy = findNode(result.nodes, 'copy-entry')

    expect(result.selectedId).toBe('copy-entry')
    expect(folder?.children?.map(node => node.id)).toEqual(['setting-entry', 'copy-entry'])
    expect(copy?.label).toBe('雾港 Copy')
    expect(copy?.body).toBe('雾港是一座潮湿安静的海港。')
    expect(copy?.projection?.entryOrder).toBe(11)
    expect(copy?.capabilities?.projection?.entryOrderHint).toBe(11)
  })

  it('deletes editable nodes and prunes orphan projection order references', () => {
    const result = deleteContextAssetNode(baseNodes(), 'preset-entry', 'preset-entry')
    const orderNode = findNode(result.nodes, 'projection-order')

    expect(findNode(result.nodes, 'preset-entry')).toBeUndefined()
    expect(result.selectedId).toBe('preset-folder')
    expect(orderNode?.orderList).toEqual(['setting-entry'])
    expect(orderNode?.slotRanks?.map(rank => rank.slotKey)).toEqual([
      'setting-layer:city-layers-main@setting.stable',
    ])
  })

  it('keeps inherited history nodes read-only for destructive helpers', () => {
    const nodes = baseNodes()
    nodes.push({
      id: 'history-module',
      label: 'History',
      category: 'history',
      kind: 'module',
      children: [
        {
          id: 'history-turn',
          label: 'User',
          kind: 'entry',
          body: '今晚的雾真大。',
        },
      ],
    })

    const result = deleteContextAssetNode(nodes, 'history-turn', 'history-turn')

    expect(result.nodes).toBe(nodes)
    expect(findNode(result.nodes, 'history-turn')).toBeDefined()
  })

  it('keeps demo prompt-facing entries on capability-shaped data', () => {
    const entries = flattenNodes(DemoData.contextAssets).filter(node => node.kind === 'entry' && node.capabilities?.projection)
    const normalizedEntries = flattenNodes(normalizeContextAssets(DemoData.contextAssets)).filter(node => node.kind === 'entry' && node.capabilities?.projection)

    expect(entries.length).toBeGreaterThan(0)
    expect(entries.every(node => node.projection === undefined)).toBe(true)
    expect(normalizedEntries.every(node => node.projection !== undefined)).toBe(true)
    expect(entries.map(node => node.capabilities?.projection?.injectionGroupKey)).toContain('setting.stable')
    expect(entries.map(node => node.capabilities?.projection?.injectionGroupKey)).toContain('preset.system')
  })
})

function baseNodes(): ContextAssetNode[] {
  return [
    {
      id: 'preset-module',
      label: 'Preset',
      category: 'preset',
      kind: 'module',
      children: [
        {
          id: 'projection-order',
          label: 'Projection Order',
          kind: 'order',
          orderList: ['preset-entry', 'setting-entry'],
          slotRanks: [
            { injectionGroupKey: 'preset.system', slotKey: 'preset:default-airp-preset@preset.system', rankKey: '0000' },
            { injectionGroupKey: 'setting.stable', slotKey: 'setting-layer:city-layers-main@setting.stable', rankKey: '0001' },
          ],
        },
        {
          id: 'preset-folder',
          label: 'Style',
          kind: 'folder',
          children: [
            {
              id: 'preset-entry',
              label: '轻小说文风',
              kind: 'entry',
              body: '轻快一些。',
              projection: {
                group: 'preset.system',
                lifecycle: 'always',
                order: 'entry: 10',
                slotKey: 'preset:default-airp-preset@preset.system',
                sourceKind: 'actual',
                zone: 'StablePrefix',
                entryOrder: 10,
              },
            },
          ],
        },
      ],
    },
    {
      id: 'setting-module',
      label: 'Setting',
      category: 'setting',
      kind: 'module',
      children: [
        {
          id: 'setting-folder',
          label: 'Location',
          kind: 'folder',
          children: [
            {
              id: 'setting-entry',
              label: '雾港',
              kind: 'entry',
              body: '雾港是一座潮湿安静的海港。',
              projection: {
                group: 'setting.stable',
                lifecycle: 'always',
                order: 'entry: 10',
                slotKey: 'setting-layer:city-layers-main@setting.stable',
                sourceKind: 'actual',
                zone: 'StablePrefix',
                entryOrder: 10,
              },
            },
          ],
        },
      ],
    },
  ]
}

function findNode(nodes: ContextAssetNode[], id: string): ContextAssetNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node
    const child = findNode(node.children ?? [], id)
    if (child) return child
  }

  return undefined
}

function flattenNodes(nodes: ContextAssetNode[]): ContextAssetNode[] {
  return nodes.flatMap(node => [node, ...flattenNodes(node.children ?? [])])
}

function idSequence(...ids: string[]): () => string {
  let index = 0
  return () => ids[index++] ?? `id-${index}`
}
