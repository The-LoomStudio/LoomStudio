import { defaultCompositionSkeleton } from './prompt-builder.js'
import type { PromptResourceContent, PromptResourceNode } from './workspace.js'

export const officialPromptResourceIds = {
  assistantPreset: 'prompt-resource.official.loom-assistant',
  knowledgeSetting: 'prompt-resource.official.loom-knowledge',
} as const

const assistantPresetRootId = 'official.loom-assistant.preset'
const knowledgeSettingRootId = 'official.loom-knowledge.setting'

export function createOfficialPromptResourceContents(timestamp: string): PromptResourceContent[] {
  return [
    {
      resourceKind: 'preset',
      rootNode: createAssistantPresetRoot(),
      linkedSettingIds: [officialPromptResourceIds.knowledgeSetting],
      historyPolicy: 'persistent',
      origin: { kind: 'builtin', key: 'loom-assistant-preset' },
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      resourceKind: 'setting',
      rootNode: createKnowledgeSettingRoot(),
      origin: { kind: 'builtin', key: 'loom-knowledge-setting' },
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ]
}

function createAssistantPresetRoot(): PromptResourceNode {
  return {
    id: assistantPresetRootId,
    label: 'Loom Studio 问答助手',
    meta: 'Official Composition Preset',
    category: 'preset',
    kind: 'module',
    body: 'Loom Studio 官方问答助手的 Prompt 结构、标准 Zone 与默认排序。',
    children: [
      {
        id: 'official.loom-assistant.order',
        label: '主排序',
        meta: 'Projection Order Profile',
        category: 'preset',
        kind: 'order',
        body: '定义问答助手 Preset 与 Loom Studio 知识 Setting 的默认相对位置。',
        skeletonPatch: {
          zones: defaultCompositionSkeleton.zones.map(zone => ({ ...zone })),
          fallbackZoneId: defaultCompositionSkeleton.fallbackZoneId,
        },
        orderList: [
          'official.loom-assistant.instructions',
          'official.loom-knowledge.product',
          'official.loom-knowledge.resources',
          'official.loom-knowledge.workflow',
        ],
        slotRanks: [
          {
            zoneId: 'preset.system',
            slotKey: `preset:${assistantPresetRootId}@preset.system`,
            rankKey: '0000',
          },
          {
            zoneId: 'setting.stable',
            slotKey: `setting-layer:${knowledgeSettingRootId}@setting.stable`,
            rankKey: '0001',
          },
        ],
      },
      {
        id: 'official.loom-assistant.instructions',
        label: '助手行为',
        meta: 'preset.system',
        category: 'preset',
        kind: 'entry',
        enabled: true,
        body: '你是 Loom Studio 内置问答助手。优先依据已加载的 Loom Studio 知识回答问题；表达清晰、简洁，并在知识不足时明确说明不确定之处。使用与用户相同的语言回答。',
        capabilities: {
          lifecycle: { lifecycle: 'always' },
          projection: {
            zoneId: 'preset.system',
            slotKey: `preset:${assistantPresetRootId}@preset.system`,
            entryOrderHint: 10,
            slotOrderHint: 100,
          },
        },
      },
    ],
  }
}

function createKnowledgeSettingRoot(): PromptResourceNode {
  return {
    id: knowledgeSettingRootId,
    label: 'Loom Studio 基础知识',
    meta: 'Official Setting Layer',
    category: 'setting',
    kind: 'module',
    body: '供官方问答助手使用的 Loom Studio 稳定基础知识。',
    children: [
      settingEntry(
        'official.loom-knowledge.product',
        '产品定位',
        'Loom Studio 是面向 AI 角色扮演与交互叙事创作的平台。它把提示词资源、叙事时间线和 Agent 工作会话分开管理，再由 PromptBuild 在运行时组合为模型输入。',
        10,
      ),
      settingEntry(
        'official.loom-knowledge.resources',
        '核心资源',
        'Card 是可分享的启动包和资源清单；Preset 定义 Prompt 的 Zone、结构与排序；Setting Layer 保存世界设定和知识条目；Narrative Timeline 保存玩家看到的叙事正文；Agent Session 保存 Agent 自己的对话与工作历史。',
        20,
      ),
      settingEntry(
        'official.loom-knowledge.workflow',
        '基础工作流',
        '常见流程是创建或导入 Card，链接所需的 Preset 与 Setting Layer，从 Card 创建 Narrative Timeline，再选择 Agent 配置和模型开始对话。资源编辑与叙事游玩共享同一套后端数据能力。',
        30,
      ),
    ],
  }
}

function settingEntry(id: string, label: string, body: string, entryOrderHint: number): PromptResourceNode {
  return {
    id,
    label,
    meta: 'setting.stable',
    category: 'setting',
    kind: 'entry',
    enabled: true,
    body,
    capabilities: {
      activation: { kind: 'always' },
      lifecycle: { lifecycle: 'always' },
      projection: {
        zoneId: 'setting.stable',
        slotKey: `setting-layer:${knowledgeSettingRootId}@setting.stable`,
        entryOrderHint,
        slotOrderHint: 200,
      },
    },
  }
}
