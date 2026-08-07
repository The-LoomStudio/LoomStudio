import type { ContextAssetNode } from '../entities/index.js'

export const demoContextAssets = [
    {
      id: 'preset-default-airp',
      label: 'Default AIRP Preset',
      meta: 'Composition Skeleton',
      category: 'preset',
      kind: 'module',
      body: '这是预设整体配置的说明区。\n\n后续可以在这里承载 provider family、提示词后处理、fallback policy 和 diagnostics policy。',
      configRows: [
        { label: 'Provider family', value: 'provider-neutral' },
        { label: 'Post-process', value: 'macro expand -> normalize -> diagnostics' },
        { label: 'Fallback zone', value: 'LowerContext' },
        { label: 'Trace', value: 'enabled' },
      ],
      children: [
        {
          id: 'projection-order-profile-main',
          label: 'Main Projection Order',
          meta: 'Projection Order Profile',
          category: 'preset',
          kind: 'order',
          body: '这是当前 Preset 的投影排序配置。它是可编辑的排序覆盖层，用来决定各类实际资产和运行时虚拟来源在 Zone 中的顺序。',
          skeletonPatch: {
            zones: [
              {
                id: 'preset.memory-echo',
                parentId: 'zone.root',
                displayName: 'Memory Echo',
                band: 'stable-prefix',
                orderIndex: 15,
                accepts: ['preset', 'runtime'],
                renderHint: {
                  providerRoleHint: 'system',
                  wrapper: 'section',
                },
              },
            ],
          },
          orderList: [
            'preset-style-light-novel',
            'preset-style-fantasy',
            'preset-dialogue-multi',
            'preset-dialogue-short',
            'preset-memory-echo',
            'preset-chathistory',
            'sl-rainline-station',
            'sl-archive-keeper',
            'sl-mirror-market',
            'sl-clocktower-riot',
            'sl-railway-inspector',
            'sl-underground-signal',
            'sl-brass-ticket',
            'preset-dialogue-rules',
            'preset-dialogue-convert',
            'vs-narrative-history',
            'vs-current-input'
          ],
          slotRanks: [
            { zoneId: 'preset.system', slotKey: 'preset:default-airp-preset@preset.system', rankKey: '0000' },
            { zoneId: 'preset.memory-echo', slotKey: 'preset:default-airp-preset@preset.memory-echo', rankKey: '0001' },
            { zoneId: 'setting.stable', slotKey: 'setting-layer:city-layers-main@setting.stable', rankKey: '0002' },
            { zoneId: 'chat.history', slotKey: 'narrative-chat:session-main@chat.history', rankKey: '0003' },
            { zoneId: 'setting.lower', slotKey: 'setting-layer:city-layers-main@setting.lower', rankKey: '0004' },
            { zoneId: 'chat.after', slotKey: 'preset:default-airp-preset@chat.after', rankKey: '0005' },
            { zoneId: 'chat.inside', slotKey: 'runtime:runtime.current-turn@chat.inside', rankKey: '0006' },
            { zoneId: 'fresh.tail', slotKey: 'setting-layer:city-layers-main@fresh.tail', rankKey: '0007' },
          ],
        },
        {
          id: 'preset-folder-style',
          label: '文风文件夹',
          meta: 'preset / style folder',
          kind: 'folder',
          children: [
            {
              id: 'preset-style-light-novel',
              label: '轻小说文风',
              meta: 'zone / StablePrefix',
              kind: 'entry',
              body: '采用日系轻小说的描写方式，注重人物内心独白、夸张的情绪反应和轻快的节奏。',
              capabilities: {
                projection: {
                  entryOrderHint: 10,
                  zoneId: 'preset.system',
                  order: 'fixed: 100',
                  slotKey: 'preset:default-airp-preset@preset.system',
                  slotOrderHint: 100,
                  sourceKind: 'actual',
                },
                lifecycle: { lifecycle: 'always' },
              },
            },
            {
              id: 'preset-style-fantasy',
              label: '西幻文风',
              meta: 'zone / StablePrefix',
              kind: 'entry',
              body: '采用古典史诗奇幻的文风，用词华丽、厚重，注重对环境细节、历史沧桑感和魔法神秘感的刻画。',
              capabilities: {
                projection: {
                  entryOrderHint: 20,
                  zoneId: 'preset.system',
                  order: 'fixed: 110',
                  slotKey: 'preset:default-airp-preset@preset.system',
                  slotOrderHint: 100,
                  sourceKind: 'actual',
                },
                lifecycle: { lifecycle: 'always' },
              },
            },
          ],
        },
        {
          id: 'preset-folder-dialogue',
          label: '对白',
          meta: 'preset / dialogue rules',
          kind: 'folder',
          children: [
            {
              id: 'preset-dialogue-multi',
              label: '多对白',
              meta: 'zone / StablePrefix',
              kind: 'entry',
              body: '角色之间倾向于进行多轮深入的交谈，增加互动频率。',
              capabilities: {
                projection: {
                  entryOrderHint: 30,
                  zoneId: 'preset.system',
                  order: 'fixed: 120',
                  slotKey: 'preset:default-airp-preset@preset.system',
                  slotOrderHint: 100,
                  sourceKind: 'actual',
                },
                lifecycle: { lifecycle: 'always' },
              },
            },
            {
              id: 'preset-dialogue-short',
              label: '短对白',
              meta: 'zone / StablePrefix',
              kind: 'entry',
              body: '对话必须简短有力，符合动作场面或紧张氛围下的语速。',
              capabilities: {
                projection: {
                  entryOrderHint: 40,
                  zoneId: 'preset.system',
                  order: 'fixed: 130',
                  slotKey: 'preset:default-airp-preset@preset.system',
                  slotOrderHint: 100,
                  sourceKind: 'actual',
                },
                lifecycle: { lifecycle: 'always' },
              },
            },
            {
              id: 'preset-dialogue-rules',
              label: '末尾再次强调对白规则',
              meta: 'zone / CurrentTurn after',
              kind: 'entry',
              body: '永远不要替 {{User}} 说话。NPC 的对话要符合其身份特征，并且一定要带有神态描写。',
              capabilities: {
                projection: {
                  entryOrderHint: 10,
                  zoneId: 'chat.after',
                  order: 'fixed: 900',
                  slotKey: 'preset:default-airp-preset@chat.after',
                  slotOrderHint: 900,
                  sourceKind: 'actual',
                },
                lifecycle: { lifecycle: 'always' },
              },
            },
            {
              id: 'preset-dialogue-convert',
              label: '特殊对白转换',
              meta: 'zone / CurrentTurn after',
              kind: 'entry',
              body: '如果当前场景发生在中世纪，将现代口语转换为中古口语。',
              capabilities: {
                projection: {
                  entryOrderHint: 20,
                  zoneId: 'chat.after',
                  order: 'fixed: 910',
                  slotKey: 'preset:default-airp-preset@chat.after',
                  slotOrderHint: 900,
                  sourceKind: 'actual',
                },
                lifecycle: { lifecycle: 'always' },
              },
            },
          ]
        },
        {
          id: 'preset-chathistory',
          label: '聊天记录',
          meta: 'placeholder / NarrativeContext',
          kind: 'virtual',
          body: '这是聊天记录占位符。Runtime 会将这里的文本替换为上下文。',
        },
        {
          id: 'preset-memory-echo',
          label: '记忆回声',
          meta: 'zone / MemoryEcho',
          kind: 'entry',
          body: '如果当前剧情提到曾经出现过的城市传闻，将其压缩成一段“记忆回声”，提醒 Agent 不要把旧线索当成新发现。',
          capabilities: {
            projection: {
              entryOrderHint: 10,
              zoneId: 'preset.memory-echo',
              order: 'fixed: 150',
              slotKey: 'preset:default-airp-preset@preset.memory-echo',
              slotOrderHint: 150,
              sourceKind: 'actual',
            },
            lifecycle: { lifecycle: 'always' },
          },
        },
      ],
    },
    {
      id: 'setting-layer-city-layers',
      label: 'Loom City SettingLayer',
      meta: 'Setting source tree',
      category: 'setting',
      kind: 'module',
      body: '这是 City Layers 的源树节点。用户在这里组织地点、角色、事件、物件等结构化数据。\n\n每条 entry 可以绑定 activation rule（always / keyword / manual）和 zone 投影规则。',
      configRows: [
        { label: 'Activation default', value: 'always' },
        { label: 'Zone default', value: 'StablePrefix' },
      ],
      children: [
        {
          id: 'sl-folder-world',
          label: 'world',
          kind: 'folder',
          children: [
            {
              id: 'sl-folder-location',
              label: 'location',
              kind: 'folder',
              children: [
                {
                  id: 'sl-rainline-station',
                  label: '雨线车站',
                  meta: 'world / location',
                  kind: 'entry',
                  enabled: true,
                  body: '雨线车站是 Loom City 的旧环线入口。\n夜间广播经常延迟，站台尽头有通往地下维护层的锁门。\n\n{{User}}当前刚走出车站，仍能听见轨道深处的回声。',
                  capabilities: {
                    projection: {
                      entryOrderHint: 10,
                      zoneId: 'setting.stable',
                      order: 'entry: 10',
                      reason: 'Setting layer entry: always active',
                      slotKey: 'setting-layer:city-layers-main@setting.stable',
                      slotOrderHint: 200,
                      sourceKind: 'actual',
                    },
                    lifecycle: { lifecycle: 'always' },
                  },
                },
                {
                  id: 'sl-mirror-market',
                  label: '镜市',
                  meta: 'world / location / keyword',
                  kind: 'entry',
                  enabled: true,
                  body: '镜市位于高架桥下，摊位用破碎镜片反射招牌灯。\n传闻有人在这里买卖被删除的身份记录，也有人专门回收没有归属的车票。',
                  capabilities: {
                    projection: {
                      entryOrderHint: 30,
                      zoneId: 'setting.stable',
                      order: 'entry: 30',
                      reason: 'Setting layer entry: keyword activated [镜市, 市场, 身份记录]',
                      slotKey: 'setting-layer:city-layers-main@setting.stable',
                      slotOrderHint: 200,
                      sourceKind: 'actual',
                    },
                    lifecycle: { lifecycle: 'keyword' },
                  },
                },
                {
                  id: 'sl-final-prose-polish',
                  label: '正文润色规则',
                  meta: 'runtime / agent.mode',
                  kind: 'entry',
                  enabled: true,
                  body: '当前处于正文润色阶段。输出应整合短推演结果，形成连贯、完整、可直接进入正文时间线的叙述段落。',
                  capabilities: {
                    activation: {
                      kind: 'condition',
                      conditions: [{ fact: 'agent.mode', equals: 'finalize' }],
                    },
                    projection: {
                      entryOrderHint: 50,
                      zoneId: 'setting.stable',
                      order: 'entry: 50',
                      reason: 'Activated when runtime fact agent.mode = finalize',
                      slotKey: 'setting-layer:city-layers-main@setting.stable',
                      slotOrderHint: 200,
                      sourceKind: 'actual',
                    },
                    lifecycle: { lifecycle: 'conditional' },
                  },
                },
              ]
            }
          ]
        },
        {
          id: 'sl-folder-character',
          label: 'character',
          kind: 'folder',
          children: [
            {
              id: 'sl-folder-npc',
              label: 'npc',
              kind: 'folder',
              children: [
                {
                  id: 'sl-archive-keeper',
                  label: '档案管理员',
                  meta: 'character / npc',
                  kind: 'entry',
                  enabled: true,
                  body: '档案管理员总是穿着灰色雨衣，说话谨慎。\n他知道钟楼与地下维护层之间的旧协议，但只有在 {{User}} 表现出足够线索时才会透露。',
                  capabilities: {
                    projection: {
                      entryOrderHint: 20,
                      zoneId: 'setting.stable',
                      order: 'entry: 20',
                      reason: 'Setting layer entry: always active',
                      slotKey: 'setting-layer:city-layers-main@setting.stable',
                      slotOrderHint: 200,
                      sourceKind: 'actual',
                    },
                    lifecycle: { lifecycle: 'always' },
                  },
                },
                {
                  id: 'sl-railway-inspector',
                  label: '环线稽查员',
                  meta: 'character / npc / lower',
                  kind: 'entry',
                  enabled: true,
                  body: '环线稽查员负责检查旧车票。她不相信任何口头解释，只相信印章、编号和轨道摄像记录。',
                  capabilities: {
                    projection: {
                      entryOrderHint: 20,
                      zoneId: 'setting.lower',
                      order: 'entry: 20',
                      reason: 'Setting layer entry: manually pinned by editor',
                      slotKey: 'setting-layer:city-layers-main@setting.lower',
                      slotOrderHint: 300,
                      sourceKind: 'actual',
                    },
                    lifecycle: { lifecycle: 'manual' },
                  },
                },
              ]
            }
          ]
        },
        {
          id: 'sl-folder-lore',
          label: 'lore',
          kind: 'folder',
          children: [
            {
              id: 'sl-folder-keyword-activated',
              label: 'keyword-activated',
              kind: 'folder',
              children: [
                {
                  id: 'sl-clocktower-riot',
                  label: '钟楼骚动',
                  meta: 'lore / keyword-activated',
                  kind: 'entry',
                  enabled: true,
                  body: '三天前，钟楼下发生过短暂骚动。官方称是电力故障，但目击者听见了从地下传来的同步敲击声。',
                  capabilities: {
                    projection: {
                      entryOrderHint: 40,
                      zoneId: 'setting.stable',
                      order: 'entry: 40',
                      reason: 'Setting layer entry: keyword activated [钟楼, 骚动, 敲击声]',
                      slotKey: 'setting-layer:city-layers-main@setting.stable',
                      slotOrderHint: 200,
                      sourceKind: 'actual',
                    },
                    lifecycle: { lifecycle: 'keyword' },
                  },
                },
                {
                  id: 'sl-underground-signal',
                  label: '地下信号',
                  meta: 'lore / keyword-activated',
                  kind: 'entry',
                  enabled: true,
                  body: '地下维护层会周期性发出短促信号。老工程师说，那不是列车调度码，而是某种要求回应的敲门声。',
                  capabilities: {
                    projection: {
                      entryOrderHint: 40,
                      zoneId: 'setting.lower',
                      order: 'entry: 40',
                      reason: 'Setting layer entry: keyword activated [地下, 信号, 维护层]',
                      slotKey: 'setting-layer:city-layers-main@setting.lower',
                      slotOrderHint: 300,
                      sourceKind: 'actual',
                    },
                    lifecycle: { lifecycle: 'keyword' },
                  },
                },
              ]
            }
          ]
        },
        {
          id: 'sl-folder-item',
          label: 'item',
          kind: 'folder',
          children: [
            {
              id: 'sl-brass-ticket',
              label: '黄铜车票',
              meta: 'item / fresh hint',
              kind: 'entry',
              enabled: true,
              body: '一张没有日期的黄铜车票，边缘刻着“第十三站台”。\n它适合作为当前回合尾部的新鲜提示，而不是长期稳定设定。',
              capabilities: {
                projection: {
                  entryOrderHint: 10,
                  zoneId: 'fresh.tail',
                  order: 'entry: 10',
                  reason: 'Setting layer entry: manually activated as a fresh tail hint',
                  slotKey: 'setting-layer:city-layers-main@fresh.tail',
                  slotOrderHint: 700,
                  sourceKind: 'actual',
                },
                lifecycle: { lifecycle: 'manual' },
              },
            }
          ]
        }
      ],
    },
    {
      id: 'virtual-sources',
      label: '运行时虚拟来源',
      meta: 'Virtual Sources (runtime)',
      category: 'runtime',
      kind: 'module',
      body: '这些来源不是用户编辑的实际条目，而是 runtime 在 composition 阶段注入的虚拟来源。\n\n它们可以被 ProjectionOrder 重排，但不能被用户直接编辑内容。',
      configRows: [
        { label: 'Source kind', value: 'virtual' },
        { label: 'Edit', value: 'read-only' },
      ],
      children: [
        {
          id: 'vs-user-macro',
          label: '{{User}} 宏',
          meta: 'virtual / macro',
          kind: 'virtual',
          body: '在 composition 阶段，所有 {{User}} 会被替换为当前 Session 的 userName（来自 Card snapshot）。',
          capabilities: {
            projection: {
              entryOrderHint: 0,
              zoneId: 'runtime.macro',
              order: 'n/a',
              reason: 'Macro expansion runs during composition, not zone projection',
              slotKey: 'runtime.macro',
              slotOrderHint: 0,
              sourceKind: 'virtual',
            },
            lifecycle: { lifecycle: 'always' },
          },
        },
        {
          id: 'vs-narrative-history',
          label: 'Narrative History',
          meta: 'virtual / timeline',
          category: 'history',
          kind: 'virtual',
          body: '当前 Branch 的已接受 NarrativeEntry 序列。runtime 在 composition 阶段将它们按顺序注入 NarrativeContext zone。',
          capabilities: {
            projection: {
              entryOrderHint: 0,
              zoneId: 'chat.history',
              order: 'timeline order',
              reason: 'Accepted narrative entries injected by runtime',
              slotKey: 'narrative-chat:session-main@chat.history',
              slotOrderHint: 500,
              sourceKind: 'virtual',
            },
            lifecycle: { lifecycle: 'always' },
          },
        },
        {
          id: 'vs-current-input',
          label: 'Current User Input',
          meta: 'virtual / input',
          kind: 'virtual',
          body: '当前回合玩家的输入文本。runtime 在 composition 阶段将它追加到 NarrativeContext zone 的末尾。',
          capabilities: {
            projection: {
              entryOrderHint: 999,
              zoneId: 'chat.inside',
              order: 'last',
              reason: 'Current user input appended at composition time',
              slotKey: 'runtime:runtime.current-turn@chat.inside',
              slotOrderHint: 999,
              sourceKind: 'virtual',
            },
            lifecycle: { lifecycle: 'current-turn' },
          },
        },
      ],
    },
    {
      id: 'chat-history-preview',
      label: '聊天历史',
      meta: 'Chat History Preview',
      category: 'history',
      kind: 'module',
      body: '这里展示当前的聊天历史片段，作为 Chathistory preset slot 内部的平铺展示，不能被编辑，只读。',
      configRows: [
        { label: 'Source kind', value: 'virtual' },
        { label: 'Edit', value: 'read-only' },
      ],
      children: [
        {
          id: 'history-turn-1',
          label: 'User',
          meta: 'Turn 1',
          kind: 'entry',
          body: '这个车站为什么已经停运了，广播还在报站？',
        },
        {
          id: 'history-turn-2',
          label: 'Assistant (档案管理员)',
          meta: 'Turn 1',
          kind: 'entry',
          body: '灰雨衣男人抬起伞檐，看向站台尽头：“因为它不是给乘客听的。旧环线停运以后，广播只负责确认还有谁会回应。”',
        },
        {
          id: 'history-turn-3',
          label: 'User',
          meta: 'Turn 2',
          kind: 'entry',
          body: '我走向那扇通往地下维护层的锁门，检查门边有没有编号。',
        },
        {
          id: 'history-turn-4',
          label: 'Assistant (档案管理员)',
          meta: 'Turn 2',
          kind: 'entry',
          body: '锁门旁有一枚磨损严重的黄铜牌，刻着“第十三站台 / 仅限维护协议”。远处的钟楼忽然慢了一拍。',
        },
      ]
    },
    createMockSearchAssetModule(),
] as ContextAssetNode[]

export function createMockSearchAssetModule(count = 800): ContextAssetNode {
  const districts = ['雨线站', '镜市', '钟楼区', '黄铜街', '旧环线', '档案庭', '地下层', '雾港']
  const keywords = ['rainline', 'mirror', 'clocktower', 'brass', 'railway', 'archive', 'signal', 'harbor']
  const folderSize = Math.ceil(count / districts.length)

  return {
    id: '__mock-search-assets',
    label: '搜索压力测试资产',
    meta: `mock / ${count} entries`,
    category: 'logic',
    kind: 'module',
    body: '开发阶段用于验证名称、目录路径和正文搜索的生成式资产。',
    children: districts.map((district, folderIndex) => ({
      id: `__mock-search-folder-${folderIndex + 1}`,
      label: district,
      meta: `mock folder / ${keywords[folderIndex]}`,
      kind: 'folder',
      children: Array.from({ length: folderSize }, (_, entryIndex) => {
        const index = folderIndex * folderSize + entryIndex
        if (index >= count) return []
        const sequence = String(index + 1).padStart(3, '0')
        return [{
          id: `__mock-search-entry-${sequence}`,
          label: `${district}档案 ${sequence}`,
          meta: `mock / ${keywords[folderIndex]} / record`,
          kind: 'entry' as const,
          enabled: index % 9 !== 0,
          body: `第 ${sequence} 号检索样本位于${district}。关键词 ${keywords[folderIndex]}，记录内容包含维护协议、角色关系、地区传闻与地图资源 @assets/mock/${keywords[folderIndex]}-${sequence}.png。`,
        } satisfies ContextAssetNode]
      }).flat(),
    })),
  }
}
