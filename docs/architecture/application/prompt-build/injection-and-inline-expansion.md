# 注入与内联展开

本文区分 PromptBuild 的两种内容接入方式：通过 Anchor / Slot 编排独立 Contribution，以及通过宏在已有正文中展开值。它们描述内容如何进入提示词，不决定内容必须存在哪里，也不构成两种新的存储系统。

## 两种方式

| 维度 | Anchor / Slot 注入 | 宏内联展开 |
|---|---|---|
| 位置由谁提供 | 预设有序树中的 Anchor | 宿主正文中的宏引用位置 |
| 消费对象 | 带来源与 Capability 的 Prompt Contribution | 本次 VariableSnapshot 中解析出的标量值 |
| 内容数量 | 一个 Anchor 可以组织多份独立贡献 | 每次宏引用展开为一个确定的文本结果 |
| 编排身份 | 贡献保留来源、激活和排序信息 | 展开文本成为宿主正文的一部分，不产生独立节点 |
| 典型用途 | 独立启停或排序的角色文风、Setting、历史上下文等内容块 | 用户名、状态字段、宿主中的可替换字句或整段文本 |

区分依据是独立编排需求，不是文本长度。字符串宏可以展开一整段文字，但它不会因此获得自己的 Anchor、Activation 或独立排序位置。Anchor 也不限于世界书，只要内容以 Contribution 进入对应来源集合，就由其编排合同处理。

宏读取可以保留自己的读取 Trace；“不产生独立节点”不等于完全失去数据来源信息。

## Anchor / Slot 的消费边界

预设提供物理树顺序和 Anchor 位置，外部贡献按目标 Anchor 挂载，并在对应范围内组织和排序。资源属于当前来源集合，不等于其中所有条目都已激活；启用配置和 Activation 仍参与本次构建。

Contribution 的原始数据可能来自角色、Setting 或运行记录。注入不转移源数据所有权，不修改源文本，也不自动改变其存储生命周期。多个贡献进入同一 Anchor 是组合行为，不等同于多个值争抢同一个宏名。

## 宏的消费边界

后端 Source Preparation 对正文执行宏展开。`VariableSnapshot` 提供 Global、可选 Timeline、computed 与 aliases；解析器读取值、记录路径及诊断，再把标量转换成文本。

- 宏不承担赋值或 State Mutation；展开输出不递归执行其中的宏。
- 对象不是隐式 JSON 文本；当前非标量读取产生诊断，不自动展开整个实体。
- 展开结果跟随宿主贡献参与编排，不把被读取对象的 Metadata、Activation 或 Placement 一并导入。
- 内建别名和 Global / Timeline 路径保留；Card、Preset 与代码提供者的公共名按大小写不敏感规则收集候选。同名多来源不按加载顺序覆盖：有显式 `macroSelections` 时选对应来源 / 候选，否则优先使用 Preset 的标量默认值；没有预设默认时，单候选可直接解析，多候选仍是冲突。Card 不因载入而自动覆盖 Preset。
- Card 的 `macros` 使用现有文档配置与版本 CAS；已有 Timeline 的检查与构建读取关联 Card 的当前配置，不从 Runtime Context 的旧快照恢复。Preset 的 `macros` 存于 PromptResource metadata，并由 mapper 暴露；两种资源可另用 `macroOptions` 声明同名候选数组，每个候选包含稳定 `id`、`label` 与 `value`。资源复制、导入和导出携带这些作者内容，不建立独立宏正文 KV Store。
- Server Extension 声明 `macros.provide` 后，通过 `ctx.macros.register({id,name,resolve})` 注册提供者。Host 约束包名前缀并托管注销；构建收集提供者并各求值一次，传入复制并冻结的只读数据上下文，字符串结果进入本次 computed，不写回 State。

State 可以通过路径宏被读取，但不会因为存在于 Snapshot 中就自动全量进入提示词，也不会自动拥有一个预设 Anchor。若需要筛选、格式化并独立编排一份状态视图，应由领域消费代码产出 Contribution；纯文本结果也可以作为宏值使用。这不授权在投影期间修改 State。

`application.inspectMacros` 生成当前预览；Preview / Invoke 返回实际构建使用的 `macroInspection`。检查包含快照、来源候选、选中来源、结果与诊断，不能把重新求值的预览冒充上一次构建。Client 与 Runtime 使用同一纯解析实现，浏览器从 `@loom-studio/shared/macros` 引入，避免加载 Node 专用入口。

作者工作台以目录条目编辑默认值与额外候选，运行检查展示有效值、来源与候选选择。Server Extension 仍是受信代码；上述只读上下文不是任意脚本沙箱。基础解析的执行记录见 [宏动态值与来源检查 Plan](../../../archive/plans/macro-value-provider-and-inspector-plan.md)，持久选择交付见 [Context Plan 第 20 节](../../../workbench/plans/agent-context-skeleton-and-memory-projection-plan.md#20-配置宏选择持久化2026-09-24)。

### 作品选择的持久化

- 作用域为 `Timeline + Preset`，同一局的不同 Session / Branch 共用，其他 Timeline 独立。DocumentStore 每组合一份 `airp.timelinePresetConfig` 文档，保存宏名到 `{ sourceId, optionId? }` 的引用，不复制候选正文，也不写入剧情 State 或作者资源。
- `application.getTimelinePresetConfig` 返回当前配置与版本；未保存时为版本 0。`application.updateTimelinePresetConfig` 校验来源与候选、使用 `expectedVersion` CAS，并在事务内重新确认 Timeline 存在。删除 Timeline 时一起删除配置。
- 宏面板选择即保存，失败保留已提交选择并显示错误，不自动重试写入。前端服务端缓存归 TanStack Query，按 endpoint / Timeline / Preset 隔离。恢复默认删除该宏的显式引用，不把默认正文复制进配置。
- Timeline Preview 与 Invoke 未传 `macroSelections` 时读取同一持久配置；显式传入的映射只用于本次构建，`{}` 表示本次使用默认解析。独立 Card 预览仍是临时选择，不冒充一局游戏的持久配置。既有单字符串 source ID 入参继续接受，持久写入规范化为结构化引用。
- 正常候选编辑沿用同一引用，下一次构建读取新值；已开始的 Run 不因此重新构建前缀。Card 来源同样读取当前值；移除已选候选后显式报告失效，不回退到旧值或其他来源，不修改已有 State。
- 所选来源 / 候选消失或求值失败时，Preview 保留 token 并报告错误；正式 Invoke 拒绝带失效显式选择的请求，不静默改选 Preset、其他来源或 State。没有明确选择的普通宏冲突继续保留原有诊断语义。

Timeline 存档保存选择引用，恢复时只改为新 Timeline ID，保留 Preset / source / option ID，不猜测同名资源映射。**这不是完整的资源迁移**：现有 Timeline 归档导入不会自动重新绑定来源 Card，也不打包所有 Prompt Resources。因此即使配置引用恢复成功，Card 来源或外部资源仍可能缺失；此时明确报错，用户可重新配置或恢复默认，不静默降级。跨工作区资源打包与引用重映射不在本轮交付范围。

## Agent 主动读取的交界

主动检索与读取回答“Agent 何时、通过什么工具获得信息”；Anchor 和宏回答“构建时怎样放置或展开内容”。二者不是同一个分类维度。

Agent ToolResult 由 Agent Runtime 按工具传输协议交给后续 Provider Step，不要求所有主动读取都伪装成宏或重新走 Anchor。当前 `read_context` 还可以请求非持久化 Fresh Context Mount，由 Runtime 在下一次 Provider Step 使用；它不等于把原条目改成常驻，也不写回作者资源。

因此本文只记录这条交界，不将 Agent 主动读取列为第三种 PromptBuild 注入语法。检索权限、工具调用、结果持久化和跨 Step 保留属于 [Agent Runtime](../agent/runtime-and-session.md) 与 [Tool System](../agent/tool-system.md)。

持续 Pin / Unpin 和独立固定区仍是 [Agent 数据交互讨论](../../../workbench/discussion/application/agent/tool-data-view-interaction-v0.md) 中的待实施语义，不是当前 Fresh Context 的保证。后续若将固定内容编排进提示词，放置行为再遵循 PromptBuild 合同，而不是由 Pin 改写原条目的 Placement。

## 实现与相关边界

- [正文采集与宏展开](../../../../packages/application-runtime/src/cards/workspace.ts)
- [宏取值与诊断](../../../../packages/application-runtime/src/prompt/variables.ts)
- [共享纯解析](../../../../packages/shared/src/macros.ts)
- [提供者与来源组装](../../../../packages/application-runtime/src/prompt/macro-provider-registry.ts)
- [Contribution 编译与排序](../../../../packages/application-runtime/src/prompt/prompt-build-pipeline.ts)
- [数据能力与生命周期](../data-capabilities-and-lifecycle.md)
- [State 与变量](../state-and-variables.md)
