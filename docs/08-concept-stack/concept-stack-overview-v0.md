# Concept Stack 总览 v0

> **状态**：从 ADR-005 迁移 / 开放设计  
> **来源**：[`../adr/ADR-005-official-concept-stack-open-design.md`](../adr/ADR-005-official-concept-stack-open-design.md)

---

## 0. ADR 状态说明

本 ADR 是一个**未完成决策文档**。

它不是最终规格，也不是实现任务单。它用于长期承载 Official Concept Stack 的核心讨论，并避免在实现前把大量未定概念散落到聊天记录、issue 或临时代码中。

本文当前作用：

1. 记录为什么 Official Concept Stack 需要单独设计；
2. 明确它不能只是 SillyTavern / CityTalent 概念的重命名或优化；
3. 列出必须逐层讨论的缺失层；
4. 约束哪些能力不应进入 Kernel；
5. 为后续拆分正式 ADR / spec 提供目录。

在 `Status` 变为 `Accepted` 前，本文所有数据结构均为候选草案。

---

## 1. 背景

Loom Studio MVP Stage 0-5 已经验证了平台基座：

```text
Client Bridge
  -> Transport JSON-RPC
  -> Kernel RPC Registry
  -> Document Store
  -> Extension Host
  -> Loom Runner
  -> Trace / Diagnostics / Audit abstractions
```

这个基座证明了：

- Kernel 可以作为 headless server 运行；
- Client 可以通过 Transport 调用 Kernel / Extension RPC；
- Document Store 能作为统一数据底座；
- Extension 可以注册 RPC 并互相调用；
- `loom.run` 可以通过 Runner 调用 `@loom/core`；
- Trace / Diagnostics 可以被记录和查询；
- Kernel 没有内置 Chat / Provider / Tool / MCP / `messages[]` 业务语义。

但 MVP 只证明了平台骨架，不提供真实上层产品语义。

接下来如果要支撑真实 LLM 应用，至少需要官方提供一套 Concept Stack。该栈需要定义：

- Chat 结构；
- Card 作为可分发、可游玩、可开发的顶层内容单元；
- 统一设定层，而不是把角色描述、世界书、状态、场景变量拆成互相重复的孤岛；
- Opening 作为开场内容，而不是特殊的第一条 Chat message；
- Composition Skeleton 作为 prompt / message payload 的声明式骨架；
- Document 到 Fragment 的 source adapter；
- Fragment 组合、排序、激活、裁剪、输出规则；
- 与 Chat Runtime、Provider Extension、Secret Store、Frontend Projection 的边界。

现有生态如 SillyTavern、CityTalent、角色卡系统和世界书系统提供了大量现实经验，但它们也携带历史包袱：

- `messages[]` 被误当成 Chat 本体；
- Preset / Prompt Manager 与 UI 结构强绑定；
- Worldbook activation、placement、depth injection、sticky、cooldown 等概念混合；
- Character Card 被误当成顶层 canonical model，但下一代内容单元不应被限制为单角色；
- 角色描述、Personality、Scenario、Author's Note 等字段在 prompt builder 中形成过多特殊通道；
- Chat history、memory、summary、state patch 边界不清；
- 前端编辑模型和后端 prompt 编译模型耦合；
- 很多行为难以 trace 和解释。

Official Concept Stack 的目标不是“优化 SillyTavern 已有概念”，而是定义 Loom Studio 自己的第一套领域协议。

---

## 2. 问题陈述

Loom Studio 需要一个官方 Concept Stack，但不能把它设计成：

```text
SillyTavern Prompt Manager + World Info + Chat Log 的简单重写
```

也不能把它设计成：

```text
Kernel 内置 Chat Runtime / Provider Gateway / messages[] schema
```

需要解决的问题是：

> 如何在不污染 Kernel 的前提下，定义一套足够真实、可扩展、可解释、可由前端投影的官方领域模型，使 Loom Studio 能支撑复杂 LLM 上下文组装？

这个问题很大，不能一次性拍板。因此本文先记录缺失层与讨论计划。

---

## 3. 非目标

Official Concept Stack 第一轮讨论不做：

- 不把 Chat / Provider / Tool / MCP / Agent Runtime 做进 Kernel；
- 不承诺 SillyTavern byte-level 输出兼容；
- 不承诺完整复刻 ST worldbook / preset 行为；
- 不把 ST / CityTalent / 现有角色卡导入兼容作为当前设计驱动力；
- 不把 Character Card 作为内部 canonical 顶层模型；
- 不建立 Actor / Participant / Speaker / CharacterProfile 等过早的硬编码类层级；
- 不定义平台级 provider-neutral invocation schema；
- 不定义 Kernel 级 `messages[]` contract；
- 不实现真实 LLM API 调用；
- 不处理 API key 加密存储；
- 不实现 Tool Loop / MCP Bridge；
- 不先设计完整产品 UI；
- 不在 M0 支持所有复杂世界书行为，如 recursive / sticky / cooldown / delay / regex / vector lore；
- 不把 prompt 组合规则隐藏在前端组件中。

---

## 4. 高层边界

候选边界：

```text
Official Concept Stack:
  - 定义领域 Document Types
  - 定义 Card / Chat / Opening / Setting Layer / Composition Skeleton 模型
  - 把 Documents 转成 Fragment[]
  - 调用 loom.run 或提供可调用的 compose RPC
  - 输出 compiled prompt payload
  - 提供 trace / diagnostics explainability

Official Chat Runtime:
  - append user message
  - call concept.compose
  - call provider.invoke
  - append assistant message
  - manage streaming events and response state

Official Provider Extension:
  - provider profile
  - model list
  - invoke / stream
  - usage parsing
  - provider error normalization

Platform Security:
  - login / workspace unlock
  - Secret Store
  - secretRef
  - redaction
  - capability / audit for secret use

Kernel:
  - Document Store
  - RPC Registry
  - Extension Host
  - Event Bus
  - Loom Runner
  - Trace / Audit / Diagnostics
  - Introspection
```

Kernel 不认识 Concept Stack 内的 Card、Chat、Setting、Opening、Skeleton 或 messages。Kernel 只看到 Document、RPC、Extension、Fragment invocation 和 Trace facts。

---

## 5. 开放讨论层级

Official Concept Stack 至少需要以下层级讨论。

| 编号 | 层 | 核心问题 | 目标产物 | 优先级 | 状态 |
|---|---|---|---|---|---|
| CS-0 | Concept Stack 定位 | 官方栈是什么，不是什么；顶层内容单元是什么 | overview / principles | P0 | 部分收束 |
| CS-1 | Chat / Opening 结构 | Chat、compiled message、Opening 如何区分 | chat-opening model spec | P0 | 开放 |
| CS-2 | Composition Skeleton / Preset | Skeleton、slot、cluster、排序和输出方式 | skeleton model spec | P0 | 开放 |
| CS-3 | Unified Setting Layer | 统一设定层如何表达静态设定、动态状态、嵌套目录和可投影内容 | setting model spec | P0 | 开放 |
| CS-4 | Global Scope | 全局用户设定、全局设定库、跨 Card 作用域如何建模 | scope model spec | P0 | 开放 |
| CS-5 | State / Mutation API | 设定层中的可变 KV、AI 更新、回滚和简单调用 API | state-mutation spec | P1 | 开放 |
| CS-6 | Composition Pipeline | Documents 如何变 Fragment，Fragment 如何排序和 emit | composition pipeline spec | P0 | 开放 |
| CS-7 | Runtime Boundary | Concept Stack 与 Chat Runtime / Provider 的边界 | runtime boundary ADR | P1 | 开放 |
| CS-8 | Frontend Projection | 前端如何投影这些结构，但不绑定 UI | frontend projection spec | P2 | 开放 |
| CS-9 | Import / Compatibility | ST / CityTalent / 角色卡数据如何导入 | compatibility spec | P3 | 延后 |
| CS-10 | Trace / Explainability | 如何解释 prompt 来源、排序、激活和裁剪 | trace explanation spec | P1 | 开放 |
