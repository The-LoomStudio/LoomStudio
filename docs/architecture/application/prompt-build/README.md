# PromptBuild Architecture

PromptBuild 是 Studio Application 中负责把领域数据投影为模型输入的编译能力。

内容接入分为 **Anchor / Slot 的独立贡献注入** 和 **宏的正文内联展开**。前者保留贡献的编排身份，后者将值展开到宿主正文。Agent 主动读取属于 Tool / Runtime 的上下文获取流程，不是第三种注入语法；详细边界见 [注入与内联展开](injection-and-inline-expansion.md)。

当前稳定边界：

```text
领域 Stores / Runtime Sources
  -> PromptBuild source preparation
  -> Composition data model
  -> Application DFS 编译器
  -> Compiled Prompt / Provider Messages
```

PromptBuild 拥有 Card、Setting Layer、Narrative Timeline、Ordered Tree、Anchor、Slot、Activation 和 Caged Depth 等领域语义。Loom Core 只执行 Fragment pipeline，不理解这些字段。

当前 Agent Turn 将 Preset 有序树、全局 Setting Mount、可选 Narrative Timeline Setting、Agent Session History 和当前输入准备为 SourceNode / PromptContribution，再直接调用 Application 的 `compilePromptDataModel()`。Runtime 默认使用 `@chat.narrative`、`@chat.session`、`@chat.input` 等 Anchor。该路径没有执行 Core 的 `materialize -> order -> emit` Pass，返回的 `core-compact-1` Trace 也只有最小摘要，`executions` 为空。实际调用与设计边界见 [Studio 集成](loom-core/studio-integration.md)。

Setting Entry 的 `enabled` 是持久化作者配置，Activation 则在每次 PromptBuild 中重新求值；inactive Entry 不进入本轮 Provider Message，但仍可进入解释视图与受控 Agent Context Scope。`read_context` 可以把 Scope 中一个条目作为非持久化 Fresh Context Mount 返回：Runtime 只在下一次 Provider Step 追加该内容，调用后自动卸载，不写入 `global_setting_mounts`、Agent Session 或 Prompt Resource。Settled Mount、TTL、token budget、pin/release 与跨 Step 长期保留尚未实现。

Agent Tool 使用两条构建表面：Provider-managed Tool 与 `messages[]` 平级进入 Provider Payload；Content Tool Description 作为外部 Runtime Source 进入 PromptBuild Anchor / Slot。Tool 的正式接缝见 [`../agent/provider-and-prompt-build.md`](../agent/provider-and-prompt-build.md)。

Narrative History 本身不携带 Provider role。它是可被 Preset MessageBlock 挂载的运行时 Context Slot；官方骨架默认将它包在 Developer Block 中，但 Preset 可以把该 Slot 放入任意 MessageBlock，由包裹它的 Block 决定最终的 `system`、`developer`、`user` 或 `assistant` role。

## 为什么采用“有序文件树 + 笼中深度”架构

PromptBuild 注入的不是失去来源信息的字符串，而是携带结构化节点与出处元数据的提示词节点。早期设计尝试使用 `Zone -> InjectionGroup -> RankKey` 多层间接矩阵投影，但导致了预设包裹断裂（Wrapping Conflict）以及作者之间盲目挤压深度的军备竞赛。

现行架构全面采用**“预设即有序文件树 + 笼中深度（Ordered File Tree & Caged Slot）”**：

```text
External Source
  -> PromptContribution(content + sourceRef + capabilities)
  -> 目标 Anchor 语义孔位挂载与 Slot 聚合
  -> 按 Anchor 内的 localDepth 排序
  -> 树结构单次线性 DFS 遍历
  -> Provider Message
```

### 核心职责划分：

- **Preset 作者独裁物理顺序**：预设是一棵有序树，原生条目（`Entry`）、文件夹（`Folder`）与注入孔位（`Anchor`）平级存在，物理排版由树同级兄弟节点的 `order_index` 绝对锁定；
- **Anchor（注入锚点）**：预设作者留出的语义插槽（如 `@style.card`），在树上拥有固定物理排版，实现对外部内容的精准包裹；
- **Slot（来源块）与笼中深度（Caged Depth）**：外部来源按目标 Anchor 聚合，并通过 `localDepth` 局部排序。当前 Runtime 输入包含 0 等数值，不把早期 `1~9999` 范围作为正式校验合同；排序不改变预设树本身，缺失标准锚点时由编译器处理约定的 fallback；
- **单次 DFS 遍历编译**：消除复杂的矩阵解算，编译时按预设树顺序做一次深度优先遍历，线性产出最终有序的 Prompt Fragment。

同一变量值中出现的 Macro 标记不构成新的结构化注入。需要独立来源、激活或排序的状态栏等内容，应产出 Prompt Contribution；只需嵌入宿主正文的一段字符串可以使用宏，不按文本长短划分。宏不会递归生成节点。

## 正式文档

- [`injection-and-inline-expansion.md`](injection-and-inline-expansion.md) — Anchor / Slot 与宏的消费边界，以及 Agent 主动读取的领域交界；
- [`loom-core/README.md`](loom-core/README.md) — Loom Core 定位、设计原则、非目标与 public surface；
- [`loom-core/execution-model.md`](loom-core/execution-model.md) — Fragment、Pass、Registry、错误和 Owner Tracking；
- [`loom-core/trace-and-replay.md`](loom-core/trace-and-replay.md) — Mutation、Trace v1、Diagnostic、Replay 与 DevTool 边界；
- [`loom-core/studio-integration.md`](loom-core/studio-integration.md) — PromptBuild、Loom Runner、Kernel 与 Provider 集成边界。

Structure / Source / Capability、Skeleton、Activation 和动态投影等仍在演进的设计保留于 [`../../../workbench/discussion/application/prompt/`](../../../workbench/discussion/application/prompt/)。只有已经与实现一致的部分才会逐项晋升。
