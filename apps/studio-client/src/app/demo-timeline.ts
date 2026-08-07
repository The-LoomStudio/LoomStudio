import type { NarrativeEntry } from '../entities/index.js'

const MOCK_TIMELINE_SIZE = 100
const MOCK_BRANCH_ID = '__mock-branch-main'

export function createMockTimeline(count = MOCK_TIMELINE_SIZE): NarrativeEntry[] {
  const startedAt = Date.parse('2026-08-05T12:00:00.000Z')
  return Array.from({ length: count }, (_, index) => {
    const floor = index + 1
    const role = floor % 2 === 1 ? 'assistant' : 'user'
    return {
      id: `__timeline-mock-${floor}`,
      version: 1,
      role,
      content: role === 'assistant' ? createAssistantMarkdown(floor) : createUserMarkdown(floor),
      createdAt: new Date(startedAt + index * 120_000).toISOString(),
      branchId: MOCK_BRANCH_ID,
      ...(floor > 1 ? { parentEntryId: `__timeline-mock-${floor - 1}` } : {}),
      ...(role === 'assistant' ? { runId: `__timeline-mock-run-${Math.ceil(floor / 2)}` } : {}),
    }
  })
}

function createAssistantMarkdown(floor: number): string {
  return `雨水沿着站台边缘汇成细流，远处的钟楼仍在重复同一个不完整的报时。调查员翻开终端，确认当前区域为 **Loom City / Rainline Station**。

> 档案提示：这里是一段用于验证长会话、Markdown 排版和代码高亮的临时消息。

- 当前地点：\`city.location.rainline-station\`
- 关联人物：{{archive_keeper.name}}
- 地图资源：@assets/maps/rainline-station.png
- 状态：**调查进行中**

\`\`\`yaml
scene:
  floor: ${floor}
  weather: rain
  checkpoint: platform-${String(floor).padStart(3, '0')}
  flags:
    clocktower_visible: true
    maintenance_gate_locked: true
\`\`\`

终端返回：\`signal_strength = ${floor % 7 + 1}\`。继续阅读 [调查记录](https://example.invalid/loom-city) 或检查下一条消息。`
}

function createUserMarkdown(floor: number): string {
  return `我沿着积水中的倒影向前走，记录钟楼闪烁的间隔，并尝试读取 \`@assets/logs/platform-signal.json\`。

\`\`\`json
{
  "action": "inspect",
  "target": "maintenance-gate",
  "floor": ${floor}
}
\`\`\``
}
