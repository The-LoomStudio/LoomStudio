import { describe, expect, it } from 'vitest'

type Anchor = 'before' | 'inside' | 'after'
type ProviderRole = 'system' | 'assistant' | 'user'
type SourceKind = 'preset' | 'settingLayer' | 'narrativeChat'
type Activation = { kind: 'always' } | { kind: 'manual' } | { kind: 'keyword'; keywords: string[] }

type CompositionSkeleton = {
  id: string
  rootZoneId: string
  zones: ZoneNode[]
  injectionGroups: InjectionGroup[]
  fallbackZoneId: string
}

type ZoneNode = {
  id: string
  parentId: string | null
  key: string
  displayName: string
  band: 'stable-prefix' | 'narrative' | 'lower-context' | 'current-turn' | 'fresh-tail'
  orderIndex: number
  anchors: Anchor[]
  renderHint: {
    providerRoleHint: ProviderRole
    wrapper: 'section' | 'message'
  }
}

type InjectionGroup = {
  key: string
  displayName: string
  targetZoneKey: string
  anchor: Anchor
  accepts: SourceKind[]
}

type SourceNode = {
  id: string
  sourceId: string
  parentId: string | null
  displayName: string
  orderIndex: number
}

type PromptFragment = {
  id: string
  source: {
    kind: SourceKind
    sourceId: string
    sourceNodeId: string
  }
  content: string
  projection: {
    injectionGroupKey: string
    lifecycle: 'always' | 'conditional' | 'fresh'
    sourceSlotKey?: string
    joinSlotKey?: string
    slotOrderHint?: number
    entryOrderHint?: number
    activation?: Activation
  }
}

type ProjectionOrderProfile = {
  id: string
  scope: 'global' | 'session'
  slotRanks: Array<{
    injectionGroupKey: string
    anchor?: Anchor
    slotKey: string
    rankKey: string
  }>
}

type CompiledPrompt = {
  zones: CompiledZone[]
  messages: Array<{ role: ProviderRole; content: string }>
  editorProjection: EditorProjection
}

type CompiledZone = {
  zoneKey: string
  displayName: string
  anchor: Anchor
  slots: CompiledSlot[]
}

type CompiledSlot = {
  slotKey: string
  fragments: PromptFragment[]
  orderSource: 'rank' | 'slotOrderHint' | 'sourceTreeFallback'
}

type EditorProjection = {
  sourceRows: Array<{
    fragmentId: string
    sourceNodeId: string
    sourcePath: string
    injectionGroupKey: string
    slotKey: string
  }>
  promptRows: Array<{
    zoneKey: string
    anchor: Anchor
    slotKey: string
    fragmentIds: string[]
  }>
}

const defaultSkeleton: CompositionSkeleton = {
  id: 'skeleton.airp-default',
  rootZoneId: 'zone.root',
  fallbackZoneId: 'zone.lower-context',
  zones: [
    zone('zone.stable-prefix', 'zone.root', 'stable-prefix', 'Stable Prefix', 'stable-prefix', 10, 'system'),
    zone('zone.narrative-context', 'zone.root', 'narrative-context', 'Narrative Context', 'narrative', 20, 'assistant'),
    zone('zone.lower-context', 'zone.root', 'lower-context', 'Lower Context', 'lower-context', 30, 'system'),
    zone('zone.current-turn', 'zone.root', 'current-turn', 'Current Turn', 'current-turn', 40, 'user'),
    zone('zone.fresh-tail', 'zone.root', 'fresh-tail', 'Fresh Tail', 'fresh-tail', 50, 'system'),
  ],
  injectionGroups: [
    group('preset.system', 'Preset System', 'stable-prefix', 'inside', ['preset']),
    group('setting.stable', 'Stable Setting', 'stable-prefix', 'inside', ['settingLayer']),
    group('setting.lower', 'Lower Context Setting', 'lower-context', 'inside', ['settingLayer']),
    group('chat.history', 'Narrative History', 'narrative-context', 'inside', ['narrativeChat']),
    group('chat.before', 'Before Current Chat', 'current-turn', 'before', ['settingLayer', 'preset']),
    group('chat.inside', 'Current Chat', 'current-turn', 'inside', ['narrativeChat']),
    group('chat.after', 'After Current Chat', 'current-turn', 'after', ['settingLayer', 'preset']),
    group('fresh.tail', 'Fresh Tail', 'fresh-tail', 'inside', ['preset', 'settingLayer']),
  ],
}

const defaultSourceNodes: SourceNode[] = [
  sourceNode('node.preset.root', 'default-airp-preset', null, '预设', 0),
  sourceNode('node.preset.core', 'default-airp-preset', 'node.preset.root', '核心', 1),
  sourceNode('node.preset.core.contract', 'default-airp-preset', 'node.preset.core', '系统契约', 1),
  sourceNode('node.preset.style', 'default-airp-preset', 'node.preset.root', '文风', 2),
  sourceNode('node.preset.style.noir', 'default-airp-preset', 'node.preset.style', '雾港黑色电影', 1),
  sourceNode('node.preset.input', 'default-airp-preset', 'node.preset.root', '输入处理', 3),
  sourceNode('node.preset.input.rule', 'default-airp-preset', 'node.preset.input', '规则', 1),
  sourceNode('node.preset.input.rewrite', 'default-airp-preset', 'node.preset.input', '动作承接', 2),
  sourceNode('node.preset.output', 'default-airp-preset', 'node.preset.root', '输出', 4),
  sourceNode('node.preset.output.short', 'default-airp-preset', 'node.preset.output', '短回复', 1),
  sourceNode('node.preset.output.format', 'default-airp-preset', 'node.preset.output', '正文格式', 2),
  sourceNode('node.setting.root', 'worldbook-main', null, '卡包设定', 1),
  sourceNode('node.setting.location', 'worldbook-main', 'node.setting.root', '地点', 1),
  sourceNode('node.setting.fog-harbor', 'worldbook-main', 'node.setting.location', '雾港', 1),
  sourceNode('node.setting.alice', 'worldbook-main', 'node.setting.location', '爱丽丝', 2),
  sourceNode('node.setting.inn', 'worldbook-main', 'node.setting.location', '旧旅馆', 3),
  sourceNode('node.setting.black-tower', 'worldbook-main', 'node.setting.location', '黑塔', 4),
  sourceNode('node.setting.event', 'worldbook-main', 'node.setting.root', '事件', 2),
  sourceNode('node.setting.riot', 'worldbook-main', 'node.setting.event', '叛乱开始', 1),
  sourceNode('node.setting.secret', 'worldbook-main', 'node.setting.root', '秘密', 9),
  sourceNode('node.setting.hidden-truth', 'worldbook-main', 'node.setting.secret', '真相', 1),
  sourceNode('node.dlc.root', 'costume-dlc', null, 'DLC', 8),
  sourceNode('node.dlc.costume', 'costume-dlc', 'node.dlc.root', '服装', 1),
  sourceNode('node.dlc.raincoat', 'costume-dlc', 'node.dlc.costume', '雨披', 1),
  sourceNode('node.plugin.root', 'plugin-weather', null, '插件', 9),
  sourceNode('node.plugin.weather', 'plugin-weather', 'node.plugin.root', '天气', 1),
  sourceNode('node.plugin.weather.rain', 'plugin-weather', 'node.plugin.weather', '当前雨势', 1),
  sourceNode('node.chat.root', 'session-main', null, 'session', 10),
  sourceNode('node.chat.main', 'session-main', 'node.chat.root', 'main', 1),
  sourceNode('node.chat.opening', 'session-main', 'node.chat.main', '000-opening', 0),
  sourceNode('node.chat.user.001', 'session-main', 'node.chat.main', '001-user', 1),
  sourceNode('node.chat.assistant.002', 'session-main', 'node.chat.main', '002-assistant', 2),
  sourceNode('node.chat.current-input', 'session-main', 'node.chat.main', 'current-input', 3),
]

describe('prompt builder data model feasibility', () => {
  it('projects preset, setting layer, and narrative chat into default zones and dynamic source-scoped slots', () => {
    const fragments = [
      presetFragment('preset.core.contract', 'node.preset.core.contract', '你是 AIRP 剧情 Agent。', 'preset.system'),
      settingFragment('setting.alice', 'node.setting.alice', '爱丽丝是王都旅馆老板。', 'setting.stable'),
      settingFragment('setting.black-tower', 'node.setting.black-tower', '黑塔在雾中若隐若现。', 'setting.lower'),
      chatFragment('chat.opening', 'node.chat.opening', '雨夜，旅馆门铃响起。', 'chat.history'),
      chatFragment('chat.user.001', 'node.chat.user.001', '我走向柜台。', 'chat.history'),
      chatFragment('chat.assistant.002', 'node.chat.assistant.002', '老板抬头看向你。', 'chat.history'),
      chatFragment('chat.current-input', 'node.chat.current-input', '我询问黑塔的传闻。', 'chat.inside'),
    ]

    const compiled = compilePromptDataModel({
      skeleton: defaultSkeleton,
      sourceNodes: defaultSourceNodes,
      fragments,
      orderProfile: emptyOrderProfile,
    })

    expect(compiled.messages.map(message => message.role)).toEqual(['system', 'assistant', 'system', 'user'])
    expect(compiled.messages[0]?.content).toContain('你是 AIRP 剧情 Agent。')
    expect(compiled.messages[0]?.content).toContain('爱丽丝是王都旅馆老板。')
    expect(compiled.messages[1]?.content).toContain('雨夜，旅馆门铃响起。')
    expect(compiled.messages[1]?.content).toContain('老板抬头看向你。')
    expect(compiled.messages[2]?.content).toContain('黑塔在雾中若隐若现。')
    expect(compiled.messages[3]?.content).toBe('我询问黑塔的传闻。')
    expect(compiled.editorProjection.sourceRows).toContainEqual({
      fragmentId: 'setting.black-tower',
      sourceNodeId: 'node.setting.black-tower',
      sourcePath: '/卡包设定/地点/黑塔',
      injectionGroupKey: 'setting.lower',
      slotKey: 'setting-layer:worldbook-main@setting.lower',
    })
    expect(compiled.editorProjection.promptRows.map(row => `${row.zoneKey}/${row.anchor}/${row.slotKey}`)).toContain(
      'lower-context/inside/setting-layer:worldbook-main@setting.lower',
    )
  })

  it('lets a projection order profile reorder prompt slots without mutating source-tree storage', () => {
    const fragments = [
      settingFragment('setting.alice', 'node.setting.alice', '爱丽丝是王都旅馆老板。', 'setting.stable', { slotOrderHint: 20 }),
      settingFragment('setting.costume', 'node.dlc.raincoat', '雨披让角色保持干燥。', 'setting.stable', { slotOrderHint: 10 }),
      settingFragment('setting.plugin', 'node.plugin.weather.rain', '雨势正在增强。', 'setting.stable', { slotOrderHint: 30 }),
    ]
    const reordered = compilePromptDataModel({
      skeleton: defaultSkeleton,
      sourceNodes: defaultSourceNodes,
      fragments,
      orderProfile: {
        id: 'profile.session.current',
        scope: 'session',
        slotRanks: [
          {
            injectionGroupKey: 'setting.stable',
            slotKey: 'setting-layer:plugin-weather@setting.stable',
            rankKey: 'a',
          },
          {
            injectionGroupKey: 'setting.stable',
            slotKey: 'setting-layer:worldbook-main@setting.stable',
            rankKey: 'b',
          },
          {
            injectionGroupKey: 'setting.stable',
            slotKey: 'setting-layer:costume-dlc@setting.stable',
            rankKey: 'c',
          },
        ],
      },
    })

    const stableZone = findZone(reordered, 'stable-prefix', 'inside')

    expect(stableZone.slots.map(slot => slot.slotKey)).toEqual([
      'setting-layer:plugin-weather@setting.stable',
      'setting-layer:worldbook-main@setting.stable',
      'setting-layer:costume-dlc@setting.stable',
    ])
    expect(stableZone.slots.every(slot => slot.orderSource === 'rank')).toBe(true)
    expect(reordered.editorProjection.sourceRows.map(row => row.sourcePath)).toEqual([
      '/卡包设定/地点/爱丽丝',
      '/DLC/服装/雨披',
      '/插件/天气/当前雨势',
    ])
  })

  it('models before / inside / after current-turn anchors for prompt preview and editing panels', () => {
    const fragments = [
      presetFragment('preset.input-rule', 'node.preset.input.rule', '把玩家输入视为下一幕动作。', 'chat.before'),
      settingFragment('setting.riot', 'node.setting.riot', '街上传来骚动。', 'chat.before'),
      chatFragment('chat.current-input', 'node.chat.current-input', '我推开窗户。', 'chat.inside'),
      presetFragment('preset.output-format', 'node.preset.output.short', '输出一段自然剧情正文。', 'chat.after'),
    ]

    const compiled = compilePromptDataModel({
      skeleton: defaultSkeleton,
      sourceNodes: defaultSourceNodes,
      fragments,
      orderProfile: emptyOrderProfile,
    })

    expect(compiled.messages.map(message => message.content)).toEqual([
      '把玩家输入视为下一幕动作。\n\n街上传来骚动。',
      '我推开窗户。',
      '输出一段自然剧情正文。',
    ])
    expect(compiled.editorProjection.promptRows).toEqual([
      {
        zoneKey: 'current-turn',
        anchor: 'before',
        slotKey: 'preset:default-airp-preset@chat.before',
        fragmentIds: ['preset.input-rule'],
      },
      {
        zoneKey: 'current-turn',
        anchor: 'before',
        slotKey: 'setting-layer:worldbook-main@chat.before',
        fragmentIds: ['setting.riot'],
      },
      {
        zoneKey: 'current-turn',
        anchor: 'inside',
        slotKey: 'narrative-chat:session-main@chat.inside',
        fragmentIds: ['chat.current-input'],
      },
      {
        zoneKey: 'current-turn',
        anchor: 'after',
        slotKey: 'preset:default-airp-preset@chat.after',
        fragmentIds: ['preset.output-format'],
      },
    ])
  })

  it('stress-tests complex preset and setting layer projection without turning storage trees into prompt order', () => {
    const fragments = [
      presetFragment('preset.core.contract', 'node.preset.core.contract', '保持第二人称沉浸式剧情，不解释系统。', 'preset.system', { entryOrderHint: 10 }),
      presetFragment('preset.style.noir', 'node.preset.style.noir', '文风偏潮湿、克制、带一点不安。', 'preset.system', { entryOrderHint: 20 }),
      presetFragment('preset.input.rewrite', 'node.preset.input.rewrite', '把玩家输入承接为当前动作，不抢夺玩家意图。', 'chat.before'),
      presetFragment('preset.output.format', 'node.preset.output.format', '只输出剧情正文，不输出分析。', 'chat.after'),
      settingFragment('setting.fog-harbor', 'node.setting.fog-harbor', '雾港是一座潮湿安静的海港城镇。', 'setting.stable', {
        slotOrderHint: 20,
        activation: { kind: 'always' },
      }),
      settingFragment('setting.inn', 'node.setting.inn', '旧旅馆的柜台铃会吸引店主注意。', 'setting.stable', {
        joinSlotKey: 'setting-layer:worldbook-main@setting.stable',
        entryOrderHint: 5,
        activation: { kind: 'keyword', keywords: ['旅馆', '柜台铃'] },
      }),
      settingFragment('setting.black-tower', 'node.setting.black-tower', '黑塔只在退潮后从雾中显露。', 'setting.lower', {
        activation: { kind: 'keyword', keywords: ['黑塔'] },
      }),
      settingFragment('setting.hidden-truth', 'node.setting.hidden-truth', '店主其实认识失踪的船长。', 'setting.lower', {
        activation: { kind: 'manual' },
      }),
      settingFragment('setting.raincoat-dlc', 'node.dlc.raincoat', '雨披让角色在暴雨中保持行动能力。', 'setting.stable', {
        slotOrderHint: 10,
        activation: { kind: 'always' },
      }),
      settingFragment('setting.weather-plugin', 'node.plugin.weather.rain', '雨势正在增强，街道积水反光。', 'chat.before', {
        lifecycle: 'fresh',
        activation: { kind: 'keyword', keywords: ['雨', '窗外'] },
      }),
      chatFragment('chat.opening', 'node.chat.opening', '雨夜，你推开旧旅馆的门。', 'chat.history'),
      chatFragment('chat.user.001', 'node.chat.user.001', '我摘下湿透的帽子。', 'chat.history'),
      chatFragment('chat.assistant.002', 'node.chat.assistant.002', '柜台后的铃铛轻轻晃了一下。', 'chat.history'),
      chatFragment('chat.current-input', 'node.chat.current-input', '我看向窗外的雨，又按响柜台铃。', 'chat.inside'),
    ]

    const compiled = compilePromptDataModel({
      skeleton: defaultSkeleton,
      sourceNodes: defaultSourceNodes,
      fragments,
      orderProfile: {
        id: 'profile.session.fog-harbor',
        scope: 'session',
        slotRanks: [
          {
            injectionGroupKey: 'preset.system',
            slotKey: 'preset:default-airp-preset@preset.system',
            rankKey: 'a',
          },
          {
            injectionGroupKey: 'setting.stable',
            slotKey: 'setting-layer:worldbook-main@setting.stable',
            rankKey: 'b',
          },
          {
            injectionGroupKey: 'setting.stable',
            slotKey: 'setting-layer:costume-dlc@setting.stable',
            rankKey: 'c',
          },
        ],
      },
      currentInput: '我看向窗外的雨，又按响柜台铃。',
    })
    const stablePrefix = findZone(compiled, 'stable-prefix', 'inside')
    const currentBefore = findZone(compiled, 'current-turn', 'before')
    const currentInside = findZone(compiled, 'current-turn', 'inside')
    const currentAfter = findZone(compiled, 'current-turn', 'after')

    expect(stablePrefix.slots.map(slot => slot.slotKey)).toEqual([
      'preset:default-airp-preset@preset.system',
      'setting-layer:worldbook-main@setting.stable',
      'setting-layer:costume-dlc@setting.stable',
    ])
    expect(stablePrefix.slots[1]?.fragments.map(fragment => fragment.id)).toEqual([
      'setting.inn',
      'setting.fog-harbor',
    ])
    expect(currentBefore.slots.flatMap(slot => slot.fragments.map(fragment => fragment.id))).toEqual([
      'preset.input.rewrite',
      'setting.weather-plugin',
    ])
    expect(currentInside.slots.flatMap(slot => slot.fragments.map(fragment => fragment.id))).toEqual(['chat.current-input'])
    expect(currentAfter.slots.flatMap(slot => slot.fragments.map(fragment => fragment.id))).toEqual(['preset.output.format'])
    expect(compiled.messages.map(message => message.role)).toEqual(['system', 'assistant', 'user', 'user', 'user'])
    expect(compiled.messages.map(message => message.content).join('\n')).toContain('旧旅馆的柜台铃会吸引店主注意。')
    expect(compiled.messages.map(message => message.content).join('\n')).toContain('雨势正在增强，街道积水反光。')
    expect(compiled.messages.map(message => message.content).join('\n')).not.toContain('店主其实认识失踪的船长。')
    expect(compiled.messages.map(message => message.content).join('\n')).not.toContain('黑塔只在退潮后从雾中显露。')
    expect(compiled.editorProjection.sourceRows).toContainEqual({
      fragmentId: 'setting.hidden-truth',
      sourceNodeId: 'node.setting.hidden-truth',
      sourcePath: '/卡包设定/秘密/真相',
      injectionGroupKey: 'setting.lower',
      slotKey: 'setting-layer:worldbook-main@setting.lower',
    })
    expect(compiled.editorProjection.promptRows.flatMap(row => row.fragmentIds)).not.toContain('setting.hidden-truth')
  })
})

const emptyOrderProfile: ProjectionOrderProfile = {
  id: 'profile.empty',
  scope: 'global',
  slotRanks: [],
}

function compilePromptDataModel(input: {
  skeleton: CompositionSkeleton
  sourceNodes: SourceNode[]
  fragments: PromptFragment[]
  orderProfile: ProjectionOrderProfile
  currentInput?: string
}): CompiledPrompt {
  const groupsByKey = new Map(input.skeleton.injectionGroups.map(group => [group.key, group]))
  const zonesByKey = new Map(input.skeleton.zones.map(zone => [zone.key, zone]))
  const sourceNodesById = new Map(input.sourceNodes.map(node => [node.id, node]))
  const compiledZones = new Map<string, CompiledZone>()
  const activeFragments = input.fragments.filter(fragment => fragmentMatchesActivation(fragment, input.currentInput ?? ''))

  for (const fragment of activeFragments) {
    const group = groupsByKey.get(fragment.projection.injectionGroupKey)
    if (!group) throw new Error(`Unknown injection group: ${fragment.projection.injectionGroupKey}`)
    if (!group.accepts.includes(fragment.source.kind)) {
      throw new Error(`Injection group ${group.key} does not accept ${fragment.source.kind}`)
    }

    const zone = zonesByKey.get(group.targetZoneKey)
    if (!zone) throw new Error(`Unknown zone: ${group.targetZoneKey}`)
    const zoneKey = `${zone.key}:${group.anchor}`
    const compiledZone = compiledZones.get(zoneKey) ?? {
      zoneKey: zone.key,
      displayName: zone.displayName,
      anchor: group.anchor,
      slots: [],
    }
    const slotKey = materializeSlotKey(fragment)
    const slot = compiledZone.slots.find(item => item.slotKey === slotKey) ?? {
      slotKey,
      fragments: [],
      orderSource: 'sourceTreeFallback' as const,
    }
    slot.fragments.push(fragment)

    if (!compiledZone.slots.includes(slot)) compiledZone.slots.push(slot)
    compiledZones.set(zoneKey, compiledZone)
  }

  const sortedZones = [...compiledZones.values()]
    .map(zone => sortCompiledZone(zone, input.orderProfile, sourceNodesById))
    .sort((left, right) => {
      const leftZone = zonesByKey.get(left.zoneKey)
      const rightZone = zonesByKey.get(right.zoneKey)
      return (leftZone?.orderIndex ?? 0) - (rightZone?.orderIndex ?? 0)
        || anchorOrder(left.anchor) - anchorOrder(right.anchor)
    })
  const messages = sortedZones.map(zone => {
    const renderZone = zonesByKey.get(zone.zoneKey)
    if (!renderZone) throw new Error(`Unknown compiled zone: ${zone.zoneKey}`)

    return {
      role: renderZone.renderHint.providerRoleHint,
      content: zone.slots
        .flatMap(slot => slot.fragments)
        .map(fragment => fragment.content)
        .join('\n\n'),
    }
  })

  return {
    zones: sortedZones,
    messages,
    editorProjection: {
      sourceRows: input.fragments.map(fragment => ({
        fragmentId: fragment.id,
        sourceNodeId: fragment.source.sourceNodeId,
        sourcePath: readSourcePath(sourceNodesById, fragment.source.sourceNodeId),
        injectionGroupKey: fragment.projection.injectionGroupKey,
        slotKey: materializeSlotKey(fragment),
      })),
      promptRows: sortedZones.flatMap(zone => zone.slots.map(slot => ({
        zoneKey: zone.zoneKey,
        anchor: zone.anchor,
        slotKey: slot.slotKey,
        fragmentIds: slot.fragments.map(fragment => fragment.id),
      }))),
    },
  }
}

function sortCompiledZone(zone: CompiledZone, profile: ProjectionOrderProfile, sourceNodesById: Map<string, SourceNode>): CompiledZone {
  return {
    ...zone,
    slots: [...zone.slots]
      .map(slot => ({
        ...slot,
        fragments: [...slot.fragments].sort((left, right) => compareFragmentOrder(sourceNodesById, left, right)),
        orderSource: readSlotRank(profile, slot) ? 'rank' : slot.fragments.some(fragment => fragment.projection.slotOrderHint !== undefined) ? 'slotOrderHint' : 'sourceTreeFallback',
      }))
      .sort((left, right) => compareSlotOrder(profile, sourceNodesById, left, right)),
  }
}

function compareSlotOrder(profile: ProjectionOrderProfile, sourceNodesById: Map<string, SourceNode>, left: CompiledSlot, right: CompiledSlot): number {
  const leftRank = readSlotRank(profile, left)
  const rightRank = readSlotRank(profile, right)
  if (leftRank || rightRank) return compareText(leftRank ?? 'zzzz', rightRank ?? 'zzzz')

  const leftHint = Math.min(...left.fragments.map(fragment => fragment.projection.slotOrderHint ?? Number.POSITIVE_INFINITY))
  const rightHint = Math.min(...right.fragments.map(fragment => fragment.projection.slotOrderHint ?? Number.POSITIVE_INFINITY))
  if (leftHint !== rightHint) return leftHint - rightHint

  return comparePath(readSourceOrderPath(sourceNodesById, left.fragments[0]?.source.sourceNodeId), readSourceOrderPath(sourceNodesById, right.fragments[0]?.source.sourceNodeId))
    || compareText(left.slotKey, right.slotKey)
}

function compareFragmentOrder(sourceNodesById: Map<string, SourceNode>, left: PromptFragment, right: PromptFragment): number {
  const leftHint = left.projection.entryOrderHint ?? Number.POSITIVE_INFINITY
  const rightHint = right.projection.entryOrderHint ?? Number.POSITIVE_INFINITY
  if (leftHint !== rightHint) return leftHint - rightHint
  return comparePath(readSourceOrderPath(sourceNodesById, left.source.sourceNodeId), readSourceOrderPath(sourceNodesById, right.source.sourceNodeId)) || compareText(left.id, right.id)
}

function readSlotRank(profile: ProjectionOrderProfile, slot: CompiledSlot): string | undefined {
  return profile.slotRanks.find(rank => rank.slotKey === slot.slotKey)?.rankKey
}

function materializeSlotKey(fragment: PromptFragment): string {
  if (fragment.projection.joinSlotKey) return fragment.projection.joinSlotKey
  const sourceSlotKey = fragment.projection.sourceSlotKey ?? fragment.source.sourceId
  return `${kindToSlotPrefix(fragment.source.kind)}:${sourceSlotKey}@${fragment.projection.injectionGroupKey}`
}

function presetFragment(
  id: string,
  sourceNodeId: string,
  content: string,
  injectionGroupKey: string,
  projection: Partial<PromptFragment['projection']> = {},
): PromptFragment {
  return fragment({
    id,
    kind: 'preset',
    sourceNodeId,
    content,
    injectionGroupKey,
    projection,
  })
}

function settingFragment(
  id: string,
  sourceNodeId: string,
  content: string,
  injectionGroupKey: string,
  projection: Partial<PromptFragment['projection']> = {},
): PromptFragment {
  return fragment({
    id,
    kind: 'settingLayer',
    sourceNodeId,
    content,
    injectionGroupKey,
    projection,
  })
}

function chatFragment(id: string, sourceNodeId: string, content: string, injectionGroupKey: string): PromptFragment {
  return fragment({
    id,
    kind: 'narrativeChat',
    sourceNodeId,
    content,
    injectionGroupKey,
  })
}

function fragment(input: {
  id: string
  kind: SourceKind
  sourceNodeId: string
  content: string
  injectionGroupKey: string
  projection?: Partial<PromptFragment['projection']>
}): PromptFragment {
  return {
    id: input.id,
    source: {
      kind: input.kind,
      sourceId: sourceIdForNode(input.sourceNodeId),
      sourceNodeId: input.sourceNodeId,
    },
    content: input.content,
    projection: {
      injectionGroupKey: input.injectionGroupKey,
      lifecycle: 'always',
      ...input.projection,
    },
  }
}

function zone(
  id: string,
  parentId: string,
  key: ZoneNode['key'],
  displayName: string,
  band: ZoneNode['band'],
  orderIndex: number,
  providerRoleHint: ProviderRole,
): ZoneNode {
  return {
    id,
    parentId,
    key,
    displayName,
    band,
    orderIndex,
    anchors: ['before', 'inside', 'after'],
    renderHint: {
      providerRoleHint,
      wrapper: 'section',
    },
  }
}

function group(key: string, displayName: string, targetZoneKey: string, anchor: Anchor, accepts: SourceKind[]): InjectionGroup {
  return { key, displayName, targetZoneKey, anchor, accepts }
}

function sourceNode(id: string, sourceId: string, parentId: string | null, displayName: string, orderIndex: number): SourceNode {
  return { id, sourceId, parentId, displayName, orderIndex }
}

function sourceIdForNode(sourceNodeId: string): string {
  const node = defaultSourceNodes.find(item => item.id === sourceNodeId)
  if (!node) throw new Error(`Source node not found: ${sourceNodeId}`)
  return node.sourceId
}

function findZone(compiled: CompiledPrompt, zoneKey: string, anchor: Anchor): CompiledZone {
  const zone = compiled.zones.find(item => item.zoneKey === zoneKey && item.anchor === anchor)
  if (!zone) throw new Error(`Compiled zone not found: ${zoneKey}/${anchor}`)
  return zone
}

function readSourcePath(sourceNodesById: Map<string, SourceNode>, nodeId: string): string {
  const names: string[] = []
  let cursor: string | null = nodeId

  while (cursor) {
    const node = sourceNodesById.get(cursor)
    if (!node) throw new Error(`Source node not found: ${cursor}`)
    names.push(node.displayName)
    cursor = node.parentId
  }

  return `/${names.reverse().join('/')}`
}

function readSourceOrderPath(sourceNodesById: Map<string, SourceNode>, nodeId: string | undefined): number[] {
  if (!nodeId) return []
  const orderPath: number[] = []
  let cursor: string | null = nodeId

  while (cursor) {
    const node = sourceNodesById.get(cursor)
    if (!node) throw new Error(`Source node not found: ${cursor}`)
    orderPath.push(node.orderIndex)
    cursor = node.parentId
  }

  return orderPath.reverse()
}

function anchorOrder(anchor: Anchor): number {
  return anchor === 'before' ? 0 : anchor === 'inside' ? 1 : 2
}

function comparePath(left: number[], right: number[]): number {
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right)
}

function fragmentMatchesActivation(fragment: PromptFragment, input: string): boolean {
  const activation = fragment.projection.activation ?? { kind: 'always' }
  if (activation.kind === 'always') return true
  if (activation.kind === 'manual') return false
  return activation.keywords.some(keyword => input.includes(keyword))
}

function kindToSlotPrefix(kind: SourceKind): string {
  if (kind === 'settingLayer') return 'setting-layer'
  if (kind === 'narrativeChat') return 'narrative-chat'
  return kind
}
