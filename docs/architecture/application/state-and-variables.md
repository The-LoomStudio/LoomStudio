# State 与变量架构

Loom Studio 当前只区分两个持久化 Scope：Workspace Global State 与 Narrative Timeline State。两者共享 `@loom-studio/state-store` 的 Scope / immutable Revision / Snapshot 合同；Timeline 的当前 Head 由 Narrative Branch 持有，Global Head 由 State Scope 持有。

变量不是第二套存储。Prompt Build 在一次构建开始时冻结 Global、可选 Timeline 与 computed 值，形成 `VariableSnapshot`。`{{User}}` 只是 `global.user.name` 的内置别名；`{{global.*}}` 与 `{{timeline.*}}` 只展开标量，不递归执行，也不承担赋值或结构化 Prompt 注入。

## 权威与事务

- `state_scopes` 保存 Scope identity、owner 与 Global Head；
- `state_revisions` 保存完整 JSON Snapshot、Parent、Operations、Changeset 与幂等键；
- `narrative_branches.state_head_revision_id` 保存各世界线当前 State；
- `narrative_nodes.state_revision_id` 保存该正文节点对应的 State Revision；
- Card 的 `stateDefinitionIds` 与 `timelineStateBindings` 只保存共享 Definition 引用和实例路径，不复制模板权威。

创建 Timeline 时，Card Binding 与 Timeline Template 先物化为初始 Snapshot，再在同一个 Data Engine transaction 中创建 State Scope、Initial Revision、Timeline、Primary Branch 与 Opening Nodes。删除 Timeline 时同一事务 tombstone 对应 State Scope。

## Definition 与 Artifact

`airp.stateDefinition` 是 Global Definition / Timeline Template 的共享 Document。Global Definition 可约束 canonical path、Schema、默认值和只读性；Timeline Template 保存 templateVersion、Schema 与 initial object。当前 Schema 只实现已用到的 JSON Schema 子集，不提供继承、Mixin 或自动迁移。

`loom.cardBundle` 当前只接受 `schemaVersion: 2`。V2 可携带 `stateTemplates` 与 `timelineStateBindings`；导入时相同 ID/version/content 的模板复用，identity 冲突、缺失模板、版本不匹配与 Binding 路径错误会被拒绝。

## Mutation、Branch 与 Undo

所有 UI、RPC 与 Agent Tool 写入都进入同一个 State Mutation Service，使用 RFC 6901 JSON Pointer、`expectedRevisionId` 和可选幂等键。Timeline Mutation 创建新 Revision，并在同一事务推进对应 Branch Head；不同 Branch 不复制或覆盖彼此 Head。

从当前正文 Head Fork 时使用 Branch 最新 State Head，因此保留正文后发生的纯 State 修改；从历史 Node Fork 时使用该 Node 的 State Revision。State-only Undo 不删除 Revision或直接倒退 Head，而是从被撤销 Revision 的 Parent Snapshot 创建补偿 Revision；第一版只允许撤销当前 Head。

Agent 官方工具为 `official/read_state` 与 `official/update_state`。Narrative Agent 只能访问 Global 与本 Turn 绑定的 Timeline / Branch；`update_state` 默认使用 Tool Invocation ID 作为幂等键。每次成功 Tool 写入是独立 Changeset，后续 Provider 失败或用户暂停不会自动撤销。
