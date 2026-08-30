# PromptBuild 重新接入 Loom Core Pipeline 实施计划

> **状态**：Archived / Superseded by Current PromptBuild Architecture
> **归档说明**：本文中的 Phase 3—4 是历史迁移方案，不自动构成当前待办。当前 Pipeline、Pass 与 Trace 边界见 [`docs/architecture/application/prompt-build/`](../../architecture/application/prompt-build/)。
> **日期**：2026-08-15
> **优先级**：P1 Architecture Regression
> **范围**：将当前第一方 PromptBuild 从 `compilePromptDataModel()` 直接调用链迁移到真实的 `@loom/core` Fragment / Pass / Trace Pipeline，保持现有 Preset、Setting、Activation、Zone、Slot、Projection 和 Provider Message 结果兼容。
> **非目标**：本计划不实现 Tool Runtime、Mode Runtime、变量系统、Token Budget、Extension Pass 开放、Provider 协议重写或 Prompt Workbench 视觉重构。

相关计划与文档：

- [`preset-agent-prompt-build-module-plan.md`](preset-agent-prompt-build-module-plan.md)
- [`prompt-resource-foundation-plan.md`](prompt-resource-foundation-plan.md)
- [`log-plan/prompt-build-observability.md`](../../workbench/plans/log-plan/prompt-build-observability.md)
- [`../discussion/application/prompt/loom-core-integration-v0.md`](../discussion/application/loom-core-integration-v0.md)
- [`../../architecture/application/prompt-build/loom-core/README.md`](../../architecture/application/prompt-build/loom-core/README.md)

---

## 1. 问题定义

迁移前的真实运行链是：

```text
Agent Runtime
  -> composeAgentTurnPrompt()
  -> readPromptResourceInputs()
  -> compilePromptDataModel()
  -> CompiledPrompt / canonical Chat Messages
  -> Provider Adapter
```

`packages/application-runtime/src/agent-turn.ts` 曾直接调用纯 TypeScript 编译器。虽然 `packages/application-runtime` 已声明 `@loom/core` 依赖，但迁移前生产代码没有 import 或调用 Core。

迁移前的正式 Architecture 曾声称存在：

```text
prompt.source.prepared
  -> prompt.compile
  -> Core Trace
```

该描述对应的旧 `prompt-build-pipeline.ts` 曾经存在，但已在 Agent Session / Narrative Timeline 数据层重构中被删除，正式文档、Client Trace 入口与依赖没有同步收缩。

这不表示 PromptBuild 功能不存在。Preset / Setting 资源收集、Activation、Zone / Slot 投影、确定性排序和 Message 生成都有真实实现。问题是这些能力曾在 Core 之外继续增长，而 Core 的 Pass、Mutation、Replay、Diagnostic 和 Owner Tracking 不参与第一方 PromptBuild。

### 1.1 当前施工状态

Phase 0-2 已完成：`packages/application-runtime/src/prompt-build-pipeline.ts` 通过 `@loom/core` public API 注册并执行 `prompt.materialize`、`prompt.order`、`prompt.emit` 三个第一方 Pass；`composeAgentTurnPrompt()` 已切换到该入口，Preview / Invoke 共用同一条 Core Pipeline，并携带受控的 compact PromptBuild Trace。Narrative Timeline、Agent Session History 和当前输入也已经作为 Runtime Source 在同一次 Pipeline 中编译，不再在 Core 之后追加消息。

当前仍未完成：characterization 覆盖扩展、Client Inspector 消费真实 Trace、400～500 条目性能验收，以及旧 `compilePromptDataModel()` 的最终删除。迁移期间旧编译器仅作为兼容基线保留，不再作为 Agent Runtime 的执行入口。

## 2. 核心决定

> **Loom Core 不是 Prompt 领域编译器，但必须是 Loom Studio 第一方 PromptBuild 的真实执行引擎。**

分层保持为：

```text
Application Runtime:
  读取 Document / Agent / Narrative 数据；
  冻结本次 Build 的显式输入；
  定义 PromptBuild Fragment meta convention 与领域 Pass；
  解释 Core 输出为 CompiledPrompt。

@loom/core:
  Fragment[] + PassConfig[] -> Fragment[] + Trace；
  保证同步线性执行、基础校验、Mutation、Diagnostic、Replay 和 Owner 归因。

Provider Adapter:
  将 canonical Prompt / Agent Message 映射为具体 Provider payload。
```

不将 Card、Preset、Setting、Zone、Tool 或 Provider 语义下沉到 `@loom/core`。Core 仍只理解 `id / content / meta` 与 Pass 机械合同。

## 3. Core 生产适配评估

### 3.1 已确认可用的基础

当前 Core 已经实现并有定向测试覆盖：

- 同步、声明顺序的 Pass Pipeline；
- `PassFactory + PassConfig + PassRegistry`；
- Fragment 非空 / 唯一 ID 与 string content 校验；
- add / remove / update / move Mutation；
- mutation-first Trace 与 Replay；
- Pipeline fail-fast 与失败前安全副本；
- Diagnostic 与 soft Owner Tracking；
- Trace v1 序列化和 Schema 测试。

这些能力适合 PromptBuild，因为 PromptBuild 的领域核心本来就是一次已冻结输入上的确定性编译，不需要 Pass 内 IO。

### 3.2 已知限制

Core 当前仍是 Alpha 基线，不能把以下能力当作已冻结生产合同：

- `trace.mode = off` 仍会执行 Pass 前 Clone、Owner 检查和 Mutation diff；
- Trace `update` 保存完整 before / after Fragment，多阶段全量更新会显著放大内存；
- 每个 Pass 修改非自身 owner Fragment 会生成 `loom/cross-owner-write`，普通编译阶段如果原地修改全量 Fragment 会制造大量噪音；
- `reads / writes / requires / provides` 当前只是声明字段，当前 LoomStudio 也没有迁入 `@loom/stdlib` linter；
- PassConfig params 和 Fragment meta 尚无完整 JSON-serializable runtime guard；
- Pass version 还没有承担 Replay 兼容或缓存协议；
- Core 没有 AbortSignal、Sub-pipeline、Incremental Compile 或 Cache。

本计划不在真实 PromptBuild 迁移前先扩展 Core。先使用现有 public API 完成一条可测量的生产链，只有真实验收失败时才提出最小 Core 修改。

### 3.3 方向性基准

本机微基准使用 500 个 Fragment、每条约 800 字符：

| 形态 | 中位耗时 | Raw Trace | Diagnostic |
| --- | ---: | ---: | ---: |
| 当前纯 TS 单体编译 | 约 0.75 ms | 无 | 0 |
| 6 个全量修改型 Pass | 约 30.8 ms | 约 8.6 MB | 3000 |
| 3 个 append-only 派生型 Pass | 约 15.1 ms | 约 2.0 MB | 0 |

这不是发布性能承诺，只用于约束迁移方式：

1. 首版不应拆成六到十个会反复改写全量 Fragment 的细 Pass；
2. 优先生成新的派生 Fragment，保留 Source Fragment 作为不可变来源；
3. Raw Trace 不直接跨 RPC，Application Runtime 输出 compact PromptBuild Trace；
4. 只在真实 400～500 条目 Fixture 上制定性能门槛。

## 4. 目标运行链

```text
Preset / linked Settings / Timeline Settings
  -> async Source Preparation
       Document read
       macro expansion
       source identity and path
       frozen activation facts
       skeleton and order profile
  -> Source Fragment[]
  -> @loom/core run()
       prompt.materialize
       prompt.order
       prompt.emit
  -> Message Fragment[] + compact Core Trace
  -> CompiledPrompt
  -> optional Narrative context
  -> Agent Session history
  -> current user input
  -> canonical Chat Messages
  -> Provider Adapter
```

### 4.1 Source Preparation

Source Preparation 保持在 Core 外，因为它需要异步 Document Store 读取。

它必须显式冻结会影响本次 Build 的输入：

- Preset 与其 `linkedSettingIds`；
- Timeline 当前 Setting 引用；
- Prompt Resource 节点内容、Enabled 与 Capability；
- macro context；
- Activation facts / current input；
- Composition Skeleton / Patch；
- Projection Order Profile；
- 稳定 Source ID、Node ID 和 Source path。

Source Preparation 不计算最终 active、slot order 或 Provider Message，避免在 Core 之外预先完成真正的编译。

### 4.2 中间 Fragment 形态

本计划只冻结最小阶段身份，不在计划文档中过早固化完整 meta Schema：

```text
source
  来自 Preset / Setting / Runtime Source Adapter 的不可变来源。

composition
  materialize 产生的派生 Fragment，携带 active / reason / zone / slot / order 结果。

message
  emit 产生的 provider-neutral message segment，携带 role hint 与 source fragment references。
```

所有 Fragment 使用稳定、可解释 ID。不用每轮随机 ID 表达同一语义节点，以保留 Trace diff 和未来缓存的可能性。

### 4.3 `prompt.materialize`

首版将当前密切耦合的两步合并在一个 Pass 内：

- `PromptContribution -> PromptFragment`；
- Activation evaluation；
- Zone 存在性和 accepts 校验；
- dynamic slot key materialization；
- 为每个 Source Fragment 生成对应 Composition Fragment。

激活失败的 Source 不从 Core 历史中消失。Composition Fragment 保留 `active=false` 与原因，供 Preview 解释；只在 Emit 时排除。

首版不再继续拆 `normalize / activation / projection / filter`，避免过细 Pass 带来 Trace 放大和 Owner 噪音。当真实 DevTool 需要更细粒度时再通过数据证明拆分收益。

### 4.4 `prompt.order`

Order Pass 读取 Application meta convention，将 Composition Fragment 的最终顺序反映为物理数组位置：

1. Zone `orderIndex`；
2. Projection Order Profile rank；
3. `slotOrderHint`；
4. Source tree order path；
5. `entryOrderHint`；
6. stable Fragment ID 托底。

排序不另存一份与数组顺序不一致的隐式真相。Core Trace 通过 move Mutation 记录最终顺序变化。

### 4.5 `prompt.emit`

Emit Pass：

- 忽略 `active=false` 的 Composition Fragment；
- 按 Zone / Slot 顺序生成 provider-neutral Message Fragment；
- 合并需要同属一个 canonical message 的相邻片段；
- 保留参与生成的 Composition Fragment IDs；
- 不生成 OpenAI / Anthropic / Gemini request body；
- 不通过 closure callback 把结果带出 Core；
- 不把整个 `messages[]` JSON stringify 进单个字符串 Fragment。

Application Runtime 只从 Message Fragment 构造 `CompiledPrompt.messages` 和 Editor Projection。

### 4.6 Runtime History 的固定挂载

Timeline 和 Agent Session 不保存 `zoneId`。它们是领域数据，不应反向拥有 Prompt Skeleton 的结构。固定挂载关系由 Application Runtime 的稳定常量决定：

```text
NarrativeTimeline
  sourceId = timeline.id
  zoneId = chat.history
  slot = runtime:narrative.main@chat.history

AgentSession
  sourceId = agentSession.id
  zoneId = session.history
  slot = runtime:session.main@session.history

Current Input
  zoneId = chat.inside
  slot = runtime:current.input@chat.inside
```

Timeline Node 使用 `section` wrapper，并以 `developer` role 进入 Narrative History；Session Message 和当前输入使用 `message` wrapper，保留各自的 canonical Chat Message 边界与 role。这样 Zone/Slot 仍属于 Preset 的 Prompt Skeleton，而 Timeline、Session 只提供本次 Build 的来源数据。

这不是另一条后置拼接路径：三类 Runtime Source 与 Preset、Setting Contribution 一起生成 Source Fragment，然后只执行一次 `@loom/core` Pipeline。工具 Call/Result 历史暂时在进入该链路时显式拒绝，待工具协议单独固化后再接入。

## 5. Agent History、Tool 与 Provider 边界

### 5.1 Agent Session History

Agent Session Message 是已持久化的 canonical 会话协议，不应为了使用 Core 而退化为普通文本 Fragment。

首版保持以下边界：

```text
Core Pipeline:
  编译 Preset / Setting / Narrative prompt material。

Application Runtime:
  按 Preset historyPolicy 选择 Agent Session history；
  将 Core 编译产物、Narrative context、Agent history 和当前 user input 合并为 canonical Chat Messages。
```

如果未来需要由 Preset 控制 History 的精确 Zone / Depth / Token Budget，再定义一个保留结构化 Message 身份的 History Adapter，不在本次迁移中设计。

### 5.2 Tool

Tool 需要分成两类数据：

```text
Tool 说明、使用政策、模式指令:
  属于 Preset PromptBuild Contribution，进入 Core Pipeline。

Tool Schema、可执行注册、Tool Call / Result:
  属于 Agent Runtime 和 Provider Adapter，不进入文本 Fragment 编译链。
```

这条边界避免未来把工具调用协议硬编进 `compilePromptDataModel()`，也避免为了 Core 而破坏 canonical Agent Message 结构。

### 5.3 Provider

Core 输出 provider-neutral Message Fragment。Provider Adapter 继续负责：

- OpenAI-style `messages`；
- Anthropic system / messages 分离；
- Gemini contents / systemInstruction；
- Tool call 与 content parts 映射；
- Provider capability 降级与错误。

Core 不识别 Provider，也不输出最终 HTTP payload。

## 6. Registry 与可重放边界

新 Pipeline 必须避免旧实现中的两个问题：

1. 每次 Build 用闭包捕获 Prepared Input；
2. `prompt.compile` 用 callback 将结构化结果带出 Core。

目标合同：

- 第一方 PassFactory 是静态、可独立测试的纯函数 Factory；
- Build 变化数据通过初始 Fragment 和 JSON-compatible PassConfig params 传入；
- PassConfig 记入 Trace；
- Core final Fragment 自身足以构造 `CompiledPrompt`；
- Replay 只重建 Fragment 状态，不读 Document Store 或重新调用 Extension；
- Registry 初期只注册第一方 PromptBuild Pass。

Extension Pass 的注册、权限、顺序插入和热重载属于后续 Extension Capability 计划，不在本轮提前打开。

## 7. Trace 合同

### 7.1 Raw Core Trace

Raw Trace 仅在 Application Runtime 边界内使用，包含：

- PassConfig；
- Pass 耗时；
- Mutation；
- Diagnostic；
- Fragment content / meta；
- initial / final Fragment。

不将 Raw Trace 直接返回普通 Client 或写入普通 Log。

### 7.2 Compact PromptBuild Trace

Application Runtime 对 Raw Trace 进行受控投影：

- `buildId / runId / agentSessionId / timelineId / branchId`；
- status / error type；
- Pass name / version / index / duration；
- Mutation operation / Fragment ID / stage kind；
- Diagnostic code / severity / related Fragment IDs；
- Source / Composition / Message 数量；
- 内容长度和受限 preview；
- 不包含 Secret、Credential、Provider request headers 或无关 Document 正文。

Lifecycle Log 只继续记录 started / completed / failed 摘要，详细编译过程进 PromptBuild Trace，不复制进 Console / JSONL Log。

### 7.3 持久化

本轮首先保证 Preview / Invoke 返回可用 compact Trace，不立即新增 PromptBuild Trace SQL 表或文件存储。

完整历史 Trace 是否进 Trace Audit Store，以及如何通过 `buildId` 查询，由 PromptBuild Observability 计划另行决定。

## 8. 迁移策略

本迁移不采用“新旧双轨长期并存”。允许在单个开发阶段用旧编译器作为 characterization oracle，验收后立即切换唯一运行路径。

为避免迁移同时引入语义变化：

- 先冻结现有 `messages / zones / editorProjection`输出；
- 保持当前 macro、Activation、Zone accepts、Slot key 和排序语义；
- 保持 Preset Setting 与 Timeline Setting 的稳定 ID 去重；
- 保持 Preview 与 Invoke 共用同一构建入口；
- 不在迁移中顺便修复相邻同 role message 合并、Fact path 优先级或新 Resolution 策略；
- 需要改变 Prompt 结果的问题在迁移后以独立行为修复处理。

## 9. 分阶段实施

### Phase 0：事实收口与行为冻结

1. 已完成：在 Architecture 中核对并恢复 Core Pipeline 的真实接入事实；
2. 将现有 `compilePromptDataModel()` 主要输出写入 characterization tests；
3. 覆盖 Preset only、Preset + Setting、Timeline Setting、重复 Setting、Activation inactive、自定义 Zone / Order Profile；
4. 加入一个接近 400～500 条目的真实规模 Fixture，但不将未授权第三方内容提交进仓库。

验证检查点：迁移前的 canonical Messages、Compiled Zones 和 Editor Projection 成为可重复比对的基线。

### Phase 1：Core-native Fragment 与 Pass

1. 已完成：定义最小 PromptBuild Fragment meta；
2. 已完成：实现稳定 Source Fragment adapter；
3. 已完成：实现 `prompt.materialize` Factory；
4. 已完成：实现 `prompt.order` Factory；
5. 已完成：实现 `prompt.emit` Factory；
6. 已完成：使用静态 Registry 和 JSON-compatible PassConfig；
7. 已完成：从 final Message Fragment 构造 `CompiledPrompt`；
8. 已完成基础 Core status、Mutation、Diagnostic 定向验证；Replay 的独立验收仍属于后续 Core 验证。

验证检查点：新 Pipeline 不通过 callback 返回结果；Trace 展示真实 materialize / order / emit 变化；Replay 可重建 final Fragment。

### Phase 2：Application Runtime 切换

1. 已完成：`composeAgentTurnPrompt()` 切换到新 Pipeline；
2. 已完成：Preview / Invoke 继续共用一条路径；
3. 已完成：PromptBuild 失败保持 Provider 调用前 fail-fast；
4. 已完成：`buildId` 进入 compact Trace 和 lifecycle Log correlation；
5. 已完成：`PreviewAgentTurnResult` 增加 compact PromptBuild Trace；
6. 已完成：Invoke 返回同一 Trace envelope；
7. 已完成：清理不再可达的旧 Trace 假设，并移除 Runtime 的 Core 后置消息拼接。

验证检查点：同一输入在旧 characterization oracle 与新 Pipeline 中产生等价 `messages / projection`；Provider payload 不发生非预期变化。

### Phase 3：可观测性恢复

1. 实现 compact Core Trace -> PromptBuild Trace 投影；
2. Client PromptBuild Steps 读取真实 Pass 顺序和 status；
3. Inspector 只接收受控 Trace，不直接暴露 Raw Trace；
4. 生命周期 Log 保留 message count / duration / references，不复制 Mutation JSON；
5. 将 Architecture 中的“当前实现”逐项核对后恢复为稳定事实。

验证检查点：用户能回答“哪个 Pass 让该条目 active、它为什么进入该 Zone / Slot、它为什么排在这里”。

### Phase 4：真实规模验收与 Core 反馈

1. 用 400～500 条目、多 Zone、多 Slot、部分 Activation 的 Fixture 运行 Preview 与 Invoke 前编译；
2. 测量 source preparation、Core run、compact projection 和总 PromptBuild 耗时；
3. 测量 Raw Trace 峰值、compact Trace 字节数和 Diagnostic 数量；
4. 确认 `trace.mode = off` 是否存在真实 Runtime 使用需求；
5. 确认 Owner Tracking 是否因正常第一方 Pass 产生噪音；
6. 只对已证明的 Core gap 提出最小修正。

初始验收预期，不作为发布 SLA：

- 500 条目 PromptBuild 本机中位 CPU 时间不高于 50 ms；
- 无系统性 `cross-owner-write` 噪音；
- compact Trace 不包含完整 Prompt 副本；
- Preview / Invoke 输出兼容测试全部通过；
- Core Replay 结果与 final Fragment 一致。

如果不满足，按以下顺序解决：

1. 减少不必要的 Pass 和派生 Fragment；
2. 缩减 Raw / compact Trace 投影；
3. 调整 Application Pass 形态；
4. 只有 Core public API 确实阻塞时，才讨论 Core 的 Clone、Owner 或 off-mode 修改。

## 10. 实施时的最小文件边界

预计主要变更集中于：

```text
packages/application-runtime/src/
  prompt-build-pipeline.ts       新的 Core-native pipeline adapter
  prompt-builder.ts              拆出可复用的纯阶段函数
  prompt-activation.ts           继续作为 Activation 策略函数
  workspace.ts                   Source Preparation 与资源输入
  agent-turn.ts                  唯一 Agent PromptBuild 入口
  types.ts                       compact Trace / Preview 合同

apps/studio-server/src/
  application-rpc.ts             Trace 传输映射

apps/studio-client/src/
  entities/agent.ts              compact Trace DTO
  shared/api/studio-api.ts       typed RPC
  features/prompt-build/         真实 Trace 消费
  app/use-studio-state.ts        删除 undefined 假链
```

本轮不因文件数重新拆 Application Runtime 模块，也不新增通用 Compiler Framework 或 Prompt DSL package。

## 11. 验证矩阵

### 行为兼容

- Preset only；
- Preset + linked Settings；
- Preset Setting + Timeline Setting 合并与 ID 去重；
- Folder effective enabled；
- always / manual / keyword / condition / all Activation；
- custom Zone / Skeleton Patch；
- Slot rank / slot hint / source tree / stable ID 排序；
- empty prompt source；
- unknown Zone / invalid accepts fail-fast；
- Preview / Invoke 投影一致；
- Provider failure 不留下半轮 Agent Message。

### Core 合同

- 三个第一方 Factory 可独立注册；
- PassConfig 顺序进 Trace；
- 稳定 Fragment ID；
- status / error / diagnostics 正确；
- Order Pass 产生可观察 move Mutation；
- Replay 与 final Fragment 一致；
- Raw Trace 不跨普通 RPC；
- compact Trace 不泄露 Secret / Credential。

### 性能与载荷

- 50、100、500 条目分档测量；
- Activation 全命中 / 部分命中 / 全未命中；
- 短条目与长文本条目；
- Trace on / off；
- Raw / compact Trace 字节数；
- 连续 Preview 无非预期跨 Build 可变状态。

## 12. 完成标准

以下条件全部满足后，才能将计划标记为 Complete：

1. `application-runtime` 的第一方 PromptBuild 真实 import 并调用 `@loom/core` public API；
2. Core 中的 Fragment 是真实 Prompt Composition 数据，不是只记录“已开始 / 已完成”的摘要占位；
3. materialize / order / emit 三个阶段的 Mutation 可观察；
4. `CompiledPrompt` 从 final Fragment 构造，不依赖 closure callback；
5. Preview 与 Invoke 使用同一 Pipeline；
6. 迁移前后 canonical Messages / Projection 在 characterization tests 中保持兼容；
7. Client 可读取真实 compact PromptBuild Trace；
8. Raw Core Trace 不被普通 Log 或 RPC 全量复制；
9. 500 条目规模验收通过，已知性能限制有实测数据；
10. Architecture / Guide 不再描述已删除或未接入的 Pipeline。

## 13. 非目标和后续边界

本计划明确不包含：

- 开放任意 Extension 直接注册 Core Pass；
- Extension Pass 的权限、热重载、排序插槽与故障隔离；
- `@loom/stdlib` 迁入；
- 通用 Capability DAG / 自动拓扑排序；
- Tokenizer 与 Token Budget；
- Prompt Cache / Incremental Build / Watch；
- Tool Schema 或 Tool Call 协议进入 Core；
- Agent Step / ReAct / Agent Loop 调度；
- PromptBuild Trace 的长期持久化表；
- 对旧 `prompt-build-pipeline.ts` 的文件级恢复。

完成本计划后，才根据真实需求继续讨论：

1. Extension 如何通过 Host 受控贡献 PromptBuild Pass；
2. History 与 Current Input 的结构身份转入 [`prompt-build-zone-slot-entry-composition-plan.md`](prompt-build-zone-slot-entry-composition-plan.md)；Tool / Multimodal content 继续延期；
3. Core `mode: off`、Owner 聚合或 Trace 内存是否需要改造；
4. Activation / Resolution / Budget 是否需要拆成更细粒度 Pass。
