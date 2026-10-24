import { codeActMethodNames } from './context.js'

export const codeActToolIds = new Set(['official/codeact', 'official/codeact_json'])

const metadata = `### Prompt Resource Metadata
节点的元数据以同目录的 \`@meta.yaml\` 或文件旁的 \`.meta.yaml\` 表示。
先读取元数据文件，再使用 \`ctx.write(path, yamlText)\` 替换。允许字段：label、category、meta、enabled、capabilities、extra。
parentId、orderIndex 和内部 ID 不属于这个文件；Metadata 修改、移动、创建、删除和复制都必须使用各自的方法。元数据修改同样会进行版本检查和变更审批。`

const methods: Record<typeof codeActMethodNames[number], string> = {
  setAuthorMode: `### ctx.setAuthorMode
调用：await ctx.setAuthorMode(true) 申请作者视图；false 返回游玩视图。
默认游玩视图只提供可读取的设定正文，不列出或读取 disabled 条目、停用子树与 Metadata，也不允许修改设定资源。
true 必须经宿主用户审批；没有审批处理器则拒绝。授权仅限当前 Run 的已挂载资源，访问锁和隐藏权限仍生效，写入仍须单独审批。不用于普通续写剧情。
关闭模式会清除读取基线，但不能抹去模型已经看过的内容。`,
  ls: `### ctx.ls
用途：发现当前允许视图内的一层目录；目录名称以 / 结尾，不是递归树。
调用：await ctx.ls(path = "/", { offset = 0, limit = 50, format = "text" } = {})
参数：path 为虚拟目录；limit 为 1-100；offset 用于继续列表。
返回：默认是文本列表；format: "json" 返回 { path, entries: [{ path, kind, state? }], total, offset, hasMore, nextOffset? } 对象。直接使用 entries[].path，不手工拼路径；offset 越过末尾返回空 entries 和 hasMore=false。
示例：const listing = await ctx.ls("/resources", { format: "json" }); print(listing.entries);
限制：这里不是宿主磁盘；先列目录再读，不猜测内部 ID。`,
  search: `### ctx.search
用途：在允许视图内用字面关键词定位内容。
调用：await ctx.search({ path = "/", terms, match = "all", limit = 5 })
参数：terms 为 1-8 个关键词；match 为 all 或 any，all 在同一文件内匹配；limit 为 1-20。
返回：实际命中的关键词、路径、行范围和有限原文片段；可展示多个关键词的位置，不连续片段以 ... 分隔。截断或还有结果会明确提示；按目录遍历顺序返回，不做语义或相关性排序。
示例：print(await ctx.search({ path: "/resources", terms: ["钥匙", "C"] }));
限制：不理解“首次”等语义，不扩大到历史或其他 Session；命中片段不能代替完整条件。`,
  read: `### ctx.read
用途：读取允许视图中的资源正文。
调用：await ctx.read(path, { startLine, endLine } = {})
参数：path 来自 ls/search；可选行号从 1 开始，包含结束行。
返回：纯正文字符串；结果另列读取路径、实际行范围和总行数，不污染正文值。
示例：const text = await ctx.read("/state/current.yaml"); print(text);
限制：普通设定优先完整读取。每次最多返回 16384 字符；查看实际范围后继续读取。
/workspace 是当前 Timeline 的共同工作区，默认有 MEMORY.md；与剧情和 State 一起恢复。可存 Markdown、JS 等文本，保存 JS 不会执行它；二进制文件可列出，由宿主文件接口读写。
/resources 是已挂载设定/预设的实时原始正文，保留宏源码；宿主记录资源、节点和读取版本，模型不必提供内部 ID。
/context 是本次提示词准备时的投影视图，不是作者源文件，不可据此写回。
/state/current.yaml 是当前授权 State 的完整快照；/state/data 下逐层列属性，目录内的 @value.yaml 是该属性的 YAML，数组作为整体读取。属性目录不能直接写入；修改优先用 ctx.readValue 读取最小目标的 @value.yaml，直接修改 JSON 值，避免手工重建父对象。
/attachments 是当前预设拥有并挂载的脚本附件，读取不会执行脚本。
只有获批的作者视图才显示 disabled 和 Metadata；locked 可发现但不可读取。路径从列表原样复用：空格、中文和方括号是合法字符，不额外转义；不要自行 URL 编码或解码。
/narrative/<floor>.md 是当前绑定分支的固定楼层地址，例如 /narrative/32.md；可通过列表、采样 nodes[].path 或追加回执发现。修改后楼层路径保持不变，缺号不会重排；读取后目标改变时必须重新读取，不能沿用旧写入基线。
不能读取宿主文件、未挂载资源、历史 Narrative 或 Session；观察到的旧路径被另一对象占用时会报错，不自动改绑。`,
  readValue: `### ctx.readValue
用途：直接读取 State 的 JavaScript/JSON 值，不解析 YAML，不丢失数字、布尔值、数组或对象类型。
调用：await ctx.readValue(path)
参数：path 是 /state/current.yaml 或已发现的 /state/data/.../@value.yaml；不接受属性目录或其他文本资源。
返回：完整 JSON 值；建立与 ctx.read 相同的读后写基线。序列化后的值最多 16384 字符，超出时明确失败，不返回半个对象；请改读更小的属性。
示例：const p = "/state/data/环境/@value.yaml"; const value = await ctx.readValue(p); value.舒适度 = 20; const saved = await ctx.write(p, value); print(saved);
限制：示例路径仅作说明，实际路径须来自 ls/search。保持未修改的兄弟字段；readValue 读取仍受当前 State 范围、权限和版本限制。`,
  readNarrative: `可按当前可读分支的稳定楼号选择：selection: { kind: "floors", from: 1, through: 32 }；返回楼层路径和缺失楼号，缺号不代表连续正文。
### Narrative sampling
用途：读取当前授权 Timeline 的正文节点，使用固定分支和读取时的正文 Head。
调用：await ctx["readNarrative"]({ selection, maxNodes?, maxCharacters?, view? })
选择：{ kind: "tail", count, throughFloor? } 读取某个 Head 之前最近的节点；{ kind: "range", afterFloor?, throughFloor? } 读取起点之后、终点以内的节点。afterFloor 不包含，throughFloor 包含。
返回：包含 nodes（楼层、路径、正文）、text 和 complete 的对象。view 默认为 raw；prompt 使用宿主本次选定的正则规则，nodes[].text 与 text 是加工文本，nodes[].body.raw 始终是原文。processing 记录规则版本和诊断，不展开正文宏或链接。
complete=false 表示仅返回请求范围的尾段；把 nextBeforeFloor 作为下一次 throughFloor 继续读取，range 保留原 afterFloor；floors 保留 from 并将 through 改为 nextBeforeFloor，tail 的 count 减去本次 nodes.length。floor 是持久楼号；position 从 1 开始，仅为本次返回窗口内的位置。正则 depth 也相对于本次窗口，不宣称分页分别加工等于整段加工。
每次最多 1000 个节点、2000000 个原文字符；CodeAct 桥接和 print 的输出限制另行生效，大段正文应缩小范围，不把字符预算当成 Token 预算。
示例：const story = await ctx["readNarrative"]({ selection: { kind: "tail", count: 3 } }); print(story.text);
限制：只能读取当前授权 Timeline，不能传入其他 Timeline；读取不会推进 Memory 指针、默认有效 Head 或写入 Narrative。读取依赖宿主配置的默认剧情上下文来源；narrative.context_unconfigured 表示缺少读取范围配置，不表示 Timeline 未绑定，也不表示 appendNarrative 不可用。不要重复同一失败读取；已有上下文足够时可继续完成写作，不足时明确报告缺少读取配置，不编造剧情。读取已总结的历史原文需要单次 Yes/No 授权；没有交互处理器时拒绝。批准只覆盖当前固定范围和预算，后续请求或续读需重新授权；等待用户期间暂停执行计时，取消后不返回旧正文。`,
  appendNarrative: `### ctx.appendNarrative
用途：将剧情正文追加到宿主当前绑定的 Timeline/Branch，新增一个 Narrative 节点。
调用：await ctx.appendNarrative({ content })
参数：content 为非空 Markdown 字符串；不能指定 Timeline、Branch、节点 ID 或 Head。
返回：{ path }，可直接 await ctx.read(result.path)，完整读取后可用 ctx.write(result.path, newText) 修改。不要自行拼装内部 ID；即使随后脚本失败或取消，工具结果仍列出已提交路径，不要盲目重试。
示例：print(await ctx.appendNarrative({ content: "她推开门，走进雨中。" }));
限制：只有明确要求创作并写入剧情、且当前工具实际可用时才调用。/resources/.../@body.md 是设定资源正文，/state 是结构化状态，都不是剧情；不能用 ctx.write 改世界书代替剧情。无追加工具或无绑定时报告无法执行；成功回执才算入库，普通答复不产生新楼层。追加不会改变默认投影 Head，已提交节点不能通过脚本失败撤销。`,
  write: `### ctx.write
用途：替换已读取的 Workspace 文本、Prompt Resource 正文或 State 属性。
调用：await ctx.write(path, value, { mode: "replace", allowTypeChange: false })
参数：必须先完整读取同一个 path（State 可用 readValue）；Workspace/Prompt Resource 正文传字符串，State 传与目标类型对应的 JavaScript/JSON 值。字符串不会自动解析成 YAML 或 JSON；不要把 stringify 后的文本写回对象。
返回：包含 path、最新版本或 Revision、Changeset 和 modified 的对象，直接读取字段，不需要 JSON.parse。
限制：只支持 replace；还支持先完整读取 /narrative 节点后替换正文，返回新节点路径。设定资源编辑需要作者模式。不能写 /context、/state/current.yaml、附件或随包脚本；/workspace 中的脚本文本可以写入。没有先读、资源版本变化、权限不足或路径重绑都会失败。
State 对象/数组替换为其他类型默认报 vfs.type_change；只有明确要改变类型才传 allowTypeChange: true（仅适用于 State），原有审批与 Schema 校验仍生效。
写入立即生效，不需要 commit；后续失败或取消不撤回已成功写入。修订变化后重读受影响目标再修改，不整批重试。`,
  patch: `### ctx.patch
用途：在已读取的 Workspace 文本或 Prompt Resource 正文中进行局部精确修改。
调用：await ctx.patch(path, unifiedDiff)
参数：unifiedDiff 必须是单文件 unified diff；--- 与 +++ 必须使用同一个 VFS 路径。
返回：包含写入目标、最新版本、Changeset 和 modified 的对象。
限制：修改块必须包含唯一的旧文本上下文；行号只用于补丁格式，不决定实际定位。所有旧文本和上下文必须已经读取，重复匹配、重叠修改、未读范围、基线变化和多文件补丁都会失败；失败时整份补丁不写入。
支持 Workspace 文本及 Prompt Resource 正文，不支持 State、Narrative、创建、删除或移动。`,
  move: `### ctx.move
Workspace 使用 ctx.move(sourcePath, destinationPath)，可同时改名和换目录，不读取 Metadata；以下限制仅用于 Prompt Resource。
用途：在同一个 Prompt Resource 内移动已有节点。
调用：await ctx.move(path, parentPath, orderIndex)
限制：先读取目标节点的 Metadata；parentPath 必须是同一资源内的目录。不能跨资源、移动到自身子树或移动资源根节点。移动会显示结构 Diff 并进行审批。`,
  delete: `### ctx.delete
用途：删除 Workspace 文件/目录或已有 Prompt Resource 节点及其子树。Workspace 根目录不能删除。
调用：await ctx.delete(path)
Workspace 删除不读取 Metadata；以下 Metadata 要求仅用于 Prompt Resource。
限制：先读取目标节点的 Metadata；不能删除资源根节点，删除不会跨资源，也不会自动删除整个 Prompt Resource。删除会显示结构 Diff 并进行审批。`,
  create: `### ctx.create
用途：在已存在的 Prompt Resource 目录中创建一个新节点。
Workspace 调用：await ctx.create("/workspace", { name: "notes.md", kind: "file", content: "内容" })；目录用 kind: "directory"。
调用：await ctx.create(parentPath, { label, kind?, body?, category?, meta?, enabled?, capabilities?, extra? })
Workspace 创建不读取 Metadata；以下 Metadata 要求仅用于 Prompt Resource。
限制：先读取父目录的 Metadata；不能提供内部 ID，ID 由宿主生成。默认 kind 为 entry。创建会显示结构 Diff 并进行审批；不会复制其他节点的运行态或 Pin。`,
  copy: `### ctx.copy
Workspace 文本/目录使用 ctx.copy(sourcePath, destinationPath)，不读取 Metadata；以下限制仅用于 Prompt Resource。
用途：复制一个 Prompt Resource 条目、文件夹子树，或整份 Prompt Resource。
调用：await ctx.copy(sourcePath, destinationPath, { name? })
参数：普通节点的 destinationPath 是目标资源目录；资源根节点的 destinationPath 必须是 /resources。name 可覆盖复制结果名称。
限制：先读取源节点 Metadata 和目标目录 Metadata；源资源保留，不复制 Pin、执行授权或 Agent 工作记忆。当前只支持同一 Prompt Resource 内的节点/文件夹复制，以及整份资源复制；跨资源节点复制会被拒绝。复制会显示对象数量、目标和引用处理摘要，并进行审批。`,
}

export function renderCodeActTutorial(): string {
  return [
    '## CodeAct',
    '传输不能混用：codeact 是 Freeform，在 assistant 正文中输出 <loom_tool name="codeact"><metadata>{}</metadata><content>原始 JavaScript</content></loom_tool>。禁止通过 native tool_calls 调用 codeact，禁止把 {"code":"..."} 放进 <content>。只有单独启用的 codeact_json 使用 native tool_calls 和 {"code":"..."}。',
    '在隔离 JavaScript 环境中组合已授权的 ctx 操作，适合批量读取、筛选、计算与必要的多步修改。支持顶层 await、条件、循环和 Promise；变量不跨调用保存。',
    '使用 print(value) 返回必要摘要或片段，先聚合再输出，避免打印整批全文耗尽预算。每次调用创建新环境。',
    '当前版本提供受控 write、patch、move、delete、create 与 copy；没有 pin、commit、后台定时器或任意工具调用。',
    '独立路径探索使用 Promise.allSettled，逐项保留 path、成功结果或错误；Promise.all 的聚合会提前失败，但不会撤销其他已启动操作。有依赖的读写顺序 await，不并发修改共享 State/资源版本。',
    '执行有内存、输出和 JS 执行预算；等待宿主操作或审批不消耗 JS 执行预算。桥接并发自动排队，不设累计 ctx 调用次数上限。所有异步操作必须等待完成；错误按能力、权限、基线或参数分别处理，不盲目重试。',
    '能力探测只使用用户明确授权的测试目标或临时 Workspace 文件；不要用真实 State、设定或剧情写入验证工具能力。',
    '没有 process、require、fetch 或模块导入；教程和挂载本身不授予额外资源权限。',
    '引用读取内容时使用返回的 VFS 路径和必要的行范围，不拼装 loom-resource URI 或内部 ID。路径不是宿主文件，也不额外授予读写权限。',
    '批量探索示例：const paths = [/* 从 ls 获得 */]; const results = await Promise.allSettled(paths.map(path => ctx.read(path))); print(results.map((r, i) => r.status === "fulfilled" ? { path: paths[i], excerpt: r.value.slice(0, 300) } : { path: paths[i], error: String(r.reason) }));',
    ...codeActMethodNames.map(method => methods[method]),
    metadata,
  ].join('\n\n')
}
