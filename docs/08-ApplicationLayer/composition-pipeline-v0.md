# Composition Pipeline v0

> **状态**：从 ADR-005 迁移 / 开放设计  
> **来源**：[`../adr/ADR-005-official-concept-stack-open-design.md`](../adr/ADR-005-official-concept-stack-open-design.md)

---

## CS-6: Composition Pipeline

### 12.1 问题

Studio Application composition layer 的核心不是数据 schema 本身，而是：

```text
Documents -> Source Adapter -> Fragment[] -> Loom Pipeline -> Compiled Payload
```

需要明确哪些步骤有 IO，哪些步骤是纯 Pass。

### 12.2 开放问题

- Source Adapter 是否在 AIRP server package 内执行，而不是 Loom Pass？
- Fragment meta 的官方词汇是什么？
- 如何记录 sourceDocumentId？
- 激活结果写入 Fragment meta 还是 diagnostics？
- inactive entries 是否保留到 trace？
- ordering 是一个 Pass 还是多个 Pass？
- budget trimming 是否进入 M0？
- emit 输出是否是 Fragment 还是 AIRP-side payload？
- 是否允许多个 emit target？

### 12.3 候选 M0 Pipeline

```text
Source Adapters:
  LoadSession
  LoadCard
  LoadOpening
  LoadSettingEntries
  LoadCompositionSkeleton
  LoadRecentHistory

Loom Passes:
  NormalizeConceptFragments
  SelectSettingEntries
  FilterInactive
  AssignSlots
  OrderBySlotPriority
  EmitMessagesLikePayload
```

Budget trimming 可以延后到 M0 之后，除非真实 fixtures 显示它已成为必要能力。

---

## M0 候选范围

只有在第一轮和第二轮决策足够稳定后，才应考虑未来的 M0 实现。

可能的 M0：

```text
Documents:
  - 一个 session
  - 若干 messages
  - 一张 card
  - 一个 opening
  - 一个 composition skeleton
  - 若干 setting entries

RPC:
  - official.concept.compose.preview  # 旧候选 namespace，待重新评估

Behavior:
  - 加载 documents
  - 转换为 fragments
  - select / activate simple setting entries
  - assign slots
  - stable ordering
  - emit messages-like compiled payload
  - 写入 trace / diagnostics

Deferred:
  - real provider invoke
  - sendMessage runtime loop
  - streaming
  - recursive knowledge activation
  - sticky / cooldown / delay
  - vector retrieval
  - full frontend UI
```

M0 成功标准应以 explainability 衡量，而不是以功能数量衡量：

```text
用户可以检查 compiled prompt 为什么包含每一部分，
为什么 setting entries 被选中，
以及为什么最终顺序是稳定的。
```

---

## Provider Payload Adapter 边界

Provider adapter 不编译 AIRP documents。

Studio Application composition layer 负责：

```text
AIRP documents -> fragments -> compiled payload
```

Provider adapter 负责：

```text
compiled payload -> provider-specific request body
```

Provider adapter 可以做 role / content parts 转换、provider capability validation、request body 映射、usage / error normalization，但不应理解 Card、Setting Layer、Opening 或 Session 语义。
