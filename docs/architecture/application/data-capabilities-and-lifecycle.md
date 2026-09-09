# 数据能力与生命周期边界

本文从当前存储与消费链说明文本资源、State、宏和运行记录的区别。Card、Preset、Extension 是来源、组织或能力提供者，不是所有数据都必须复制的一组存储作用域。

## 内容与消费

| 当前数据 | 提供的能力 | 权威边界 |
|---|---|---|
| Preset / Setting 文本条目 | 保存正文、树结构、来源与 Capability，参与 PromptBuild | PromptResourceStore |
| State | 保存可校验、可结构化修改的运行数据，供 Agent、Prompt 与 UI 读取 | StateStore；Timeline Head 由 Narrative Branch 持有 |
| VariableSnapshot / 宏 | 将本次构建中的值投影为文本，记录读取与诊断 | 构建时快照，不是另一套持久化存储 |
| Narrative Node / Agent Transcript | 保存已提交的正文或 Agent 执行记录 | NarrativeStore / AgentStore，二者不互相拥有 |
| Extension Config / Record | 保存 Package-owned 配置与私有记录，按 Scope 和 Binding 查询 | DocumentStore 上的受控 Extension 数据合同 |

这些数据可以被不同消费者组合，但一个消费者需要某份数据，不意味着它拥有该数据。Extension 私有配置不因为由插件生成就进入 State；Preset 读取 State 也不产生一个 Preset State Scope。详细边界见 [State 与变量](state-and-variables.md) 和 [Extension Data](extension/data-and-portable-payload.md)。

## Preset 与 Setting 共用文本能力

Preset Entry 和 Setting Entry 使用同一 Prompt Resource 节点基础。Source Preparation 读取正文、保留来源、合并祖先与自身的启用状态和 Activation，再生成 Prompt Contribution。Preset 同时拥有有序树和 Anchor 排版职责，这不把其 Entry 变成另一种文本存储。

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

## 共享事务不等于相同回滚

Document、Prompt Resource、State、Narrative 等 Store 共享 SQLite Data Engine 的事务、Changeset、提交身份与通知基础。各 Store 仍拥有自己的版本模型和合法修改规则：

| 数据 | 当前历史与恢复语义 |
|---|---|
| Document | 数值版本、Document Revision、乐观并发检查与 Document Changeset revert |
| Prompt Resource | Resource 版本、Header / Node before-after Revision 与专用 revert |
| State | 不可变 Snapshot Revision、Parent、幂等键与 Head CAS；State Undo 生成补偿 Revision |
| Narrative | 不可变 Node 与 Branch Head；Fork 引用既有 Node 和对应 State Revision，不是通用对象 revert |

Changeset 是提交事实，不是能够恢复任意领域对象的完整快照。跨 Store 的原子提交需要领域流程显式组合；共享 Changeset ID 不能代替各 Store 的恢复数据和冲突检查。基础合同见 [Data Architecture](../data/README.md)。

## 来源、引用与运行归属

以下机制在当前系统中不同，不能用“绑定后生命周期一致”概括：

- Card 模板在创建 Timeline 时物化为初始 State；Schema 等运行依赖写入 Timeline Runtime Context。后续 Card 模板修改不重写既有 Timeline State。
- Timeline 保存 Prompt Resource ID 列表；后续 Agent Turn 按 ID 读取当前资源。它没有同时冻结这些资源的正文版本。
- Opening 在创建时渲染并保存成 Narrative Node；Branch Fork 保留既有 Node，而不是重新渲染来源 Card 的 Opening。
- Extension Record 的绑定目标不等于其存储 Scope，也不意味着绑定对象的所有行为自动传播给 Record。

因此，Timeline Fork 当前不能解释为“所有引用文本、State、Extension 数据一起获得完整的历史快照”。删除拥有者、删除来源、解除引用、切换消费者和回退 Branch 也不是同一个操作。

## 当前能力边界

当前没有独立的 Timeline 文件权威模型、通用 Agent 虚拟文件写入合同或已落地的 Memory / Summary 存储机制。复用文本能力不等于这些生命周期已经存在，也不能把 Agent Session 的历史记录直接当成 Timeline 文件。

运行文本、记忆、作者宏和跨类型版本协调的后续原则保留在 [数据能力与运行内容讨论](../../workbench/discussion/application/data-capabilities-and-runtime-content.md)，不以新建通用 Data / Binding / Lifecycle Manager 的方式提前实现。
