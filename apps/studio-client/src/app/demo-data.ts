import type { ContextAssetNode } from '../entities/index.js'

/**
 * 开发阶段的 demo 数据集。
 *
 * 数据格式对齐后端 RPC 和文档中的定义：
 * - cardJson 对齐 `application.createCard` RPC 输入格式
 * - gatewayForm 对齐 `application.createProviderAccount` / `createModelProfile` RPC 输入
 * - contextAssets 用于 Composition Skeleton 预览 (对齐 docs/08-ApplicationLayer/composition-skeleton-v0.md)
 */
export const DemoData = {
  /** RPC 端点 */
  endpoint: '/rpc',

  /** 默认 Custom CSS（空） */
  customCss: '',

  /** 测试用 Custom CSS */
  testCustomCss: `:root {
  --loom-bg: #eff2ee;
  --loom-surface: #fafbf8;
  --loom-panel: #fafbf8;
  --loom-panel-muted: #e3e8e2;
  --loom-border: #aeb8aa;
  --loom-text: #1e231d;
  --loom-text-muted: #697168;
  --loom-accent: #486f66;
  --loom-role-user: #eef4f1;
  --loom-role-assistant: #ffffff;
  --loom-chat-width: 780px;
  --loom-radius-message: 0;
}

[data-loom-component="base-chat-canvas"] {
  background:
    linear-gradient(#e5e9e2 1px, transparent 1px),
    #fafbf8;
  background-size: 100% 30px;
}

[data-loom-component="chat-message"] {
  border-color: #aeb8aa;
}

[data-loom-component="chat-message"][data-loom-role="assistant"]
  [data-loom-slot="message-body"] {
  color: #1e231d;
  font-size: 17px;
}

[data-loom-component="input-dashboard"] {
  border-top-color: #aeb8aa;
  background: #fafbf8;
}`,

  /** Gateway 配置表单默认值（对齐 OpenAI Compatible provider） */
  gatewayForm: {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
    temperature: '0.8',
    maxTokens: '1200',
  },

  /**
   * 默认 Card JSON。
   * 结构对齐 Card 类型（docs/08-ApplicationLayer/card-and-opening-v0.md）：
   * - name / userName / description / preset / opening / settingLayer
   */
  cardJson: JSON.stringify({
    name: 'Loom City Layers',
    userName: '调查员',
    description: '一张用于测试 Prompt Builder 的 AIRP 假卡。玩家进入雨夜中的 Loom City，Setting Layer 会按地点、角色、事件和物件分层注入。',
    preset: {
      system: '你是一个沉浸式 AIRP 剧情 Agent。玩家名是 {{User}}。延续已接受的剧情正文，避免替玩家决定内心。优先使用当前激活的 City Layers 信息。',
    },
    opening: {
      entries: [
        {
          role: 'assistant',
          content: '雨夜，{{User}}走出环线车站，远处钟楼的灯光在积水里断断续续地闪烁。',
        },
      ],
    },
    settingLayer: {
      entries: [
        {
          path: 'city.location.rainline-station',
          title: '雨线车站',
          content: '雨线车站是 Loom City 的旧环线入口。夜间广播经常延迟，站台尽头有通往地下维护层的锁门。',
          enabled: true,
          activation: { kind: 'always' },
          tags: ['city', 'location'],
        },
        {
          path: 'city.location.mirror-market',
          title: '镜市',
          content: '镜市位于高架桥下，摊位用破碎镜片反射招牌灯。传闻有人在这里买卖被删除的身份记录。',
          enabled: true,
          activation: { kind: 'keyword', keywords: ['镜市', '市场', '身份记录'] },
          tags: ['city', 'location'],
        },
        {
          path: 'city.character.archive-keeper',
          title: '档案管理员',
          content: '档案管理员总是穿着灰色雨衣，说话谨慎，知道钟楼与地下维护层之间的旧协议。',
          enabled: true,
          activation: { kind: 'always' },
          tags: ['city', 'npc'],
        },
        {
          path: 'city.event.clocktower-riot',
          title: '钟楼骚动',
          content: '三天前，钟楼下发生过短暂骚动。官方称是电力故障，但目击者听见了从地下传来的同步敲击声。',
          enabled: true,
          activation: { kind: 'keyword', keywords: ['钟楼', '骚动', '敲击声'] },
          tags: ['city', 'event'],
        },
        {
          path: 'city.item.brass-ticket',
          title: '黄铜车票',
          content: '一张没有日期的黄铜车票，边缘刻着“第十三站台”。它适合作为当前回合尾部的新鲜提示。',
          enabled: true,
          activation: { kind: 'manual' },
          tags: ['city', 'item'],
        },
      ],
    },
  }, null, 2),

  /**
   * Composition Skeleton 预览用 demo 资产树。
   * 结构对齐 composition-skeleton-v0.md 中的 Zone / InjectionGroup / ProjectionOrder 概念。
   */
  contextAssets: [
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
                accepts: ['preset', 'runtime'],
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
            { injectionGroupKey: 'preset.system', anchor: 'inside', slotKey: 'preset:default-airp-preset@preset.system', rankKey: '0000' },
            { injectionGroupKey: 'preset.memory-echo', anchor: 'inside', slotKey: 'preset:default-airp-preset@preset.memory-echo', rankKey: '0001' },
            { injectionGroupKey: 'setting.stable', anchor: 'inside', slotKey: 'setting-layer:city-layers-main@setting.stable', rankKey: '0002' },
            { injectionGroupKey: 'chat.history', anchor: 'inside', slotKey: 'narrative-chat:session-main@chat.history', rankKey: '0003' },
            { injectionGroupKey: 'setting.lower', anchor: 'inside', slotKey: 'setting-layer:city-layers-main@setting.lower', rankKey: '0004' },
            { injectionGroupKey: 'chat.after', anchor: 'after', slotKey: 'preset:default-airp-preset@chat.after', rankKey: '0005' },
            { injectionGroupKey: 'chat.inside', anchor: 'inside', slotKey: 'runtime:runtime.current-turn@chat.inside', rankKey: '0006' },
            { injectionGroupKey: 'fresh.tail', anchor: 'inside', slotKey: 'setting-layer:city-layers-main@fresh.tail', rankKey: '0007' },
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
                  anchor: 'inside',
                  entryOrderHint: 10,
                  zone: 'StablePrefix',
                  injectionGroupKey: 'preset.system',
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
                  anchor: 'inside',
                  entryOrderHint: 20,
                  zone: 'StablePrefix',
                  injectionGroupKey: 'preset.system',
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
                  anchor: 'inside',
                  entryOrderHint: 30,
                  zone: 'StablePrefix',
                  injectionGroupKey: 'preset.system',
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
                  anchor: 'inside',
                  entryOrderHint: 40,
                  zone: 'StablePrefix',
                  injectionGroupKey: 'preset.system',
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
                  anchor: 'after',
                  entryOrderHint: 10,
                  zone: 'CurrentTurn',
                  injectionGroupKey: 'chat.after',
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
                  anchor: 'after',
                  entryOrderHint: 20,
                  zone: 'CurrentTurn',
                  injectionGroupKey: 'chat.after',
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
          meta: 'zone / NarrativeContext',
          kind: 'entry',
          body: '这是聊天记录占位符。Runtime 会将这里的文本替换为上下文。',
          capabilities: {
            projection: {
              anchor: 'inside',
              entryOrderHint: 10,
              zone: 'NarrativeContext',
              injectionGroupKey: 'chat.history',
              order: 'fixed: 500',
              slotKey: 'narrative-chat:session-main@chat.history',
              slotOrderHint: 500,
              sourceKind: 'actual',
            },
            lifecycle: { lifecycle: 'always' },
          },
        },
        {
          id: 'preset-memory-echo',
          label: '记忆回声',
          meta: 'zone / MemoryEcho',
          kind: 'entry',
          body: '如果当前剧情提到曾经出现过的城市传闻，将其压缩成一段“记忆回声”，提醒 Agent 不要把旧线索当成新发现。',
          capabilities: {
            projection: {
              anchor: 'inside',
              entryOrderHint: 10,
              zone: 'MemoryEcho',
              injectionGroupKey: 'preset.memory-echo',
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
                      anchor: 'inside',
                      entryOrderHint: 10,
                      zone: 'StablePrefix',
                      injectionGroupKey: 'setting.stable',
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
                      anchor: 'inside',
                      entryOrderHint: 30,
                      zone: 'StablePrefix',
                      injectionGroupKey: 'setting.stable',
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
                      anchor: 'inside',
                      entryOrderHint: 50,
                      zone: 'StablePrefix',
                      injectionGroupKey: 'setting.stable',
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
                      anchor: 'inside',
                      entryOrderHint: 20,
                      zone: 'StablePrefix',
                      injectionGroupKey: 'setting.stable',
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
                      anchor: 'inside',
                      entryOrderHint: 20,
                      zone: 'LowerContext',
                      injectionGroupKey: 'setting.lower',
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
                      anchor: 'inside',
                      entryOrderHint: 40,
                      zone: 'StablePrefix',
                      injectionGroupKey: 'setting.stable',
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
                      anchor: 'inside',
                      entryOrderHint: 40,
                      zone: 'LowerContext',
                      injectionGroupKey: 'setting.lower',
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
                  anchor: 'inside',
                  entryOrderHint: 10,
                  zone: 'FreshTail',
                  injectionGroupKey: 'fresh.tail',
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
          kind: 'entry',
          body: '在 composition 阶段，所有 {{User}} 会被替换为当前 Session 的 userName（来自 Card snapshot）。',
          capabilities: {
            projection: {
              anchor: 'meta',
              entryOrderHint: 0,
              zone: 'n/a',
              injectionGroupKey: 'runtime.macro',
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
          kind: 'entry',
          body: '当前 Branch 的已接受 NarrativeEntry 序列。runtime 在 composition 阶段将它们按顺序注入 NarrativeContext zone。',
          capabilities: {
            projection: {
              anchor: 'inside',
              entryOrderHint: 0,
              zone: 'NarrativeContext',
              injectionGroupKey: 'chat.history',
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
          kind: 'entry',
          body: '当前回合玩家的输入文本。runtime 在 composition 阶段将它追加到 NarrativeContext zone 的末尾。',
          capabilities: {
            projection: {
              anchor: 'inside',
              entryOrderHint: 999,
              zone: 'CurrentTurn',
              injectionGroupKey: 'chat.inside',
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
  ] as ContextAssetNode[],
}
