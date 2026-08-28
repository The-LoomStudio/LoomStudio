# oh-my-pi 架构与工程实践对照参考

> **状态**：两轮静态审计完成；已吸收独立复审修正
> **日期**：2026-08-27
> **对照快照**：oh-my-pi `37eee71978951fccf66b21f7e3e2b74596ac9d74`；LoomStudio `7e69867978b1543e0ddea51ecc22b5cb542ab9d7`
> **范围**：Agent Runtime、会话、工具、Provider、扩展、上下文维护、多 Agent、可观测性、性能、测试、构建与发布，以及具体编码约束。
> **说明**：本文是外部项目源码参考，不是 Architecture、ADR 或已批准实施计划。LoomStudio 快照存在未提交业务改动；涉及这些文件的判断只描述当前检出状态，不将其自动晋升为稳定合同。

---

## 1. 结论

oh-my-pi（下文简称 OMP）最值得 LoomStudio 学习的，不是 Bun、Rust、TUI、工具数量或供应商数量本身，而是它在长期真实使用后形成的**运行时失败语义和交付闭环**：工具调用在流式中断后的配对修复、执行状态的精细区分、会话恢复、长上下文维护、Provider 差异归一、扩展失败隔离、安装烟雾验证，以及把真实事故固化为代码注释、测试和仓库规则。

LoomStudio 不应据此替换现有架构。当前实现已经具备 OMP 没有同等强调的优势：Kernel 与 Application 分离、共享 SQLite Data Engine、领域专用 Store、Commit Fact、Prompt Resource 与可追踪 PromptBuild、Package / Module / Instance 三层 Extension 身份、默认拒绝的 Host capability，以及 Client / Server 明确边界。这些是 Studio 产品形态的核心，不应为了模仿 Coding Agent CLI 而倒退成一个巨型 AgentSession 或无边界的进程内插件系统。

当前最有价值的学习顺序是：

1. **P0：澄清 Agent / Narrative 原子提交合同**——正式 Data Architecture 声称二者位于同一 transaction / Changeset，当前实现却先提交 Agent transcript、再单独提交 Narrative；必须先决定修正文档还是实现。
2. **P0：建立最小 CI 基线**——冻结安装、workspace 检查、类型/构建、测试和扩展 smoke；不复制 OMP 已为两千余测试和跨平台二进制演化出的复杂分片器。
3. **P0 审计：Agent Turn Integrity**——以 OMP 的流式半成品、synthetic result、部分执行和并发调度经验，只读验证 LoomStudio 的真实失败窗口；确认具体链路后才形成修复计划。
4. **P1：先闭合 Session discovery 与容量可见性**——提供 list/reopen/delete/稳定路由，并把当前“最近 100 条”硬截断变成可检查事实，再讨论 fork、retry 和 compaction。
5. **P1：建立 Provider Compatibility Ledger 与端到端 Streaming 合同**——把 wire 差异、重试条件、工具 schema、stop reason 和 stream terminal 变成数据与回归样例。
6. **P1：把 Agent Run 事实接入持久可观测闭环**——先从 Agent Store 与 Commit Fact 派生；TraceAudit 和 PromptBuild trace 当前仍是易失事实，不能假装可跨重启聚合。
7. **P2：按真实场景引入 MCP、Skill、子 Agent、Advisor 和 Marketplace**——先完成权限、所有权、取消和持久化，再扩生态入口。

明确不建议现在做的事：切换 Bun、引入 Rust/Bazel/Nix、复制 OMP 的全部工具或 Provider、合并 Narrative 与 Agent Session、把 Extension Host 改成 OMP 式自由注册总线、或为了“成熟”提前建设复杂发布流水线。

---

## 2. 审计方法与证据边界

本次对照直接读取两个本地仓库的当前源码、正式文档、测试、manifest、CI 与 Git 历史；没有安装依赖、启动浏览器、运行完整测试或执行外部网络调研。

规模只用于解释成熟度背景，不用于评价设计优劣。当前快照中：

| 指标 | LoomStudio | OMP | 解释限制 |
|---|---:|---:|---|
| Git tracked files | 743 | 6,238 | OMP 包含 TS、Rust、Python、Web、基础设施和生成物 |
| 测试文件候选 | 120 | 2,169 | 文件命名与测试框架不同，只能反映量级 |
| Git commits | 53 | 18,367 | OMP 是 fork 并继承长期历史 |
| `shortlog` 身份数 | 1 | 519 | 包含机器人、别名和上游贡献者 |
| tags | 0 | 809 | LoomStudio 当前仍是 `0.0.0`，OMP 快照是 `17.3.5` |

因此本文采用三类结论：

- **已实现事实**：当前源码或正式文档可以直接确认；
- **工程判断**：基于双方实现差异得出的借鉴价值与优先级；
- **开放问题**：需要运行时测量、产品场景或单独方案确认，本文不替代决策。

---

## 3. 产品边界不同，不能做一比一移植

### 3.1 OMP

```text
CLI / TUI / RPC / ACP
  -> Coding Agent Session
      -> pi-agent-core Agent Loop
          -> pi-ai Provider normalization + streaming
          -> Tool execution / steering / hooks
      -> JSONL session tree + blobs + artifacts
      -> Extensions / MCP / Skills / LSP / subagents / advisor
  -> Native Rust fast paths / install / release / stats
```

OMP 的中心对象是“在一个工作目录中持续工作的 Coding Agent Session”。大量能力围绕终端交互、代码搜索与编辑、进程执行、会话恢复、并行子 Agent 和多 Provider 兼容展开。

### 3.2 LoomStudio

```text
Studio Client
  -> typed Client Bridge / RPC
      -> Studio Server composition root
          -> Application Runtime
              -> Narrative / Agent / PromptBuild / Provider / Tool
              -> domain Stores on shared SQLite Data Engine
          -> Kernel / Transport / Extension Host
          -> Blob / Asset / Secret / Logging / Trace Audit
```

LoomStudio 的中心对象不是单个 Coding Session，而是可编辑、可持久化、可投影的 AI Application 数据与运行时。Narrative Timeline、Agent Session、Prompt Resource、Document、Asset、State 和 Extension 有独立权威边界。

这意味着 OMP 的“一个会话承载一切”适合 Coding Agent，但 LoomStudio 应继续保持：

- Narrative 内容权威属于 Narrative Store；
- Agent transcript 权威属于 Agent Store；
- Prompt source / ordering / activation 属于 Prompt Resource 与 PromptBuild；
- Kernel 不承载 Provider、Agent 或 Prompt 业务；
- Extension 通过 Host capability 使用平台能力，而不是取得内部 Store 或 Kernel 对象。

---

## 4. 总体对照矩阵

| 维度 | OMP 当前事实 | LoomStudio 当前事实 | 判断 |
|---|---|---|---|
| Agent Loop | 流式事件驱动，支持 steering、deadline、pause、重试、工具批次与运行级 telemetry | 已有有界 Provider/Tool Loop、run-state、审批、超时、abort 和 transcript | Loom 已有骨架；应借 OMP 的失败语义和流式完整性，不重写 |
| 工具调用 | Native/custom wire、动态工具、并发 shared/exclusive、partial update、synthetic result | structured/freeform/hybrid 输入；native/content/provider-custom transport；当前执行按调用顺序串行 | 先补完整性和状态语义，再决定并发与 streaming |
| 会话 | JSONL append-only tree、leaf pointer、branch/fork/resume、migrations、blob/artifact externalization | SQLite append-only Agent entries，`expectedEntryCount` 乐观并发；当前无 Session list/search/reopen 产品链 | Loom 持久化边界更适合 Studio；第一缺口是发现与恢复入口，不是复制树算法 |
| Context | 自动 compaction、branch summary、机械 pruning、provider-native compaction、可选图像压缩 | PromptBuild 可追踪；每次只取最近 100 条 Agent Entry 与最多 100 个 Narrative Node | 当前是无摘要、无 token budget、无诊断的计数截断，不等同 compaction |
| Provider | 多 API、多 dialect、大量 registry/quirk/schema/retry 处理 | 4 个官方 adapter + fake；底层 Gateway 有 stream/cancel，Application/RPC/Client 仍是 complete request/response | 建 compatibility ledger；不要把底层 streaming 写成端到端已实现 |
| 扩展 | 进程内自由注册 tools/commands/hooks/renderers/providers，兼容面广 | Package/Module/Instance、manifest declaration、grant、scope cleanup、默认拒绝；Server 同进程 | Loom 治理更强；可借发现/生态 UX，不应放松 capability |
| MCP/LSP/Skills | 已实现发现、缓存、重连、工具桥接、语言服务与技能生态 | 未形成同等通用生态 | 按应用场景引入，不作为 Agent 核心前置条件 |
| 多 Agent | 子 Agent、并行执行、输出 artifact、父子通信、collab/advisor | Workbench 有设计讨论，当前正式实现未形成通用 orchestration | 先建立 owner、session、permission、cancel、durable event 合同 |
| Memory | 可替换 backend；Mnemopi 是可选本地 SQLite 实现，`local` backend 生成 MEMORY/summary/skills | Prompt Resource / State / Narrative 不等同通用 Memory | 学 backend/scope/lifecycle，不默认引入向量数据库 |
| 可观测性 | Agent telemetry、OpenTelemetry、local stats、session audit、结构化日志 | 持久 transcript/Commit Fact + 结构化日志；TraceAudit 为内存，PromptBuild trace 随请求返回 | 先区分持久事实与易失诊断，再补 Agent Run 聚合 |
| 性能 | Rust native text/search/media/PTY，TUI differential render，缓存与 benchmark | Node/React/SQLite；PromptBuild/Core 有确定性与 trace | 只在测量后下沉热点，不引入第二语言作为成熟度装饰 |
| 测试 | 大量行为回归、CI 分桶、安装 smoke、release script tests | 分层 unit/integration/contract/probes，当前没有 tracked CI workflow | 先建简单 CI；复用 Loom 已有测试分类 |
| 发布 | 多包 changelog、版本同步、binary/npm/Nix/Homebrew、checksums、原子 tag/push；默认 installer 尚未消费 checksum | 私有 `0.0.0` workspace，无发布链 | 在有分发目标前只做可重复 build、digest verification 和 smoke |
| 文档/AI 规则 | 大量专题 docs；根 AGENTS.md 记录事故驱动的硬约束与验证路径 | Stable/Workbench 双轨和项目地图成熟；仓库中无 tracked `AGENTS.md` | 增加短小根级 AI 入口很有价值，但不要复制 298 行规则 |

---

## 5. LoomStudio 已经做得更好的部分

### 5.1 领域权威比 OMP 的 Session 中心模型更清楚

LoomStudio 明确把 Application Runtime 作为业务编排层，把 Agent、Narrative、Prompt Resource、Document、Asset、Blob、State 和 Secret 分到不同 package。项目地图还明确禁止 Kernel 包含 AI/业务逻辑。对 Studio 这种可视化 Application 平台，这比把大多数状态折叠进 session JSONL 更稳。

证据：`docs/guide/project-structure.md:111-166`、`packages/agent-store/src/types.ts:8-165`。

### 5.2 SQLite 事务、Commit Fact 与乐观并发更适合多消费者

Agent Store append 要求调用者提供 `expectedEntryCount`，冲突时显式失败；同一事务更新 session head/count、写入 transcript、更新 tool invocation 配对索引并记录 commit operations。相比 OMP 文件 session 的单进程追加模型，这更适合 Server、Client、Extension 和未来后台任务共享数据。

证据：`packages/agent-store/src/store.ts:83-140`、`packages/agent-store/src/types.ts:102-165`。

### 5.3 PromptBuild 是一等、可检查的领域流程

LoomStudio 把资源 source、contribution、zone/slot/order、activation、variable trace 和最终 provider message 分开；Agent Turn 只是把 Narrative、Session History 和 Current Input 转换为运行时 source，再交给 Core 编译。OMP 的 prompt 工程规模更大，但很多能力仍服务于 Coding Session；Loom 的 composition model 更适合成为可编辑产品能力。

证据：`packages/application-runtime/src/agent-turn.ts:22-126`、`packages/application-runtime/src/agent-turn.ts:129-332`。

### 5.4 Extension 治理模型比 OMP 更适合作为平台合同

LoomStudio 已经区分 Package、Module 和 Instance；Manifest declaration 与 runtime registration 会互相校验；Module grant 不从 sibling 继承；Host 不暴露 Kernel/SQL/internal Registry；dispose 先 abort、等待 callback，再按反序释放。OMP Extension 的生态入口更丰富，但本质仍是同进程可信代码和共享 runtime。

证据：`docs/architecture/extensions/README.md:15-49`、`:94-120`、`:176-187`；OMP `docs/extension-loading.md:219-239`。

### 5.5 已有 Agent Tool 基础不应被重复建设

LoomStudio 已支持：

- structured / freeform / hybrid 输入；
- native-function / provider-custom / content transport；
- tool definition 与 runtime registration 分离；
- invocation schema validation；
- approval、deny、timeout、abort；
- Tool Execution Scope 限定 Context 与 State；
- transcript 中独立记录 provider observation、reasoning、invocation、result 和 run-state；
- Provider step 上限和终态持久化。

证据：`packages/application-runtime/src/agent/tool-registry.ts:20-199`、`:201-390`、`:486-745`；`packages/application-runtime/src/agent/tool-loop.ts:231-495`；`packages/agent-store/src/types.ts:19-90`。

后续工作应直接审计这些现有合同，不应另建第二套 Agent Runtime。

---

## 6. 最值得借鉴：Agent Turn 完整性

### 6.1 OMP 的成熟不在“会调用工具”，而在“失败后历史仍然是真的”

OMP 处理了多种容易被简单 Agent Loop 忽略的边界：

- Provider 已流出 tool call，但在参数完成前报错或被取消；
- `stopReason=length` 时尾部 tool arguments 可能不完整，绝不能执行；
- 某个工具开始后被 steering 中断，可能已经产生部分副作用；
- 工具已经完成，但 abort 恰好随后到达，不能把真实结果覆盖成 skipped；
- 同一批工具里，有的执行、有的尚未开始；
- Provider 要求每个 tool use 都有 tool result，即便本地从未执行；
- extension hook 修改参数或结果后，必须重新校验，不能把畸形数据写进 session。

OMP 用 synthetic result 明确标记 `executed: false`，另用 interrupted metadata 表示“进入执行但可能部分完成”，并在 Provider error/abort/length 时保持 tool call/result 配对。

证据：OMP `packages/agent/src/agent-loop.ts:1239-1275`、`:2559-2616`、`:2754-2858`；回归测试见 `packages/agent/test/agent-loop.test.ts:988-1061`、`:1483-1800`、`:4555-4676`。

OMP 还把 Tool 调用的单一事实源顺序固定为：参数解码与初次校验 -> `beforeToolCall` 改写 -> 重新校验 -> 写回 Assistant Tool Call -> 重新解析审批 -> 持久化/调度/执行。这样 UI、历史、审批、Provider replay 与 executor 不会分别看到不同参数。证据：OMP `packages/agent/src/agent-loop.ts:2135-2225`、`packages/coding-agent/src/extensibility/extensions/wrapper.ts:184-251`。

这条规则对 LoomStudio 的实际意义是：当前还没有 Extension 动态改写 Tool 参数，不需要预建空 Hook；未来开放该能力时，必须审批最终 effective input，而不是原始 Provider input。

### 6.2 LoomStudio 当前已经覆盖了一部分

LoomStudio 当前会：

- 在调用前持久化 `tool-invocation`；
- 每个结果后持久化 `tool-result`；
- abort 时写 synthetic reason；
- provider/loop 失败时尽力写 `run-state=failed|aborted`；
- timeout 与外部 abort 合并到 per-tool signal；
- 用 invocationId/toolId 校验 executor 返回值。

证据：`packages/application-runtime/src/agent/tool-loop.ts:356-475`、`:656-799`；`packages/application-runtime/src/agent/tool-registry.ts:300-390`；测试 `tests/integration/application-runtime/native-tool-loop.test.ts:334-392`。

已注册 Executor 的普通 throw 会在 Tool Registry 内被归一成 `status=failed` Result，因此不能把普通业务异常直接描述成 orphan 来源。真实需要审计的窗口是：缺少 Runtime Registration、Executor 返回畸形或 identity mismatch Result、Result append 失败，以及 Invocation commit 后进程崩溃。证据：`packages/application-runtime/src/agent/tool-registry.ts:311-343`、`:362-378`；`packages/application-runtime/src/agent/tool-loop.ts:424-435`。

### 6.3 仍应专项审计的缺口

以下是**审计候选**，不是已经确认的 bug：

| 候选 | 当前代码信号 | 需要证明的合同 |
|---|---|---|
| Tool Loop 尚未消费 Gateway stream | `runNativeToolLoop()` 调用 `invokeChat()`；Gateway 另有 stream API | partial tool args、partial reasoning、网络中断时 transcript 是否仍可恢复 |
| 同批工具串行执行 | `for ... await executeInvocation()` | 是否需要 shared/exclusive；副作用工具默认必须串行 |
| `stopReason=length` + tool call | 当前只在无 invocation 时拒绝 length | 若 Provider 返回截断 tool call，是否可能进入执行 |
| Invocation 状态没有逐步更新 | transcript 写 `proposed`，之后直接 result | UI/恢复是否需要 waiting-approval/running，或这些枚举应删减 |
| abort race | `raceWithAbort()` 可先 reject，但底层 Promise 不一定停止 | executor 不合作时如何防止晚到结果或后台副作用被误判 |
| Provider-custom transport | registry 可选择，但 loop 目前只形成 native/content pair | 未支持时应在编译阶段 fail-fast，还是明确 deferred |
| orphan repair | transcript 类型有 `orphan-repair`，当前写入链需反查 | Server 崩溃后是否存在可执行恢复器与可见诊断 |
| 同 Step 多 Invocation 中途异常 | Invocation 会先批量落库，Result 再逐个追加 | 缺 registration、mismatched result、Result append 失败或进程崩溃后，剩余 Invocation 是否得到 synthetic Result |

建议先写一篇 `Agent Turn Integrity` Workbench 方案和一组最小回归表，再决定是否改循环。不要直接移植 OMP 三千行 Agent Loop。

专项审计至少应固定七条候选不变量：

1. Provider 已产生的每个 Invocation 最终必须有且只有一个 canonical Result；
2. effective input 同时用于校验、审批、持久化、执行和 replay；
3. user abort、transport failure、length truncation、tool timeout 和 recovery failure 是不同状态；
4. AbortSignal 只证明取消请求，不自动证明外部副作用已停止；
5. Provider 并发槽只覆盖 Provider 请求，不能覆盖等待子任务的整个 Agent 生命周期；
6. Compaction 不得切断 Tool 配对；
7. 外部副作用或持久化状态不确定时 fail closed，并保存可检查的不确定状态。

当前串行 Tool Loop 可以继续把工具视为 exclusive 默认值，不需要为了对齐 OMP 立刻建设通用 Scheduler。只有加入第一个长生命周期、并行或外部副作用 Tool 时，才应最小增加两个正交合同：`concurrency: shared | exclusive` 与 `cancellation: hard | cooperative | wait-only`；否则单一 AbortSignal 会把“停止等待”和“外部副作用已经停止”混为一谈。证据：OMP `packages/agent/src/types.ts:761-793`、`packages/agent/src/agent-loop.ts:2230-2379`、`:2641-2749`。

---

## 7. 会话、恢复与长上下文

### 7.1 OMP 的会话模型

OMP session 是 append-only JSONL。非 header entry 通过 `id/parentId` 形成树，当前分支由 leaf pointer 表示；branch、fork、resume、move、migration、title slot、blob externalization 和 artifact spill 都围绕这一模型工作。Compaction 与 branch summary 是一等 entry，重建上下文时再投影为 LLM message。

证据：OMP `docs/session.md:35-68`、`:96-130`、`:207-273`；`docs/compaction.md:27-45`。

### 7.2 LoomStudio 不应复制一个统一 Session Tree

LoomStudio 已经把 Narrative branch 与 Agent transcript 分开。这个差异是正确的：叙事内容分支和 Agent 工作过程不是同一种对象。OMP 的 session tree 可以启发 Agent Session 的 retry/fork/rewind UX，但不应成为 Narrative 的替代存储。

Loom Agent Store 当前也保存 `parentEntryId` 和 `headEntryId`，但 append API 按当前 head 线性追加，并没有 OMP 那套 leaf navigation、branch summary 和 context rebuild 语义。

证据：`packages/agent-store/src/types.ts:8-17`、`:92-100`；`packages/agent-store/src/store.ts:103-140`。

当前 Runtime 每次 PromptBuild 明确只取 Narrative 与 Agent Session 最近 100 条，并在代码中用 `ponytail` 标记“更大历史需要显式 context-window policy”；这不是 Compaction，也不是完整历史投影。Client 虽能按已知 `agentSessionId` 分页读完 transcript，但 RPC/Client 没有通用 `listAgentSessions` 与历史 Session 重开入口，当前面板只展示本地已持有的两个 Session。证据：`packages/application-runtime/src/runtime.ts:1874-1882`、`:1942-1944`；`apps/studio-client/src/shared/api/studio-api.ts:321-322`、`:452-455`；`apps/studio-client/src/widgets/sessions-panel/sessions-panel.tsx:25-27`。

更准确地说，Agent Store 与 Application Runtime public surface 都没有 `listSessions`；Client API 也没有 delete 投影。当前更靠前的产品断点不是 fork 算法，而是 Session discovery：需要可分页列表、按 ID 重开、删除和稳定路由，否则重启后的持久 Transcript 对普通用户不可发现。证据：`packages/agent-store/src/types.ts:144-165`、`packages/application-runtime/src/types.ts:102-105`、`apps/studio-client/src/shared/api/studio-api.ts:320-326`、`apps/studio-client/src/widgets/sessions-panel/sessions-panel.tsx:22-27`、`:114`。

OMP 的 Session Storage 还把 append 短写、atomic rewrite、late write 和 dispose/revive race 变成显式恢复语义：写入失败可进入 divergent/indeterminate，terminal seal 防止旧异步写覆盖已恢复会话。LoomStudio 使用 SQLite，不需要复制 JSONL rewrite 算法，但仍需要回答 Provider 已执行而结果未落库、进程崩溃和未知外部副作用时的状态。建议最小区分 `healthy / recoverable / repairing / indeterminate`，未知时 fail closed。证据：OMP `packages/coding-agent/src/session/session-storage.ts:15-195`、`session-manager.ts:686-1017`、`:1797-1838`、`:2454-2515`。

Retry 也不应只表现为一个按钮。未来若出现自动或用户重试，最小 `RunAttempt` 事实应包含 `attemptId`、`runId`、`parentAttemptId?`、`trigger`、`providerCallId?`、`startedAt`、`terminalState`、`errorClass` 与 `outputStarted`；只有可重试传输错误、尚未产生输出且请求可安全重放时，才允许自动继续同一策略，其他情况都创建用户可见的新 Attempt。

### 7.3 最小可借鉴层级

1. **先做 Context Budget Fact**：每次 Provider step 记录输入估算、保留区间、裁剪原因和策略版本。
2. **先做机械策略**：限制超大 tool result、artifact 外置、按类型裁剪可再取数据；避免一开始就让模型总结一切。
3. **再做 summary entry**：摘要必须是独立 transcript entry，保存来源边界、策略版本、tokens before/after 和失败回退。
4. **最后考虑 Agent Session fork/rewind**：只有 UI 和使用场景明确需要时再增加；Narrative 继续使用自己的 Branch 模型。
5. **不照搬 Snapcompact**：图像化上下文是 OMP 针对视觉模型和 Coding Session 的实验性优化，不是 LoomStudio 的默认基础设施。

OMP 的 Compaction 还提供两个值得直接写进 Loom 设计审查的问题：cut point 永不落在 Tool Result 上，并识别 split turn；Provider 报告 token 与本地持久历史估算取较大值，避免 wire compression 隐藏真实增长。Provider-native preserve 只有当前模型可重放时才复用，切换 Provider 必须能回到原始历史或本地摘要。证据：OMP `packages/agent/src/compaction/compaction.ts:336-358`、`:534-686`、`:1222-1273`。

因此 Loom 的最小 Compaction 不应删除 canonical Transcript。更稳的形态是新增可审计的 projection boundary/summary artifact，保存 source range、策略版本、tokens before/after 和 fallback；Provider replay 使用 summary + retained tail，历史查询仍可回到原 Entry。

### 7.4 当前存在的 Agent/Narrative 原子提交合同冲突

正式 Data Architecture 声称 `narrativeTarget.commit=true` 时，Agent 两条 Message 与 Narrative Nodes 位于同一个 Data Engine transaction/Changeset；当前实现却先由 Tool Loop 分阶段提交 Agent Transcript，Loop 成功后才开启单独 Narrative transaction，返回的 narrative changeset 也不能代表此前 Agent commits。证据：`docs/architecture/data/README.md:118-122`；`packages/application-runtime/src/agent/tool-loop.ts:264-267`、`:395-435`；`packages/application-runtime/src/runtime.ts:1136-1165`、`:1187-1193`。

这是已确认的文档/实现冲突，不是 OMP 推导出的候选。应先决定以实现为准修正 Architecture，还是重构提交边界；在此之前不能宣称 Agent/Narrative 跨领域原子提交。该问题的优先级高于尚未证明可触发的通用 streaming/orphan 候选。

---

## 8. Provider 兼容：从“适配器列表”升级为“兼容性资产”

OMP 的 Provider 成熟度来自四层协作：

```text
Model Catalog / identity
  -> Provider registry / auth
      -> request and schema adaptation
          -> streaming event normalization / retry / quirks
```

其源码包含大量 provider registry、OAuth、wire schema、tool schema compatibility、dialect、stream healing、error classification 和 usage 归一逻辑。重要经验不是支持 60+ Provider，而是**把差异集中在边界并留下回归样例**。

OMP 在每次 Provider 请求前重新执行 Agent Message transform、LLM conversion、Provider normalization 和 Provider context transform；model、reasoning、service tier、credential metadata 与 cwd 也可按请求重新解析。这说明“Session 绑定某 Provider”不应等于把一次启动时的解析结果永久缓存。证据：OMP `packages/agent/src/agent-loop.ts:1514-1649`。

LoomStudio 已经有正确起点：Provider Profile 与 Secret Ref 分离；Registry 解析 official adapter；Gateway 统一 `finishReason`、usage、stream event 和 terminal event；Application Runtime 不直接保存 credential 明文。

证据：`packages/ai-gateway/src/provider-registry.ts:45-129`、`packages/ai-gateway/src/gateway.ts:24-220`、`packages/application-runtime/src/gateway.ts:95-203`。

这里必须限定层级：底层 `@loom-studio/ai-gateway` 确实已有 complete/stream Run、事件和 cancel；Application `AiGateway`、Agent Tool Loop、RPC 与 Client 尚未端到端暴露它。Client Bridge 仍是 HTTP request/response，`connect()` 只切换本地状态。当前正式 Agent Turn 因而仍是完整响应 Promise，不能宣称 Agent Runtime 已支持流式执行。证据：`packages/ai-gateway/src/types.ts:59-73`、`packages/ai-gateway/src/gateway.ts:24-72`；`packages/application-runtime/src/types.ts:522-526`；`packages/client-bridge/src/index.ts:18-66`。

建议增加一个小型 compatibility ledger，每个已支持 adapter 只记录真实需要的字段：

| 字段 | 目的 |
|---|---|
| provider / API family / model pattern | 精确定位差异，不把模型名散落在逻辑里 |
| tool schema 限制 | strict、additionalProperties、nullable、enum、custom tool 支持 |
| message/reasoning replay | 哪些 provider metadata 必须保留，哪些不能跨 provider 重放 |
| stop reason mapping | raw -> normalized，并保留 raw 值 |
| retry class | auth、rate limit、overload、context overflow、network close 是否可重试 |
| streaming quirks | 空 delta、半截 JSON、重复 done、usage 时机、early close |
| regression fixture | 可执行最小样例和预期事件序列 |

不要现在复制 OMP 的 provider 数量、model catalog 生成器或 OAuth 表面。先让 4 个正式 adapter 的合同完整、可测、可诊断。

Retry 也应由 ledger 驱动。Loom Gateway 当前主动设置 `maxRetries: 0`，这是正确边界；未来自动重试至少需要同时满足 `retryable transport && 尚未产生输出 && request replay-safe`。产生 Delta、执行 Tool 或存在外部副作用后，重试必须形成新的 Attempt，不能伪装成原调用无事发生。证据：`packages/ai-gateway/src/gateway.ts:117-133`；OMP `packages/coding-agent/src/session/turn-recovery.ts`、`docs/non-compaction-retry-policy.md`。

---

## 9. 工具与生态能力

### 9.1 MCP

OMP 的 MCP 价值不只是“能列工具”，而是生命周期处理：并行连接、startup gate、缓存命中时 deferred tools、后台晚注册、断线重连、熔断、session dispose 的有界清理，以及子 Agent 复用父连接。

对 LoomStudio 的启发是：若引入 MCP，应当作为 **Agent Tool Provider / Extension capability adapter**，而不是直接把 MCP Client 塞进 Application Runtime。必须先决定：

- Server 还是 Client 持有连接；
- credential 和 consent 的 owner；
- ToolDefinition 如何映射；
- session/instance dispose 如何释放；
- Extension 能否代理 MCP；
- 断线时已暴露 tool 是 stale、disabled 还是 fail-fast。

OMP 自己也展示了这套能力的代价：当前没有主动 polling health monitor；重连和熔断期间 stale Tool 可能继续注册；startup cache miss 时 Tool 会晚注册，初始 Tool 集并不稳定。250ms startup gate、deferred tool 和 late registration 是 CLI 启动延迟的折中，不是免费能力。证据：OMP `docs/mcp-runtime-lifecycle.md:105-129`、`:181-196`、`:220-232`。Loom 只有在 Runtime/UI 能展示 `stale/degraded/late-registered`，并允许运行中 Tool 集变化后，才应采用类似模型。

### 9.2 Skills

OMP Skills 是 prompt、资源和操作流程的按需发现机制。LoomStudio 已有 Prompt Resource 与 Extension Package，不应再创造一个语义重叠的永久数据类型。更合适的方向是：Skill 作为可分发 Package Resource，激活后投影到 PromptBuild 与 Tool mounts；其来源、版本和启用状态仍由现有 Package/Prompt Resource 边界负责。

### 9.3 LSP、Browser、Computer、Coding Tools

这些是 OMP 作为 Coding Agent 的产品能力，不是通用 Agent Runtime 的成熟度必选项。只有 LoomStudio 明确进入“IDE / coding application”场景，才应通过 Extension 或专门 Application 增加，不能进入 Kernel 或默认 Agent Profile。

### 9.4 Memory

OMP 将 Memory 统一为可替换 backend 生命周期，默认关闭，当前包含 `off/local/hindsight/mnemopi`。只有 Mnemopi 是本地 SQLite 检索引擎；`local` backend 会从 Session extraction/consolidation 生成 `MEMORY.md`、summary 和 skills。证据：OMP `docs/memory.md:1-10`、`:61-77`。

Mnemopi 的图/向量/多声部 recall 也不是默认真理：polyphonic recall、enhanced cache 和 proactive linking 默认关闭；子 Agent 借用 parent state；普通退出只有有界 drain，尾部 promotion/embedding 可能未完成。证据：OMP `docs/mnemosyne-memory-backend.md:42-69`、`:166-187`。

LoomStudio 的 Narrative、State 和 Prompt Resource 都不能自动等同“记忆”。未来如有真实需求，应先建立权威 Memory Document/capability，明确写入来源、owner/scope、用户可见性、删除、检索、注入、跨 Session 范围和 provenance；检索索引必须可从权威内容重建，不默认引入向量数据库。

### 9.5 子 Agent、Collab 与 Advisor

OMP 已经形成：子 Agent 发现与 spawn、并发限制、父子 steering、artifact 输出、会话 sidecar、collab 通信，以及独立 advisor/watchdog。LoomStudio 可借鉴其分层顺序：

1. 单 Agent turn 和 transcript 先稳定；
2. child session 有独立 identity、owner、model、tool grant 和 cancel；
3. 父子通信是 durable event/message，不是共享可变对象；
4. 输出通过 Artifact/Asset ref 交付，不把无限正文塞回父上下文；
5. advisor 是只读/窄工具的观察者，失败不能阻塞主 Agent；
6. UI 只是状态投影，不拥有 orchestration。

在这些合同完成前，不应直接实现“多 Agent 图编辑器”或通用群聊总线。

OMP 最值得复用的子任务细节是 Provider concurrency slot 只包围单次网络 stream，而不占据整个 Agent 生命周期；否则父任务持槽等待子任务、子任务又等待槽时会死锁。Semaphore waiter 支持 abort 移除并原地 resize；批量取消停止新调度，但等待已启动项 settle。证据：OMP `packages/coding-agent/src/task/provider-concurrency.ts:1-100`、`packages/coding-agent/src/task/parallel.ts:86-220`。

Loom 的最小子 Agent 形态应继续遵守现有领域边界：dispatch 是普通 Tool Invocation；子任务有独立 Session/Run/Attempt；父任务接收结构化 Result 或 Artifact ref；默认深度可限制为 1，但不要把“永远禁止递归”写成平台真理；轨迹可以在 UI 折叠，但不应因一次性任务而默认丢弃审计事实。

### 9.6 Approval 与副作用

OMP Tool 可声明 read/write/exec tier，最终 tier 可依赖参数；审批解析有 Tool policy、用户 policy、活动模式和 deny precedence。扩展改写参数后会重新解析审批；Provider safety check 不能被 yolo 绕过，无交互 UI 时 fail closed。证据：OMP `packages/agent/src/types.ts:833-837`、`packages/coding-agent/src/tools/approval.ts:104-218`、`packages/coding-agent/src/extensibility/extensions/wrapper.ts:240-345`。

Loom 当前 Tool registration 没有 approval handler 时默认 allow，已有 callback 也只有 allow/deny；正式 Permission UI、Grant 继承和 suspend/resume 尚未实现。证据：`packages/application-runtime/src/agent/tool-registry.ts:276-297`；`docs/architecture/application/agent/tool-system.md:67-73`。

未来最小 Policy 不必复制 OMP 的 CLI 模式，可围绕 `impact(read/write/external-exec) + scope + reversibility + source` 解析 `allow-once/allow-scope/deny`。没有 UI 且需要批准时进入 suspended 或 fail closed。有副作用 Tool 收到 AbortSignal 只表示取消请求；除非 executor 能证明，否则 UI/Transcript 不能宣称外部副作用已经停止。

---

## 10. Extension：借生态，保留 Loom 的治理

OMP 的 Extension 可以统一注册事件、工具、命令、UI renderer、Provider 和 session state，项目/用户目录发现路径丰富，单个加载失败不会阻止其他扩展。它的优势是低门槛和生态兼容。

LoomStudio 已提交的稳定优势是 Package / Module / Instance、Manifest v2、运行时注册对账、grant snapshot、instance-scoped cleanup、保留 namespace、Asset owner gate 和明确的当前未实现清单。当前工作区另有未提交的 Scoped Storage、Portable Payload 与相关 Architecture；本文只把它们视为 current dirty implementation，不将其自动晋升为稳定基线。

正确的借鉴方向：

- 增加清楚的 developer entrypoint、示例、诊断和 reload UX；
- 让声明式 tool/prompt/resource contribution 与 Module runtime registration 对账；
- 单 Module 失败继续保持局部 degraded；
- 对外部 executor/hook 返回值做 runtime validation；
- 将 Extension 安装、更新、签名和 Marketplace 作为独立 supply-chain 课题。

不应借鉴：

- 为兼容性允许 Extension 取得整个 runtime 对象；
- 把 Tool、Prompt、UI、Provider 的权限合并为一个“trusted”布尔值；
- 让 project-local module 自动启用；
- 在没有强隔离时把 Host capability 宣传为安全沙箱。

双方当前 Server Extension 都是同进程可信代码；Loom 正式文档已经如实说明 capability 不是强安全边界。这个表述应保留。

OMP Marketplace 也不是可直接复制的事务模板：其 lockfile 整文件覆盖且没有跨进程 merge/lock，plugin 代码同进程执行，uninstall/link 可能部分成功而无法完整 rollback。证据：OMP `docs/plugin-manager-installer-plumbing.md:204-260`。Loom 不应复制无锁状态文件、先删除再 link 或“安装成功即可信”的模型；现有原子安装、Package provenance 和默认禁用应继续作为底线。

---

## 11. 可观测性与恢复

OMP 在 Agent Loop 内直接产生 run summary、coverage、tool span，并用 OpenTelemetry、local stats、session audit 和 structured logger 汇总。更重要的是，很多恢复状态本身会进入 session：tool execution start、session exit、compaction、credential pin、mode change 等，因此“发生过什么”可以在重启后重建。

LoomStudio 已经有更通用的平台底座：

- provider observation 保存 raw/normalized stop、model、usage；
- run-state 保存 created/running/completed/failed/aborted 等；
- Data Commit Fact 保存 actor、reason、correlation；
- Logging 与 Diagnostics 已有正式边界；当前 TraceAudit 只有进程内数组实现；
- PromptBuild trace 可以解释单次输入投影，但当前主要作为 preview/runtime 返回值，没有持久 trace ref。

证据：`packages/trace-audit/src/index.ts:17-50`、`apps/studio-server/src/main.ts:99-100`；`packages/application-runtime/src/runtime.ts:1084-1100`。

下一步不需要先建 dashboard，而应定义 `AgentRunFact` 的最小聚合视图：

```text
run identity
  + provider steps / finish reasons / usage
  + tool proposed / approved / executed / failed / synthetic
  + timing / cancellation source
  + prompt build id / trace ref
  + terminal state / recovery action
```

第一版只能可靠地从 Agent Store 与持久 Commit Fact 派生；Log、内存 TraceAudit 和请求返回的 PromptBuild trace 可以辅助当前进程诊断，却不能作为跨重启权威来源。在宣称“重启后可解释”前，必须为 PromptBuild trace 提供持久 Artifact/ref，或明确只保存可重建所需的 source/version/boundary。只有查询成本或历史兼容证明需要时才新增聚合表，继续保持单一事实来源。

### 11.1 统一 Shutdown / Postmortem

OMP 有进程级 cleanup registry、全局 deadline、防重入、错误聚合、fatal recovery、EPIPE 与 terminal 恢复；OTLP exporter 也接入同一退出治理。证据：OMP `packages/utils/src/postmortem.ts:15-43`、`:81-208`、`:251-395`；`packages/coding-agent/src/telemetry-export.ts:195-209`。

这是 Loom 可低成本吸收的工程实践：建立一个薄的 shutdown registry，让 HTTP、Logging、Extension Host、Provider client、SQLite 和后台任务注册幂等 disposer，统一 deadline 与错误聚合。不要为每个 Composition Root 继续维护互不一致的退出分支。

### 11.2 Secret at rest 与 Provider 出站保护是两层能力

OMP 的 secret obfuscation 是可选且默认关闭的 Provider-boundary 防泄漏层：出站替换、Tool args 可逆恢复、keyed HMAC placeholder、原子 key 创建和 `0600`。证据：OMP `docs/secrets.md:1-32`、`:74-95`；`packages/coding-agent/src/secrets/index.ts:12-53`。

LoomStudio 已有更强的 at-rest Secret Store，包含 owner/purpose/authorizeUse、replacement 并发检查、pending-delete 和后台 cleanup。证据：`packages/secret-store/src/store.ts:28-49`、`:92-215`、`:244-349`。不应以 OMP obfuscator 替换它；未来若增加第二层 Provider 出站保护，必须同时考虑 Prompt、Tool args、Provider replay、Transcript 展示、误报恢复和审计，而不是只替换字符串。

---

## 12. 性能：学习决策方法，不复制技术栈

OMP 用 Rust/N-API 承担 grep、text、image、PDF、PTY、shell 等热点，并为 release、panic boundary、native loader、平台二进制和缓存维护大量基础设施。这是成熟产品在明确负载下的结果，同时带来了 Bazel、Cargo、Nix、native artifact、签名和跨平台 CI 成本。

LoomStudio 当前没有证据需要整体转向 Bun 或 Rust。应借鉴的只是以下顺序：

1. 用 trace/measurement 找到真实热点；
2. 优先修复算法、I/O 次数、缓存和交互状态归属；
3. 使用 Node/browser/SQLite 原生能力；
4. 只有热点稳定、JS 无法满足且收益覆盖跨平台成本时，再建立极窄 native boundary；
5. native boundary 必须有 fallback、取消、panic/error 映射、版本 sentinel 和安装 smoke。

没有测量前，引入 Rust、Bazel、Nix 或 Bun 都属于负收益复杂度。

OMP 更容易低成本复用的性能方法不是 Rust，而是本机相对 baseline、同机 median 与小幅 regression budget，以及完整 cache key/TTL/invalidation。证据：OMP `packages/coding-agent/scripts/bench-guard.ts:1-70`、`docs/fs-scan-cache-architecture.md:19-116`、`packages/coding-agent/src/tools/github-cache.ts:1-17`、`:59-203`。Loom 应先为 PromptBuild、Document query、Client projection 等稳定热点建立相对 benchmark，再决定是否下沉实现。

OMP TUI 还有一类与终端技术栈无关的可借鉴方法：把 append-only scrollback、稳定 frame、幂等 dispose 和真实终端字节序列写成可执行渲染合同，再用 virtual terminal 与 ConPTY/EIO 回归验证。LoomStudio 不应复制 TUI 组件，但未来后端 TUI、流式日志或 Transcript 重建可以复用“live projection 与重建路径一致”的测试思想。证据：OMP `packages/tui/src/tui.ts:1-16`、`:136-186`；`packages/tui/test/render-stress-harness.ts:1142-1207`、`issue-2034-repro.test.ts:207-315`。

---

## 13. 测试、CI、构建与发布

### 13.1 OMP 真正值得学的测试思想

OMP 根 `AGENTS.md` 明确要求测试保护外部可观察合同，反对 tautology、source grep、成功 passthrough、重复覆盖和全局 mock 污染；对 lifecycle/stateful code，倾向按 invariant/transition 测试；对 error handling，要求触发真实失败路径。

这与 LoomStudio 当前 `unit / integration / contract / probes` 分类兼容。建议把以下原则吸收进 Loom 的 testing guide：

- 每个新增测试必须能说出消费者看到的失败；
- Tool/Agent 测试优先覆盖状态转换、配对、错误映射和恢复；
- 不通过读取源码文本验证 wiring；
- 编译期合同交给 typecheck，不写运行时占位测试；
- smoke 只覆盖单元测试无法覆盖的入口、安装、worker/native/extension packaging。

### 13.2 LoomStudio 当前最缺的是 CI，不是更多测试框架

当前仓库没有 tracked `.github/workflows`。最小 CI 足够：

```text
pnpm install --frozen-lockfile
pnpm run check:workspace
pnpm run lint
pnpm run test
pnpm run build
pnpm run verify:server-extension-manager
```

实际拆 job 前应测量时长；也可以先把 lint/type/build/test 合并成 1-2 个 job。不要复制 OMP 针对 2,000+ 测试、native addon 和 CI OOM 形成的内容扫描分桶器。

### 13.3 发布能力按分发目标增长

OMP 已有 package changelog、版本同步、release script、自测、checksums、binary/npm/Nix/Homebrew 和原子 push/tag。这些对已发布 CLI 必要，但链路并非每处都闭环：checksum 会生成并发布，默认 Unix binary installer 只做 `--version` smoke、未校验 digest，PowerShell installer 也未消费 checksum。证据：OMP `scripts/ci-release-checksums.ts:1-49`、`scripts/install.sh:264-290`、`scripts/install.ps1:241-285`。

LoomStudio 当前应先完成：

- 可重复 production build；
- clean machine / packaged extension smoke；
- schema migration forward test；
- 明确 app artifact 与 extension package format；
- 发布前 backup/upgrade/rollback 策略。

只有出现实际桌面分发目标后，再选择签名、自动更新、channel 和 release automation。

生成物同理：仓库规则要求 Prompt 和 model catalog 不手改，不等于 CI 已有 drift gate。OMP 的 `format-prompts` 不在普通 `check`，`gen:models` 也不等于每次 CI 都 regenerate + diff。证据：OMP `packages/coding-agent/package.json:33-47`、根 `package.json:94-174`。Loom 未来出现生成物时，应直接运行 generator 后以 `git diff --exit-code` 验证，而不是只写人工规则。

---

## 14. 具体编码细节：哪些值得吸收

### 14.1 事故驱动的窄规则

OMP 的很多细规则都附带真实失败原因，例如：worker 必须重入单一 CLI entry、TUI 输出必须清洗、background runtime 不能 `console.log`、generated model catalog 不能手改、tool hook 返回值必须再次归一。这类规则的价值来自“明确边界 + 失败模式 + live validation”。

同时要区分手册和机器门禁：OMP `AGENTS.md` 要求尽量不用 `any`，但 Biome 关闭了 `noExplicitAny`，a11y lint 也整体关闭。证据：OMP `AGENTS.md:33-42`、`biome.json:8-14`、`:27-32`。Loom 的根级 AI 入口应优先链接可执行检查；无法机器验证的内容明确标为 review discipline。

LoomStudio 可以增加一个短小根 `AGENTS.md`，只包含：

- 文档入口与 Stable/Workbench 状态；
- package 依赖方向；
- Kernel/Application/Client/Extension 的禁止越界；
- SQLite migration/transaction 与 Secret 边界；
- PromptBuild/Agent/Narrative 的权威归属；
- 最小验证路由；
- 生成物与不可手改文件。

不要复制 OMP 的 Bun、`ReturnType<>`、`#private`、barrel export 等项目口味；这些不是普遍成熟度指标。

### 14.2 中央工具与错误归一

OMP 强制优先复用中央 git/jj、stream、path、truncate、logger 等 helper，因为这些实现已经包含 timeout、output cap、non-interactive、lock avoidance 和 sanitization。

LoomStudio 也应采用同样的判断标准，但只在重复已经出现时集中：两个实现都正确也可能在 timeout、abort、correlation 或错误码上漂移。不要为预想复用提前建 `utils` 大包。

### 14.3 Prompt 作为静态资产

OMP 已形成规模较大的静态 Prompt corpus，统一使用 `.md` 资产和模板。具体文件数属于易漂移快照，不作为架构结论。Prompt formatter 进入 `fix/fmt`，但不在普通 `check` 中，因此“静态资产”也不自动等于 CI drift 已闭环。证据：OMP `packages/coding-agent/package.json:33-47`、根 `package.json:94-133`。

LoomStudio 当前只有少量内置协议提示，例如 content-tool 说明直接位于 `tool-loop.ts`。现在为一条字符串建设 loader 没有收益；但当 official tools、runtime policy 或 provider dialect prompt 增长时，应让这些内容进入 Prompt Resource/静态资产并保留版本，而不是散落在分支代码中。

### 14.4 模块化债务也要以现有事实为准

Loom Guide 已规定 `application-runtime/src/runtime.ts` 超过 300 行且混合多领域流程属于架构异味；当前文件约 2,400 行，Agent、Card、Workspace、State 等编排仍集中其中。证据：`docs/guide/architecture-rules.md:34-39`、`packages/application-runtime/src/types.ts:54-126`、`packages/application-runtime/src/runtime.ts`。这是当前最明确的编码结构债务之一，但不授权一次性大重构：应按既有领域边界渐进迁出操作，使 `createApplicationRuntime()` 回到组合职责；不要借机引入 DI 容器、Repository、Base Service 或 Command Bus。后续吸收 OMP 的 recovery、subagent、permission 或 context maintenance 时，也不能继续把所有状态机塞回 composition root。

### 14.5 第三方边界必须重复校验

TypeScript 类型不能保护动态 Extension、MCP、Provider 或反序列化数据。OMP 对 tool execute、partial update、after hook、provider schema 和 persisted session 都有 runtime coercion/validation。

LoomStudio 当前 Tool Registry 已校验 definition、invocation 和 result identity。未来开放 Extension-contributed Tool 或 hook 时，必须继续验证完整 result shape、content size、artifact ownership、context mounts 和 error code；不能因为 SDK 类型正确就信任运行时对象。

### 14.6 注释应解释反直觉合同

OMP 的高价值注释通常解释 abort race、provider pairing、release cancellation、test OOM 或 native panic boundary。LoomStudio 应保留这种注释标准：解释“为什么不能简化”和升级路径；普通控制流不需要逐行复述。

---

## 15. 建议形成的后续 Workbench 课题

以下只是建议的讨论入口，未获批准前不实施：

| 优先级 | 课题 | 最小范围 | 闭环条件 |
|---|---|---|---|
| P0 | Agent / Narrative Commit Contract | 对照 Architecture 与当前分阶段 commit，决定修正文档还是实现 | 正式文档、实现、返回 changeset 与测试描述同一事实；不再宣称不存在的跨领域原子提交 |
| P0（审计） | Agent Turn Integrity | 只读验证 stream/stop/tool pairing、executed 状态、abort race、orphan repair | 只有确认具体失败链后才形成修复计划；不以 OMP 复杂度反推 Loom 必须重写 |
| P0 | Minimal CI Baseline | frozen install、workspace、test、build、extension smoke | clean runner 可重复通过；失败能定位到明确阶段 |
| P1 | Session Discovery / Reopen | list/search/page、按 ID 重开、delete、稳定 route | Server 重启后用户仍能发现并打开持久 Session，不依赖页面内存引用 |
| P1 | Context Capacity Contract | 当前 100 条窗口、excluded count、budget fact、策略版本 | 被排除历史可见且可诊断；完整 compaction 仍可独立后置 |
| P1 | Agent Context Maintenance | mechanical trim、summary boundary、fallback、canonical transcript 保留 | 摘要失败不损坏 transcript；Tool 配对和恢复边界不被切断 |
| P1 | Provider Compatibility / Streaming | 当前 4 adapter 的 schema/stream/error/usage fixtures，端到端 terminal/cancel | 新差异进入 ledger 与测试；底层 stream 能力不再停在 Server 内存边界 |
| P1 | Agent Run Fact | 从 Agent Store 与 Commit Fact 派生 step/tool/provider 汇总 | 能回答一次 run 为什么结束、哪些工具实际执行、成本/耗时在哪里，并明确易失 trace 边界 |
| P1 | External Tool Boundary | Extension/MCP tool registration、validation、ownership、dispose | 外部工具不能绕过 grant；畸形输出不污染 transcript |
| P1 | Application Runtime Modularization | 按既有领域边界渐进迁出 public operations | composition root 回到组装职责；不引入平行架构或通用框架 |
| P2 | Child Agent Runtime | identity、owner、grant、cancel、artifact、durable message | 父子失败独立，重启可恢复，UI 不拥有 orchestration |
| P2 | Package Resource Skills | Skill 映射到现有 Package/Prompt/Tool | 不新增重复权威类型，来源/版本/启用可追踪 |

建议不要把这些合并成一个“Agent Runtime 2.0”总计划。每项都应独立证明需求和闭环。

---

## 16. 不应照搬清单

| OMP 能力 | 为什么不直接照搬 |
|---|---|
| Bun-first 与 Bun 专用 API | LoomStudio 已固定 Node 22 + pnpm；切换会扩大全部工具链和运行时风险 |
| Rust native、Bazel、Nix | 没有已测热点；会引入跨平台构建、签名、panic、ABI、缓存和发布成本 |
| 60+ Provider / OAuth | 数量不是产品目标；先保证现有 adapter 合同 |
| Coding tools、LSP、browser、computer | 属于具体 Application/Extension，不属于 Kernel 或默认 Agent |
| OMP Session Tree 统摄全部状态 | Loom 的 Narrative、Agent、Document、Prompt、State 有独立权威 |
| 自由进程内 Extension API | Loom 的 capability、manifest、owner 和 instance scope 更适合平台治理 |
| Snapcompact | 模型与场景特化，缺少 LoomStudio 需求和质量验证 |
| 复杂 CI test partition | OMP 为既有规模和 OOM 实测服务；Loom 当前应保持简单 |
| 全套 release automation | 尚无明确分发目标、签名与更新合同 |
| OMP 的所有代码风格禁令 | 多数是项目口味或 Bun 约束，不是通用正确性规则 |

---

## 17. 关键证据索引

### 17.1 OMP

- Agent Loop：`packages/agent/src/agent-loop.ts:526-730`、`:894-1110`、`:1239-1435`、`:2228-2915`
- Agent Loop 回归：`packages/agent/test/agent-loop.test.ts:988-1061`、`:1483-1800`、`:2822-3260`、`:4555-4676`
- Session/Recovery：`docs/session.md:35-130`、`:207-310`、`packages/coding-agent/src/session/session-storage.ts:15-195`、`session-manager.ts:686-1017`、`:1797-1838`、`:2454-2515`
- Compaction：`docs/compaction.md:1-45`
- Extension loading/isolation：`docs/extension-loading.md:180-239`
- Extension API：`docs/extensions.md:339-493`
- MCP lifecycle：`docs/mcp-runtime-lifecycle.md:105-129`、`:181-196`、`:220-249`
- Advisor：`docs/advisor-watchdog.md:140-177`、`:215-330`
- LSP：`docs/lsp-config.md:11-43`、`:212-260`
- Workspace/CI scripts：`package.json:83-174`、`.github/workflows/ci.yml:1-170`、`scripts/ci-test-ts.ts:30-112`
- Repository engineering rules：`AGENTS.md:1-298`
- Native/panic/cancellation boundary：`docs/natives-architecture.md:1-107`、`docs/natives-binding-contract.md:45-83`、`crates/pi-natives/src/task.rs:1-27`、`:75-203`、`crates/pi-natives/src/crash_handler.rs:80-143`
- Memory backend：`docs/memory.md:1-77`、`docs/mnemosyne-memory-backend.md:42-69`、`:166-187`
- Secrets：`docs/secrets.md:1-95`、`packages/coding-agent/src/secrets/index.ts:12-53`
- Postmortem：`packages/utils/src/postmortem.ts:15-43`、`:81-208`、`:251-395`
- Marketplace transaction/isolation limits：`docs/plugin-manager-installer-plumbing.md:204-260`
- Benchmark/cache：`packages/coding-agent/scripts/bench-guard.ts:1-70`、`docs/fs-scan-cache-architecture.md:19-116`
- TUI executable contracts：`packages/tui/src/tui.ts:1-16`、`:136-186`、`packages/tui/test/render-stress-harness.ts:1142-1207`、`issue-2034-repro.test.ts:207-315`
- Installer/checksum gap：`scripts/ci-release-checksums.ts:1-49`、`scripts/install.sh:264-290`、`scripts/install.ps1:241-285`

### 17.2 LoomStudio

- 文档状态与项目地图：`docs/README.md:1-52`、`docs/guide/project-structure.md:1-179`
- Agent Prompt composition：`packages/application-runtime/src/agent-turn.ts:22-126`、`:129-332`
- Tool definition/validation：`packages/application-runtime/src/agent/tool-registry.ts:20-199`、`:201-390`、`:486-763`
- Tool Loop：`packages/application-runtime/src/agent/tool-loop.ts:231-495`、`:656-877`
- Agent transcript：`packages/agent-store/src/types.ts:8-165`、`packages/agent-store/src/store.ts:38-199`、`:240-360`
- Provider Gateway：`packages/ai-gateway/src/types.ts:8-102`、`packages/ai-gateway/src/gateway.ts:24-220`、`packages/ai-gateway/src/provider-registry.ts:45-129`
- Streaming boundary：`packages/application-runtime/src/types.ts:522-526`、`packages/application-runtime/src/gateway.ts:90-110`、`packages/client-bridge/src/index.ts:18-66`
- Extension Architecture：`docs/architecture/extensions/README.md:1-187`
- Workspace scripts：`package.json:1-43`、`scripts/check-workspace.mjs`
- Agent/Tool integration tests：`tests/integration/application-runtime/native-tool-loop.test.ts`、`tests/integration/application-runtime/agent-session.test.ts`
- Secret Store：`packages/secret-store/src/store.ts:28-215`、`:244-349`
- TraceAudit 当前边界：`packages/trace-audit/src/index.ts:17-50`、`apps/studio-server/src/main.ts:99-100`
- Context 100 条上限：`packages/application-runtime/src/runtime.ts:1874-1882`、`:1942-1944`
- Session discovery gap：`packages/agent-store/src/types.ts:144-165`、`packages/application-runtime/src/types.ts:102-106`、`apps/studio-client/src/shared/api/studio-api.ts:320-326`、`apps/studio-client/src/widgets/sessions-panel/sessions-panel.tsx:22-27`、`:114`
- Agent/Narrative commit contract conflict：`docs/architecture/data/README.md:118-122`、`packages/application-runtime/src/agent/tool-loop.ts:264-267`、`:395-435`、`packages/application-runtime/src/runtime.ts:1136-1165`、`:1187-1193`
- Application Runtime modularization：`docs/guide/architecture-rules.md:34-39`、`packages/application-runtime/src/types.ts:54-126`、`packages/application-runtime/src/runtime.ts`

---

## 18. 第二轮独立复审结论

第二轮没有推翻主结论，但修正了几类容易把“能力广度”误写成“工程闭环”的问题：

1. OMP Memory 是可替换 backend，不是默认 SQLite/向量引擎；Mnemopi 也有 feature flags 与有界 drain 的 durability tradeoff；
2. MCP 的 startup gate、late registration、stale tool 和无主动 health polling 是明确退化语义；
3. checksum 生成不等于 installer 已校验，静态 Prompt/生成物规则也不等于 CI drift gate；
4. OMP Marketplace 的状态文件、rollback 与同进程代码隔离并不适合直接成为 Loom 模板；
5. Loom 的 TraceAudit 当前只在内存，PromptBuild trace 尚无持久 ref；Agent 上下文硬取最近 100 条，Client 也没有通用历史 Session 列表/重开入口；
6. 正式 Data Architecture 的 Agent/Narrative 同事务表述与当前分阶段提交实现明确冲突，这是优先于一般候选的已确认问题；
7. 底层 AI Gateway 已有 stream/cancel，不代表 Application Runtime、RPC 和 Client 已端到端支持 Streaming；
8. Agent Turn Integrity 应先做 P0 只读专项审计，不能在没有具体失败链前把 OMP 的复杂度转成实施范围；
9. Shutdown registry、Provider 出站 Secret 防泄漏、本机相对 benchmark、cache invalidation 和可执行渲染合同，是比迁移 Bun/Rust 更低成本的学习项。

仍需留给后续专项验证的开放问题：当前 Tool Loop 是否能构造稳定的多 Invocation orphan；Provider streaming 接入 Agent Loop 后采用何种 durable/resume 语义；Context Budget 与 Summary 的产品质量边界；Permission suspend UI 与 Client Session reopen 的交互设计。本文不把这些候选写成已确认缺陷。
