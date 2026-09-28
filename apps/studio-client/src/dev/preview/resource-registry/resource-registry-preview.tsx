import { ResourceRegistryWorkbench, type RegistryResourcePreview } from './resource-registry-workbench.js'

const resources: RegistryResourcePreview[] = [
  {
    id: 'narrative-agent', category: 'agents', name: '叙事助手', owner: '工作区自有',
    provenance: '用户创建的 Agent 预设', globalDefault: false, current: true,
    usage: ['当前叙事会话'], body: '推进故事、读取与更新人物状态。',
  },
  {
    id: 'image-agent', category: 'agents', name: '生图 Agent', owner: '扩展 · 生图套件',
    provenance: '生图套件 / Agent 预设', globalDefault: false, current: true,
    usage: ['扩展 · 生图套件'], body: '整理画面描述并调用生成图片工具。',
  },
  {
    id: 'image-guide', category: 'settings', name: '构图与风格手册', owner: '扩展 · 生图套件',
    provenance: '生图套件 / Settings', globalDefault: false, current: true,
    usage: ['Agent 预设 · 生图 Agent'], body: '# 构图约定\n\n先明确主体，再补充场景、光线与镜头。\n\n保持人物外观与当前叙事一致。',
  },
  {
    id: 'image-script', category: 'scripts', name: 'image-tools.js', owner: '扩展 · 生图套件',
    provenance: '生图套件 / 工具执行实现', globalDefault: false, current: true,
    usage: ['扩展 · 生图套件'], body: '提供工具：生成图片、修改图片。\n运行位置：扩展 Server Module。',
  },
  {
    id: 'island-world', category: 'settings', name: '雾岛世界书', owner: '角色 · 雾岛档案',
    provenance: '雾岛档案 / Settings', globalDefault: false, current: false, readOnly: true,
    usage: ['角色 · 雾岛档案'],
    body: '# 雾岛\n\n一座被浓雾包围的离岛，每周只有一班渡轮抵达。\n\n## 场景\n\n- **白塔**：岛上唯一能看见海平线的地方。\n- **渡口**：失去姓名的旅人聚集在这里。\n\n## 叙事约定\n\n线索应从人物的行动中逐渐浮现，不提前揭示谜底。',
    entries: [
      { id: 'island-tower', name: '白塔', body: '# 白塔\n\n每晚十点，守塔人会点亮第七层的灯。岛民从不谈论那一层的房间。' },
      { id: 'island-ferry', name: '渡口', body: '# 渡口\n\n渡轮每周五抵达。钟声响起之前，没有人知道船上会下来谁。' },
    ],
  },
  {
    id: 'island-guide', category: 'settings', name: '游玩教程', owner: '角色 · 雾岛档案',
    provenance: '雾岛档案 / Settings', globalDefault: false, current: false, readOnly: true, autoInject: false,
    usage: ['角色 · 雾岛档案'],
    body: '# 初次抵达雾岛\n\n1. 从渡口进入故事。\n2. 选择一个愿意交谈的旅人。\n3. 在天黑前寻找住处。\n\n> 不需要提前阅读所有线索。',
  },
  {
    id: 'island-regex', category: 'transforms', name: '线索标记', owner: '角色 · 雾岛档案',
    provenance: '雾岛档案 / 正则', globalDefault: false, current: false, readOnly: true,
    usage: ['角色 · 雾岛档案 / Display'], body: '匹配：<clue>(.*?)</clue>\n阶段：Display\n动作：标记线索',
  },
  {
    id: 'island-script', category: 'scripts', name: '线索面板.loom.js', owner: '角色 · 雾岛档案',
    provenance: '雾岛档案 / 脚本', globalDefault: false, current: false, readOnly: true,
    usage: ['角色 · 雾岛档案'], body: '贡献：线索面板 Renderer\n输入：线索提取结果\n运行状态：未加载',
  },
  {
    id: 'island-notes', category: 'attachments', name: '创作手记.md', owner: '角色 · 雾岛档案',
    provenance: '雾岛档案 / 附件', globalDefault: false, current: false, readOnly: true,
    usage: ['角色 · 雾岛档案 / 附件'], body: '# 创作手记\n\n这座岛的灵感来自一段夜间渡轮旅程。\n\n灯塔、海雾与陌生人，是故事的三个起点。',
  },
  {
    id: 'weather-readme', category: 'attachments', name: 'README.md', owner: '扩展 · 天气系统',
    provenance: '扩展包 / README.md', globalDefault: false, current: true, autoInject: false,
    usage: ['扩展 · 天气系统 / 附件'],
    body: `# 天气系统

为场景提供天气信息与环境描述。

## 快速开始

1. 启用天气扩展。
2. 在作品中引用「天气与环境描述」Setting。
3. 选择需要显示天气的消息位置。

## 文本与显示

| 内容 | 用途 |
| --- | --- |
| 天气与环境描述 | 提供叙事参考 |
| 天气状态栏 | 显示当前天气 |

### 宏引用

\`\`\`markdown
当前天气：{{weather}}
\`\`\`

> 避免在每一轮重复完整天气信息。天气应通过人物行动和场景细节自然体现。
`,
  },
  {
    id: 'card-guide', category: 'settings', name: '使用教程', owner: '角色 · 港城来信',
    provenance: '角色 Settings / 使用教程', globalDefault: false, current: true, autoInject: false,
    usage: ['角色 · 港城来信 / Settings'],
    body: `# 欢迎来到港城

从一封没有寄出的信开始你的故事。

## 开始之前

1. 为你的角色取一个名字。
2. 选择一个开场：**旧港来信**或**末班电车**。
3. 按自己的节奏探索，不需要预先读完整本世界书。

## 推荐搭配

| 内容 | 选择 |
| --- | --- |
| Agent 预设 | 叙事助手 |
| 可选扩展 | 天气系统 |

## 游玩约定

- 你决定自己的行动。
- 人物关系随故事逐渐展开。
- 可以随时修改文风与叙事节奏。

> 初次游玩建议从旧港开始，向邮局询问那封没有地址的信。
`,
  },
  { id: 'style', category: 'settings', name: '通用叙事文风', owner: '工作区自有', provenance: '用户创建', globalDefault: true, current: true, usage: ['全局默认'], body: '使用具体的动作与感官细节推进叙事。\n\n保持人物视角的一致性，避免替玩家决定行动。对话应体现人物各自的语气与立场。' },
  { id: 'world', category: 'settings', name: '港城世界书', owner: '角色 · 港城来信', provenance: '随角色包导入', globalDefault: false, current: true, usage: ['角色 · 港城来信'], body: '一座依山临海的城市。旧港、山间住宅与新城区通过有轨电车相连。', entries: [
    { id: 'world-port', name: '旧港', body: '入夜后，灯塔每隔十二秒扫过海面。邮局在最后一班电车离站后关门。' },
    { id: 'world-tram', name: '有轨电车', body: '末班电车在夜里十一点驶离旧港，沿山坡前往住宅区。' },
    { id: 'world-post', name: '邮局与未寄出的信', body: '柜台下存放着一个旧木匣，里面是没有收件地址的信。' },
  ] },
  { id: 'weather', category: 'settings', name: '天气与环境描述', owner: '扩展 · 天气系统', provenance: '天气系统 / 环境文本', globalDefault: true, current: true, usage: ['全局默认', 'Agent 预设 · 叙事助手'], body: '天气变化应影响人物的行动与环境细节。\n\n当前天气：{{weather}}\n避免在每一轮重复完整天气信息。' },
  { id: 'combat', category: 'settings', name: '战斗规则与回合结算的补充说明', owner: '扩展 · 战斗系统', provenance: '战斗系统 / 规则文本', globalDefault: false, current: false, usage: [], body: '每次行动先描述意图，再根据角色状态确定结果。\n\n本条目尚未挂载到当前作品。' },
  { id: 'copy', category: 'settings', name: '我的环境描述', owner: '工作区自有', provenance: '复制自扩展 · 天气系统 / 天气与环境描述', globalDefault: false, current: false, usage: [], body: '优先呈现与当前场景有关的环境变化。\n\n雨天突出声音与能见度，不重复天气概述。' },
  { id: 'regex', category: 'transforms', name: '隐藏内部标记', owner: '角色 · 港城来信', provenance: '随角色包导入', globalDefault: false, current: true, usage: ['角色 · 港城来信 / Display'], body: '匹配：<internal>[\\s\\S]*?</internal>\n替换：空文本\n阶段：Display' },
  { id: 'macro-a', category: 'macros', name: '文风', owner: '工作区自有', provenance: '用户创建', globalDefault: false, current: true, usage: ['Agent 预设 · 叙事助手'], body: '默认值：克制、细腻，以动作表达情绪。\n\n候选：\n  简洁叙述\n  细节描写' },
  { id: 'macro-b', category: 'macros', name: '文风', owner: '角色 · 港城来信', provenance: '角色作者配置', globalDefault: false, current: true, usage: ['角色 · 港城来信'], body: '默认值：潮湿的海风、缓慢的日常与未寄出的信。\n\n此处是角色自身的作者配置。' },
  { id: 'script', category: 'scripts', name: '天气状态栏.loom.js', owner: '角色 · 港城来信', provenance: '随角色包导入', globalDefault: false, current: true, usage: ['角色 · 港城来信'], body: '贡献：天气状态栏 Renderer\n输入：天气提取结果\n挂载：消息下方' },
  { id: 'state', category: 'state', name: '人物基础状态', owner: '角色 · 港城来信', provenance: '角色作者配置', globalDefault: false, current: true, usage: ['角色 · 港城来信 / 新建存档初始化'], body: '体力：100\n心情：平静\n所在位置：旧港\n\n这是初始化定义，不是已有存档的实际值。' },
]

export function ResourceRegistryPreview() {
  return <ResourceRegistryWorkbench
    resources={resources.filter(resource => resource.owner !== '角色 · 雾岛档案')}
    ownerKinds={{
      '角色 · 港城来信': 'package',
      '角色 · 雾岛档案': 'package',
      '扩展 · 天气系统': 'extension',
      '扩展 · 战斗系统': 'extension',
      '扩展 · 生图套件': 'extension',
      '工作区自有': 'workspace',
      '平台内置': 'platform',
    }}
    agentPresets={{
      'narrative-agent': {
        model: '叙事模型',
        prompts: [
          { id: 'narrative-system', name: '叙事约定', kind: 'text', body: '# 叙事约定\n\n以具体动作推进故事，不替玩家决定行动。\n\n文风：{{文风}}' },
          { id: 'narrative-settings', name: '@settings', kind: 'anchor', body: '锚点：Settings\n来源：当前生效的角色与全局 Settings。' },
          { id: 'narrative-tools', name: '@tools', kind: 'anchor', body: '锚点：工具说明\n来源：叙事助手启用的工具。' },
          { id: 'narrative-history', name: '@history', kind: 'anchor', body: '锚点：历史消息\n范围：当前叙事会话。' },
          { id: 'narrative-input', name: '@input', kind: 'anchor', body: '锚点：当前输入\n位置：历史消息之后。' },
        ],
        tools: [
          { id: 'official/read_state', name: '读取状态', owner: '平台内置', description: '读取授权范围内的角色与世界状态。', enabled: true },
          { id: 'official/update_state', name: '更新状态', owner: '平台内置', description: '更新当前世界线中的人物与场景状态。', enabled: true },
        ],
      },
      'image-agent': {
        model: '视觉模型',
        prompts: [
          { id: 'image-system', name: '图像生成约定', kind: 'text', body: '# 图像生成约定\n\n整理主体、场景与镜头，再调用生成图片工具。\n\n保持人物外观与叙事一致。' },
          { id: 'image-settings', name: '@settings', kind: 'anchor', body: '锚点：Settings\n引用：生图套件 / 构图与风格手册。' },
          { id: 'image-tools', name: '@tools', kind: 'anchor', body: '锚点：工具说明\n来源：生图 Agent 启用的工具。' },
          { id: 'image-input', name: '@input', kind: 'anchor', body: '锚点：当前输入\n内容：本次画面描述。' },
        ],
        tools: [
          { id: 'official/read_state', name: '读取状态', owner: '平台内置', description: '读取人物外观、衣着与场景信息。', enabled: true },
          { id: 'image/generate', name: '生成图片', owner: '扩展 · 生图套件', description: '根据画面描述生成新的图片。', enabled: true },
          { id: 'image/edit', name: '修改图片', owner: '扩展 · 生图套件', description: '在已有图片上调整局部内容。', enabled: false },
        ],
      },
    }}
    models={['叙事模型', '视觉模型', '轻量模型']}
    previewPackages={[{
      id: 'island-package',
      fileName: '雾岛档案.loomcard.zip',
      owner: '角色 · 雾岛档案',
      resources: resources.filter(resource => resource.owner === '角色 · 雾岛档案'),
    }]}
    contextLabel="港城来信 / 存档 01 / 叙事助手"
    currentOwner="角色 · 港城来信"
    initialResourceId="image-agent"
  />
}
