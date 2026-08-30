# LoomStudio 生态对照审计改进总结

> **状态**：Active Reference / 建议尚未批准或实现
>
> **定位**：汇总 [`oh-my-pi-architecture-and-engineering-reference.md`](oh-my-pi-architecture-and-engineering-reference.md)、[`pulsarai-architecture-and-product-reference.md`](pulsarai-architecture-and-product-reference.md) 与 [`plugin-ecosystem-architecture-reference.md`](plugin-ecosystem-architecture-reference.md) 的可执行结论。
>
> **证据边界**：本文是 Reference 总结，不代表下列建议已经实现或获得批准。当前代码、正式 Architecture 和测试结果始终高于本文；涉及新 Schema、权限、持久化或公共接口的项目应先进入 Workbench。

## 1. 总结

LoomStudio 不需要复制 oh-my-pi 的 Coding Agent 产品形态，也不需要复制 PulsarAI 的同 Realm Plugin/CTX。三方对照后，最合理的改进方向是：

1. 保住 Loom 已有的领域权威、SQLite 事务、PromptBuild trace、Tool Registry 与 Package / Module / Instance 治理；
2. 从 oh-my-pi 学习 Agent 失败语义、恢复、Provider 兼容和交付闭环；
3. 从 PulsarAI 学习可编辑资源树、显式资源依赖、target-bound Reply、消息版本、长上下文摘要和测试作者体验；
4. 先完成声明式 Prompt Package 与现有 PromptBuild 的闭环，再扩展 Skill、MCP 和 Marketplace；
5. 不增加第二套 Prompt、Tool、State、CTX 或 Plugin 事实源。

优先级可以压缩为：

```text
P0  正确性、事务与 CI
  -> Agent Turn Integrity / 原子提交合同 / 最小 CI

P1  生成与上下文能力
  -> Streaming Draft / Context Capacity / Provider Ledger / Activation DX

P1  插件生态最小闭环
  -> Prompt Package / Resource Import / Trace / 生命周期与 Grant 对账

P2  产品与生态扩展
  -> Resource-bound Test / Message Version / Skill / MCP

P3  分发治理
  -> Marketplace / 签名 / Provenance / 更新与回滚
```

---

## 2. 必须保留的 LoomStudio 优势

以下边界已经比两个参考项目更适合 Studio，不应为了获得生态广度而弱化：

| 现有优势 | 必须保持的合同 |
|---|---|
| Kernel / Application / Client 分层 | Kernel 不理解 Card、Agent、Prompt 或 Plugin 领域语义 |
| Loom Core | 保持同步、线性、可追踪的 Fragment compiler pipeline，不升级为 ECS Runtime 或 Prompt 领域对象 |
| PromptBuild | 继续作为最终模型输入的唯一投影权威 |
| Narrative / Agent 分权 | Narrative 保存故事事实，Agent Session 保存工作过程，不合并成统一 Conversation Store |
| SQLite Data Engine | 跨领域写入通过 owning API、transaction 与 Commit Fact 完成 |
| State Store | 保持作用域、Revision、Schema、分支与事务；没有真实的多实体组件查询需求前不改造成 ECS |
| Tool Registry | 保留 Definition / Mount / Registration、validation、approval、timeout、abort 与 canonical result |
| Extension Host | 保留 Package / Module / Instance、owner、grant、registration reconciliation 和 disposer |
| Secret Store | 保留 owner、purpose、use context 与系统 Keyring 边界 |

Loom Core 的正式语义也是正确的：`Fragment[] + ordered Pass[] -> Fragment[] + Mutation / Diagnostic / Trace`。PromptBuild 可以采用 component-like Composition IR，但不需要 EntityManager、Archetype、通用 Component Store 或 System Scheduler。

---

## 3. P0：先补正确性与交付底线

### 3.1 Agent / Narrative 原子提交合同

正式 Data Architecture 与当前实现对 Agent transcript、Narrative commit 是否位于同一 transaction / Changeset 存在不一致。应先做出明确选择：

- 若产品要求一次 Agent Turn 原子提交，则实现必须把相关领域写入放入同一 Data Engine transaction；
- 若允许 Agent 工作记录先提交、Narrative 后提交，则 Architecture 必须明确部分成功、补偿和恢复语义。

在这项合同澄清前，不应继续叠加自动重试或复杂 Run 恢复。

### 3.2 Agent Turn Integrity 专项审计

以当前真实调用链验证以下不变量，而不是复制 oh-my-pi 的 Agent Loop：

1. 每个已持久化 Invocation 最终有且只有一个 canonical Result；
2. 校验、审批、持久化、执行和 replay 使用同一份 effective input；
3. abort、timeout、transport failure、length truncation 和 recovery failure 不合并为一个错误；
4. AbortSignal 只表示取消请求，不能证明外部副作用已经停止；
5. Provider 输出或 Tool 副作用已经发生后，重试必须创建新的 Attempt；
6. compaction / summary 不得切断 Tool Invocation 与 Result；
7. 进程崩溃或结果落库失败时，系统能识别 orphan / indeterminate 状态并 fail closed。

第一步应是 Workbench 合同和最小失败矩阵，不是直接修改循环。

### 3.3 最小 CI 基线

当前最缺的不是新测试框架，而是稳定的自动交付入口：

- frozen install；
- workspace 静态检查；
- 类型检查与必要构建；
- 现有 unit / integration / contract 测试；
- Extension install / activate / dispose smoke；
- 最小 PromptBuild 与 Agent Turn 回归 fixture。

不需要立即复制 oh-my-pi 的跨平台二进制矩阵、复杂分片或发布基础设施。

---

## 4. P1：生成、Streaming 与长上下文

### 4.1 Runtime-owned Assistant Draft

借鉴 PulsarAI 的 target-bound `reply`，但保持 Loom canonical transcript 权威。建议研究一个 Runtime-owned Draft / Stream Sink：

```text
Provider stream
  -> Assistant Draft: visible text / parts / chunk sequence
  -> canonical transcript: reasoning / observation / invocation / result / run state
  -> finalization
  -> Client projection
```

Draft 至少需要：

- `runId` / `attemptId`；
- `open -> streaming -> finalizing -> completed|failed|aborted`；
- AbortSignal 与迟到 chunk 处理；
- chunk sequence / idempotency；
- flush failure 不阻止 lock cleanup；
- Application / RPC / Client 端到端 Streaming transport。

### 4.2 Context Capacity / History Summary Artifact

当前最近 100 条硬截断应升级为可检查的 Context Policy。可以吸收 Pulsar 的不可变 Summary Artifact 思想：

- 原始 Narrative / Transcript 永不因压缩被覆盖或删除；
- 摘要绑定精确 source identity、version 和 digest；
- Tool pair、Changeset 等不可切断单元作为范围边界；
- 摘要失效时回退 raw，并产生 Diagnostic；
- PromptBuild trace 说明哪些原始记录被哪个摘要替代；
- token budget、最近窗口和必须保留类型由正式 Policy 决定。

Summary 是 PromptBuild 的候选输入，不是新的 canonical Conversation 或第二个 State Store。

### 4.3 Provider Compatibility Ledger

为当前正式 Provider adapter 建立小型兼容账本：

- API family / model pattern；
- Tool schema 限制；
- reasoning 与 message replay 限制；
- raw / normalized stop reason；
- retry class；
- Streaming quirks；
- 最小事件序列 fixture。

自动重试只允许发生在：transport 可重试、尚未产生输出、尚未执行 Tool、请求可安全 replay。否则创建新的可见 Attempt。

### 4.4 Session discovery 与持久可观测性

先闭合基础 Session 产品能力，再讨论复杂 fork、retry 或多 Agent：

- list / reopen / delete 与稳定 Router identity；
- 历史容量、截断和摘要状态可见；
- 从 Agent Store 与持久 Commit Fact 派生最小 `AgentRunFact`；
- 关联 provider observation、Tool 状态、取消来源、PromptBuild trace ref 与 terminal state；
- PromptBuild trace 若需要跨重启解释，应持久化 Artifact/ref，或保存足以重建的 source/version/boundary；
- 统一 shutdown / postmortem，确保 in-flight Run、Extension disposer、外部连接和 Trace sink 有界清理并汇总错误。

内存 Log、进程内 TraceAudit 和单次 RPC 返回值只能用于当前进程诊断，不能冒充跨重启权威。

---

## 5. P1：Activation 的产品化缺口

当前 Loom 已经有结构化 `PromptActivation`、条件求值器和 PromptBuild activation trace。缺口不是重新设计 ECS，也不是保存可执行 JavaScript 表达式，而是把已有能力变成可声明、可编辑、可解释的产品能力。

建议补齐：

1. **Fact 来源合同**：明确 current input、recent messages、State、Runtime event、vector result 和 manual pin 如何形成只读 facts；
2. **Fact Schema**：为路径、类型、owner、scope 和说明提供可查询目录；
3. **条件编辑器**：可视化编辑 `all / any / not`、关键词、比较、存在性和集合包含；
4. **消息范围**：关键词支持 current input / recent messages 与 depth；
5. **逐叶 Trace**：不仅返回整体 reason，还说明每个条件的 actual / expected / result；
6. **确定性**：概率或时间条件必须由 Host 提供带 seed / run identity 的事实，不在求值器中隐式读取随机数或时钟；
7. **Extension 接缝**：Extension 可以受权提供 Fact 或 Signal，不可以把任意代码表达式塞进持久 Activation Policy。

推荐数据流：

```text
State / Input / Runtime / Vector adapters
  -> typed Activation Facts
  -> structured Activation Policy
  -> one Activation Pass
  -> active / inactive + tree trace
  -> PromptBuild
```

`enabled` 继续表示作者持久开关；`active` 只是本轮 PromptBuild 结果，不回写 Source。

---

## 6. P1：声明式 Prompt Package 闭环

插件生态的第一步不应是 Marketplace，也不应是允许脚本控制最终 Provider payload。最低风险、最高收益的起点是无代码 Prompt Package：

1. Manifest 声明 Package Prompt Resource；
2. 安装时校验 schema、路径和引用闭包；
3. Package Catalog 可发现；
4. 用户显式 import 副本或 mount 只读来源；
5. 资源经 Source Adapter 形成 Prompt Contribution；
6. Activation、Zone/Slot、order 与 grant 仍由 PromptBuild 决定；
7. Preview / Run trace 回链 packageId、version、resourceId 和 digest；
8. disable、uninstall、source unavailable 和 user copy 各有明确状态。

Package Resource 与用户副本必须是不同身份：前者受 Package 版本和安装状态控制，后者是独立、可编辑的 Prompt Resource，并保留 origin provenance。

### 6.1 显式资源引用

借鉴 Pulsar 的资源树和 `imports`，但接入 Loom 现有权威：

- relative path 用于作者体验；
- stable ID 用于长期身份；
- import 只解析候选，不自动等同 visible、active、read 或 emitted；
- cycle、missing、duplicate、scope denied 使用 machine-readable Diagnostic；
- ordering 必须确定；
- 实际读取和最终发射进入 PromptBuild trace。

最少区分五个阶段：

```text
declared candidate
  -> visible by grant/scope
  -> reference resolved
  -> content read/rendered
  -> active contribution emitted
```

---

## 7. P1：Extension 生命周期、权限与作者体验

### 7.1 生命周期与数据清理

Loom 已有比 OMP、Pulsar 更完整的 activate / reload / dispose，但 Marketplace 前必须澄清：

- uninstall code 是否保留 desired state / grant；
- 同 ID 重装在什么 provenance 条件下继承旧授权；
- Package-owned durable data、用户副本、Instance scratch、Secret ref 分别何时清理；
- disable、reload、remove code、purge data 是四个不同动作；
- disposer 只能移除本 Instance 注册的对象；
- background job / timer 必须托管或明确禁止。

卸载 UI 至少应区分：删除代码、删除代码与 Package 数据、先导出再删除、取消。

### 7.2 Grant 与 Registration 对账

未来 Prompt、Skill、MCP、Tool 和 Client contribution 应复用同一套 reconciliation：

- Manifest 已声明但运行时未注册 -> Diagnostic；
- 运行时注册但 Manifest 未声明 -> development degraded / production reject；
- namespace conflict -> reject，不允许隐式赢家；
- UI 同时显示 desired state、effective grant 和 actual registration；
- publisher、signature、source kind 或 requested capability 变化时重新确认授权。

### 7.3 三个最小作者模板

优先交付：

1. `prompt-pack`：无代码 Prompt Resource Package；
2. `tool-module`：注册一个窄 Tool/RPC adapter；
3. `prompt-source-module`：读取已授权领域数据并产出结构化 Prompt Contribution。

每个模板使用同一个验证器输出 Manifest、请求 grant、实际 registration、未使用声明、Trace preview 和卸载后数据状态。不要先建设通用 DI Container 或复杂 Module graph。

### 7.4 Approval、Secret 与出站边界

Tool approval 应逐步从单一 allow/deny 扩展为可解释 Policy：

```text
impact: read | write | external-exec
+ scope
+ reversibility
+ source / owner
-> allow-once | allow-scope | deny
```

没有可用 UI 而操作需要批准时，应 suspended 或 fail closed。审批必须针对最终 effective input；Extension 或 Hook 修改参数后必须重新校验和审批。

Secret at rest 与 Secret 使用是两个边界。即使凭据保存在系统 Keyring，Provider、MCP 或外部 Tool 的出站目的地仍应绑定 owner、purpose、destination 和本次授权，不允许任意目标代理或正文 placeholder 静默水合。

---

## 8. Context 与 Plugin 调用边界

Pulsar 的 `ctx` 是每轮 Generation Environment 的自引用大对象，开发快但依赖、权限和生命周期都不清楚。Loom 不应复制这种模型。

未来仍应区分：

| 对象 | 责任 |
|---|---|
| `ExtensionActivationContext` | Module 注册、Host capability 与 disposer |
| Application Context Scope | 当前调用可读取哪些领域对象和资源；不是事实源 |
| `PromptBuildContext` | build identity、facts、mounts、budget 与 trace sink |

Plugin 间交互也应按类型分开：

```text
资源数据  -> stable resource ref + source-scoped import
持久数据  -> owner-scoped Storage / typed Application API
可调用功能 -> Tool / RPC / Provider Registry
Prompt 内容 -> structured Contribution -> PromptBuild
运行快照  -> immutable request scope
```

不提供可跨 Plugin 任意追加的 `CTX: string[]`，不把 Kernel、SQL、Store 或可变领域对象放入共享 Context Bag。

---

## 9. P2：产品体验与资源测试

### 9.1 Resource-bound Test Session

借鉴 Pulsar 的 `Conversation.binding`，为 Prompt Resource、Package Resource、Tool 或 Extension contribution 提供显式测试入口：

- 测试 Session 绑定目标资源和版本；
- 自动展示 owner、Package、grant、依赖和 PromptBuild trace；
- 测试模式可以临时选择目标贡献，但不能绕过生产授权；
- 测试输出与普通 Agent Session 使用相同 transcript / run contract；
- 绑定只负责测试上下文，不成为新的生产资源关系真相源。

### 9.2 Message Version 与分支候选

可以研究同一逻辑位置保存多个 regenerate candidate，并让 UI 分开表达“切换回答版本”和“创建工作分支”。但 Narrative、Agent Session、State 和 Prompt Resource 权威仍保持分离。

### 9.3 Focus 与作者界面

可借鉴：

- 可逆 Focus Mode；
- 资源树浮层，不永久挤压工作区；
- Manifest 表单与源码双模式；
- Container / dependency / trace inspector；
- 长 Run 的声音、系统通知和仅后台偏好；
- 外部迁移的 read -> discriminate -> convert -> preview plan -> commit 流程。

这些是产品体验，不应反向改变 Router、Workspace 和领域 Store 权威。

Portable Resource 还应区分 Copy 与 Update：Copy 重映射冲突 ID；Update 按稳定身份合并；内容冲突保留副本或要求用户选择，不能静默整树覆盖。导入计划应先展示目标 owner、引用闭包、缺失依赖和冲突处理，再执行一次已确认的 commit。

---

## 10. P2/P3：Skill、MCP、子 Agent 与 Marketplace

### 10.1 Skill

Skill 应是 Package Resource 的分发和激活模式：说明、Prompt 资源、支持资产和可选 Tool mount requirements。正文继续由 Prompt Resource / Document 权威保存，不创建平行 Skill 内容库。

### 10.2 MCP

MCP 应作为 Tool Provider adapter，前置条件包括：

- connection owner 与 parent/child borrow；
- credential destination / purpose；
- Tool Definition 映射和用户 grant；
- late、stale、degraded、reconnect 状态；
- Instance / Session dispose；
- UI 能解释动态 Tool 集变化。

### 10.3 子 Agent

只有单 Agent turn、transcript 和 recovery 稳定后再扩展：

- child Session / Run / Attempt 有独立 identity、owner、model 和 tool grant；
- 父子通信使用 durable message/event；
- 输出优先使用 Artifact / Asset ref；
- Provider concurrency slot 只包围单次网络请求；
- advisor 是只读或窄工具观察者，失败不阻塞主任务。

### 10.4 Marketplace

Marketplace 是供应链项目，不是 Extension Host 的下载按钮。必须单独设计：签名、publisher provenance、版本锁、兼容范围、权限 diff、更新、撤回、恶意包警告、rollback 和审计报告。

---

## 11. 暂时不做

- 不切换 Bun、Rust、Bazel、Nix 或其他与当前瓶颈无关的技术栈；
- 不复制 OMP 的全部 Tool、Provider、TUI 或 Coding Agent 功能；
- 不把 Narrative、Agent、State 与 Prompt 合并为统一 Conversation；
- 不把 Loom Core 改成 ECS Runtime、Prompt 编译器或异步服务容器；
- 不复制 Pulsar 的 `new Function + with` Sandbox、全量 API 后 denylist 或巨型 `ctx`；
- 不允许 Plugin 脚本成为最终 Provider payload 的唯一权威；
- 不把 CodeAct 变成所有 Tool 的唯一调用协议；
- 不把 Tool、Prompt、Skill、Hook 和 MCP 合并成无类型资源；
- 不让 import 自动等于 activate、read 和 inject；
- 不为尚未出现的依赖需求建设通用 DI、Module graph 或第二套数据库；
- 不在缺少 Worker / 进程 / OS 隔离时宣称支持不可信代码；
- 不在 Tool Registry、Secret、UI degraded state 尚未闭合时提前建设 Marketplace。

---

## 12. 建议拆分的后续 Workbench 课题

这些课题彼此独立，不合并为“Runtime 2.0”：

1. Agent / Narrative Atomic Commit Contract；
2. Agent Turn Integrity and Orphan Repair；
3. Runtime-owned Assistant Draft and Streaming；
4. Context Capacity and History Summary Artifact；
5. Provider Compatibility Ledger；
6. Activation Facts, Authoring and Tree Trace；
7. Package Prompt Resource Contribution；
8. Source-scoped Resource Import and Provenance；
9. Extension Grant / Registration Reconciliation；
10. Extension Uninstall, Provenance and Data Purge；
11. Resource-bound Test Session；
12. MCP Provider Lifecycle；
13. Skill Packaging；
14. Marketplace Supply-chain Governance。

每个课题都应分别写清：当前事实、目标合同、非目标、最小验证和晋升 Architecture 的条件。
