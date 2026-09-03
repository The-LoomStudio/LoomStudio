import {
  addContextAssetNode,
  deleteContextAssetNode,
  duplicateContextAssetNode,
} from '../../../apps/studio-client/src/features/context-assets/model/tree-ops.js'
import { commitContextAssetMutation } from '../../../apps/studio-client/src/features/context-assets/model/use-context-assets.js'
import { buildProjectionOrder } from '../../../apps/studio-client/src/features/context-assets/model/projection-order.js'
import { readPromptResourceWorkbenchRoot } from '../../../apps/studio-client/src/features/context-assets/model/prompt-resource-view.js'
import { resolvePresetBuildContextResources } from '../../../apps/studio-client/src/features/context-assets/model/preset-build-context.js'
import { resolveVirtualDisplayName, resolveVirtualExtension } from '../../../apps/studio-client/src/features/context-assets/model/context-asset-tree.js'
import type { ContextAssetNode, PromptResource, SettingMount } from '../../../apps/studio-client/src/entities/index.js'
import { describe, expect, it } from 'vitest'

describe('studio client context asset helpers', () => {
  it('resolves virtual display names with correct file extensions for UI presentation', () => {
    expect(resolveVirtualDisplayName('爱丽丝人设', 'entry')).toBe('爱丽丝人设.md')
    expect(resolveVirtualDisplayName('爱丽丝人设.md', 'entry')).toBe('爱丽丝人设.md')
    expect(resolveVirtualDisplayName('动作钩子', 'script')).toBe('动作钩子.js')
    expect(resolveVirtualDisplayName('动作钩子.js', 'script')).toBe('动作钩子.js')
    expect(resolveVirtualDisplayName('风格注入锚点', 'virtual')).toBe('风格注入锚点')
    expect(resolveVirtualDisplayName('设定目录', 'folder')).toBe('设定目录')
    expect(resolveVirtualDisplayName('核心模块', 'module')).toBe('核心模块')
    expect(resolveVirtualDisplayName('对话块', 'message')).toBe('对话块')
  })
  it('adds a setting entry with a backend-shaped projection', () => {
    const result = addContextAssetNode(baseNodes(), 'setting-folder', idSequence('new-entry'))
    const folder = findNode(result.nodes, 'setting-folder')
    const added = findNode(result.nodes, 'new-entry')

    expect(result.selectedId).toBe('new-entry')
    expect(folder?.children?.map(node => node.id)).toEqual(['setting-entry', 'new-entry'])
    expect(added?.projection).toMatchObject({
      zoneId: 'setting.stable',
      slotKey: 'setting-layer:city-layers-main@setting.stable',
      entryOrder: 20,
      sourceKind: 'actual',
    })
    expect(added?.capabilities?.projection).toMatchObject({
      zoneId: 'setting.stable',
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

  it('deletes editable nodes', () => {
    const result = deleteContextAssetNode(baseNodes(), 'preset-entry', 'preset-entry')

    expect(findNode(result.nodes, 'preset-entry')).toBeUndefined()
    expect(result.selectedId).toBe('preset-folder')
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

  it('does not apply or record a failed resource mutation', async () => {
    const applied: string[] = []
    const recorded: string[] = []

    await expect(commitContextAssetMutation({
      mutate: async () => { throw new Error('rpc failed') },
      applyResource: resource => applied.push(resource.id),
      recordEdit: entry => recorded.push(entry.changesetId),
      entry: { label: 'Reorder Entries', anchor: { documentId: 'workspace-1' } },
    })).rejects.toThrow('rpc failed')

    expect(applied).toEqual([])
    expect(recorded).toEqual([])
  })

  it('projects backend capability fields into the Prompt Resource workbench view', () => {
    const resource: PromptResource = {
      id: 'prompt-resource.official.test',
      version: 1,
      resourceKind: 'preset',
      origin: { kind: 'builtin', key: 'test' },
      createdAt: '2026-08-15T00:00:00.000Z',
      updatedAt: '2026-08-15T00:00:00.000Z',
      rootNode: {
        id: 'preset-root',
        label: 'Assistant',
        category: 'preset',
        kind: 'module',
        children: [{
          id: 'assistant-entry',
          label: 'Assistant behavior',
          kind: 'entry',
          body: 'Answer clearly.',
          capabilities: {
            lifecycle: { lifecycle: 'always' },
            projection: {
              zoneId: 'preset.system',
              slotKey: 'preset:preset-root@preset.system',
              entryOrderHint: 10,
            },
          },
        }],
      },
    }

    const root = readPromptResourceWorkbenchRoot(resource)
    const entries = buildProjectionOrder([root])

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      zoneId: 'preset.system',
      slotKey: 'preset:preset-root@preset.system',
      node: { id: 'assistant-entry' },
    })
  })

  it('resolves global and timeline settings in runtime order with stable deduplication', () => {
    const preset = promptResource('preset-1', 'preset')
    const setting1 = promptResource('setting-1', 'setting')
    const setting2 = promptResource('setting-2', 'setting')
    const timelineSetting = promptResource('setting-3', 'setting')
    const logic = promptResource('logic-1', 'logic')

    expect(resolvePresetBuildContextResources({
      preset,
      resources: [preset, setting1, setting2, timelineSetting, logic],
      settingMounts: [
        ...mounts({ kind: 'manual', id: 'global' }, ['setting-1', 'setting-2']),
        ...mounts({ kind: 'preset', id: 'preset-1' }, ['setting-2', 'setting-3', 'missing']),
      ],
      timelinePromptResourceIds: ['setting-3', 'setting-1', 'logic-1', 'preset-1'],
    }).map(resource => resource.id)).toEqual(['setting-1', 'setting-2', 'setting-3'])
  })

  it('ignores legacy preset-linked settings without an active timeline', () => {
    const preset = promptResource('preset-1', 'preset')
    const setting = promptResource('setting-1', 'setting')

    expect(resolvePresetBuildContextResources({
      preset,
      resources: [preset, setting],
      settingMounts: mounts({ kind: 'preset', id: 'preset-1' }, ['setting-1']),
    })).toEqual([])
  })
})

function promptResource(
  id: string,
  resourceKind: PromptResource['resourceKind'],
): PromptResource {
  return {
    id,
    version: 1,
    resourceKind,
    rootNode: { id: `${id}-root`, label: id, kind: 'module' },
    createdAt: '2026-08-16T00:00:00.000Z',
    updatedAt: '2026-08-16T00:00:00.000Z',
  }
}

function mounts(source: SettingMount['source'], settingResourceIds: string[]): SettingMount[] {
  return settingResourceIds.map((settingResourceId, orderIndex) => ({
    id: `mount-${orderIndex}`,
    settingResourceId,
    source,
    orderIndex,
    origin: {},
    createdAt: '2026-08-16T00:00:00.000Z',
  }))
}

function baseNodes(): ContextAssetNode[] {
  return [
    {
      id: 'preset-module',
      label: 'Preset',
      category: 'preset',
      kind: 'module',
      children: [
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
                lifecycle: 'always',
                order: 'entry: 10',
                slotKey: 'preset:default-airp-preset@preset.system',
                sourceKind: 'actual',
                zoneId: 'preset.system',
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
                lifecycle: 'always',
                order: 'entry: 10',
                slotKey: 'setting-layer:city-layers-main@setting.stable',
                sourceKind: 'actual',
                zoneId: 'setting.stable',
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

function idSequence(...ids: string[]): () => string {
  let index = 0
  return () => ids[index++] ?? `id-${index}`
}
