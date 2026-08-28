# State / Mutation API v0

> **状态**：从 ADR-005 迁移 / 开放设计  
> **来源**：[`../adr/ADR-005-official-concept-stack-open-design.md`](../../adr/ADR-005-official-concept-stack-open-design.md)

---

## CS-5：State / Mutation API

### 11.1 问题

Setting Layer 需要容纳可变状态，但这不等于要在 CS-0 阶段定义完整数据库或 SQL 系统。

需要讨论的是：Studio Application 是否提供一个简单、可回滚、可被 AI 和授权插件使用的状态修改能力。

当前方向：

```text
Mutable state belongs to the same setting foundation,
but mutation execution/API may be provided by a first-party AIRP state/mutation package.
```

### 11.2 开放问题

- Setting Layer 中的 KV 如何寻址？通过 path、id、树状目录，还是其他方式？
- KV 是否绑定 Card、Session、Opening、某个 setting subtree？
- AI 如何提出状态更新？
- 授权插件如何通过受控 API 修改状态？
- 是否需要 command DSL / SQL-like 语法，还是先用更简单的 patch API？
- State Patch 是否作为 Document 存储？
- Runtime 自动生成的状态是否需要用户确认？
- 状态更新如何参与 rollback / restore-as-new-version？
- 哪些 state 会被投影进 prompt，哪些只作为内部数据？

### 11.3 候选方向

```text
State is setting data, not prompt text.
State -> selected setting projection -> fragments -> prompt.
```

可能的 future document types，namespace 待重新评估：

```text
official.concept.memory.entry
official.concept.summary.chunk
official.concept.state.snapshot
official.concept.state.patch
```
