# Agent 上下文骨架、投影与 Session 生命周期计划

> **状态**：In Progress / 骨架已接线，生命周期未验收
> **主题**：Agent Prompt 的默认动态骨架、Narrative / Agent Session 记忆投影、被动上下文与实时工作区边界。
> **范围**：先收束跨 PromptBuild、Agent Runtime、Narrative Timeline 和记忆扩展的上下文合同，再拆分可实施切片。
> **当前阶段**：默认骨架、采样加工、Session 工具回放、可替换记忆接收、显式工作交接、配置宏持久化与主动读取范围约束已实施；官方来源安装 / 自动调度、动态上下文生命周期与读取授权 UI 仍未完成。完整记忆算法归独立 Plan，不是本 Plan 的归档前置。
> **更新**：2026-09-17，补充共用采样能力的调研与边界。本文是讨论承载稿，不因补写 Plan 自动启动代码实施；默认 Anchor、生命周期和记忆合同仍待逐项收束。
> **决策补充**：2026-09-20，确认 Anchor 负责独立注入，配置宏负责候选选择和局部文本替换；本轮不为 Anchor 增加通用替换机制。设置分工见 2.5～2.6；骨架仍为待讨论候选。
> **实施切片**：2026-09-21，用户授权默认 JSON 骨架及原生输入接线，见第 12 节；其他开放设计不随本切片自动实施。
> **生命周期验收**：2026-09-21，补充多轮仿真后确认两条目标合同仍失败，见第 13 节。第 12 节的接线完成不代表完整生命周期正确。
> **职责拆分**：2026-09-21，记忆策略移至[剧情记忆与统一刷新策略计划](./narrative-memory-and-refresh-policy-plan.md)。本 Plan 保留投影、Session 生命周期和统一刷新执行；后述“两种记忆”指内容职责，不再指两套独立自动总结触发器。保留原文件名以避免破坏已有链接。
> **投影责任修正**：2026-09-21，确认当前不为 Agent Session 保存 Narrative 投影快照；Memory 指针与消费者采样参数由 Memory / Sampling 侧管理，PromptBuild 只消费贡献。后续三个生命周期问题见第 15 节。
> **采样传参已确认**：采样参数与请求时机归消费者自己的生命周期，直接请求 Narrative 模块；Anchor 只接收结果并定位，不承载采样参数。具体分工和验收例见 6.6；本轮仅记录设计，不启动代码实施。
> **CodeAct 采样切片**：2026-09-22，已实现只读 Narrative 采样器与 CodeAct `readNarrative` 入口，支持固定分支的最近 N 个节点、节点区间、读取 Head、来源节点和预算续读信息。默认 Prompt 的有效 Head、Memory 贡献、正文加工和完整生命周期仍未完成。
> **共用正文加工**：2026-09-24，补齐 Runtime 无 Session 采样、CodeAct raw / prompt 视图和默认 Prompt 的共用采样 / 正则接线，修复续读与历史分页顺序。36 项定向测试及 Runtime build 通过，见第 16 节；默认有效 Head、Memory 和 Session 生命周期仍未完成。
> **Session 回放修复**：2026-09-24，Native / Content 工具批次及结果已跨交互、跨 SQLite 重开投影；最近 100 条窗口按需补齐最早批次。第 13 节两条预期失败中的工具回放已修复，Narrative 基线采用仍未修复。见第 17 节。
> **接收与交接补齐**：2026-09-24，记忆来源发布固定 Memory + Raw、Session 保存交接后通知采用；工作历史按交接边界读取，100 条只作分页。已配置来源的基线冻结目标转为正常通过，原 1～40 楼模型已有真实工具 / SQLite 仿真；自动调度与官方生产者仍非本次交付。见第 19 节。

## 1. 背景

Loom Studio 同时存在几种性质不同的上下文：

- Preset 作者规定的稳定 Agent 行为；
- Card / Setting 作者规定的被动注入内容；
- Narrative Timeline 中已经发生的剧情；
- Agent Session 中发生的工作过程；
- Agent 在当前 Run 中变化的 State、工具结果和工作区；
- Agent 主动读取后临时获得的上下文。

这些内容不能全部塞进一个 Session，也不能因为都最终进入 Prompt 就共享同一套生命周期。

本计划先回答：

1. 默认 Agent Prompt 的大骨架如何排序；
2. Narrative 记忆与 Agent Session 记忆如何分别投影；
3. 被动上下文在一次交互中何时计算、何时冻结；
4. 实时状态变化如何让 Agent 及时感知，而不改写既有 Prompt 历史；
5. 不同 Agent / Extension 如何请求不同的 Narrative 范围。

## 2. 已确认的边界

### 2.1 权威数据与 Prompt 投影分离

```text
Narrative Store / Agent Transcript / State Store
  -> Context Projection
  -> Preset Anchor / Slot
  -> Compiled Provider Payload
```

Prompt 中看到的内容是投影，不是新的权威数据。Narrative 写入应立即持久化，但不要求每次写入都把前方 Narrative 基线重编译。

### 2.2 Preset 仍是完整 Agent PromptBuild Module

不重新引入第二套 AgentPreset。Preset 负责稳定结构、Anchor、常驻提示、输出约束和 PromptBuild 相关能力；Agent Profile 只提供本地模型绑定和 Preset 选择。

### 2.3 Narrative 与 Agent Session 是两种连续性

```text
Narrative:
  作品世界线、正文、实体、事件和剧情事实。

Agent Session:
  Agent 的工作过程、用户指导、工具行动、观察、决定和待办。
```

Session 记忆不能替代 Narrative 记忆；Narrative 摘要也不应携带某个 Agent 的后台工作过程。

### 2.4 记忆系统先保留为扩展能力

记忆压缩不删除 Narrative 原节点；用户显式删除与数据生命周期另行处理。LV1 / LV2 / LV3 等摘要、实体、事件和关系投影由记忆扩展或官方记忆扩展定义，不在本计划中固定具体算法。

默认工作记忆采用 Agent 维护的记事板（Scratchpad），整理前完成交接、整理时携带已保存内容，不另建独立触发的 Session 总结任务；交接本身可以需要模型更新记事板。完整 Transcript 仍然保留为工作事实。剧情算法、次数阈值、缓冲策略及玩法配置归[独立记忆 Plan](./narrative-memory-and-refresh-policy-plan.md)。

当前不为 Agent Session 保存 Narrative 的摘要版本、`coveredThroughNodeId` 或 Raw 起点。主 Agent 默认消费由 Memory / Sampling 侧提供的“有效摘要 + 摘要之后的 Raw 缓冲”；其他消费者可以通过临时参数请求不同范围，例如最近 3 个节点。只有未来出现确实需要长期固定 Narrative 视图的消费者时，才另行设计消费者快照。

### 2.5 Anchor 与配置宏分工（已确认方向，待实施）

核心判断不是内容题材、长短或有几个来源，而是内容之间的关系：

> 配置选择用宏；多方汇集用 Anchor。

- 配置要求从候选中取一项或限定数量的若干项，选择结果共同构成本次配置值，使用宏。例如文风单选、推演策略选择。
- 多个贡献在本次都需要独立表达，不通过选择一个来覆盖其他贡献，使用 Anchor。例如多本世界书汇入 `Setting.stable`、多条运行提醒以及不同来源的记忆贡献。这里的名称只作示意，不新增正式 ID。
- 宏候选也可以来自多方，所以“有多个来源”本身不等于必须使用 Anchor；关键是先选出配置值，还是保留多份贡献一起编排。
- 配置中的受限多选与数量 / Token 预算不同。Anchor 为控制载荷而限制条目数，并不会因此变成宏。

- Anchor 接收独立 Contribution，保留来源、激活与局部排序；可以容纳许多 Setting，不负责关闭或替换预设的其他 Entry。
- 配置宏在宿主 Entry 中提供一个明确的取值位置。Preset 可提供默认值和候选，角色卡可提供同一配置项的作品候选，用户选择本次采用哪个值或来源。
- 字符串宏可以是长文风或长段推演说明。长度不是选择宏或 Anchor 的依据；需要独立编排身份时使用 Anchor，只需替换宿主中的文本时使用宏。
- 宏展开后跟随宿主 Entry 的位置、角色与生命周期，不生成新节点、不递归展开宏、不执行 ST 的 `setvar` 或任意脚本，不赋值到 State。
- 普通 State / 用户名等只读取值宏继续存在。本次明确的是配置文本的用法，不把所有宏都变成设置选项。

当前宏消费仍是标量展开。配置多选若需要组合多段文本，应先形成选定的配置值，再在宿主中展开；不据此宣布已支持数组宏或增加独立节点。候选组合的具体 UI、顺序和文本格式留待真实配置项收束。

提醒和记忆在编排上是汇集关系，不增加“选一个来源覆盖其他来源”的默认逻辑。记忆扩展更新自己的摘要版本、去重或确认覆盖范围属于来源生命周期，不等于 Anchor 覆盖，也不表示所有历史摘要版本必须同时注入。

示例仅说明作者合同，不是最终命名空间或 Schema：

```text
固定的写作要求
  文风：{{Setting.wenfeng_macro}}
固定的检查步骤
  剧情推进：{{cot.剧情推进}}
固定的收束步骤
```

正文引用一个逻辑配置项；五种文风是该项的五个候选，不是同时注入五个条目。角色卡提供“激进、危险”并经用户采用后，只替换剧情推进这一处取值，不替换整个推演流程。

此前讨论和样本研究中的“可替换 Anchor / 整组 Entry 自动关闭”提案由本节取代。本轮不建立锚点替换引擎，也不通过脚本改写共享预设的持久开关。

### 2.6 设置与职责

这里区分 Setting 内容资源和设置面板：前者保存作者内容，后者选择当前使用哪份配置文本。存储位置不自动决定覆盖优先级。

| 责任方 | 负责的内容 | 不负责的内容 |
| --- | --- | --- |
| Preset 作者 | 树顺序、固定 Entry、包裹、Anchor、公开配置宏及其默认候选 | 根据切卡动作修改其他作品的数据 |
| 角色卡作者 | 常驻 / 动态 Setting 的贡献，以及与预设公开配置项匹配的作品宏候选 | 自动篡改共享预设正文、开关或所有会话的选择 |
| 扩展作者 | 通过正式来源提供数据、独立贡献或宏候选；分别服务对应调用 | 以加载顺序抢占同名宏，或把副作用藏在宏展开中 |
| 用户设置 | 选择预设候选；确认是否采用角色卡候选；查看有效值和来源并切回默认 | 手工维护每次切卡的关闭 / 恢复脚本 |
| PromptBuild | 使用本次已解析的宏值与贡献构建 Prompt，保留来源诊断 | 代替用户猜测同名候选谁胜出，或写回源配置 |

已确认的设置交互方向：

1. 预设提供多个候选，用户在面板选择；正文保持同一个宏引用。
2. 角色卡提供同一配置项时，提示采用作品候选或保留当前选择，不静默按“卡优先”覆盖。
3. 选择作用于当前作品 / 运行组合，不更改预设保存的默认原文。记住选择，避免每次 Provider 调用重复询问；可查看来源并恢复默认。
4. 多个未选择的候选不按加载顺序、文本位置或深度决定胜出。明确选中的来源失效时应暴露问题，不以静默替换掩盖。

“全局性”指宏可作为共享的配置引用方式，并可提供全局默认选择；不意味着所有角色卡写入同一个可变 KV。2026-09-24 用户确认：作品选择按 `Timeline + Preset` 持久化，换 Session、切分支沿用，另一局独立。复用 DocumentStore，每组合一份引用配置，不改剧情 State 或源资源。正常候选正文更新沿用引用，所选来源 / 候选失效时报错，不静默替换；运行中的 Run 不变，下一次构建采用新选择。全局默认选择的独立配置 UI 不在此轮新增。

现有基础：[宏消费合同](../../architecture/application/prompt-build/injection-and-inline-expansion.md) 与第 20 节已接通同预设多个候选、持久引用、默认恢复和正式调用。作品候选通过现有宏面板供用户明确选择，没有新增自动弹窗或静默“卡优先”规则。Card 内容仍遵守创建 Timeline 时的快照语义；存档来源完整性限制见第 20 节，不能把引用保存等同于资源全部可迁移。

## 3. 默认 Prompt 骨架

默认 Preset 采用以下顺序。2026-09-21 已实施的精确 Anchor ID 与来源以 [Default 预设骨架](../../architecture/application/prompt-build/default-preset.md) 为准；配置宏嵌入普通 Entry，不为文风、每个推演步骤另造替换锚点：

```text
稳定前缀
  Agent 身份与常驻工作原则
  固定写作引导、宏选择的文风、局部推演与输出要求
  稳定工具说明
  可选的前置补充 Anchor
  Preset 作者包裹开头
  常驻 Setting Anchor：接收独立贡献
  Preset 作者包裹结尾

Narrative 基线
  独立的 Narrative 记忆位置
  独立的 Narrative 正文位置：接收采样后的正文
  必要的前后补充位置

较早的 Agent Session 投影
  独立的 Session 记忆位置
  必要的较早工作记录，保留消息与工具协议边界

本次交互的动态上下文
  条件 Setting Anchor：本次交互开始前计算的贡献
  状态视图等明确来源提供的上下文

当前输入
  用户最新输入，独立 user 消息

运行时及尾部补充（只在合法交互边界）
  普通尾部注入
  独立的 Workspace 视图
  独立的 Notice 提醒
  可选的模型适配尾部
```

这只是官方写作模板的默认顺序，不是所有 Preset 的硬编码顺序。身份、固定约束与包裹不必都变成宏；作品没有候选时仍可使用预设默认配置。作者也可以把相同配置宏放到其他合适位置，不能根据“文风”等内容题材强制移动。当前 Run 的后续 assistant / tool call / tool result 由 Tool Loop 追加，保持协议与实际顺序；跨 Run 完整工具回放仍待接线。

Notice、Workspace 和普通尾部贡献需要独立分块，不能仅因都在尾部而混排。尾部各块的最终顺序、追加 / 替换方式和跨 Step 保留仍待生命周期讨论，本图不授权每步重写已固定前缀。

## 4. 被动上下文与实时工作区

### 4.1 被动上下文快照

关键词、状态条件和其他作者规则在一次 Agent 交互开始前求值：

```text
读取交互开始前的输入、Narrative 基线和 State
  -> 计算 Active Setting
  -> 冻结本次交互的 Passive Context Snapshot
```

进入 Provider 调用后，不因为 Agent 新生成的正文或 Tool Result 自动重新扫描并扩张被动注入集合。

### 4.2 Runtime Notice

状态或领域写入成功后，Runtime 可以在下一次 Provider Step 前生成短提醒：

```text
[Context Available]
source: character/alice
reason: affection reached 80
entry: relationship.alice.80
action: read_context(entry)
```

Runtime Notice 默认只说明新可用内容，不全文复制被动 Setting。Agent 需要完整内容时通过主动读取获得。

建议保留独立 Anchor：

```text
@runtime.workspace
@runtime.notices
```

它们不是工具列表，也不是 Narrative 历史。一次 Provider 调用开始后 Prompt 冻结；Notice 只在下一次调用前更新。

### 4.3 主动读取

主动读取是当前交互中的显式行为：

```text
list / search
  -> Agent 选择候选
  -> read
  -> Tool Result / Fresh Context Mount
```

被动 Setting、Runtime Notice 和主动读取必须保持可解释的来源与生命周期差异。

## 5. Narrative / Session 记忆投影

剧情记忆与工作记事板保留不同语义，以同一套业务节奏协调准备与采用；可以在不同时间启动总结，例如第 32 楼准备剧情摘要、第 40 楼完成 Session 工作交接。这里不建立互不协调、各自改写 Prompt 前缀的两套刷新机制：

| 投影 | 内容 | 典型范围 |
| --- | --- | --- |
| Narrative Memory | 剧情、实体、事件、关系 | 1~90、某个分支、某个记忆锚点前 |
| 工作记事板 | Agent 主动保存的目标、决定、计划、待办与必要工作事实 | 当前 Session 的已保存记事内容，不另建多级摘要 |

### 5.1 缓冲区与采用时点

Narrative 新节点立即持久化，但不必立即进入 Prompt 前方的 Narrative 基线。

默认写作流程由统一刷新动作按需请求剧情总结并清理会话。常规按剧情次数触发；未达剧情条件的预算兜底只清理工作会话，不自动生成剧情摘要或推进覆盖范围。具体策略由独立记忆 Plan 定义。

本 Plan 负责安全交互边界、工作交接与 Prompt 输入段的重建。这里不再定义独立的 Session Narrative 快照或长期 `RefreshState`。Narrative Summary 和 Session Summary 是两项独立工作：Narrative Summary 完成只产生可采用结果，不立即推进默认有效指针；到 Session 总结采用边界，Memory 侧才发布已经准备好的摘要与 Raw 范围。Session Summary 完成后隐藏旧工作段并携带 Session 工作记录，不等待尚未完成的 Narrative Summary。

已确认：第 40 楼工作流结束时，Session 无论 Narrative Summary 是否完成，都可以完成自己的工作交接与工作段重建；不逐条挖掉旧正文工具记录再拼接剩余历史。原始 Transcript 保留。若 Narrative Summary 尚未完成，下一次 Prompt 暂时没有新的默认 Narrative Raw 投影，模型可能遗忘 33～40 楼，这是已接受的失败代价。一次需要剧情总结的上下文整理示例：

```text
旧 Narrative Summary + 1~80 正文
  -> 新 Narrative Summary(1~90) + 91~100 正文
```

Memory 指针推进会破坏从 Narrative 区变更点开始的后续缓存，这是有意接受的整理成本，不应在每次 Narrative 写入时发生。

### 5.2 计数

Narrative 的范围应以稳定节点 ID / 版本边界为权威，楼层号只是 UI 展示或兼容计数。

范围身份与业务计数分开。以下为范围约束，不预先决定“一个节点是否等于一次完整剧情交互”；次数单位、批量 / 拆分写入及缓冲后计数归独立记忆 Plan：

- Agent 工作指令不自动算 Narrative 楼层；
- 成功提交的剧情节点参与 Narrative 计数；
- 一次写入可产生多个节点；
- 修改旧节点不应伪造新的剧情楼层；
- 用户输入只有在明确写入 Narrative 后才进入剧情计数。

## 6. 共用的 Narrative 采样能力

### 6.1 已收束的方向

平台同时提供单次模型调用和 Agent 循环，由用户和扩展作者选择，不按“功能性 / 剧情型”强制指定执行方式。上下文获取是独立维度：调用前被动准备、运行中主动读取可以使用同一套采样能力，也可以组合使用。

```text
应用 / 扩展直接调用 -----+
                       +-> Narrative 范围读取 -> 可选正文加工
Agent 经 CodeAct 调用 --+     |
                             +-> 被动：Contribution -> Anchor
                             +-> 主动：读取结果 -> 当前交互
```

这里的采样是确定性的内容选取，不是模型生成参数中的随机采样。CodeAct 只接入同一读取与加工能力，不另做一份分支遍历、范围计算或正则管线；具体工具调用与返回合同归其他任务。

记忆插件管理自己的摘要、总结进度和覆盖指针，采样能力准确读取请求的范围，PromptBuild 只编排准备好的贡献。主 Agent 的默认请求可以由 Memory 侧返回“摘要 + 指针之后的 Raw 缓冲”；专项消费者则传入临时范围参数。Anchor 是接收位置，不是记忆存储或查询接口。实体、事件与分层摘要由对应扩展提供，不要求 Narrative 采样器自动生成。

允许读取的参考范围不等于产出覆盖范围。例如总结 1~32 可以参考 33~40 和旧摘要，但任务声明仍只覆盖 1~32；范围合法性检查不能证明模型摘要在语义上没有混入未来事件。

### 6.2 当前实现证据（2026-09-17，只读调研）

| 能力 | 已有基础与限制 | 来源 |
| --- | --- | --- |
| 分支读取 | `getPage` 接收分支、节点游标与数量，沿父链读取并校验游标归属；共用采样器已在其上实现固定终点、最近 N 个节点和 `afterNodeId`～`throughNodeId` 区间，仍没有 Memory 默认有效 Head 合同 | [Narrative Store](../../../packages/application-data/src/narrative/store.ts)、[Narrative Sampling](../../../packages/application-runtime/src/narrative/sampling.ts) |
| Agent 输入准备 | `prepareAgentTurn` 已复用共用采样器和固定读取终点；默认仍为最近 100 节点，未实现 Memory 的有效范围策略 | [Agents Runtime](../../../packages/application-runtime/src/runtime/agents-runtime.ts) |
| 历史投影入口 | `readRuntimeHistoryEntries` 收集分支全部分页；`projectHistory` 未提供范围参数 | [Transforms Runtime](../../../packages/application-runtime/src/runtime/transforms-runtime.ts) |
| 正文加工 | `projectHistoryEntries` 已提供正则、phase、规则顺序、来源和变换记录；depth 相对传入窗口计算，不是绝对楼层 | [History Text](../../../packages/application-runtime/src/transforms/history-text.ts) |
| 消费者耦合 | 新增 `runtime.sampleNarrative`：prompt 加工可显式指定 `presetId`，或借 `consumerAgentSessionId` 解析 Preset 和 Session 规则覆盖，不要求单次调用创建 Session | [规则解析](../../../packages/application-runtime/src/runtime/transforms-runtime.ts) |
| Anchor 注入 | `composeAgentTurnPrompt` 将加工后的 Narrative 转为 Contribution，挂到 `@chat.narrative` | [Agent Turn](../../../packages/application-runtime/src/agents/agent-turn.ts) |
| CodeAct 主动读取 | `ctx.readNarrative` 绑定当前 Timeline / Branch；默认 raw，显式 prompt 使用宿主当前规则。未接入 Memory 和历史权限分层，不能把目标绑定当成默认 / 历史范围授权已实现 | [CodeAct Context](../../../packages/application-runtime/src/agents/codeact/context.ts)、[Narrative Sampling](../../../packages/application-runtime/src/narrative/sampling.ts) |
| 单次调用 | 扩展已有受能力声明约束的 `ctx.ai.invoke`，不要求创建 Agent Session；共用采样器可独立使用，但完整无 Session Prompt 加工合同仍未完成 | [Extension Host](../../../packages/extension-sdk/extension-host/src/instance.ts) |
| Token 基础 | Gateway 返回 Provider usage；本轮检查的构建与历史加工路径未发现可复用的发送前模型 Token 估算能力，文本预算目前为字符数 / 条目数 | [Gateway](../../../packages/ai-gateway/src/gateway.ts)、[Token 讨论](../discussion/application/prompt/token-estimation-and-audit-v0.md) |

上述结论来自静态源码读取，不是运行、顺序正确性或性能验收。

### 6.3 最小请求与结果候选

以下是直接传给 Narrative 模块的请求，不是 Anchor 属性或宏表达式；参数由消费方按自己的生命周期准备，见 6.6。先收束三种请求，不提前设计通用策略引擎：

1. 使用分支的默认正文范围。
2. 明确指定节点起止边界，并定义包含 / 不包含语义。
3. 从选定 Head 向前读取最近 N 个剧情节点，同时返回近期窗口之前的边界。

结果应保留实际节点 ID、分支与读取依据的 Head、实际起止范围，以及是否仍有未返回内容。窗口位置与路径上的楼层位置需要区分；分页和预算不得静默伪装成完整读取。

先选节点，再按显式选择执行 prompt 向文本加工。原文读取不默认套用写剧情时的全部规则；加工结果保留来源与规则信息，不改原始正文。现有 depth 的参考窗口以及楼层计数定义仍需确认。

采样和加工应能服务有 Session 的 Agent，也能服务无 Session 的单次调用。需要收束规则解析所需的最小消费者信息，不能为了找到 Preset 规则强行创建 Session，也不自动把 Profile 变成新的策略配置中心。

### 6.4 默认范围与插件状态

默认剧情消费读取记忆贡献与当前有效正文；专项采样可以显式读取默认范围以外的历史，但不因此绕过权限。默认不注入不等于 UI 隐藏、禁止读取或删除。不同消费者的临时范围参数不写入 Agent Session；若未来某个长任务必须固定视图，应由该任务类型单独声明持久化需求。

记忆插件保存自己的摘要、处理进度和**默认有效 Head**；Memory / Sampling 侧据此准备主 Agent 默认有效范围。Timeline 的原始 Head 每次写入都会推进，但不等于默认有效 Head 被推进。专项消费者传临时参数，不要求逐节点增加 `is_hidden`，不新增 Session Narrative 快照。

因此，只有总结插件将准备好的结果在 Session 总结边界正式采用并推进默认有效 Head 时，新的 Raw 节点才会进入默认 `@chat.narrative` 投影。有效 Head 未变化期间，新写入只会通过当前 Agent Session 的 Tool Call / Tool Result 历史存在，不会自动进入前方 Narrative 区。Memory / Sampling 必须区分原始 Timeline Head 与默认有效 Head；不能每轮用最新原始 Head 代替有效 Head。

分支归属、范围更新权限以及摘要可用性与范围推进的一致性仍待确认。Timeline Head 是原始数据头，不因总结移动；Memory 插件推进自己的 `coveredThroughNodeId` 或等价指针。修改有效范围不自动改写已经发出的 Provider 请求，下一次 PromptBuild 才消费新组合。

现有 Extension Record 已能绑定 Narrative 节点，不新增任意节点 Metadata 存储来重复承载插件指针。指针删除、分支继承、存档 ID 映射和内容编辑后的摘要失效需基于真实领域合同处理，不静默移动指针或假设节点 ID 等于内容版本。

### 6.5 范围与预算分工

剧情次数决定常规整理节奏，Token 预算负责容量警戒，不以“Token 少”阻止短对话到点总结。节点边界决定实际读取范围，近期剧情数量表达缓冲距离。不能把字符数称为 Token 数，也不能把 Provider 整次 usage 当作各个节点的精确成本。

范围读取可先独立定义；自动 Token 阈值与裁剪的实施需补齐估算基准，并区分原文估算、加工后输入估算和 Provider 实际 usage。记忆算法、摘要版本选择及完成后的指针推进不属于采样器。

### 6.6 消费者生命周期与采样传参（已确认，待实施）

**采样请求直接传给 Narrative 模块，不通过 Anchor 传参。** 消费者负责决定何时请求、需要哪些内容；Narrative 模块负责执行范围读取与所选加工；PromptBuild 只消费已经准备好的贡献。采样请求可以随任务进度变化，不要求固化在 Preset、Agent Profile 或 Agent Session 中。

- 生图任务：每次生成前请求当前分支最近 3 个正文节点；下次生成重新计算窗口，不在锚点中保存这 3 个节点。
- Memory 任务：记忆插件从自己保存的处理指针确定起点，并决定本次终点、参考范围和产出覆盖范围。例如已处理至 32 楼，本次请求从 33 楼开始；插件管理指针及推进时机，Narrative 模块不承担总结调度。
- Agent 主动读取：通过 CodeAct 调用同一 Narrative 读取与加工能力，结果进入工具返回；被动采样由调用方在发送模型请求前准备，结果转换成 Contribution 注入锚点。两者不各自实现一套范围解析和文本管线。

```text
消费方生命周期：决定请求时机、准备范围与加工参数
  -> Narrative 模块：读取、加工，返回有序内容和来源边界
  -> 被动注入：Contribution -> Preset Anchor -> Prompt
     主动读取：Tool Result -> Agent 当前交互
```

默认主剧情视图与专项采样保持分工：默认视图遵循共享的有效范围；专项采样按本次请求取数，可以读取默认注入范围之外的已提交正文，但不得越过权限边界，也不因读取而推进默认有效 Head。采样的区别是消费者指定范围，不是样本必须很小。

Narrative 使用普通 Anchor 定位，不因采样引入带参数的特殊锚点类型。默认正文和专项采样可以安排在不同位置，但具体新增 Anchor ID 尚未定稿，也不要求两个位置同时启用。Narrative 的来源、范围与加工信息仍由投影结果保留；Session 的角色和工具消息结构另由消息投影处理，不把两类载荷强行统一成纯文本。

第一阶段已实现只读采样器和 CodeAct 接入口；仍不新增公共策略引擎或插件指针存储。当前实现的请求不依赖 Anchor 参数，读取不推进记忆指针或默认有效 Head。后续最小验证还应覆盖：生图任务最近 3 个节点与 Memory 指针区间均可直接请求 Narrative 模块；同一请求经被动注入和主动读取获得一致的节点范围、顺序与加工结果；摘要与 Raw 的默认组合不越过权限边界。

## 7. 非目标

### 本轮执行切片：共用正文加工（2026-09-24）

用户已授权继续不涉及新产品决策的实施。本轮目标是让已确认的范围请求复用同一正文加工路径，不把整个生命周期标为完成。

- 采样模块：修复完整性、预算续读、空分支非法起点与分页顺序；限定保留的正文大小，并支持取消。固定 Head 只固定节点路径终点，不宣称现有可编辑节点具有跨分页的版本快照。
- Runtime：提供不要求创建 Session 的 `sampleNarrative` 调用；显式选择 raw 或使用指定 Preset / 现有 Session 的 prompt 规则。复用已有规则顺序、覆盖和诊断，不增加宏历史求值策略。
- Prompt / CodeAct：复用同一 Narrative 文本加工函数；CodeAct 的 prompt 视图使用宿主选定的规则，不能由脚本指定其他 Preset。保持默认 raw，保持当前默认 Prompt 窗口，不偷偷实施有效 Head 策略。
- 写集：`narrative/sampling.ts`、新的正文加工 helper、`runtime/transforms-runtime.ts`、`agents/agent-turn.ts`、`runtime/agents-runtime.ts`、CodeAct Context / 教程、Runtime 导出类型及定向测试。
- 主要验证：真实 Store 的跨页次序、区间边界、预算续读、读取间新增节点和取消；无 Session 加工、规则覆盖、原文不变；两种 CodeAct 传输下 raw / prompt 与被动 Prompt 内容一致。公共接口变化补 Runtime build，不跑全仓验收。
- 停止边界：Memory 默认范围的持久化与采用、历史权限分层、引用展开、Session 总结与消息回放不在本轮自行定案。正文不增加宏求值层，见第 16 节后续澄清；Setting 的重新渲染仍遵循其上下文生命周期。当前 Timeline / Branch 绑定不是历史分层授权已经完成的证明。

本计划暂不：

- 设计完整的记忆插件算法或 LV1 / LV2 / LV3 Schema；
- 实现自动总结 Agent；
- 改造 CodeAct 执行协议；
- 增加通用 Anchor 替换 / 继承引擎，或把 Preset 与 Setting 强制合并为一个资源；
- 承诺具体 Provider 的缓存命中率或注意力收益；
- 让 Prompt 在 Provider 调用进行中实时变化；
- 让被动关键词在同一交互中递归触发；
- 把 Runtime Notice 当作权限撤回或秘密遗忘机制；
- 把楼层号作为 Narrative 的唯一数据合同。

## 8. 后续实施拆分候选

1. **PromptBuild 骨架与 Anchor**
   - 收束默认 Anchor 名称、顺序和工具协议约束；
   - 区分 Narrative Memory、Session Memory、Dynamic Context、Runtime Workspace、Runtime Notice。
   - 按 2.5～2.6 通过配置宏选择文风和局部推演，不复制成锚点覆盖机制；
   - 设置中显示候选、有效来源与作品选择，复用现有宏候选和检查能力。

2. **共用采样与正文加工**
   - 复用 Narrative Store 与历史文本变换，统一范围请求及结果；
   - 按 6.6 由消费方生命周期直接请求 Narrative 模块，不把采样参数、指针或任务调度放进 Anchor；
   - 解除 prompt 向加工对持久 Agent Session 的不必要依赖；
   - 服务被动 Prompt 输入和 CodeAct 主动读取，不重复实现采样器；
   - 确认分支、节点边界、顺序、加工规则与预算报告。
   - **已完成采样与正文加工子切片**：固定分支终点、tail / range、预算续读与取消；Runtime 显式消费者规则加工；CodeAct raw / prompt 和默认 Prompt 共用读取 / 正则基础。Memory 默认范围与生命周期仍未完成；正文宏求值不是待补能力，见第 16 节。

3. **统一整理与记事板携带**
   - 接收有效策略，在安全边界完成工作交接；Memory 侧推进指针后，下一次 PromptBuild 获取新的摘要与 Raw；
   - 保留完整 Transcript 与记事板，修复跨轮工具回放，不以独立 Session Narrative 快照补洞；
   - 明确旧 Session 恢复、新 Session 初始化和分支变化时的下一次投影请求。

4. **记忆来源接线**
   - 算法、次数阈值、配置、缓冲和摘要进度归[独立记忆 Plan](./narrative-memory-and-refresh-policy-plan.md)；
   - 本计划只消费版本与覆盖范围，保证采用失败不丢旧状态，不重复建设记忆模块。

5. **Runtime Notice / Workspace**
   - 状态或写入成功后，在下一次 Provider Step 暴露短提醒；
   - 主动读取完整上下文；
   - 维持 Tool Call / Tool Result 顺序和可重放性。

## 9. 完成标准

本计划完成设计收束时，应能明确回答：

1. 默认 Prompt 的稳定、剧情、工作和实时区域分别是什么；
2. 哪些内容是被动快照，哪些内容是 Runtime Notice，哪些内容必须主动读取；
3. Narrative 写入何时持久化、何时进入新的 Prompt 基线；
4. Narrative Memory 与工作记事板的输入合同，以及保留正文 / 完整工具交互的边界；
5. 多 Agent 如何请求不同 Narrative Projection；
6. 总结失败或尚未采用时，当前 Prompt 如何保持可用；
7. 任何 Anchor 变化都不会破坏 Provider 工具协议和 Agent Transcript 事实。
8. 切换角色卡只改变当前组合采用的宏候选，不修改共享预设；设置能解释选择来源，并保留拒绝作品候选及恢复默认的入口。

## 10. 相关文档

- [剧情记忆与统一刷新策略计划](./narrative-memory-and-refresh-policy-plan.md) — 总结策略、次数阈值、近期缓冲、记事板策略及玩法配置；本 Plan 承接刷新执行与投影采用。
- [CodeAct 与 VFS 工具实施计划](./codeact-vfs-tooling-plan.md) — 独立负责执行、路径、读取与写入合同；本计划负责 Skills / Notice / Workspace 锚点及上下文生命周期。LS 与 Notice 复用资源状态事实，不互相复制实现。
- [`docs/workbench/discussion/application/prompt/README.md`](../discussion/application/prompt/README.md)
- [`docs/workbench/discussion/application/agent/README.md`](../discussion/application/agent/README.md)
- [`docs/workbench/discussion/application/summarization-v0.md`](../discussion/application/summarization-v0.md)
- [`docs/workbench/discussion/application/memory-summary-v0.md`](../discussion/application/memory-summary-v0.md)
- [`docs/architecture/application/prompt-build/README.md`](../../architecture/application/prompt-build/README.md)
- [`docs/workbench/plans/agent-runtime-session-and-workspace-plan.md`](./agent-runtime-session-and-workspace-plan.md)
- [Setting Layer 与配置宏职责](../discussion/application/prompt/setting-layer-prompt-source-v0.md)

## 11. 接下来逐项讨论

以下是开放问题，不把先前候选或助手建议自动升级为最终合同：

1. 默认骨架：在已确认的 Anchor / 配置宏分工下，收束官方必备 / 可选位置、包裹和作者协作；不再以新增替换 Anchor 解决文风选择。
2. 生命周期：交互、Run、Session 的工作段重建时点；被动 Setting 重算；Workspace / Notice 更新位置；Memory 指针何时被下一次 PromptBuild 消费。
3. 记忆接线合同：Memory 侧提供摘要与 Raw 范围贡献，PromptBuild 消费；失败时继续使用旧贡献。摘要策略及配置转至独立记忆 Plan，不再讨论两个自动总结触发器。
4. 缓存与失效：尾部变化和前部重建的区别、同一前缀如何识别；不把内部投影版本变化直接等同于 Provider 缓存命中或失效。
5. 激活语义：关键词扫描来源、状态变化是通知还是全文、主动读取要求、停用与旧上下文残留的区别。
6. 设置生命周期：全局默认与当前作品选择的存储归属、卡 / 预设版本变化后的确认时点；不把配置选择隐式写入 State。

默认骨架讨论需对照 [正式 PromptBuild 架构](../../architecture/application/prompt-build/README.md)、[新建预设模板](../../../packages/application-runtime/src/runtime/prompt-runtime.ts) 和 [官方问答助手](../../../official/starter/presets/assistant.json)。两份模板目前不同；`@fresh.tail` 在官方助手里实际位于前部，名称不保证物理位置。历史 MessageBlock 归档可作为设计依据，但不将旧 Zone / Core Pipeline 合同当作现行实现。

2026-09-20 讨论轮仅更新本 Plan 与 Setting Layer 讨论中的职责说明。后续生命周期与采样实施仍需定向验证范围包含关系、分支归属、节点顺序、raw / prompt 选择及有无 Session 两条消费者路径。宏设置需验证无作品候选、用户接受 / 拒绝候选和切卡不改源配置。实际缓存与注意力效果尚未验证。

## 12. 默认骨架与原生输入接线切片（2026-09-21）

状态：本切片完成。用户已确认 Default 只需最短通用说明与完整位置，不做模型精修，不推进分文件 MD、CLI/MCP 或记忆实现。

### 目标与文件边界

1. 默认模板作为普通 JSON Artifact 随 Application Runtime 包交付，新建预设从它创建独立资源。只维护一个模板源，不依赖问答包已安装，不迁移现有用户预设。涉及 Runtime 的模板 JSON、加载 / 复制函数与 JSON 构建配置。
2. 稳定身份、文风、推演与输出要求放在 Narrative / Session / 动态内容之前。默认宏必须可解析。保留常驻 / 条件 Setting、记忆、文本工具、输入、Workspace、Notice 与普通尾部的位置，未接入来源保持为空。
3. 修复原生编译链：Preset Entry 按树输出且遵守开关 / Activation；外部 Source 不独立混入骨架；Session 保留消息边界；文本 Tool 描述进入锚点，Native Tool Schema 仍与 messages 平级。涉及 workspace-codec、prompt-build-pipeline、prompt-builder、agent-turn。
4. 复用现有 Narrative 分支窗口，本切片不新增采样参数或总结指针；明确当前窗口与未实现项。现有 Tool Loop 和另一任务的 CodeAct / 返回协议不改写。

### 最小验证

- 使用临时 SQLite 与测试 Gateway，从“新建预设 -> 挂载工具 / 设定 -> Narrative 和 Session -> Preview / Invoke”捕获最终请求，验证稳定前缀、内容只出现一次、顺序、角色、工具定义与最新输入。
- 通过编译器定向测试覆盖禁用 / 条件 Entry、原生 Session 消息边界和未来锚点的独立贡献，不以 JSON 快照替代真实编译行为。
- JSON 文件进入发布构建，需运行 Application Runtime 定向 build，确认产物可以加载模板；不跑全仓 lint / 测试。
- 复制与新建不共享可变节点或宏配置，不改已有数据库资源和官方问答内容。

### 非目标与停止条件

不新增通用覆盖引擎、自动记忆、Notice 生成器、采样器、跨进程恢复或模型专用提示词。若必须改变工具权限、持久化语义或已确认的调用合同，停止扩展并回报。完成后记录测试结果、既有失败和尚未接线的位置。

### 实际实现与剩余边界

- 已落地包内 JSON 模板、独立实例化、稳定宏前缀、原位 Entry、选定骨架隔离及 Session 文本消息边界。
- 新增预设条目不再自动投向 `@chat.system`；已有显式目标与 Setting 默认目标保持原状，不做数据迁移。
- 原生 Content / Native Tools、常驻与条件 Setting、Narrative 文本变换、Session 文本历史及最新输入已通过实际测试 Gateway 请求验证；工具默认挂载仍关闭。
- 未改现有 Tool Loop / CodeAct。预留的记忆、Skills、State、Workspace、Notice 等位置可以接收显式贡献，但不新增自动生产者。
- 当前仍是 Narrative 最近 100 节点、Session 最近 100 Transcript Entry 的既有窗口。跨 Run 的 tool-invocation / tool-result 完整回放仍不在现有文本投影中，不能把本切片称为完整 Session 生命周期交付。
- 整个 Plan 保持 Open；后续应先收束基线采用与上下文生命周期，再实施记忆 / 动态工作区。真实模型效果、Provider 缓存与 UI 人工体验未验收。

### 验证记录（2026-09-21）

- `compiler.test.ts`、`prompt-resource-runtime.test.ts`、`default-preset.test.ts`、`agent-session.test.ts` 共 36 项通过。旧测试中“新建预设只有两个消息”及根级锚点假设随新模板更新；保留实际请求、角色、历史和持久化断言。
- `native-tool-loop.test.ts` 定向执行 Native / Content 混合循环、Provider call ID 与结果续传、Session prompt 变换三项，全部通过；同文件其他七项未执行。
- `pnpm --filter @loom-studio/application-runtime build` 通过；直接 import `dist` 的 Runtime 并使用内存 SQLite 创建预设，确认包内 JSON 加载成功，含 11 个顶层区域和 3 个默认宏。
- 本次相关 tracked Diff 的 whitespace 检查通过。未运行全仓测试，未连接真实模型，未操作用户数据库，也未启动浏览器代替 UI 人工验收。

## 13. 多轮 Agent 生命周期仿真验收（2026-09-21）

用户要求验证完整的交互来回，不能仅检查关键字符串出现或分散的工具单测。测试为 [`default-preset-lifecycle.test.ts`](../../../tests/integration/application-runtime/default-preset-lifecycle.test.ts)。

使用真实 Runtime、磁盘临时 SQLite、注册工具执行器、Narrative Store、Session Store 与 PromptBuild；仅将 Gateway 替换为脚本化模型。工具通过实际 Scope 执行正文追加，不 Mock 写入结果。模拟剧情记忆、Memo、工作区与提醒内容由测试作者预先挂为 Setting Contribution，不代表自动记忆插件已经实现。

### 仿真场景

1. 创建 Default，装入两个不同来源的设定，验证 localDepth 顺序、常驻包裹、剧情前后包裹、剧情记忆、Session Memo、条件 Setting、普通尾部、Workspace、Notice 的独立位置。
2. 创建 105 节点主剧情，从第 103 节点分支并追加两条不同正文。断言当前 100 节点窗口从第 6 节点开始，只含选中分支；仅 Prompt 文本被正则变换，原始正文不改。
3. 第一轮用户输入：Native 工具读剧情，Content freeform 工具写正文，Native 工具再次读取确认写入，模型结束，共四次 Provider 请求。逐条比对完整消息、角色、顺序、call ID 与结果，确认 Run 内前缀不因正文写入变化。
4. 第二轮用户输入：正文再次写入成功，随后 Provider 故障。断言写入保留、工具事实持久化、Run 标记 failed，不把故障当成正常结束。
5. 关闭数据库，重建 Runtime，再进行第三轮交互；验证 Transcript 恢复、Preview 与真实请求相同、最新输入只出现一次且位置正确。
6. 预先取消一次调用：不多发 Provider 请求、不多写正文，保存 aborted 状态。再创建独立 Session、切换 Narrative 主分支，检查对话隔离与分支隔离。

全流程实际发送七次 Provider 请求，执行四次工具；首轮、中间 Step、下一轮与重启后的请求均有完整协议字段比对，不只使用包含字符串断言。对当前文本投影行为的刻画，与下面尚未实现的目标合同分开断言。

### 仿真发现并修复

- **Freeform Content Tool 永远收到空结构化参数而被拒绝**：协议要求 metadata，但 Registry 禁止 freeform arguments。只把空 metadata 转换为无 arguments；非空 metadata 继续拒绝，另有定向回归验证，不静默丢字段。
- **Narrative 追加工具事务重入**：原实现从 Data Engine 事务内调用普通 Store 读取。改为先取分支快照，再用 Narrative Store 原生追加事务，保留 expectedHeadNodeId 并发校验；跨故障持久化由上述真实写入场景验证。
- 现有 Content Tool 测试中“工具描述必在第一条消息”的旧假设已更新；描述物理顺序由完整骨架仿真约束。

### 目标合同与后续修复

1. **跨交互 / 重启的工具历史回放（2026-09-24 已修复，见第 17 节）**：原有缺口为已持久化的 Native 调用与结果、Content 调用与结果没有进入下一轮 Session Prompt；现已恢复，原目标测试转为普通通过用例。
2. **Narrative 基线采用时点（2026-09-24 已接通记忆来源，见第 19 节）**：原缺口是每轮读取最新窗口，追加后立即改变前部。当前测试以持久化已发布范围作为输入，Preview / Invoke 均读取同一范围，基线冻结转为普通通过。未注册来源的旧宿主仍待迁移，不冒充该合同已在默认生产安装中启用。

最初这两项使用显式 `it.fails('KNOWN GAP: ...')` 保存目标断言；两项现已在已配置来源的仿真路径成为正常通过。原始下列数字保留其历史验证范围，不当作当前完整验收。

### 本轮验证

- 生命周期仿真、完整 `native-tool-loop.test.ts`、Default 基础集成：**20 项正常通过、2 项目标合同预期失败**。
- Application Runtime 定向构建通过。
- 未连接真实模型；未验证真实 Token 缓存命中、自动摘要、Session 超出 100 个 Transcript Entry 后的完整截断策略、流式中途暂停与断点续跑。本轮取消测试是调用前取消，不冒充上述场景。
- 因此完整生命周期验收仍未通过；整体 Plan 保持 Open。

## 14. 游玩过程与模块分工推演（2026-09-21）

本节是目标行为推演，不是代码验收记录。记忆策略以[独立记忆 Plan](./narrative-memory-and-refresh-policy-plan.md) 为准；当前代码仍有第 13 节记录的工具历史回放和基线提前刷新缺口。

### 演示假设与骨架

同一个写作 Session、同一分支从空剧情开始，每次完整剧情输出恰好产生一个节点。演示采用“未总结正文累计 20 楼，保留最近 5 楼”，即缓冲继续计入下一次待总结集合；这是为了推演选用的参数，不代表计数方式、默认阈值已经定案。

表内未整理时保持 Raw 不变，是目标行为示例，不代表已决定用 Session 存储范围。最新责任修正为 Memory / Sampling 管理有效范围，其终点合同见 6.4；旧例不能作为重新引入每 Session 快照的依据。

```text
稳定身份、写作配置、工具说明与常驻设定
@memory.narrative：Memory 侧返回的当前有效剧情记忆
@chat.narrative：Sampling 侧按消费者请求返回的近期正文
@memory.session：上一次工作交接的记事板快照
@chat.session：当前工作段内已完成交互的原生消息
动态上下文、@chat.input 当前用户输入、尾部独立区域
当前 Run 继续追加的 assistant / tool call / tool result
```

“本轮”和“旧轮”都是同一个未刷新的工作段，不再做本轮 -> 旧 Session -> 前方 Narrative 的逐轮搬运。正文可以存在于写工具的参数中，结果可能只有成功与节点 ID；必须保留完整调用与结果，不能声称短成功回执本身包含剧情全文。

表中“已覆盖记忆”表示采用的摘要组合覆盖的范围，不意味着必须每次重写一个大字符串。正文指已选节点的 Prompt 文本投影；源 raw 不被摘要或正则改写。初始有开场白的玩法将开场白纳入初始基线，本例为说明增量路径省略。

| 时点 | 数据库正文 | 记忆区 | 正文投影区 | 工作历史区 |
| --- | --- | --- | --- | --- |
| 初始化 | 空 | 空 | 空 | 新工作段 |
| 写完 1～19 | 1～19 | 空 | 空 | 1～19 的写入调用、结果与其他交互 |
| 写完 20，刷新准备中 | 1～20 | 仍为空 | 仍为空 | 仍完整保留至 20 的旧工作段 |
| 20 楼刷新采用成功 | 1～20 不删除 | 覆盖 1～15 | 16～20 | 旧段退出，携带交接与未完成任务开始新段 |
| 写到 34 | 1～34 | 仍覆盖 1～15 | 仍为 16～20 | 21～34 的新交互，正文不前移 |
| 35 楼刷新成功 | 1～35 | 覆盖 1～30 | 31～35 | 再次交接、重建 |
| 50 / 65 / 80 / 95 楼刷新成功 | 分别持久化至该楼 | 分别覆盖至 45 / 60 / 75 / 90 | 分别为 46～50 / 61～65 / 76～80 / 91～95 | 每次采用后开始下一工作段 |
| 写完 100，尚未再次整理 | 1～100 | 仍覆盖 1～90 | 由主 Agent 的有效范围请求决定 | 96～100 的写入及工作交互 |

因此，Timeline Head 与默认有效 Head 必须分开描述。到 100 楼不等于默认 Narrative 区已经包含 96～100；只有总结插件推进有效 Head 后，下一次 PromptBuild 才会把新的 Raw 缓冲纳入 `@chat.narrative`。按照演示计数，下一次常规整理在 110 楼；停止游玩也不自动等于整理。Session 重开不需要恢复 Narrative 指针，只需重新请求当前消费者的有效投影并恢复自己的工作段。

### 模块如何协作

1. **Tools / CodeAct**：调用领域写入能力，正文提交到 Narrative Store，调用和结果保存到 Agent Transcript。工具不负责搬动 Prompt 区块，也不因“写入成功”宣布整个 Run 已完成。
2. **Narrative Store / 采样**：维护正文和分支，按选定边界读取；不保存某个 Session 的 Prompt 排版，也不决定何时总结。
3. **Agent Runtime**：在合法交互边界判断有效整理策略；负责工作交接、Session 工作段和工具边界，不保存 Narrative 投影指针。进入剧情整理时，锁定本次处理的分支、Head 与工作交接边界。
4. **记忆来源**：例如首次读取 1～15 生成摘要，保留 16～20；第二次在旧记忆基础上处理 16～30，保留 31～35。参考范围可以更广，声明覆盖范围不能因此扩大。
5. **Session 工作交接**：刷新前把计划、未完成事项和用户约束写入记事板；不把剧情正文再总结一份塞进去。不在工具调用和结果之间切断工作段。
6. **Runtime**：负责工作交接、Session 工作段退出和安全交互边界；不保存 Narrative 投影快照。若整理期间分支或源版本变化，必须校验处理，不能把边界之后的新写入一并丢弃。
7. **PromptBuild**：消费 Memory / Sampling 侧为本次消费者请求准备的贡献，不自行推进指针。动态 Setting、最新输入和尾部内容可按各自规则变化，不能据此声称整个 Prompt 前缀绝对不变或已验证 Provider 缓存命中。

新 Session 可以从同一分支当前可用摘要和消费者请求的 Raw 范围初始化。例如在 100 楼创建 B，可以请求覆盖 1～90 的记忆与 91～100 正文；A 不需要保存一份 Narrative 快照，下一次请求仍按主 Agent 的默认范围策略取用。两者共享权威剧情数据，不共享可变的 Session 工作段。

### 正文应该是 Anchor 还是独立模块

**代码事实**：[Agent Turn](../../../packages/application-runtime/src/agents/agent-turn.ts) 当前将 Narrative 投影到 `@chat.narrative`，Session 投影到 `@chat.session`；[编译器](../../../packages/application-runtime/src/prompt/prompt-build-pipeline.ts) 对 `sessionHistory` 保留原生角色与逐条消息边界。因此 Session 也有 Anchor 定位，不是“没有锚点才有独立生命周期”。

**建议，尚非新的实现合同**：保留两个独立位置 `@memory.narrative` 与 `@chat.narrative`。Memory / Sampling 准备本次请求的贡献，Runtime 负责交互与整理时机，Anchor 只负责 Preset 内的位置。不把包含范围、版本和正文的独立 `NarrativeProjection` 大对象强加给 PromptBuild，也不另造正文排版机制。

- 记忆位置可接收多个来源的独立贡献，但先由来源／Runtime 选定有效版本，不默认堆入所有历史摘要。
- 正文位置注入本次选定范围的一组有序节点，保留来源和边界；范围内顺序归投影模块，不让多个插件各自追加整条 Timeline 造成重复。
- 多个不同剧情采样的组合需显式声明，不把“Anchor 支持多来源”当作默认去重、合并或范围仲裁能力。
- Session 位置需要原生消息序列与工具协议保护；Narrative 正文是资料，可由 Preset 外层 MessageBlock 选择角色。定位机制可以共用，载荷和编译规则不必相同。
- 这里的“raw 正文”指与摘要相对的原始剧情节点。已有 prompt 向文本变换仍是可选加工层，不把源 raw、投影后文本和摘要混为一份存储。

本轮只补记设计与推演，未修改默认骨架、实现总结器或新的工具回放协议。后续责任修正已取消每 Session Narrative 快照方向；有效范围、失败恢复及重启规则仍需落到后续仿真测试。

## 15. 后续三个生命周期问题（2026-09-21）

本节将第一轮审查中剩余的三个问题拆开讨论。它们建立在新的责任修正上：Session 不保存 Narrative 投影；Memory / Sampling 负责范围；PromptBuild 只消费贡献。除前文已确认的不变量外，以下具体分工和时机为待讨论建议，不是代码实施授权或定稿接口。

### 15.1 Session 工作段如何重建

为讨论方便，将“上次整理后仍参与输入的工作历史”称为工作段，不意味着新增实体、ID 或状态机。需要处理的信息包含：

- 当前用户任务和未完成事项；
- 已完成的文本消息；
- Tool Call / Tool Result 完整组；
- Agent 主动保存的 Scratchpad；
- 当前 Run 的状态和必要的恢复信息。

剧情记忆发生整理时，Session 需要同步完成一次工作交接，但不是生成一份 Narrative 快照。交接成功后：

```text
旧工作段的原始 Transcript：继续保存在 Agent Store
下一次 Prompt：
  稳定 Preset
  Memory / Raw 的新请求结果
  Scratchpad
  未完成任务
  新工作段的必要消息
```

以 1～40 楼、保留 8 楼为例：第 32 楼结束时只是准备点，Memory 开始总结 1～32，Prompt 不变；33～40 楼继续通过 Tool Call / Tool Result 存在。第 40 楼当前工作流结束后，Session Summary 可以独立完成并隐藏旧工作段；若 Narrative Summary 已准备好，才在这个采用边界推进默认有效 Head，注入 Memory 与 33～40 Raw。摘要提前完成不提前采用；失败或仍在运行不会阻塞 Session Summary，但可能造成暂时的剧情遗忘。迟到摘要不会自行改写正在使用的前缀。

不能把旧工作段中的单条 Tool Call 或 Result 拆开删除。至少要以完整交互组、已完成 Run 或明确的 Session 工作边界为单位退出 Prompt。跨 Run 的 Tool Call / Result 事实回放已由第 17 节实现；工作交接后的整段退出、记事板携带尚未实现，不能由回放测试推定完成。

Session 单独因为容量压力整理时，不自动推进 Memory 指针。此时它只能：

1. 保存或更新 Scratchpad；
2. 移除已经不承担当前工作的旧工作段；
3. 不推进剧情摘要覆盖范围；Session Summary 仍可以隐藏旧工作段，即使未总结正文暂时没有进入默认 Narrative 区；
4. 如果没有安全的交接结果，则暂停，不静默丢弃工作事实。

需要继续收束的不是“Session 应该保存哪份 Narrative”，而是：

- 工作段边界以 Run、用户交互还是 Tool 组为单位；
- Scratchpad 是 Tool、专用 Agent 能力还是 Runtime 生成入口；
- 未完成用户任务如何从旧工作段进入新工作段；
- Provider 原生 Tool 消息在下一次 Prompt 中保留到什么程度。

### 15.2 动态上下文如何进入

动态上下文分三类，不能都当成刷新：

| 类型 | 例子 | 所有者 | 进入时机 |
| --- | --- | --- | --- |
| 交互前被动 Setting | 关键词、状态条件刚刚满足的条目 | Setting / Runtime | 新一次 PromptBuild 前重新求值 |
| Runtime Notice | “关系达到阈值，有新资料可读” | Runtime / Extension | 状态写入成功后的下一次 Provider Step 或下一次交互 |
| Fresh Context | Agent 主动读取的完整资料 | Tool / Runtime | 当前 Tool Result 或下一 Provider Step，按 Tool 合同消费 |

已有约束与待收束边界：

- 一次 Provider 请求开始后，不递归扫描新正文，不修改已经发出的消息；
- 同一 Agent Run 的后续 Provider Step 可以根据 Tool Result 增加 Fresh Context；
- 被动 Setting 是否在同一 Run 的下一 Provider Step 重新激活，需要由 Runtime 选择“只下一次交互”还是“每个 Provider Step”；
- Notice 只表达可用事实，不复制完整资料，不自动等同于授权；
- Workspace 是工作状态投影，不进入 Narrative Memory，也不自动成为 Session Transcript。

当前代码已经具备 `always`、`manual`、`keyword`、`condition`、`all` 和 `activationFacts` 的求值路径，因此这里不新增另一套 Setting 激活架构。建议维持：关键词被动 Setting 在一次用户交互开始时冻结；工具主动读取和 Fresh Context 可以影响当前 Run 的后续 Step；跨交互的新状态在下一次 PromptBuild 重新求值。

静态 Setting 或改变前方 Prompt 结构的 Setting 修改，可以立即持久化到 Setting 数据源，但只在安全采用点进入 Prompt；它应触发工作交接提醒。纯 `@runtime.state` 数值变化可以在下一 Provider Step 以 State / Notice 形式进入，不自动触发 Narrative 总结。这不保证整个 Run 看见的内容绝对不变，而是避免后台递归改写已经准备好的被动集合。

仍需讨论：

- State 工具写入后，下一 Provider Step 是否允许生成 Notice；
- Notice 是否需要确认、去重和 TTL；
- Fresh Context 进入 Tool Result、独立 system 消息，还是 `@fresh.tail`；
- 被动 Setting 停用后，旧 Session 消息是否仍然保留历史事实。

### 15.3 预算与触发器如何衔接

记忆 Plan 决定业务触发策略，Runtime 不重新发明次数规则。Runtime 只提供当前构建所需的客观信息：

```text
Timeline 原始 Head
Narrative 默认有效 Head
当前 Memory 指针和可用摘要版本
未总结正文的节点范围
当前 Session 工作段规模
当前 Prompt 估算和 Provider usage
是否存在未完成 Tool 组
```

只需先讨论四种结果：继续、剧情整理并交接 Session、只整理 Session、无法容纳而暂停。不预设新的公共枚举或调度状态系统。

建议的衔接方式：

1. 达到剧情次数：例如第 32 楼启动 Narrative Summary；第 40 楼工作流结束后独立启动 Session Summary。Session Summary 不等待 Narrative Summary；Narrative Summary 成功时才推进默认有效 Head。
2. Session 工作内容过长但剧情未达条件：只请求 Session 整理，不推进 Memory 指针。
3. Prompt 容量达到警戒线而剧情未达条件：只整理 Session；若仍无法容纳，按已确认规则暂停，不把“强制提前总结正文”作为隐式备用策略。
4. 当前存在未完成 Tool 组：不在组内执行整理；等待完成、失败或显式中断边界。
5. Narrative Summary 生成失败：不推进默认有效 Head；Session Summary 仍可独立完成，旧 Tool 历史可以退出下一次 Prompt，模型可能暂时遗忘未进入默认 Narrative 区的新写入。

这里仍有三个合同缺口：

- 预算估算由 Runtime、Gateway 还是 Provider Adapter 提供；
- “Session 工作内容过长”使用消息数、工具组数、字符数还是估算 Token；
- PromptBuild 如何报告贡献范围和估算成本，让 Runtime 知道清理后是否真的可发送。

本节不把字符数、Token 和剧情楼层混成一个指标。楼层 / 交互次数表达剧情整理节奏；预算表达能否继续发送；Session 工作段规模表达是否需要工作交接。

## 16. 共用采样与正文加工交付（2026-09-24）

### 已实现的调用合同

可信 Runtime 调用方可以直接请求范围，省略 `processing` 即为原文，不需要 Session：

```ts
const story = await runtime.sampleNarrative({
  timelineId,
  branchId,
  selection: { kind: 'range', afterNodeId, throughNodeId },
  processing: { phase: 'prompt', presetId },
}, signal)
```

`afterNodeId` 不包含，`throughNodeId` 包含；`tail` 请求使用 `count` 和可选 `throughNodeId`。消费者可用 `consumerAgentSessionId` 代替 `presetId`，沿用该 Session 的规则覆盖，两者不能同时指定。此入口未另行接入 RPC / Extension SDK；宿主可直接使用，工具侧已有以下受绑定入口：

```js
const story = await ctx.readNarrative({
  selection: { kind: 'tail', count: 3 },
  view: 'prompt'
})
print(story.text)
```

CodeAct 默认 `view: 'raw'`；选择 `prompt` 时使用宿主准备本轮 Prompt 时选定的规则，不允许脚本更换 Timeline、Branch、Preset 或传入任意规则。`nodes[].body.raw` 保留原文，`nodes[].text` 和总 `text` 为所选视图，`processing` 记录 phase、规则版本与诊断。宏与链接仍按原文本保留，不因这次接线而递归展开。

### State 宏的职责澄清（2026-09-24，已确认）

State 宏主要用于 Setting 等提示词资源及 UI 的变量展示，不把模型生成的 Narrative 正文视为待执行宏的模板。默认生成链路中，Setting 的宏先展开为具体文本，再注入给模型；例如好感度由 20 变成 80，变化的是后续被采用的 Setting 投影和 UI 状态展示，不是回头重新解释第 10 楼正文。

因此撤销“正文宏应读取历史 State 还是最新 State”的待决问题，不为这一假设增加历史宏快照、正文模板标记或第二次宏求值。正文仍可按所选正则规则加工，但字面出现的 `{{...}}` 不自动当作 State 引用执行。

该结论不等于模型在任何工具路径下都不可能看见宏源码：显式读取作者原文、源码编辑或调试路径应保留源码与渲染视图的区别，也不在本轮新增开关。Setting 何时采用更新、UI 如何展示变量仍归各自生命周期，不因 State 变化就自动重建整个 Narrative 前缀。

### 修复与边界

- 分页输出保留剧情正序；旧历史加工路径整体倒序导致页内顺序反转的问题已修复。
- 完整结果不再给出越过本次请求起点的续读游标。预算不足只保留连续尾段；下一次将 `nextBeforeNodeId` 作为包含式 `throughNodeId`，range 保留原起点，tail 扣除已返回节点数量。
- 单次上限沿用正文管线的 1000 节点 / 2000000 字符量级；预算可以调低，较大请求显式续读。只保留预算内文本和一页工作数据，不再把全部历史正文积在内存后裁剪；为校验区间起点仍可能遍历多页。
- 单节点超过字符预算明确失败；不返回一个没有正文、也没有进展依据的空成功。加工后膨胀也校验输出预算，不静默丢内容；CodeAct 桥接 / print 限额仍独立生效。
- 固定 Head 保证追加节点不会混入本次读取，固定 Branch 保证切换活动分支不会串读；这不是可编辑正文的数据库版本快照。读取期间旧节点被编辑的一致版本需求未实现。
- 正则沿用有效规则顺序与覆盖。`position` 和 depth 都相对于本次返回窗口，不是绝对楼层；各页独立加工不能冒充整段加工后分页。
- 默认 Prompt 改为复用采样器，但仍明确保留最近 100 节点旧策略。没有默认有效 Head 时不虚构记忆范围，也没有提前启用摘要更新、Session 快照或新权限开关。

### 验证与剩余工作

- `narrative-sampling.test.ts`、`narrative-projection.test.ts`、`codeact-tool-loop.test.ts`、`default-preset.test.ts` 共 **36 项通过**；Runtime build 通过。
- 使用真实临时 SQLite，覆盖 105 / 205 节点分页、起止包含关系、错误分支、空分支非法指针、续读无重漏、读取间追加和分支切换、取消、无 Session 的 Preset 加工、规则隔离与覆盖顺序、输出膨胀失败。
- Content 与 JSON 两种 CodeAct 传输经过真实 Sandbox 和工具循环；加工结果与被动 Prompt 一致，原文与宏源码未被改写。Gateway 为测试替身，不宣称真实模型表现或 Provider 缓存命中。
- 本轮未执行全仓测试或完整生命周期仿真；第 13 节的工具回放和基线采用缺口不因这 36 项通过而消失。没有前端视觉改动。
- 剩余设计边界：引用展开、Memory 有效范围持久化与采用、历史授权分层。正文宏求值已按上文职责澄清排除，不再作为 Projection 的实施阻塞。当前同分支任意合法范围仍可经工具采样；绑定 Timeline / Branch 不能冒充已经落实第 6.4 节或 CodeAct Plan 的历史访问政策，不能据此宣布整个 Plan 可归档。

## 17. Session 工具历史回放切片（2026-09-24）

**本切片已完成，整个 Plan 仍 In Progress**：修复第 13 节的跨交互工具历史回放，不修改 Memory 范围、总结策略、工具权限或当前 Run 的执行流程。

- Session 投影复用持久 Transcript，保留 Native 调用 / Tool Result、Content 调用 / 返回的完整批次及原参数、正文和结果。编译器仅对 Session 来源承接原生消息载荷，不把工具记录降成普通 system 文本，也不让正则修改工具代码。
- 原有最近 100 条窗口若从批次中间开始，向前补齐至该 Provider Step 的边界；不将 100 条称为 100 轮，也不以此替代后续 Session 总结。
- 未记录结果的调用、没有可恢复 Native 协议的残缺记录作为历史事实说明，明确结果未知，不编造成功回执或自动重试副作用。该说明只属于 Prompt 投影，不回写 Transcript。
- 写集：Session 投影 helper、Prompt 载荷 / 编译器、Agent Turn 接线、历史窗口读取、共用工具结果文本格式与定向测试。
- 验证：磁盘 SQLite 重开后的原生命周期仿真；Native 批量调用、Content 原文、失败 / 拒绝 / 中断、缺失结果、跨页边界、原生块不可被外层 role 改写。相关 Runtime 类型 / 构建检查；Narrative 基线冻结仍保留未通过状态。

### 实际交付与验证

- `agents/session-history.ts` 从已有 Transcript 生成 Session 消息批次；Native 保留 `tool_calls` / `tool_call_id`，Content 重建调用块与结果块。调用批次保持完整，模型复用的 Native Call ID 在历史中做局部消歧，匹配结果同时更新；不修改持久记录。
- Prompt Contribution 可携带 Session 原生消息；编译器不按外层 MessageBlock 重写这些角色，不合并 / 拆散批次。其他来源不能借该字段伪造 Session 原生载荷。普通 Session 文本继续使用现有正则，工具参数、代码、结果不经过文本宏或正则重写。
- 共用 `tool-result-text.ts` 保持当前 Tool Loop 和历史回放的结果文本一致。回放不调用 Registry，不重新批准或执行工具；取消仍由原 Tool Loop 记录，不增加另一套取消路径。
- `readSessionHistory` 以最近 100 条为起点，只向前补齐最早被截断的 Provider Step，不无限扩成完整 Session。该窗口策略不是自动总结，不解决更早工作段被截断的问题。
- 最小验证命令覆盖 `session-history.test.ts`、`default-preset-lifecycle.test.ts`、`compiler.test.ts`、`default-preset.test.ts`、`native-tool-loop.test.ts`：**42 项正常通过，1 项已知预期失败**。Application Runtime build 通过。未运行全仓或真实 Provider 验收。
- 原生命周期仿真现在验证：同 Run 工具调用；第二轮保留先前工具写入；Provider 报错前已提交的正文与工具结果保留；SQLite 重开后第三轮继续回放；新 Session 不继承旧 Session 工具事实；没有因 Preview / 回放增加执行次数。
- 保留限制：历史 Provider 消息由结构化 Transcript 重建，不承诺与当时响应字节完全一致或缓存命中；原生参数的 JSON 空白、Content 包裹及其与普通 assistant 文本的分段不作为归档原始响应。Fresh Context 临时挂载仍未持久回放，Narrative 默认基线仍会每轮更新；它们不是本次测试已证明完成的部分。

## 18. 整体归档核对（2026-09-24）

**结论：不可归档。** 本轮按当前源码核对第 8～9 节，而非把已交付切片当作整个计划完成。继续执行已获授权；涉及尚未确认的默认行为、持久化归属和权限时仍需先收束决策。

| 验收项 | 当前证据与剩余工作 |
| --- | --- |
| 默认骨架与原生消息 | 模板和原生接线已交付；Session 原生工具协议已有定向测试。占位 Anchor 存在不代表对应生命周期已实现。 |
| 共用正文采样与加工 | 已复用范围读取和正则加工，不增加 Narrative State 宏求值。第 21 节已增加宿主区间约束与逐次 Tools 审批；旧历史默认拒绝，审批 UI 接线由 Tools 任务继续。 |
| 默认 Memory + Raw | 第 19 节已接通注册来源，校验明确范围并注入 Memory / Raw。官方默认生产者尚未安装接线；无来源旧路径保留迁移诊断，不是无插件兜底。 |
| Session 工作交接 | 已有持久化 `work-summary`、工作段退出、记事文本携带及重开恢复；保留全部原始 Transcript。自动生成交接文本、触发与确认 UI 尚未完成。 |
| 失败与多 Session | 真实工具 / SQLite 仿真覆盖 32 楼准备、40 楼交接通知发布、41 楼保持范围、新 Session 共用剧情但不继承工作记录，以及发布失败的独立收据；后台自动调度和真实模型效果仍未验证。 |
| 动态 Setting / Notice | 已有激活求值与临时 Fresh Context；状态变化提醒、停用残留、交互快照和临时挂载的跨轮行为尚未整体交付。 |
| 配置宏设置 | 第 20 节已交付候选编辑、显式选择、默认恢复、Timeline + Preset 引用持久化及 Preview / Invoke 共用解析。19 项定向测试通过；没有自动确认弹窗，UI 视觉待用户验收，存档缺少 Card 快照等来源的限制明确保留。 |

下一实施入口是默认有效范围的生产与消费接线。已确认它不归每个 Session 保存，也不由 PromptBuild 猜测。2026-09-24 用户补充：官方记忆插件默认自带且可替换，因此默认范围提供者按基础能力存在来设计；没有安装记忆插件的自动兜底不是本轮前置。不创建独立的无插件基线或 Session 投影快照。

首次归档核对只修正文档中“摘要完成即采用”的过时表述；随后已按用户补充完成第 19 节实现，本表同步更新。第 16～17 节测试记录保留其原验证范围；真实 Provider 缓存效果仍未验证。完整记忆算法继续由独立记忆 Plan 承担，不通过扩大前置任务或删除本表剩余项来宣称可归档。

## 19. 可替换记忆来源接线（2026-09-24）

**目标**：让记忆插件发布的 Memory 与固定 Raw 范围实际进入默认 Prompt；普通正文追加不能扩大该范围。官方专用记忆插件与未来自由文档式记忆使用同一个接收边界，不建立两套投影系统。

已确认：官方插件负责默认能力和自身持久化；自由记忆可以用 Setting 注入记忆锚点，但仅有记忆文本不自动改变 Raw 范围。Agent 主动更新范围属于后续兜底，不是当前实施前置。

最小实施设计：

- SDK 声明只读的默认剧情上下文来源；沿现有扩展注册、能力声明与释放机制接入。来源自行判断是否服务某个 Timeline / Branch；同一分支有多个默认范围来源同时生效时明确报冲突，不按注册顺序抢占。
- Runtime 接收来源版本、记忆条目及其覆盖节点、固定 Raw 起止节点。`null` 明确表示空 Raw，不以省略终点隐式追随最新 Head。来源只返回已采用结果，准备中的摘要保留在插件自身。
- 共用采样器校验分支路径和范围，读取 Raw 后复用现有正则加工；记忆文本进入 `@memory.narrative`，不执行宏或伪造 Session 消息。Preset 仍决定外层 role。
- 接收路径完成后，继续实现同一 Plan 已确认的显式 Session 工作交接与采用通知，不实现摘要算法、自动触发器或跨扩展历史授权。现有未接来源的宿主调用是待迁移旧路径，不把它包装成产品兜底或宣称官方插件已经交付。

写集：SDK / Extension Host 注册接缝、Runtime 来源读取与 Agent Turn 接线、Studio Server 注册桥、定向集成测试及正式合同文档。

主要验证：真实 SQLite 的 1～40 楼，固定前缀、已准备但未采用的摘要、显式发布后的 Memory + Raw、重开数据库与新 Session、错误分支与多来源冲突；扩展卸载后释放来源。Provider 使用测试替身，不把内容一致性等同于真实缓存命中。

### 实际交付

- SDK / Extension Host / Server 注册已贯通，能力名为 `narrative.context.provide`。来源按分支返回已发布 Memory 和 Raw 终点；默认 Memory 声明连续前缀覆盖，Raw 从其后开始。专项任意范围仍走采样接口。
- Runtime 的 `completeAgentSessionHandoff` 及同名 RPC 保存已生成的工作摘要。新增 canonical `work-summary` Entry，不增加表或 Session Narrative 副本；Store 以计数 CAS、安全 Run 状态及完整工具组约束提交。
- 工作段按页读至上次交接，不再丢弃第 100 条以前尚未总结的工具事实。最新交接文本进入 `@memory.session`，旧段只退出 Prompt，原记录不删；旧失败任务不再被 resume 复活。
- 提交交接后通知来源的可选 `onSessionHandoff`。插件只采用已准备结果，未就绪则保持原发布状态；回调失败单独返回 `memoryNotification`，保留 Session 成功收据。不宣称插件写入与 Session 交接是一个原子事务。
- 正式合同见 [默认剧情上下文来源](../../architecture/application/extension/narrative-context.md)。自动运行总结 Agent、次数 / Token 触发、官方插件安装、版本编辑失效和前端确认流程均未由这个 API 自动实现。

### 验证与归档边界

五个定向测试文件：`narrative-context.test.ts`（Runtime）、`session-history.test.ts`、`default-preset-lifecycle.test.ts`、Extension Host 的 `narrative-context.test.ts`、`session-handoff-rpc.test.ts`，共 **19 项正常通过，没有预期失败**。覆盖真实持久化、实际工具循环、共享 / 隔离范围、完整工作段、两步交接与独立失败收据。后续为 Host 增补了采用通知断言，同文件 4 项复跑通过，不重复累加测试数。

Studio Server build（含本次跨包依赖）通过。测试首次定向类型检查发现夹具错误使用了 `documents.get<T>`；已改为真实 Store 调用并在夹具边界标注已知内容类型，五个测试文件的定向类型检查最终为 0 条诊断，相关 Diff 检查通过。没有全仓测试、真实模型或 UI 视觉验收。

**整个 Plan 仍不可归档**。剩余项继续保留在第 18 节；本节交付时未决的宏候选作用域与引用更新策略，已于第 20 节获用户确认并实施，不再用临时 React 状态代替持久配置。

## 20. 配置宏选择持久化（2026-09-24）

第 2.6 节的作品作用域和引用更新策略已获用户确认，继续实施，不再把它列作阻塞。

1. 保留资源 `macros` 的标量默认值，用同资源的 `macroOptions` 保存额外候选的稳定 ID、名称和正文；选项引用不复制正文。
2. DocumentStore 保存每个 `Timeline + Preset` 的选择映射，按版本 CAS 更新。预览与真实调用共用读取；单次显式参数只覆盖当次，不污染持久选择。
3. 用户在现有宏面板明确选择卡 / 预设候选、保留预设或恢复默认；切换自动保存，失败保留当前目标与错误，不偷偷重试冲突。独立卡预览不冒充游玩持久配置。
4. 配置随 Timeline 删除；存档导出 / 恢复保留引用并绑定恢复后的 Timeline，不把 Preset / Card 原文复制到配置记录。缺失来源仍可诊断，不自动重绑定同名资源。
5. 主要验证：真实 SQLite 重开、换 Session / 分支共享与另一局隔离、同预设候选切换、来源失效、预览 / 调用一致、版本冲突、存档恢复；前端目标隔离与保存失败使用现有 Hook 测试。实际视觉由用户验收。

### 实际交付与验证

- Shared 定义候选及结构化引用；Card / Preset 的读取、编辑、复制与导入导出携带 `macroOptions`。既有 `macros` 保持默认文本语义，不迁移或复制长文本进选择记录。未显式选择时使用 Preset 标量默认；没有默认且多候选时继续报冲突。
- 新增 DocumentStore 配置类型与 get / update RPC，校验候选、版本及事务内 Timeline 存在性。删除局或随卡删除游玩数据时清理配置；存档保留引用、恢复后绑定新 Timeline。没有新表、第二套宏存储或新增依赖。
- 前端复用作者宏编辑器和来源面板；持久选择使用 TanStack Query，保存成功才发布新值，取消旧查询再更新对应目标的缓存。读写失败、版本冲突不自动重试，旧 endpoint / Timeline 的异步结果不覆盖新目标。独立 Card 预览仍只保留局部草稿。
- Timeline Preview 与 Invoke 默认从后端读取配置；单次显式入参不污染持久状态。所选候选删除后 Preview 可诊断，正式调用在发送模型请求前拒绝，不偷偷切回默认；恢复默认是显式删除选择。
- 6 个定向测试文件共 **19 项通过**：`macro-configuration.test.ts`、`macro-provider.test.ts`、`macro-selection.test.ts`、`macro-configuration-rpc.test.ts`、`timeline-archive-participant.test.ts`、`state-variables-panel.test.ts`。覆盖真实磁盘 SQLite 重开、跨 Session / Branch 共用、另一 Timeline / Preset 隔离、候选更新 / 删除、临时覆盖、真实 HTTP RPC、存档及并发删除、Query 保存失败与迟到响应隔离。
- Studio Server build（含跨包依赖）、Client TypeScript 检查通过。定向测试类型检查首次因遗漏 Client 的 Vite SCSS 类型声明失败，补入现有 `vite-env.d.ts` 后为 **0 条诊断**；不是业务代码或构建通过后的隐匿错误。未执行全仓、真实模型或浏览器验收。

### 保留边界

- Card 宏候选跟随已有 Timeline Runtime Context 快照，不因编辑全局 Card 自动改变旧局。Preset 候选编辑则由下一次构建读取；不新增快照更新策略。
- 现有 Timeline 存档没有完整保存 Card Runtime Context，也不携带 / 重映射全部 Prompt Resources。本次只保证配置引用往返；恢复的 Card 候选可能缺失，即使全局 Card 仍存在，也不会擅自拿其当前版本代替旧局快照。定向测试证明这种情况会报错且可显式恢复默认，不能据此声称完整资源迁移已经完成。
- 没有新增作品候选自动弹窗、全局默认选择面板或多选宏组合。当前通过来源面板明确选用作品 / 预设候选，符合单值配置的最小交互；UI 视觉与手感仍由用户验收。
- 第 18 节其他 Context 生命周期缺口继续有效，本切片完成不意味着整个 Plan 可以归档。

## 21. Narrative 主动读取权限（2026-09-24）

用户已确认：摘要覆盖 1～32、默认有效 Head 为 40、最新正文为 45 时，被动 Raw 为 33～40；主 Agent 默认可主动读取 33～45。旧正文经 Tools 的显式审批才可读取。不引入四级权限、Session 投影副本或永久授权状态。

- `narrative/sampling.ts`：增加宿主限定区间，固定 Timeline / Branch 与包含式终点、排除式起点；Agent 的节点 ID、count 和续读只能缩小区间。底层无约束采样保留给可信 Runtime，不直接暴露给 Agent。
- `narrative/access.ts` 与 `runtime/agents-runtime.ts`：每次主动读取取得已采用的覆盖边界与当前原始 Head，校验上下文来源；主动读取不推进被动基线。缺失来源明确失败，不用最新历史猜测授权。
- `agents/tool-registry.ts`：沿既有 ToolApprovalHandler 增加有界历史读取 action。原工具获准执行不等于旧历史获准；未配置处理器、拒绝或取消均不返回旧正文，每次越界请求单独审批。
- 不修改 CodeAct 方法、Sandbox 或教程。当前 UI 审批预览仅支持 VFS 修改，历史读取的弹窗适配由 Tools 任务接续；本轮交付真实审批回调与默认拒绝，不能宣称弹窗已完成。
- 验证：真实 SQLite 的 1～45 楼与跨页历史；固定有效 Head、来源更新、上下界与分支隔离、尾部数量裁剪、连续续读、允许 / 拒绝 / 缺处理器 / 取消、主动被动加工一致。仅运行相关定向测试及公共接口类型 / 构建检查。

### 实际接口与交接

- `createNarrativeSampler(store, allowedRange)` 固定宿主范围，参数不属于 Agent 请求；tail 只在授权区间内取最多 N 条，显式越界端点拒绝，返回的续读不跨下界。范围证明使用分页遍历，保留有限正文；后续可由 Store 的索引化区间查询优化，不增加权限缓存。
- `createNarrativeReader({ store, context, timelineId, branchId }).sample(...)` 每次取得已采用的覆盖边界与当前正文 Head。没有默认来源时明确失败；不沿用被动旧路径的最近 100 节点回退。主动补读与被动基线推进相互独立。
- Run 的 `ToolExecutionScope.narrative.sample` 已接有界 reader，原 `view: raw / prompt` 保持不变；CodeAct 接口 / Sandbox / 教程未修改。既有 CodeAct 加工测试补入了明确的模拟记忆来源，不冒充默认官方插件。
- Tool Registry 执行时绑定该工具自己的 `approve`。额外 `action.kind = narrative-history-read` 带目标、固定终点、selection 与预算；未配置 handler 默认拒绝。有 handler 必须检查 action，批准仅对本次读取有效，不能由脚本自带放行函数。取消后不返回旧正文，也不把审批等待期间的新正文算进该次授权。
- 原文 / 正则投影与默认边界读取的调用例、模块责任、错误语义见 [正式消费合同](../../architecture/application/extension/narrative-context.md#消费接口)。现有 `NarrativeContextRegistry.resolve` 已能取得来源边界，没有新增第二套拼接或 Memory 状态。
- Tools 任务仍需把 action 接到现有 Yes/No 交互并处理等待预算；当前 UI 类型只有 VFS 修改预览，不能宣称历史读取弹窗可用。无需新增产品决策或等待完整 Session 生命周期。

### 验证结果

- `narrative-read-access.test.ts`、`narrative-sampling.test.ts`、`narrative-context.test.ts`、`narrative-projection.test.ts`、`codeact-tool-loop.test.ts` 共 **39 项通过**。新用例既验证 Store 区间，也验证 Tool Registry 的实际处理器绑定及 Content / JSON 两种真实 CodeAct Sandbox 工具循环。
- 新生产链夹具最初直接创建底层 Timeline，缺少正式 Runtime 初始化的 State，导致两项用例失败；已改用真实 Card / Timeline 创建入口，复跑正常。不是给生产代码增加默认 State 来掩盖失败。
- Runtime build 在本次代码接线完成时通过；最终定向测试类型检查仍有 **1 条并行修改引入的诊断**：`runtime/transforms-runtime.ts:237` 的新 `previewCardOpeningDisplay` 引用了不存在的 `applicationDocumentTypes.card`。本任务未修改该方法，不把当前工作区类型检查报告为通过。
- 相关 Diff 检查通过。未运行全仓、真实 Provider 或 UI 验收；模拟记忆来源不代表总结算法已交付。读取授权 UI 与等待预算明确交接给 Tools 任务，整个 Context Plan 保持 In Progress。
