# 有序文件树与 Anchor / Slot 架构推演 (v0)

> **状态**：Open Design / Discussion Capture  
> **关联文档**：
> - [`prompt-builder-philosophy-v0.md`](prompt-builder-philosophy-v0.md) — 提示词分层哲学
> - [`composition-skeleton-and-preset-v0.md`](composition-skeleton-and-preset-v0.md) — 原始 Zone / Skeleton 方案
> - [`multi-party-contribution-walkthrough-v0.md`](multi-party-contribution-walkthrough-v0.md) — 多方贡献博弈推演

---

## 1. 背景与核心问题

在早期的 PromptBuild 设计中，系统引入了 `Zone -> InjectionGroup -> Slot -> Entry` 的多层间接映射，并试图通过 `ProjectionOrderProfile` 和 `RankKey`（分段字符串排序）来解决多方排序覆盖。

但在深入推演实际创作场景时，发现了几个根本性矛盾：

1. **预设包裹断裂问题（The Wrapping Conflict）**：
   预设作者经常需要实现类似“`文风(头)` -> `[角色卡文风]` -> `文风(尾)`”的物理包裹。若预设原生条目与外部注入条目混在同一个扁平 Zone 中竞争排序，系统无法在不侵入预设原生条目排序的前提下，保证外部条目永远夹在头尾之间。
2. **多方作者的“盲写”与内卷（Blind Authors & Tail Conflict）**：
   角色卡作者、插件作者彼此不可见，也无法预测用户会使用何种预设。若开放全局数字排序（如 ST 的 1~9999 depth），必然引发向尾部挤压的军备竞赛，破坏预设结构。
3. **概念冗余与双重账本**：
   系统同时存在“资源存储树（Source Tree）”与“投影区域树（Zone Tree）”，导致 UI、状态管理与编译逻辑存在两套并行的层级系统。

---

## 2. 核心架构：预设即有序文件树 (Ordered File Tree)

新模型的核心公理：**预设的本质就是一棵带有确定物理顺序的文件树。最终 Prompt 的输出顺序即该树的深度优先遍历（DFS）结果。**

### 2.1 节点类型职责划分（强类型 Node）

不使用包含多种布尔开关的 God-Node，在统一的节点树结构下严格区分节点形态：

```text
Preset 节点树 (Root)
 ├── 📁 Folder (文件夹)             --> 仅用于 UI 组织与折叠，无注入与文本语义
 │    ├── 📄 Entry (原生条目)         --> 预设作者手写的固定文本，位置由 order_index 决定
 │    └── ⚓️ Anchor (注入锚点)        --> 预设作者留出的注入孔位（如 @style.card）
 │         │
 │         ==== 运行时动态挂载 ====
 │         ├── 🕳️ Slot (来源块)       --> 运行时按外部 Source 自动生成的聚合包裹层
 │         │    ├── 📄 Injected Entry (外部条目 1, depth: 10)
 │         │    └── 📄 Injected Entry (外部条目 2, depth: 50)
 │         └── 🕳️ Slot (来源块)       --> 另一个外部 Source 的聚合包裹层
 │              └── 📄 Injected Entry (外部条目 3, depth: 100)
 └── 📄 Entry (原生条目)
```

| 节点类型 | 归属/生命周期 | 作用 | 排序依据 |
|---|---|---|---|
| **Folder** | 预设 / 持久化 | 纯分类与视觉折叠 | `order_index` |
| **Entry** | 预设 / 持久化 | 原生提示词文本 | `order_index` |
| **Anchor** | 预设 / 持久化 | 声明可被外部注入的语义插槽 | `order_index`（与原生 Entry 绝对平级） |
| **Slot** | 运行时 / 动态生成 | 聚合单一外部来源的所有贡献，标明出处 | 来源身份 / 外部配置 |
| **Injected Entry** | 外部资产 / 动态挂载 | 实际外部提示词条目 | `local_depth` (1~9999) |

---

## 3. 排序机制：分级嵌套排序 (The Caged Depth)

彻底废除全局数字竞争与复杂的 RankKey 覆盖层，采用分级嵌套排序：

1. **父层：预设作者独裁（骨架绝对排版权）**
   - 预设作者通过拖拽调整 `Folder`、`Entry` 和 `Anchor` 的 `order_index`。
   - 预设作者拥有绝对权力决定“哪个原生条目在哪个 Anchor 上方或下方”。
2. **子层：笼中深度（Caged Depth 1~9999）**
   - 外部条目（世界书、角色卡、插件）只能声明自己注入到哪个 `Anchor`，并在该 Anchor 内部声明一个局部深度（`local_depth: 1~9999`）。
   - 外部条目无论将深度写为 9999 还是 999999，其影响力均被牢牢封印在目标 Anchor 内部，绝不可能越界将 Anchor 之外的原生条目（如 `文风(尾)`）推下。
3. **来源块隔离（防碎片化）**
   - 同一外部资产（如某本世界书）注入进来的多个条目，默认在 Anchor 下聚合为一个 `Slot` 节点，保持来源完整性与可解释性。

---

## 4. 方案多维度对比评估

| 评估维度 | 原始模型 (Zone + Group + RankKey) | 新模型 (Ordered File Tree + Anchor/Slot) | 收益分析 |
|---|---|---|---|
| **复用性 (Reusability)** | 需要维护 Zone 拓扑、Group 映射表、RankKey 配置文件等平行数据结构。 | 直接复用现有 `prompt_resource_nodes` 表、树状操作库（`tree-ops`）与通用 Tree UI 组件。 | **极高**。前后端全部复用通用树结构，无需维护专属投影数据模型。 |
| **统一性 (Consistency)** | 资源存储是树，提示词编译是拓扑网，心智模型割裂。 | 预设即树，挂载即子树合并，编译即 DFS 遍历，概念统一。 | **极高**。彻底消灭“资源视图”与“投影视图”的抽象断层。 |
| **代码量与复杂度 (Simplicity)** | 需实现字符串分段比对器、冲突仲裁器、Zone-Anchor 映射 Pass。 | 仅需一次 DFS 遍历 + 局部数组的 `sort((a, b) => a.depth - b.depth)`。 | **大幅削减**。预计减少约 40% 的相关领域逻辑代码。 |
| **执行性能 (Performance)** | 复杂的矩阵解算与多轮 Pass 重排。 | 纯线性树遍历，时间复杂度 $O(N \log N)$（仅在各 Anchor 内部做微型排序），无状态且易于缓存。 | **显著提升**。降低每次 Prompt 构建时的 CPU 与内存分配开销。 |
| **作者体验 (Author DX)** | 作者需理解 Zone、Band、Group、RankKey 等抽象概念。 | 预设作者只需“建文件夹、留洞”；外部作者只需“选洞、填数字(1~9999)”。 | **门槛归零**。完全符合传统 ST/创作社区已有直觉。 |

---

## 5. 改造成本与实施路径估算

将当前项目演进至该模型，属于**收窄边界与清理冗余**性质的重构，整体风险可控。

### 5.1 数据库与 Schema 层（成本：低）
- 复用 `prompt_resource_nodes`，确认 `kind` 枚举支持明确的语义节点（或沿用 `virtual` 并由 meta 承载 `anchor_alias`）。
- `global_setting_mounts` / `preset_tool_mounts`：保留 `target_anchor`，将 `content_order_hint` 明确为 `local_depth`，废弃 `content_rank_key`。
- **预估工作量**：0.5 ~ 1 个工作日。

### 5.2 Application Runtime 编译逻辑（成本：中低）
- 重写 `prompt-runtime` 中的 Projection 编译逻辑：
  1. 读取 Preset 树结构；
  2. 查询已启用的 Mounts，按目标 Anchor 分组并构建临时的 Slot 节点；
  3. 执行单次 DFS 遍历，遇到 Entry 输出文本，遇到 Anchor 展开其内部按 `local_depth` 排序的条目并输出文本；
  4. 生成 Trace 事件。
- **预估工作量**：1 ~ 2 个工作日。

### 5.3 Studio Client UI 适配（成本：中）
- 将 Context Asset Workbench 中的 `projection-runlist` 调整为树状联动视图：
  - 顶层直接展示 Preset 的 Folder / Entry / Anchor 树结构；
  - 允许点击 Anchor 节点展开，直观查看内部挂载的 Slot 及子条目；
  - 提供简单的 Depth 调节控件。
- **预估工作量**：2 ~ 3 个工作日。

---

## 6. 总结与后续建议

“预设即有序文件树 + 笼中深度”模型在大幅降低架构复杂度的同时，完美守住了**预设作者的绝对排版权**与**外部组件的可预测注入**。

该设计目前保留在 Discussion 阶段。后续若准备实施，可作为 `prompt-resource-projection-workbench` 重构的具体依据，在开启 SDK/CLI 开发前作为 PromptBuild 最终收束切片完成。
