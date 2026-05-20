# Studio AIRP UI Integration v0

> **状态**：从 ADR-005 迁移 / 开放设计  
> **来源**：[`../adr/ADR-005-official-concept-stack-open-design.md`](../adr/ADR-005-official-concept-stack-open-design.md)

---

## CS-8：Studio AIRP UI Integration

### 14.1 问题

Frontend 暂时延后，但 AIRP backend model 必须能支撑 Studio 内建的默认 AIRP UI。

旧方向把这一层描述为 Concept Stack 向独立 frontend 暴露 protocol surface。根据 2026-05-20 的修正，AIRP 主体验倾向直接内置于 Studio client，而不是由 ordinary extension 注册后才出现。

Studio AIRP UI 至少需要支撑：

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

- Studio AIRP UI 应直接编辑 Documents，还是调用 AIRP domain RPC？
- 哪些操作需要 domain RPC wrappers？
- nested Setting Layer editor 需要什么能力？
- setting activation / selection testing 需要什么能力？
- Skeleton slot / cluster editor 需要什么能力？
- compose preview 是否应作为 M0 UI 优先级？
- 第三方完整替代体验是否应通过独立进程 / 数据根 / namespace 隔离，而不是替换 Studio Application？

### 14.3 过期候选 RPC Surface

以下列表来自旧的 `official.concept.*` 方向，尚未接受，并且 namespace 需要根据 Studio Application 方向重新评估。

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

这不是已接受 API，只是历史讨论列表。尤其是 `settings.*` 命名需要避免和应用 Preferences 混淆，未来更可能拆分为 `settingLayer` 或其他更明确的领域名称。
