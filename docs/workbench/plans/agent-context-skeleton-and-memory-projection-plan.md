# Agent 上下文骨架、投影与 Session 生命周期计划

> **状态**：In Progress / 骨架已接线，生命周期未验收
> **主题**：Agent Prompt 的默认动态骨架、Narrative / Agent Session 记忆投影、被动上下文与实时工作区边界。
> **范围**：先收束跨 PromptBuild、Agent Runtime、Narrative Timeline 和记忆扩展的上下文合同，再拆分可实施切片。
> **当前阶段**：默认骨架与原生输入接线已实施；完整记忆系统、生命周期与 Provider 缓存验证仍未完成。
> **更新**：2026-09-17，补充共用采样能力的调研与边界。本文是讨论承载稿，不因补写 Plan 自动启动代码实施；默认 Anchor、生命周期和记忆合同仍待逐项收束。
> **决策补充**：2026-09-20，确认 Anchor 负责独立注入，配置宏负责候选选择和局部文本替换；本轮不为 Anchor 增加通用替换机制。设置分工见 2.5～2.6；骨架仍为待讨论候选。
> **实施切片**：2026-09-21，用户授权默认 JSON 骨架及原生输入接线，见第 12 节；其他开放设计不随本切片自动实施。
> **生命周期验收**：2026-09-21，补充多轮仿真后确认两条目标合同仍失败，见第 13 节。第 12 节的接线完成不代表完整生命周期正确。
> **职责拆分**：2026-09-21，记忆策略移至[剧情记忆与统一刷新策略计划](./narrative-memory-and-refresh-policy-plan.md)。本 Plan 保留投影、Session 生命周期和统一刷新执行；后述“两种记忆”指内容职责，不再指两套独立自动总结触发器。保留原文件名以避免破坏已有链接。
> **投影责任修正**：2026-09-21，确认当前不为 Agent Session 保存 Narrative 投影快照；Memory 指针与消费者采样参数由 Memory / Sampling 侧管理，PromptBuild 只消费贡献。后续三个生命周期问题见第 15 节。

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

“全局性”指宏可作为共享的配置引用方式，并可提供全局默认选择；不意味着所有角色卡写入同一个可变 KV。当前作品的选择不能污染另一个作品。全局默认的持久化位置、作品选择应归 Timeline 还是 Session，以及来源版本变化后何时重新确认，仍待设置生命周期讨论，不在本节假定新增配置层或存储表。

现有基础：[宏消费合同](../../architecture/application/prompt-build/injection-and-inline-expansion.md) 已有多来源候选、`macroSelections` 和来源检查；[当前解析器](../../../packages/application-runtime/src/prompt/macro-provider-registry.ts) 不按加载顺序覆盖。预设内多个候选选项、作品覆盖确认与选择持久化尚未作为本计划交付，实施时需复用已有能力并核对差异。

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

剧情记忆与工作记事板保留不同语义，但采用一个统一的上下文刷新动作；不再分别设定 Narrative / Session 两套独立总结触发器：

| 投影 | 内容 | 典型范围 |
| --- | --- | --- |
| Narrative Memory | 剧情、实体、事件、关系 | 1~90、某个分支、某个记忆锚点前 |
| 工作记事板 | Agent 主动保存的目标、决定、计划、待办与必要工作事实 | 当前 Session 的已保存记事内容，不另建多级摘要 |

### 5.1 缓冲区与采用时点

Narrative 新节点立即持久化，但不必立即进入 Prompt 前方的 Narrative 基线。

默认写作流程由统一刷新动作按需请求剧情总结并清理会话。常规按剧情次数触发；未达剧情条件的预算兜底只清理工作会话，不自动生成剧情摘要或推进覆盖范围。具体策略由独立记忆 Plan 定义。

本 Plan 负责安全交互边界、工作交接与 Prompt 输入段的重建。这里不再定义独立的 Session Narrative 快照或长期 `RefreshState`。剧情总结完成后，Memory 侧推进有效指针；下一次 PromptBuild 重新消费新的摘要与 Raw 范围。若同时进行 Session 历史压缩，那只是同一次上下文整理中的另一项输出。

已确认：剧情总结采用时，Session 无论长短都完成工作交接与工作段重建；不逐条挖掉旧正文工具记录再拼接剩余历史。记事板、当前未完成任务和新的 Narrative 投影接替旧工作段；原始 Transcript 保留。仅清理 Session 时不必总结剧情，其未总结正文的携带规则需单独明确。摘要失败时继续使用旧的 Prompt 输入组合，不先清理旧会话。一次需要剧情总结的上下文整理示例：

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
| 分支读取 | `getPage` 接收分支、节点游标与数量，沿父链读取并校验游标归属；没有完整起止范围、缓冲边界和楼层定位合同 | [Narrative Store](../../../packages/application-data/src/narrative/store.ts) |
| Agent 输入准备 | `prepareAgentTurn` 固定读取最近 100 个 Narrative 节点；未接收本次采样范围 | [Agents Runtime](../../../packages/application-runtime/src/runtime/agents-runtime.ts) |
| 历史投影入口 | `readRuntimeHistoryEntries` 收集分支全部分页；`projectHistory` 未提供范围参数 | [Transforms Runtime](../../../packages/application-runtime/src/runtime/transforms-runtime.ts) |
| 正文加工 | `projectHistoryEntries` 已提供正则、phase、规则顺序、来源和变换记录；depth 相对传入窗口计算，不是绝对楼层 | [History Text](../../../packages/application-runtime/src/transforms/history-text.ts) |
| 消费者耦合 | Narrative 的 prompt 向规则解析要求 `consumerAgentSessionId`，借 Session 解析 Profile / Preset；单次调用不能自然复用这条完整入口 | [规则解析](../../../packages/application-runtime/src/runtime/transforms-runtime.ts) |
| Anchor 注入 | `composeAgentTurnPrompt` 将加工后的 Narrative 转为 Contribution，挂到 `@chat.narrative` | [Agent Turn](../../../packages/application-runtime/src/agents/agent-turn.ts) |
| 单次调用 | 扩展已有受能力声明约束的 `ctx.ai.invoke`，不要求创建 Agent Session；不等同于已经支持无 Session 的完整 Preset 构建 | [Extension Host](../../../packages/extension-sdk/extension-host/src/instance.ts) |
| Token 基础 | Gateway 返回 Provider usage；本轮检查的构建与历史加工路径未发现可复用的发送前模型 Token 估算能力，文本预算目前为字符数 / 条目数 | [Gateway](../../../packages/ai-gateway/src/gateway.ts)、[Token 讨论](../discussion/application/prompt/token-estimation-and-audit-v0.md) |

上述结论来自静态源码读取，不是运行、顺序正确性或性能验收。

### 6.3 最小请求与结果候选

先收束三种请求，不提前设计通用策略引擎：

1. 使用分支的默认正文范围。
2. 明确指定节点起止边界，并定义包含 / 不包含语义。
3. 从选定 Head 向前读取最近 N 个剧情节点，同时返回近期窗口之前的边界。

结果应保留实际节点 ID、分支与读取依据的 Head、实际起止范围，以及是否仍有未返回内容。窗口位置与路径上的楼层位置需要区分；分页和预算不得静默伪装成完整读取。

先选节点，再按显式选择执行 prompt 向文本加工。原文读取不默认套用写剧情时的全部规则；加工结果保留来源与规则信息，不改原始正文。现有 depth 的参考窗口以及楼层计数定义仍需确认。

采样和加工应能服务有 Session 的 Agent，也能服务无 Session 的单次调用。需要收束规则解析所需的最小消费者信息，不能为了找到 Preset 规则强行创建 Session，也不自动把 Profile 变成新的策略配置中心。

### 6.4 默认范围与插件状态

默认剧情消费读取记忆贡献与当前有效正文；专项采样可以显式读取默认范围以外的历史，但不因此绕过权限。默认不注入不等于 UI 隐藏、禁止读取或删除。不同消费者的临时范围参数不写入 Agent Session；若未来某个长任务必须固定视图，应由该任务类型单独声明持久化需求。

记忆插件保存自己的摘要、处理进度和**默认有效 Head**；Memory / Sampling 侧据此准备主 Agent 默认有效范围。Timeline 的原始 Head 每次写入都会推进，但不等于默认有效 Head 被推进。专项消费者传临时参数，不要求逐节点增加 `is_hidden`，不新增 Session Narrative 快照。

因此，只有总结插件完成一轮总结并推进默认有效 Head 时，新的 Raw 节点才会进入默认 `@chat.narrative` 投影。有效 Head 未变化期间，新写入只会通过当前 Agent Session 的 Tool Call / Tool Result 历史存在，不会自动进入前方 Narrative 区。Memory / Sampling 必须区分原始 Timeline Head 与默认有效 Head；不能每轮用最新原始 Head 代替有效 Head。

分支归属、范围更新权限以及摘要可用性与范围推进的一致性仍待确认。Timeline Head 是原始数据头，不因总结移动；Memory 插件推进自己的 `coveredThroughNodeId` 或等价指针。修改有效范围不自动改写已经发出的 Provider 请求，下一次 PromptBuild 才消费新组合。

现有 Extension Record 已能绑定 Narrative 节点，不新增任意节点 Metadata 存储来重复承载插件指针。指针删除、分支继承、存档 ID 映射和内容编辑后的摘要失效需基于真实领域合同处理，不静默移动指针或假设节点 ID 等于内容版本。

### 6.5 范围与预算分工

剧情次数决定常规整理节奏，Token 预算负责容量警戒，不以“Token 少”阻止短对话到点总结。节点边界决定实际读取范围，近期剧情数量表达缓冲距离。不能把字符数称为 Token 数，也不能把 Provider 整次 usage 当作各个节点的精确成本。

范围读取可先独立定义；自动 Token 阈值与裁剪的实施需补齐估算基准，并区分原文估算、加工后输入估算和 Provider 实际 usage。记忆算法、摘要版本选择及完成后的指针推进不属于采样器。

## 7. 非目标

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
   - 解除 prompt 向加工对持久 Agent Session 的不必要依赖；
   - 服务被动 Prompt 输入和 CodeAct 主动读取，不重复实现采样器；
   - 确认分支、节点边界、顺序、加工规则与预算报告。

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

### 仍失败的目标合同

1. **跨交互 / 重启的工具历史回放**：已持久化的 Native 调用与结果、Content 调用与结果没有进入下一轮 Session Prompt；故障前已经提交的工具行动也会缺少工作记录。
2. **Narrative 基线采用时点**：没有显式总结或基线重建，新一轮 Invoke 就重新读取最新窗口，把刚写入正文移入前方 Narrative 块。当前仅 Run 内前缀固定，不满足之前约定的跨交互冻结基线。

这两项使用显式 `it.fails('KNOWN GAP: ...')` 保存目标断言。它们是已复现的缺口，不是正常功能通过；修复后必须移除预期失败标记并按普通测试验收。它们需要后续 Session 投影 / 生命周期切片，不能用只调整测试预期掩盖。

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

以 1～40 楼、保留 8 楼为例：第 32 楼结束时只是准备点，Memory 开始总结 1～32，Prompt 不变；33～40 楼继续通过 Tool Call / Tool Result 存在。第 40 楼当前工作流结束且摘要、Setting 变更、Scratchpad 和未完成任务都准备好后，才进入采用点：推进默认有效 Head、注入 Memory 与 33～40 Raw，并从下一次 Prompt 隐藏旧工作段。准备失败时不得先隐藏 Tool 历史。

不能把旧工作段中的单条 Tool Call 或 Result 拆开删除。至少要以完整交互组、已完成 Run 或明确的 Session 工作边界为单位退出 Prompt。跨 Run 的 Tool Call / Result 回放必须有明确的事实投影规则；当前实现仍未完成。

Session 单独因为容量压力整理时，不自动推进 Memory 指针。此时它只能：

1. 保存或更新 Scratchpad；
2. 移除已经不承担当前工作的旧工作段；
3. 不推进剧情摘要覆盖范围，保留未总结正文；若正文只存在于即将退出的写工具调用中，必须先确定它在新 Prompt 中的载体，不能仅凭“仍用旧 Raw”就删掉它；
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

1. 达到剧情次数：准备剧情摘要与 Session 工作交接；例如第 32 楼开始准备，第 40 楼工作流结束后，两者均可用才推进默认有效 Head，并让旧工作段退出，不先推进再尝试交接。
2. Session 工作内容过长但剧情未达条件：只请求 Session 整理，不推进 Memory 指针。
3. Prompt 容量达到警戒线而剧情未达条件：只整理 Session；若仍无法容纳，按已确认规则暂停，不把“强制提前总结正文”作为隐式备用策略。
4. 当前存在未完成 Tool 组：不在组内执行整理；等待完成、失败或显式中断边界。
5. Memory 摘要生成失败：继续使用旧 Memory 贡献和旧 Raw 范围；不能先把旧正文从 Prompt 中删除。

这里仍有三个合同缺口：

- 预算估算由 Runtime、Gateway 还是 Provider Adapter 提供；
- “Session 工作内容过长”使用消息数、工具组数、字符数还是估算 Token；
- PromptBuild 如何报告贡献范围和估算成本，让 Runtime 知道清理后是否真的可发送。

本节不把字符数、Token 和剧情楼层混成一个指标。楼层 / 交互次数表达剧情整理节奏；预算表达能否继续发送；Session 工作段规模表达是否需要工作交接。
