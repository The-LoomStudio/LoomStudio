# Loom Studio 方法论

> **状态**：Living Notes / Design Method
> **目的**：记录 Loom Studio 当前采用的讨论与开发方法，避免后续对话反复重建同一套前提。

---

## 1. 当前方法论

Loom Studio 当前不是纯 SDD，也不是纯 DDD。

更准确的描述是：

```text
领域发现 -> 场景模拟 -> ADR / Spec 收口 -> 最小实现验证
```

或者：

```text
Domain Discovery + Scenario-Driven Design + Spec-Gated Implementation
```

含义：

- 用 DDD 式的领域发现识别 Card、Session、Opening、Setting Layer、Composition Skeleton、Runtime、Provider Adapter 等边界；
- 用真实使用场景检查这些边界是否帮到了作者、玩家、插件作者和 provider adapter 作者；
- 用 ADR / spec 把稳定结论写下来，再进入实现；
- 实现时只做能验证当前场景的最小闭环，不预先建模所有未来数据。

---

## 2. 核心原则

### 2.1 不做 Schema-first

不要一开始就试图把所有数据结构建模完整。

Studio Application 的对象会非常多：

```text
Card
Session
Chat / Timeline
Opening
Setting Layer
Composition Skeleton
Knowledge / Memory
State / Mutation
Runtime
Provider Adapter
Plugin Contribution
```

如果先追求完整 schema，容易产生两个问题：

1. 过早固化错误抽象；
2. 为尚未验证的能力添加字段、层级和兼容负担。

默认策略是：

```text
先找具体场景，再抽稳定模型。
```

### 2.2 先问“谁在做什么”

每次讨论一个模型前，先明确用户或作者角色。

常见角色包括：

- 预设作者；
- 简单卡作者；
- 复杂卡作者；
- 插件作者；
- Provider Adapter 作者；
- Importer / Compatibility 作者；
- 玩家 / 普通使用者；
- Studio 内建功能维护者。

不要只问“这个字段怎么设计”，而要问：

```text
这个人在什么场景下需要这个能力？
Studio 给了什么支持？
Studio 制造了什么阻碍？
这个阻碍是必要约束，还是设计失败？
```

### 2.3 平台开发要区分支持面和约束面

Loom Studio 是开发平台，不只是单一应用。

因此每个设计都要同时回答：

- 默认体验是否简单；
- 高级作者是否能逃逸；
- 插件是否有明确接入点；
- Provider 差异是否能被诊断；
- Trace 是否能解释最终行为；
- Kernel 是否仍保持领域无关。

### 2.4 保留领域洞察，不照搬历史包袱

例如 SillyTavern 的经验：

- 保留：preset 作为 composition skeleton；
- 保留：marker / slot 作为骨架填充机制；
- 保留：内部 chat message 不等于 provider-facing `messages[]`；
- 警惕：把 OpenAI-style `messages[]` 当成所有 provider 的通用真理；
- 警惕：runtime、composition、provider、UI mutation 和 extension hooks 混在一起。

---

## 3. 讨论流程

新的 Application Layer 议题优先按这个顺序推进：

```text
1. 明确问题和非目标
2. 列出真实角色与场景
3. 模拟场景中的操作流程
4. 记录 Studio 提供的支持与阻碍
5. 找到最小稳定抽象
6. 写入 ADR / spec
7. 用 M0 实现或 fixture 验证
```

如果第 2 步和第 3 步说不清楚，通常不应该直接写最终 schema。

---

## 4. 与 SDD / DDD 的关系

### DDD 部分

Loom Studio 需要领域发现，因为很多概念不是纯技术结构：

- `messages[]` 不是 Chat 本体；
- Opening 不是特殊第一条 Chat message；
- Card 不等于 Character；
- Setting Layer 不等于应用 Preferences；
- Composition Skeleton 不等于 provider request body。

这些判断属于领域边界判断。

### SDD 部分

Loom Studio 也需要规格驱动，因为平台边界一旦实现就会成为生态契约。

因此稳定结论要进入：

- ADR；
- Application Layer spec；
- RPC surface 文档；
- scenario fixture / test plan。

### 当前组合

当前采用：

```text
领域驱动地发现问题；
场景驱动地验证抽象；
规格驱动地进入实现。
```

---

## 5. 相关文档

- [`scenario-driven-design-v0.md`](scenario-driven-design-v0.md)
- [`../08-ApplicationLayer/README.md`](../08-ApplicationLayer/README.md)
- [`../reference/sillytavern-architecture-reference.md`](../reference/sillytavern-architecture-reference.md)
