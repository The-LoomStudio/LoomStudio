import { codeActMethodNames } from './context.js'

export const codeActToolIds = new Set(['official/codeact', 'official/codeact_json'])

const metadata = `### Prompt Resource Metadata
节点的元数据以同目录的 \`@meta.yaml\` 或文件旁的 \`.meta.yaml\` 表示。
先读取元数据文件，再使用 \`ctx.write(path, yamlText)\` 替换。允许字段：label、category、meta、enabled、capabilities、extra。
parentId、orderIndex 和内部 ID 不属于这个文件；Metadata 修改、移动、创建、删除和复制都必须使用各自的方法。元数据修改同样会进行版本检查和变更审批。`

const methods: Record<typeof codeActMethodNames[number], string> = {
  ls: `### ctx.ls
用途：发现当前允许视图内的资源，默认列一层目录，只显示路径名称和状态。
调用：await ctx.ls(path = "/", { offset = 0, limit = 50 } = {})
参数：path 为虚拟目录；limit 为 1-100；offset 用于继续列表。
返回：可推导子路径的文本文件树，不是 JSON 对象。
示例：print(await ctx.ls("/"));
限制：这里不是宿主磁盘；先列目录再读，不猜测内部 ID。`,
  search: `### ctx.search
用途：在允许视图内用字面关键词定位内容。
调用：await ctx.search({ path = "/", terms, match = "all", limit = 5 })
参数：terms 为 1-8 个关键词；match 为 all 或 any，all 在同一文件内匹配；limit 为 1-20。
返回：路径、行范围和有限原文片段；截断或还有结果会明确提示。
示例：print(await ctx.search({ path: "/resources", terms: ["钥匙", "C"] }));
限制：不理解“首次”等语义，不扩大到历史或其他 Session；命中片段不能代替完整条件。`,
  read: `### ctx.read
用途：读取允许视图中的资源正文。
调用：await ctx.read(path, { startLine, endLine } = {})
参数：path 来自 ls/search；可选行号从 1 开始，包含结束行。
返回：纯正文字符串；结果另列读取路径、实际行范围和总行数，不污染正文值。
示例：const text = await ctx.read("/state/current.yaml"); print(text);
限制：普通设定优先完整读取。每次最多返回 16384 字符；查看实际范围后继续读取。
/resources 是已挂载设定/预设的实时原始正文，保留宏源码；宿主记录资源、节点和读取版本，模型不必提供内部 ID。
/context 是本次提示词准备时的投影视图，不是作者源文件，不可据此写回。
/state/current.yaml 是当前授权 State 的完整快照；/state/data 下逐层列属性，目录内的 @value.yaml 是该属性的 YAML，数组作为整体读取。
/attachments 是当前预设拥有并挂载的脚本附件，读取不会执行脚本。
列表中的 disabled 表示停用注入，不等于不可读；locked 可发现但不可读取。路径中的转义字符按列表原样使用。
不能读取宿主文件、未挂载资源、历史 Narrative 或 Session；观察到的旧路径被另一对象占用时会报错，不自动改绑。`,
  write: `### ctx.write
用途：替换一个已读取且获准写入的 Prompt Resource 正文或 State 属性。
调用：await ctx.write(path, value, { mode: "replace" })
参数：必须先完整读取同一个 path；Prompt Resource 的 value 是字符串，State 属性的 value 是 JSON 值。
返回：写入目标、最新版本或 Revision、Changeset 和 modified=true。
限制：只支持 replace；不能写 /context、/state/current.yaml、附件、脚本或 Narrative。没有先读、资源版本变化、权限不足或路径重绑都会失败。
写入立即生效，不需要 commit；失败不会自动撤回此前已成功的写入。`,
  patch: `### ctx.patch
用途：在已读取的 Prompt Resource 正文中进行局部精确修改。
调用：await ctx.patch(path, unifiedDiff)
参数：unifiedDiff 必须是单文件 unified diff；--- 与 +++ 必须使用同一个 VFS 路径。
返回：写入目标、最新版本、Changeset 和 modified=true。
限制：修改块必须包含唯一的旧文本上下文；行号只用于补丁格式，不决定实际定位。所有旧文本和上下文必须已经读取，重复匹配、重叠修改、未读范围、基线变化和多文件补丁都会失败；失败时整份补丁不写入。
当前只支持 Prompt Resource 正文，不支持 State、Narrative、创建、删除或移动。`,
  move: `### ctx.move
用途：在同一个 Prompt Resource 内移动已有节点。
调用：await ctx.move(path, parentPath, orderIndex)
限制：先读取目标节点的 Metadata；parentPath 必须是同一资源内的目录。不能跨资源、移动到自身子树或移动资源根节点。移动会显示结构 Diff 并进行审批。`,
  delete: `### ctx.delete
用途：删除一个已有 Prompt Resource 节点及其子树。
调用：await ctx.delete(path)
限制：先读取目标节点的 Metadata；不能删除资源根节点，删除不会跨资源，也不会自动删除整个 Prompt Resource。删除会显示结构 Diff 并进行审批。`,
  create: `### ctx.create
用途：在已存在的 Prompt Resource 目录中创建一个新节点。
调用：await ctx.create(parentPath, { label, kind?, body?, category?, meta?, enabled?, capabilities?, extra? })
限制：先读取父目录的 Metadata；不能提供内部 ID，ID 由宿主生成。默认 kind 为 entry。创建会显示结构 Diff 并进行审批；不会复制其他节点的运行态或 Pin。`,
  copy: `### ctx.copy
用途：复制一个 Prompt Resource 条目、文件夹子树，或整份 Prompt Resource。
调用：await ctx.copy(sourcePath, destinationPath, { name? })
参数：普通节点的 destinationPath 是目标资源目录；资源根节点的 destinationPath 必须是 /resources。name 可覆盖复制结果名称。
限制：先读取源节点 Metadata 和目标目录 Metadata；源资源保留，不复制 Pin、执行授权或 Agent 工作记忆。当前只支持同一 Prompt Resource 内的节点/文件夹复制，以及整份资源复制；跨资源节点复制会被拒绝。复制会显示对象数量、目标和引用处理摘要，并进行审批。`,
}

export function renderCodeActTutorial(): string {
  return [
    '## CodeAct',
    '在隔离 JavaScript 环境中调用 ctx。支持顶层 await、条件、循环和小批量 Promise.all。',
    '使用 print(value) 将结果返回给模型；每次调用创建新环境，变量不跨调用保留。',
    '当前版本提供受控 write、patch、move、delete、create 与 copy；没有 pin、commit、后台定时器或任意工具调用。',
    '执行有时间、内存、输出和并发限制；所有 ctx 调用都必须 await。错误包含原因，按提示缩小范围或重新读取，不盲目重试。',
    '没有 process、require、fetch 或模块导入；教程和挂载本身不授予额外资源权限。',
    '读取结果中的 Reference 是可点击资源引用。回复用户时直接复制该 Markdown 链接，可改显示名称；不要编造 URI、内部 ID 或行号。/context 投影没有源正文引用，请读取 /resources 后引用。引用不等于写入授权。',
    ...codeActMethodNames.map(method => methods[method]),
    metadata,
  ].join('\n\n')
}
