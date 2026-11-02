import { stringify } from 'yaml'

export type RegexLabSample = { id: string; name: string; description: string; input: string; sources: string[]; limitation?: string; expected?: string }
function rule(id: string, name: string, regex: string, body: string, options: Record<string, unknown> = {}) {
  return `---\n${stringify({ id: `lab.${id}`, name, regex, regex_flags: 'g', phases: ['display'], streaming: false, ...options }, { lineWidth: 0 })}---\n${body}`
}
const phone = '```html\n<!doctype html><html><head><style>body{margin:0;padding:16px;background:#f3eee3;color:#343132;font:15px system-ui}.phone{max-width:360px;margin:auto;border-radius:24px;padding:18px;background:#fff;border:1px solid #b8b2a4}header{display:flex;justify-content:space-between;color:#68616f}p{background:#e6dbff;border-radius:16px 16px 16px 2px;padding:14px;min-height:24px;white-space:pre-wrap}small{color:#8d8794;font-size:10px}</style></head><body><div class="phone"><header><b>$1</b><span>$2</span></header><p>$3</p><small id="instance"></small></div><script>document.getElementById("instance").textContent="iframe 实例: "+crypto.randomUUID().slice(0,8)</script></body></html>\n```'
const phoneInput = '街角的手机响了。\n\n<Message|Alice|20:39>在吗？我刚到楼下。\n今晚要一起散步吗？</Message>\n\n<Message|Bob|20:40>在的。稍等，我拿上外套就下来。</Message>'
const complete = '<Message\\|([^|>]+)\\|([^>]+)>([\\s\\S]*?)</Message>'
const partial = '<Message\\|([^|>]+)\\|([^>]+)>([\\s\\S]*?)(?:</Message>|$)'
const image = rule('image', 'Image → HTML 文档', '<Image>([\\s\\S]*?)</Image>', '```html\n<!doctype html><html><body style="background:#c8e7d2;padding:18px">图片卡：$1</body></html>\n```', { streaming: true })
const closeup = (clean: boolean) => rule('closeup', 'Closeup → HTML 文档', '<Closeup>([\\s\\S]*?)</Closeup>', '```html\n<!doctype html><html><body style="background:#eadcc7;padding:24px"><h3>特写</h3><div>$1</div></body></html>\n```', { streaming: true, ...(clean ? { capture_remove: ['<Image>', '</Image>'] } : {}) })
export const regexLabSamples: RegexLabSample[] = [
  { id: 'captures', name: '修剪 · 捕获与模板边界', description: '同一次替换引用整段、编号、命名、缺失捕获和美元转义。只修剪 Closeup 捕获中的 Image 标签；模板与未匹配前后文必须保持原样。切到文本结果核对。', input: '外部<Image>不动</Image>\n<Closeup><Image>A</Image> + <Image>B</Image></Closeup>', sources: [rule('capture-boundary', '捕获清理边界', '<Closeup>(?<body>[\\s\\S]*?)</Closeup>', '模板：<Image>模板</Image>\n整段：$&\n命名：$<body>\n编号：$1\n美元：$$\n缺失：$9', { streaming: true, capture_remove: ['<Image>', '</Image>'] })], expected: '外部<Image>不动</Image>\n模板：<Image>模板</Image>\n整段：<Closeup>A + B</Closeup>\n命名：A + B\n编号：A + B\n美元：$\n缺失：$9' },
  { id: 'order', name: '顺序 · 级联与重叠', description: '第一条非重叠匹配 aa→b，第二条 b→[完成]。把第二条上移并保存，结果会改变；每个流式快照都从原文重算。', input: 'aaaa\nb\na', sources: [rule('order-a', 'aa → b', 'aa', 'b', { streaming: true }), rule('order-b', 'b → 完成', 'b', '[完成]', { streaming: true })], expected: '[完成][完成]\n[完成]\na' },
  { id: 'unicode', name: '零宽 · Unicode 全局', description: '零宽匹配遍历 emoji 和增补平面汉字，不能拆坏代理对，也不能死循环。与仅首匹配用例对照。', input: '😀A𠮷', sources: [rule('unicode', 'Unicode 零宽', '(?=.)', '|', { regex_flags: 'gu', streaming: true })], expected: '|😀|A|𠮷' },
  { id: 'first', name: '零宽 · 仅首匹配', description: '相同表达式去掉 g 后，只在最前面插入一次；u 仍保留 Unicode 语义。', input: '😀A𠮷', sources: [rule('unicode', 'Unicode 首匹配', '(?=.)', '|', { regex_flags: 'u', streaming: true })], expected: '|😀A𠮷' },
  { id: 'update', name: '流式 · 临时结尾与收口', description: '使用讨论中的负向前瞻表达式。起始标签未结束不触发，未闭合期间显示更新中，结束标签完整后更新中规则退出，完成规则接手。可逐字符观察半截结束标签。', input: '<UpdateVariable>好感度: +3\n地点: 夜晚的车站</UpdateVariable>', sources: [
    rule('updating', '变量更新中', '<UpdateVariable(?:variable)?>(?!.*<\\/UpdateVariable(?:variable)?>)\\s*(.*)\\s*$', '更新中：$1', { regex_flags: 'gsi', streaming: true }),
    rule('updated', '变量更新完成', '<UpdateVariable(?:variable)?>([\\s\\S]*?)</UpdateVariable(?:variable)?>', '更新完成：$1', { streaming: true }),
  ], expected: '更新完成：好感度: +3\n地点: 夜晚的车站' },
  { id: 'finish', name: '第一档 · 全文结束', description: '规则关闭 streaming。输出未结束时原文保留，结束后整条消息一次替换；手机气泡不提前出现。', input: phoneInput, sources: [rule('phone', '手机聊天', complete, phone)] },
  { id: 'records', name: '第二档 · 完整记录', description: '开启 streaming；每一个 Message 闭合后立即生成一个手机气泡，后续消息继续输入。', input: phoneInput, sources: [rule('phone', '手机聊天', complete, phone, { streaming: true })] },
  { id: 'partial', name: '第三档 · 未闭合捕获', description: '起始标签完成后允许捕获到临时末尾，气泡随快照增长。没有额外打字机：内容来自原生正则替换。', input: phoneInput, sources: [rule('phone', '手机聊天', partial, phone, { streaming: true })], limitation: '观察气泡底部的 iframe 实例编号：现有 HTML 渲染器会随正文更新重建实例。连续 UI/JS 状态的第三档仍需要渲染器 CTX 更新桥，不能把文本实时更新等同于实例连续。' },
  { id: 'persist', name: '持久化 · 推理与正文', description: '点击“完成并持久化”通过真实 invokeAgentTurn 提交本地 Provider 样例。classify 提升推理并移除 SECRET；显示和提示词投影各自独立。刷新页面后重新读取 SQLite 核对。', input: '<think>我先检查格式，正文会出现 <Status> 标签。</think>\n公开正文。SECRET:demo-token\n这段正文应当被保存。', sources: [
    rule('reasoning', '提取正文中的推理', '<think>([\\s\\S]*?)</think>', '', { phases: ['classify'], action: 'promote-reasoning', content_group: 1 }),
    rule('persist', '保存时移除 SECRET', 'SECRET:[^\\s]+', '[已移除]', { phases: ['classify'] }),
    rule('display', '仅显示替换', '公开正文', '【显示投影】公开正文'),
    rule('prompt', '仅提示词替换', '公开正文', '【提示词投影】公开正文', { phases: ['prompt'] }),
  ] },
  { id: 'nested', name: '嵌套 · 冲突复现', description: '先转换 Image，再将结果放入 Closeup。两条真实规则生成嵌套 Markdown/HTML，观察最终字符串和原生渲染结果。', input: '<Closeup>她抬起头。<Image>窗外的月亮</Image>房间安静下来。</Closeup>', sources: [image, closeup(false)], limitation: 'Markdown 围栏进入 iframe 后不会自动递归运行消息渲染器。此例用于复现边界，不宣称平台已经支持递归嵌套。' },
  { id: 'trim', name: '嵌套 · 捕获修剪', description: '先执行 Closeup，capture_remove 只移除其捕获中的 Image 标签；随后 Image 规则没有可匹配的标签。外部 Image 仍独立渲染。', input: '<Closeup>她抬起头。<Image>窗外的月亮</Image>房间安静下来。</Closeup>\n<Image>另一个独立图片卡</Image>', sources: [closeup(true), image] },
  { id: 'iframe', name: '嵌套 · 作者显式 iframe', description: '作者在完整 HTML 中显式写入 iframe srcdoc，交给浏览器原生嵌套。与消息渲染器递归发现 Markdown 是两种不同能力。', input: '<Panel>这是外层面板的文字。</Panel>', sources: [rule('nested-frame', '显式嵌套 iframe', '<Panel>([\\s\\S]*?)</Panel>', '```html\n<!doctype html><html><body style="background:#eadcc7;padding:20px"><h3>外层 HTML</h3><p>$1</p><iframe title="作者内部 frame" srcdoc="<!doctype html><html><body style=\'background:#d6e5fb;padding:12px\'>内层 iframe：浏览器原生显示</body></html>"></iframe></body></html>\n```', { streaming: true })] },
]
