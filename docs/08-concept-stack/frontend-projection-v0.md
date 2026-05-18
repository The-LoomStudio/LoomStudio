# Frontend Projection v0

> **状态**：从 ADR-005 迁移 / 开放设计  
> **来源**：[`../adr/ADR-005-official-concept-stack-open-design.md`](../adr/ADR-005-official-concept-stack-open-design.md)

---

## CS-8：Frontend Projection

### 14.1 问题

Frontend 暂时延后，但 backend model 必须能投影成可用 UI。

Concept Stack 应暴露一个 protocol surface，让独立 frontend 能构建：

- card list / card detail；
- session list；
- chat timeline；
- setting layer editor；
- opening editor；
- composition skeleton editor；
- composition preview；
- trace explanation viewer；
- state / mutation inspector。

### 14.2 开放问题

- frontend 应直接编辑 Documents，还是调用 Concept Stack RPC？
- 哪些操作需要 domain RPC wrappers？
- nested Setting Layer editor 需要什么能力？
- setting activation / selection testing 需要什么能力？
- Skeleton slot / cluster editor 需要什么能力？
- compose preview 是否应作为 M0 UI 优先级？
- 多个 Concept Stacks 应如何在同一个 frontend 中共存？

### 14.3 候选 RPC Surface

```text
official.concept.sessions.list
official.concept.sessions.get
official.concept.sessions.create
official.concept.messages.append
official.concept.cards.list
official.concept.cards.get
official.concept.settings.list
official.concept.settings.update
official.concept.settings.testActivation
official.concept.skeletons.list
official.concept.skeletons.update
official.concept.compose.preview
```

这不是已接受 API，只是讨论列表。
