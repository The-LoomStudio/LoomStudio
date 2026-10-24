import type { ObservationRecord, ObservationSource, ObservationStep } from '../widgets/observability-workbench/observation-view.js'

const sources: ObservationSource[] = [
  { id: 'preset', parentId: 'preset-root', orderIndex: 0, activationKind: 'always', nodeKind: 'entry', included: true, title: '叙事约定', path: '诺姆 / 写作预设 / 开场', active: true, reason: '预设原位输出 → system message', original: '你是 {{char}} 的叙事搭档。保持克制，通过动作与对话推进故事。', rendered: '你是 诺姆 的叙事搭档。保持克制，通过动作与对话推进故事。' },
  { id: 'scene', activationKind: 'keyword', nodeKind: 'entry', parentId: 'lore', included: true, targetAnchorIds: ['lore-stable'], injections: [{ id: 'scene-emission', targetAnchorId: 'lore-stable', role: 'system', messageIndex: 1, original: '地点：{{timeline.scene.location}}', rendered: '地点：灰港旧钟楼\n天气：雨\n渡鸦卫队的徽章上有一道缺口。' }], title: '钟楼与渡鸦卫队', path: '灰港世界书 / 地点 / 旧钟楼', active: true, reason: '关键词「钟楼」命中 → @lore.before → localDepth 10', original: '地点：{{timeline.scene.location}}\n天气：{{timeline.scene.weather}}\n渡鸦卫队的徽章上有一道缺口。', rendered: '地点：灰港旧钟楼\n天气：雨\n渡鸦卫队的徽章上有一道缺口。' },
  { id: 'inactive', activationKind: 'manual', nodeKind: 'entry', parentId: 'lore', included: false, targetAnchorIds: ['lore-stable'], title: '战斗伤害规则', path: '灰港世界书 / 规则 / 战斗', active: false, reason: '未激活：本次快照的 scene.combat 为 false', original: '进入战斗后，记录每轮伤势与体力消耗。', rendered: '' },
]
sources.push(
  { id: 'preset-root', title: '写作预设', nodeKind: 'module', orderIndex: 0, path: '写作预设', active: false, included: false, reason: '', original: '', rendered: '' },
  { id: 'lore-stable', parentId: 'preset-root', orderIndex: 1, title: 'Lore Stable', nodeKind: 'virtual', anchorIds: ['lore-stable', '@lore.stable'], path: '写作预设 / Lore Stable', active: false, included: false, reason: '', original: '', rendered: '' },
  { id: 'lore', title: '灰港世界书', nodeKind: 'module', path: '灰港世界书', active: false, included: false, reason: '', original: '', rendered: '' },
)
const messages: ObservationStep['messages'] = [
  { id: 'm1', role: 'system', content: sources[0].rendered, estimatedTokens: 48, sourceId: 'preset' },
  { id: 'm2', role: 'developer', content: sources[1].rendered, estimatedTokens: 62, sourceId: 'scene' },
  { id: 'm3', role: 'user', content: '我握住剑柄，走向钟楼下的那个人。', estimatedTokens: 24 },
]
const first: ObservationStep = {
  id: 'step-1', outputRecorded: true, kind: 'request', initialInput: true, title: '1 · codeact_json', description: '构建基础 Prompt，调用工具读取人物线索。', status: 'completed', duration: '1.42 s', model: '示例模型 · narrative-model', finishReason: 'tool_call',
  messages, sources,
  variables: [
    { name: '{{char}}', path: 'computed.char.name', value: '诺姆', source: '角色 · 诺姆' },
    { name: '{{timeline.scene.location}}', path: 'timeline.scene.location', value: '灰港旧钟楼', source: 'Timeline State · revision 18' },
    { name: '{{timeline.scene.weather}}', path: 'timeline.scene.weather', value: '雨', source: 'Timeline State · revision 18' },
  ],
  tools: [{ id: 'tool-1', name: 'codeact_json', input: { id: 'tool-invocation-example', toolId: 'official/codeact_json', arguments: { code: 'const state = await ctx.readValue("/state/current.yaml");\nprint(state.世界.日期);' } }, result: { status: 'failed', content: [{ type: 'text', text: "codeact.javascript_error: cannot read property '日期' of undefined\n\nRead ranges:\n/state/current.yaml:1–6 / 6 lines" }] }, status: 'failed' }],
  measurement: { estimatedTokens: 334, toolTokens: 200, inputTokens: 358, outputTokens: 42, note: '内容估算不含 Provider 协议封装。数值均为布局样例。' },
}
const second: ObservationStep = {
  ...first, response: { id: 'reply-2', role: 'assistant', content: '雨水沿着钟楼的石阶流下。那个人的目光停在你的剑柄上。' }, id: 'step-2', canCompare: true, initialInput: false, title: '2 · 输出文本', description: '复用基础 Prompt，追加工具往返与仅此步使用的临时上下文。', duration: '2.18 s', finishReason: 'stop', tools: [],
  messages: [...messages,
    { id: 'm4', role: 'assistant', content: 'read_context({ "entryId": "raven-captain" })', estimatedTokens: 28, change: '新增 · 工具调用' },
    { id: 'm5', role: 'tool', content: '已读取人物线索，作为下一步的临时上下文提供。', estimatedTokens: 32, change: '新增 · 工具结果' },
    { id: 'm6', role: 'developer', content: '渡鸦卫队长认识这把佩剑，但尚未认出持剑的人。', estimatedTokens: 38, change: '新增 · 临时上下文' },
  ],
  measurement: { estimatedTokens: 432, toolTokens: 200, inputTokens: 459, outputTokens: 186, note: '沿用构建时变量快照。临时上下文将在这一步请求结束后卸载。' },
}
export const observationFixtures: ObservationRecord[] = [
  { id: 'run-rain', title: '钟楼下的重逢', kind: 'run', status: 'completed', time: '14:32:08', origin: '手动发送 → 主写作 Session', context: '灰港雨夜 / 主分支', steps: [first, second] },
  { id: 'build-preview', title: '写作预设预览', kind: 'build', status: 'completed', time: '14:29:41', origin: '预设编辑器 → 预览', context: '独立构建 · 未调用模型', steps: [{ ...first, id: 'build-1', kind: 'build', title: '01 · Prompt Build', description: '预览所选资源、宏展开与编排结果。', duration: '18 ms', model: undefined, finishReason: undefined, tools: [], measurement: { estimatedTokens: 134, toolTokens: 0, note: '仅预览内容估算，没有 Provider 实报用量。' } }] },
  { id: 'api-summary', title: '记忆摘要请求', kind: 'api', status: 'completed', time: '14:26:02', origin: '扩展 · story-memory → invokeModel', context: '独立 API 调用 · 无 Agent Run', steps: [{ id: 'request-1', title: '01 · 模型请求', description: '扩展直接提交消息。没有 Prompt Builder 构建记录。', duration: '890 ms', status: 'completed', model: '示例模型 · summary-model', finishReason: 'stop', messages: [{ id: 'api-m1', role: 'user', content: '请将本轮故事整理为三条记忆：人物来到钟楼；发现渡鸦徽章；对方认出佩剑。', estimatedTokens: 63 }], sources: [], variables: [], tools: [], measurement: { estimatedTokens: 63, toolTokens: 0, inputTokens: 79, outputTokens: 52, note: '独立调用样例，不归入 Agent Run 的汇总。' } }] },
]
export type ObservationScene = 'normal' | 'empty' | 'many' | 'failed' | 'running'
export function observationScene(scene: ObservationScene): ObservationRecord[] {
  if (scene === 'empty') return []
  if (scene === 'many') return Array.from({ length: 24 }, (_, index) => ({ ...observationFixtures[index % 3], id: `record-${index}`, title: index === 0 ? '灰港雨夜：在漫长的上下文与多轮工具调用之后重新检查这一次叙事输入' : `${observationFixtures[index % 3].title} · ${index + 1}` }))
  if (scene === 'failed' || scene === 'running') return [{ ...observationFixtures[0], status: scene, steps: [first, { ...second, status: scene, duration: scene === 'running' ? '进行中' : '30.00 s', finishReason: undefined, measurement: { estimatedTokens: 432, toolTokens: 200, note: '尚未取得 Provider usage；缺失值不计为零。' }, diagnostic: scene === 'failed' ? 'Provider 请求超时。已记录请求估算，没有收到完整响应。' : undefined }] }, ...observationFixtures.slice(1)]
  return observationFixtures
}
