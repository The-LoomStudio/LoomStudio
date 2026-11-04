# PromptBuild Architecture

PromptBuild 是 Studio Application 中负责把领域数据投影为模型输入的编译能力。

设定领域统一使用 **Lore**：资源分类和 Prompt 来源分类均为 `lore`，采用关系为 `LoreMount`，角色默认采用开关为 `useCardLore`。应用偏好与扩展配置的 Settings 不属于此概念。Card 内联 `lore.entries` 保留独立存储与文件交换；当前 Agent 主链采用的是 Card `promptResourceIds` 指向的资源及 Preset 显式挂载，不会自动消费这个内联数组。

内容接入分为 **Anchor / Slot 的独立贡献注入** 和 **宏的正文内联展开**。前者保留贡献的编排身份，后者将值展开到宿主正文。Agent 主动读取属于 Tool / Runtime 的上下文获取流程，不是第三种注入语法；详细边界见 [注入与内联展开](injection-and-inline-expansion.md)。

当前稳定边界：

```text
领域 Stores / Runtime Sources
  -> PromptBuild source preparation
  -> Composition data model
  -> 可选的 prepare / 有序 render 加工
  -> Application DFS 编排与消息生成
  -> Compiled Prompt / Provider Messages
```

PromptBuild 拥有 Card、Lore、Narrative Timeline、Ordered Tree、Anchor、Slot、Activation 和 Caged Depth 等领域语义。原型 Core 已退役，领域编译由 Application 直接实现。

当前 Agent Turn 将 Preset 有序树、该预设显式采用的 Lore、可选的当前角色 Lore、Agent Session History 和当前输入准备为 SourceNode / PromptContribution，再通过 Application 加工与 DFS 编排生成消息。全局 Lore Mount 注册不代表默认写入所有 Agent。Runtime 默认使用 `@chat.narrative`、`@chat.session`、`@chat.input` 等 Anchor。Trace 仍使用兼容的 `core-compact-1` 版本，但已注册的作者正文处理器会留下真实 prepare/render 执行记录。未使用处理器的构建不产生这些记录。

## 作者正文加工

扩展通过 `ctx.prompt.registerProcessor()` 注册包命名空间下的处理器（例如 `sillytavern.importer/ejs`），需声明 `prompt.process`。Preset / Lore Entry 用 `capabilities.processorId` 显式采用；安装扩展不会自动执行任意文本。Host 跟踪注销、取消和 Card 安装作用域；只有声明 `state.read` 的模块才收到当前 Timeline / Branch 的 State 快照。注册代码仍属于可信扩展代码，这个接口本身不是作者脚本沙箱。

每次构建创建独立会话。`prepare` 接收该处理器的候选条目，只能返回这些条目的正文和本轮激活修改；`render` 按 DFS / Anchor 深度确定的发送顺序，对实际使用的条目执行一次。持久 `enabled: false` 不可被激活补丁复活。带处理器的正文在语言处理后才展开普通宏，加工结果同步用于消息和工具上下文；原始资源不改写。Native Session 消息、Tool Result 和运行时贡献不能注册为作者正文。处理器缺失或失败时不把原始模板静默发给模型：取消、权限等阻断类错误直接失败；必要 Preset 的处理失败阻断构建。仅含可选 Lore 的准备失败会跳过该组，Lore 单条渲染失败则跳过该条，并记录 `prompt.processor_entry_skipped` 警告；共享同一处理器的准备组若包含 Preset，仍按必要依赖失败。

Agent Preview、新 Run 和 `ctx.prompt.build` 均接入该流程。独立扩展构建是无 Timeline State 的 preview 上下文，不隐式读取“当前聊天”；需要 State 的处理器应明确拒绝无上下文调用。工具后续 Step 不重建模板。处理过的来源与投影随 Run checkpoint 保存，热/冷 Resume 都复用已接受消息与加工快照，不重新运行处理器。语言引擎属于扩展，平台不理解 EJS/MVU 标签。

完整无工具助手回复另经 `ctx.state.registerContentHandler` 的采用/作用域过滤；它不是 Prompt pass，也不处理推理、工具参数或工具结果。处理器只计算已声明 JSON Pointer 子树的替换值，由 Runtime 使用当前 Revision CAS 提交；需要 `state.processContent`、`state.read` 和 `state.write`。长度/暂停续写先合并。已接受操作写入 `content` checkpoint 后才提交 State，恢复按原幂等键重试同一操作，不重新调用模型或处理器。该提交不要求新增 Narrative Node，也不代表整组 Node/State/Transcript 跨模块事务。

Lore Entry 的 `enabled` 是持久化作者配置，Activation 则在每次 PromptBuild 中重新求值；inactive Entry 不进入本轮 Provider Message，但仍可进入解释视图与受控 Agent Context Scope。`read_context` 可以把 Scope 中一个条目作为非持久化 Fresh Context Mount 返回：Runtime 只在下一次 Provider Step 追加该内容，调用后自动卸载，不写入 `global_lore_mounts`、Agent Session 或 Prompt Resource。Settled Mount、TTL、token budget、pin/release 与跨 Step 长期保留尚未实现。

Agent Tool 使用两条构建表面：Provider-managed Tool 与 `messages[]` 平级进入 Provider Payload；Content Tool Description 作为外部 Runtime Source 进入 PromptBuild Anchor / Slot。Tool 的正式接缝见 [`../agent/provider-and-prompt-build.md`](../agent/provider-and-prompt-build.md)。

Narrative 正文投影本身不携带 Provider role。主故事 Session 将仍需保留的正文与工作记录按原始顺序合并，通过 `@chat.session` 原生消息序列消费。独立辅助 Session 可把采样正文作为一份长文本贡献到 `@chat.narrative`，由外层 MessageBlock 决定 system/user/assistant role；剧情总结独立贡献到 `@memory.narrative`。作者 developer 读取为 system，不修改历史执行记录。

`@chat.session` 仍沿用 virtual 节点和 targetAnchorId 保存，但 Shared 输出声明将它标记为消息序列。它只能位于 Message 之外，不能包含子节点或接收文本贡献；其他 Anchor 接收文本。旧已保存预设的历史包裹仍保留原生编译语义，新增/移动/导入禁止这种嵌套。

新建预设采用包内 JSON Default 骨架。无显式目标的 Preset Entry 在树中原位输出，已有显式目标的 Entry 仍按锚点注入；Agent Turn 只遍历所选 Preset 的骨架，不直接输出外部资源树。Session 文本消息保留原有角色与独立边界，不继承包裹块的角色。完整顺序、已接线来源与预留位置见 [Default 预设骨架](default-preset.md)。

## 资源归属与使用配置

资源定义、分发归属和消费配置分别保存。角色与扩展可携带资源，用户也可创建独立资源；Agent Preset 是消费这些资源的配置，不是新的包类型、资源 Owner 或 State 作用域。Preset 可选的 `metadata.icon` 是包内图标引用（package ID、相对路径及可选的全局/Card 安装目标），随 Prompt Resource Artifact 保存，不把图像字节复制进资源；实际展示仍依赖对应安装及文件。扩展可以无代码，仅携带声明式资源；切换 Session 不自动停用扩展或创建预设专属脚本进程。

| 配置 | 保存位置 | 消费语义 |
|---|---|---|
| 显式采用 Lore | `LoreMount`，来源 `{ kind: 'preset', id }` | 本预设采用有序资源引用；来源表示消费者，不表示 Lore 属于该预设 |
| 默认角色 Lore | Preset metadata 的 `useCardLore` | 缺省为 `true`，读取运行 Timeline 来源角色的当前 `promptResourceIds`；`false` 只取消默认采用，不取消显式引用 |
| 正则与提取器 | Preset metadata 的 `textUses` | 按 `kind + id` 保存启用与可选顺序覆盖；定义与归属不变，显式配置优先于公共默认，见[文本管线](../history-text-pipeline.md) |
| 工具 | `preset_tool_mounts` | 保存工具引用、默认启用、Activation 与投影配置；定义和执行器仍分离 |

同一 Lore 经角色默认关系和预设显式关系选入时按资源 ID 去重。采用只决定候选输入；Entry 的 `enabled`、Activation、关键词和目标 Anchor 仍由本轮构建判断，不因目录显示高亮而跳过。

包内引用使用 contribution identity，在导入时映射到本地资源 ID；外部引用保留 identity / provenance，不按名称替代。不可用的可选 Lore、Rule 或 Extractor 保留引用并产生诊断，不自动改绑；必要 Preset / Model 缺失仍拒绝执行。

单资源 `loom.promptResource` 导出保留树、作者宏、可选图标引用及已实现的使用配置引用，不递归携带被引用的资源、图标文件、脚本或规则定义。扩展 ZIP 只分发实际文件与贡献清单，不将数据库编辑自动回写为包文件。引用不等于归属，移动或复制资源进入包必须是另一次显式操作。

## 作者树顺序与运行时贡献排序

PromptBuild 注入的不是失去来源信息的字符串，而是携带结构化节点与出处元数据的提示词节点。早期设计尝试使用 `Zone -> InjectionGroup -> RankKey` 多层间接矩阵投影，但导致了预设包裹断裂（Wrapping Conflict）以及作者之间盲目挤压深度的军备竞赛。

现行架构以有序文件树作为作者排序权威；作者节点不再持久化或编辑 `localDepth`，旧值在数据迁移与导入／写入时清除：

```text
External Source
  -> PromptContribution(content + sourceRef + capabilities)
  -> 目标 Anchor 语义孔位挂载与 Slot 聚合
  -> 作者贡献保留资源采用顺序及树 DFS 次序；运行时派生局部顺序
  -> 树结构单次线性 DFS 遍历
  -> Provider Message
```

### 核心职责划分：

- **Preset 作者独裁物理顺序**：预设是一棵有序树，原生条目（`Entry`）、文件夹（`Folder`）与注入孔位（`Anchor`）平级存在，物理排版由树同级兄弟节点的 `order_index` 绝对锁定；
- **Anchor（注入锚点）**：预设作者留出的语义插槽（如 `@style.card`），在树上拥有固定物理排版，实现对外部内容的精准包裹；
- **来源顺序**：每本 Lore 按树 DFS 收集，针对每个目标 Anchor 保留相对次序；多本资源沿既有采用顺序收集，不能每本重置编号再交错。内部贡献的 `localDepth` 是构建时派生值，不回写作者节点。工具、扩展 SDK、记忆与历史等运行时贡献仍保留各自的深度合同，不因作者排序调整而删除公共字段；
- **单次 DFS 遍历编译**：消除复杂的矩阵解算，编译时按预设树顺序做一次深度优先遍历，线性产出最终有序的 Prompt Fragment。

世界书根目录的 Context Menu 提供“按锚点查看”只读投影：组内按文件树顺序，组间按本书首次出现顺序，仅用于导航；显示条件候选与继承禁用状态，不宣称当前已激活，也不推测预设中的位置。实际位置仍由采用该书的预设树决定。

同一变量值中出现的 Macro 标记不构成新的结构化注入。需要独立来源、激活或排序的状态栏等内容，应产出 Prompt Contribution；只需嵌入宿主正文的一段字符串可以使用宏，不按文本长短划分。宏不会递归生成节点。

## 当前与历史文档

- [`injection-and-inline-expansion.md`](injection-and-inline-expansion.md) — Anchor / Slot 与宏的消费边界，以及 Agent 主动读取的领域交界；
- [退役 Core 概览](../../../archive/loom-project/retired-core-2026-10-25/README.md) — 已退役原型：Loom Core 定位、设计原则、非目标与 public surface；
- [退役 Core 执行模型](../../../archive/loom-project/retired-core-2026-10-25/execution-model.md) — 已退役原型：Fragment、Pass、Registry、错误和 Owner Tracking；
- [退役 Core Trace 与 Replay](../../../archive/loom-project/retired-core-2026-10-25/trace-and-replay.md) — 已退役原型：Mutation、Trace v1、Diagnostic、Replay 与 DevTool 边界；
- [退役 Core 集成边界](../../../archive/loom-project/retired-core-2026-10-25/studio-integration.md) — 已退役原型集成：PromptBuild、Loom Runner、Kernel 与 Provider 集成边界。

Structure / Source / Capability、Skeleton、Activation 和动态投影等历史设计保留于 [`讨论归档`](../../../archive/discussion/application/prompt/README.md)，当前演进由 [Plan](../../../workbench/plans/README.md) 承接。只有已经与实现一致的部分才会逐项晋升。
