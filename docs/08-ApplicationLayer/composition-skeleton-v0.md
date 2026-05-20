# Composition Skeleton v0

> **状态**：从 ADR-005 迁移 / 开放设计  
> **来源**：[`../adr/ADR-005-official-concept-stack-open-design.md`](../adr/ADR-005-official-concept-stack-open-design.md)

---

## 来自 CS-0 的 Skeleton 方向

#### 6.1.10 Preset 属于 Application composition layer，但 canonical 名称倾向 Composition Skeleton

预设层属于 Studio Application 的 composition layer。

SillyTavern 调研表明，Preset / Prompt Manager 本质上是：

```text
一套预先声明的 prompt / message 填空骨架。
```

填空内容来自不同聚类，例如设定层、Opening、Chat、运行时输入、扩展产物等。

因此，backend canonical model 不应优先叫 `Preset`，而应继续讨论：

```text
Composition Skeleton
```

`Preset` 可以保留为用户 / UI 术语。

Skeleton 还需要讨论：

- 是否建立二级 / 三级 cluster；
- 如何声明 slot；
- 如何开放创建 cluster 的能力；
- 如何解决 ST 缺少声明式注入导致 message[] 级注入困难的问题；
- 如何排序、合并、输出为 compiled payload。

#### 6.1.11 Author's Note / 临时注入提示不作为独立需求

当前不把以下 ST 风格概念作为独立建模需求：

```text
Author's Note
临时注入提示
```

它们目前视为由 Setting Layer、Opening 或 Composition Skeleton slot 能力覆盖的派生用法，不单独作为 canonical concept。

---

## CS-2：Composition Skeleton / Preset 模型

### 8.1 问题

Preset 不能只是“一组字符串按 UI 顺序拼接”。

当前方向：`Preset` 可以作为 UI / 用户术语保留，但 backend canonical model 更倾向 `Composition Skeleton`。

Studio Application 需要一个新的 Skeleton / slot / cluster model，用于表达：

- slot / cluster；
- 二级 / 三级排序；
- 内容来源聚类；
- 优先级；
- 条件启用；
- 冲突组；
- 继承 / patch / override；
- trace 可解释排序。

### 8.2 开放问题

- `Preset` 是 entry collection、composition profile，还是 pipeline config？
- backend canonical 是否正式命名为 `CompositionSkeleton`？
- 是否需要保留 `InstructionEntry`，还是先统一到 Setting Layer / Skeleton slot source？
- 是否允许结构化内容而不只是字符串？
- 是否支持变量 / macro？
- 是否支持继承？
- 用户临时编辑 preset entry 时，是 fork、patch，还是直接覆盖？
- Preset 是否绑定模型或 provider？
- Preset 与 session 的关系是什么？
- 如何开放创建 slot / cluster 的能力？
- slot / cluster 是否需要 namespace？
- 如何解决 ST 缺少声明式注入导致 message[] 级注入困难的问题？

### 8.3 候选草案

```ts
type InstructionEntry = {
  id: string
  title: string
  enabled: boolean
  content: string
  intent:
    | 'behavior'
    | 'style'
    | 'format'
    | 'safety'
    | 'world'
    | 'character'
    | 'memory'
    | 'developer-note'
  target:
    | 'model'
    | 'narrator'
    | 'character'
    | 'user'
    | 'tool'
    | 'runtime'
  placement: PlacementRule
  priority: number
  conflictPolicy?: ConflictPolicy
  tags?: string[]
}

type Preset = {
  id: string
  name: string
  entryIds: string[]
  defaultPipelineId?: string
  modelHints?: Record<string, unknown>
}
```

这个草案早于上文 CS-0 的边界收束，尚未被接受。后续讨论在 Skeleton 与 Setting Layer 边界稳定前，应避免过度建模 `intent` / `target`。
