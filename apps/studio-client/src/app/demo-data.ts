import { demoContextAssets } from './demo-context-assets.js'
import { createMockTimeline } from './demo-timeline.js'

export const DemoData = {
  cardName: import.meta.env.DEV ? 'Loom City Layers' : '',
  /** RPC 端点 */
  endpoint: '/rpc',

  /** 默认 Custom CSS（空） */
  customCss: '',

  /**
   * ponytail: 仅用于长会话消息容器的开发验收；真实会话加载后由 timeline RPC 覆盖。
   */
  timeline: import.meta.env.DEV ? createMockTimeline() : [],

  /** Gateway 配置表单默认值（对齐 OpenAI Compatible provider） */
  providerAccountDraft: {
    displayName: 'OpenAI Compatible',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
  },

  /**
   * 默认 Card JSON。
   * 结构对齐 Card 类型（docs/08-ApplicationLayer/card-and-opening-v0.md）：
   * - name / userName / description / preset / opening / settingLayer
   */
  cardJson: import.meta.env.DEV ? JSON.stringify({
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
  }, null, 2) : '',

  /**
   * Composition Skeleton 预览用 demo 资产树。
   * 结构对齐 composition-skeleton-v0.md 中的 Zone / ProjectionOrder 概念。
   */
  contextAssets: import.meta.env.DEV ? demoContextAssets : [],
}
