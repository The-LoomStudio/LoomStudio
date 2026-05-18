# Official Concept Stack 文档区

> **Status**: Planning / Open Design  
> **Purpose**: 收纳 Official Concept Stack 的长期设计材料，避免所有讨论都堆进单个 ADR。  
> **Related ADR**: [`../adr/ADR-005-official-concept-stack-open-design.md`](../adr/ADR-005-official-concept-stack-open-design.md)

---

## 1. 定位

本目录用于承载 Official Concept Stack 的分层设计文档。

ADR-005 仍是当前主讨论入口，但它不应无限增长。随着各议题稳定，应逐步拆出本目录下的专题文档。

当前原则：

```text
ADR-005:
  记录开放问题、阶段性决策、讨论顺序。

08-concept-stack/:
  承载逐步稳定下来的专题规格、设计笔记和大议题草案。
```

---

## 2. 当前已定方向摘要

以下方向来自 ADR-005 当前讨论，仍处于 Open Design，但已作为后续讨论默认前提：

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

## 3. 文档分类

### 3.1 总览与原则

| 文件 | 状态 | 目的 |
|---|---|---|
| [`concept-stack-overview-v0.md`](concept-stack-overview-v0.md) | Migrated / Open Design | Official Concept Stack 总览、原则、边界 |
| `concept-stack-glossary-v0.md` | Planned | Card、Opening、Setting、Skeleton 等术语表 |
| [`discussion-order-v0.md`](discussion-order-v0.md) | Migrated / Open Design | 讨论顺序、未定事项、实施前置条件 |

### 3.2 Card 与内容单元

| 文件 | 状态 | 目的 |
|---|---|---|
| [`card-model-v0.md`](card-model-v0.md) | Migrated / Open Design | Card 作为顶层内容单元的模型 |
| `card-packaging-v0.md` | Planned | Card 分发、资源引用、readme / metadata 边界 |

### 3.3 设定层与状态

| 文件 | 状态 | 目的 |
|---|---|---|
| [`setting-layer-v0.md`](setting-layer-v0.md) | Migrated / Open Design | 统一设定层、嵌套结构、索引、投影规则 |
| [`global-scope-v0.md`](global-scope-v0.md) | Migrated / Open Design | 全局 user 设定、全局设定库、跨 Card scope |
| [`state-mutation-api-v0.md`](state-mutation-api-v0.md) | Migrated / Open Design | KV、AI 更新、插件修改、回滚边界 |

### 3.4 Chat 与 Opening

| 文件 | 状态 | 目的 |
|---|---|---|
| [`chat-opening-model-v0.md`](chat-opening-model-v0.md) | Migrated / Open Design | Chat / Opening / compiled message 的语义边界 |
| `session-model-v0.md` | Planned | Session、timeline、branch、运行实例边界 |

### 3.5 Composition Skeleton

| 文件 | 状态 | 目的 |
|---|---|---|
| [`composition-skeleton-v0.md`](composition-skeleton-v0.md) | Migrated / Open Design | Skeleton、slot、cluster、排序、输出结构 |
| [`composition-pipeline-v0.md`](composition-pipeline-v0.md) | Migrated / Open Design | Documents -> Fragments -> loom.run -> compiled payload |
| [`trace-explainability-v0.md`](trace-explainability-v0.md) | Migrated / Open Design | 来源、激活、排序、裁剪的解释模型 |

### 3.6 Runtime / Provider 边界

| 文件 | 状态 | 目的 |
|---|---|---|
| [`runtime-boundary-v0.md`](runtime-boundary-v0.md) | Migrated / Open Design | Concept Stack 与 Chat Runtime / Provider / Security 边界 |

### 3.7 Frontend Projection

| 文件 | 状态 | 目的 |
|---|---|---|
| [`frontend-projection-v0.md`](frontend-projection-v0.md) | Migrated / Open Design | 前端投影、编辑器、预览与 RPC 表面候选 |

### 3.8 Deferred / 兼容层

| 文件 | 状态 | 目的 |
|---|---|---|
| [`compatibility-import-v0.md`](compatibility-import-v0.md) | Migrated / Deferred | ST / CityTalent / 旧角色卡导入兼容 |
| `transform-script-extension-v0.md` | Deferred | Regex、Card Script、扩展绑定、transform rules |

---

## 4. 建议讨论顺序

当前建议顺序：

```text
1. CS-0 / Card 与顶层边界
2. Unified Setting Layer
3. Chat / Opening
4. Composition Skeleton
5. Composition Pipeline
6. Runtime Boundary
7. Trace / Explainability
8. Global Scope
9. State / Mutation API
10. Frontend Projection
11. Compatibility / Import
```

其中第 2 步 `Unified Setting Layer` 是当前最关键的大议题。

---

## 5. 写作规则

1. 本目录文档优先使用中文。
2. 不在专题文档中把候选 TypeScript 草案伪装成 accepted API。
3. 不为了兼容 ST 旧字段而扭曲 canonical model。
4. 不引入过早硬编码类层级。
5. 每个专题文档应明确：
   - 已定方向；
   - 未定问题；
   - 非目标；
   - 与 Kernel / Runtime / Provider / Security 的边界。
