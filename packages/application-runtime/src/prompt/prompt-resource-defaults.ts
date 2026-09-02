import type { PromptResourceContent, PromptResourceNode } from '../cards/workspace.js'

export const officialPromptResourceIds = {
  assistantPreset: 'prompt-resource.official.loom-assistant',
  knowledgeSetting: 'prompt-resource.official.loom-knowledge',
} as const

export const obsoleteBuiltinAgentToolIds = new Set([
  'official/test_structured',
  'official/test_content',
])

export const obsoleteBuiltinAgentToolDescriptions = new Map([
  [
    'official/search_context',
    'Search active context items already authorized for the current Agent turn. Returns item IDs and short snippets for read_context.',
  ],
  [
    'official/read_context',
    'Read one or more full context items already authorized for the current Agent turn.',
  ],
])

const assistantPresetRootId = 'official.loom-assistant.preset'
const knowledgeSettingRootId = 'official.loom-knowledge.setting'

export function createOfficialPromptResourceContents(timestamp: string): PromptResourceContent[] {
  return [
    {
      resourceKind: 'preset',
      rootNode: createAssistantPresetRoot(),
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
        id: 'official.loom-assistant.instructions',
        label: '助手行为',
        meta: 'preset.system',
        category: 'preset',
        kind: 'entry',
        enabled: true,
        body: '你是 Loom Studio 内置问答助手。优先依据已加载的 Loom Studio 知识回答问题；表达清晰、简洁，并在知识不足时明确说明不确定之处。使用与用户相同的语言回答。',
        capabilities: {
          targetAnchorId: '@preset.system',
          localDepth: 10,
          roleHint: 'system',
        },
      },
      {
        id: 'official.loom-assistant.virtual-preset-system',
        label: '@preset.system',
        meta: 'preset.virtual',
        category: 'preset',
        kind: 'virtual',
        capabilities: { targetAnchorId: '@preset.system' },
      },
      {
        id: 'official.loom-assistant.virtual-setting-stable',
        label: '@setting.stable',
        meta: 'preset.virtual',
        category: 'preset',
        kind: 'virtual',
        capabilities: { targetAnchorId: '@setting.stable' },
      },
      {
        id: 'official.loom-assistant.virtual-tools',
        label: '@chat.tools',
        meta: 'preset.virtual',
        category: 'preset',
        kind: 'virtual',
        capabilities: { targetAnchorId: '@chat.tools' },
      },
      {
        id: 'official.loom-assistant.virtual-narrative',
        label: '@chat.narrative',
        meta: 'preset.virtual',
        category: 'preset',
        kind: 'virtual',
        capabilities: { targetAnchorId: '@chat.narrative' },
      },
      {
        id: 'official.loom-assistant.virtual-session',
        label: '@chat.session',
        meta: 'preset.virtual',
        category: 'preset',
        kind: 'virtual',
        capabilities: { targetAnchorId: '@chat.session' },
      },
      {
        id: 'official.loom-assistant.virtual-input',
        label: '@chat.input',
        meta: 'preset.virtual',
        category: 'preset',
        kind: 'virtual',
        capabilities: { targetAnchorId: '@chat.input' },
      },
      {
        id: 'official.loom-assistant.virtual-fresh-tail',
        label: '@fresh.tail',
        meta: 'preset.virtual',
        category: 'preset',
        kind: 'virtual',
        capabilities: { targetAnchorId: '@fresh.tail' },
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
      targetAnchorId: '@setting.stable',
      localDepth: entryOrderHint,
      roleHint: 'system',
    },
  }
}
