# Preset 作为 Agent PromptBuild Module 实施计划

> **状态**：Phase 1-2 Complete / Phase 3 Main UI Complete / Artifact Pending
> **日期**：2026-08-15
> **范围**：统一当前 `AgentPreset` 与 `PromptResource(resourceKind=preset)` 的重复概念，明确 Preset 是 Agent 的完整 PromptBuild Module，并收束 Card、Narrative Timeline、Setting 与 Preset 的绑定和运行时激活链。
> **非目标**：本计划不实现 Tool Runtime、Mode Runtime、变量系统、流式生成、Agent Session 分支或社区依赖解析；只为这些能力保留 Preset 内部的归属边界，不提前设计完整 Schema。
> **当前实现**：`airp.agentPreset` Schema、RPC 和 Client 实体已删除；Agent Profile 直接引用 Preset Prompt Resource；Preset 已持有 `linkedSettingIds` / `historyPolicy`，PromptBuild 会合并 Preset Setting 与可选 Timeline Setting；Preset 工作台已提供显式 Setting 关系编辑。带关联 Setting 的 Bundle 导入导出和 PromptBuild 来源诊断仍待 Phase 4。

相关计划：

- [`prompt-build-loom-core-pipeline-migration-plan.md`](prompt-build-loom-core-pipeline-migration-plan.md) — 负责将本计划已收束的 Preset / Setting 输入真正迁移到 `@loom/core` Pipeline。
- [`prompt-build-zone-slot-entry-composition-plan.md`](prompt-build-zone-slot-entry-composition-plan.md) — 负责将 Preset 的主排序从纯 Zone 模型重构为 Zone / Slot / Entry，并固化 Runtime History 与 Current Input 的结构位置。
- [`prompt-resource-foundation-plan.md`](prompt-resource-foundation-plan.md)
- [`agent-session-narrative-timeline-data-layer-plan.md`](agent-session-narrative-timeline-data-layer-plan.md)
- [`card-resource-manifest-migration-plan.md`](card-resource-manifest-migration-plan.md)

---

## 1. 核心决定

Loom Studio 只保留一个产品概念上的 Preset：

> **Preset 是 Agent 的完整 PromptBuild Module。**

Preset 不只是 Composition Skeleton 或排序模板。它负责声明一次 Agent PromptBuild 所需的静态结构与能力，包括：

- Prompt Skeleton 与 Zone；
- Prompt Entry 与 Projection Order；
- 引用的 Setting Layer；
- Activation 与 History 投影策略；
- 未来的 Tool 注册、Mode 切换及其他 PromptBuild Capability。

未来能力进入 Preset，并不代表本阶段立即创建 Tool、Mode 或通用 Capability 配置。只有真实 Runtime 需求出现后，才为对应能力增加最小合同。

不再引入额外的 `AgentDefinition`、`AgentPromptConfig` 或第二套 Preset。Agent Profile 只选择模型与 Preset；Agent Session 只引用 Agent Profile。

```text
AgentSession
  -> AgentProfile
       -> ProviderProfile + modelId
       -> Preset (Agent PromptBuild Module)
```

---

## 2. 实施前代码事实与偏差

本计划实施前存在两套都被称为 Preset 的对象：

```text
airp.agentPreset
  name
  instructions
  promptResourceIds
  historyPolicy

airp.promptResource(resourceKind=preset)
  rootNode
  Skeleton Patch
  Order Profile
  Prompt Entries
```

实施前 Agent Profile 引用 `airp.agentPreset`，再由 `AgentPreset.promptResourceIds` 间接引用真正的 Composition Preset 和 Setting。

官方问答助手实施前采用以下隐藏绑定：

```text
AgentProfile
  -> agent-preset.official.loom-assistant
       -> prompt-resource.official.loom-assistant
       -> prompt-resource.official.loom-knowledge
```

`composeAgentTurnPrompt` 实施前将下面两组 ID 直接合并、去重后送入 Prompt 编译器：

```text
AgentPreset.promptResourceIds
+ NarrativeTimeline.promptResourceIds
```

由此产生的问题：

1. `AgentPreset` 与 `PromptResource(kind=preset)` 职责重叠，用户无法判断哪一个才是真正的 Preset；
2. 官方知识 Setting 的绑定存在于后端初始化数据中，前端没有关系展示和编辑入口；
3. `promptResourceIds[]` 混合表达主 Preset、Setting 与 Timeline 资源，边的语义不明确；
4. Settings 工作台的当前选择只是编辑状态，但 UI 没有清楚区分“正在编辑”和“已绑定生效”；
5. Card 或 Timeline 如果混入另一个 Preset，运行时只能依赖冲突检查，无法从 Schema 上阻止错误关系。

---

## 3. 目标资源与绑定模型

### 3.1 Preset

目标上由 `PromptResource(resourceKind=preset)` 承担完整 Preset 身份，不再保留独立的 `airp.agentPreset` 聚合。

首版只增加当前真实需要的 Preset 级配置：

```ts
type PresetPromptResourceContent = {
  resourceKind: 'preset'
  rootNode: PromptResourceNode
  linkedSettingIds: string[]
  historyPolicy: 'persistent' | 'ephemeral'
  origin?: PromptResourceOrigin
  createdAt: string
  updatedAt: string
}
```

规则：

- `rootNode` 保存 Preset 自身的 PromptBuild 结构、Entry、Zone 与排序；
- `linkedSettingIds` 只允许引用 `PromptResource(resourceKind=setting)`；
- Setting 保持平铺和独立身份，不嵌入 Preset，也不因为被引用而失去独立编辑、复用和导出能力；
- 首版不允许 Preset 引用另一个 Preset；
- 首版不建立任意递归依赖图，因此不存在循环依赖解析；
- `historyPolicy` 暂时保留在 Preset，因为它决定 Agent 历史如何参与 PromptBuild；未来如果出现明确的 Session 级覆盖需求，再单独讨论。

### 3.2 Agent Profile

Agent Profile 保持轻量：

```ts
type AgentProfileContent = {
  name: string
  presetId: string
  model: {
    providerProfileId: string
    modelId: string
  }
  createdAt: string
  updatedAt: string
}
```

其中 `presetId` 必须直接引用 `PromptResource(resourceKind=preset)`。

Agent Profile 不保存 Prompt Entry、Setting 列表、Tool 列表或 Mode 列表，也不创建另一份 Preset 配置镜像。

### 3.3 Card 与 Narrative Timeline

Card 只是 Timeline 的启动配方，不是运行时绑定权威源：

```text
Card.settingResourceIds
  -> 创建 Timeline 时复制
  -> NarrativeTimeline.settingResourceIds
```

Timeline 创建后：

- PromptBuild 读取 Timeline 当前绑定，不继续实时读取 Card；
- Card 后续修改不静默影响已有 Timeline；
- `createdFromCardId` / `createdFromCardVersion` 只表达来源；
- Card 包可以携带 Preset 作为 Bundle inventory，但不代表该 Preset 自动成为 Timeline 资源或替换用户当前 Agent Profile 的 Preset；
- Card 推荐 Preset 属于独立的启动推荐能力，出现真实 UI 需求后再设计，不复用 Timeline Setting 绑定。

目标上应将 Card 与 Timeline 当前含义宽泛的 `promptResourceIds` 收束为只表达剧情侧 Setting 的字段。具体字段重命名随迁移阶段完成，不维持两套长期并存的读写链。

---

## 4. 运行时绑定与激活链

一次 Agent Turn 有两个互相独立的输入根：

```text
Agent root:
  AgentSession
    -> AgentProfile
      -> Preset
        -> Preset 自身 Prompt 节点
        -> Preset.linkedSettingIds

Optional narrative root:
  NarrativeTarget
    -> NarrativeTimeline
      -> Timeline.settingResourceIds
      -> Narrative Nodes / future State
```

PromptBuild 按以下顺序解析：

1. 从 Agent Session 读取 Agent Profile；
2. 从 Agent Profile 读取唯一 Preset；
3. 读取 Preset 自身节点并展开 `linkedSettingIds`；
4. 如果调用提供 Narrative target，再读取 Timeline Settings 与 Narrative 上下文；
5. 按稳定资源 ID 去重 Setting；
6. 只使用 Agent Profile 所选 Preset 提供 Skeleton、Zone 和主 Order Profile；
7. 对 Preset 与 Setting Entry 计算 enabled、activation、zone 和最终 included；
8. 按 `historyPolicy` 投影 Agent Session 历史；
9. 加入可选 Narrative 上下文和当前用户输入；
10. 生成 canonical Chat Message，再由 Provider Adapter 转成外部 payload。

关键边界：

- 没有 Narrative Timeline 时，Agent Session 仍可通过 Agent Profile + Preset 独立工作；
- Timeline 不拥有 Agent Session，也不选择 Agent Preset；
- Preset 不拥有 Timeline，也不自动加载当前 Settings 编辑器选中的资源；
- Settings 工作台选择状态永远只是 UI 编辑状态，不进入 PromptBuild；
- Preset Setting 与 Timeline Setting 同名、同标签不构成同一资源，去重只基于稳定 ID；
- 同一个 Setting 同时被 Preset 与 Timeline 引用时只编译一次。

---

## 5. API 与 UI 收束

### 5.1 后端合同

复用现有 Prompt Resource CRUD，并增加最小的 Preset 关系操作：

```text
application.updatePresetSettings
  presetId
  linkedSettingIds[]
```

该操作必须：

- 校验目标是 Preset；
- 校验所有引用目标是 Setting；
- 拒绝重复或不存在的 ID；
- 以完整有序列表替换，避免增加 attach/detach 两套细碎 RPC；
- 通过现有 Document mutation / Changeset 写入，不增加新的关系表。

如果现有通用 Prompt Resource update 已能清楚承载该字段，则不新增专用 RPC；实施时停在能够保持类型安全和调用清晰的最低层级。

### 5.2 前端

Preset 工作台增加一个明确的“关联 Setting”区域：

- 展示当前绑定的 Setting 名称与状态；
- 添加和移除 Setting；
- 可以跳转到对应 Setting 编辑器；
- 明确标记绑定来源是当前 Preset；
- 不把 Settings 工作台当前选中项当作隐式绑定；
- Agent Profile 面板继续只选择 Preset 与模型，不复制 Setting 选择器。

Timeline / Card 的 Setting 绑定继续放在各自资源关系界面，不进入 Preset 工作台。

---

## 6. 导入、导出与删除

Preset 需要支持两种导出语义：

```text
只导出 Preset
Preset + 已绑定 Setting Bundle
```

Bundle 导入时：

1. Preset 与 Setting 分别注册为平铺 Prompt Resource；
2. 重建冲突的 Resource / Node ID；
3. 使用重建后的 ID 恢复 `linkedSettingIds`；
4. 不因为显示名相同而覆盖本地资源。

删除 Setting 时保持现有“删除优先”原则：先提示仍被哪些 Preset、Card 或 Timeline 引用；用户确认后删除并在同一受控操作中解除这些引用，不以引用存在为由永久阻止删除。

---

## 7. 分阶段实施

### Phase 1：统一领域合同

1. 将 Preset 定义为 `PromptResource(resourceKind=preset)` 的特化内容；
2. 让 Agent Profile 直接校验并引用 Preset Prompt Resource；
3. 将当前 `AgentPreset.instructions` 迁入 Preset Prompt Entry；
4. 将 `AgentPreset.historyPolicy` 与 Setting 引用迁入 Preset 内容；
5. 更新 Application Runtime 类型、默认官方资源和相关文档。

验证检查点：代码中不再需要 `AgentPreset -> PromptResource(kind=preset)` 的二段解析；官方问答助手只存在一个 Preset 身份。

### Phase 2：PromptBuild 单轨

1. 修改 `composeAgentTurnPrompt`，从 Agent Profile 所选 Preset 读取自身节点及关联 Setting；
2. 将 Timeline 输入限制为 Setting 与 Narrative context；
3. 保持按稳定 ID 去重和唯一主 Preset；
4. 补无 Timeline、仅 Timeline Setting、Preset 与 Timeline 重复引用等定向测试；
5. 删除旧 `AgentPreset.promptResourceIds` 合并路径。

验证检查点：独立 Agent Session 与面向 Timeline 的 Agent Turn 使用同一条确定性解析链，Settings 编辑器选择不会影响结果。

### Phase 3：关系 UI

1. Preset 工作台展示并编辑关联 Setting；
2. Agent Profile 面板直接列出真正的 Preset Prompt Resource；
3. PromptBuild Preview 展示每个资源来自 `preset` 或 `timeline`；
4. 删除旧 AgentPreset 列表、RPC 映射和前端实体。

验证检查点：用户可以从 UI 回答“当前 Agent 为什么加载这个 Setting”，不存在隐藏绑定。

### Phase 4：Artifact 与清理

1. 增加 Preset 单体与带 Setting Bundle 的导出入口；
2. 导入时恢复平铺资源引用；
3. 迁移官方默认资源和当前开发数据；
4. 清除旧 `airp.agentPreset` Document 与测试 Fixture；
5. 将稳定实现晋升到 Architecture / Reference。

验证检查点：导出再导入后，Preset 内容、Setting 引用和 Projection 顺序保持一致；数据库和 RPC 不再保留双 Preset 权威链。

---

## 8. 完成标准

满足以下条件后，本计划可以标记完成：

1. 产品与代码中只有一个 Preset 概念；
2. Agent Profile 直接引用 Preset；
3. Preset 自身完整承担 Agent PromptBuild Module；
4. Preset 可以显式引用平铺 Setting；
5. Card 只初始化 Timeline Setting 绑定，运行时不参与解析；
6. Timeline 与 Preset 是独立输入根，只在 Agent Turn 的 PromptBuild 中汇合；
7. Settings 编辑器当前选择不影响任何运行时绑定；
8. PromptBuild Preview 能解释资源来源；
9. 官方问答助手不再依赖隐藏的 `AgentPreset.promptResourceIds`；
10. 旧 `airp.agentPreset` Schema、RPC、前端实体和默认数据已删除。
