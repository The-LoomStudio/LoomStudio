# State 与变量架构

> **状态**：State v1 核心运行链已实现并晋升。独立 State Artifact 资源管理与运行态软引用检查由 [State 资源与引用检查后续](../../workbench/issues/state-resource-and-reference-follow-ups.md) 跟踪，不阻塞当前合同。

Loom Studio 当前的 State 只区分两个持久化 Scope：Workspace Global State 与 Narrative Timeline State。这不是整个系统所有数据的 Scope 列表。两者共享 `@loom-studio/application-data` 中 State Store 的 Scope / immutable Revision / Snapshot 合同；Timeline 的当前 Head 由 Narrative Branch 持有，Global Head 由 State Scope 持有。

State 提供结构化运行数据、Schema 校验与可追溯修改，不是全部可变文本的统一容器。Application 层已经定义 Entity Type、显式 Entity、Component Definition、精确 / Entity Type 批量 Mount 与软引用；它们在创建 Timeline 时编译为普通 JSON Snapshot，不形成第二个 Entity Store，也不包含自动游戏规则调度。文本资源、宏和 Extension 私有记录的区别见 [数据能力与生命周期边界](data-capabilities-and-lifecycle.md)。

变量不是第二套存储。Prompt Build 在一次构建开始时冻结 Global、可选 Timeline 与 computed 值，形成 `VariableSnapshot`。`{{User}}` / `{{user}}` 与 `{{user.description}}` 读取本轮 computed 中的用户名称和描述：新故事来自当前 Branch 的内置玩家资料组件；无故事调用及未迁移旧故事来自全局用户模板（见[用户资料](./user-profiles.md)）。`{{global.*}}` 与 `{{timeline.*}}` 只展开标量，不递归执行，也不承担赋值或结构化 Prompt 注入。

Card / Preset 静态宏配置与 Extension 提供者进入同一来源候选组装；State 原值仍由 State Mutation 修改，宏检查不创建或写回 State。作者配置、当前宏预览和实际构建快照分别呈现，合同见 [注入与内联展开](prompt-build/injection-and-inline-expansion.md)。

## 权威与事务

新 Timeline 固定包含 `loom-player:User` 及其 `loom_profile` 组件。应用内置声明与 Card / 扩展声明共同物化；作者可引用该实体挂载自己的组件，不重复声明应用实体，不覆盖资料组件。启动资料先进入 State，再用于开场与扩展初始化。精确标识、保留路径和模板生命周期见[用户资料](./user-profiles.md)。

- `state_scopes` 保存 Scope identity、owner 与 Global Head；
- `state_revisions` 保存 Parent、Operations、Changeset 与幂等键；初始化和周期 checkpoint 保存完整 Snapshot，普通 Revision 保存内部 delta。读取 API 始终物化并返回完整 JSON；
- `narrative_branches.state_head_revision_id` 保存各世界线当前 State；
- `narrative_nodes.state_revision_id` 保存该正文节点对应的 State Revision；
- Card 可通过 `stateTemplates` 携带内联组件模板，或通过 `stateDefinitionIds` 引用共享 Definition；`stateEntityTypes`、`timelineStateEntities` 与 `timelineComponentMounts` 描述 EC 初始化，`timelineStateBindings` 只保留为高级原始路径与旧卡兼容入口。同 ID 时内联模板优先，修改内联模板不会写回共享 Definition。

创建 Timeline 时，Card 内联 Contribution、`stateContributionIds` 显式选择的 Contribution，以及 `extensionAdoptions` 默认采用安装的已注册 Contribution 先确定性组合。声明 `participation: "timeline"` 的包必须被采用，不能仅通过 `stateContributionIds` 绕过。重名 Entity Type、Template、Entity 或最终组件路径会失败，不存在隐式覆盖顺序。组合结果物化为初始 Snapshot，并把 Entity / Component / Reference 描述、Extension 原始声明与安装来源、Package 版本与 Schema 固化为 Timeline Runtime Context（旧 `fallbackUserName` 字段保留，但不再参与用户宏解析）；随后在同一个 Data Engine transaction 中创建 Runtime Context、采用记录、State Scope、Initial Revision、Timeline、Primary Branch 与 Opening Nodes。来源、版本和采用记录不写入业务 Entity 或专用 metadata 组件。Extension 后续卸载或重载不会改写已有 Timeline。

中途采用也保存原始声明和绑定来源。绑定的归属按声明 Mount / Binding 的 Contribution 确定，不按共享模板的作者确定；原始路径通配符及 Entity Type 批量挂载均展开到具体路径。Card 默认配置只影响新 Timeline；同一 Timeline 下所有 Branch 共用采用关系，State Head 仍各自独立。暂停或卸载保留数据，旧 checkpoint 缺失数据通过显式初始化流程补齐，不根据路径存在性推断是否采用。

## Definition 与 Artifact

`airp.stateDefinition` 是 Global Definition / Timeline Template 的共享 Document。Global Definition 可约束 canonical path、Schema、默认值和只读性；Timeline Template 保存 templateVersion、Schema 与 initial object。当前 Schema 只实现已用到的 JSON Schema 子集，不提供继承、Mixin 或自动迁移。

规范交换容器为 `kind: "loom.state"`、`schemaVersion: 1` 的 JSON Artifact。纯可序列化 `StateContribution` DTO 位于 `@loom-studio/shared`；Application Runtime 保留 Artifact 校验、Contribution 组合、引用诊断和最终物化。Extension 通过 `state.contribute` capability 注册包命名空间下的 Contribution，注册 handle 随 Extension Scope 释放；`state.read` / `state.write` 只转发现有 Application State Service，不向 Extension 暴露 State Store。

`loom.cardBundle` 当前只接受 `schemaVersion: 4`；这与 ZIP 容器的 `loom.cardBundle.zip.v2` 不是同一个版本字段。State Contribution、模板与 Binding 的携带由 [Card Artifact 实现](../../../packages/application-runtime/src/cards/workspace.ts) 及 [文件合同](card-bundle-files.md) 负责。导出收集 Card 内联模板与未被内联覆盖的共享模板；导入时相同 ID/version/content 的模板复用，identity 冲突、缺失模板、版本不匹配与 Binding 路径错误会被拒绝，不静默覆盖工作区已有同 ID 不同内容模板。测试期旧 Card Bundle schema v2/v3 不再兼容；外部 SillyTavern V2/V3 仍先转换为内部 V4。

## 来源检查

Studio 的 `application.inspectStateSources` 是只读查询，接受可选 `cardId` 与 Timeline/Branch `target`。有 target 时，Card 从 Timeline 来源确定，显式 Card 不匹配或 Branch 不属于 Timeline 时拒绝查询；没有 target 时只展示当前 Card 和工作区可查看来源，不伪造故事资格。其他 Card 的私有注册贡献不进入结果。

查询分别返回工作区 Definition、当前 Card 内联声明及引用、扩展当前注册声明、Timeline 接受时的声明，以及当前 Branch 已接受路径的存在性。暂停、模块解除注册或安装记录消失后，仍从 Runtime Context 展示接受时的来源与声明。`eligible` 表示采用记录与安装身份/版本允许参与，不证明模块已加载或正在执行；当前注册列表也不是 State 已初始化的证明。缺失 Card 或 Runtime Context 明确呈现为不可用，不用当前 Card 配置补造历史。

State 面板的“来源”“初始化配置”“运行态变量”分别展示这些来源事实、编辑 Card 的当前作者配置、查看或修改运行值。诊断不执行初始化器、重建 State、更新采用表或创建修订，也不为旧开发数据补写来源。查询返回的修订与声明用于观察，不是并发写入授权。当前边界由 `timeline-extension-participation.test.ts` 的真实 Runtime 查询与初始化来源用例，以及 `state-panel-source.test.ts` 的异步目标隔离验证覆盖；视觉与完整扩展执行验收独立记录。

## Mutation、Branch 与 Undo

所有 UI、RPC 与 Agent Tool 写入都进入同一个 State Mutation Service，使用 RFC 6901 JSON Pointer、`expectedRevisionId` 和可选幂等键。Timeline Mutation 创建新 Revision，并在同一事务推进对应 Branch Head；不同 Branch 不复制或覆盖彼此 Head。

State 对象路径只读取自身属性。包括 `__proto__`、`constructor` 和 `prototype` 在内的合法 JSON 键会作为普通 own property 保存和读取，不允许路径遍历或写入落到 JavaScript 对象原型链。

从当前正文 Head Fork 时使用 Branch 最新 State / Workspace Head，因此保留正文后发生的修改；从历史 Node Fork 时优先使用来源 Branch / Node 的恢复点，缺失恢复点时才使用 Node 提交时的 State / Workspace Revision。新分支同时复制路径上的恢复点，因此历史节点的最终状态与节点提交时状态可以不同。State-only Undo 不删除 Revision或直接倒退 Head，而是从被撤销 Revision 的 Parent Snapshot 创建补偿 Revision；第一版只允许撤销当前 Head。

Global Definition 更新与 State 写入在提交事务内检查当前值和约束，避免并发校验基于过期定义。Global State 撤销、Definition-only 撤销以及混合默认值撤销均检查最终 Definition / Snapshot 组合；不兼容的 Schema 或只读值变更整体失败，不自动迁移其他历史。相同幂等请求并发命中时返回原 Revision 和 Changeset，不产生空提交或重复 State 通知。

Agent 官方工具为 `official/read_state` 与 `official/update_state`。Narrative Agent 只能访问 Global 与本 Turn 绑定的 Timeline / Branch；`update_state` 默认使用 Tool Invocation ID 作为幂等键。每次成功 Tool 写入是独立 Changeset，后续 Provider 失败或用户暂停不会自动撤销。
