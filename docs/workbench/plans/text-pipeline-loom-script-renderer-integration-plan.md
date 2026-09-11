# Text Pipeline、Loom Script 与 Renderer 集成计划

> **Status**：Implemented / Automated Verification Complete / Objective Browser Diagnostics Complete
> **日期**：2026-09-11
> **授权范围**：用户已确认资源 Owner 编辑与最终组合检查并存、组合顺序覆盖、`mark` Match、统一单文件 Loom Script Metadata、数据库索引、Mount / Grant、沙箱 Renderer、Extension 就地检查与一次性端到端实施方向。
> **Successor of**：[`history-text-pipeline-contextual-ui-and-effective-rules-plan.md`](./history-text-pipeline-contextual-ui-and-effective-rules-plan.md)

## 目标

完成一条可追踪、可导入导出、可安全卸载的正文处理与渲染链：

```text
Canonical Narrative / Agent Message
  -> Effective Text Pipeline
  -> ordered Rule execution
  -> Match Record / Extraction Artifact
  -> sandboxed Loom Script Renderer Contribution
  -> existing Renderer Surface Host
```

作者可以在 Card / Preset 等资源工作台中编辑本 Owner 的声明，也可以在专门面板中查看当前有效组合并直接编辑其中可写来源；两种入口复用同一套 Detail、保存路径和权限判断。轻量脚本通过 `.loom.js` 顶部 Metadata 获得稳定身份、导入导出、索引、挂载、启停、授权、版本和诊断能力，而不需要建立完整 Extension Package。

## 已确认事实

- History Text Pipeline 当前只处理 Narrative History 与 Agent Session History，Canonical 内容不被 Projection 覆盖；正式合同位于 [`docs/architecture/application/history-text-pipeline.md`](../../architecture/application/history-text-pipeline.md)。
- Runtime 已有唯一 `resolveEffectiveTextPipeline` 装配路径；Card Rule / Extractor 随 Timeline Runtime Context 固化，Preset 根据消费 Agent 解析，单次 Agent Run 内规则冻结。
- `TextTransformRule` 当前支持 `replace` 与 `promote-reasoning`；`TextMatchRecord` 还没有稳定 `matchId`，也没有区分输入与 Display Projection 坐标。
- Client SDK 已声明 `match-ref` / `marker`，但当前消息宿主只解析 literal selector，尚未接入正式 Match / Marker 数据源。
- Client Renderer Host、Surface 仲裁、Scope 实例、Direct / Shadow / sandbox iframe Adapter、Module reload / dispose 已实现；完整合同位于 [`docs/architecture/extensions/client-renderer-host.md`](../../architecture/extensions/client-renderer-host.md)。
- 当前 Client Extension Module 是受信任的同源 JavaScript。Shadow Root 只隔离样式，不能限制脚本访问 Host DOM、Storage 或网络。
- Extension Manifest v2 已提供 Package / Module / Contribution 静态声明；Client Module 通过 `activate(ctx)` 注册 Manifest 中声明的 Renderer。
- Blob Store 已提供内容寻址原始字节持久化，Document Store 已提供 typed Document、Revision、CAS、Changeset 与共享 SQLite 事务基础。
- 当前角色资源与预设工作台分别嵌入 Owner-only 文本管线编辑器；Rail 文本管线只承担 Runtime Inspector。这是上一版 Plan 的实现，不是继续保留的目标结构。

## 已确认决策

### 1. 同一资源使用 Owner 与 Effective 两种目录投影

- Card / Preset 资源工作台保留宏与文本管线入口，Master 只列当前 Owner 声明的 Macro、Rule 与 Extractor，适合资源创作、导入导出和局部维护。
- Macro 专门面板按当前 Prompt Build 上下文展示最终宏注册表；Text Pipeline 专门面板按当前 History / Agent 上下文展示最终 Rule 执行序列、Extractor、Match、Artifact 和 Renderer 消费关系。
- 两类入口必须复用相同的 Macro / Rule / Extractor Detail 组件、保存 API、CAS、草稿隔离和权限判断，不能维护资源版与最终版两套编辑器。
- Master 决定资源的组织视角，Detail 根据条目的真实 Owner 和 Runtime 状态决定可编辑性。Card、Preset、Workspace 来源可编辑；Extension、Builtin 和冻结快照只读。
- 来源用于 provenance、可写权限、筛选和标签。Effective Rule Master 不按来源分组，避免破坏真实执行顺序；Macro Effective Master 按宏名聚合候选，不伪造执行顺序。
- Extension-owned Rule / Extractor / Renderer / Script 在 Extension 详情中就地只读检查；完整运行冲突和顺序仍进入对应的 Macro / Text Pipeline 专门面板。
- 从任一资源或 Extension 入口进入专门面板时携带 Owner 与可选运行上下文，并定位到同一个 Detail，不复制数据或组件状态。

本 Plan 不改变 Macro 求值语义，也不把当前“Provider 返回字符串是否继续展开”晋升为长期合同。Macro 专门面板只复用当前 Runtime 的实际结果，展示最终名称、候选来源、选择结果和构建引用记录；宏嵌套、动态 Provider 的 `get / expand` API 与循环诊断另行决策，不得由本 Plan 的 UI 或 Script Worker 顺手实现。

同名 Macro 候选的来源选择在首版保持当前运行上下文的临时输入：传入 Inspector、Prompt Preview 与随后发起的 Run，切换上下文或重新载入后可以丢失。编辑某个可写候选仍直接保存其真实 Card / Preset / Workspace Owner。当前没有获批的持久 `MacroOverride` Document，本 Plan 不新增。

### 2. 作者建议顺序与运行组合覆盖分离

- 保留现有 `orderIndex` 字段，语义明确为作者的 `suggested order`，不为改名迁移现有 Document。
- 默认 Effective Order 继续使用 `orderIndex -> stable rule ID`。
- 当前 Narrative / Agent Session 组合可以保存 `TextPipelineOverride`，只表达禁用集合和显式 Rule ID 顺序，不修改 Card、Preset 或 Extension 原始资源。
- Override 中已知 Rule 按保存顺序排列；新出现或未列出的 Rule 按默认 Effective Order 稳定追加。
- Override 只影响对应 Source、Phase 和可选消费 Agent，不成为可移植作者资源。
- 正在执行的 Agent Run 不接受中途顺序变化；修改在下一次 Run 冻结时生效。

候选最小合同：

```ts
type TextPipelineOverrideContent = {
  source:
    | { kind: 'narrative'; timelineId: string; branchId: string }
    | { kind: 'agent-session'; sessionId: string }
  phase: 'classify' | 'prompt' | 'display'
  consumerAgentSessionId?: string
  disabledRuleIds: string[]
  orderedRuleIds: string[]
  createdAt: string
  updatedAt: string
}
```

`headEntryId` 不参与 Override 身份，避免每次 Agent Session Head 变化产生新配置。

### 3. `mark` 是 Renderer Anchor，不修改正文

新增 Effect：

```ts
type TextTransformRuleEffect =
  | { kind: 'replace'; replacement: string }
  | { kind: 'promote-reasoning'; /* existing fields */ }
  | { kind: 'mark'; markerType?: string }
```

`mark` 只产生 Match Record。它不改变 Display Text、Prompt Text 或 Canonical Text。Renderer 可以通过 `match-ref` 在 Match 前后挂载，或用 UI 替换对应 Display Range。

`TextMatchRecord` 至少增加：

```ts
type TextMatchRecord = {
  matchId: string
  ruleId: string
  ruleVersion: number
  entryId: string
  depth: number
  stepIndex: number
  occurrenceIndex: number
  inputRange: { start: number; end: number }
  displayRange?: { start: number; end: number }
  match: string
  captures: Array<string | undefined>
  namedCaptures: Record<string, string | undefined>
}
```

- Range 使用 JavaScript 字符串与 RegExp 一致的 UTF-16 code-unit offset，不混用 Unicode code point 或 UTF-8 byte offset。
- `matchId` 至少由 Source、Phase、Entry ID、Rule ID / Version、Step、Occurrence 与该步输入摘要确定性生成，不能使用随机数、时间戳或异步完成顺序。
- `inputRange` 属于该 Rule 实际接收的中间文本；`displayRange` 只在最终 Display Projection 仍能无歧义映射时存在。
- Pipeline 在后续 `replace` 执行时维护最小区间映射：发生在 Match 前方且不重叠的替换只平移 Range；发生在后方的替换不影响 Range；与 Match 重叠或跨越其边界的替换使 `displayRange` 失效。不得用重新搜索相同文本猜测位置。
- `match-ref` 只能使用带 `displayRange` 的 Match。映射丢失、缺失或多义时生成 Diagnostic，并按 Renderer fallback 保留安全正文。
- `marker` selector 继续保留为正式类型，但本 Plan 不建立另一套持久 Marker Store；没有真实数据源时不得伪造支持。

### 4. Extractor Artifact 是瞬时类型化结果

- Extractor 可以声明可选 `artifactType`；成功结果形成带来源、Extractor ID、版本、stale 状态和 JsonValue 的瞬时 Artifact。
- Artifact 不进入新的永久 Store，不覆盖 Extractor Result，也不成为 Canonical History。
- Artifact 在已冻结的 Source / Phase / Effective RuleSet Projection 上按需生成；同一 Inspection 或 Renderer 请求内可以复用，跨请求不建立隐式缓存权威。
- `latest-valid` Artifact 关联实际命中的 Source Entry；`all-matches` 保留每个值与 Source Entry 的对应关系，Renderer 不靠数组位置猜挂载对象。
- Renderer 可以按 `artifactType` 消费 Artifact；同一类型存在多个候选时沿用 Renderer Registry 的稳定来源与冲突诊断，不按异步完成顺序取胜。
- 私有 Extension 仍可读取官方 Projection 后自行解析；不强制所有代码注册中央 Extractor。

### 5. Loom Script Metadata 是统一单文件 Manifest

首版只识别显式导入、Bundle Manifest 引用或 Dev Workspace Codec 投影的 `.loom.js`。不得因为目录中出现普通 `.js` 就自动注册或执行，也不按 Macro / Renderer / Lifecycle 等业务用途建立 Script 类型体系。

```js
// ==LoomScript==
// @format       1
// @id           alice.presentation
// @name         爱丽丝展示逻辑
// @version      1.0.0
// @runtime      client-sandbox
// @capability   state.read
// @contribution {"kind":"renderer","id":"status-panel","surface":"narrative.entry.inline","scope":"node","inputs":["match:alice.status-block"]}
// ==/LoomScript==
```

首版规则：

- 必填：`@format`、`@id`、`@name`、`@version`、`@runtime` 与至少一个 `@contribution`；不存在文件级 `@kind`。
- `@contribution` 可以重复；一个 Script Definition 可以集中声明多个相关 Contributions。首版 Runtime 只接受 `kind: "renderer"`，这是已实现能力限制，不是 Script 分类。
- Renderer Contribution 必须静态声明自己的 `id`、`surface`、`scope` 与 `inputs`；`inputs` 首版只允许 `match:<ruleId>` 与 `artifact:<artifactType>`。
- `@runtime` 首版只允许 `client-sandbox`。需要同时运行 Server 与 Client、需要多文件 / 依赖或后台生命周期的代码应升级为 Extension，不把两种 Realm 塞进一个 standalone Script。
- `@capability` 可以重复，只表示请求，不表示用户已经授权。
- Metadata 外层采用受限逐行键值语法；只有 `@contribution` 值使用标准 JSON Object 解析，不引入 YAML 或 JavaScript AST Parser。
- 未知 `@format`、重复单值字段、非法 ID、非法 Surface / Scope / Input、重复 Contribution ID 均明确拒绝导入。
- 导入阶段不执行 Script，也不猜测 JavaScript 导出。Metadata 与实际模块导出不一致只能在首次激活时标记 degraded 并产生 Diagnostic，不能伪装成导入期静态验证。
- 未识别但格式合法的普通注释保持在源码 Blob 中；它们不进入运行索引。

Loom Script 与 Extension Manifest 平级承担静态发现，但不是 Extension Package：

```text
Extension manifest.json
  -> Package declarative Contributions
  -> minimal runtime Modules -> many runtime Contributions

Single .loom.js Metadata
  -> one Script Definition -> one or more supported Contributions
```

#### Extension Module 粒度是建议，不是功能分类

Module 是 Extension 内的代码入口、Runtime、Grant 与启停 / Reload / `activate` / `dispose` 生命周期边界，不等同于独立进程、Worker 或安全沙箱。Contribution 可以是 Package 级纯声明资源，也可以是 Module 激活后注册的运行能力：前者通过正式导入成为带 Package provenance 的普通资源，直到显式移除或禁用；后者才随 Module 生命周期。不得为了挂载一条静态 Rule、Prompt Resource 或其他无需执行代码的资源创建空 Module。

静态 Rule 即使引用未来由 Module 注册的自定义 Matcher / Transformer，也仍然是 Package 资源；Module 不可用时该 Rule 保持可检查但处于 unresolved，并产生 Diagnostic，不删除资源或偷偷退回其他实现。本 Plan 只实现内置 Regex / Effect 与 Renderer 门控，不顺带增加自定义 Matcher / Transformer Runtime。

推荐一个 Package 保持最少 Module：同一 Runtime、权限集合和启停生命周期的相关运行能力放入同一个 Module，由它注册多个 Contributions。只有 Server / Client Runtime 不同、确需独立启停或 Reload、权限集合明显不同，或者存在真实的独立故障与生命周期价值时才拆分。该规则是作者与内置 Extension 的简化建议，不把合理的多 Module Package 判为非法。

未来若引入 Worker 或独立进程隔离，由 Host 的部署与安全策略决定执行拓扑，不建立“一 Module 一进程”的合同。当前同源 Client Module 和 Server Module 也不得仅凭 Module 边界宣称恶意代码隔离。

### 6. 数据库是权威，文件是可往返投影

新增 Document Type：

```text
airp.loomScript
airp.loomScriptMount
airp.textPipelineOverride
```

最小 Script Definition：

```ts
type LoomScriptContributionDefinition = {
  kind: 'renderer'
  renderer: RendererContributionDefinition
  inputs: Array<
    | { kind: 'match'; ruleId: string }
    | { kind: 'artifact'; artifactType: string }
  >
}

type LoomScriptContent = {
  owner:
    | { kind: 'workspace'; workspaceId: string }
    | { kind: 'card'; cardId: string }
    | { kind: 'preset'; presetId: string }
    | { kind: 'user' }
  formatVersion: 1
  metadataId: string
  scriptVersion: string
  name: string
  runtime: 'client-sandbox'
  contributions: LoomScriptContributionDefinition[]
  requestedCapabilities: string[]
  source: {
    blobId: string
    mediaType: 'text/javascript'
    fileName: string
  }
  sourceDigest: string
  createdAt: string
  updatedAt: string
}
```

Document ID 是应用内部身份；Metadata `@id` 是 Owner 内稳定的作者身份。不同 Card / Preset 可以携带相同 Metadata ID，不能因此争抢同一个 Document。Runtime 与 Registry 使用 Document ID、Document Version 和 Contribution ID 组成稳定身份。

Script Source Blob 保存包含 Metadata 的 byte-exact 文件。导入时一次解析 Metadata 与源码，并在同一 Application Mutation 中提交 Blob 引用和 Script Document；不得先建立半成品索引再异步补源码。

Studio 编辑 Metadata 字段或源码后，Apply 必须重新生成完整 Source Blob，并同时提交 Definition Revision；数据库索引字段与 Source Header 冲突时拒绝 Apply，不建立双权威静默覆盖。导出直接返回该 Revision 的 byte-exact `.loom.js`。

#### Card / Preset 可移植关联必须首版闭环

Card Bundle 与 Preset Prompt Resource Artifact 增加可选 Script Attachment。Attachment 只携带 `.loom.js` 文件名、源码和作者建议顺序，不携带本机 Grant、运行时启用状态、Diagnostic 或内部 Document ID。

- Card Bundle Artifact 升级为 schema v3，继续接受 v2；Preset Prompt Resource Artifact 升级为 schema v2，继续接受 v1。数据库 Document 不做批量迁移。
- ZIP Card Bundle 将 Attachment 源码保存为真实 `.loom.js` 文件并由 Manifest 引用；JSON / PNG 投影可以保存等价字符串内容。
- 导入 Attachment 时按目标 Owner 创建新的 Definition 与 Mount；所有 Mount 默认禁用且无 Grant。同一 Owner 内 Metadata ID 冲突且 Source Digest 不同必须明确报错，不覆盖现有源码。
- 导出 Card / Preset 时只收集该 Owner 明确挂载的 Script Revision；Workspace / User Script 不被偷偷打入资源包。

### 7. Mount、启用和 Grant 是独立事实

```ts
type LoomScriptMountContent = {
  target:
    | { kind: 'workspace'; workspaceId: string }
    | { kind: 'card'; cardId: string }
    | { kind: 'preset'; presetId: string }
    | { kind: 'user' }
  scriptDocumentId: string
  enabled: boolean
  orderIndex: number
  pinnedDocumentVersion?: number
  grantedCapabilities: string[]
  origin: JsonObject
  createdAt: string
  updatedAt: string
}
```

- 独立导入成功只创建 Definition；附着在 Card / Preset Artifact 中的导入同时创建对应 Mount。所有新 Mount 默认 `enabled = false`，Capability 默认空集合。
- 有效 Capability 为 `requested ∩ granted ∩ runtime policy`。
- Card Script 随 Card 分发；进入 Timeline 时将 Script Document ID、Document Version、source digest、Contribution IDs 与 Mount 配置固化到 Runtime Context。
- Preset Script 只对使用该 Preset 的 Agent Session 生效；Workspace / User Script 可以跨角色挂载。
- Timeline 和 Agent Session 允许临时启停已挂载 Script，但不成为新的源码 Owner，也不改写作者 Mount。
- Runtime Scope 建立时解析并固定确切 Script Revision。作者保存新版本不会静默替换当前实例；显式 Reload / Update 先 dispose 旧实例，再以新版本重建。
- 新版本通过 Metadata、大小和持久化边界校验后保存为新 Revision；JavaScript 语法、模块导出和运行错误在首次 activate / mount 时标记 degraded，不自动回写旧源码。用户可以读取 Diagnostic 或显式 Revert。

### 8. Standalone Script 不是伪 Extension

Renderer Registry 的 Contribution Owner 扩展为显式联合类型：

```ts
type RendererContributionOwner =
  | { kind: 'extension'; packageId: string; moduleId: string }
  | { kind: 'script'; scriptDocumentId: string; documentVersion: number }
```

Registry 稳定 key 还必须包含 Contribution ID。禁止通过 `packageId = "script:<id>"` 等合成 Extension Package 身份复用旧字段。

Extension Client Module 继续使用 Manifest + `activate(ctx)`。Loom Client Script 模块使用受限静态导出，例如 `renderers: Record<contributionId, LoomSandboxRenderer>`；Host 只选择 Metadata 已声明的 Contribution ID。缺失、重复或额外运行注册产生 Diagnostic，不能动态获得 Metadata 未声明的 Renderer、Command、Macro 或 Tool。

### 9. Loom Renderer Script 使用独立沙箱

- Standalone `.loom.js` 不进入现有同源 Client Extension Module loader。
- 只有 Contribution 实际命中可见 Surface 时才创建 Renderer UI Instance；禁用、未命中或不可见的 Script 不保留常驻 Host。一个 Script Definition 可以服务多个 Renderer Contributions，但不等于创建多个进程。
- 每个活跃 Renderer UI Instance 由 Host 创建 `sandbox="allow-scripts"`、不含 `allow-same-origin` 的 iframe；首版不引入 iframe Pool，也不把 Script Definition、Contribution 和 iframe 数量绑定成长期合同。
- Host-owned bootstrap 通过 MessageChannel 发送序列化 Context；脚本不能获得 Host object、React Root、DOM reference、Storage、Cookie 或任意 RPC facade。
- iframe CSP 默认 `default-src 'none'`、`connect-src 'none'`；允许执行 Host 提供的 Blob Module，并允许 iframe 内部样式。网络能力不在首版 Capability 中。
- 首版不提供 `direct`、`shadow` 或“用户点选信任后同源执行”的 Trusted Script Mode。
- `state.read` 只通过 capability-checked message bridge 返回复制的 Snapshot；不提供 State write、任意 Application RPC、Extension private records 或本机文件。
- `match` / `artifact` /当前 Renderer Scope 由 Host 主动推送，不允许脚本旁路扫描其他 Timeline 或 Agent Session。
- Scope 关闭、版本 Reload、Mount 禁用、Card / Preset 切换和页面卸载必须 abort 请求、断开 Channel、撤销 Blob URL 并移除 iframe。
- Script 异常只使当前 Contribution / Instance degraded；正文使用声明的安全 fallback，Studio Shell 不被卸载。

### 10. 日志与审计控制体积

持久化记录：

- Definition / Source Revision 与 Changeset；
- Import、Mount、Enable / Disable、Grant 变化和版本 Reload；
- activate、mount、update、bridge 调用的失败 Diagnostic；
- 实际使用的 Script Document ID、Metadata ID、Document version、source digest、Scope 与 Contribution key。

不持久化：

- 每次成功 render / update；
- iframe 内普通 `console.debug` 的无限流；
- DOM、HTML 快照或完整 State Snapshot。

运行 Inspector 可以展示当前实例、最近 Diagnostic 和内存态日志；持久日志必须服从现有日志级别、大小和敏感信息边界。

## UI 设计合同

### 专门 Macro / Text Pipeline Workbench

主 Agent 在现有开发预览入口先实现可复用 Master 与 Detail 草稿；生产入口、资源入口和专门面板复用同一 Detail 组件，不根据截图重新实现。由于用户已授权端到端实施，不增加新的形式化审批暂停；最终主观视觉验收仍由用户完成。

Macro 专门面板 Master：

- 只展示当前 Prompt Build 上下文实际参与解析的 Builtin、Workspace / User、当前 Card 快照、当前 Preset 和已启用 Extension Provider；
- 不混入其他未启用 Card、Preset 或 Extension 的宏；需要查看其他资源时必须显式切换资源上下文；
- 按宏名聚合，显示当前结果、候选数量、选中来源、冲突、求值错误和实际构建是否引用；
- 不显示虚假的顺序编号。实际引用记录按 Prompt Resource Node 与文本出现位置展示，和宏注册表分开；
- 选择某个候选后进入统一 Macro Detail；可写静态来源直接编辑原资源，动态 Provider、Builtin、State Path 和冻结快照只读；
- 同名来源选择仍属于当前运行组合，不写回 Card / Preset 作者配置。

Text Pipeline 专门面板 Master：

- 当前上下文：Narrative / Agent Session、消费 Agent / Preset、Phase；
- 最终 Effective Rule 执行顺序，不按来源分组；
- 每行显示顺序、名称、Owner、Phase、Effect、启用与冲突状态；
- Extractor、Renderer Script 与 Extension Renderer 作为同一执行链的后续消费者区段；
- 支持搜索与 Owner / Effect / 状态筛选，但筛选不改变真实执行顺序。

Detail：

- 可写 Owner 显示结构化编辑；Extension 和 Runtime Snapshot 只读；
- 同时显示 Source Definition version 与当前 Runtime Snapshot version；
- 当前规则的输入、Match、输出、下游 Extractor / Renderer；
- `orderIndex` 表示作者建议顺序；跨来源拖动写入当前 TextPipelineOverride；
- Card Source 保存不静默改写当前 Timeline Snapshot；提供草稿 Dry Run，并将“更新当前 Timeline Snapshot”作为显式 Changeset 操作。

底部 Preview：

- 选择一个真实 Entry 或本地样例；
- 展示 Canonical、逐 Rule 中间结果、最终 Display、Match / Artifact 与 Diagnostic；
- 只把可复现的相同顺序、重叠 Display Range、无效 Match mapping、缺失 Consumer 标为冲突；不以“两个 Regex 看起来相似”伪造静态冲突判断。

移动端：

- 复用现有 Master–Detail 下钻；
- Context / Rule 列表 → 单项 Detail → Preview；
- Detail 和 Preview 各自拥有完整高度与滚动区域，不在右侧再嵌套完整管理面板。

### Card / Preset / Extension 入口

- Card / Preset 资源工作台保留 Macro 与 Text Pipeline Tab；Macro Master 只列本 Owner 的静态宏，Text Pipeline Master 只列本 Owner 的 Rule / Extractor，并允许新增、删除、排序和编辑。
- 资源入口与专门面板使用同一个 Macro / Rule / Extractor Detail。资源页不得再拥有独立 JSON Editor、独立草稿状态或独立保存实现。
- 资源入口可以显示当前 Owner 的 Macro、Rule、Extractor、Script 数量与运行快照提示，并提供定位到专门 Effective 面板的次级操作。
- Extension Workbench 左侧先列 Package 级声明资源，再列 Module 与其运行 Contributions；点击 Rule、Extractor、Renderer 时右侧就地展示真实 Owner、注册、启用、权限和 Diagnostic，不伪造静态资源的 Module 归属。
- Extension 详情提供次级操作进入中央 Runtime Pipeline，查看它在当前组合中的真实顺序和 Match，不复制一套运行检查器。
- Workspace / User 作者资源可以从专门 Macro / Text Pipeline Workbench 创建；Settings 不保留第三套独立 JSON CRUD 面板。

### Loom Script 作者视图

- Text Pipeline 专门面板提供 Script 列表与单脚本 Detail；列表不按 Renderer / Macro 等业务类型分类，Detail 内展示该 Script 声明的 Contributions。Owner、当前 Context 和输入绑定清晰可见。
- Detail 包含 Metadata 字段、Contribution 列表、JavaScript Source、Mount、请求 / 已授予 Capability、当前版本、按需运行实例和 Diagnostic。
- Metadata 与 Source 可以在 Studio 内查看和少量编辑；主要工程化编辑路径仍是 `.loom.js`、Bundle 与未来 Dev Workspace。
- 导入、导出、复制、删除、启停与 Reload 使用现有按钮、图标、确认和 Toast 约定，不创建平行 Shell。
- 长源码和 JSON 使用 `surface-subtle` 色块，短文本使用现有细线输入；列表和详情不使用嵌套卡片。

## 非目标

- Agent 可调用 Script、Inline CodeAct、Saved CodeAct 或 Script Transcript；
- `beforeTurn` / `afterTurn` / State Trigger / Event Hook 等生命周期脚本；
- Server Script、Trusted Node、同源 Trusted Client Script；
- 任意网络、任意 Application RPC、State write 或本机文件权限；
- NPM 依赖安装、相对 JS import、多文件 Script Package 或构建工具链；
- Marketplace、在线更新、签名、Git Package Source 或 Extension 依赖求解；
- 通用 Dev Workspace watch、双向实时同步或文件冲突合并；
- 建立永久 Artifact Store、Marker Store 或第二套 Runtime Store；
- 将普通 `.js` 自动识别为可执行内容；
- 修改 Macro Provider 求值、嵌套展开、循环处理或动态 `get / expand` API；
- 新增持久 `MacroOverride`、跨设备同步 Macro 冲突选择或把选择写回作者资源；
- 重写 Canonical Narrative、Agent Message 或已有 State / Macro 语义。

## 工作包与文件边界

### 执行拓扑

```text
WP0 Contracts + reusable UI prototype
  -> WP1 Text Pipeline bridge
  -> WP2 Script persistence + portable codecs
  -> WP3 Sandbox Renderer Host
  -> WP4 Extension contribution lifecycle + inspection
  -> WP5 Production UI integration
  -> WP6 Example + Architecture + final ledger
```

工作包按上述顺序执行。虽然部分领域逻辑上可以并行，但 WP1 / WP2 共享 Application Runtime 导出，WP3 / WP4 共享 Renderer 与 Extension 身份，WP5 又依赖全部真实 API；在当前共享且已有未提交修改的工作区中强行并行会增加合同漂移和覆盖风险。每个 WP 完成定向验证并记录实际导出后直接进入下一 WP，不增加新的产品审批暂停；触发本 Plan 停止条件时除外。

公共 DTO、Document Type、Runtime facade、Registry Identity 与 Client API 的最终合并由主 Agent负责。执行者不得重置工作区、覆盖其他未提交修改，或在 Client / Runtime 各自复制一份近似类型。

### WP0：公共合同与 UI 样板

**负责人**：主 Agent。

**目标**：冻结 Match、Artifact、Override、Script Definition / Contribution、Portable Attachment、Mount、Renderer Owner、Loom Client Script Module Export 和 Sandbox Protocol 的最小公共合同；在现有开发预览入口制作 Owner Master、Macro Effective Master、Text Pipeline Effective Master 与统一 Detail 草稿。

**允许修改**：

- `packages/extension-sdk/src/index.ts`
- `packages/application-runtime/src/types.ts`
- `packages/application-runtime/src/foundation/document-types.ts`
- `packages/application-runtime/src/transforms/history-text.ts`（仅公共类型；行为属于 WP1）
- 新的 `packages/application-runtime/src/scripts/` 类型合同文件
- Client 开发预览入口及新的纯展示组件文件
- 本 Plan 中的实际路径勘误

**禁止修改**：Runtime 行为、Server RPC、正式 UI 数据接线。

WP0 只添加能够独立编译的合同。`TextMatchRecord` 与现有 Renderer Registry Identity 这类需要行为同步迁移的破坏性变更，分别由 WP1 / WP3 在同一工作包内完成，不能为了形式上的“先导出类型”留下半编译状态或临时双写。

**完成条件**：后续 Worker 可以从已导出的增量类型、Plan 中冻结的迁移后类型和真实展示组件开始，不需要重新决定 Document ID / Metadata ID / Contribution ID、Artifact Range、两种目录投影、统一 Detail、宽高、移动端下钻或安全协议。

**实施结果（2026-09-11）**：已增加 Loom Script / Mount / Attachment、Renderer Owner / Sandbox Protocol、Text Pipeline Override / Artifact 的增量公共类型与三个 Document Type；开发预览 `/dev/preview/text-pipeline` 在认证前分流，复用正式 `PipelineWorkbenchView`，覆盖 Owner / Effective、搜索、详情、底部 Preview 与移动端下钻。Extension SDK、Application Runtime 构建和 Client 类型检查通过；Client 生产构建中不存在预览 chunk 或预览标记。未运行浏览器，视觉确认留给用户。

### WP1：Text Pipeline Render Bridge

**目标**：实现 `mark`、确定性 `matchId`、输入 / Display Range、Extractor Artifact、Pipeline Override 和单 Entry Trace；让 Effective Resolver 和 Inspector 共用覆盖顺序。

**主要写入范围**：

- `packages/application-runtime/src/transforms/`
- `packages/application-runtime/src/runtime/transforms-runtime.ts`
- 必要的 `runtime/cards-runtime.ts`、`runtime/narrative-runtime.ts`、`runtime/agents-runtime.ts`
- `apps/studio-server/src/rpc/handlers/application/text-transforms.ts`
- `tests/unit/application-runtime/history-text.test.ts`
- `tests/integration/application-runtime/agent-session.test.ts`
- `tests/integration/studio-server/text-transform-rpc.test.ts`

**禁止修改**：Client Renderer Host、Loom Script Store、正式 UI。

**完成条件**：同一 Inspection 返回最终顺序、稳定 Match、选择 Entry 的逐步 Trace 和按需 Artifact；后续非重叠替换正确平移 Display Range，重叠替换明确使 Range 失效；PromptBuild、Display 与 Inspector 不出现第二套 Override 解析。

**实施结果（2026-09-11）**：已实现不改正文的 `mark`、确定性 `matchId`、UTF-16 输入 / Display Range、后续替换平移与重叠失效、单 Entry Trace、带 Source Entry 对应的瞬时 Extractor Artifact，以及按 Source / Phase / Consumer 持久化的 CAS Text Pipeline Override。Runtime 只在 `resolveEffectiveTextPipeline` 应用禁用与覆盖顺序，未列出的新 Rule 按默认顺序追加；Prompt、Display、Inspector 与显式 Extract 均复用该结果。三组定向测试共 23 项通过，Application Runtime 与 Studio Server 构建通过；未运行浏览器。

### WP2：Loom Script Codec、Store 与 Application API

**目标**：实现严格 Metadata Parser / Serializer、Blob-backed Definition、Mount / Grant、导入导出、CAS、Revision、Changeset、Card Runtime Snapshot 和 Application RPC。

**主要写入范围**：

- `packages/application-runtime/src/scripts/`（新领域目录）
- 新的 `packages/application-runtime/src/runtime/scripts-runtime.ts`
- 必要的 Runtime facade / types / document type 接线
- `packages/application-runtime/src/cards/workspace.ts` 与必要的 Card / Prompt Resource Artifact Codec 接线
- `apps/studio-server/src/codecs/card-bundle-zip.ts` 与直接相关 Card PNG / Workspace import-export 接线
- `apps/studio-server/src/rpc/handlers/application/` 下独立 Loom Script handler
- 直接相关 Runtime / Server 测试与 fixture

**禁止修改**：Script 执行、Client iframe、正式 UI、Agent Script / CodeAct。

**完成条件**：`.loom.js -> Definition + Blob -> export .loom.js` byte-exact round-trip；Card v2 / Preset v1 旧 Artifact 继续可导入，新导出使用含 Attachment 的新版本；ZIP 中存在真实 `.loom.js` 文件；非法 Metadata 不产生半成品 Document；所有导入 Mount 默认未启用且无 Grant。

**实施结果（2026-09-11）**：已实现严格 Metadata Parser / Serializer、内容寻址源码 Blob、Definition / Mount CAS、Grant 与 enablement 独立事实、byte-exact 导出、Card v3 / Preset v2 Attachment、旧 Card v2 / Preset v1 兼容导入、ZIP 真实 `.loom.js` 文件与 Application RPC。Blob metadata、Script Document 及相关资源导入可参加同一 SQLite 事务；Card / Preset 导入 Mount 默认 disabled 且无 Grant，导出读取 Mount 指定 Revision。五组定向测试共 29 项通过，Application Runtime、Studio Server 构建和 Client 类型检查通过；未运行浏览器。

### WP3：Sandbox Renderer Runtime 与 Registry Identity

**目标**：把 Renderer Registry Owner 泛化为 Extension / Script 联合身份；实现静态 Contribution 导出校验、按需 iframe bootstrap、MessageChannel、Capability Bridge、Match / Artifact 投影、版本 Reload 与完整 dispose。

**主要写入范围**：

- `apps/studio-client/src/features/extension-renderers/model/`
- `apps/studio-client/src/features/extension-renderers/ui/renderer-node-mount-host.tsx`
- 新的 `apps/studio-client/src/features/loom-scripts/runtime/`
- 必要的 `packages/extension-sdk/src/index.ts` 实现勘误由主 Agent集成
- `tests/unit/client/client-renderer-host.test.ts`
- `tests/unit/client/renderer-registry.test.ts`
- `tests/unit/client/renderer-surface-host.test.ts`
- 新的 Sandbox Protocol 纯逻辑测试

**禁止修改**：Application Script Store、Extension Server Host、Macro / Text Pipeline 专门面板 UI。

**完成条件**：Extension Renderer 行为不回归；Script Renderer 使用显式 Script Identity；无 Grant 调用被拒绝；disable / reload / scope change 后 Channel、Blob URL 和 iframe 全部清理。

**实施结果（2026-09-11）**：已将 Renderer Registry 身份统一为 Extension / Script 联合 Owner，稳定 Key 分别使用 `extension:<package>/<module>/<contribution>` 与 `script:<document>@<version>/<contribution>`；Script wire context 与带函数的 Host context 分离，`state.read` 必须携带目标并经过 Grant。Client 已实现 Script Mount reconcile、静态 Renderer export 校验、Blob iframe bootstrap、MessageChannel、Capability Bridge、Match / Artifact 输入投影，以及 disable、版本、Scope 和 Standalone Session revoke 后的完整清理；Extension Renderer 原有行为保持。七组定向测试共 26 项通过，Client 类型检查与 Diff check 通过；未运行真实浏览器，Blob iframe / CSP、MessagePort 与 DOM 释放仍需人工验收。

### WP4：Extension Contribution 生命周期与就地检查

**目标**：区分 Package 级声明资源与 Module 级运行 Contributions 的真实生命周期，补齐 `transformRules` 的正式资源导入并为声明式 `textExtractors` 增加同类 Manifest 入口；让 Extension-owned Rule / Extractor 作为已导入资源参与 Effective Pipeline，让 Renderer 随 Module 运行状态参与，并在 Extension Workbench 就地解释声明、注册和当前实例。

**主要写入范围**：

- `packages/extension-sdk/src/index.ts` 与 `packages/extension-sdk/extension-host/` 必要 Manifest / Catalog 合同
- `apps/studio-server/src/extensions/`
- `packages/application-runtime/src/runtime/transforms-runtime.ts` 的门控集成由主 Agent统一合并
- `apps/studio-client/src/features/extension-renderers/`
- Extension Host / Server 直接相关测试

**禁止修改**：Marketplace、Package Source、在线更新、依赖求解与公共 Registry。

**完成条件**：Manifest 中的 Rule / Extractor 通过正式 Application import/remove 路径成为带 Package provenance 的资源；未导入、已移除或被显式禁用的资源不进入新的 Effective Pipeline。Package 源目录暂时不可用不自动删除或禁用已经完整导入的纯声明资源。禁用或不可用 Module 不提供其运行时 Renderer；重新可用后按原稳定身份恢复。既有 Timeline 内已冻结的 Card Rule / Extractor 不被 Extension 当前状态反向改写。UI 不把 Package 声明资源伪装成 Module 注册，也不把声明但未注册的运行能力伪装成正在运行。

实现不得按 Rule / Extractor / Renderer 类型新增一组平行 Module；纯声明资源保持 Package Contribution，现有 Module 可以注册多个相关运行 Contributions。只有 Runtime、Grant 或独立生命周期确有差异时才增加 Module，且进程 / Worker 隔离仍由 Host 策略负责。

**实施结果（2026-09-11）**：已为 Extension Manifest / Catalog 增加 Package 级 `transformRules` 与 `textExtractors`，资源文件经过正式 Application import / remove 路径进入带 `packageId`、`packageVersion`、`contributionId` provenance 的 Rule / Extractor Document；Artifact 不能覆盖 Owner 或内部身份，跨版本更新要求显式迁移，移除使用同一 SQLite 事务 tombstone 当前声明资源。声明资源不依赖空 Module，Client / Server Module 的 Renderer 仍按原稳定身份随 disable / reload 注册与清理；Extension 详情能够区分 Package declared / imported 与 Module declared / running。三组 Extension 定向测试共 21 项通过，SDK、Extension Host、Studio Server 构建与 Client 类型检查通过；Timeline 冻结定向测试 12 项通过，确认既有 Timeline Snapshot 不被当前 Extension 状态反向改写。未运行浏览器。

### WP5：资源入口、专门面板与统一 Detail 整合

**目标**：复用 WP0 组件接入真实 Macro、Text Pipeline、Override、Script、Runtime Inspection 与 Extension Catalog 数据；保留 Card / Preset Owner Master，同时消除重复 Detail 和保存路径。

**主要写入范围**：

- `apps/studio-client/src/features/text-transforms/`
- 新的 `apps/studio-client/src/features/loom-scripts/ui/` 与 model hooks
- `apps/studio-client/src/widgets/context-workbench/`
- `apps/studio-client/src/widgets/preset-workbench/`
- `apps/studio-client/src/widgets/settings-panel/`
- `apps/studio-client/src/features/extension-renderers/ui/renderer-workspace-panel.tsx`
- `apps/studio-client/src/app/`
- `apps/studio-client/src/pages/studio/model/`
- `apps/studio-client/src/shared/api/studio-api.ts`
- Client i18n 与直接相关测试

**禁止修改**：Macro 求值语义、Runtime Effective Resolver、Sandbox 协议、持久化 Schema。

**可自主决定**：组件内部派生状态、请求取消、草稿隔离、错误呈现和无障碍实现；不得改变已确认导航、Owner 权限、快照边界和移动端层级。

**完成条件**：Card / Preset 能从 Owner Master 编辑自身 Macro / Rule / Extractor 与已附着 Script；Macro 专门面板只列当前有效注册表，Text Pipeline 专门面板按最终顺序列出所有有效 Rule / Extractor / Renderer；两边打开同一 Detail；只有当前可写 Owner 可编辑；跨来源重排写 Runtime Override；移动端能够完成列表、详情和预览下钻。

**实施结果（2026-09-11）**：Card / Preset 资源工作台已在既有 Owner Master 中加入 Rule、Extractor 与 Loom Script 分组，`.loom.js` 导入后建立默认禁用、无 Grant 的 Mount，并复用正式 CAS、Mount 启停、顺序与授权 API。专门 Text Pipeline 页面使用单层 `PipelineWorkbenchView` 展示当前 Inspection 的 Rule、Extractor、Match、Artifact，以及 Client Renderer Host 中实际注册的 Extension / Loom Script Renderer；Runtime Script 目录通过 `resolveLoomScriptRendererMounts` 读取当前 Workspace、Timeline 冻结快照与 Preset 的 Effective Mount，不再列举其他 Owner 或禁用 Mount，上下文切换会重新解析。Runtime 中 Workspace / Preset Rule 与 Extractor可编辑，Card Snapshot 与 Extension 保持只读；跨来源禁用和排序写入 Runtime Override。Client 类型检查、四个定向 UI 测试文件共 13 项、Runtime Catalog 3 项与 `git diff --check` 通过；Studio Server Loom Script RPC 集成测试 1 项通过，证明解析结果包含启用 Mount、脚本身份/版本与 byte-exact 源码。未运行浏览器，桌面/移动端布局、源码编辑手感和真实 Blob iframe 视觉仍待人工验收。

### WP6：真实样本、文档晋升与集成收尾

**负责人**：主 Agent。

**目标**：建立一个可保留为教程的完整样本，核对跨工作包公共合同，并将稳定事实写入 Architecture。

**样本必须覆盖**：

```text
<CharacterStatus>...</CharacterStatus>
  -> Card-owned mark Rule
  -> named capture / Extractor Artifact
  -> Card-owned alice-presentation.loom.js
     -> status-panel inline Renderer Contribution
     -> status-summary timeline-tail Renderer Contribution
  -> disable / reload / fallback / Diagnostic
```

同时提供一个 Extension-owned Rule / Renderer Contribution，用于证明 Extension 与 standalone Script 使用同一 Registry 和 Inspector，但保持不同 Manifest / Metadata 身份。

**主要写入范围**：

- `examples/loom-scripts/`（新教程样本）
- 必要的测试 fixtures
- `docs/architecture/application/history-text-pipeline.md`
- `docs/architecture/extensions/client-renderer-host.md`
- 新的 Loom Script Architecture 文档，路径按现有 Architecture 分类确定
- `docs/workbench/reference/document-types.md`
- `docs/workbench/reference/rpc-methods.md`
- `docs/workbench/plans/README.md`
- 本 Plan 最终结果

**完成条件**：Architecture 只记录已实现事实；Plan 写明实际偏差、验证结果、未验证项和剩余风险；不留下重复的旧 UI 入口或孤儿组件。

**实施结果（2026-09-11）**：新增 `examples/loom-scripts/` 教程样本，使用 Card-owned `mark` Rule、named capture Text Extractor、`loom.character-status` Artifact 与双 Contribution `.loom.js`；样本测试从磁盘读取真实文件，经正式 Application API 完成 Rule / Extractor 写入、Script 导入、默认禁用 Mount、启用与 Timeline 冻结解析。`extensions/example-echo` 在保留 Macro、State 与 RPC 的基础上增加 Package Rule 和 Client Renderer，用于对照 Extension Manifest / Module 身份。Architecture 已更新 History Text Pipeline 与 Client Renderer Host，并新增 Loom Script Runtime 文档；Document Type、RPC、Plan 与 Examples 索引已同步。

集成核对发现原 Loom Script Runtime 虽能注册 inline Surface，但没有向 Node Host 提供 `projectNode()` 与正式 Match Range，导致 Contribution 只能出现在 Registry、不能实际挂载。最终实现没有修改 Extension SDK，而是在 Client Host 内部增加受控 `projectNodeWithAnchors` 路径：Loom Script Runtime 使用同一次 Text Pipeline Projection 生成稳定 `match-ref` Mount 和 UTF-16 Range，Node Host 按解析范围插入 Sandbox Renderer；普通 Extension `projectNode()` 合同保持不变。

## 验收条件

1. Card / Preset 资源工作台保留 Owner-scoped Macro / Rule / Extractor Master；专门 Macro / Text Pipeline 面板分别展示当前有效注册表和最终执行序列。
2. 资源入口与专门面板复用同一套 Macro / Rule / Extractor Detail、CAS、草稿隔离和保存 API，不存在两套编辑实现。
3. `mark` 不修改文本；稳定 `matchId` 能驱动 `match-ref`；无法映射的 Range 明确 fallback 并产生 Diagnostic。
4. Pipeline Override 不修改作者资源，并且 PromptBuild、Display Inspector 与 Renderer 使用相同 Effective Order。
5. `.loom.js` Metadata 不使用文件级业务 `kind`，可以静态解析一个或多个 Renderer Contributions、建立数据库索引、byte-exact 保存源码并 round-trip 导出。
6. Card v2 / Preset v1 旧 Artifact 继续可导入；新 Artifact 能携带 Script Attachment，ZIP 中保存真实 `.loom.js`，且不导出本机 Grant 或启用状态。
7. 导入 Script Mount 默认禁用且无 Grant；启用、禁用、版本 Reload 和删除能完整清理 Runtime Instance。
8. Standalone Script 在无 `allow-same-origin` iframe 中运行，不能直接访问 Host DOM、Storage、任意 RPC 或网络；未命中 Surface 时不创建常驻实例。
9. `state.read` 只有在请求、用户授予与 runtime policy 同时允许时可用，并且只能读取当前绑定 Scope。
10. Extension Renderer 继续使用 Manifest + Client Module；Standalone Script 使用 Metadata + Script Runtime，Registry 中 Document / Version / Contribution 身份不会混淆。
11. Package 级声明资源与 Module 级运行 Contributions 按各自生命周期处理；纯声明资源不依赖 Package 目录常驻，Module disable / reload 不反向改写它们或既有 Timeline 冻结快照。
12. Macro 专门面板不显示未参与当前构建的其他 Card / Preset 候选，能够展示同名来源冲突、当前选择与实际构建引用；本 Plan 不改变宏展开语义。
13. Runtime Inspector 能展示 Rule → Match / Artifact → Renderer 的真实消费链、版本和 Diagnostic。
14. 教程样本可以通过正式导入、挂载和启用路径工作，不依赖测试专用注入或硬编码 Runtime 注册。
15. Extension Module 保持逻辑代码生命周期边界：纯声明资源不要求 Module，同一 Runtime、Grant 和启停周期内允许集中注册多个运行 Contributions；实现不把 Module 数量映射成固定进程数量。

## 验证预算

- **Text Pipeline 风险**：运行 `tests/unit/application-runtime/history-text.test.ts`、`tests/integration/application-runtime/agent-session.test.ts` 与 `tests/integration/studio-server/text-transform-rpc.test.ts`，覆盖顺序、上下文隔离、Range 和 RPC 漂移。
- **Codec / Store 风险**：新增最小多 Contribution Metadata round-trip、非法 Header、Owner 内 ID 冲突、CAS、默认禁用 / 无 Grant、Blob 引用、Card v2 → v3、Preset v1 → v2 与 ZIP `.loom.js` 往返测试；不为普通字段映射制造快照测试。
- **Renderer Registry 风险**：运行现有 Client Renderer Host / Registry / Surface Host 定向测试，证明 Extension 路径未被 Script Identity 泛化破坏。
- **Sandbox 风险**：对 Message Protocol、Capability 拒绝、Origin / CSP 配置、dispose 和 stale response 做定向测试。若当前测试环境不能证明真实 iframe Origin 隔离，必须如实标为需客观浏览器诊断，不能用 jsdom 断言冒充安全证明。
- **Extension 门控风险**：运行 Manifest、Package resource import/remove、Module cleanup、logging 与启停相关定向测试，分别证明静态资源和运行注册没有被错误绑定到同一生命周期。
- **公共类型风险**：公共 SDK、Application Runtime、Server RPC 与 Client API 变化后运行相关 package 的定向 TypeScript / build；不默认全仓 build。
- **文档风险**：运行 `pnpm check:docs:links`、`pnpm check:docs:lifecycle` 与 `git diff --check`。
- **人工验收**：用户检查桌面与移动端资源 Owner Master、Macro / Text Pipeline 专门面板的信息密度、滚动高度、下钻、统一 Detail、源码编辑手感和 iframe Renderer 视觉。自动检查不得描述为主观视觉通过。

## 停止条件

- 需要执行普通 `.js`、同源 Trusted Script、Server Script、网络或 State write 时停止，不能以临时 Grant 扩大本 Plan。
- 需要新增第三方 Sandbox、编辑器、Parser 或 Sanitizer 依赖时停止，由主 Agent确认项目现有能力确实不足。
- 需要修改 Canonical Narrative / Agent Message、迁移现有历史正文或建立第二个 Artifact / Marker Store 时停止。
- Metadata 无法在不执行代码的情况下确定 Renderer 声明时拒绝导入，不退回运行时自省。
- Sandbox 无法证明不含 `allow-same-origin` 或无法阻止任意 Bridge 调用时，不得将 standalone Script 标记为可启用。
- Worker 发现公共合同与本 Plan 冲突时停止受影响部分并回传事实，不自行引入兼容双写或合成 Extension 身份。
- 同一实现失败连续两轮仍未解决，或修复要求扩大到 CodeAct、Marketplace、通用 Dev Workspace 时停止并由主 Agent重新分期。

## 开放问题

None。出现新的产品或架构选择时由主 Agent记录到本 Plan，不能由执行 Worker 临场补全。

## 最终结果

Plan 的 WP0—WP6 已完成。最终自动证据包括：Application History / Agent Context 隔离、Text Transform RPC、Loom Script Codec / Store / Timeline Revision Freeze、Card v3 / Preset v2 Attachment、Extension Package Resource 与 Module 生命周期、Client Registry / Sandbox / UI 定向测试和相关 package 类型检查或构建；WP6 最终追加的 4 个核心测试文件共 8 项通过，Client `tsc -b` 通过，281 个 Markdown 文件链接检查通过，`git diff --check` 通过。

`pnpm check:docs:lifecycle` 未全绿，唯一结果为既有未跟踪 Plan `docs/workbench/plans/ui/play-and-session-navigation-plan.md` 没有进入 Plan 索引；该文件不属于本 Plan，未顺手修改。

用户完成主观视觉验收后，最终缺口收口补齐了正式 Runtime Pipeline 底部 Preview、Owner / Effect / Status 筛选、Rule 输入输出与 Match / Artifact / Diagnostic 链路、Runtime Renderer 单项详情、Macro 作者态与检查态共用 Detail，以及 Extension Package / Resource / Module / Renderer / Command 目录式 Master–Detail。追加验证为 Client `tsc -b` 通过，4 个 Client 定向测试文件共 22 项通过，`git diff --check` 通过；Codex 内置浏览器确认正式 Text Pipeline 检查、Preview、Renderer 单项详情和 Extension 目录/详情的真实 DOM 与点击链路。移动端主观布局、真实 Blob iframe Origin / CSP、DOM 释放手感和 Grant 流程仍未在本轮重新人工验收，不将其描述为自动通过。除此之外，本 Plan 没有遗留开放架构问题。
