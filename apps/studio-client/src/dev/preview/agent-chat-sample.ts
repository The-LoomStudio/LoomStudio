import type { AgentTranscriptEntry as AgentTranscriptEntryEntity } from '../../entities/index.js'

export const agentChatSample: AgentTranscriptEntryEntity[] = [
  {
    id: 'mock-msg-user-1',
    agentSessionId: 'mock-session',
    sequence: 1,
    createdAt: new Date(Date.now() - 60000).toISOString(),
    entry: {
      kind: 'message',
      role: 'user',
      content: '帮我检查当前夜之城的世界观设定，并将治安官阵营的好感度重置为初始状态。',
    },
  },
  {
    id: 'mock-tool-inv-1',
    agentSessionId: 'mock-session',
    sequence: 2,
    createdAt: new Date(Date.now() - 52000).toISOString(),
    entry: {
      kind: 'tool-invocation',
      invocationId: 'call_read_wb_01',
      toolId: 'read_worldbook_entry',
      exposedName: '读取世界书条目 夜之城世界观条目',
      status: 'completed',
      arguments: {
        entryTitle: '夜之城世界观条目',
        keys: ['夜之城', '治安官', '新都'],
      },
    },
  },
  {
    id: 'mock-tool-res-1',
    agentSessionId: 'mock-session',
    sequence: 3,
    createdAt: new Date(Date.now() - 50000).toISOString(),
    entry: {
      kind: 'tool-result',
      invocationId: 'call_read_wb_01',
      toolId: 'read_worldbook_entry',
      status: 'success',
      content: [
        {
          type: 'text',
          text: '$ 读取世界书条目 夜之城世界观条目 (read_worldbook_entry)\n{\n  "entryTitle": "夜之城世界观条目",\n  "keys": ["夜之城", "治安官", "新都"],\n  "status": "active"\n}\n已命中词条：阵营市政安全防卫部，基准好感度：50。',
        },
      ],
    },
  },
  {
    id: 'mock-tool-inv-2',
    agentSessionId: 'mock-session',
    sequence: 4,
    createdAt: new Date(Date.now() - 48000).toISOString(),
    entry: {
      kind: 'tool-invocation',
      invocationId: 'call_search_char_02',
      toolId: 'search_character_entities',
      exposedName: '在工作区搜索“治安官雷恩”',
      status: 'completed',
      arguments: {
        query: '治安官雷恩',
        scope: 'workspace',
      },
    },
  },
  {
    id: 'mock-tool-res-2',
    agentSessionId: 'mock-session',
    sequence: 5,
    createdAt: new Date(Date.now() - 46000).toISOString(),
    entry: {
      kind: 'tool-result',
      invocationId: 'call_search_char_02',
      toolId: 'search_character_entities',
      status: 'success',
      content: [
        {
          type: 'text',
          text: '$ search_character_entities\n{\n  "character": "char-sheriff-09",\n  "name": "治安官雷恩",\n  "boundVariable": "sheriff_affinity"\n}',
        },
      ],
    },
  },
  {
    id: 'mock-reasoning-1',
    agentSessionId: 'mock-session',
    sequence: 6,
    createdAt: new Date(Date.now() - 40000).toISOString(),
    entry: {
      kind: 'reasoning',
      content: '哥哥，我先检查是不是世界观冲突把治安官好感度拉低了。基准设定应该被尊重，只有明确配置或剧本冲突时才允许动态覆盖。',
    },
  },
  {
    id: 'mock-msg-assistant-interim',
    agentSessionId: 'mock-session',
    sequence: 7,
    createdAt: new Date(Date.now() - 35000).toISOString(),
    entry: {
      kind: 'message',
      role: 'assistant',
      content: '已检索到角色【治安官雷恩】（阵营：市政安全防卫部）。正在核查其在运行时的变量状态...',
    },
  },
  {
    id: 'mock-tool-inv-3',
    agentSessionId: 'mock-session',
    sequence: 8,
    createdAt: new Date(Date.now() - 30000).toISOString(),
    entry: {
      kind: 'tool-invocation',
      invocationId: 'call_run_script_03',
      toolId: 'run_runtime_check',
      exposedName: '运行校验脚本 check_runtime_affinity.js',
      status: 'completed',
      arguments: {
        script: 'check_runtime_affinity.js',
        target: 'sheriff_affinity',
      },
    },
  },
  {
    id: 'mock-tool-res-3',
    agentSessionId: 'mock-session',
    sequence: 9,
    createdAt: new Date(Date.now() - 28000).toISOString(),
    entry: {
      kind: 'tool-result',
      invocationId: 'call_run_script_03',
      toolId: 'run_runtime_check',
      status: 'success',
      content: [
        {
          type: 'text',
          text: '$ node check_affinity.js\n{\n  "pid": 32129,\n  "variable": "sheriff_affinity",\n  "current": 12,\n  "base": 50,\n  "status": "conflict"\n}',
        },
      ],
    },
  },
  {
    id: 'mock-reasoning-2',
    agentSessionId: 'mock-session',
    sequence: 10,
    createdAt: new Date(Date.now() - 20000).toISOString(),
    entry: {
      kind: 'reasoning',
      content: '没有找到要求好感度常驻为 12 的配置，但历史会话中存在冲突覆盖。我会重置为基准值 50，并在更新后同步状态。',
    },
  },
  {
    id: 'mock-tool-inv-4',
    agentSessionId: 'mock-session',
    sequence: 11,
    createdAt: new Date(Date.now() - 15000).toISOString(),
    entry: {
      kind: 'tool-invocation',
      invocationId: 'call_patch_vars_04',
      toolId: 'patch_runtime_variables',
      exposedName: '修改运行时变量 sheriff_affinity 从 12 重置为 50',
      status: 'completed',
      arguments: {
        scope: 'global',
        patches: [
          {
            key: 'sheriff_affinity',
            from: 12,
            to: 50,
            reason: '重置至基准好感度',
          },
        ],
      },
    },
  },
  {
    id: 'mock-tool-res-4',
    agentSessionId: 'mock-session',
    sequence: 12,
    createdAt: new Date(Date.now() - 12000).toISOString(),
    entry: {
      kind: 'tool-result',
      invocationId: 'call_patch_vars_04',
      toolId: 'patch_runtime_variables',
      status: 'success',
      content: [
        {
          type: 'text',
          text: '$ patch_runtime_variables\n{\n  "key": "sheriff_affinity",\n  "old": 12,\n  "new": 50,\n  "status": "applied"\n}',
        },
      ],
    },
  },
  {
    id: 'mock-msg-assistant-1',
    agentSessionId: 'mock-session',
    sequence: 13,
    createdAt: new Date(Date.now() - 10000).toISOString(),
    entry: {
      kind: 'message',
      role: 'assistant',
      content: `已为你检查夜之城世界观并完成变量重置：

### 1. 实体与词条核验
- **世界书词条**：\`夜之城世界观条目\`（已命中关键词：\`夜之城\`、\`治安官\`）
- **目标角色**：**治安官雷恩**（阵营：*市政安全防卫部*）
- **基准设定**：基准好感度常驻设定值为 \`50\`

### 2. 状态修补与同步代码
通过运行时补丁，已纠正历史会话遗留的冲突覆盖：

\`\`\`typescript
// 校验并同步治安官好感度设定
await runtime.patchVariables({
  scope: 'global',
  patches: [{
    key: 'sheriff_affinity',
    from: 12,
    to: 50,
    reason: 'reset_to_worldbook_base',
  }],
})
\`\`\`

> **提示**：全局变量 \`sheriff_affinity\` 现已成功恢复为 \`50\`。你可以在左侧工作台直接查看变动，或者随时告诉我接下来的剧本走向。`,
    },
  },
]
