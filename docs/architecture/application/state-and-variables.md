# State 与变量架构

> **状态**：State v1 核心运行链已实现并晋升。独立 State Artifact 资源管理与运行态软引用检查由 [State 资源与引用检查后续](../../workbench/issues/state-resource-and-reference-follow-ups.md) 跟踪，不阻塞当前合同。

Loom Studio 当前的 State 只区分两个持久化 Scope：Workspace Global State 与 Narrative Timeline State。这不是整个系统所有数据的 Scope 列表。两者共享 `@loom-studio/state-store` 的 Scope / immutable Revision / Snapshot 合同；Timeline 的当前 Head 由 Narrative Branch 持有，Global Head 由 State Scope 持有。

State 提供结构化运行数据、Schema 校验与可追溯修改，不是全部可变文本的统一容器。Application 层已经定义 Entity Type、显式 Entity、Component Definition、精确 / Entity Type 批量 Mount 与软引用；它们在创建 Timeline 时编译为普通 JSON Snapshot，不形成第二个 Entity Store，也不包含自动游戏规则调度。文本资源、宏和 Extension 私有记录的区别见 [数据能力与生命周期边界](data-capabilities-and-lifecycle.md)。

变量不是第二套存储。Prompt Build 在一次构建开始时冻结 Global、可选 Timeline 与 computed 值，形成 `VariableSnapshot`。`{{User}}` 只是 `global.user.name` 的内置别名；`{{global.*}}` 与 `{{timeline.*}}` 只展开标量，不递归执行，也不承担赋值或结构化 Prompt 注入。

Card / Preset 静态宏配置与 Extension 提供者进入同一来源候选组装；State 原值仍由 State Mutation 修改，宏检查不创建或写回 State。作者配置、当前宏预览和实际构建快照分别呈现，合同见 [注入与内联展开](prompt-build/injection-and-inline-expansion.md)。

## 权威与事务

- `state_scopes` 保存 Scope identity、owner 与 Global Head；
- `state_revisions` 保存 Parent、Operations、Changeset 与幂等键；初始化和周期 checkpoint 保存完整 Snapshot，普通 Revision 保存内部 delta。读取 API 始终物化并返回完整 JSON；
- `narrative_branches.state_head_revision_id` 保存各世界线当前 State；
- `narrative_nodes.state_revision_id` 保存该正文节点对应的 State Revision；
- Card 可通过 `stateTemplates` 携带内联组件模板，或通过 `stateDefinitionIds` 引用共享 Definition；`stateEntityTypes`、`timelineStateEntities` 与 `timelineComponentMounts` 描述 EC 初始化，`timelineStateBindings` 只保留为高级原始路径与旧卡兼容入口。同 ID 时内联模板优先，修改内联模板不会写回共享 Definition。

创建 Timeline 时，Card 内联 Contribution 与 `stateContributionIds` 显式选择的 Extension Contribution 先确定性组合。重名 Entity Type、Template、Entity 或最终组件路径会失败，不存在隐式覆盖顺序。组合结果物化为初始 Snapshot，并把 Entity / Component / Reference 元数据、Extension Package 版本、Schema、User 名字回退与 Card-owned Text Transform Rule 固化为 Timeline Runtime Context；随后在同一个 Data Engine transaction 中创建 Runtime Context、State Scope、Initial Revision、Timeline、Primary Branch 与 Opening Nodes。Extension 后续卸载或重载不会改写已有 Timeline。

## Definition 与 Artifact

`airp.stateDefinition` 是 Global Definition / Timeline Template 的共享 Document。Global Definition 可约束 canonical path、Schema、默认值和只读性；Timeline Template 保存 templateVersion、Schema 与 initial object。当前 Schema 只实现已用到的 JSON Schema 子集，不提供继承、Mixin 或自动迁移。

规范交换容器为 `kind: "loom.state"`、`schemaVersion: 1` 的 JSON Artifact。纯可序列化 `StateContribution` DTO 位于 `@loom-studio/shared`；Application Runtime 保留 Artifact 校验、Contribution 组合、引用诊断和最终物化。Extension 通过 `state.contribute` capability 注册包命名空间下的 Contribution，注册 handle 随 Extension Scope 释放；`state.read` / `state.write` 只转发现有 Application State Service，不向 Extension 暴露 State Store。

`loom.cardBundle` 当前接受 `schemaVersion: 2 | 3 | 4`，规范化与当前导出使用 v4；这与 ZIP 容器的 `loom.cardBundle.zip.v2` 不是同一个版本字段。State Contribution、旧模板与 Binding 的携带由 [Card Artifact 实现](../../../packages/application-runtime/src/cards/workspace.ts) 及 [文件合同](card-bundle-files.md) 负责。导出收集 Card 内联模板与未被内联覆盖的共享模板；导入时相同 ID/version/content 的模板复用，identity 冲突、缺失模板、版本不匹配与 Binding 路径错误会被拒绝，不静默覆盖工作区已有同 ID 不同内容模板。

## Mutation、Branch 与 Undo

所有 UI、RPC 与 Agent Tool 写入都进入同一个 State Mutation Service，使用 RFC 6901 JSON Pointer、`expectedRevisionId` 和可选幂等键。Timeline Mutation 创建新 Revision，并在同一事务推进对应 Branch Head；不同 Branch 不复制或覆盖彼此 Head。

State 对象路径只读取自身属性。包括 `__proto__`、`constructor` 和 `prototype` 在内的合法 JSON 键会作为普通 own property 保存和读取，不允许路径遍历或写入落到 JavaScript 对象原型链。

从当前正文 Head Fork 时使用 Branch 最新 State Head，因此保留正文后发生的纯 State 修改；从历史 Node Fork 时使用该 Node 的 State Revision。State-only Undo 不删除 Revision或直接倒退 Head，而是从被撤销 Revision 的 Parent Snapshot 创建补偿 Revision；第一版只允许撤销当前 Head。

Agent 官方工具为 `official/read_state` 与 `official/update_state`。Narrative Agent 只能访问 Global 与本 Turn 绑定的 Timeline / Branch；`update_state` 默认使用 Tool Invocation ID 作为幂等键。每次成功 Tool 写入是独立 Changeset，后续 Provider 失败或用户暂停不会自动撤销。
