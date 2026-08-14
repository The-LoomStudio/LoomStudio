export type MockAgentMessage = {
  id: string
  type: 'message'
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

export type MockAgentToolCall = {
  id: string
  type: 'tool-call'
  name: string
  status: 'completed'
  summary: string
  arguments: unknown
  result: string
  createdAt: string
}

export type MockAgentTranscriptItem = MockAgentMessage | MockAgentToolCall

export type MockAgentBranch = {
  id: string
  label: string
  items: MockAgentTranscriptItem[]
}

export const INITIAL_AGENT_BRANCHES: MockAgentBranch[] = [
  {
    id: 'main',
    label: 'Main',
    items: [
      {
        id: 'user-1',
        type: 'message',
        role: 'user',
        content: '检查当前资源中的地点设定，并把需要补充的内容整理出来。',
        createdAt: '2026-08-14T09:31:00.000Z',
      },
      {
        id: 'assistant-1',
        type: 'message',
        role: 'assistant',
        content: [
          '## 初步检查',
          '',
          '我会先读取地点相关资源，再核对其中的 **进入条件**、`visibility` 和可交互对象。',
          '',
          '> Narrative 与 Agent 共用这套 Markdown、高亮和代码块渲染；Agent 另外保留工作流事件。',
        ].join('\n'),
        createdAt: '2026-08-14T09:31:08.000Z',
      },
      {
        id: 'tool-1',
        type: 'tool-call',
        name: 'read_context_assets',
        status: 'completed',
        summary: '读取镜城、钟楼和地下诊所三个地点条目',
        arguments: { paths: ['locations/mirror-city.md', 'locations/bell-tower.yaml', 'locations/clinic.json'] },
        result: '已读取 3 个资源，未修改任何内容。',
        createdAt: '2026-08-14T09:31:10.000Z',
      },
      {
        id: 'assistant-2',
        type: 'message',
        role: 'assistant',
        content: [
          '## 审查结果',
          '',
          '| 条目 | 已有内容 | 建议补充 |',
          '| --- | --- | --- |',
          '| 镜城 | 视觉特征 | 进入条件 |',
          '| 钟楼 | 时间规则 | 与诊所的通路 |',
          '| 地下诊所 | NPC 列表 | 雨天可见度 |',
          '',
          '```yaml',
          'weather:',
          '  rain:',
          '    visibility: low',
          '    movement_cost: 1.25',
          '```',
          '',
          '```json',
          '{',
          '  "entryCondition": "bell_tower_open",',
          '  "interactiveObjects": ["clock", "service_lift"]',
          '}',
          '```',
        ].join('\n'),
        createdAt: '2026-08-14T09:31:18.000Z',
      },
    ],
  },
  {
    id: 'review',
    label: 'Review',
    items: [
      {
        id: 'review-user-1',
        type: 'message',
        role: 'user',
        content: '只保留不会改变既有剧情事实的补充建议。',
        createdAt: '2026-08-14T09:34:00.000Z',
      },
      {
        id: 'review-assistant-1',
        type: 'message',
        role: 'assistant',
        content: '这个分支只讨论约束补全，不改写 Narrative Timeline，也不会改变 Main 分支的 Agent 对话。',
        createdAt: '2026-08-14T09:34:06.000Z',
      },
    ],
  },
]

export function appendMockAgentTurn(
  branches: MockAgentBranch[],
  branchId: string,
  content: string,
  nonce: string,
): MockAgentBranch[] {
  const createdAt = new Date().toISOString()
  return branches.map(branch => branch.id === branchId
    ? {
        ...branch,
        items: [
          ...branch.items,
          { id: `user-${nonce}`, type: 'message', role: 'user', content, createdAt },
          {
            id: `assistant-${nonce}`,
            type: 'message',
            role: 'assistant',
            content: '这是当前 Agent Session 分支中的前端 Mock 回复。正式数据接入后，这里会消费同一套对话 Markdown 渲染。',
            createdAt,
          },
        ],
      }
    : branch)
}

export function forkMockAgentBranch(
  branches: MockAgentBranch[],
  sourceBranchId: string,
  itemId: string,
  branchId: string,
  label: string,
): MockAgentBranch[] {
  const source = branches.find(branch => branch.id === sourceBranchId)
  const itemIndex = source?.items.findIndex(item => item.id === itemId) ?? -1
  if (!source || itemIndex < 0) return branches
  return [...branches, { id: branchId, label, items: source.items.slice(0, itemIndex + 1) }]
}
