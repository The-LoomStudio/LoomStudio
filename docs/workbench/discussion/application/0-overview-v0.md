# Studio Application 总览 v0

> **状态**：从 ADR-005 迁移 / 开放设计
> **来源**：[`../adr/ADR-005-official-concept-stack-open-design.md`](../../adr/ADR-005-official-concept-stack-open-design.md)

---

## 0. ADR 状态说明

本 ADR 是一个**未完成决策文档**。

> 2026-05-20 方向修正：本文中的 `Official Concept Stack` / `Concept Stack` 是历史术语。最新方向改为 `Studio Application`。该 Layer 是 Studio 第一方内建 product/package layer，不进入 Kernel，也不作为 ordinary extension。

它不是最终规格，也不是实现任务单。它用于长期承载 Studio Application 的核心讨论，并避免在实现前把大量未定概念散落到聊天记录、issue 或临时代码中。

本文当前作用：

1. 记录为什么 Studio Application 需要单独设计；
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

接下来如果要支撑真实 AIRP / LLM 游玩体验实现完整的应用层，Studio 需要内建一套第一方 Application。该 Layer 需要定义：

- Chat 结构；
- Card 作为可分发、可游玩、可开发的顶层内容单元；
- 统一设定层，而不是把角色描述、世界书、状态、场景变量拆成互相重复的孤岛；
- Opening 作为开场内容，而不是特殊的第一条 Chat message；
- Composition Skeleton 作为 prompt / message payload 的声明式骨架；
- Document 到 Fragment 的 source adapter；
- Fragment 组合、排序、激活、裁剪、输出规则；
- 与 Runtime、Provider adapters、Secret Store、Studio AIRP UI 的边界。
换句话说,这一层就是最后一层,完成了这一层,理应当就是和 SillyTavern一样可以支持完整的游玩

现有生态如 SillyTavern、角色卡系统和世界书系统提供了大量现实经验，但它们也携带历史包袱：

- `messages[]` 被误当成 Chat 本体；
- Preset / Prompt Manager 与 UI 结构强绑定；
- Worldbook activation、placement、depth injection、sticky、cooldown 等概念混合；
- Character Card 被误当成顶层 canonical model，但下一代内容单元不应被限制为单角色；
- 角色描述、Personality、Scenario、Author's Note 等字段在 prompt builder 中形成过多特殊通道；
- Chat history、memory、summary、state patch 边界不清；
- 前端编辑模型和后端 prompt 编译模型耦合；
- 很多行为难以 trace 和解释。
- 等等

Studio Application 的目标不是“优化 SillyTavern 已有概念”，而是定义 Loom Studio 自己的第一套 AIRP 领域协议和默认完整游玩体验。

---

## 2. 问题陈述

Loom Studio 需要一个第一方 Application，但不能把它设计成：

```text
SillyTavern Prompt Manager + World Info + Chat Log 的简单重写
```

也不能把它设计成：

```text
Kernel 内置 Chat Runtime / Provider Gateway / messages[] schema
```

需要解决的问题是：

> 如何在不污染 Kernel 的前提下，定义一套足够真实、可扩展、可解释、可由前端直接承载的第一方 AIRP 领域模型，使 Loom Studio 能支撑完整 AIRP 游玩体验和复杂 LLM 上下文组装？

这个问题很大，不能一次性拍板。因此本文先记录缺失层与讨论计划。

---

## 3. 非目标

Studio Application 第一轮讨论不做：

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
- 不把完整产品 UI 做成普通 extension 的必需 contribution；
- 不在 M0 支持所有复杂世界书行为，如 recursive / sticky / cooldown / delay / regex / vector lore；
- 不把 prompt 组合规则隐藏在前端组件中。

---

## 4. 高层边界

当前修正后的候选边界：

```text
Studio Application:
  - Studio 第一方内建 product/package layer
  - 提供默认完整 AIRP 体验
  - 定义 AIRP 领域 Document Types
  - 定义 Card / Chat / Opening / Setting Layer / Composition Skeleton 模型
  - 把 Documents 转成 Fragment[]
  - 调用 loom.run 或提供可调用的 compose RPC
  - 输出 compiled prompt payload
  - 提供 trace / diagnostics explainability
  - 提供 Studio AIRP UI 主体验所需的领域协议

AIRP Runtime package:
  - append user message
  - call AIRP composition
  - call provider.invoke
  - append assistant message
  - manage streaming events and response state

Provider Adapter Extension:
  - provider profile
  - model list
  - map compiled payload to provider-specific request body
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

Kernel 不认识 Studio Application 内的 Card、Chat、Setting Layer、Opening、Skeleton 或 messages。Kernel 只看到 Document、RPC、Event、Extension、Fragment invocation 和 Trace facts。

重要边界：

```text
内建于 Studio 产品层 ≠ 内建于 Kernel。
```

因此以下 API 仍然不应出现在 Kernel：

```text
kernel.card.create
kernel.chat.send
kernel.setting.update
```

---

## 5. 开放讨论层级

Studio Application 至少需要以下层级讨论。

| 编号 | 层 | 核心问题 | 目标产物 | 优先级 | 状态 |
|---|---|---|---|---|---|
| CS-0 | Studio Application 定位 | 第一方 Application 是什么，不是什么；顶层内容单元是什么 | overview / principles | P0 | 部分收束 |
| CS-1 | Chat / Opening 结构 | Chat、compiled message、Opening 如何区分 | chat-opening model spec | P0 | 开放 |
| CS-2 | Composition Skeleton / Preset | Skeleton、slot、cluster、排序和输出方式 | skeleton model spec | P0 | 开放 |
| CS-3 | Unified Setting Layer | 统一设定层如何表达静态设定、动态状态、嵌套目录和可投影内容 | setting model spec | P0 | 开放 |
| CS-4 | Global Scope | 全局用户设定、全局设定库、跨 Card 作用域如何建模 | scope model spec | P0 | 开放 |
| CS-5 | State / Mutation API | 设定层中的可变 KV、AI 更新、回滚和简单调用 API | state-mutation spec | P1 | 开放 |
| CS-6 | Composition Pipeline | Documents 如何变 Fragment，Fragment 如何排序和 emit | composition pipeline spec | P0 | 开放 |
| CS-7 | Runtime Boundary | Studio Application 与 Runtime / Provider 的边界 | runtime boundary ADR | P1 | 开放 |
| CS-8 | Studio AIRP UI Integration | 前端如何内建 AIRP 主体验，同时保留扩展点 | frontend integration spec | P2 | 开放 |
| CS-9 | Import / Compatibility | ST / CityTalent / 角色卡数据如何导入 | compatibility spec | P3 | 延后 |
| CS-10 | Trace / Explainability | 如何解释 prompt 来源、排序、激活和裁剪 | trace explanation spec | P1 | 开放 |
