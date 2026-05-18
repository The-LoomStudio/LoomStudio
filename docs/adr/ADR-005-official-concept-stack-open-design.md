# ADR-005: Official Concept Stack Open Design

> **Status**: Incomplete / Open Design; content split to `docs/08-concept-stack/`
> **Date**: 2026-05-17
> **Decision scope**: Official Concept Stack domain model, prompt composition model, and runtime boundary after MVP Stage 0-5
> **Owner**: Loom Studio architecture discussion
> **Related**:
> - [`ADR-004-platform-auth-secrets-and-provider-credential-boundary.md`](ADR-004-platform-auth-secrets-and-provider-credential-boundary.md)
> - [`../00-overview/loom-studio-architecture.md`](../00-overview/loom-studio-architecture.md)
> - [`../03-kernel/studio-kernel-public-surface-v0.md`](../03-kernel/studio-kernel-public-surface-v0.md)
> - [`../05-extensions/studio-extension-lifecycle-v0.md`](../05-extensions/studio-extension-lifecycle-v0.md)
> - [`../06-engineering/studio-mvp-development-plan.md`](../06-engineering/studio-mvp-development-plan.md)
> - [`../08-concept-stack/README.md`](../08-concept-stack/README.md)

---

## 0. Status

本 ADR 仍是 Official Concept Stack 的主入口和决策追踪文档，但原本堆积在这里的详细开放设计内容已经分类迁移到：

```text
docs/08-concept-stack/
```

这样做是为了避免 ADR-005 继续膨胀，并为后续大议题保留独立讨论空间。

迁移方式：

```text
ADR-005:
  保留索引、状态、链接、总体决策追踪。

08-concept-stack/:
  原封不动承载已迁移的专题内容，后续在专题文档中继续细化。
```

在 `Status` 变为 `Accepted` 前，`08-concept-stack/` 内的候选 TypeScript 草案和模型描述仍不是 accepted API。

---

## 1. Migrated Documents

### 1.1 总览与原则

| 文件 | 内容 |
|---|---|
| [`../08-concept-stack/README.md`](../08-concept-stack/README.md) | Official Concept Stack 文档区索引 |
| [`../08-concept-stack/concept-stack-overview-v0.md`](../08-concept-stack/concept-stack-overview-v0.md) | 原 ADR-005 §0~§5：状态说明、Context、Problem、Non-goals、High-level Boundary、Open Discussion Layers |
| [`../08-concept-stack/discussion-order-v0.md`](../08-concept-stack/discussion-order-v0.md) | 原 ADR-005 §17、§19、§21：讨论顺序、未决事项、实施前置条件 |

### 1.2 Card 与内容单元

| 文件 | 内容 |
|---|---|
| [`../08-concept-stack/card-model-v0.md`](../08-concept-stack/card-model-v0.md) | 原 ADR-005 CS-0 中 Card、metadata、Character 字段、Example Dialogues、Group Chat、硬编码类层级、Import 延后等内容 |

### 1.3 Chat 与 Opening

| 文件 | 内容 |
|---|---|
| [`../08-concept-stack/chat-opening-model-v0.md`](../08-concept-stack/chat-opening-model-v0.md) | 原 ADR-005 Opening 方向与 CS-1 Chat / Opening Model |

### 1.4 Composition Skeleton

| 文件 | 内容 |
|---|---|
| [`../08-concept-stack/composition-skeleton-v0.md`](../08-concept-stack/composition-skeleton-v0.md) | 原 ADR-005 Preset / Composition Skeleton 方向与 CS-2 |

### 1.5 Unified Setting Layer / Global / State

| 文件 | 内容 |
|---|---|
| [`../08-concept-stack/setting-layer-v0.md`](../08-concept-stack/setting-layer-v0.md) | 原 ADR-005 统一设定层方向与 CS-3 |
| [`../08-concept-stack/global-scope-v0.md`](../08-concept-stack/global-scope-v0.md) | 原 ADR-005 CS-4 Global Scope |
| [`../08-concept-stack/state-mutation-api-v0.md`](../08-concept-stack/state-mutation-api-v0.md) | 原 ADR-005 CS-5 State / Mutation API |

### 1.6 Composition / Runtime / Frontend / Compatibility / Trace

| 文件 | 内容 |
|---|---|
| [`../08-concept-stack/composition-pipeline-v0.md`](../08-concept-stack/composition-pipeline-v0.md) | 原 ADR-005 CS-6 与 M0 Candidate Scope |
| [`../08-concept-stack/runtime-boundary-v0.md`](../08-concept-stack/runtime-boundary-v0.md) | 原 ADR-005 CS-7 Runtime Boundary |
| [`../08-concept-stack/frontend-projection-v0.md`](../08-concept-stack/frontend-projection-v0.md) | 原 ADR-005 CS-8 Frontend Projection |
| [`../08-concept-stack/compatibility-import-v0.md`](../08-concept-stack/compatibility-import-v0.md) | 原 ADR-005 CS-9 Import / Compatibility |
| [`../08-concept-stack/trace-explainability-v0.md`](../08-concept-stack/trace-explainability-v0.md) | 原 ADR-005 CS-10 Trace / Explainability |

---

## 2. Current Settled Direction Summary

以下摘要保留在 ADR 中作为快速导航。详细原文见上方专题文档。

1. `Card` 是顶层内容单元，不等同于 `Character`。
2. Card metadata / readme 只服务展示，不作为 prompt builder 特殊输入。
3. `Character description` / `Personality` / `Scenario` 不作为 canonical prompt 字段。
4. `Opening` 取代 `First Message`，且不是特殊的第一条 Chat 元素。
5. ST `Example Dialogues` 暂不继承为一等概念。
6. 不复刻 ST Group Chat 产品概念。
7. 不建立 `Actor` / `Participant` / `Speaker` / `CharacterProfile` 等过早硬编码类层级。
8. `Setting Layer` 是设定与可变状态的统一地基。
9. `Book` 概念弱化为 collection / folder / namespace，不作为核心语义。
10. `Preset` 属于 Concept Stack，但 backend canonical 倾向 `Composition Skeleton`。
11. `Author's Note` / 临时注入提示不作为独立 canonical concept。
12. ST / CityTalent / 旧角色卡导入兼容延后，不作为当前设计驱动力。

---

## 3. Next Discussion Focus

当前建议下一步优先讨论：

```text
Unified Setting Layer
```

入口文档：

```text
docs/08-concept-stack/setting-layer-v0.md
```

原因：

- Setting Layer 是 Card、Opening、Skeleton、State、Global Scope 的共同地基；
- 如果设定层没有定清楚，后续 Chat / Opening / Composition Skeleton 都会被迫补洞；
- 当前最重要的未决点包括嵌套结构、id / path 索引、KV 挂载、session 回滚、AI / 插件修改 API，以及如何避免过早硬编码类体系。

---

## 4. Decision Status

Current status: **Incomplete / Open Design**.

No implementation should treat the migrated candidate sketches as accepted API.

Before implementation, at minimum the project should accept or revise:

1. Concept Stack high-level boundary;
2. Card model M0;
3. Unified Setting Layer M0;
4. Chat / Opening model M0;
5. Composition Skeleton model M0;
6. Composition pipeline M0;
7. Runtime boundary.
