# PulsarAI 架构与产品实践对照参考

> **状态**：两轮静态审计完成；已吸收独立反向复审修正
> **日期**：2026-08-27
> **对照快照**：PulsarAI `45c7ddaa5069f8dce3cdb62e8e77b6ab041870a4`；LoomStudio `7e69867978b1543e0ddea51ecc22b5cb542ab9d7`
> **范围**：Conversation、Plugin、Agent、CodeAct、Sandbox、Capability、Memory、Database、Backup、Tauri、桌面/移动产品面、UI、测试、文档与工程治理。
> **说明**：本文是外部项目源码参考，不是 Architecture、ADR 或已批准实施计划。LoomStudio 快照存在未提交业务改动；本文只描述当前检出状态，不把脏工作区中的实现自动晋升为稳定合同。

---

## 1. 结论

PulsarAI 最值得 LoomStudio 学习的，不是 SurrealDB、Tauri、Vue、单一 `codeAct` Tool 或任意 JavaScript Sandbox 本身，而是它把 **AIRP 的生成流程与创作资源变成了用户可以直接编辑的产品对象**：主 Plugin 显式拥有 `runtime/generatePath`，资源通过 source-scoped imports 和惰性 Container 进入流程，本轮回复通过 target-bound `reply` 句柄流式写入，消息版本切换会重放对应状态，压缩记忆则作为不改写原始消息的派生索引存在。

这条路线与 LoomStudio 的核心优势正好互补。PulsarAI 更像“把 AIRP 变成可编辑脚本与资源树”；LoomStudio 更像“把 AIRP 变成可追踪、受治理的领域运行时”。Loom 已经拥有更清楚的 Kernel / Application / Client 分层、PromptBuild provenance、canonical Agent transcript、SQLite transaction / Commit Fact、Tool Definition / Mount / Registration、Package / Module / Instance Extension 治理，以及 owner / purpose Secret Store。为了获得 Pulsar 的可塑性而放弃这些边界，是明显倒退。

当前最有价值的学习顺序是：

1. **P1：把最近 100 条硬截断纳入 Context Capacity / Agent Context Maintenance**——先让容量与裁剪可见、可诊断，再借鉴 immutable summary artifact；使用 Loom Agent Entry / Narrative Node 身份、强 digest、PromptBuild trace 和事务合同，不保存任意 JavaScript mutation source。
2. **P1：设计 Runtime-owned Assistant Draft / Stream Sink**——吸收 target-bound `reply` 的串行 append / replace 与外层封口语义，把底层 Provider streaming 真正带到 Application / RPC / Client；reasoning、Tool 和 run-state 仍直接进入 canonical transcript。
3. **P1：让现有 typed RPC、Extension SDK 与 introspection 生成作者、人类和 Agent 三种参考**——借鉴 Capability 定义同源，不再维护平行 API 清单。
4. **P1：为 Prompt Resource / Extension Package 增加显式依赖查询和“实际读取资源”追踪**——复用现有 Source、Contribution、Zone、Slot 和 PromptBuild trace，不复制第二套 Plugin 容器系统。
5. **P1 研究：现有 Agent Preset / Prompt Resource / 可信 Extension contribution 是否足以表达可编辑流程**——只有存在无法表达的真实场景时，才在 Workbench / Playground 引入新的 Generation Strategy 概念。
6. **P2：消息版本绑定的分支派生状态、Focus Mode、统一设置壳、窄窗口状态和后台完成通知**——均按真实产品需求逐项引入。

明确不应照搬：同 Realm `new Function` Sandbox、固定方法名 denylist、默认开放全部 Feature API、通用数据库表读口、前端持有可变领域对象、任意目标 Secret proxy、宽 Tauri FS/Shell 权限、Conversation 多记录非事务写入、把 CodeAct 作为所有 Tool 的唯一协议，以及用 `content-visibility:auto` 冒充 virtualization。

---

## 2. 审计方法与证据边界

本次对照直接读取两个本地仓库的当前源码、专题文档、manifest、Tauri 配置与 Git 历史。PulsarAI 仓库被克隆到 `/Users/macbookair/Desktop/PulsarAI`，保持干净；没有安装依赖、启动浏览器、运行 build 或执行外部网络调研。

规模只用于解释项目阶段，不用于评价设计优劣：

| 指标 | LoomStudio | PulsarAI | 解释限制 |
|---|---:|---:|---|
| Git tracked files | 743 | 843 | 目录组织和资源文件构成不同 |
| Git commits | 53 | 22 | PulsarAI 是高速演进的单作者新项目 |
| `shortlog` 身份数 | 1 | 1 | 不能据此推断用户规模 |
| tags | 0 | 0 | 双方都没有正式版本发布轨迹 |
| tracked test-like 文件 | 123 | 0；另有 `migration.rs` 中 2 个 Rust tests | 统计口径为测试目录与 test/spec 文件并集，只反映交付闭环量级 |

PulsarAI 当前没有 `.github` workflow、License、CONTRIBUTING、SECURITY、CHANGELOG 或发布脚本；README 只有一句占位。`package.json` 只有 dev、build、docs 和 tauri 命令，没有 test、lint、format、check 或 release。它的功能覆盖很广，但不能被写成“成熟生态和交付基线”。

本文区分三类结论：

- **已实现事实**：当前源码、当前入口或正式 Feature 文档可以直接确认；
- **工程判断**：基于双方边界差异给出的借鉴价值与优先级；
- **开放问题**：需要运行时、性能、安全利用验证或产品决策，本文不把静态候选写成已发生事故。

---

## 3. 产品主体不同，不能做一比一移植

### 3.1 PulsarAI 当前实际产品形态

```text
AppShell
  -> ConversationStageOnePage
      -> Character Package / Conversation selection
      -> Conversation Stage Thread + Composer
      -> overlay Plugin Asset Tree + File Editor
  -> Settings Dialog
  -> Command Search
  -> Notifications

Conversation generation
  -> Action process or main Plugin generatePath
  -> CodeAct Agent / Feature APIs / Plugin resources
  -> SurrealDB + Tauri native services
```

当前 `AppShell` 只挂载 Conversation、设置、命令搜索和通知；旧的 Workspace tabs、通用 resource registry、左右 Sidebar host 和 Novel renderer 已在 `97cbc96` 删除。PulsarAI 的主体已经从“通用多页工作台”收束成“对话产品中的角色包与 Plugin 创作环境”。

证据：PulsarAI `src/features/UI/presentation/AppShell.vue:21-30`、`src/features/Resources/Conversation/presentation/ConversationStageOnePage.vue:58-109`、`src/features/UI/docs.md:7-17`。

### 3.2 LoomStudio 当前产品与领域主体

```text
Studio Client
  -> Router / Workspace / typed Client Bridge
      -> Studio Server composition root
          -> Application Runtime
              -> Narrative / Agent / PromptBuild / Provider / Tool
              -> domain Stores on shared SQLite Data Engine
          -> Kernel / Transport / Extension Host
          -> Document / Blob / Asset / Secret / Logging / Trace
```

LoomStudio 的中心不是一条 Conversation，而是可编辑、可持久化、可投影的 AI Application。Narrative Timeline 是故事事实权威，Agent Session 是工作过程权威，Prompt Resource / PromptBuild 是上下文组合权威，Extension Package 是扩展来源与治理边界。

因此 Pulsar 的 Focused Conversation 形态可以启发 Loom 的可逆 Focus Mode，但不能替代 Router、Workspace、Asset deep-link、Narrative、Agent 和 Prompt Resource 的独立身份。

---

## 4. 总体对照矩阵

| 维度 | PulsarAI 当前事实 | LoomStudio 当前事实 | 判断 |
|---|---|---|---|
| 生成权威 | Runtime 选择 Action process 或主 Plugin `runtime/generatePath`；Process 自行构造上下文、调用模型、后处理与回复 | Application Runtime 通过 `composeAgentTurnPrompt -> compilePromptWithCore` 掌握正式组合 | 学显式流程表达，不交出 PromptBuild authority |
| 回复写入 | target-bound `reply` 串行 append/replace/step/fail，结束后失效 | Provider 调用主要返回最终 result，底层 stream 尚未贯通 Client | 高价值借鉴为 Runtime-owned Draft Sink |
| Agent Tool | 当前内置 core / default Agent 的模型只看到 `codeAct`；自定义 Process 仍掌握 Agent 构造 | Tool Definition/Mount/Registration、transport、validation、approval、timeout、abort、canonical result | 只在测得 schema 压力后研究窄 batch-read Tool |
| Plugin 资源 | 稳定节点 ID、显式 imports、Container namespace、循环与冲突诊断 | Prompt Resource Source/Contribution/Zone/Slot/Activation/trace | 学依赖查询与作者体验，不建平行资源真相源 |
| 会话 | Container 分支与 Message version 分离 | Narrative 与 Agent Session 分离，Agent Entry append-only | Pulsar UX 值得研究，领域权威不能合并 |
| 状态 | 消息版本绑定 update source，沿 active path 重放 | State Store revision；Tool 通过 owning API 和 transaction 写入 | 仅借派生状态思想，持久化结构化 operation |
| 长上下文 | immutable summary segment DAG，绑定消息版本并递归校验 | Agent / Narrative 当前各取最近 100 条 | Pulsar 明显更完整，是 Loom 高优先级缺口 |
| 失败与恢复 | error 消息可见；无正式 RunAttempt、stop、resume、crash repair | canonical transcript、run-state、Invocation/Result、abort/timeout | Loom 更强；保持并继续补 OMP 式完整性 |
| Capability | 定义、运行时 docs 与 VitePress 生成同源；实际 policy 为全开后 denylist | typed RPC、Host capability、Package/Module/Instance grant、默认拒绝 | 学同源文档，不学授权实现 |
| 持久化 | SurrealDB；Plugin 树一次替换事务；Conversation 多记录更新非事务 | shared SQLite Data Engine、领域 Store、transaction、Commit Fact | 保留 Loom 数据边界 |
| Secret | SurrealDB 明文值，Rust 出站代理水合 placeholder | 系统 Keyring backend，owner / purpose / use context | Loom 明显更强 |
| UI | 单一 Conversation、资产浮层、设置中心、窄窗口/移动准备 | Studio 多页与面板、Router/Zustand ownership | 可增加 Focus Mode，不缩减 Studio 主体 |
| 工程治理 | 22 commits、无 CI/tag/license、几乎无测试、主设计文档漂移 | 分层测试与 workspace checks；同样无 tracked CI | Pulsar 是产品研究对象，不是交付成熟度标杆 |

---

## 5. 端到端生成链：最值得理解的差异

PulsarAI 当前生成链如下：

```text
ConversationStore.send
  -> persist user container
  -> create + persist empty assistant container/version
  -> fillAssistantContainer
      -> choose mainPluginId + enabled plugins
      -> build activePath / raw chat / resource context
      -> runConversationGeneration
          -> build all Feature capabilities
          -> resolve Plugin topology and imports
          -> replay message-version variable updates
          -> create target-bound reply
          -> create lazy Agent resources
          -> run Action process or main Plugin generatePath
              -> optional memory.prepare
              -> optional compileChat
              -> optional agent.prepare
              -> new ToolLoopAgent
              -> stream -> reply
          -> close reply
  -> persist final assistant version
```

证据：PulsarAI `conversation-store.ts:1075-1186`、`:1211-1313`；`conversation-generation.ts:178-270`、`:315-370`、`:503-610`；`Plugin/builtIn/core/generate.js:1-45`。

关键点不是“Plugin 能跑 JavaScript”，而是 Conversation 只固定外层生命周期：目标 Conversation、活动路径、本轮空 Assistant version、可用资源拓扑和失败落库。外层 Runtime 选择 Action process 或主 Plugin `generatePath`；被选 Process 显式决定最终 Provider payload、是否压缩、是否调用 Agent 和如何后处理。Process 返回值被忽略，正文只能通过 `reply` 写入。

对 Loom 的正确借鉴不是把 `agent-turn.ts` 替换成脚本，而是研究一个受约束的 `GenerationStrategy`：

```text
Generation Strategy
  -> 声明需要的 Prompt Source / Resource query
  -> 请求 PromptBuild 编译
  -> 请求 Runtime 执行已注册 Tool / Provider
  -> 通过 Draft Sink 写本轮输出
  -> Runtime 保存 PromptBuild / Transcript / Run / Commit facts
```

策略只能请求现有权威能力，不能获得 Store、SQL、Kernel 或可变领域聚合对象。

---

## 6. Target-bound Reply：可塑性与权威之间的好接缝

PulsarAI 的 `reply` 绑定当前 `conversationId + emptyContainer + emptyMessage`。它提供：

- `read()`：读取当前目标快照；
- `setContent()` / `appendContent()`：替换或流式追加正文；
- `addPart()`：附加媒体、组件或 Action；
- `addStep()`：记录用于 UI 展示的 Agent / Tool 步骤；
- `setModelName()`：记录实际模型；
- `fail()`：把目标版本投影为 error，但不会立即封口，后续仍可继续写正文。

所有修改进入串行 Promise 队列；UI 内存立即变化，持久化按 250ms 节流；Process 返回后，外层等待队列并关闭句柄，晚到写入抛错。当前 API 没有公开 `finalize()`，`fail()` 也不是 terminal transition。

证据：PulsarAI `conversation-generation.ts:218-270`、`:587-605`；`conversation-store.ts:1188-1209`、`:1301-1313`。

这比“函数返回一个字符串，然后调用方猜测如何保存”更清楚，也比把 Conversation Store 整体暴露给脚本更窄。Loom 可以把它转化为 Runtime-owned `AssistantDraft` / `StreamSink`，但 Draft 只管理尚未完成的可见文本、parts 和流序列；reasoning、provider observation、Tool Invocation / Result、run-state 和 error / abort fact 必须直接进入 canonical transcript。还需要增加 Pulsar 当前缺少的：

- `runId` / `attemptId`；
- 明确 `open -> streaming -> finalizing -> completed|failed|aborted` 状态；
- AbortSignal 和 stop API；
- chunk sequence / idempotency；
- Provider observation、reasoning、Invocation、Result 与可见正文的分离；
- crash repair 与迟到 chunk 处理；
- RPC / SSE 或其他 Client streaming transport。

Pulsar 当前的 persistence queue 还有一个失败窗口：任一节流 `persistContainer()` reject 后，Promise chain 会持续 rejected；最终 `finally` 在等待队列时再次抛出，后续最终持久化和 `generatingConversationIds` 清理可能不执行，使当前进程中的 Conversation 一直保持“生成中”。Loom Draft Sink 必须保证 flush failure 不阻止 lock cleanup，并把生成错误与持久化错误分别保存。

证据：PulsarAI `conversation-store.ts:1191-1207`、`:1301-1312`。

Loom 的 canonical transcript 仍必须是事实源，Draft 只是本轮投影与写入句柄。

---

## 7. Plugin Resource：显式依赖比隐式 Prompt 拼接更值得学

### 7.1 已实现事实

Pulsar Plugin 使用稳定树节点 ID，路径是可变展示与引用信息。资源不会全部平铺为 Sandbox ambient variables，而由发起读取的源资源通过以下 facade 显式获取：

- `imports.resource(path)`；
- `imports.resourceById(id)`；
- `imports.container(scope, id)`；
- `imports.containers(scope, pattern)`；
- `imports.config.local(...)`；
- `imports.config.global(...)`。

相对路径不能越出 Plugin 根；文本递归解析有循环检测；Container 成员按 `order desc -> pluginId -> path -> fileId` 确定性排序；实际读取过的资源 ID 会写入 Assistant message 的 environment metadata。

证据：PulsarAI `plugin-reference-resolver.ts:453-541`、`:571-668`、`:944-961`；`conversation-generation.ts:614-640`。

Plugin 持久化也有一个值得肯定的局部设计：前端传入完整 Plugin tree，Rust 把 metadata 与扁平稳定节点拆开，在单次 Surreal transaction 中替换该 Plugin 的 metadata 与全部节点。移动、重命名和内容更新因此能同步重建 path/search 字段。

证据：PulsarAI `src-tauri/src/lib.rs:760-820`、`:1410-1452`；`plugin-store.ts:1050-1153`。

### 7.2 Loom 应吸收什么

Loom 已经拥有更强的 Prompt Resource 模型：Source、Contribution、Projection、Activation、Zone、Slot、order profile 与 PromptBuild trace。最值得增加的是作者体验与查询合同：

- 资源按稳定 ID 和相对路径显式 import；import 只解析身份或候选，不自动授予内容可见性，真正读取仍受 Activation、Context Projection 和权限控制；
- 查询 Container / collection 时保持惰性，不自动把内容塞进 Prompt；
- Trace 区分“已启用候选”“已解析”“实际读取”“已渲染”和“最终进入 Prompt”，并保存 requester SourceRef、requested SourceRef、版本与 digest；
- 缺失、循环、重复、冲突给出带来源的 Diagnostic；
- 文件移动不改变稳定身份，路径只作为可变寻址与展示信息；
- 通过现有 PromptBuild SourceRef 保存 provenance，不新增 `environmentInfo` 平行审计字段。

### 7.3 当前实现反例

Pulsar 正式文档声称重复资源 ID 必须阻塞，但 resolver 对重复 ID 只写入“资源 ID 重复”诊断并保留第一个记录；Generation 入口只把包含“冲突”的诊断视为 blocking。重复 ID 因此可能进入 first-wins 行为。

证据：PulsarAI `plugin-reference-resolver.ts:571-594`；`plugin-generation-environment.ts:65-73`。

Loom 应保持“同 namespace 冲突无隐式赢家”的 Extension 和 Prompt 诊断原则，并让诊断携带 machine-readable code / severity，而不是靠中文消息 `includes("冲突")` 决定是否中断。

---

## 8. Capability 定义同源：好思想，坏授权实现

### 8.1 值得借鉴的部分

Pulsar 每个 Feature 的 Capability 定义同时包含：

- Feature ID、标题、说明；
- sub-capability 分组；
- API 名称、签名、返回、示例；
- runtime builder；
- `readDocs()` 投影；
- VitePress generated reference。

证据：PulsarAI `Capabilities/domain/capability.ts:1-112`、`Capabilities/application/capability-registry.ts:91-155`、`scripts/generate-capability-reference.ts:7-37`。

Loom 不需要引入新的 Capability Registry。更低成本的做法是从现有 typed RPC、Extension SDK、Host capability 和 `system.introspect` 生成：

| 消费者 | 建议投影 |
|---|---|
| Application / Client | 现有 TypeScript 类型与 runtime validator |
| Extension 作者 | 能力、输入、输出、owner、effect、grant、错误码参考 |
| Agent | 从本 Run 的 effective Tool Mount / Capability grant snapshot 过滤出的短说明与可调用 schema |
| 文档 | Reference 页面与漂移检查 |
| 审计 | 实际 runtime surface 与声明 surface diff |

### 8.2 授权实现不能照搬

`buildCapabilityRuntime()` 不是按 Plugin、Package、Conversation 或用户 grant 构造 allowlist，而是先请求每个 Feature 的全部 sub-capability，再使用中央 `blockedCapabilityMethods` 删除少数方法。

证据：PulsarAI `capability-registry.ts:30-58`、`:95-123`。

这份 denylist 已经发生漂移：它保留了一些旧方法名，却没有阻止当前存在的 `plugin.createGlobal/update/restore`。这不只是文档 surface 漂移。Generation 先从通用 Capability Runtime 取得 `inheritedPluginApi`，再用 `{ ...inheritedPluginApi, ...scopedSelfApi }` 构造 scoped facade，最后把 `plugin` / `PLUGIN` / `capabilities.plugin` 全部替换为这个合并对象；因此 generatePath、Action、自定义 Tool，以及捕获同一环境对象的内置 CodeAct 都可以调用继承的 `createGlobal/update/restore`。Database 的 `selectAll/selectOne` 也被默认保留，而底层只校验表名字符，不校验 table allowlist、owner 或 purpose。

证据：PulsarAI `Capabilities/application/capability-registry.ts:30-58`、`:95-110`；`Resources/Conversation/application/conversation-generation.ts:380-403`、`:428-460`；`Agent/application/default-agent.ts:71-129`、`:178-200`；`Database/capabilities.ts:33-61`；`src-tauri/src/lib.rs:180-189`、`:1285-1315`。

Loom 应继续使用默认拒绝、具体 Module grant、owner 强制和 typed capability。文档同源不能替代授权同源；文档本身也不授予权限。真正需要同一个权威定义和 effective grant snapshot 同时生成 runtime facade、grant UI、Agent docs 和审计 surface，未授权 API 不应进入本 Run 的 Agent 文档。

---

## 9. CodeAct：适合窄工具，不适合统一所有工具

Pulsar 当前内置 core / default Agent 的模型只看到一个 `codeAct` Tool。模型提交一个必须包含显式 `return` 的 JavaScript 函数，函数可调用 Feature、Plugin、自定义 Tool、Skill 和 MCP API，结果被归一化为 `{ ok, value }` 或 `{ ok, error }`。自定义 Plugin Process 仍掌握 `ToolLoopAgent` 构造，这不是平台不可绕过的唯一协议。

证据：PulsarAI `Agent/application/default-agent.ts:57-127`、`Agent/application/code-act.ts:18-88`。

它的明显收益是：

- Provider Tool schema 很小；
- 一次 Tool call 可以串联多次读操作；
- 新增 Feature API 不必新增模型 Tool；
- 模型可以先 `readDocs()` 再查询；
- Plugin 自定义函数不会无限扩大 Tool schema。

但它把许多本应显式的合同压进任意代码：

- 输入 schema 与 effect classification；
- approval 与用户可见参数；
- timeout / cancellation；
- 并发与排他；
- invocation/result canonical pairing；
- transport 选择；
- destination / owner / resource scope；
- 可重放性与幂等性。

Loom 已经有 structured / freeform / hybrid input、native/content/provider-custom transport、Tool Definition / Mount / Registration、approval、timeout、abort 与 canonical transcript。当前不应预建平台级通用路由器；只有测得 Provider schema 压力后，才研究一个普通、正式注册的窄 batch-read Tool。它仍受 Mount、grant、effect 和 approval 管理，并为每个子操作保留可审计 Result，不能让 CodeAct 取代正式 Tool Registry。

---

## 10. 已确认的 Capability 与 Sandbox 越权链

这不是抽象的“同 Realm 可能不安全”，而是一条当前源码直接连通的读取路径：

```text
普通 Plugin generatePath / CodeAct
  -> buildCapabilityRuntime()
      -> database read sub-capability 默认开放
      -> 只屏蔽 database.upsert/remove
  -> environment.database.selectAll("secret")
  -> Tauri database_select_all("secret")
      -> SELECT resource_key, value FROM secret
  -> 返回 id=null + Secret 明文 value
```

证据：

- PulsarAI `Capabilities/application/capability-registry.ts:30-58`、`:95-123`；
- `Database/capabilities.ts:33-61`；
- `src-tauri/src/lib.rs:54-70`、`:180-189`、`:1166-1219`、`:1285-1295`。

`secret` 表保存 `{ name, value }` 明文记录；通用查询选择不存在的 `resource_key` 和存在的 `value`，Rust `DatabaseRecord.id` 允许 `Option<String>`，因此缺失 key 不阻止 value 被序列化返回。

此外，当前脚本的 scoped Plugin API 粒度过粗：Generation 以 `createPluginSelfApi(pluginId, ["read"])` 创建 facade，而 Capability 定义有意把当前 Plugin 文件的 write/edit/mkdir/move/remove/run 全部归入 `read` 组。普通生成流程因此默认可以修改、删除并执行当前 Plugin 文件；虽然 scope 限于当前 Plugin，但读取、写入、删除和执行没有拆成独立 grant。中央 public API denylist 也无法约束这条 scoped self facade。

证据：PulsarAI `conversation-generation.ts:380-403`；`Resources/Plugin/domain/plugin-capability.ts:44-47`、`:106-153`；`Resources/Plugin/capabilities.ts:147-261`。

这个 facade 还不是纯粹的 self-only API。`createScopedPluginApi()` 先继承原 `finalEnvironment.plugin`，再覆盖 scoped self 方法；中央 runtime 保留的 `createGlobal`、`update` 与 `restore` 因而仍可达。`runProcess()` 随后把同一对象写回 `plugin` / `PLUGIN` / `capabilities.plugin`，CodeAct 也按引用捕获同一 environment。普通 `generatePath`、Action、自定义工具及其 Agent CodeAct 都可以调用这些全局修改能力，而不只是修改当前 Plugin。

证据：PulsarAI `Capabilities/application/capability-registry.ts:30-58`、`:95-110`；`Resources/Conversation/application/conversation-generation.ts:380-460`；`Agent/application/default-agent.ts:71-129`、`:178-200`。

Sandbox 本身使用 `new Function` / `AsyncFunction` + `with`，对未列入 controlled names 且存在于 `globalThis` 的属性直接返回原生对象。默认 Global Capability 不只授予 network，而是授予 network、storage、page、workers 和 codeGeneration 全部高风险组；同一个 Plugin 可以读取 Secret 后用原生 `fetch` 外发，也可以直接读取 localStorage 中的 Backup remote password 与 LAN pairing key。项目文档也承认它不是 hostile-code 或 OS 安全边界。

证据：PulsarAI `Sandbox/domain/sandbox.ts:42-76`、`Sandbox/global-capabilities.ts:28-67`、`sandbox-globals.ts:113-208`、`Sandbox/docs.md:17-25`。

Generation 还把 Store 中的真实 `conversation` 和 `activePath` 对象直接挂到环境；`chat` 是派生数组，只有本轮 `emptyContainer/emptyMessage` 使用 clone + freeze。Plugin 因而可以直接变异历史 Container / Message 或 Conversation 内存对象，绕过 `reply` 和 Store persistence，造成内存与数据库分叉。

证据：PulsarAI `conversation-generation.ts:194-212`、`:271-274`；`plugin-generation-environment.ts:52-64`。

Rust model proxy 还会扫描整个 UTF-8 Request Body，而不只是 Authorization Header。用户文本、Plugin Prompt 或 JSON 参数只要出现 `<<secretName>>`，就会被替换为真实 Secret 后发送；结合自定义 Provider 的任意 `baseUrl`，已知名称的其他 Secret 可以被注入任意目标请求体，不存在的 placeholder 也会令请求失败。

证据：PulsarAI `src-tauri/src/lib.rs:1176-1199`、`:1922-1947`；`ModelConnection/infrastructure/model-proxy-fetch.ts:21-34`、`application/model-ai.ts:34-76`、`application/model-connection-store.ts:240-264`。

Loom 必须保持：

- Extension / Agent code 不获得通用 SQL 或 table API；
- owner、purpose、Package、Module、Instance、Workspace 等身份由 Host 强制；
- Secret 只能在匹配 owner / purpose / destination 的受控 operation 中短暂使用；
- 系统 Keyring 保存 plaintext，数据库只保存 metadata / ref；
- Host facade 由 grant 构造 allowlist，不由方法名 denylist裁剪；
- 同进程 Extension capability 只作为治理边界，不宣称强安全隔离。

---

## 11. Conversation：分支、消息版本与错误投影

Pulsar 把两个容易混淆的概念拆开：

- `ChatMessageContainer` 是逻辑节点，拥有 role、父节点、活动子分支和 active message index；
- `ChatMessage` 是具体版本，拥有正文、附件、步骤、模型信息、环境信息和变量更新。

重生成会在同一个 Container 中追加 Message version，不覆盖旧版本；创建分支则创建新的 Container。`error` 是 Message type，不是模型 role，UI 正常展示，但后续 Context 会排除 error version。

证据：PulsarAI `conversation-types.ts:55-69`、`:160-179`；`conversation-store.ts:629-680`、`:1142-1165`、`:1241-1244`。

这对 Loom 的启发主要在产品体验：

- Agent Session retry / regenerate 可以保留同一逻辑位置的多个 candidate；
- UI 能独立表达“版本切换”和“工作分支”；
- 错误卡可以对用户可见，但 Prompt projection 明确排除；
- Favorite、translation、screenshot、branch map 等能力绑定 concrete version。

但 Loom 不应把它变成统一 Conversation Store。Narrative Timeline、Agent Session、Prompt Resource 与 State 的权威仍需分开；版本候选也应使用 Loom 自己的 Entry / Step / Run / Changeset 身份。

### 11.1 当前持久化缺口

Conversation 的图更新不是单次事务：新 Container 先更新并持久化父节点，再分别持久化新 Container 与 Conversation；删除时也逐个重连后继、父节点、删除目标、更新 Conversation tail。

证据：PulsarAI `conversation-store.ts:957-999`、`:1040-1073`。

中间失败可留下父节点指向不存在 child、新节点存在但 tail 未更新、内存与数据库分叉。Loom 的 Agent Store transaction、乐观并发和 Commit Fact 更适合作为多消费者权威，不应照搬这套写入顺序。

---

## 12. 消息版本绑定的派生状态

Pulsar `.data.json` 定义 `initialValue`、wrapper、isolation 与 updater。成功的变量更新不直接改写定义文件，而把更新函数 source 和 definition/source hash 保存到具体 Assistant Message version。生成前沿 active path 从初值重放这些更新；切换分支或 Message version 会自然得到另一条派生状态。

已实现的保护包括：

- 定义 hash 改变时拒绝静默重放旧更新；
- 每次更新在独立 clone 上执行，失败不提交；
- 最终值必须是有限数字、普通 JSON 对象且无循环；
- 多次成功更新按顺序合并；
- 进程内最多 64 项状态缓存，不形成第二个持久化真相源；
- 连续三次 variable-update 失败终止本轮。

证据：PulsarAI `conversation-memory.ts:103-194`、`:239-273`、`:428-460`、`:800-815`；`default-agent.ts:77-127`。

对分支式角色扮演或模拟状态，这是很有意思的设计：状态不是“当前全局值”，而是“沿当前消息版本路径可重放得到的投影”。但它只是 branch-dependent deterministic replay，不是带因果前置条件的版本化状态提交。子孙 update 没有保存生成时的父路径版本或 base-state digest；切换祖先 Message version 后，原有子孙 update 会在新的祖先状态上重新执行，系统不会判断该 update 是否仍适用。

Loom 的正确吸收方式应是：

- 只用于 branch-local、可重建的派生状态；
- 更新记录使用结构化 operation / patch，而不是任意 JavaScript source；
- operation 至少绑定 `baseRevisionId` 或 `sourceHeadDigest`，不匹配时拒绝、重生成或显式 rebase；
- operation 绑定 Agent Entry / Narrative Node / Step / Changeset；
- canonical State Store 仍由 revision、owner、idempotency 和 transaction 控制；
- PromptBuild 读取 projection，不让模型脚本直接变异历史对象。

Pulsar 当前还存在开放问题：编辑 Message version 正文时不会清理原先的 `meta.variableUpdate`。若正文与状态更新在产品语义上不可分，这会让编辑后的文本继续携带旧副作用；若产品明确把二者解耦，则应在 UI 中可见说明。

证据：PulsarAI `conversation-store.ts:825-835`；`conversation-memory.ts:121-150`。

---

## 13. Immutable Summary Artifact：高价值数据结构参考，不是完整 Context Policy

Pulsar 的压缩记忆不删除、不覆盖、不改写 canonical Conversation。每个 Segment 保存：

- Conversation ID；
- level；
- start / end Container ID；
- 叶层 Container IDs 与 Message version IDs，或子 Segment IDs；
- source hash；
- 原始与压缩 token 估算；
- compressor ID / version；
- status 与 createdAt。

最近阈值窗口、error 消息和带媒体/Action parts 的区间保持 raw。叶摘要绑定精确消息版本，高层摘要只引用连续低层摘要；读取时递归验证路径范围、版本身份、hash、子段连续性，再用覆盖最远和更高层的有效摘要构建 frontier，其余位置保留原消息。

证据：PulsarAI `conversation-memory.ts:62-88`、`:196-237`、`:469-590`、`:638-728`。

Loom 当前在 Agent 和 Narrative 各取最近 100 条，并有明确 `ponytail` 注释要求未来增加 context-window policy。这个硬截断缺少：token budget、摘要、被排除范围诊断、恢复边界和 UI 可见性。

证据：LoomStudio `packages/application-runtime/src/runtime.ts:1874-1886`。

建议的 Loom 版本不应直接复制 Pulsar Schema，也不应把摘要实体命名为已被 Loom Workbench 使用的 `Context Projection`。它只是 Context Projection 可选择的输入，可以围绕现有身份设计为：

```text
History Summary Artifact
  projectionId
  sourceKind: agent | narrative
  sourceRange:
    entryIds / nodeIds / versionIds
  sourceDigest
  projectorId + projectorVersion
  content
  tokenStats
  status
  diagnostics
```

关键不变量：

1. canonical transcript / timeline 永不因压缩被改写或删除；
2. projection 必须绑定精确 source identity 和 digest；
3. Tool Invocation / Result、Changeset 或其他不可切断单元必须作为 range boundary；
4. 校验失败时不能静默使用陈旧摘要；
5. PromptBuild trace 必须说明哪些原始记录被哪个 projection 替代；
6. projector failure 不得阻止使用 raw context；
7. token budget、最近窗口和必须保留类型由正式 policy 决定。

Pulsar 当前 `sourceHash` 使用 32-bit FNV 风格非加密 hash，适合轻量变更检测，不适合作为 Loom 长期持久化完整性边界；Loom 应复用或引入稳定强 digest，并明确序列化 canonicalization。

证据：PulsarAI `conversation-memory.ts:825-835`。

Pulsar 文档声称任一校验失败时完整回退 raw，但当前实现只在创建压缩失败时整体回退；已存在的无效 Segment 会被静默过滤，frontier 仍可能混合其他有效摘要和 raw，且没有 validation diagnostic。这不一定产生错误 Context，但说明合同与实现尚未完全闭合。

证据：PulsarAI `Conversation/docs.md:34-36`；`conversation-memory.ts:210-229`、`:638-728`。

它还不是完整的 context-budget policy：没有目标 token budget、摘要后总 payload 上限、“摘要必须比原文小”的检查、按 Conversation 的数据库查询、失效 Segment GC，或并发摘要部分成功后的原子生命周期。某个并发任务失败时，本次调用会回退 raw，但同批其他任务可能已经写入 ready Segment，并在下次被采用。

证据：PulsarAI `conversation-memory.ts:210-231`、`:462-527`、`:592-635`、`:638-727`、`:825-848`。

---

## 14. Agent 失败、取消、恢复：Loom 不应退步

Pulsar 已处理：

- Assistant 空版本在模型调用前持久化；
- 生成异常转为持久可见的 error Message；
- reply 完成后拒绝迟到写入；
- Ask-user 关闭返回 cancelled；
- Tool 结果和本地步骤进入 `meta.steps`。

但当前未找到：

- Conversation generation 的正式 AbortController / stop API；
- 持久化 RunAttempt / run-state；
- crash repair / resume；
- Tool proposed / waiting-approval / running / result 状态；
- Invocation / Result 数据库配对不变量；
- 执行完成但结果未落库的恢复语义。

`generatingConversationIds` 只是进程内互斥集合。应用崩溃可能留下 `generateInfo.startTime` 存在、`timeUsed` 缺失的空白或部分 Assistant version，启动时没有恢复器。

证据：PulsarAI `conversation-store.ts:113-140`、`:197-239`、`:1177-1186`、`:1297-1313`；`default-agent.ts:82-126`。

Loom 当前 canonical transcript 已区分 provider observation、reasoning、tool invocation、tool result、run-state 与 synthetic reason，并在调用前持久化 Invocation、调用后持久化 Result。Pulsar 的 `steps` 更适合作为 UI projection，不足以替代这些运行事实。

这不表示 Loom 的 orphan repair、stream interruption 与 crash recovery 已经闭环；这些仍以 oh-my-pi Reference 中的 Agent Turn Integrity 专项审计为准。

证据：LoomStudio `packages/agent-store/src/types.ts:19-100`；`packages/application-runtime/src/agent/tool-loop.ts:356-475`。

因此 Loom 应借 Pulsar 的 Draft 和 Message version UX，但继续沿 oh-my-pi 对照文档中的 Agent Turn Integrity 路线补强流式半成品、orphan repair、abort race 和 Provider compatibility。

---

## 15. Database、Plugin 事务与跨领域一致性

Pulsar 的数据层不是简单的“SurrealDB 好或不好”，而是局部强、整体弱：

### 已做好的局部

- Plugin metadata 与扁平节点分表；
- 节点 ID 稳定，path/search 字段由完整树重建；
- 单个 Plugin 保存和删除使用 Surreal transaction；
- Plugin 节点循环与缺失关系在读取时显式失败；
- Backup v2 使用 SHA-256 + Zstandard 内容寻址对象；
- 选择性恢复和 portable archive 会一起 remap 关系 ID。

### 不能照搬的边界

- 通用 `selectAll/selectOne/upsert/remove(table,id,value)` 绕过 Feature 业务合同；
- Conversation 多记录修改不是事务；
- Plugin ID rename 先保存新 Plugin，再逐个更新 Package、Conversation、Message，最后删除旧 Plugin，跨领域不原子；
- 前端 Pinia Store 长期持有大量领域聚合并直接编排持久化；
- Secret 与普通业务数据共享同一 SurrealDB 实例和通用查询表面。

还存在几项具体的数据正确性缺口：

- `open_database()` 没有版本化 Schema、连续 migration、gap 检查或回滚；`migration.rs` 是外部文件导入器，不是数据库 Schema migration；
- `database_save_plugin()` / `database_delete_plugin()` 虽然发出 `BEGIN/COMMIT`，却没有像同文件 `database_upsert()` 一样检查 `response.take_errors()`；Secret set/clear/delete 也只检查 transport-level error，其中 `secret_set` 还是非事务的 `DELETE; CREATE`，存在旧值先删、新值创建失败却未被正确报告的窗口；
- Plugin 节点写入保存 `parent_id`，读取却不选择该字段，而根据 materialized `path` 重新推导父关系；
- 全局导入不阻断资源节点 ID 冲突，resolver 是 first-wins，数据库装配 HashMap 还可能变成后项覆盖前项；
- Plugin ID 被设计成可编辑顶层路径段，却又承担跨 Package、Conversation、Message 的稳定引用身份，导致 rename 成为非原子迁移。

证据：PulsarAI `Database/application/database-service.ts:9-29`；`plugin-store.ts:776-874`；`plugin-reference-resolver.ts:571-594`；`conversation-store.ts:957-1073`；`src-tauri/src/lib.rs:735-749`、`:797-807`、`:881-975`、`:1317-1341`、`:1438-1471`。

Loom 应继续让真实领域写入通过 owning Application API 与 shared SQLite Data Engine transaction，使用 Commit Fact 通知消费者；Extension 和 Tool 不能直接修改内部表。

---

## 16. Secret、Tauri 与桌面边界

### 16.1 Pulsar 已实现的产品能力

- Rust 代理模型请求，前端配置只保存 Secret placeholder；
- 桌面窗口、托盘、最小尺寸；Rust 托盘可恢复窗口和退出，但 ask/exit/tray 关闭策略 Store / Dialog 当前未接入标题栏关闭链，不能宣称“关闭到托盘”已闭环；
- Android / iOS 条件能力与 STT 准备；
- 共享 responsive store 将移动平台或 `<768px` 视为 mobile layout；
- TTS、STT、图片生成、系统通知、文件资源和子窗口原生桥。

这些说明作者对桌面/移动产品化有大量具体思考，但当前仓库没有移动生成工程、签名、安装 smoke、Release workflow、Updater 或更新源，只能说“做了源码准备”，不能说形成多平台交付闭环。

### 16.2 安全反例

1. Secret 以普通字符串存入 SurrealDB：`src-tauri/src/lib.rs:1166-1219`。
2. Rust proxy 会在 Header / UTF-8 Body 水合 `<<SECRET>>`，但对前端传入的任意 URL 发请求，没有 Secret-to-destination policy：`:1912-1963`。
3. `resource_delete_file` 对调用方路径直接 `remove_file`，没有 app resource root containment：`:1547-1551`。
4. Tauri CSP 为 `null`：`src-tauri/tauri.conf.json:24-26`。
5. `main` 与所有 `pulsarai-*` 子窗口共享宽 capability，可递归读写多个用户目录，并以任意 args 执行 Bun、Node、npm、npx、Git、PowerShell 和 cmd：`src-tauri/capabilities/default.json:3-6`、`:107-215`。
6. `backup_id` 未做绝对路径、`..` 或 canonical containment 校验，却直接参与 `dir.join()` 和 `remove_dir_all()`；Native command 可越出 Backup root 递归删除目录：`src-tauri/src/lib.rs:1627-1658`、`:1696-1703`、`:1720-1725`。

Loom 现有 Secret Store 使用系统 Keyring backend，并要求 owner、purpose 与 use context；Extension Host 不暴露 SQL、Kernel、Blob root 或任意文件目录。即使未来采用桌面壳，也必须从 Loom 的授权模型向 Tauri command / window capability 投影，而不是给所有 Webview 一组共享宽权限。

---

## 17. Backup、同步与可移植资源

Pulsar 的 Backup / Resource Archive 是值得产品研究、但不适合直接复制实现的部分：

- v2 snapshot 用 SHA-256 内容寻址与 Zstandard 对象去重；
- 保留 v1 directory backup 读取；
- full restore 通过 pending marker 在下次启动替换数据库；
- selective restore 的领域记录 copy 模式在冲突时 remap ID；历史备份中的物理资源文件仍可能覆盖当前同路径文件；
- package archive 携带 Conversations、Containers、本地 Plugin 和引用文件；
- copy / update 两种导入模式显式区分；
- LAN sync 用 device ID、版本向量、tombstone 和冲突副本合并；
- `secret` 表与 Backup 设置不是同步对象，但 Plugin content、消息正文和 component props 等自由内容没有敏感信息扫描或路径净化，不能保证凭据和本地路径绝不会进入同步 payload。

证据：PulsarAI `src/features/Backup/docs.md:1-82`。

可借鉴的不是 SurrealKV 文件复制，而是几个产品合同：

- disaster restore 与 selective resource restore 分开；
- copy 与 update 语义分开；
- stable ID 冲突必须显式处理；
- parent/child、branch/version 与引用资源一起 remap；
- portable archive 扫描序列化 payload 的全部字符串，只携带其中能解析为资源根内现存文件的 `file://` / 绝对路径；这是一种实用 Heuristic，不是 typed reference closure；
- merge 结果向用户报告冲突数量和处理方式。

Loom 当前正在形成 Extension data、portable payload、Card bundle 与 Asset 边界。Pulsar 可以作为导入/恢复 UX 的参考，但实际实现应继续使用 Loom Document / Asset / Blob / Extension owner 和 transaction 合同。

当前实现还有四个不能忽略的风险：

1. full backup 递归复制正在打开的 SurrealKV 文件，没有看到 flush、原生 snapshot、写冻结或 checkpoint 协调，源码不足以证明 crash-consistent；
2. full restore 先 rename 当前数据库，再复制备份，中途失败没有自动恢复旧目录；
3. selective import / update 边验证边逐项写 Package、Conversation、Container、Plugin 和文件，失败可留下部分导入；
4. 归档虽然做了相对路径 traversal 防护，但缺少总解压大小、单文件大小、文件数量和内容 digest 限制。

完整数据库备份还会复制含明文 Secret 的 SurrealKV 目录；Zstandard 是压缩，不是加密。Loom 的 Backup 设计必须显式决定 Secret 排除或独立加密合同，并使用 SQLite 一致快照、完整导入计划、Asset staging、canonical transaction 和失败补偿。

full restore 还会把旧数据库保留为 `surrealdb-before-restore-*`，成功后没有看到登记或清理；多次恢复可能长期留下多份旧 Secret 物理副本。

Pulsar 的 LAN Sync 更适合作为原型反例：监听 `0.0.0.0`、明文 HTTP、至少 6 字符 pairing key、完整资源快照传输；pairing key 与 remote password 存在 localStorage，版本向量也在 localStorage，数据库 mutation 与同步因果 metadata 不是原子事实。LAN peer 实际属于高信任可执行内容来源：POST snapshot 可以携带启用状态和可执行 Plugin JavaScript，没有 schema、签名或 peer identity。同步还使用进程全局 `remoteWriteDepth` 跨大量 `await` 标记远端写；并发本地写可能被误判为 remote 而跳过版本向量记录。Loom 当前没有必要引入这条维护与安全成本很高的路径。

证据：PulsarAI `src-tauri/src/lib.rs:295-507`、`:644-732`、`:1008-1149`、`:1571-1592`、`:1766-1908`；`Backup/application/backup-store.ts:44-67`、`:468-688`、`:981-1364`；`Database/application/sync-metadata.ts:15-95`。

---

## 18. SillyTavern 迁移：比许多表面功能更值得学的产品链

Pulsar 的 SillyTavern 迁移不是“读文件后直接写数据库”，而是一条分阶段管线：

```text
Reader: read-only scan
  -> Discriminator: confidence + evidence
  -> pure Converter: provenance + diagnostics + unconsumed fields
  -> previewable PlacementPlan
  -> exact plan commit, no implicit overwrite
```

证据：PulsarAI `src/features/Migrations/docs.md:3-17`、`SillyTavern/sillytavern-importer.ts:27-42`、`SillyTavern/pulsar-migration-writer.ts:45-114`、`SillyTavernMigrationSettingsPage.vue:49-189`。

这条产品合同很适合 Loom 的 Card、Prompt Resource、Extension portable payload 和外部项目迁移：

- Reader 保持只读，不边扫描边写；
- Discriminator 给出置信度和证据，不用文件名猜格式；
- Converter 是纯转换，保留来源、未消费字段与 Diagnostic；
- PlacementPlan 在提交前可预览、检查冲突和目标 owner；
- commit 精确执行已确认 plan，不隐式覆盖；
- copy / update / reject 冲突语义在计划阶段确定。

Pulsar 当前 writer 仍跨多个 Store 顺序写入，失败只做 best-effort 逆序补偿，不是统一事务；Loom 应把 plan validation 与 Data Engine transaction / Asset staging 结合。迁移 UI 的确认文案还声称宏“只保留诊断”，而 docs / converter 实际会转换部分简单宏与同步 EJS，属于可见文案与实现漂移。

---

## 19. 产品与 UI：可学取舍，不应误读成熟度

### 19.1 值得借鉴

- **Focus Mode（Loom 提案）**：Pulsar 已直接收束成单主体 Conversation，并不存在可切回完整 Studio 的可逆模式；对 Loom 的启发是可以在保留 Workspace 权威的前提下提供聚焦 Narrative / Agent 体验。
- **资产浮层**：当前角色 / Session 相关资源可以临时覆盖在内容旁，而不是永久占用布局。
- **设置壳层**：SettingsDialog 统一负责搜索、导航、标题、Tabs、移动抽屉和关闭；SettingPage 只负责内容滚动。
- **共享 responsive state**：平台与 viewport 汇总为一个 `isMobileLayout`，当前由设置、标题栏和部分 Plugin editor 等界面消费；可作为 Loom 统一窄窗口合同的参考，但不能写成全应用已完全统一。
- **后台完成通知偏好**：声音、系统通知和“仅后台”是长 Run 的低成本产品闭环。
- **Plugin 作者体验**：文件树、Convention editor、source mode、Container inspector、Manifest controls、测试 Conversation 比纯 JSON 配置更容易理解。

### 19.2 静态容量风险

Pulsar `AGENTS.md` 声称标准会话列表使用 TanStack 动态高度虚拟化，但当前 `ConversationStageThread` 对完整 `activePath` 直接 `v-for`。每项只使用 `content-visibility:auto` 与 intrinsic size；`@tanstack/vue-virtual` 虽在依赖中存在，源码零引用。

每条普通消息还会建立独立的只读 Milkdown Crepe / Provider。这是高置信容量风险候选，但没有长会话 profiling，不能写成已经测得卡顿。

证据：PulsarAI `ConversationStageThread.vue:183-193`、`components/ui/message-scroller/MessageScrollerItem.vue:40-49`、`ConversationMarkdown.vue:26-58`、`:97-105`。

`content-visibility:auto` 只减少离屏绘制，不减少 Vue component、DOM、Editor state、observer 或内存。Loom 应在真实长列表出现时使用真正 virtualization，并让普通历史消息采用轻量 Markdown renderer。

---

## 20. 文档、测试和交付治理

Pulsar 的 Feature 专题文档和根 `AGENTS.md` 记录了大量具体规则，这是优点；但当前存在明显“规范领先实现”和历史主设计索引漂移：

- `design.md` 仍指向已删除的 Workspace / Sidebar registry、Conversation Workspace、Plugin Workspace 和 Novel renderer；
- `rendererId` 仍在类型和 Store 中，但当前 UI 没有 renderer dispatch；
- Notification Store / API 可以被 Capability 调用，但没有可见 Notification Center / 内置通知列表 UI；常规回复完成走 external notification service，不显示或消费这些 internal records；
- `interactiveCodePreview` 被持久化，但当前 Stage Thread 没有向 Message content 传递；
- 根 `AGENTS.md` 声称动态 virtualization，源码没有实现；
- Conversation docs 声称不保存 child ID array，实际类型和操作仍使用 `availableNextContainer`；
- CodeAct instructions 要求 `agent.callExtension`，普通环境却删除该 API，实际 Skill / MCP 是独立 facade；
- Capability reference generator 排除了 `conversation` 和 `plugin` 两个不稳定 Feature。

还有多条“设置或 Store 存在，但正常启动消费链未接通”的事实：

- 自动备份只保存 `autoInterval`，没有 interval -> `createLocalBackup()` 调度；
- Backup Store 仅在打开版本管理页或 Agent capability 时初始化，AppShell 启动不恢复持久化的 LAN enabled，也不启动 pending poll；
- WebDAV create / restore 明确返回“后续接入”，密码仍随整个设置对象明文保存在 localStorage；
- Hotkey Store 可以录制映射，但没有全局 keydown dispatcher，快捷键不会触发命令；
- Schedule scheduler 只在用户首次打开定时任务 Dialog、挂载 `SchedulePage` 后启动，不是应用启动或 OS/background scheduler；
- About 自动更新开关只写 localStorage，检查始终显示未配置更新源；部分 General / Subscription 设置也是演示或占位 surface。

这些不是要求 Pulsar 立刻实现全部功能，而是提醒对照审计必须沿 UI control -> state -> producer -> consumer 反查，不能把“有设置项”当成能力闭环。

证据：PulsarAI `Backup/presentation/BackupSettingsPage.vue:84-90`、`:360-403`；`Backup/application/backup-store.ts:739-759`、`:893-901`、`:1379-1389`、`:1497-1536`；`Hotkey/application/hotkey-store.ts:43-65`；`UI/schedule/application/schedule-store.ts:41-56`、`:122-131`；`UI/schedule/presentation/SchedulePage.vue:43`；`ConversationStageHeader.vue:510-541`；`About/presentation/AboutSettingsPage.vue:10-27`。

MCP / Skill 也只能写成预留 seam，不能写成生态已完成：当前 registry 是一个进程内 `Map<source:name, tool>`，全仓没有实际 `registerAgentExtensionTool()` 调用，也没有持久化、发现、连接、权限、审批、timeout、abort 或 Session 生命周期。重复注册会直接覆盖，旧 disposer 仍可能删除新注册；调用时也没有看到输入 schema 验证。

证据：PulsarAI `Agent/application/agent-extension-registry.ts:1-91`；`conversation-generation.ts:216-217`、`:278-285`。

这说明“有很多文档”不等于“有单一事实源”。Loom 当前 Stable / Workbench 双轨是优势，但同样必须坚持：正式文档由当前入口、producer -> consumer 链和可执行验证反查；Discussion / Plan / AGENTS 不能单独证明实现。

工程交付方面，Pulsar 当前几乎没有自动测试，并缺少 CI、安装 smoke、Release、tag、License 和 contributor workflow。核心聚合文件包括 `src-tauri/src/lib.rs` 2079 行、`backup-store.ts` 1548 行、`conversation-store.ts` 1490 行、`plugin-store.ts` 1156 行、`useMessageScroller.ts` 1067 行、`plugin-reference-resolver.ts` 969 行和 `conversation-memory.ts` 849 行。Feature 自治与巨型 Store / Rust composition file 并存，Loom 不应为了模仿其产品广度而降低现有分层测试和可删除边界。

---

## 21. 建议的 LoomStudio 学习路线

### P1：合并到 Context Capacity / Agent Context Maintenance

1. 先让最近 100 条上限、被排除数量和 token 容量成为可见事实；
2. 明确 Agent Entry、Narrative Node、Tool pair 和 Changeset range boundary；
3. 使用 source identity + digest + projector version；
4. PromptBuild trace 显示 raw / summary 选择；
5. creation / validation failure 回退 raw；
6. 用最小 fixture 验证分支切换、Entry 追加、Tool pair 和摘要失效；
7. 在验证过 token-budget policy 后替换硬截断；在此之前把它保持为显式临时 fail-safe，而不是直接删除。

### P1：Runtime-owned Assistant Draft / Streaming

1. 定义 Draft identity、RunAttempt 和状态机；
2. Draft 只提供可见文本 / parts 的 append、replace 和流序列；finalize、fail、abort 由 Runtime 持有；
3. reasoning、provider observation、Tool 与 run-state 直接写 canonical transcript，再投影到 UI，不写第二份 Draft step；
4. 引入 chunk sequence、迟到写拒绝与 crash repair；
5. 打通 Provider -> Application -> RPC -> Client；
6. 复用现有 Agent Store 与 Commit Fact，不建 Conversation message 表。

### P1：能力与文档同源

1. 盘点 typed RPC、Extension SDK、Host capability、errors 和 introspection 的权威源；
2. 增加 effect、owner、grant、availability metadata；
3. 生成 Extension 作者 Reference；
4. 从本 Run effective grant 生成 Agent `readDocs()` 短投影；
5. CI / workspace check 比对声明与实际 runtime surface；
6. 不引入全开后 denylist。

### P1：Prompt Resource 显式依赖与作者体验

1. 在现有 SourceRef 上增加稳定 import / collection query；import 不绕过 Activation、权限或 Context Projection；
2. 区分候选资源、resolved、read、rendered 和最终进入 Prompt 的 Contribution，并记录 requester edge；
3. 缺失、循环、重复和冲突使用 machine-readable Diagnostic；
4. UI 支持资源树、Manifest/配置编辑、Container inspector 与 trace 跳转；
5. Extension Package 的资源贡献仍受 Package identity 和 Host capability 管理。

### P1 研究：先验证现有组合能力，再考虑 Generation Strategy

先验证 Agent Preset、Prompt Resource 与受信 Extension contribution 是否足以表达目标流程。只有存在真实、无法表达的场景时，才在 Workbench / Playground 研究新概念，不直接晋升 Architecture：

- Strategy 是声明式 plan 或受限 DSL，还是可信 Extension Module；
- 如何请求 PromptBuild，而不是自行拼最终字符串；
- 如何调用已注册 Provider / Tool，而不是直接拿 API Key / Store；
- 如何保存 Strategy version、PromptBuild trace、Run 和 Transcript；
- 如何按 Package / Module / Instance grant 限制策略；
- 只有尚未产生 Provider output、Tool execution 或 Mutation 时才允许回退官方策略；否则必须创建新的可见 Attempt，不能静默重跑副作用。

### P2：产品体验

- Narrative / Agent Focus Mode；
- 统一全局 Settings 壳层与可见入口；
- 共享窄窗口 / touch layout state；
- 长 Agent Run 的声音 / 系统通知 / only-background 偏好；
- Session list / reopen / branch candidate UX；
- selective restore / copy-vs-update 的产品研究。

### 与 oh-my-pi Reference 的路线合并

| Pulsar 课题 | 并入既有课题 |
|---|---|
| History Summary Artifact | Context Capacity / Agent Context Maintenance |
| Draft / Streaming | Provider Compatibility / Streaming + Agent Turn Integrity |
| Message regenerate / branch candidate | Session discovery / Agent Session branch UX |
| MCP / Skill seam | External Tool Boundary / Package Resource Skills |
| Run / Attempt 缺失 | Agent Turn Integrity / Agent Run Fact |
| Plugin 大文件与 Store 聚合 | Application Runtime modularization 的同类治理原则 |

Pulsar 真正独有、值得单独保留强调的，是用户可编辑的显式生成流程、target-bound 输出句柄、source-scoped import 与 Container 作者体验、Message version 派生状态、Capability 定义同源，以及 Focused Conversation + Plugin 创作界面。

---

## 22. 明确不做

- 不切换 SurrealDB、Tauri、Vue 或 Bun，只为追随竞品技术栈；
- 不用 `new Function` / `with` 建立不可信 Extension 或模型代码安全边界；
- 不向 Agent 或 Extension 暴露通用 table API、SQL、Kernel、Store 或可变领域对象；
- 不把所有 Tool 收敛成唯一 CodeAct；
- 不让 Plugin 脚本绕过 PromptBuild、Tool Registry、Transcript、Secret 和 transaction；
- 不把可执行 JS source 保存为 Loom canonical state mutation log；
- 不把 Conversation Container tree 替换 Narrative Timeline 和 Agent Session；
- 不因 bundle 配置存在就宣称桌面/移动交付完成；
- 不复制宽 Tauri capability、任意 URL Secret proxy 和任意路径删除命令；
- 不在没有 profiling 时宣称 UI 已经卡顿，也不把 `content-visibility` 当 virtualization；
- 不为了显得成熟而预建完整 Marketplace、LAN sync、Updater 或多媒体 Provider 集合。

---

## 23. 开放问题

以下问题需要单独方案或运行时验证，本文不替代决策：

1. Loom 的可编辑 Generation Strategy 应是声明式数据、可信 Extension Module，还是仅限 Playground 的脚本？
2. Assistant Draft 是否进入 Agent Store，还是由独立 ephemeral/run projection 保存后 finalize 成 Entry？
3. Context projection 先覆盖 Agent Session，还是同时覆盖 Narrative；二者是否共享 projector interface？
4. Message version candidate 应属于 Agent Entry、Step 还是 UI-only selection？
5. branch-local 派生状态是否有明确的角色扮演 / 模拟场景，足以支持新增结构化 operation log？
6. Plugin Resource 的 Container 查询应映射到 Prompt Resource collection、Extension contribution，还是新的只读 query facade？
7. Focus Mode 是否只隐藏布局，还是需要独立 Router route 和可恢复面板快照？
8. Backup copy/update 语义如何与 Document、Asset、Extension portable payload 和 Changeset 对齐？

---

## 24. 证据索引

### PulsarAI

- 生成链：`src/features/Resources/Conversation/application/conversation-store.ts`、`conversation-generation.ts`
- 内置生成流程：`src/features/Resources/Plugin/builtIn/core/generate.js`
- Agent / CodeAct：`src/features/Agent/application/default-agent.ts`、`code-act.ts`
- Sandbox：`src/features/Sandbox/domain/sandbox.ts`、`sandbox-globals.ts`
- Capability：`src/features/Capabilities/application/capability-registry.ts`、`domain/capability.ts`
- Plugin 解析：`src/features/Resources/Plugin/application/plugin-reference-resolver.ts`
- Plugin 持久化：`src/features/Resources/Plugin/application/plugin-store.ts`、`src-tauri/src/lib.rs`
- Conversation / Memory：`src/features/Resources/Conversation/domain/conversation-types.ts`、`application/conversation-memory.ts`
- Database / Secret / Tauri：`src/features/Database/`、`src/features/ModelConnection/`、`src-tauri/`
- Backup：`src/features/Backup/docs.md`、`application/backup-store.ts`
- 产品 UI：`src/features/UI/presentation/AppShell.vue`、`ConversationStageOnePage.vue`、`ConversationStageThread.vue`
- 工程：`package.json`、`README.md`、`design.md`、`AGENTS.md`

### LoomStudio

- PromptBuild：`packages/application-runtime/src/agent-turn.ts`、`docs/architecture/application/prompt-build/`
- Agent transcript / Tool Loop：`packages/agent-store/src/types.ts`、`packages/application-runtime/src/agent/`
- Context 临时上限：`packages/application-runtime/src/runtime.ts:1874-1886`
- Data Engine / Commit Fact：`packages/data-engine/`、各领域 Store transaction
- Secret：`packages/secret-store/`
- Extension：`docs/architecture/extensions/README.md`、`packages/extension-sdk/`
- 相关外部参考：`docs/workbench/reference/oh-my-pi-architecture-and-engineering-reference.md`
