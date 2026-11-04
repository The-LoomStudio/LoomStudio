# Loom Script Runtime

> 当前实现包含声明式文本贡献、托管配置、脚本编辑器与 Client / Worker / Server 执行；未接通的能力见本文“当前边界”。实施计划不作为运行能力证明。

Loom Script 是带头部 Metadata 的单文件代码分发格式，不要求独立 Manifest。渲染只是其中一项能力。持久化身份为 Script Document 与 Mount；Client / Server 脚本在内存中适配为 Extension Host 模块和实例，不创建伪造的安装文档。Renderer 继续共用现有 Host、Surface、Scope、冲突仲裁和诊断。

```text
.loom.js source
  -> static Metadata parse
  -> airp.loomScript + Blob source
  -> airp.loomScriptMount
  -> Runtime mount resolution
  -> declarative: text pipeline rules / extractors (no code execution)
  -> client-sandbox: isolated Renderer registration
  -> client / server: Extension Host activate(ctx)
  -> client-worker: Dedicated module Worker activate(ctx)
```

## Metadata 与身份

Metadata 必须从文件首行开始，并由 `// ==LoomScript==` 与 `// ==/LoomScript==` 包围。Host 静态解析 `format`、`id`、`name`、`version`、`runtime`、可重复的 `capability`、`contribution`、`require`、`setting` 与 `tag`，以及 `text` 多行正文，不会为了建立索引而执行脚本。

当前接受 `format: 1`，运行环境声明为 `declarative`、`client-sandbox`、`client`、`client-worker` 或 `server`。省略 runtime 等同于 `declarative`，只解析声明，不接受执行代码或代码依赖。`client-sandbox` 仍要求一个或多个 Renderer Contribution，支持 `match:<ruleId>` / `artifact:<artifactType>` 输入及 `state.read`、`ui.notify` 请求。其余代码环境不要求 Renderer，导出 `activate(ctx)`，Metadata 自动加入对应的 `runtime.<环境>` 信任请求；Server 和 Worker 不接受 Client Renderer 声明。

Metadata ID 不作为本地唯一键。同 ID、同名或同版本再次导入创建新文档，不替换原件、不复用授权，不执行自动更新检测。

持久化 Script 身份是 Document ID 与 Document Version。注册进 Renderer Host 后，Contribution Key 包含 Script 文档、采用的版本、Mount ID 和 Contribution ID；旧调用未携带 Mount ID 时保留原 Key 形式。Extension Renderer 继续使用 `extension:<packageId>/<moduleId>/<contributionId>`；两者共享 Registry，不共享分发或生命周期身份。

## 持久化与 Mount

`airp.loomScript` 保存 Owner、解析后的 Metadata、源码 Blob 引用、文件名与 SHA-256 digest。源码以 UTF-8 字节进入 Blob Store，导出和 Runtime 解析读取相同 Document Revision 的 byte-exact 内容。

`airp.loomScriptMount` 保存目标 Owner、Script Document ID、顺序、可选固定版本、启用状态、`adoptedDocumentVersion`、配置 overrides、`adoptedSettings`、`runtimeRevision` 和用户授予的 capability。新 Mount 固定为禁用且无 Grant；请求 capability 不等于获得 capability。

作用域新建/导入通过 `importLoomScript` 的可选 `mount` 同时提交 Script 与初始 Mount，二者位于同一 Blob/Document mutation；前端不再接续第二次创建挂载请求。采用已有 Script 仍使用独立 createMount。Card 资源目录中的规则只读展示，编辑转到其完整 Script，避免旧规则 upsert 有损覆盖源码。

- 同一处理上下文中按 User < Workspace < Preset < Card 选择同一脚本的一个 Mount；显式关闭也覆盖低优先级启用，移除范围才恢复继承。独立导入副本不合并；
- Narrative Timeline 通过来源 Card 读取当前 Mount；启用 Mount 解析已采用的版本，保存源码不更新运行实例，显式刷新才采用新版。移除的 Mount 不从旧 Timeline 快照恢复；
- Mount 显式固定版本仍表示用户当前选择；刷新校验目标版本与运行环境信任，成功后更新采用版本、配置快照及运行修订；只保存配置不会改变运行修订。已有启用 Mount 在服务初始化时补齐采用版本。Grant 取当前 Mount 的授权，代码更新不增加权限。
- Script 或所属 Extension Installation 缺失时保留 Mount 引用、启用选择及 Grant。Runtime 返回正常 `mounts` 和单独的 `unavailableMounts`；不可用项包含引用身份、原因和 warning，不执行，也不阻断其他正常项。原引用再次可解析后恢复正常解析，不自动寻找同名替代资源。文档类型/所有者不匹配、存储及源码 Blob 错误仍作为真实错误处理，不统一降级。

Card / Preset Artifact 可以携带 `.loom.js` Attachment。导入建立新 Script 与禁用、无授权的 Mount；导出携带用户配置 overrides 和贡献引用映射，不携带本机启用状态或 Grant；导入重新分配本地地址。单独 `.loom.js` 导出只携带作者定义，不包含本机用户配置。Card 对跨 Owner 的采用导出独立附件快照，不改变活跃原件归属。若包与采用附件同时携带同一源码，导入分别保留，不按 Metadata ID 合并。

UI 保存包内脚本直接更新原文档。Server 导出扩展 ZIP 或角色包时，将保存的字节覆盖到 Manifest 中该贡献的原始路径；因此导出包含编辑结果。目录 Apply 通过捕获时的附件位置映射文档 ID，不使用 Metadata ID 匹配。

## 声明式规则、配置与标签

`@contribution` 支持 `text-transform`（`id` + `rule`）与 `text-extractor`（`id` + `extractor`）。字段结构复用平台规则/提取器定义，去掉 owner、文档 ID 与时间戳。一份脚本可携带多条贡献及可选 JS；规则输出文本，提取器输出数据，二者都不自动写 State 或触发剧情操作。

声明由平台按请求的 Timeline/Session/预设解析已采用版本，不依赖当前浏览器页面。独立声明不要求 JS 执行授权；混合脚本无代码授权时仍可采用独立声明，但代码不会启动。贡献 `requiresCode: true` 要求相应 Server 实例在匹配的运行修订上成功激活，否则跳过该贡献并报告诊断。浏览器实例不能满足后台流水线的常驻依赖；需要此依赖的文本贡献应使用 Server 运行环境。动态注册/按次调用 SDK 不在本次静态贡献交付范围。

`@setting` 声明 `key`、`label`、`type`、`default`，可加 `description`；类型为 `string`、`number`、`boolean`、`select`。数字可声明 min/max，枚举通过 `options: [{label,value}]` 声明字符串选项。key 是稳定身份，显示名称可修改。平台生成配置控件，单独保存用户值，既不改源码也不自动刷新。启用/刷新时以全局已采用值、当前范围 overrides、作者默认值解析快照；代码通过 `ctx.scriptSettings` 读取。删除/改变配置声明导致旧 overrides 无法校验时，界面报告问题并允许清除旧值，不悄悄丢弃。

声明式规则使用 `{"$config":"key"}` 引用配置。matcher.pattern 默认按正则字面量转义，effect.replacement 默认转义 `$` 替换语法；作者确实需要正则或 `$1` 等替换表达式时，显式增加 `"as":"raw"`。普通字段按类型取值，不执行模板 JS，也不对整份源码做文本替换。

Metadata 的 JSON 可拆为多行，每行仍以 `//` 开头。多行正文可声明：

```js
// @text body <<END
// <section>
//   多行替换正文
// </section>
// END
```

贡献中的 `{"$text":"body"}` 引用该正文。原始源码按字节保存，不因解析重排。`@tag` 每行一个作者标签，索引按 NFKC、去除两端空格及小写规范化；界面支持名称/标识/标签搜索及标签筛选。标签不影响权限与执行。

编辑器提供 JavaScript/Metadata 高亮、声明说明、只读贡献摘要、源码定位与样本测试。`previewLoomScript` 仅运行平台规则/提取器，绝不执行脚本 JS、不写业务数据。可导入示例：[可配置旁白规则](./examples/configurable-text-rule.loom.js)。

## Client Sandbox

启用的 Mount 由 Studio Client Runtime 注册到现有 Renderer Host。每个可见 Renderer Instance 使用 Blob module 与 `sandbox="allow-scripts"` iframe，不授予 `allow-same-origin`。Frame CSP 默认拒绝网络连接和其他资源，只允许内联 bootstrap 与 Blob script。

Host 与 Frame 使用专用 `MessageChannel` 交换 bootstrap、update、dispose、diagnostic 和 capability request。脚本必须导出一个 `renderers` 对象，且导出的 key 必须与 Metadata Contribution ID 完全一致；不一致时不执行 Renderer，并报告 Diagnostic。

2026-09-24 起复用 [iframe 基建](../ui/iframe-runtime.md)。源码在隔离文档内部创建 Blob module；输入投影只接受当前实例的最新结果，mount/update 串行执行，能力应答独立处理。撤销 Mount 后同步回收 iframe 和宿主端口；guest dispose 只做尽力通知，不保证异步回调完成。

`state.read` 同时受 Metadata 请求、Mount Grant 与 Runtime Policy 约束。Timeline 或 Narrative Node Renderer 只能读取对应 Timeline State；Global State 可以读取。`ctx.notifications.show()` 同样需要声明与 Grant，且受按 Script Document 共享的通知预算限制。脚本不能直接访问 Host DOM、Storage 或任意 Application RPC；CSP 限制子资源和连接，但不能据此承诺阻止所有自身导航出网。

## Client / Server 后台入口

`client` 在主窗口、`server` 在 Node 服务同进程执行，均需用户明确授权；不能把它们描述为代码隔离沙箱。代码导出 `activate(ctx)`，返回的清理句柄及宿主注册句柄由现有 Extension Host 管理，停止、刷新时回收。任意同进程代码自行产生的外部副作用不保证撤销。

Client 使用现有状态读取、History、Renderer、通知、信号及清理能力；Server 使用现有状态、事件订阅、宏、Prompt Processor、资产等能力。没有安装身份或 Timeline lease 的 API 明确不可用，不能通过合成脚本包名借用其他扩展权限。运行器对不支持的授权能力给出诊断。

未被更高优先级采用遮蔽的全局实例不随角色切换停止；角色实例随角色切换，切换同角色 Timeline 保持实例。Client 的 `ctx.timeline.target` 读取当前目标；显式 State 订阅保留原目标，不自动改写。已经发出的读操作前后检查目标，旧目标结果不作为新 Timeline 数据返回。服务重启按全局启用配置重新启动 Server 脚本，不恢复闭包或补放旧事件。

`@require` 使用绝对 HTTP(S) URL，按顺序下载经典 JS 并拼接入口，在实际运行环境中执行。Client 受浏览器 CORS 约束；Server 每项最多 4 MiB，当前一次源码准备（全部依赖下载）共用 15 秒超时。停用、刷新会取消下载，迟到结果不执行；下载失败有诊断。缓存仅随当前实例/采用版本存活，不做自动更新或远端 ESM 依赖图解析。iframe 路径的依赖也只在 iframe 执行，原有 CSP 不因此放宽。

## Client 场景背景 UI 示例

`client` 脚本可以使用 `ctx.renderers.register()` 创建独立 UI；无需正文 Match / Artifact 输入的 Client Renderer 可以声明 `inputs: []`，iframe Renderer 仍要求输入声明。

声明并获授 `assets.read` 后，Client 脚本可通过 `ctx.backgrounds.list()` 读取工作台已有的背景目录。宿主返回独立快照，过滤其他角色资源，并提供包身份、资源键及已解析的图片 URL；停止后旧 Context 拒绝读取。`backgrounds.register` / `activate` 仍未向独立脚本开放，Worker 桥也没有新增背景目录方法。

[场景背景卡示例](./examples/scene-background-card.md)使用官方背景包图片，在 Timeline 末尾渲染可切换、展开的卡片。此项只补齐已登记背景资源的读取，不代表任意包文件路径、跨包接口发现和扩展依赖协议已经完成。

## 原生 Worker 后台入口

`client-worker` 使用浏览器 Dedicated module Worker，每个运行实例独占一个 Worker；Extension Manifest 的模块 `runtime` 和 Script Metadata 的 `@runtime` 均可声明。Script 必须单独授予 `runtime.client-worker`，`runtime.client` 不替代该授权。Worker 提供线程隔离，没有直接 DOM 访问，不保证独立 OS 进程，也不是权限沙箱：原生 fetch、WebSocket、IndexedDB 等仍遵循浏览器自身规则。实例依附当前页面，关闭或刷新页面会结束，不能保证后台标签页不被浏览器节流或冻结。

源码与 `@require` 代码只在 Worker 内执行。扩展入口 URL 保留目录以支持相对 import；单文件脚本使用 Blob URL，外部经典依赖仍遵循 `@require` 合同。Worker 模块不声明 DOM 或 Server Contributions，后续若提供新的 Worker Contribution 类型应显式扩展 Manifest 合同。

SDK 的 `WorkerExtensionActivationContext` 提供通过 MessagePort 调用的既有宿主 API，包括 State、配置订阅、历史读取、通知、日志、Tokens、Records 和 RPC。权限由原 Context 继续校验；独立脚本仍不能借此使用安装专属配置、Records、RPC 或包文件路径。`state.subscribe` / `configs.subscribe`、`assets.url` / `files.url` 返回 Promise，Timeline 通过 `await ctx.timeline.getTarget()` 读取；显式订阅绑定的目标不随界面自动改写。

停止先撤销宿主桥与订阅，再尽力调用返回句柄的 `dispose()`，最多等待 250 ms 后 `terminate()`；启动上限 10 秒。运行中崩溃同样回收，并更新实例诊断与失败状态。已经提交给宿主的外部副作用不能撤回。保存不重启、单 Mount 刷新、角色与全局生命周期沿用前述合同。

Host MessagePort桥每实例最多32个真实未结算请求；单请求10秒后只回复一次`ctx.timeout`，实际工作及requestId仍占容量，直到Promise结算。达到上限返回`ctx.busy`，不通过timeout假释放额度，也不强制取消已提交操作；dispose清监听与计时器并禁止晚回。永久未结算操作占槽直到对应bridge生命周期结束，其他bridge独立。

可导入示例：[Worker 第七天提醒](./examples/worker-day-notifier.loom.js)。它订阅全局 State 的 `world.day`，达到 7 时通知，每次运行只提醒一次；不持久化去重状态，不发送用户消息或调用 AI。导入后在扩展的“脚本”页授权并启用，导入/保存本身不启动。

## Text Pipeline 输入

Renderer 输入来自正式 `inspectTextPipeline` 结果，不重新扫描 Raw Text：

- `match` 只传递具有 `displayRange` 的稳定 Match Record；
- `artifact` 保留 `artifactType` 与 `sourceEntryId`；
- Inline Renderer 使用官方 Match Range 生成 `match-ref` Node Mount；
- 无法映射到当前渲染文本的范围不会猜测位置，并产生 Anchor Diagnostic；
- Timeline / Session collection Renderer 获得当前 Scope 的全部声明输入。

Inline Mount 只替换渲染投影中的目标范围，不修改 Canonical Narrative 或 Agent Message。

## API 与界面

- Script：`importLoomScript`、`updateLoomScript`、`getLoomScript`、`listLoomScripts`、`exportLoomScript`
- Mount：`createLoomScriptMount`、`updateLoomScriptMount`、`refreshLoomScriptMount`、`listLoomScriptMounts`、`deleteLoomScriptMount`、`getLoomScriptSettings`
- Runtime：`resolveLoomScriptRendererMounts` 只读解析；`reconcileLoomScriptRuntime` 根据实际工作台上下文同步运行实例并返回 Server 状态。检查面板不调用后者。

脚本总管理位于扩展面板的“脚本”页，支持全局/当前角色创建和采用、原位保存、导出、逐项授权、启停与单 Mount 刷新。角色 / Preset 编辑入口沿用同一 Script 身份。保存只更新源码，不启动或重启。Text Pipeline 专门面板展示当前 Runtime Context 的启用 Mount、不可用引用警告，以及 Client Renderer Host 中实际注册的 Extension / Loom Script Renderer。Client 加载正常项时，对启用的不可用项显示 warning，而不是把整个解析当作失败。

## 当前边界

- 原生 Worker 已接通；持久 QuickJS、独立进程以及通用 iframe 后台执行器尚未接通；Shadow DOM 是 Renderer 适配器，不是代码隔离；
- Timeline 工作区文件尚无正式 Script 执行入口；现有 `workspace` Owner / Mount 不是 Timeline 树中文件的引用；
- 安装专属配置、Records、RPC、包文件路径，以及需要 Timeline adoption lease 的 Narrative / Agent Task / VFS 接口尚未完成 Script 适配；
- 定向测试覆盖版本采用、授权、重复导入、原位编辑导出、Client/Server 生命周期、依赖顺序与取消、RPC 与原 Host 契约；2026-10-23 [Worker 浏览器探针](../../../tests/probes/client/worker-runtime.md)覆盖真实线程执行与清理，不代表完整管理 UI 或所有运行环境均已验收。早期 iframe 探针只证明其当时覆盖的渲染路径；
- Marker selector 尚无正式数据源；Standalone Script inline Renderer 使用 Text Pipeline 的稳定 Match 数据源。

实现入口：

- [`packages/application-runtime/src/scripts/`](../../../packages/application-runtime/src/scripts/)
- [`apps/studio-client/src/features/loom-scripts/runtime/`](../../../apps/studio-client/src/features/loom-scripts/runtime/)
- [`apps/studio-client/src/features/loom-scripts/model/client-script-runtime.ts`](../../../apps/studio-client/src/features/loom-scripts/model/client-script-runtime.ts)
- [`apps/studio-server/src/scripts/script-service.ts`](../../../apps/studio-server/src/scripts/script-service.ts)
- [`apps/studio-server/src/scripts/server-script-runtime.ts`](../../../apps/studio-server/src/scripts/server-script-runtime.ts)
- [`client-renderer-host.md`](client-renderer-host.md)
- [`../application/history-text-pipeline.md`](../application/history-text-pipeline.md)

## Markdown 单规则源码

新建正则规则使用 `.md`，执行代码继续使用 `.loom.js`。两者共用 Script Document、Blob、Mount、授权与版本采用；Markdown 只生成声明式文本贡献，不启动 JS。旧 `.loom.js` 声明式规则仍可读取，不自动重写已有源码。

````markdown
---
id: example.phone
name: 手机消息
version: 1.0.0
tags: [ui, phone]
regex: '<phone>([\s\S]*?)</phone>'
regex_flags: g
phases: [display]
order: 0
streaming: false
capture_remove:
  - '<Image>'
  - '</Image>'
---
```html
<div class="phone">$1</div>
```
````

YAML 结束分隔行之后的全部文字就是替换正文，不再增加容器围栏、JSON 字符串或 JavaScript 注释。缩进、空白、换行和内部 HTML/CSS/JS 原样保存；正文空字符串表示删除，只有空格或换行则仍是替换内容。正则建议用 YAML 单引号以免反斜杠发生双重转义；`regex_flags` 省略时为 `g`，显式空字符串表示仅处理第一个匹配。首版一份 Markdown 只有一条规则。

- `phases: [display]` 为显示投影，`[prompt]` 为提示词投影，可同时指定两者；它们不改持久正文。`[classify]` 是已有保存时分类阶段，不能与投影阶段混写。
- `description` 可选，支持 YAML 多行文本。当前上下文中已有效采用并启用的规则，其说明常驻参与 Agent PromptBuild；不要求正则匹配、不要求包含 prompt 阶段。`description_anchor` 可选，默认 `@chat.tools`，只支持一个锚点；缺失锚点给出 `prompt.rule_description_anchor_missing` 诊断，不转投其他位置。空白说明不注入，同一规则同时适用于剧情与会话时只贡献一次。沿用有效规则序列与采用版本，来源证据保留脚本文档、规则 ID 和版本。这里不提供独立的关键词或条件触发；复杂说明继续使用 Lore。
- `capture_remove` 按列出顺序对被引用的捕获内容做区分大小写的字面量删除，适用于 `$&`、`$1` 等编号捕获及 `$<name>`；不修改模板、未匹配正文或前后缀引用。不将其解释成新的正则。
- `streaming` 默认关闭。开启后，对原始流式快照按当前规则顺序重新计算，仅运行开启流式的 display 规则；不把上一轮替换结果作为输入，也不写入历史。允许作者匹配尚未闭合的内容。浏览器最多约每 100ms 采样一次，结束快照立即走正常显示投影。
- `targets` 默认 `[narrative, agent-session]`；`min_depth` / `max_depth` 可限制作用深度。
- `action` 默认 `replace`。已有标记能力可使用 `action: mark` 和 `marker_type`；提升推理使用 `action: promote-reasoning`、`phases: [classify]`，可指定 `content_group`、`visibility`、`replay`、`dialect`。这两种动作不接受非空替换正文。
- `settings` 可复用现有托管配置定义，正则匹配字段支持既有 `$config` 引用。不会对原文 HTML 隐式执行另一套插值语言。

编辑器使用 YAML frontmatter + Markdown 的混合高亮，内部代码块沿用对应语言高亮。测试区可选择流式快照，只运行显式开启流式的规则。解析和测试均不执行替换正文的 JS。

## 规则排序与所有权内编辑

工作台支持在个人全局、角色、预设、已安装扩展下创建、导入、编辑和删除 Script。列表按具体所有者分组；拖动组或组内条目立即写 Mount 顺序，刷新后保留，不修改源码 `order`，也不刷新运行实例。源码顺序作为新采用的初始值。默认组序为预设、角色、扩展、个人全局；显式拖动覆盖默认顺序。同一条规则的最终次序不使用 Mount 顺序与源码顺序相加。

当前角色视图里，仅从全局继承且尚未建立角色采用配置的脚本不参与角色排序，避免拖动偷偷创建一个角色关闭覆盖；可在全局视图排序，或先添加角色采用。保存源码仍不等于启用/刷新，角色明确关闭仍覆盖全局启用。

角色和预设附件携带源码、采用顺序及组序；扩展导出会收集本安装下新增的脚本、更新保存后的源码与顺序，并从 Manifest 中去掉明确删除的声明。重新导入扩展新增脚本不授予代码权限、不自动启用。旧 `transformRules` 包槽仍可携带完整 Script artifact，保持已有引用地址。

渲染器如何解释正文里的 HTML 围栏、保留 iframe 实例并接受 CTX 更新、嵌套渲染和 TSX 编译均不属于正则处理器。流式投影可更新文本，不承诺 iframe 内部状态不重建。


## 使用配置与运行时 Config

“规则与启用”里的 `ruleUsage` 是采用范围的覆盖值：深度、作用对象、阶段、流式开关保存后直接进入有效文本管线，不改源码或 runtimeRevision。未覆盖项来自已采用源码版本；null 深度表示明确不限，恢复默认删除该项覆盖。显示与后续 PromptBuild 共用这份结果，不追改已保存正文。

声明式规则的作者 `settings` 保存后立即更新有效规则和 description；可执行脚本的 `scriptSettings` 仍是启动/刷新时快照。源码保存不代表采用新版。

需要运行中读写持久配置的 client、client-worker、server 脚本使用 `ctx.configs`，申请 `configs.read` / `configs.write`。它按脚本文档身份隔离，提供 list/get/upsert/subscribe，复用宿主 Config 存储与乐观并发。修改已有值必须传 expectedVersion；重新导入的新副本有独立身份，不继承 Config。client-sandbox 暂不提供这项后台能力。

```js
// 头部另需声明 @capability configs.read 和 @capability configs.write
export async function activate(ctx) {
  const scope = { kind: 'global' }; // 角色所属脚本使用自己的 card/timeline/session scope
  const current = await ctx.configs.get({ scope, key: 'mode' });
  if (!current) await ctx.configs.upsert({ scope, key: 'mode', value: 'normal' });
  const subscription = await ctx.configs.subscribe({ scope }, entries => {
    // 根据 entries 更新本脚本自己的界面或逻辑；不自动操作其他资源开关。
  });
  return { dispose: () => subscription.dispose() };
}
```

默认读取 scope 为当前 Timeline、角色或全局；显式订阅绑定 scope，不随界面偷偷换目标。角色所属脚本不能访问别的角色或全局 Config，客户端也不能指定工作台当前上下文以外的故事/会话。server 复用宿主的角色归属检查。订阅首版每秒检查版本并在退出时清理；不重启脚本。配置不是 Branch State，不随剧情回退。

## 关联 Lore 快捷管理

规则可写：

```yaml
lore_refs:
  - resourceId: my-lore-resource
    nodeId: my-format-entry
```

工具的对应字段为 `prompt.loreRefs`，元素结构相同。普通引用使用资源 ID 与节点 ID；扩展包内可用本包 promptResources 贡献 ID 作为 resourceId，安装时解析到该安装实例。角色包内部引用随复制重映射；单独分享脚本不会携带或复制 Lore，目标缺失时界面提示修正。

引用不会自动注入、采用或授权。规则/工具详情中可打开关联 Lore，逐项切换它原有的节点开关；这会影响节点的所有采用处，父级、触发与采用范围仍然有效。不存在统一联动状态，脚本退出不撤销用户开关。简短 description 与复杂 Lore 可以并存，工具原有顶层 description 和 content 调用协议保持。

Script Config写入与作用域存活校验共享DataEngine事务。Timeline/Agent Session校验使用该事务的Store，不调用普通异步read重入；配置仍要求相应授权、当前runtimeRevision与更新expectedVersion。
