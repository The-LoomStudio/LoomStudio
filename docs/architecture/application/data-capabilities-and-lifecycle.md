# 数据能力与生命周期边界

本文从当前存储与消费链说明文本资源、State、宏和运行记录的区别。Card、Preset、Extension 是来源、组织或能力提供者，不是所有数据都必须复制的一组存储作用域。

## 内容与消费

| 当前数据 | 提供的能力 | 权威边界 |
|---|---|---|
| Preset / Lore 文本条目 | 保存正文、树结构、来源与 Capability，参与 PromptBuild | PromptResourceStore |
| State | 保存可校验、可结构化修改的运行数据，供 Agent、Prompt 与 UI 读取 | StateStore；Timeline Head 由 Narrative Branch 持有 |
| VariableSnapshot / 宏 | 将本次构建中的值投影为文本，记录读取与诊断 | 构建时快照，不是另一套持久化存储 |
| Timeline Workspace | 保存 Timeline 共同工作材料；文本、目录和文件元数据整树版本化，二进制引用 Blob | Workspace Store；当前版本由 Narrative Branch 持有，独立于作者 Lore |
| Narrative Node / Agent Transcript | 保存已提交的正文或 Agent 执行记录 | NarrativeStore / AgentStore，二者不互相拥有 |
| Extension Config / Record | 保存 Package-owned 配置与私有记录，按 Scope 和 Binding 查询 | DocumentStore 上的受控 Extension 数据合同 |

这些数据可以被不同消费者组合，但一个消费者需要某份数据，不意味着它拥有该数据。Extension 私有配置不因为由插件生成就进入 State；Preset 读取 State 也不产生一个 Preset State Scope。详细边界见 [State 与变量](state-and-variables.md) 和 [Extension Data](extension/data-and-portable-payload.md)。

## Preset 与 Lore 共用文本能力

Preset Entry 和 Lore Entry 使用同一 Prompt Resource 节点基础。Source Preparation 读取正文、保留来源、合并祖先与自身的启用状态和 Activation，再生成 Prompt Contribution。Preset 同时拥有有序树和 Anchor 排版职责，这不把其 Entry 变成另一种文本存储。

两类 Entry 都可以携带 Activation。当前关键词匹配使用本轮 `userInput`；条件表达式读取独立传入的 `activationFacts`。Activation 在构建时求值，不修改作者持久化的 `enabled` 或原始正文。

正文宏展开与 Activation 是不同操作：前者读取 VariableRenderContext，后者读取 activationFacts。当前 Runtime 没有自动把 Global / Timeline State 投影进 activationFacts，因此“条件可以比较 fact”不等于“State 变化已经能自动触发条目”。这也不是一套持续订阅变量的响应式调度器。

同样，绑定资源只决定来源集合，不保证其中每一条文本都会注入；启用、Activation 和编排继续由消费链决定。

实现入口：

- [Source 采集](../../../packages/application-runtime/src/cards/workspace.ts)
- [Agent Turn 来源集合](../../../packages/application-runtime/src/agents/agent-turn.ts)
- [Activation 求值](../../../packages/application-runtime/src/prompt/prompt-activation.ts)
- [本地 Prompt 编译](../../../packages/application-runtime/src/prompt/prompt-build-pipeline.ts)

## State 的结构化能力

当前 State 使用 JSON Snapshot、Schema、模板初始值和路径 Binding。多个模板可以组装到同一路径，通配 Binding 可以向已物化树中匹配的路径补充内容。这提供了 Entity / Component 风格的状态组织能力，但不是独立 Entity 数据库或自动执行游戏规则的 ECS Scheduler。

State 的区别不是“数字比文本变化快”，而是它有结构化操作、校验、Revision 和 Head 冲突检查。字符串、枚举和集合也能属于模拟状态；低频数据同样可以需要这些保证。相反，一段自由叙事记录不会仅因需要保存就自动成为 State。

当前数据合同仍允许 Global State 保存 `user.name` 等标量。作者静态宏使用 Card / Preset 自身的 `macros` 配置，代码提供者贡献本次构建值；两者共同进入宏候选组装，不建立独立宏资源或 KV 存储。具体生命周期见 [注入与内联展开](prompt-build/injection-and-inline-expansion.md)。

模板装配发生在创建 Timeline 时。运行中的规则执行由调用者发起 State Mutation；当前没有新实体出现时自动重新挂载所有通配模板的机制。Schema、初始值与 Binding 的实现见 [state-definition.ts](../../../packages/application-runtime/src/state/state-definition.ts)，组件装配示例见 [定向测试](../../../tests/unit/application-runtime/state-definition.test.ts)。

State Mutation、补偿回滚及 Global Definition 默认值写入在各自事务成功后通知 Server，由 Server 发布受保护的 `state.changed`。UI、Agent 工具与扩展的普通写入使用同一领域入口；幂等重放不重复通知，事务失败不通知。事件仅含 target、revisionId、changesetId 和路径，不广播完整快照；补偿回滚以空字符串路径表示根变化。初始化、读取和单纯选择分支不由该通知代表。

此事件是当前进程内的提交后提示，不是持久消息队列，不承诺重启补发或跨进程恰好一次。订阅者应按明确 target 重读 State；revisionId 是不透明身份，不可按字典序判断新旧。异步读取的晚响应仍需由消费者按请求代际处理。订阅 target 按字段匹配，路径按祖先/自身/后代重叠匹配，权限使用 `state` 事件能力。观察者异常不能把已提交写入变成失败；当前 Runtime 将其交给配置的 Logger。

## 共享事务不等于相同回滚

Document、Prompt Resource、State、Narrative 等 Store 共享 SQLite Data Engine 的事务、Changeset、提交身份与通知基础。各 Store 仍拥有自己的版本模型和合法修改规则：

| 数据 | 当前历史与恢复语义 |
|---|---|
| Document | 数值版本、Document Revision、乐观并发检查与 Document Changeset revert |
| Prompt Resource | Resource 版本、Header / Node before-after Revision 与专用 revert |
| State | 不可变 Snapshot Revision、Parent、幂等键与 Head CAS；State Undo 生成补偿 Revision |
| Narrative | 不可变 Node 与 Branch Head；Fork 引用既有 Node，当前末尾使用 Branch 最新 State / Workspace Head，历史节点优先使用来源 Branch / Node 恢复点，缺失时才使用节点提交时引用；不是通用对象 revert |

Narrative Node 持久化 `kind: 'user-input' | 'narrative'`，区分用户输入与剧情内容，独立于 Agent Transcript 的 `role` 和节点 `source`。正文输入及 Swipe 输入版本写为 `user-input`；开场白与正文追加默认写为 `narrative`。编辑复制、分支读取、采样与 Timeline 归档保留 kind，UI 不再根据邻居、Run 或 Swipe 状态推断身份。v8 迁移只按 `application.appendNarrativeInput` 提交记录和 Swipe 明确记录的输入节点回填；缺少证据的旧节点及缺少 kind 的旧归档保持默认剧情分类，不根据文本内容猜测。`narrative` 表达内容用途，不保证其作者一定是 AI。

Timeline UI 正文编辑属于当前分支：以开始编辑时的 Branch Head 和原正文作为并发基线，在同一 Changeset 中复制目标节点至末节点的路径，仅替换目标正文，并切换该分支 Head。后续正文、节点 State Revision、分支 State Head 和来源信息保持不变；其他分支继续引用原路径。不触发回滚、生成或 State 重算。被替换路径使用新节点 ID，普通历史编辑保留原 ID 用于历史引用。唯一例外是仍开放且只有单个节点的初始化开场：同步更新 opening.nodeId、标记 custom 并保留作者候选 id，删除旧开场节点，使编辑后的自编开场仍可替换；已关闭窗口不重新打开。

归档恢复按节点父链与分支记录分别恢复拓扑。`forkedFromNodeId` 是历史分叉来源，不保证仍处于父分支当前路径；正文编辑保留下来的历史节点允许一同归档。UI 保存失败保留草稿，分支 Head 或原文变化时拒绝旧保存，不自动强制覆盖。

Changeset 是提交事实，不是能够恢复任意领域对象的完整快照。跨 Store 的原子提交需要领域流程显式组合；共享 Changeset ID 不能代替各 Store 的恢复数据和冲突检查。基础合同见 [Data Architecture](../data/README.md)。

## 来源、引用与运行归属

以下机制在当前系统中不同，不能用“绑定后生命周期一致”概括：

- Card 模板在创建 Timeline 时物化为初始 State；Schema 等运行依赖写入 Timeline Runtime Context。后续 Card 模板修改不重写既有 Timeline State。
- Timeline 创建时保存的 Prompt Resource ID 列表仍可作为历史记录；后续 Agent Turn 以关联 Card 的当前 Prompt Resource IDs 加全局 Mount 读取 Lore，不再由创建时清单决定当前注入。移除挂载或删除资源后不回退旧清单；主 Preset 缺失仍明确失败，可选 Lore 缺失保留诊断。
- Card 作者宏、规则/提取器与脚本 Mount 同样读取当前定义，不再从 Timeline Runtime Context 的旧动态资源快照恢复。State 约束与既有 Revision 保持原生命周期，不因更新作者资源自动重置。
- Opening 在创建时渲染并保存成 Narrative Node；初始化窗口内可显式替换整套开场正文，按当前 Branch State 渲染作者候选，但不重新物化 State。初始化开场编辑后转为自编并保留窗口；首条用户故事输入落盘、正文路径被追加或分支化后关闭窗口。Branch Fork 保留既有 Node，而不是重新渲染来源 Card 的 Opening。持久化与归档边界见 [Narrative 合同](../data/README.md)。
- Extension Record 的绑定目标不等于其存储 Scope，也不意味着绑定对象的所有行为自动传播给 Record。

因此，Timeline Fork 当前不能解释为“所有引用文本、State、Extension 数据一起获得完整的历史快照”。删除拥有者、删除来源、解除引用、切换消费者和回退 Branch 也不是同一个操作。

## 当前能力边界

Timeline 文件由 Workspace Store 权威保存，版本与恢复合同见下文。Agent 通过受控领域工具与 CodeAct 入口访问这些数据；这不授予任意宿主文件访问能力，具体能力以[工具系统](agent/tool-system.md)及各领域 API 为准。

Session 已能显式持久化 `work-summary` 并用它建立后续工作段，不应继续笼统描述为“没有 Summary 存储”。Session 自我整理已接通临时工具、来源校验、缓冲与安全采用；它不等于完整的 Narrative Memory 整理或后台任务跨进程恢复。已实现的交接及来源边界见[Agent Runtime](agent/runtime-and-session.md)；Session 历史仍不能直接当作 Timeline 文件。

运行文本、记忆、作者宏和跨类型版本协调的历史原则保留在 [数据能力与运行内容旧稿](../../archive/discussion/application/data-capabilities-and-runtime-content.md)，后续合同以 [Plan](../../workbench/plans/README.md) 为准，不以新建通用 Data / Binding / Lifecycle Manager 的方式提前实现。

## Timeline Workspace 与稳定楼号

每条 Timeline 初始化一个共享 `MEMORY.md`。Workspace 的文本和树结构保存在共享 SQLite 的不可变版本中，二进制复用 Blob Store；新版本与 Branch 引用更新参与同一 Data Engine 事务。读写使用 Timeline/Branch 与预期版本，不接受模型指定的任意 Blob ID。Agent 经已有来源守卫访问 `/workspace`；保存脚本文本不执行脚本、不扩大权限。当前 CodeAct 处理文本及结构操作，二进制字节由宿主 Runtime 读写；文件被动注入消费尚未接入。

正文节点记录提交时的 Workspace 版本；推进到下一节点前，另外记录原末尾最终的 State/Workspace 恢复点。Swipe、重试、失败恢复采用候选或基线的三类引用。历史分支复制已有恢复点，Timeline Archive 携带工作树历史和所引用的二进制字节。删除 Timeline 后公共读写入口不可访问其工作树，历史版本和 Blob 随既有保留策略保留，不做孤立清理。

`NarrativeNode.floor` 是路径内的持久位置，从 1 开始；新节点沿父节点加一，编辑复制和分支保持原值，存档允许保留缺号。楼号不是跨分支的身份；按楼号读取先固定实际节点，再应用原有范围授权和预算。采样返回 `floor` 以及 `missingFloors`，原 `position` 仍是返回窗口序号。旧数据库按既有祖先路径补号，旧存档缺少楼号时同样补齐；不重编号已有持久楼号。
