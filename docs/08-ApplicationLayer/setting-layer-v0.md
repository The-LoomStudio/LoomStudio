# Unified Setting Layer v0

> **状态**：从 ADR-005 迁移 / 开放设计
> **来源**：[`../adr/ADR-005-official-concept-stack-open-design.md`](../adr/ADR-005-official-concept-stack-open-design.md)

---

## 来自 CS-0 的 Setting 方向

#### 6.1.8 统一设定层是核心方向

Studio Application 不应把：

```text
静态知识
角色描述
世界书
状态变量
场景事实
长期记忆
```
这些本质都为"上下文"的东西
拆成彼此孤立的系统。

这样会导致：

- 同一个对象在 Knowledge 层和 State 层重复出现；
- 设定随时间变化后，静态知识滞后；
- 插件各自发明路径，例如 `battle.alice.health`、`roman.alice.love`；
- prompt composition 必须靠后期聚合弥补地基层混乱。

当前方向是建立一个更统一的设定层：

```text
Setting Layer
```

但 Setting Layer 的具体形状仍未定。

当前只确定原则：

```text
Setting is the source of truth.
Prompt is a projection.
Mutable state 应在同一个 setting foundation 中可寻址，
而不是形成独立的 shadow world。
```

Setting Layer 需要进一步讨论：

- 如何嵌套；
- 是否采用树状目录系统；
- 如何通过 id / path 索引；
- 如何挂载 KV；
- 如何与 session 绑定和回滚；
- 如何让插件和 AI 用简单 API 修改；
- 如何避免过早硬编码类体系。

#### 6.1.9 Book 概念弱化

`Worldbook / KnowledgeBook` 中的 `Book` 不是核心语义。

如果保留类似概念，它应只是 collection / folder / bundle / namespace，而不是设定层的最小原子或行为拥有者。

最小原子暂时只称为：

```text
Setting entry
```

但它的具体字段、是否带 KV、如何嵌套、如何激活，仍需单独讨论。

---

## CS-3: Unified Setting Layer

### 9.1 问题

“世界书”这个词来自既有生态，但 Studio Application 不应只建立一个静态 Knowledge model。

当前问题是：设定、知识、状态、变量、场景事实如果被拆成多个孤岛，会导致重复和滞后。

因此本层暂称：

```text
Setting Layer
```

Setting Layer 需要表达：

- 常驻知识；
- 关键词激活知识；
- 场景上下文；
- 世界设定；
- 可变状态 / KV；
- 可嵌套目录；
- 可通过 id / path 索引的设定项；
- 未来的语义检索 / embedding 知识；
- 激活原因和未激活原因；
- 如何投影为 prompt fragments。

### 9.2 开放问题

- Setting Layer 的最小原子叫什么？`SettingEntry` 是否足够？
- Setting Layer 是否采用树状目录 / 嵌套结构？
- 如何表达可变 KV，而不建立独立 shadow state world？
- 如何避免预设 `Entity / StateRecord / RelationRecord / RuleEntry / SceneEntry` 等硬编码分类？
- `Book` 是否只作为弱 collection / folder 概念？
- 激活时扫描哪些源？
  - recent chat messages
  - opening
  - card setting layer
  - global setting layer
  - active scene
  - session summary
  - previous activated entries
- M0 是否支持 recursive activation？
- 是否支持 regex？
- 是否支持 sticky / cooldown / delay？
- 是否支持 negative keywords？
- 是否支持 semantic search？
- 激活和注入是否应该拆成两个 Pass？
- inactive entries 是否进入 trace？
- KV 修改 API / 命令 / SQL-like 语法是否属于 first-party AIRP state/mutation package，而不是 Setting Layer schema 本身？

### 9.2.1 术语边界

`Setting Layer` 指 AIRP 作品设定层，不是 Studio 应用设置。

术语约定：

```text
Setting Layer:
  AIRP 作品设定层。

Preferences:
  应用设置 / 用户偏好。

Settings:
  不作为主要 UI 术语使用，避免和 Setting Layer 混淆。
```

Config / Settings / Preferences / Setting Layer 的系统边界尚未在本文处理，应后续单独形成 ADR。

### 9.3 已废弃草案

```ts
type KnowledgeEntry = {
  id: string
  bookId: string
  title: string
  content: string
  enabled: boolean
  activation: ActivationRule
  placement: PlacementRule
  priority: number
  tags?: string[]
  scope?: KnowledgeScope
}

type ActivationRule =
  | { kind: 'always' }
  | { kind: 'manual' }
  | { kind: 'keyword'; keywords: string[]; caseSensitive?: boolean }
```

上面的 `KnowledgeEntry` 草案仅作为旧讨论产物保留。如果把它解释为静态知识，它就过于狭窄；在 Setting Layer 讨论清楚前，它不应驱动实现。

M0 候选限制可能仍然是：

```text
支持：always、manual、simple keyword activation
延后：recursive、sticky、cooldown、delay、regex、embedding、vector lore
```
