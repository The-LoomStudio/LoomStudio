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

当前 Agent Turn 将 Preset 有序树、该预设显式采用的 Settings、可选的当前角色 Settings、Agent Session History 和当前输入准备为 SourceNode / PromptContribution，再直接调用 Application 的 `compilePromptDataModel()`。全局 Setting Mount 注册不代表默认写入所有 Agent。Runtime 默认使用 `@chat.narrative`、`@chat.session`、`@chat.input` 等 Anchor。该路径没有执行 Core 的 `materialize -> order -> emit` Pass，返回的 `core-compact-1` Trace 也只有最小摘要，`executions` 为空。实际调用与设计边界见 [Studio 集成](loom-core/studio-integration.md)。

Setting Entry 的 `enabled` 是持久化作者配置，Activation 则在每次 PromptBuild 中重新求值；inactive Entry 不进入本轮 Provider Message，但仍可进入解释视图与受控 Agent Context Scope。`read_context` 可以把 Scope 中一个条目作为非持久化 Fresh Context Mount 返回：Runtime 只在下一次 Provider Step 追加该内容，调用后自动卸载，不写入 `global_setting_mounts`、Agent Session 或 Prompt Resource。Settled Mount、TTL、token budget、pin/release 与跨 Step 长期保留尚未实现。

Agent Tool 使用两条构建表面：Provider-managed Tool 与 `messages[]` 平级进入 Provider Payload；Content Tool Description 作为外部 Runtime Source 进入 PromptBuild Anchor / Slot。Tool 的正式接缝见 [`../agent/provider-and-prompt-build.md`](../agent/provider-and-prompt-build.md)。

Narrative History 本身不携带 Provider role。它是可被 Preset MessageBlock 挂载的运行时 Context Slot；官方骨架默认将它包在 Developer Block 中，但 Preset 可以把该 Slot 放入任意 MessageBlock，由包裹它的 Block 决定最终的 `system`、`developer`、`user` 或 `assistant` role。

新建预设采用包内 JSON Default 骨架。无显式目标的 Preset Entry 在树中原位输出，已有显式目标的 Entry 仍按锚点注入；Agent Turn 只遍历所选 Preset 的骨架，不直接输出外部资源树。Session 文本消息保留原有角色与独立边界，不继承包裹块的角色。完整顺序、已接线来源与预留位置见 [Default 预设骨架](default-preset.md)。

## 资源归属与使用配置

资源定义、分发归属和消费配置分别保存。角色与扩展可携带资源，用户也可创建独立资源；Agent Preset 是消费这些资源的配置，不是新的包类型、资源 Owner 或 State 作用域。扩展可以无代码，仅携带声明式资源；切换 Session 不自动停用扩展或创建预设专属脚本进程。

| 配置 | 保存位置 | 消费语义 |
|---|---|---|
| 显式采用 Settings | `SettingMount`，来源 `{ kind: 'preset', id }` | 本预设采用有序资源引用；来源表示消费者，不表示 Settings 属于该预设 |
| 默认角色 Settings | Preset metadata 的 `useCardSettings` | 缺省为 `true`，读取运行 Timeline 来源角色的当前 `promptResourceIds`；`false` 只取消默认采用，不取消显式引用 |
| 正则与提取器 | Preset metadata 的 `textUses` | 按 `kind + id` 保存启用与可选顺序覆盖；定义与归属不变，显式配置优先于公共默认，见[文本管线](../history-text-pipeline.md) |
| 工具 | `preset_tool_mounts` | 保存工具引用、默认启用、Activation 与投影配置；定义和执行器仍分离 |

同一 Settings 经角色默认关系和预设显式关系选入时按资源 ID 去重。采用只决定候选输入；Entry 的 `enabled`、Activation、关键词和目标 Anchor 仍由本轮构建判断，不因目录显示高亮而跳过。

包内引用使用 contribution identity，在导入时映射到本地资源 ID；外部引用保留 identity / provenance，不按名称替代。不可用的可选 Settings、Rule 或 Extractor 保留引用并产生诊断，不自动改绑；必要 Preset / Model 缺失仍拒绝执行。

单资源 `loom.promptResource` 导出保留树、作者宏及已实现的使用配置引用，不递归携带被引用的资源、脚本或规则定义。扩展 ZIP 只分发实际文件与贡献清单，不将数据库编辑自动回写为包文件。引用不等于归属，移动或复制资源进入包必须是另一次显式操作。

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
