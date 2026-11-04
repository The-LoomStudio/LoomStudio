import {
  addContextAssetAnchorNode,
  addContextAssetFolderNode,
  addContextAssetMessageBlockNode,
  addContextAssetMessageSequenceNode,
  canMoveContextAssetNode,
  addContextAssetNode,
  deleteContextAssetNode,
  duplicateContextAssetNode,
} from '../../../apps/studio-client/src/features/prompt-resources/model/tree-ops.js'
import { writeProjectionCapability } from '../../../apps/studio-client/src/features/prompt-resources/model/context-asset-normalization.js'
import { readPromptResourceWorkbenchRoot } from '../../../apps/studio-client/src/features/prompt-resources/model/prompt-resource-view.js'
import { resolvePresetBuildContextResources } from '../../../apps/studio-client/src/features/prompt-resources/model/preset-build-context.js'
import { resolveVirtualDisplayName, resolveVirtualExtension } from '../../../apps/studio-client/src/features/prompt-resources/model/context-asset-tree.js'
import type { ContextAssetNode, PromptResource, LoreMount } from '../../../apps/studio-client/src/entities/index.js'
import { describe, expect, it } from 'vitest'

describe('studio client context asset helpers', () => {
  it('keeps native history beside Messages and rejects invalid drops, including folders hiding sequences', () => {
    const nodes: ContextAssetNode[] = [{ id: 'root', kind: 'module', category: 'preset', label: 'Preset', children: [
      { id: 'message', kind: 'message', label: 'System', children: [{ id: 'text', kind: 'entry', label: 'Text' }] },
    ] }]
    const created = addContextAssetMessageSequenceNode(nodes, 'text', () => 'history')!
    expect(created).toMatchObject({ targetAssetId: 'message', position: 'after', asset: { id: 'history' } })
    const withHistory = [{ ...nodes[0]!, children: [...nodes[0]!.children!, created.asset] }]
    expect(addContextAssetMessageSequenceNode(withHistory, 'root')).toBeUndefined()
    expect(canMoveContextAssetNode(withHistory, 'history', 'message', 'inside')).toBe(false)
    expect(canMoveContextAssetNode(withHistory, 'text', 'history', 'inside')).toBe(false)
    expect(canMoveContextAssetNode(withHistory, 'history', 'message', 'before')).toBe(true)
    const hidden = [{ ...nodes[0]!, children: [nodes[0]!.children![0]!,
      { id: 'folder', kind: 'folder', label: 'Folder', children: [created.asset] }] }]
    expect(canMoveContextAssetNode(hidden, 'folder', 'message', 'inside')).toBe(false)
    const sibling = addContextAssetMessageBlockNode(nodes, 'text', 'assistant', () => 'next')
    expect(sibling).toMatchObject({ targetAssetId: 'message', position: 'after', asset: { id: 'next', kind: 'message' } })
  })

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
    const result = addContextAssetNode(baseNodes(), 'setting-folder', idSequence('new-entry'))!
    const added = result.asset

    expect(result).toMatchObject({ targetAssetId: 'setting-folder', position: 'inside', asset: { id: 'new-entry' } })
    expect(added?.projection).toMatchObject({
      zoneId: 'lore.stable',
      slotKey: 'lore:city-layers-main@lore.stable',
      entryOrder: 20,
      sourceKind: 'actual',
    })
    expect(added?.capabilities?.projection).toMatchObject({
      zoneId: 'lore.stable',
      slotKey: 'lore:city-layers-main@lore.stable',
      entryOrderHint: 20,
      sourceKind: 'actual',
    })
  })

  it('inserts new folders and anchors at the start of their parent, including preset trees', () => {
    const setting = addContextAssetFolderNode(baseNodes(), 'setting-folder', idSequence('new-folder'))
    expect(setting).toMatchObject({ targetAssetId: 'setting-folder', position: 'inside', asset: { id: 'new-folder', kind: 'folder' } })

    const preset = addContextAssetAnchorNode(baseNodes(), 'preset-folder', idSequence('new-anchor'))
    expect(preset).toMatchObject({ targetAssetId: 'preset-folder', position: 'inside', asset: { id: 'new-anchor', kind: 'virtual' } })

    const block = addContextAssetMessageBlockNode(baseNodes(), 'preset-folder', 'system', idSequence('new-message'))
    expect(block).toMatchObject({ targetAssetId: 'preset-folder', position: 'inside', asset: { id: 'new-message', kind: 'message' } })
  })

  it('duplicates an editable entry beside the source node', () => {
    const result = duplicateContextAssetNode(baseNodes(), 'setting-entry', idSequence('copy-entry'))!
    const copy = result.asset

    expect(result).toMatchObject({ targetAssetId: 'setting-entry', position: 'after', asset: { id: 'copy-entry' } })
    expect(copy?.label).toBe('雾港 Copy')
    expect(copy?.body).toBe('雾港是一座潮湿安静的海港。')
    expect(copy?.projection?.entryOrder).toBe(11)
    expect(copy?.capabilities?.projection?.entryOrderHint).toBe(11)
  })

  it('deletes editable nodes', () => {
    const result = deleteContextAssetNode(baseNodes(), 'preset-entry', 'preset-entry')

    expect(result?.selectedId).toBe('preset-folder')
  })

  it('selects the next root when an editable top-level node is deleted', () => {
    const nodes: ContextAssetNode[] = [{ id: 'first', kind: 'folder', label: 'First' }, { id: 'second', kind: 'folder', label: 'Second' }]
    expect(deleteContextAssetNode(nodes, 'first', 'first')?.selectedId).toBe('second')
    expect(deleteContextAssetNode(nodes, 'first', 'second')?.selectedId).toBe('second')
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

    expect(result).toBeUndefined()
    expect(findNode(nodes, 'history-turn')).toBeDefined()
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
    expect(root.children).toHaveLength(1)
    expect(root.children![0]).toMatchObject({
      id: 'assistant-entry',
      projection: {
        zoneId: 'preset.system',
        slotKey: 'preset:preset-root@preset.system',
      },
    })
  })

  it('resolves global and timeline settings in runtime order with stable deduplication', () => {
    const preset = promptResource('preset-1', 'preset')
    const setting1 = promptResource('setting-1', 'lore')
    const setting2 = promptResource('setting-2', 'lore')
    const timelineLore = promptResource('setting-3', 'lore')
    const logic = promptResource('logic-1', 'logic')

    expect(resolvePresetBuildContextResources({
      preset,
      resources: [preset, setting1, setting2, timelineLore, logic],
      loreMounts: [
        ...mounts({ kind: 'manual', id: 'global' }, ['setting-1', 'setting-2']),
        ...mounts({ kind: 'preset', id: 'preset-1' }, ['setting-2', 'setting-3', 'missing']),
      ],
      timelinePromptResourceIds: ['setting-3', 'setting-1', 'logic-1', 'preset-1'],
    }).resources.map(resource => resource.id)).toEqual(['setting-1', 'setting-2', 'setting-3'])
  })

  it('ignores legacy preset-linked settings without an active timeline', () => {
    const preset = promptResource('preset-1', 'preset')
    const setting = promptResource('setting-1', 'lore')

    expect(resolvePresetBuildContextResources({
      preset,
      resources: [preset, setting],
      loreMounts: mounts({ kind: 'preset', id: 'preset-1' }, ['setting-1']),
    })).toEqual({ resources: [], unavailableResourceIds: [] })
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

function mounts(source: LoreMount['source'], loreResourceIds: string[]): LoreMount[] {
  return loreResourceIds.map((loreResourceId, orderIndex) => ({
    id: `mount-${orderIndex}`,
    loreResourceId,
    source,
    orderIndex,
    origin: {},
    createdAt: '2026-08-16T00:00:00.000Z',
  }))
}

function baseNodes(): ContextAssetNode[] {
  const nodes: ContextAssetNode[] = [
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
      category: 'lore',
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
                slotKey: 'lore:city-layers-main@lore.stable',
                sourceKind: 'actual',
                zoneId: 'lore.stable',
                entryOrder: 10,
              },
            },
          ],
        },
      ],
    },
  ]
  return nodes.map(withProjectionCapabilities)
}

function findNode(nodes: ContextAssetNode[], id: string): ContextAssetNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node
    const child = findNode(node.children ?? [], id)
    if (child) return child
  }

  return undefined
}

function withProjectionCapabilities(node: ContextAssetNode): ContextAssetNode {
  return { ...node, ...(node.projection ? { capabilities: writeProjectionCapability(node.capabilities, node.projection) } : {}),
    ...(node.children ? { children: node.children.map(withProjectionCapabilities) } : {}) }
}

function idSequence(...ids: string[]): () => string {
  let index = 0
  return () => ids[index++] ?? `id-${index}`
}
