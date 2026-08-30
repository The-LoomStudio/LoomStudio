import {
  compilePromptDataModel,
  defaultCompositionSkeleton,
  emptyProjectionOrderProfile,
  materializePromptFragments,
  type PromptContribution,
  type PromptFragment,
  type PromptSourceKind,
  type SourceNode,
} from '../../../packages/application-runtime/src/prompt/prompt-builder.js'
import { combineActivationGates } from '../../../packages/application-runtime/src/prompt/prompt-activation.js'
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
  it('combines container activation gates as pass-through vetoes', () => {
    const activation = combineActivationGates([
      { kind: 'always' },
      { kind: 'manual' },
    ])
    const compiled = compilePromptDataModel({
      skeleton: defaultCompositionSkeleton,
      sourceNodes,
      fragments: [
        fragment('setting.manual-child', 'settingLayer', 'worldbook-main', 'node.setting.inn', '不会被父级 always 强制打开。', {
          zoneId: 'setting.stable',
          activation,
        }),
      ],
      orderProfile: emptyProjectionOrderProfile,
    })

    expect(compiled.messages[0]?.content).toBeUndefined()
    expect(compiled.editorProjection.sourceRows[0]).toMatchObject({
      active: false,
      activationReason: 'activation: all blocked (activation: manual)',
    })
  })

  it('keeps source-tree drag scoped to fragment order inside the same dynamic slot', () => {
    const compiled = compilePromptDataModel({
      skeleton: defaultCompositionSkeleton,
      sourceNodes,
      fragments: [
        fragment('setting.fog', 'settingLayer', 'worldbook-main', 'node.setting.fog', '雾港是一座潮湿安静的海港。', {
          zoneId: 'setting.stable',
          joinSlotKey: 'setting-layer:worldbook-main@setting.stable',
          entryOrderHint: 20,
        }),
        fragment('setting.inn', 'settingLayer', 'worldbook-main', 'node.setting.inn', '旧旅馆的柜台铃会吸引店主注意。', {
          zoneId: 'setting.stable',
          joinSlotKey: 'setting-layer:worldbook-main@setting.stable',
          entryOrderHint: 10,
        }),
        fragment('plugin.rain', 'settingLayer', 'weather-plugin', 'node.plugin.rain', '雨势正在增强。', {
          zoneId: 'setting.stable',
          slotOrderHint: 5,
        }),
      ],
      orderProfile: emptyProjectionOrderProfile,
    })
    const stable = compiled.zones.find(zone => zone.zoneId === 'setting.stable')

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
          zoneId: 'setting.stable',
        }),
        fragment('plugin.rain', 'settingLayer', 'weather-plugin', 'node.plugin.rain', '雨势正在增强。', {
          zoneId: 'setting.stable',
          slotOrderHint: 5,
        }),
      ],
      orderProfile: {
        id: 'profile.preset.main',
        scope: 'session',
        slotRanks: [
          {
            zoneId: 'setting.stable',
            slotKey: 'setting-layer:worldbook-main@setting.stable',
            rankKey: 'a',
          },
          {
            zoneId: 'setting.stable',
            slotKey: 'setting-layer:weather-plugin@setting.stable',
            rankKey: 'b',
          },
        ],
      },
    })
    const stable = compiled.zones.find(zone => zone.zoneId === 'setting.stable')

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

  it('lets a preset register an additional zone', () => {
    const compiled = compilePromptDataModel({
      skeleton: defaultCompositionSkeleton,
      sourceNodes,
      contributions: [
        contribution('preset.memory', 'preset', 'default-airp-preset', 'node.plugin.root', '把旧线索压缩成记忆回声。', {
          zoneId: 'preset.memory-echo',
          joinSlotKey: 'preset:default-airp-preset@preset.memory-echo',
        }),
      ],
      skeletonPatch: {
        zones: [
          {
            id: 'preset.memory-echo',
            parentId: 'zone.root',
            displayName: 'Memory Echo',
            band: 'stable-prefix',
            orderIndex: 15,
            accepts: ['preset'],
            renderHint: {
              providerRoleHint: 'system',
              wrapper: 'section',
            },
          },
        ],
        items: [
          {
            kind: 'message',
            id: 'block.memory-echo',
            displayName: 'Memory Echo Block',
            orderIndex: 15,
            role: 'system',
            items: [
              {
                kind: 'zone',
                id: 'preset.memory-echo',
                parentId: 'zone.root',
                displayName: 'Memory Echo',
                band: 'stable-prefix',
                orderIndex: 15,
              },
            ],
          },
        ],
      },
      orderProfile: {
        id: 'profile.custom-zone',
        scope: 'session',
        slotRanks: [],
      },
    })

    expect(compiled.zones.map(zone => zone.zoneId)).toEqual(['preset.memory-echo'])
    expect(compiled.zones[0]?.displayName).toBe('Memory Echo')
    expect(compiled.messages).toEqual([
      { role: 'system', content: '把旧线索压缩成记忆回声。' },
    ])
  })

  it('materializes projection and activation capabilities into prompt fragments', () => {
    const fragments = materializePromptFragments([
      contribution('setting.inn', 'settingLayer', 'worldbook-main', 'node.setting.inn', '旧旅馆的柜台铃会吸引店主注意。', {
        zoneId: 'setting.stable',
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
          zoneId: 'setting.stable',
          lifecycle: 'always',
          joinSlotKey: 'setting-layer:worldbook-main@setting.stable',
          entryOrderHint: 10,
          activation: { kind: 'keyword', keywords: ['旅馆'] },
        },
      },
    ])
  })

  it('evaluates condition activation from prompt build facts', () => {
    const compiled = compilePromptDataModel({
      skeleton: defaultCompositionSkeleton,
      sourceNodes,
      fragments: [
        fragment('setting.final', 'settingLayer', 'worldbook-main', 'node.setting.inn', '进入最终润色模式。', {
          zoneId: 'setting.stable',
          activation: {
            kind: 'condition',
            conditions: [{ fact: 'agent.mode', equals: 'finalize' }],
          },
        }),
        fragment('setting.draft', 'settingLayer', 'worldbook-main', 'node.setting.fog', '进入短对话推演模式。', {
          zoneId: 'setting.stable',
          activation: {
            kind: 'condition',
            conditions: [{ fact: 'agent.mode', equals: 'draft' }],
          },
        }),
      ],
      orderProfile: emptyProjectionOrderProfile,
      activationFacts: {
        'agent.mode': 'finalize',
      },
    })
    const sourceRows = new Map(compiled.editorProjection.sourceRows.map(row => [row.fragmentId, row]))

    expect(compiled.messages[0]?.content).toContain('进入最终润色模式。')
    expect(compiled.messages[0]?.content).not.toContain('进入短对话推演模式。')
    expect(sourceRows.get('setting.final')).toMatchObject({
      active: true,
      activationReason: 'activation: conditions matched',
    })
    expect(sourceRows.get('setting.draft')).toMatchObject({
      active: false,
      activationReason: 'activation: conditions not matched',
    })
  })

  it('lets tag facts participate in activation conditions', () => {
    const compiled = compilePromptDataModel({
      skeleton: defaultCompositionSkeleton,
      sourceNodes,
      fragments: [
        fragment('setting.combat', 'settingLayer', 'worldbook-main', 'node.setting.inn', '战斗规则启用。', {
          zoneId: 'setting.stable',
          activation: {
            kind: 'condition',
            conditions: [{ fact: 'tags', includes: 'scene:combat' }],
          },
        }),
      ],
      orderProfile: emptyProjectionOrderProfile,
      activationFacts: {
        tags: ['scene:combat'],
      },
    })

    expect(compiled.messages[0]?.content).toContain('战斗规则启用。')
  })

  it('compiles preset and setting layer contributions through the same capability path', () => {
    const compiled = compilePromptDataModel({
      skeleton: defaultCompositionSkeleton,
      sourceNodes,
      contributions: [
        contribution('preset.style', 'preset', 'default-airp-preset', 'node.plugin.root', '保持冷静克制的叙述。', {
          zoneId: 'preset.system',
          slotOrderHint: 10,
          entryOrderHint: 10,
        }),
        contribution('setting.inn', 'settingLayer', 'worldbook-main', 'node.setting.inn', '旧旅馆的柜台铃会吸引店主注意。', {
          zoneId: 'setting.stable',
          joinSlotKey: 'setting-layer:worldbook-main@setting.stable',
          slotOrderHint: 20,
          entryOrderHint: 10,
        }),
      ],
      orderProfile: emptyProjectionOrderProfile,
    })

    expect(compiled.zones.map(zone => zone.zoneId)).toEqual(['preset.system', 'setting.stable'])
    expect(compiled.zones[0]?.slots.map(slot => slot.slotKey)).toEqual([
      'preset:default-airp-preset@preset.system',
    ])
    expect(compiled.zones[1]?.slots.map(slot => slot.slotKey)).toEqual([
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
      zoneId: 'setting.stable',
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
        zoneId: 'setting.stable',
        ...projectionCapability,
      },
    },
  }
}
