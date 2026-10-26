import type { PresetCopyRequest, PresetLibraryOption, PresetLibraryItem, PresetLibraryNode, PresetLibraryResource, PresetLibrarySource } from '../features/prompt-resources/ui/preset-library/preset-library-model.js'
import { selectedPresetLibraryNodes } from '../features/prompt-resources/ui/preset-library/preset-library-model.js'

// Preview-only choices; these IDs do not bind to real providers or execute tools.
export const presetLibraryModels: PresetLibraryOption[] = [
  { id: 'writing', name: '写作模型 · 示例', description: '为创作预设选择的模型连接。这里只演示绑定，不发送请求。' },
  { id: 'fast', name: '轻量模型 · 示例', description: '用于轻量对话预设的另一条样例连接。' },
  { id: 'reasoning', name: '推理模型 · 示例', description: '用于分析与剧情整理预设的样例连接。' },
]
export const presetLibraryTools: PresetLibraryOption[] = [
  { id: 'read-narrative', name: '读取正文', description: '查看已有故事内容。' },
  { id: 'search-material', name: '检索资料', description: '按需要查找设定和参考资料。' },
  { id: 'write-narrative', name: '写入正文', description: '将创作结果写入故事。' },
]

export const presetLibrarySources: PresetLibrarySource[] = [
  { id: 'personal', name: '我的预设', kind: 'personal', description: '自己的调整、组合与长期使用的版本。' },
  { id: 'ink', name: '墨间 · 创作套件', kind: 'package', author: '墨间', version: '2.4.0', description: '从长篇叙事到轻量扮演，共用世界资料、文本规则和辅助能力。每个预设按用途选择采用。' },
  { id: 'lantern', name: '灯下 · 角色工坊', kind: 'package', author: '灯下', version: '1.2.0', description: '围绕人物声音、关系推进和细腻对话设计的一组创作预设。' },
  { id: 'official', name: 'Loom 官方', kind: 'official', version: '1.0.0', description: '通用助手与剧情整理的基础配置。' },
]
export const presetLibraryResources: PresetLibraryResource[] = [
  { id: 'personal-style', sourceId: 'personal', kind: 'Lore', name: '我的写作偏好', description: '跨预设使用的文风与视角要求。', body: '采用第三人称有限视角。让情绪通过行动、停顿和环境细节显现。避免替用户决定行动。' },
  { id: 'ink-world', sourceId: 'ink', kind: 'Lore', name: '世界与叙事约定', description: '设定一致性与角色行为的公共资料。', body: '尊重已发生的事实。人物只能根据自己的经历和当下可见的信息行动；未知的信息应保留为未知。' },
  { id: 'ink-clean', sourceId: 'ink', kind: '正则', name: '正文排版整理', description: '清理多余空行，保留段落呼吸感。', body: '用于正文显示阶段：连续三个及以上换行归并为两个换行。该规则不处理工具参数或工具结果。' },
  { id: 'ink-state', sourceId: 'ink', kind: '脚本', name: '场景状态栏', description: '显示当前地点、时间与出场人物。', body: '读取本轮场景状态，展示地点、时间和人物关系。采用脚本仍需要相应执行权限。' },
  { id: 'ink-memory', sourceId: 'ink', kind: '模块', name: '剧情记忆', description: '为长篇叙事提供总结与召回能力。', body: '根据已采用的剧情范围提供总结。模块可用不代表所有预设都自动启用它。' },
  { id: 'lantern-voice', sourceId: 'lantern', kind: 'Lore', name: '人物声音', description: '区分人物的用词、节奏与表达习惯。', body: '不要让所有人物使用相同的比喻和句式。语气应反映人物的关系、经历和当下意图。' },
]
function skeleton(id: string, tone: string): PresetLibraryNode[] {
  return [
    { id: `${id}-system`, kind: 'message', label: '身份与写作要求', role: 'system', children: [
      { id: `${id}-identity`, kind: 'entry', label: '创作原则', body: '你是协助用户推进故事的写作伙伴。保持人物与设定一致，让故事中的行动产生有意义的后果。' },
      { id: `${id}-preferences`, kind: 'folder', label: '文风与视角', children: [
        { id: `${id}-style`, kind: 'entry', label: '惯用文风', body: tone },
        { id: `${id}-pov`, kind: 'entry', label: '叙事视角', body: '采用第三人称有限视角。让读者通过当前人物的观察理解场景，不直接揭示其他人物未表达的内心。' },
      ] },
      { id: `${id}-lore`, kind: 'anchor', label: '常驻设定 · @lore.stable' },
    ] },
    { id: `${id}-memory`, kind: 'message', label: '剧情记忆', role: 'system', children: [{ id: `${id}-memory-slot`, kind: 'anchor', label: '剧情总结 · @memory.narrative' }] },
    { id: `${id}-history`, kind: 'sequence', label: '会话历史' },
    { id: `${id}-input`, kind: 'message', label: '当前输入', role: 'user', children: [{ id: `${id}-input-slot`, kind: 'anchor', label: '当前输入 · @chat.input' }] },
  ]
}
export function createPresetLibrarySamples(scene: 'normal' | 'empty' | 'many'): PresetLibraryItem[] {
  if (scene === 'empty') return []
  const specs = [
    ['my-writing', 'personal', '日常写作', '从旧预设里留下的习惯，慢慢调整成自己的版本。', '个人调整', ['personal-style', 'ink-clean']],
    ['my-new', 'personal', '新预设 · 调整中', '刚导入的新骨架，准备迁入常用的文风与视角。', '待整理', []],
    ['ink-long', 'ink', '长篇叙事', '关注伏笔、人物弧线与连续情景，适合长期故事。', '长篇', ['ink-world', 'ink-clean', 'ink-memory']],
    ['ink-light', 'ink', '轻量对话', '缩短铺陈，让人物回应更直接，适合快速扮演。', '轻量', ['ink-world', 'ink-clean']],
    ['ink-organize', 'ink', '剧情整理', '从已发生的正文中梳理事实、关系和未解决线索。', '辅助', ['ink-world', 'ink-memory']],
    ['lantern-role', 'lantern', '人物近景', '聚焦人物声音与关系变化，让细节推动对话。', '角色', ['lantern-voice']],
    ['lantern-slow', 'lantern', '慢节奏 · 日常与人物关系的细腻推进', '给沉默和环境留一点空间，适合日常关系叙事。', '日常', ['lantern-voice']],
    ['official-assistant', 'official', '通用助手', '用于讨论、资料处理和辅助创作的基础预设。', '通用', []],
  ] as const
  const result: PresetLibraryItem[] = specs.map(([id, sourceId, name, description, tag, resources]) => ({ id, sourceId, name, description, tag, modelId: id === 'my-new' ? undefined : id === 'ink-light' ? 'fast' : id === 'ink-organize' ? 'reasoning' : 'writing', toolIds: id === 'my-new' ? [] : ['read-narrative', 'search-material'], resourceIds: [...resources], nodes: skeleton(id,
    id === 'my-writing' ? '语言克制而具体。用可观察的动作承载情绪，避免连续抽象比喻。每次推进一个有意义的变化，不急于替场景收尾。' : '保持表达清晰，依据人物和场景调整叙述节奏。避免重复已知信息，让对话与行动自然衔接。') }))
  if (scene === 'many') for (let i = 1; i <= 36; i++) result.push({ ...result[2]!, id: `extra-${i}`, name: `叙事实验 ${String(i).padStart(2, '0')} · ${i % 2 ? '多人物视角与关系推进' : '悬疑与线索铺陈'}`, sourceId: i % 3 ? 'ink' : 'personal', nodes: skeleton(`extra-${i}`, '用具体细节推进场景，保持人物动机一致。') })
  return result
}
export function copyPresetSampleContent(items: PresetLibraryItem[], request: PresetCopyRequest): PresetLibraryItem[] {
  const source = items.find(item => item.id === request.sourceId)!
  const selected = selectedPresetLibraryNodes(source.nodes, request.nodeIds)
  const clone = (node: PresetLibraryNode): PresetLibraryNode => ({ ...node, id: crypto.randomUUID(), children: node.children?.map(clone) })
  const copies = selected.map(clone)
  return items.map(item => {
    if (item.id !== request.targetId) return item
    let nodes: PresetLibraryNode[]
    if (request.messageId) {
      const insert = (node: PresetLibraryNode): PresetLibraryNode => node.id === request.messageId
        ? { ...node, children: [...node.children ?? [], ...copies] }
        : { ...node, children: node.children?.map(insert) }
      nodes = item.nodes.map(insert)
    } else {
      const units = copies.map(node => node.kind === 'message' ? node : ({ id: crypto.randomUUID(), kind: 'message' as const, label: node.label, role: 'system' as const, children: [node] }))
      const history = item.nodes.findIndex(node => node.kind === 'sequence')
      const position = history < 0 ? item.nodes.length : history
      nodes = [...item.nodes.slice(0, position), ...units, ...item.nodes.slice(position)]
    }
    return { ...item, nodes, resourceIds: request.includeResources ? [...new Set([...item.resourceIds, ...source.resourceIds])] : item.resourceIds }
  })
}
