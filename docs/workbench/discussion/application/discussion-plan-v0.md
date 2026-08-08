# Studio Application 讨论计划 v0

> **状态**：Open Design  
> **目的**：决策驱动讨论计划，不按文档目录顺序，而按"会阻塞其他模块的决策点"推进。

---

## 1. 为什么不按文档顺序讨论

Application Layer 的模块互相牵扯。如果按线性顺序逐个讨论，会遇到：

```text
讨论 Prompt Builder 时，不知道 Runtime Transcript 和 Narrative Timeline 的关系。
讨论 Setting Layer 时，不知道 Agent 主动搜索需要什么能力。
讨论 Composition Skeleton 时，不知道 Preset 是否支配 Agent 行为。
讨论 ToolCall 时，不知道 commit_output 是 Tool 还是 Runtime API。
```

所以讨论顺序应该由决策依赖决定，而不是文档目录决定。

---

## 2. 核心耦合点

```text
Scope / Isolation
  <-> Session / Card / Global Scope
  <-> Source Set
  <-> Rollback Boundary
  <-> Prompt Projection

Agent Model
  <-> Runtime Policy
  <-> Tool / Capability
  <-> Permission / Consent

Runtime Transcript / Narrative Timeline
  <-> Chat / Opening / Session
  <-> ToolCall / ToolResult / Commit
  <-> Prompt Builder 输入
  <-> Trace

Setting Layer
  <-> Prompt Source Projection
  <-> Agent Search / Retrieval
  <-> Memory / Summary
  <-> State Mutation

Composition Skeleton / Preset
  <-> Prompt Builder
  <-> Setting Layer Projection
  <-> Provider Compatibility

Provider Adapter / Gateway
  <-> Compiled Prompt Payload
  <-> Runtime Provider Binding
  <-> Streaming / Cancellation
  <-> Tool-call Mapping
  <-> Secret Store

Transform Rule
  <-> Prompt Transform
  <-> Provider Response Transform
  <-> Commit Validation
  <-> State Extraction
  <-> Import Transform
```

---

## 3. 讨论方式：主线 + 回环

不采用"完整讨论完一个模块再进入下一个"的方式。

而是：

```text
主线推进:
  Agent Model -> Transcript / Narrative -> Tool / Commit -> Setting Layer -> Prompt Builder -> ...

每一轮只收束会阻塞下一轮的最小结论。
不追求一次性把该模块讲完。

回环深化:
  Agent Model 第一轮: 只定 Agent ≠ Character
  回到 Agent Model 第二轮: 讨论 Agent 配置与 Card 关系
  回到 Agent Model 第三轮: 讨论 Multi-Agent 协作
```

---

## 4. 每轮讨论固定模板

```text
1. 本轮只解决什么？
2. 本轮明确不解决什么？
3. 涉及哪些角色？
4. 需要支持的最小场景是什么？
5. 当前候选概念有哪些？
6. 哪些概念必须进入 canonical model？
7. 哪些只是 runtime policy / UI / provider adapter 细节？
8. 对其他文档有什么影响？
9. 本轮结束标准是什么？
```

---

## 5. 主线讨论计划

### 第 0 场：Scope / Isolation Map

```text
目标:
  先确定哪些数据互相隔离，哪些数据可以共享。

必须回答:
  - Narrative Timeline 与 Agent Session 分别拥有什么
  - Card 是内容包边界还是运行实例边界
  - Global / Workspace / Card / Narrative / Agent Session / Run / Step scope 如何分工
  - Prompt Builder 每轮看到的 Source Set 由谁构造
  - Reroll / rollback 以什么为边界

涉及文档:
  document-map-v0.md, isolation-scope-boundary-v0.md, global-scope-v0.md

结束标准:
  能明确 Narrative Timeline 与 Agent Session Tree 不共根、不镜像、不自动同步回退。
  能明确 Prompt Builder 不扫描整个 workspace，只消费 Runtime 给出的 Source Set。
```

### 第 0.5 场：Narrative Timeline / Agent Session Data Model

```text
目标:
  把 Narrative Timeline、Agent Session Tree、Step、Changeset 和 Provider payload 的关系先铺平。

必须回答:
  - Narrative Timeline 保存什么
  - Agent Session Tree 保存什么
  - Step、Run 和 Transcript 如何关联
  - Changeset 如何记录真实修改
  - Provider messages-like payload 和 canonical timeline 的关系
  - Opening 如何初始化 Narrative Timeline

涉及文档:
  session-timeline-data-model-v0.md, chat-opening-model-v0.md, airp-runtime-model-v0.md

结束标准:
  能明确 messages[] 不是 Chat 本体。
  能明确 Provider response 只有通过 commit 才能写入 Narrative Timeline。
  能明确 Narrative 与 Agent Session 是两棵独立树。
```

### 第 1 场：Agent Model

```text
目标:
  定义 Agent 不是什么，尤其不是 Character。

必须回答:
  - Agent 和 Character / Persona / Narrator / Runtime 的关系
  - Agent 是否可以是 Card 的一部分
  - Agent 的工作内容在哪里保存
  - Agent 的产出如何提交

涉及文档:
  agent/agent-model-v0.md

结束标准:
  能明确回答 Agent ≠ Character，Agent 是工作主体。
  能明确 Agent 产出通过 commit 写入 Narrative Timeline。
```

### 第 2 场：Runtime Transcript / Narrative Timeline

```text
目标:
  定义工作流和产物流的分离。

必须回答:
  - Runtime Transcript 包含什么
  - Narrative Timeline 包含什么
  - 用户输入如何分类
  - assistant message 是否能自动落入 Narrative Timeline
  - Opening 和 Narrative Timeline 的关系
  - 失败 run 丢弃时哪些内容不污染产出

涉及文档:
  airp-runtime-model-v0.md, chat-opening-model-v0.md

结束标准:
  能画出 Runtime Transcript 和 Narrative Timeline 的边界表。
  能回答 assistant message 不自动落入 Narrative Timeline。
```

### 第 3 场：Tool / Capability / Commit

```text
目标:
  定义工具调用和剧情写入路径。

必须回答:
  - ToolCall / ToolResult 是否是一等 transcript entry
  - commit_output 是普通工具、Runtime API，还是两者都允许
  - ToolResult 默认是否进入下一轮上下文
  - commit 的结果如何关联 trace / audit

涉及文档:
  agent/tool-capability-v0.md, agent/permission-consent-v0.md

结束标准:
  能明确 ToolCall / ToolResult 是 transcript 一等条目。
  能明确 commit 是受控写入路径。
```

### 第 4 场：Setting Layer + Retrieval

```text
目标:
  讨论 Setting Layer 不只是静态设定，还要支持 Agent 主动搜索。

必须回答:
  - Setting Layer 保存哪些内容
  - 哪些 prompt-facing，哪些 private
  - Agent 搜索 Setting Layer 是 Tool 调用还是 Source Adapter
  - 搜索结果如何进入 Prompt Builder

涉及文档:
  setting-layer-v0.md, agent/retrieval-search-v0.md, prompt/setting-layer-prompt-source-v0.md

结束标准:
  能明确 Setting Layer 提供 query 能力。
  能明确搜索结果是 ToolResult，不是自动注入 prompt。
```

### 第 5 场：Prompt Builder + Skeleton + Setting Projection

```text
目标:
  讨论 Prompt Builder 如何消费 Setting / Runtime / Narrative / Tool results 的投影。

必须回答:
  - Prompt Builder 消费哪些 source adapter
  - Skeleton 如何支配 Setting Layer 内容投影
  - Prompt Builder 输出什么 payload
  - Provider Adapter 如何映射 compiled payload

涉及文档:
  prompt/README.md, prompt/loom-core-integration-v0.md, composition-skeleton-v0.md

结束标准:
  能明确 Prompt Builder 只编译上下文投影，不拥有 agent loop。
  能明确 Skeleton 支配投影规则。
```

### 第 5.5 场：Provider Adapter / Gateway Contract

```text
目标:
  定义模型网关层如何接 Runtime 和 Prompt Builder，而不进入 Kernel。

必须回答:
  - Provider Profile / Model Capability / Provider Binding 的边界
  - invoke / stream RPC 的输入输出
  - provider-native tool-call 如何映射为 Studio ToolCall
  - provider error / usage 如何归一
  - Secret Store 如何被 Provider Adapter 使用

涉及文档:
  provider-adapter-contract-v0.md, runtime-boundary-v0.md, prompt/loom-core-integration-v0.md, ADR-004

结束标准:
  能明确 Provider Adapter 只消费 compiled prompt payload。
  能明确 Provider Adapter 不读取 Card / Setting / Session documents。
```

### 第 5.75 场：Runtime Turn Flow

```text
目标:
  串起玩家输入到回复落盘的完整 loop。

必须回答:
  - 玩家输入进入哪些数据结构
  - 何时创建 checkpoint
  - compose / provider / tool / commit 的调用顺序
  - streaming / suspend / confirmation 事件如何进入 UI
  - run changeset 如何关联 narrative / state / mount / memo

涉及文档:
  runtime-turn-flow-v0.md, session-timeline-data-model-v0.md, provider-adapter-contract-v0.md, agent/agent-runtime-loop-v0.md

结束标准:
  能画出默认 M0 turn sequence。
  能回答一次失败 run 为什么不污染 Narrative Timeline。
```

### 第 6 场：Transform Rule / Regex

```text
目标:
  讨论 regex 应在哪些阶段生效，如何 trace / rollback / permission。

必须回答:
  - 有哪些 Transform Phase
  - 哪些 phase 允许修改 canonical data
  - 规则执行是否进入 trace
  - ST regex script 如何映射

涉及文档:
  transform-rule-system-v0.md

结束标准:
  能明确 Regex 不是随处运行的脚本，而是受控 Transform Phase 中的规则。
```

### 第 7 场：Memory / Summary / State Mutation

```text
目标:
  讨论 Agent 写操作和状态更新。

必须回答:
  - Memory write 是 Tool 调用还是 State Mutation API
  - 截断策略由谁决定
  - StatePatchCandidate 如何确认和回滚
  - commit narrative 和 apply state patch 是否在同一事务

涉及文档:
  memory-summary-v0.md, state-mutation-api-v0.md

结束标准:
  能明确 Memory / Summary 是 Agent 写操作 + 截断。
  能明确状态更新是受控写入。
```

### 第 8 场：Trace / Explainability

```text
目标:
  扩展 trace 模型到 run / step / commit / search / transform / mutation 级别。

必须回答:
  - Run trace 是否包含所有 step
  - Search 命中如何 trace
  - Transform Rule 执行如何 trace
  - Commit 和 State Mutation 如何 trace

涉及文档:
  trace-explainability-v0.md, airp-runtime-model-v0.md

结束标准:
  能回答"为什么 runtime 写了这段剧情"的完整 trace 链。
```

### 第 9 场：User Input Intent

```text
目标:
  讨论用户输入的分类和路由。

必须回答:
  - 用户输入是否总是先进入 Runtime Transcript
  - 角色扮演对话中用户输入是否默认进入 Narrative Timeline
  - M0 采用哪种输入方式

涉及文档:
  user-input-intent-v0.md

结束标准:
  能明确用户输入至少进入 Runtime Transcript，是否进入 Narrative 由上下文决定。
```

### 第 10 场：Extension Contribution

```text
目标:
  讨论 Extension 如何贡献 Application 领域能力。

必须回答:
  - Extension 可以贡献哪些内容 / 能力 / 规则
  - Extension 贡献是否需要确认
  - Extension Tool 是否需要单独权限

涉及文档:
  extension/airp-extension-contribution-v0.md

结束标准:
  能明确 Extension 贡献遵循 Application Layer 的受控路径。
```

---

## 6. 后置议题

以下议题在主线稳定后再深入：

```text
- Runtime Replay / Debug
- Packaging / Distribution
- Import / Compatibility 重写
- Multi-Agent 编排协议
- 完整 Agent Step taxonomy
- 完整 hook 系统
- 向量检索
- 完整 UI 设计
```

---

## 7. 决策依赖图

```text
Scope / Isolation
  ├─> Session / Timeline
  ├─> Source Set
  ├─> State rollback
  └─> Prompt projection

Agent Model
  ├─> Runtime Policy
  ├─> Tool / Capability
  │     └─> Retrieval / Search
  └─> Permission / Consent

Runtime Transcript / Narrative Timeline
  ├─> Chat / Opening / Session
  ├─> ToolCall / ToolResult / Commit
  ├─> Prompt Builder 输入
  └─> Trace

Setting Layer
  ├─> Prompt Source Projection
  ├─> Retrieval / Search
  ├─> Memory / Summary
  └─> State Mutation

Composition Skeleton / Preset
  ├─> Prompt Builder
  ├─> Setting Layer Projection
  └─> Provider Compatibility

Provider Adapter
  ├─> Provider Binding
  ├─> Streaming Events
  ├─> Tool-call Mapping
  └─> Secret Store

Transform Rule
  ├─> Prompt Transform
  ├─> Provider Response Transform
  ├─> Commit Validation
  └─> Import Transform
```
