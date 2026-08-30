# Variable / State System 具体实施计划

> **状态**：Archived / Phase 0—6 完成
> **日期**：2026-08-25
> **设计来源**：[`variable-state-system-foundation-plan.md`](./variable-state-system-foundation-plan.md)
> **目标**：在不引入复杂变量 DSL、模板继承或第二套 Prompt 系统的前提下，打通 State SQL 权威、Application API、Prompt Macro、Card 初始化、Narrative 回滚、Agent Tool 与最小 UI。
> **事实边界**：本文保留实施路线与原始验收标准；“实施前基线”是历史记录，其余已落地能力以当前 Architecture 文档和代码为准。

## 1. 最终交付与阶段边界

第一条必须跑通的纵向链路是：

```text
Card Bundle
  -> State Template / Timeline Binding
  -> 创建 Narrative Timeline 与初始 State Revision
  -> PromptBuild 冻结 Variable Snapshot
  -> Macro 读取 Global / Timeline State
  -> Agent read_state / update_state
  -> State Mutation Service 写入新 Revision
  -> Narrative Branch 记录新的 State Head
  -> 分支、切换和回退恢复对应 State
```

Phase 0 至 Phase 5 完成后，后端闭环应当可用；Phase 6 补最小作者与用户界面。插件贡献、直接 State Prompt Projection 和复杂模板编辑体验不阻塞第一条闭环，放在后续增量中。

### 1.1 已接受的硬边界

- Macro 只是只读文本展开，不支持 `setvar`、`getvar`、递归执行或 PromptBuild 副作用；
- 第一阶段持久化 Scope 只有 `global` 与 `timeline`；
- Entity 只是 Timeline State JSON 中的对象路径，不增加第三种底层类型；
- Preset 不负责 Card / Timeline State 的语义 Binding，也不建设通用 Alias 系统；
- `{{User}}` 只是 `global.user.name` 的第一方显示别名；其他路径依赖作者约定；
- Definition 跟随实际 Carrier，运行值只以 SQL 为权威；
- UI、Agent Tool 和未来 Script 共用同一个 State Mutation Service；
- 不兼容当前早期测试数据，不为尚未发布的旧 State Schema 编写迁移层；
- 第一版每个 Revision 保存完整 `snapshot_json`，先保证正确性和可恢复性，再优化 Delta / Checkpoint。

### 1.2 实施前基线（历史）

- `packages/application-runtime/src/card.ts` 只通过正则替换 `{{User}}`；
- `packages/application-runtime/src/agent-turn.ts` 在读取 Prompt Resource 时传递 `{ user }`，没有统一 Variable Snapshot；
- `packages/application-runtime/src/application-context.ts` 没有 State Store；
- `apps/studio-server/src/main.ts` 已在同一个 `SqliteDataEngine` 上装配 Agent、Narrative 和 Prompt Resource Store；
- `packages/narrative-store/src/types.ts` 的 Branch 只有 `headNodeId`，Node 没有 State Revision Fact；
- `packages/application-runtime/src/workspace.ts` 的 `CardBundleArtifact` 当前是 `schemaVersion: 1`，没有 State Template 或 Binding；
- `packages/application-runtime/src/agent/official-tools/index.ts` 当前只注册 `search_context` 与 `read_context`；
- Client RPC 入口集中在 `apps/studio-server/src/application-rpc.ts` 和 `apps/studio-client/src/shared/api/studio-api.ts`。

### 1.3 实施结果

- `@loom-studio/state-store`、Global / Timeline Scope、完整 Snapshot Revision、幂等与 Tombstone 已落地；
- Application Runtime、RPC、Client API、Definition CRUD 与统一 State Mutation Service 已接通；
- Preset、Setting、Opening 与 Tool Prompt 已统一使用冻结的 `VariableSnapshot` 和单次 Macro Renderer；
- Card Bundle 已升级为 V2，JSON、ZIP、PNG 共用同一个 V2 validator；
- Timeline 初始化、Branch / Node State Fact、Fork / Switch / Undo 与联合事务已接通；
- `official/read_state`、`official/update_state` 已进入多步 Agent Tool Loop；
- Studio Client 已提供 Global、当前 Timeline / Branch、Definition 与 Card Binding 的最小编辑界面；
- 当前权威说明见 [`../../architecture/application/state-and-variables.md`](../../architecture/application/state-and-variables.md)。

## 2. 第一版正式数据合同

### 2.1 State Target 与 Snapshot

Application 层使用一个 Scope Union，不为 Global / Timeline 复制两套 Handler：

```ts
type StateTarget =
  | { scope: 'global' }
  | { scope: 'timeline'; timelineId: string; branchId: string }

type StateSnapshot = {
  scopeId: string
  target: StateTarget
  revisionId: string
  value: JsonObject
  createdAt: string
}
```

Timeline 写入必须显式提供 `branchId`。读取 UI 可以先解析 active branch，但进入 Mutation Service 前必须转换为明确 Target，避免切换分支时误写。

### 2.2 Mutation Operation

第一版不实现完整 JSON Patch，也不增加表达式语言。使用三个可审计操作，并采用 RFC 6901 JSON Pointer：

```ts
type StateMutationOperation =
  | { op: 'set'; path: string; value: JsonValue }
  | { op: 'remove'; path: string }
  | { op: 'increment'; path: string; by: number }

type ApplyStateMutationInput = {
  target: StateTarget
  expectedRevisionId: string
  operations: StateMutationOperation[]
  idempotencyKey?: string
}
```

约束：

- 根路径只能由 `set` 替换为 JSON Object；
- `increment` 只接受有限 number，目标必须已经是 number；
- 第一版不支持 JSON Pointer 的 `-` 数组追加语义；
- 空 Operation 列表直接拒绝；
- `expectedRevisionId` 必填，冲突返回 `state.head_conflict`；
- 同一 Scope 内重复 `idempotencyKey` 且内容一致时返回原 Revision，内容不一致时返回 `state.idempotency_conflict`。

### 2.3 SQL Schema

新增 `packages/state-store/`，使用共享 Data Engine migration namespace：

```text
application.state
```

第一版只建两张表：

```text
state_scopes
  id                    TEXT PRIMARY KEY
  kind                  TEXT NOT NULL          global | timeline
  owner_id              TEXT NOT NULL          workspace | narrativeTimelineId
  head_revision_id      TEXT NULL              仅 Global 使用
  created_at            TEXT NOT NULL
  updated_at            TEXT NOT NULL
  deleted_at            TEXT NULL
  UNIQUE(kind, owner_id)

state_revisions
  id                    TEXT PRIMARY KEY
  scope_id              TEXT NOT NULL
  parent_revision_id    TEXT NULL
  changeset_id          TEXT NOT NULL
  snapshot_json         TEXT NOT NULL
  operations_json       TEXT NOT NULL
  idempotency_key       TEXT NULL
  created_at            TEXT NOT NULL
  UNIQUE(scope_id, idempotency_key)
```

Timeline Head 不重复保存在 `state_scopes`。它由 Narrative Branch 持有；Narrative Node 保存当时的 State Revision Fact：

```ts
type NarrativeBranch = {
  // existing fields...
  stateHeadRevisionId: string
}

type NarrativeNode = {
  // existing fields...
  stateRevisionId: string
}
```

这样可以区分：

- Branch：当前世界线最新状态；
- Node：该正文事实生成时所对应的状态；
- 纯 State 操作：只推进 Branch State Head，不伪造 Narrative Node；
- 从旧 Node 分叉：使用该 Node 的 `stateRevisionId`；
- 从当前 Branch Head Node 分叉：优先使用 Branch 最新 `stateHeadRevisionId`，保留正文后发生的纯 State 操作。

`snapshot_json` 第一版每次完整保存。`operations_json` 用于审计、Tool Result 和后续生成反向操作，不承担读取重放。数据量达到实际瓶颈后，再引入 Delta Replay 与稀疏 Checkpoint；在此之前不提前建设缓存层。

### 2.4 Definition 与 Card Carrier

第一版需要两种配置形态，但它们不构成新的 State Scope：

```ts
type GlobalVariableDefinition = {
  path: string
  schema: JsonObject
  default?: JsonValue
  readOnly?: boolean
}

type StateTemplateDefinition = {
  id: string
  version: number
  schema: JsonObject
  initial: JsonObject
}

type TimelineStateBinding = {
  path: string
  templateId: string
  templateVersion: number
  initial?: JsonObject
}
```

Card Bundle 升级到 `schemaVersion: 2`：

```ts
type CardBundleArtifact = {
  schemaVersion: 2
  // existing fields...
  stateTemplates?: StateTemplateDefinition[]
  timelineStateBindings?: TimelineStateBinding[]
}
```

实现时不保留 V1 导入兼容分支。导入后：

- Template 物化为 `kind: timeline-template` 的 `airp.stateDefinition` Document；
- 同 ID / Version 的现有 Definition 只有内容一致时复用，内容冲突时拒绝导入，不静默覆盖；
- Card Source 保存 Template ID 与 Timeline Binding；
- Timeline 创建时合并 Template `initial` 与 Binding `initial`；
- 同一路径重复绑定、模板不存在、模板版本不一致或初始值不符合 Schema 时拒绝创建 Timeline；
- 已创建 Timeline 不自动追随 Template 后续修改。

JSON Schema 是持久化与 Artifact 的 canonical Definition。第一版复用项目现有能力实现所需子集验证，不为了完整 Draft 支持新增依赖；若现有校验不足，再单独评估复用仓库已安装的 Ajv，而不是复制 Tool Registry 私有校验逻辑。

### 2.5 Variable Snapshot 与 Macro

PromptBuild 开始时冻结：

```ts
type VariableSnapshot = {
  global: JsonObject
  timeline?: JsonObject
  computed: JsonObject
  aliases: Record<string, string>
}
```

第一方路径：

```text
global.user.name        持久化 Global State
global.time.now         单次 PromptBuild 冻结的只读计算值
timeline.*              当前 Narrative Branch 的 Timeline State
{{User}}                -> global.user.name
```

Macro Renderer 规则：

- 只扫描一次 `{{ path }}`；
- 只展开 string、number、boolean 和 null；
- 对象或数组引用产生诊断，并保留原 Macro 文本；
- 缺失路径产生诊断，并保留原 Macro 文本；
- Runtime 调用不因单个缺失 Macro 整体失败；Preview / Dry Run 必须显示路径、来源和诊断；
- 同一 PromptBuild 中 `global.time.now` 等计算值保持一致。

## 3. 分阶段实施

### Phase 0：State Store Package

#### 修改范围

新增：

```text
packages/state-store/package.json
packages/state-store/tsconfig.json
packages/state-store/src/index.ts
packages/state-store/src/types.ts
packages/state-store/src/store.ts
packages/state-store/src/store.test.ts
```

同步修改：

```text
tsconfig.json
tsconfig.packages.json
```

Store 公开：

- `createStateStore(options)`；
- `StateStore.getScope()`、`getRevision()`、`getGlobalSnapshot()`；
- `StateStore.transaction(tx)`；
- Transaction 内的 `createScope()`、`createRevision()`、`setGlobalHead()`、`tombstoneScope()`；
- `StateStoreError` 与稳定错误码。

`createRevision()` 只负责校验 Scope、Parent、JSON 与幂等记录，不知道 Narrative Branch。Timeline Head 的推进从 Phase 3 起由 Mutation Service 在同一 Data Engine transaction 中协调。

#### 非目标

- 不做缓存、Delta Replay、Checkpoint 压缩；
- 不做 Template、Macro、RPC 或 UI；
- 不让 Store 依赖 Application Runtime 或 Narrative Store。

#### 验收与最小验证

- Global / Timeline Scope 唯一性；
- 初始 Revision、连续 Revision 与跨 Scope Parent 拒绝；
- Snapshot JSON 往返；
- expected parent、幂等重复与幂等冲突；
- Tombstone Scope 拒绝新增 Revision，但历史 Revision 仍可按 ID 审计读取；
- 事务失败不残留 Scope、Revision 或 Data Commit Operation；
- 定向运行 `packages/state-store/src/store.test.ts` 与该 Package build。

### Phase 1：Runtime 装配、Global Mutation Service 与 RPC

#### 修改范围

主要文件：

```text
packages/application-runtime/package.json
packages/application-runtime/tsconfig.json
packages/application-runtime/src/application-context.ts
packages/application-runtime/src/types.ts
packages/application-runtime/src/runtime.ts
packages/application-runtime/src/state.ts
apps/studio-server/package.json
apps/studio-server/tsconfig.json
apps/studio-server/src/main.ts
apps/studio-server/src/application-rpc.ts
apps/studio-client/src/shared/api/studio-api.ts
```

装配规则：

- Server 在现有 `dataEngine` 上创建 `createStateStore()`；
- `ApplicationRuntimeOptions` 与 `ApplicationRuntimeContext` 注入 `states`；
- 正式 Server Runtime 要求 State Store 存在；测试可以显式注入内存 SQLite Store；
- `packages/application-runtime/src/state.ts` 成为唯一 State Mutation Service。

最小 Application / RPC 合同：

```text
application.getStateSnapshot
application.applyStateMutation
```

Client 暴露：

```ts
api.states.get(target)
api.states.apply(input)
```

Mutation Service 负责：

- 解析 Global Target，并为后续 Timeline Target 保留同一个公开 Union；
- 读取当前 Head 并检查 `expectedRevisionId`；
- 应用 `set` / `remove` / `increment`；
- 创建完整 Snapshot Revision；
- Global 更新 `state_scopes.head_revision_id`；
- 记录 Data Commit Operation 与稳定错误码。

Phase 1 可以先使用空 `{}` Global State 初始化。`global.user.name` 的正式默认值在 Phase 2 接入现有 Card / Workspace 用户信息时补齐。Timeline Target 在 Phase 3 完成 Branch State Head 与初始化合同前明确返回 `state.timeline_not_initialized`，不做半成品隐式创建。

#### 非目标

- 不做订阅事件；Client 先在成功 Mutation 后使用返回 Snapshot 更新状态；
- 不做乐观写入；
- 不做 Template Schema 校验，只做 JSON、路径、Revision 与数字操作边界；
- 不在 Narrative Branch 合同完成前开放 Timeline Mutation。

#### 验收与最小验证

- Server 启动后能创建并查询 Global Snapshot；
- Revision 冲突、非法路径和非法数字操作时拒绝；
- UI RPC 与直接 Runtime 调用得到相同结果；
- Timeline Target 返回明确的未初始化错误，不静默写到 Global Scope；
- 定向 Runtime/RPC 测试与相关 Package build 通过。

### Phase 2：Variable Resolver 与 Macro 收口

#### 修改范围

主要文件：

```text
packages/application-runtime/src/variables.ts
packages/application-runtime/src/card.ts
packages/application-runtime/src/workspace.ts
packages/application-runtime/src/agent-turn.ts
packages/application-runtime/src/runtime.ts
packages/application-runtime/src/prompt-build-pipeline.ts
```

实施内容：

1. 新增统一 `createVariableSnapshot()` 与 `renderVariableMacros()`；
2. 删除 `{ user: string }` 作为 Macro Runtime Contract；
3. `prepareAgentTurn()` 在读取 Prompt Resource 前一次性冻结 Global、Timeline 和 computed 值；
4. Setting、Preset、Opening、Tool Prompt 和其他模型可见文本统一走 Renderer；
5. `{{User}}` 通过 Alias Registry 解析到 `global.user.name`，不是 Parser 特判；
6. PromptBuild Trace 增加已读取路径、值来源和诊断，不记录 Secret；
7. Preview 与实际调用使用同一 Snapshot 构建路径。

`global.user.name` 第一阶段从 Global State 读取。若 Global State 尚未设置，则使用当前 Card `userName` 或 `User` 作为 Resolver fallback，但不在 PromptBuild 中隐式写回 SQL。

Phase 2 先通过注入的 Timeline Snapshot 完成 Resolver 单元合同；实际 Narrative Timeline 的 Snapshot 读取在 Phase 3 初始化合同完成后启用。

#### 非目标

- 不支持嵌套 Macro、函数调用、条件、赋值或递归展开；
- 不自动把完整 Timeline State 注入 Prompt；
- 不建设通用 Semantic Binding Alias。

#### 验收与最小验证

- `{{User}}` 与 `{{global.user.name}}` 结果一致；
- 同一 Build 中重复时间 Macro 完全一致；
- Global / Timeline 同名路径不串 Scope；
- Setting、Opening、Tool Prompt 与普通 Preset 文本使用同一 Renderer；
- 缺失、对象值和非法路径产生 Trace 诊断，不静默变为空字符串；
- Preview 与 Invoke 的 Macro 结果在相同输入下相同。

### Phase 3：Definition、Card Bundle V2 与 Timeline 初始化

#### 修改范围

主要文件：

```text
packages/application-runtime/src/document-types.ts
packages/application-runtime/src/types.ts
packages/application-runtime/src/workspace.ts
packages/application-runtime/src/runtime.ts
packages/application-runtime/src/state-definition.ts
packages/narrative-store/src/types.ts
packages/narrative-store/src/store.ts
apps/studio-server/src/application-rpc.ts
apps/studio-client/src/shared/api/studio-api.ts
apps/studio-server/src/card-bundle-zip.test.ts
apps/studio-server/src/card-png.test.ts
```

实施内容：

- 新增一个 `airp.stateDefinition` Document，其内容是 Global Definition / Timeline Template Union；
- Card Source 保存 Template IDs 与 `timelineStateBindings`；
- `CardBundleArtifact` 直接升级到 V2，导入、导出和类型守卫同步修改；
- 导入时校验 Template identity、version、Schema 和 Binding 路径；
- Narrative Store migration 增加 Branch `state_head_revision_id` 与 Node `state_revision_id`；
- 创建 Timeline 前将所有 Binding 物化为一个初始 `JsonObject`；
- 在同一 `dataEngine.transact()` 中创建 Timeline、Primary Branch、Timeline State Scope 与 Initial Revision；
- Opening Macro 使用冻结的 Global + Initial Timeline Snapshot 渲染；
- Primary Branch 与 Opening Nodes 写入 Initial Revision ID。

最小 Definition API：

```text
application.listStateDefinitions
application.getStateDefinition
application.upsertStateDefinition
application.deleteStateDefinition
```

这些 API 编辑共享 Definition；Global 编辑器按 `kind: global` 过滤，Card 编辑器按 `kind: timeline-template` 过滤并只保存引用和 Binding，不复制出第二份 Workspace 权威。新增 Global Definition 时，如果路径不存在且带有 `default`，必须通过 Mutation Service 创建一个正常 Revision；如果路径已存在则只做 Schema 兼容检查，不覆盖当前值。Phase 3 同时将 Definition Schema 校验接入 Mutation Service，并正式开放 Timeline State Query / Mutation。

Preset Global Variable Requirement 暂不阻塞本 Phase。等 Preset Artifact 附件合同稳定后，再允许 Preset 声明 canonical path requirement；不增加 Preset 与 Card State 的映射 Alias。

#### 非目标

- 不做模板继承、Mixin、自动迁移或热更新已有 Timeline；
- 不做独立 `.state.json` 用户 Artifact；
- 不兼容 Card Bundle V1；
- 不让 Template 修改自动改写运行中的 State。

#### 验收与最小验证

- Card V2 导入、SQL 物化、重新导出保持 Template / Binding 语义；
- 缺失模板、重复路径、Schema 不匹配均在创建 Timeline 前失败；
- Timeline、Branch、Opening Node 与 Initial State 在同一事务成功或一起回滚；
- Opening 可读取 Initial Timeline State；
- Global / Timeline Mutation 都经过对应 Definition Schema 校验；
- 同一 Timeline 的两个 Branch 互不覆盖 State Head；
- ZIP、PNG 嵌入与纯 JSON Artifact 使用同一 V2 validator。

### Phase 4：Narrative Fork、Switch 与 Changeset 回滚

#### 修改范围

主要文件：

```text
packages/narrative-store/src/types.ts
packages/narrative-store/src/store.ts
packages/application-runtime/src/runtime.ts
packages/application-runtime/src/state.ts
packages/application-runtime/src/mutation.ts
apps/studio-client/src/features/narrative-runtime/model/use-narrative-runtime.ts
```

实施内容：

- Append Narrative Node 时必须提供当前 State Revision ID；
- State-only Mutation 只更新 Branch State Head；
- Fork 当前 Head Node 使用 Branch 最新 State Head；Fork 历史 Node 使用 Node State Revision；
- Switch Branch 后，State Query 读取目标 Branch Head，不复制 Revision；
- 删除 Timeline 时在同一事务软删除 State Scope；普通 Snapshot Query 与 Mutation 随即关闭，历史 Revision 仍可按 ID 审计读取；
- State-only Changeset 的 Undo 创建补偿 Revision，不删除历史 Revision，也不把 Head 直接倒退；
- Narrative Branch 切换 / Fork 是世界线选择，不等同于 Changeset Undo。

Agent Loop 的边界必须明确：每次成功 `update_state` 是独立已提交 Changeset。后续 Provider 失败或用户暂停不会自动撤销它；需要显式 Undo、补偿 Mutation 或 Narrative 回滚。第一版不把整个多步 Agent Run 暂存成一笔超长 SQLite Transaction。

现有 `application.revertChangeset` 在本 Phase 增加 State-only Changeset 路由：第一版只允许撤销当前 Head 对应的 Changeset，并通过 Mutation Service 以 Parent Snapshot 生成补偿 Revision；撤销更早的 Revision 返回 `state.revert_conflict`。混合 Document + State Changeset 只有在确实出现联合写入入口后再增加组合 Reverter，不提前实现通用 Saga。

对于未来真正要求“正文与状态原子提交”的确定性 Command，Application Runtime 可以在一个 `dataEngine.transact()` 中组合 Narrative Transaction 与 State Transaction；这不是 Agent Tool Loop 的默认行为。

#### 非目标

- 不让 Agent Session Tree 回滚自动影响 Narrative / State；
- 不为多步 Agent Run 实现全局 Saga 或自动补偿；
- 不把 Branch Switch 伪装成删除 Revision。

#### 验收与最小验证

- 两个 Branch 产生不同 State 后可反复切换并恢复；
- 从历史 Node Fork 得到当时 State；
- 从当前 Head Node Fork 保留正文后发生的纯 State 修改；
- State-only Undo 产生新 Revision，原 Revision 仍可审计；
- Tool Mutation 已提交后模拟 Provider 失败，State 保持已提交事实；
- Narrative 与 State 联合事务失败时双方均不残留部分写入。

### Phase 5：首批 Agent State Tools

#### 修改范围

新增：

```text
packages/application-runtime/src/agent/official-tools/read-state.ts
packages/application-runtime/src/agent/official-tools/update-state.ts
```

同步修改：

```text
packages/application-runtime/src/agent/official-tools/index.ts
packages/application-runtime/src/agent/tool-loop.ts
packages/application-runtime/src/agent/official-tools/context-snapshot.ts
packages/application-runtime/src/state.ts
```

工具合同：

```text
official/read_state
  target
  paths?               可选 JSON Pointer 列表

official/update_state
  target
  expectedRevisionId
  operations
```

执行规则：

- 两个工具都通过 Native Structured Tool 暴露；
- Tool Handler 只做 Tool 输入 / Result 适配，实际读写调用 State Runtime / Mutation Service；
- Narrative Agent 默认只能访问本次 Turn 明确绑定的 Timeline / Branch 和 Global Scope；
- 不能让模型通过参数越权读取任意 Timeline；
- Tool invocation ID 作为默认 `idempotencyKey`；
- Schema、权限、Revision 冲突和 Operation 错误进入规范 Tool Result，不让 Loop 崩溃；
- 成功 Result 返回新 `revisionId` 与被修改路径，不默认回传整个大 Snapshot。

#### 非目标

- 第一版不从 Template 自动生成每个 Entity 的专用 Tool；
- 不做任意 SQL、表达式或脚本执行；
- 不让 Tool 自己持有缓存或事务。

#### 验收与最小验证

- Agent 能读取 Initial Timeline State，更新后在下一 Provider Step 读到新值；
- success、schema error、permission error、head conflict 与重复 invocation 都有确定 Result；
- 同一 Invocation 重放不重复扣除金币；
- Tool Loop 多步调用、Provider stop 和失败恢复定向测试通过；
- 不发送真实 Provider 请求，使用现有 Fake Gateway 覆盖主合同。

### Phase 6：最小变量 UI

#### 修改范围

新增 Feature：

```text
apps/studio-client/src/features/state-variables/
  model/
  ui/
```

主要接入：

```text
apps/studio-client/src/shared/api/studio-api.ts
apps/studio-client/src/features/narrative-runtime/model/use-narrative-runtime.ts
apps/studio-client/src/widgets/character-panel/character-panel.tsx
apps/studio-client/src/widgets/narrative-timeline/narrative-timeline.tsx
apps/studio-client/src/app/app.tsx
```

第一版只提供：

- Workspace Global State JSON 编辑器；
- 当前 Timeline / Branch State 查看与 JSON 编辑；
- Revision ID、Scope、来源 Card 与冲突错误显示；
- Card Profile 中 Template / Binding 的 JSON 编辑入口；
- 保存时发送 `expectedRevisionId`，冲突后要求刷新，不静默覆盖；
- Agent / UI 修改成功后刷新当前 Snapshot。

UI 不复制 Store 规则。表单只负责编辑与展示，最终校验仍由 Runtime / Mutation Service 完成。

#### 非目标

- 不做状态栏、商店、拖拽 Schema Builder 或自定义面板设计器；
- 不做自动保存和复杂乐观合并；
- 不把 Preset 变成 State Binding 管理器。

#### 验收与最小验证

- Global 与两个 Timeline Branch 的编辑目标不会串写；
- 冲突、Schema 错误和只读变量错误可见；
- 创建 Card Binding 后启动 Timeline 可看到初始 State；
- 组件状态与 Client API 使用定向测试；
- 布局、层级、编辑手感和响应式效果由人工视觉验收，不用自动测试替代。

## 4. 后续增量，不阻塞第一条闭环

### 4.1 直接 State Prompt Projection

Macro 适合在作者文本中引用少量标量；完整对象或稳定状态摘要应走直接 Projection，而不是要求作者手写大量 Macro。

后续可让 Card 携带 `stateProjections`：canonical path + renderer + 现有 Prompt Projection / Activation 能力。它作为 Runtime Source 进入 PromptBuild 的 Zone / Slot，不引入语义 Alias，也不默认注入完整 State。

第一版 Renderer 只需要 `json` 与简单 `key-value`。复杂模板语言、双向绑定和表达式继续后置。

### 4.2 Extension Contribution

Extension Package 后续提供：

- Manifest 静态贡献 Global Definition / State Template；
- Package 内 JSON 文件作为声明来源；
- 代码注册只读 computed resolver；
- Capability 控制 State read / write Scope；
- 卸载时禁用 Resolver，但不删除 Workspace 当前值。

这部分依赖 Extension Package Source / Host contribution 管线，不在 State Store 第一轮内硬编码临时插件注册表。

### 4.3 Delta、Checkpoint 与缓存升级条件

只有测量满足以下任一条件时才进入优化：

- 单 Timeline State Snapshot 达到明显影响写入或读取的体积；
- Revision 数量使 DB 体积或导出成本不可接受；
- 实际回滚需要跨大量 Revision 重放；
- PromptBuild Snapshot 读取成为可测量热点。

升级方向是保留当前 Revision ID 与 Snapshot API，在 Store 内部逐步改为 Delta + 稀疏 Checkpoint；上层 Runtime、Tool 和 UI 合同不随存储优化变化。

## 5. 跨阶段验证矩阵

| 风险 | 最小证据 | 不替代的验收 |
| --- | --- | --- |
| SQL 原子性与 Revision 冲突 | State Store 定向测试 | 不需要浏览器 |
| Runtime / RPC 参数边界 | Application Runtime 与 RPC 定向测试 | 不等于真实 Provider 验收 |
| Macro 一致性 | Resolver、Preview / Invoke 对照测试 | 不等于作者 Prompt 质量评价 |
| Card Artifact 完整性 | JSON、ZIP、PNG V2 往返测试 | 不等于第三方卡格式兼容 |
| Branch / Node State 恢复 | Narrative + State 集成测试 | 不等于完整 Undo UX 验收 |
| Agent Tool Loop | Fake Gateway 多步测试 | 不等于所有 Provider 实机测试 |
| UI 编辑体验 | 组件状态与 API 测试 | 仍需人工视觉与交互验收 |

每个 Phase 只运行覆盖该阶段风险的定向测试与相关 Package build。只有修改根构建引用、跨包公开类型或 Card 打包入口时，才运行对应的更宽构建；不把全仓测试作为每个小阶段的固定仪式。

## 6. 实施顺序与停止点

```text
Phase 0  State Store
  -> Phase 1  Runtime / RPC / Global Mutation Service
  -> Phase 2  Variable Resolver / Macro
  -> Phase 3  Card Bundle V2 / Timeline 初始化
  -> Phase 4  Branch / Node State / 回滚
  -> Phase 5  Agent State Tools
  -> Phase 6  最小 UI
```

每个 Phase 完成定向验证后停止并复审，不自动扩大到下一阶段。推荐第一次实施只批准 Phase 0；它能够独立确定 SQL、Revision 与事务合同，又不会提前牵动 PromptBuild、Card Artifact 或 UI。

## 7. 完成定义

本计划完成时应满足：

1. Global / Timeline State 有独立 SQL 权威和可审计 Revision；
2. Card V2 可以携带 Template / Binding 并原子初始化 Timeline State；
3. PromptBuild 从冻结 Snapshot 展开 Macro，Preview 与 Invoke 一致；
4. UI、Agent Tool 与未来 Script 共享 State Mutation Service；
5. Narrative Branch / Node 能定位正确 State Revision，Fork / Switch / Undo 语义明确；
6. Agent 能在多步 Loop 中可靠读取、修改并再次读取 State；
7. 最小 UI 可以查看和编辑 Global、Timeline 与 Card State 配置；
8. 没有引入通用 Binding Alias、宏赋值 DSL、模板继承或未被真实需求证明的复杂基础设施。

## 8. 实施验收记录

2026-08-25 完成以下自动化验收：

- `@loom-studio/state-store`、`@loom-studio/narrative-store`、`@loom-studio/application-runtime`、`@loom-studio/studio-server`、`@loom-studio/studio-client` 构建通过；
- 20 个聚焦测试文件、97 个测试通过，覆盖 Store、Mutation、Macro、Card V2、Timeline / Branch / Undo、Agent Tool Loop、RPC 与 Client UI model；
- Preview 与 Invoke 使用包含 `{{User}}` 的同一 Preset，展开后的 Provider Messages 与 Projection 一致；
- Tool Result 已覆盖 success、Schema error、permission error、head conflict 与重复 Invocation；
- Card JSON、ZIP、PNG 边界统一拒绝 Card Bundle V1；
- `git diff --check` 通过。

测试工程级 `tsc -b tests/tsconfig.json` 仍会报告仓库既有的跨模块测试类型债务；相关五个生产 Package 的正式 build 均已通过，且没有发现新的 Narrative `stateRevisionId` 漏填。布局、层级、编辑手感和响应式效果尚未进行人工视觉验收。
