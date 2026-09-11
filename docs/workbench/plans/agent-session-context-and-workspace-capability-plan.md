# Agent Session Context 与 Workspace Capability 计划

> **Status**：Approved / 待实施
> **日期**：2026-09-11
> **范围**：收紧 Agent Session Context、Narrative Target、PromptBuild 资源装配、Tool / CodeAct 资源访问和 Workspace Agent 能力边界。
> **授权**：用户确认 Binding 不是所有权或权限；Workspace Agent 通过 Agent Profile、Tool 与 Capability 获得跨资源读写能力；Workspace PromptBuild 不自动注入全部资源。

相关计划：

- [`application-capability-cli-mcp-adapters-plan.md`](./application-capability-cli-mcp-adapters-plan.md)：提供 RPC、Agent Tool、CodeAct、CLI 与 MCP 共用的 Application Capability 执行边界；
- [`file-backed-resource-agent-script-codeact-plan.md`](./file-backed-resource-agent-script-codeact-plan.md)：消费本计划形成的执行上下文与 Capability Grant，不另建 Script 权限体系；
- [`ui/play-and-session-navigation-plan.md`](./ui/play-and-session-navigation-plan.md)：只实现 Session 分组、显示、跳转和唤起，不拥有授权语义；
- [`agent-runtime-ai-sdk-foundation-plan.md`](./agent-runtime-ai-sdk-foundation-plan.md)：已完成的 Agent Loop / Tool 基础，不在本计划中重新设计 Provider 或 Transcript。

## 目标

建立一个可被 Agent PromptBuild、Tool Executor、未来 CodeAct API 和 UI 共同理解的执行上下文：

```text
Agent Session Context
  -> 默认 Prompt 资源与 UI 关系

Agent Profile / Effective Tool Set
  -> Agent 可以请求哪些能力

Invocation Target + Capability Grant
  -> 本次调用可以读写哪个对象
```

Timeline Binding 只表达 Session 的默认 Narrative Context，不表示 Session 属于 Timeline，也不自动授予或剥夺 Workspace 权限。没有 Timeline Binding 的 Session 使用 Workspace Context；它可以通过明确授权的 Tool / CodeAct API 主动访问 Workspace 资源，但不能因为“未绑定”自动成为超级管理员。

## 已验证现状

- `AgentSession` 当前只保存可选 `timelineId`，没有 Branch Binding、Context Kind 或权限字段。
- `CreateAgentSessionInput` 可以写入 `timelineId`，但 `UpdateAgentSessionInput` 当前只能修改标题，不能显式解绑。
- Agent Store 的 Session 列表查询会返回 `timeline_id`；单项 `readSession()` 查询当前没有选择该列，导致 `getSession()` 可能丢失 Binding。这是实现缺陷，不是目标设计。
- `invokeAgentTurn.narrativeTarget` 与 `AgentSession.timelineId` 当前相互独立，Runtime 没有统一解析或拒绝不匹配目标。
- Agent Profile 只保存 Preset、Model 与 `toolOverrides`。有效 Tool Set 由 Preset Tool Mount、Profile Override、Activation 和 Runtime Registration 共同解析。
- 当前 Agent Turn 有 Narrative Target 时装配 Timeline / Branch、State、Card Runtime Context 与 Narrative History；没有 Narrative Target 时不装配这些内容。
- 当前 State Tool Scope 对所有 Turn 允许 Global State；有 Narrative Target 时额外允许该 Timeline / Branch。现状不能表达“默认目标”和“显式跨 Scope 授权”的区别。
- 当前官方 Tool 只覆盖 Context、State 与 Narrative 读写；创建角色、迁移世界书、修改 Settings 等 Workspace Authoring Tool 尚未形成官方闭环。
- Application Capability Registry、正式 CodeAct Host、CLI 与 MCP 仍是 Workbench 提案，不能作为现有能力引用。

## 已确认决策

### 1. Binding 只负责 Context

Timeline Binding 的消费者只有：

1. UI 分组、标记、跳转与唤起；
2. 打开绑定 Session 时定位其 Narrative Timeline；
3. PromptBuild 的默认 Narrative / Card / State / Setting 装配；
4. Tool / CodeAct 的默认 Narrative Target。

Binding 不负责：

- 判断 Agent 是否为管理员；
- 授予创建角色、修改世界书或 Settings 的能力；
- 决定是否读取 Secret；
- 把 Agent Session 变成 Timeline 子对象；
- 限制所有显式 Tool 调用只能作用于该 Timeline。

### 2. 两种 Session Context

#### Narrative Context

绑定 Timeline 的 Session 默认使用该 Timeline 当前明确选择的 Branch。PromptBuild 可以装配：

- Agent Preset 与 Agent Session History；
- Global Setting；
- Timeline 来源角色的 Setting；
- Timeline State Projection；
- Narrative History；
- 用户明确 Pin 或选择的附加 Context Source。

本计划第一版继续保持 Timeline-only Binding。实际 Branch ID 作为每次 Turn、Tool Invocation 和 PromptBuild 的运行事实记录，不把 `branchId` 提前加入 Session Header。

#### Workspace Context

未绑定 Timeline 的 Session 使用 Workspace Context。PromptBuild 默认只装配：

- Agent Preset；
- Agent Session History；
- Global Setting；
- 用户明确 Pin、选择或由 Runtime Policy 提供的 Context Source。

不得默认注入全部角色、全部世界书、全部 Timeline、完整 State 或整个 Workspace 文件树。跨资源工作主要通过主动 Search / Read / Command Tool 完成。

### 3. Context、Capability 与 Target 正交

Workspace Agent 的广泛能力来自 Agent Profile 所使用 Preset 的 Tool Mount、Profile Override、Capability Grant 和 Approval，不来自 `timelineId` 为空。

同一种 Workspace Context 可以承载不同 Agent：

```text
Loom Help
  -> 文档与配置只读 Tool

Worldbook Migrator
  -> Prompt Resource 搜索、读取、批量迁移 Tool

Workspace Developer
  -> Card / Setting / Resource 创建与修改 Tool
```

不新增 `isAdmin`、`globalAgent` 或通用权限等级。首版继续以稳定 Tool / Capability ID 表达能力，读写和高风险操作使用不同 Capability。

### 4. Invocation Target

- Narrative Session 的默认 Narrative Target 来自 Binding。
- Narrative Session 显式提供另一个 Timeline Target 时必须拒绝，不能静默跨世界线执行。
- Workspace Session 没有默认 Narrative Target。
- Workspace Session 可以在用户或 Agent Tool 明确指定资源 ID 后操作任意 Workspace Resource；是否允许读取或修改某条 Timeline，由该 Tool / Capability 的 Target Policy 与 Approval 决定。
- Workspace Session 的一次显式 Timeline Target 不形成持久 Binding；完成后仍是 Workspace Session。
- Tool Invocation、PromptBuild Trace、Changeset 和 Transcript 必须记录实际 Target，不只记录 Session Binding。

### 5. Tool 与 CodeAct 共用能力边界

Agent Tool 仍由现有 Tool Registry 负责模型投影、输入校验、Approval、执行与 ToolResult。产生领域读写的 Executor 调用 Application-owned Query / Command；在存在第二个真实 Adapter 消费者时，再按 Application Capability 计划抽取为共享 Capability。

CodeAct 不获得 Application Runtime、Store、SQLite、Blob Root 或宿主文件系统。它只获得按 Effective Capability 裁剪的 Loom API；每个 API 调用复用 Application Capability、Target 校验、Approval、Changeset、parentCallId 和审计。

```text
CodeAct requested capability
  ∩ Agent / Preset grant
  ∩ Runtime policy
  ∩ current user approval
  -> Effective Capability
```

不为 CodeAct 新建第二套资源权限、Target Resolver 或 Mutation API。

### 6. Workspace Authoring 能力

Workspace Developer Agent 的目标能力包括：

- 搜索、读取和更新 Prompt Resource / Setting；
- 创建和修改 Card；
- 在资源间迁移条目；
- 执行受控导入导出；
- 读取和修改 Global State；
- 使用明确 Target 检查或修改 Narrative / Timeline 数据；
- 在未来调用已授权 CodeAct 组合上述能力。

这些能力必须通过各领域 Application API 或 Application Capability 执行，并保留 CAS、事务、Changeset 和删除约束。不能用一个通用 `workspace.write(any)` 绕过领域合同。

Secret 明文、任意宿主文件、任意网络和 Trusted Bash 不属于普通 Workspace Authoring 权限。

### 7. Binding 生命周期

- 新建 Session 时明确选择 Workspace Context 或 Narrative Timeline Context。
- 显式解绑保留 Agent Profile 与完整 Transcript，只移除默认 Narrative Context；解绑本身不改变 Tool Set 或 Capability Grant。
- 第一版不允许把现有 Session直接重新绑定到另一个 Timeline；需要新的 Session，未来有正式 Fork 后再支持带来源创建。
- Timeline 删除后不把关联 Session 自动转换为 Workspace Session。保留原 `timelineId` 作为失效 Binding，UI 显示目标已删除；用户再明确选择解绑或删除 Session。
- Session 历史中的 PromptBuild、Invocation 和 Changeset provenance 不因解绑或目标删除而改写。
- Binding 修改必须拒绝正在执行或等待恢复的 Run，并使用显式旧 Binding 事实防止并发覆盖；不能只执行无条件 `UPDATE timeline_id`。

## 非目标

- 不把本计划扩成完整 RBAC / ABAC、组织账户或多用户权限系统。
- 不实现 CLI、MCP Server / Client、CodeAct Sandbox 或 Trusted Bash。
- 不重新设计 Provider、Agent Transcript、Tool Transport 或 Agent Loop。
- 不把完整 Workspace 自动注入 Prompt。
- 不让 Workspace Agent读取 Secret 明文或绕过 Secret Store。
- 不在本计划实现游玩面板、Session 列表或 Agent 唤起菜单视觉 UI。
- 不承诺任意 Application RPC 都迁移为 Capability。

## 工作包与文件边界

### WP1：Session Binding 正确性与生命周期

**主要写入**：

- `packages/agent-store/src/types.ts`
- `packages/agent-store/src/store.ts`
- `packages/application-runtime/src/types.ts`
- `packages/application-runtime/src/runtime/agents-runtime.ts`
- Studio Server 对应 Agent Session RPC codec / handler
- Agent Store 与 Application Runtime 定向测试

修复单项 Session 读取丢失 `timeline_id`；增加显式解绑 Command 与旧 Binding 检查；正在运行或 suspended Run 时拒绝解绑；不增加新的 Session 所有权或 Branch Header 字段。

**完成条件**：Create、Get、List 对 Binding 一致；解绑保留 Transcript 和 Profile；失效 Timeline Binding 不自动变成 Workspace；并发或运行中解绑明确失败。

### WP2：统一 Agent Execution Context

**主要写入**：

- `packages/application-runtime/src/runtime/agents-runtime.ts`
- `packages/application-runtime/src/agents/agent-turn.ts`
- `packages/application-runtime/src/agents/tool-registry.ts`
- 相邻 PromptBuild / Runtime 类型和定向测试

在一次 Turn 开始时统一解析 Workspace / Narrative Context、默认 Target 与显式 Target。绑定 Session 的跨 Timeline Narrative Target 明确拒绝；Workspace Session 的显式 Target 保持临时事实。Client 不再自行拼装一套与 Runtime 不一致的 Binding 规则。

**完成条件**：PromptBuild、Tool Scope、Trace 和 Invocation 使用同一 Execution Context；不存在 Session 显示绑定 A、Turn 静默作用于 B 的路径。

### WP3：PromptBuild 资源装配

**主要写入**：

- `packages/application-runtime/src/runtime/agents-runtime.ts`
- `packages/application-runtime/src/prompt/`
- `docs/architecture/application/agent/provider-and-prompt-build.md`，只在实现和测试完成后晋升
- Agent PromptBuild 定向测试

明确 Workspace 与 Narrative 两种 Context 的默认 Source。Workspace Context 不遍历注入完整 Workspace；Narrative Context 继续使用 Timeline Runtime Context、State、Setting 与 History。显式 Tool Result / Pin 仍通过已有受控投影进入后续 Prompt。

**完成条件**：Workspace Agent 不意外获得任意 Narrative 注入；Narrative Agent 获得正确 Timeline / Branch 投影；同一 Session 的 Trace 可以解释每个 Source 来源。

### WP4：Target Policy 与代表性 Workspace Capability

**主要写入**：

- `packages/application-runtime/src/agents/`
- Application Capability 首个实际包 / 模块，位置由 [`application-capability-cli-mcp-adapters-plan.md`](./application-capability-cli-mcp-adapters-plan.md) 的 Phase 0 决定
- 代表性领域 Runtime API 与定向测试

先选择一个真实 Workspace Authoring 垂直切片，推荐 Prompt Resource Search / Read / Update。现有 RPC 与 Agent Tool 调用同一领域 Query / Command；写入保留 CAS 与 Changeset。证明边界后再扩展 Card、Setting、导入导出，不批量包装全部 RPC。

**完成条件**：Workspace Agent 可以通过明确 Tool Target完成一项真实跨资源读写；Narrative Binding 不自动授予该能力；未挂载 Tool、缺少 Grant 或 Target 越界时明确拒绝。

### WP5：Approval、审计与 CodeAct 接缝

**主要写入**：

- 现有 Agent Tool Approval / Runtime Policy 模块
- Application Capability Context
- CodeAct 计划中的 API Proxy 合同，只在其实施阶段修改
- Agent Runtime、Changeset 与 Trace 定向测试

Query、可撤销局部 Command、大范围 / 不可逆 Command 与外部副作用使用不同 Approval Policy。Script / CodeAct 的子调用产生独立 Tool Invocation 并关联父调用。Secret、任意文件和主机执行保持拒绝。

**完成条件**：高风险 Workspace 写入不会因 Session 为 Workspace Context 自动放行；批准、拒绝、Target、Changeset 与调用链可查询；CodeAct 不能旁路 Capability。

### WP6：Client 接线依赖

本工作包只交付 UI 所需的稳定 API 与事实，不实现 UI：

- 列表可区分 Workspace、有效 Narrative Binding 与失效 Binding；
- 打开 Session 前可以读取其解析后的 Context；
- 显式解绑返回 Mutation Receipt 与失败原因；
- Tool / Prompt Inspector 可以显示 Effective Context、Capability 与 Target。

完成后由 [`ui/play-and-session-navigation-plan.md`](./ui/play-and-session-navigation-plan.md) 接线显示、跳转和唤起。

## 依赖与实施顺序

```text
WP1 Binding 正确性
  -> WP2 Execution Context
     -> WP3 PromptBuild
     -> WP4 Workspace Capability Slice
        -> WP5 Approval / CodeAct 接缝
           -> WP6 UI API
```

- WP1 / WP2 是 UI 会话切换与 Workspace Agent 的前置合同。
- Application Capability 计划从 WP4 开始提供共享执行边界；CLI / MCP 不阻塞前面的 Agent Context 修复。
- File-backed Script / CodeAct 计划依赖 WP2、WP4、WP5，不得提前猜测 grants 或直接调用 Store。
- AI SDK Foundation 不需要重开已完成 Phase；本计划复用其 Agent Loop、Tool Registry 和 Transcript。

## 验证预算

主要风险是权限提升、错误 Target、Prompt 泄漏和 Binding 失真。

1. Agent Store 定向测试：Create / Get / List Binding 一致、显式解绑、失效 Binding、运行中拒绝。
2. Application Runtime 定向测试：绑定 Session 拒绝跨 Timeline Target；Workspace Session 显式 Target 不持久绑定；Trace 记录实际 Target。
3. PromptBuild 定向测试：Workspace Context 不注入 Card / Narrative / Timeline State；Narrative Context 使用正确 Timeline / Branch。
4. Tool / Capability 定向测试：挂载、Grant、Target Policy 与 Approval 分别拒绝；Workspace 写入产生真实 Changeset。
5. CodeAct 实施时追加：API Proxy 不能访问未授权 Capability、Store 或物理路径，子调用保留 parentCallId。

公共 Agent / RPC 类型改变时运行相关 package TypeScript 检查。只有新增 Package、跨包导出或构建入口时运行相关 Build；不默认运行全仓测试。

## 停止条件

- 需要把 Agent Session 变成 Timeline 所有对象或增加自动级联删除；
- 需要默认注入完整 Workspace 或向 Agent 暴露 Secret 明文；
- 需要通用管理员布尔值、完整 RBAC / ABAC 或多用户角色迁移；
- 需要 CodeAct / Script 直接访问 Runtime、Store、SQLite 或宿主文件系统；
- 代表性 Workspace Capability 无法在不复制 RPC 业务逻辑的情况下抽取；
- 解绑与运行中 Agent Run 的冲突无法通过现有 Run 状态判断，需要新的恢复状态机公共合同。

遇到这些情况时停止受影响工作包，记录当前调用链、失败语义和互斥方案，由主 Agent重新确认。

## 开放外部阻塞

- 正式 Permission UI、Grant 继承与 suspended Run 恢复仍未完成；WP5 只能在对应 Agent Runtime 合同具备后闭环。
- CodeAct Sandbox / Host 尚未实施；本计划只固定它必须消费的 Capability 边界。
- Workspace Authoring Tool 的完整集合需要依据真实领域 API 分批增加，不能在本计划中预先列举并包装全部操作。

## 最终结果

待实施后填写实际完成范围、偏差、验证结果、未验证项与剩余风险。

