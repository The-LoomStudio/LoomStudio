import {
  compilePromptDataModel,
  defaultCompositionSkeleton,
  emptyProjectionOrderProfile,
  materializePromptFragments,
  type PromptContribution,
  type PromptFragment,
  type PromptSourceKind,
  type SourceNode,
} from '@loom-studio/application-runtime'
import { describe, expect, it } from 'vitest'

const sourceNodes: SourceNode[] = [
  node('node.setting.root', 'worldbook-main', null, 'Setting Layer', 1),
  node('node.setting.location', 'worldbook-main', 'node.setting.root', 'Location', 1),
  node('node.setting.inn', 'worldbook-main', 'node.setting.location', 'Inn', 1),
  node('node.setting.fog', 'worldbook-main', 'node.setting.location', 'Fog Harbor', 2),
  node('node.plugin.root', 'weather-plugin', null, 'Weather Plugin', 9),
  node('node.plugin.rain', 'weather-plugin', 'node.plugin.root', 'Rain', 1),
]

describe('prompt builder compiler', () => {
  it('keeps source-tree drag scoped to fragment order inside the same dynamic slot', () => {
    const compiled = compilePromptDataModel({
      skeleton: defaultCompositionSkeleton,
      sourceNodes,
      fragments: [
        fragment('setting.fog', 'settingLayer', 'worldbook-main', 'node.setting.fog', '雾港是一座潮湿安静的海港。', {
          injectionGroupKey: 'setting.stable',
          joinSlotKey: 'setting-layer:worldbook-main@setting.stable',
          entryOrderHint: 20,
        }),
        fragment('setting.inn', 'settingLayer', 'worldbook-main', 'node.setting.inn', '旧旅馆的柜台铃会吸引店主注意。', {
          injectionGroupKey: 'setting.stable',
          joinSlotKey: 'setting-layer:worldbook-main@setting.stable',
          entryOrderHint: 10,
        }),
        fragment('plugin.rain', 'settingLayer', 'weather-plugin', 'node.plugin.rain', '雨势正在增强。', {
          injectionGroupKey: 'setting.stable',
          slotOrderHint: 5,
        }),
      ],
      orderProfile: emptyProjectionOrderProfile,
    })
    const stable = compiled.zones.find(zone => zone.zoneKey === 'stable-prefix')

    expect(stable?.slots.map(slot => slot.slotKey)).toEqual([
      'setting-layer:weather-plugin@setting.stable',
      'setting-layer:worldbook-main@setting.stable',
    ])
    expect(stable?.slots.find(slot => slot.slotKey === 'setting-layer:worldbook-main@setting.stable')?.fragments.map(item => item.id)).toEqual([
      'setting.inn',
      'setting.fog',
    ])
  })

  it('uses preset projection ranks as the final slot order override', () => {
    const compiled = compilePromptDataModel({
      skeleton: defaultCompositionSkeleton,
      sourceNodes,
      fragments: [
        fragment('setting.fog', 'settingLayer', 'worldbook-main', 'node.setting.fog', '雾港是一座潮湿安静的海港。', {
          injectionGroupKey: 'setting.stable',
        }),
        fragment('plugin.rain', 'settingLayer', 'weather-plugin', 'node.plugin.rain', '雨势正在增强。', {
          injectionGroupKey: 'setting.stable',
          slotOrderHint: 5,
        }),
      ],
      orderProfile: {
        id: 'profile.preset.main',
        scope: 'session',
        slotRanks: [
          {
            injectionGroupKey: 'setting.stable',
            slotKey: 'setting-layer:worldbook-main@setting.stable',
            rankKey: 'a',
          },
          {
            injectionGroupKey: 'setting.stable',
            slotKey: 'setting-layer:weather-plugin@setting.stable',
            rankKey: 'b',
          },
        ],
      },
    })
    const stable = compiled.zones.find(zone => zone.zoneKey === 'stable-prefix')

    expect(stable?.slots.map(slot => slot.slotKey)).toEqual([
      'setting-layer:worldbook-main@setting.stable',
      'setting-layer:weather-plugin@setting.stable',
    ])
    expect(stable?.slots.map(slot => slot.orderSource)).toEqual(['rank', 'rank'])
    expect(compiled.editorProjection.promptRows.map(row => `${row.slotKey}:${row.orderSource}`)).toEqual([
      'setting-layer:worldbook-main@setting.stable:rank',
      'setting-layer:weather-plugin@setting.stable:rank',
    ])
  })

  it('lets a preset register an additional zone and injection group', () => {
    const compiled = compilePromptDataModel({
      skeleton: defaultCompositionSkeleton,
      sourceNodes,
      contributions: [
        contribution('preset.memory', 'preset', 'default-airp-preset', 'node.plugin.root', '把旧线索压缩成记忆回声。', {
          injectionGroupKey: 'preset.memory-echo',
          joinSlotKey: 'preset:default-airp-preset@preset.memory-echo',
        }),
      ],
      skeletonPatch: {
        zones: [
          {
            id: 'zone.memory-echo',
            parentId: 'zone.root',
            key: 'memory-echo',
            displayName: 'Memory Echo',
            band: 'stable-prefix',
            orderIndex: 15,
            anchors: ['before', 'inside', 'after'],
            renderHint: {
              providerRoleHint: 'system',
              wrapper: 'section',
            },
          },
        ],
        injectionGroups: [
          {
            key: 'preset.memory-echo',
            displayName: 'Preset Memory Echo',
            targetZoneKey: 'memory-echo',
            anchor: 'inside',
            accepts: ['preset'],
          },
        ],
      },
      orderProfile: {
        id: 'profile.custom-zone',
        scope: 'session',
        slotRanks: [],
      },
    })

    expect(compiled.zones.map(zone => zone.zoneKey)).toEqual(['memory-echo'])
    expect(compiled.zones[0]?.displayName).toBe('Memory Echo')
    expect(compiled.messages).toEqual([
      { role: 'system', content: '把旧线索压缩成记忆回声。' },
    ])
  })

  it('materializes projection and activation capabilities into prompt fragments', () => {
    const fragments = materializePromptFragments([
      contribution('setting.inn', 'settingLayer', 'worldbook-main', 'node.setting.inn', '旧旅馆的柜台铃会吸引店主注意。', {
        injectionGroupKey: 'setting.stable',
        joinSlotKey: 'setting-layer:worldbook-main@setting.stable',
        entryOrderHint: 10,
        activation: { kind: 'keyword', keywords: ['旅馆'] },
      }),
    ])

    expect(fragments).toEqual([
      {
        id: 'setting.inn',
        source: {
          kind: 'settingLayer',
          sourceId: 'worldbook-main',
          sourceNodeId: 'node.setting.inn',
        },
        content: '旧旅馆的柜台铃会吸引店主注意。',
        projection: {
          injectionGroupKey: 'setting.stable',
          lifecycle: 'always',
          joinSlotKey: 'setting-layer:worldbook-main@setting.stable',
          entryOrderHint: 10,
          activation: { kind: 'keyword', keywords: ['旅馆'] },
        },
      },
    ])
  })

  it('compiles preset and setting layer contributions through the same capability path', () => {
    const compiled = compilePromptDataModel({
      skeleton: defaultCompositionSkeleton,
      sourceNodes,
      contributions: [
        contribution('preset.style', 'preset', 'default-airp-preset', 'node.plugin.root', '保持冷静克制的叙述。', {
          injectionGroupKey: 'preset.system',
          slotOrderHint: 10,
          entryOrderHint: 10,
        }),
        contribution('setting.inn', 'settingLayer', 'worldbook-main', 'node.setting.inn', '旧旅馆的柜台铃会吸引店主注意。', {
          injectionGroupKey: 'setting.stable',
          joinSlotKey: 'setting-layer:worldbook-main@setting.stable',
          slotOrderHint: 20,
          entryOrderHint: 10,
        }),
      ],
      orderProfile: emptyProjectionOrderProfile,
    })

    expect(compiled.zones.map(zone => zone.zoneKey)).toEqual(['stable-prefix'])
    expect(compiled.zones[0]?.slots.map(slot => slot.slotKey)).toEqual([
      'preset:default-airp-preset@preset.system',
      'setting-layer:worldbook-main@setting.stable',
    ])
    expect(compiled.messages).toEqual([
      {
        role: 'system',
        content: '保持冷静克制的叙述。\n\n旧旅馆的柜台铃会吸引店主注意。',
      },
    ])
  })
})

function node(id: string, sourceId: string, parentId: string | null, displayName: string, orderIndex: number): SourceNode {
  return { id, sourceId, parentId, displayName, orderIndex }
}

function fragment(
  id: string,
  kind: PromptSourceKind,
  sourceId: string,
  sourceNodeId: string,
  content: string,
  projection: Partial<PromptFragment['projection']>,
): PromptFragment {
  return {
    id,
    source: {
      kind,
      sourceId,
      sourceNodeId,
    },
    content,
    projection: {
      injectionGroupKey: 'setting.stable',
      lifecycle: 'always',
      ...projection,
    },
  }
}

function contribution(
  id: string,
  kind: PromptSourceKind,
  sourceId: string,
  sourceNodeId: string,
  content: string,
  projection: Partial<PromptContribution['capabilities']['projection']> & {
    activation?: PromptContribution['capabilities']['activation']
  },
): PromptContribution {
  const { activation, ...projectionCapability } = projection

  return {
    id,
    sourceRef: {
      kind,
      sourceId,
      sourceNodeId,
    },
    content,
    capabilities: {
      content: { kind: 'text' },
      ...(activation ? { activation } : {}),
      lifecycle: { lifecycle: 'always' },
      projection: {
        injectionGroupKey: 'setting.stable',
        ...projectionCapability,
      },
    },
  }
}
