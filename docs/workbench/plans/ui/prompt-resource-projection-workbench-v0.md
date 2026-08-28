# Prompt Resource Projection Workbench v0

> **状态**：Frontend Foundation Complete / Backend Contract Pending
> **日期**：2026-08-15
> **主题**：收束 Prompt Resource 的 Source Tree、资源内投影、Preset 主排序、批量编辑与 Folder/Zone 有效启用合同。
> **计划边界**：Resource Tree、Projection Runlist、Preset 排序与批量编辑的前端基础已经落地。下一阶段只收束 PromptBuild、Document Schema 与 RPC 的后端合同；后端完成前，不把前端推导状态描述为权威运行结果。

相关文档：

- [`../../discussion/application/prompt/composition-skeleton-and-preset-v0.md`](../../discussion/application/prompt/composition-skeleton-and-preset-v0.md)
- [`../airp-resource-session-prompt-schema-plan.md`](../../../archive/plans/airp-resource-session-prompt-schema-plan.md)
- [`../../../architecture/ui/window-layout.md`](../../../architecture/ui/window-layout.md)
- [`../../../architecture/ui/workspace-shell.md`](../../../architecture/ui/workspace-shell.md)

---

## 1. 决策摘要

Prompt Resource 编辑不再围绕“把未分配条目拖进排序”设计。正常创建的 Prompt-facing Entry 从一开始就拥有 Projection 和默认 `zoneId`；没有 Projection、Zone 无法解析或导入数据缺字段，属于迁移或诊断状态，不是日常作者工作流。

Source Tree 与 Projection Order 保持正交：

```text
Source Tree
  决定资源路径、文件夹和作者组织。

Resource Projection
  决定当前 Resource 的条目挂载到哪个 Zone / Slot，以及资源内部投影顺序。

Main Order
  合并当前 Build Context 中全部来源，只保留有效启用的条目，形成完整 Prompt 结构。

Build Preview
  在一次具体 PromptBuild 中进一步应用 Activation，展示本轮真正 Active 的结果。
```

资源工作台继续负责资源内容和自身配置；Preset 工作台负责完整 Composition 与主排序。两边不建立“左资源、右排序”的重复拖入工作流，也不要求跨视图拖拽才能让条目进入 Projection。

拖拽保留为少量条目的排序微调手段。大量条目使用显式编辑模式、复选框和批量操作，不能让拖拽成为唯一高效路径。

---

## 2. 已实现事实与后端缺口

以下事实以 2026-08-15 的代码为准：

- `PromptResourceNode.enabled?: boolean` 对 Module、Folder、Entry 等所有节点类型均可保存；
- 当前 PromptBuild 只在收集 Entry Contribution 时检查 Entry 自身的 `enabled !== false`；
- Folder 的 `enabled` 当前不会形成后代有效启用门控；
- `ZoneNode` 属于 Composition Skeleton 结构，目前没有 `enabled`；
- `PromptResourceCompositionCapabilities.projection` 当前可选，但一旦存在，`zoneId` 必填；
- PromptBuild 已区分持久化配置与 Activation 计算，`active` 是单次 Build 结果；
- 未知 Zone 当前会中断编译，fallback / diagnostic 合同仍未收束；
- 当前前端已有 Resource Tree、资源投影视图、Projection Runlist、Preset 当前资源排序和主排序的基础实现。

因此，本文中的 Folder 级联、Zone 启用、默认 Projection 后端强制和未知 Zone 降级均属于后续后端任务，不能由前端过滤逻辑假装已经完成。

---

## 3. 正式交互模型

### 3.1 Source Path 与 Zone 是两个维度

每个持久化条目必须位于 Resource 的 Source Tree 路径中，但它的路径不承担 Prompt 位置语义：

```text
/创作约束/错误避免
  -> preset.system

/人物/档案管理员
  -> setting.stable
```

Folder 可以被理解为 Source Tree 的组织容器；Zone 可以在 UI 上采用类似 Folder 的树状交互，但它是参与最终排序的 Projection Container。两者可以共享折叠、详情、启用开关和批量操作语法，不能共享领域身份。

### 3.2 正常状态不提供“未分配资源区”

不建立真实或伪造的“杂物 Zone”“未分配 Zone”或独立未分配资源区：

- 原生创建的 Prompt-facing Entry 自动获得默认 Projection；
- Disabled Entry 仍保留原来的 Zone / Slot 和排序信息；
- Source Tree 始终保存条目的真实路径；
- 导入缺失 Projection、未知 Zone 或损坏数据时显示诊断，不把异常静默伪装成普通分类。

### 3.3 四种视图职责

| 视图 | 默认内容 | 可编辑内容 | 不承担的职责 |
| --- | --- | --- | --- |
| Source Tree | 当前资源全部节点 | 正文、路径、Folder、Enabled、Metadata | 完整 Prompt 排序 |
| 当前资源排序 | 当前资源全部 Projection，包括 Disabled | Zone、Slot、资源内位置、批量 Projection 配置 | 其他来源的完整排序 |
| 主排序 | 当前 Build Context 中 Effective Enabled 的全部来源 | Zone/Slot/Entry 的完整相对位置 | 来源资源的启用开关管理 |
| Build Preview | 本轮 Active 的最终 Projection / Provider Messages | 首版只读 | 持久化作者配置 |

`enabled` 与 `active` 不得在文案、状态图标或过滤逻辑中混用。

---

## 4. Resource Workbench

Resource Workbench 继续采用现有 Explorer / Detail Column 结构，不增加一套与 Preset 重复的平行 Composition Workbench。

```text
Resource Workbench
├── Explorer Column
│   ├── Source Tree
│   └── Current Resource Projection
└── Detail Column
    ├── Resource Detail
    └── Metadata
```

### 4.1 Source Tree 模式

Source Tree 展示当前资源的全部节点，包括 Disabled Entry。这里负责：

- 新建、复制、删除和移动资源节点；
- 调整 Folder 与 Source Path；
- 查看和编辑正文；
- 启用或停用 Entry / Folder；
- 进入批量选择模式；
- 查看条目的 Projection 摘要和诊断状态。

关闭或折叠 Folder 只是 UI 展开状态，不影响 PromptBuild。停用 Folder 是独立领域操作，后端合同完成后才影响后代 Effective Enabled。

### 4.2 当前资源排序模式

当前资源排序展示该 Resource 自身全部可投影条目，包括 `enabled=false` 的条目。Disabled 条目可以弱化，但不得隐藏，因为该视图承担重新启用和维护其位置的职责。

排序行至少解释：

```text
Zone
Slot / Source Block
Entry 在 Slot 内的位置
Enabled 状态
Activation 配置摘要
Projection 诊断
```

仅按 Zone 粗略分组不足以解释实际位置。首版至少应展示 Entry Rank 或稳定的位置编号；后续可以增加相邻条目、排序来源和 PromptBuild Trace 入口。

### 4.3 批量编辑模式

批量选择使用标准 Checkbox 和显式编辑模式，支持键盘操作，不依赖拖拽：

```text
已选择 24 项
[启用] [停用] [设置 Zone] [设置 Slot] [更多]
```

首批操作：

- 批量启用；
- 批量停用；
- 批量设置 Zone；
- 批量设置 Slot；
- Source Tree 中批量移动到 Folder。

批量操作必须明确作用域、选择数量和失败结果。跨多个 Document 的原子性未定义前，前端不得把部分成功显示成整体成功。

### 4.4 打开资源集合

Resource Workbench 的“打开资源”属于本地编辑状态，不等同于 Card、Session 或 Agent Profile 绑定：

- 打开数量不设产品上限；
- 普通使用预计不超过十个，但前端不写死该限制；
- 每个资源类别独立保存打开集合和当前选择；
- 顶部 Category Tab 不混放不同类型的资源；
- Header 提供当前资源选择、打开资源和新建资源；
- 关闭资源只从工作台移除，不删除、不解绑。

Preset 保持独立导航和工作台，不作为 Resource Workbench 的普通 Category Tab。

---

## 5. Preset Workbench

Preset Workbench 继续以 Composition / PromptBuild 为中心，不退化为普通文本资源编辑器。

```text
Preset Workbench
├── 当前预设排序 / 主排序
└── Entry / Zone / Tool / Mode Detail
```

### 5.1 当前预设排序

当前预设排序展示 Preset 自身条目和 Zone 结构，可以包含 Disabled 条目，用于维护 Preset 作者配置。

### 5.2 主排序

主排序合并当前 Build Context 中的 Preset、Setting Layer、Runtime、Narrative 和插件贡献，默认不显示 Effective Disabled 条目。

主排序负责：

- Zone、Slot 与 Entry 的完整相对位置；
- 少量条目的拖拽微调；
- 批量移动到 Zone / Slot；
- 选择 Entry 后打开真实来源详情；
- 选择 Zone 后打开 Zone Detail / Metadata；
- 展示来源、排序依据和诊断信息。

主排序不作为批量启用/停用资源条目的主要入口。条目的作者配置应回到来源 Resource 修改，避免大型世界书的 Disabled 条目污染完整 Composition 视图。

### 5.3 Detail 的来源编辑

从主排序选择 Entry 后，Detail 可以编辑其真实来源正文与 Metadata。是否允许在该 Detail 中直接修改 Enabled，应保持克制：首版可以显示来源状态并提供“在资源中定位”，避免让主排序逐步变成第二个 Resource Workbench。

Preset 后续还可能承载异构 Composition Node：

- Prompt Entry；
- Tool Mount；
- Mode Gate；
- Agent Step。

这些节点可以共享树状选择、详情和批量交互，但不能为了统一外观而假设它们都拥有 `zoneId` 或 Provider Message 顺序。具体 Schema 在 Agent / Tool 后端合同确定后再实施。

---

## 6. 默认 Projection 合同

正常作者操作不产生无 Projection 的 Prompt-facing Entry。

建议优先级：

```text
新建 Entry
  -> 继承最近有效兄弟的 Zone / Slot
  -> 继承父级或 Resource 的推荐 Projection
  -> 使用 Resource Category 默认 Zone
  -> 使用 Skeleton fallbackZoneId
```

复制 Entry 默认复制其 Projection。导入数据缺少 Projection 时必须通过明确的兼容规则补齐，并产生可检查的 Import Diagnostic；禁止静默丢弃或创建不可发现的孤儿条目。

这项合同还要求标准 Zone ID 在生态中保持稳定。自定义 Preset 可以增加 namespaced Zone，但如果删除或替换标准 Zone，必须声明 fallback / mapping，否则通用 Setting Resource 无法稳定投影到不同 Preset。

具体默认 Zone 映射、继承规则和导入迁移由后端计划收束，前端只消费权威结果与 Diagnostic。

---

## 7. Enabled、Effective Enabled 与 Active

目标状态模型：

```text
ownEnabled
  = 节点自身保存的 enabled

effectiveEnabled
  = ownEnabled
  && ancestorFoldersEnabled
  && zoneEnabled
  && resourceBindingEnabled

active
  = 本次 PromptBuild Activation 计算结果

included
  = effectiveEnabled
  && active
  && projectionResolved
```

当前代码尚未实现上述完整公式。后端需要明确：

- Folder 停用是否对全部后代形成门控；
- Zone 停用是否跳过整个 Zone，而不改写后代 Entry 的 `enabled`；
- Resource Binding 是否拥有独立启用状态；
- Disabled / Inactive / Unresolved 在 Editor Projection 与 Trace 中如何区分；
- Zone 恢复启用后，后代 Entry 是否按原有配置与顺序恢复。

UI 必须保留节点自身配置，不能在停用 Folder 或 Zone 时批量把后代 `enabled` 写成 `false`。

---

## 8. Zone Detail

Zone 应提供独立详情入口，但不需要成为独立 Document。当前可展示的 Skeleton 字段包括：

- `id`；
- `displayName`；
- `band`；
- `orderIndex`；
- `accepts`；
- `renderHint.providerRoleHint`；
- `renderHint.wrapper`。

目标后端合同补充 `enabled` 或等价门控后，Zone Detail 再提供启用开关。前端不得先创建只影响本地过滤、却不影响真实 PromptBuild 的伪开关。

Zone Detail 可以使用现有 Metadata Overlay，不为一个详情表单增加新的 Window 或固定第三列。

---

## 9. Resource Binding 与 Projection 分离

以下操作必须保持独立：

```text
打开 Resource
  只改变本地编辑工作台。

绑定 Resource 到 Card / Agent Profile / Build Context
  决定 PromptBuild 可以读取哪些 Resource。

设置 Entry Projection
  决定已读取 Entry 注入哪个 Zone / Slot。
```

把整个世界书加入 Agent/Profile 不是把八百个条目逐个拖进主排序。绑定完成后，PromptBuild 自动读取该 Resource，并根据各 Entry 已有 Projection、Enabled 和 Activation 生成主排序。

当前计划不重新设计 Card、Session 与 Agent Profile 的最终绑定 Schema；相关后端决定只作为本计划依赖记录。

---

## 10. 分阶段实施

### Phase 0：文档与当前前端收尾

- 固化本文交互模型；
- 保留当前 Projection Runlist 基础实现；
- 不新增跨树拖拽；
- 不增加未分配 Zone / 杂物 Zone；
- 不在前端伪造 Folder/Zone Effective Enabled；
- 当前前端批次只做与现有数据合同一致的显示和局部交互改进。

### Phase 1：前端资源内配置体验

- Source Tree / 当前资源排序保持可切换；
- 当前资源排序显示 Disabled Entry；
- 增加 Checkbox 编辑模式和批量 Enabled / Zone / Slot 操作；
- 补全位置编号、Slot 和 Projection Diagnostic；
- 主排序过滤当前合同能够确认的 Disabled Entry；
- Zone 支持选择并打开只读或现有字段 Detail。

### Phase 2：后端 PromptBuild 与 Schema 补齐

- 定义 Folder Effective Enabled 级联；
- 为 Zone 增加启用门控或等价结构；
- 定义 Resource Binding Enabled；
- 保证原生创建获得默认 Projection；
- 定义缺失/未知 Zone 的 fallback、diagnostic 与 strict 行为；
- 在 Editor Projection / Trace 中返回 own/effective/active/reason；
- 为批量跨节点更新提供明确的事务与部分失败合同。

### Phase 3：运行结果与高级 Preset 节点

- 增加本轮 Build Preview；
- 支持 Active / Inactive 原因定位；
- 接入 Tool Mount、Mode Gate 和 Agent Step 的正式 Schema；
- 根据真实 Agent Runtime 决定多 Build Context 的选择与切换 UI。

---

## 11. 验收矩阵

### Frontend

- 新建原生 Entry 后无需额外拖入即可出现在当前资源排序；
- Source Tree 与当前资源排序都能定位同一个 Entry；
- Disabled Entry 留在 Source Tree 和当前资源排序中，但不污染主排序；
- 批量选择支持 Checkbox、键盘与明确选择数量；
- 批量 Enabled / Zone / Slot 操作具有成功和失败反馈；
- 主排序可以解释 Zone、Slot、位置和来源；
- 点击主排序 Entry 可以打开真实来源 Detail；
- 点击 Zone 可以打开 Zone Detail；
- 拖拽不是完成任何关键配置的唯一方式。

### Backend

- Folder 停用不改写后代 Entry 的持久化 `enabled`；
- Folder 恢复后，后代按原有配置恢复 Effective Enabled；
- Zone 停用不删除、不迁移内部条目；
- Zone 恢复后保留原 Slot 和 Entry 顺序；
- 缺少或未知 Zone 不被静默丢弃；
- Disabled、Inactive 和 Unresolved 在 Projection / Trace 中可区分；
- Custom Preset 对标准 Resource 的默认 Zone 提供可解释的解析或 fallback；
- 批量更新失败不会被误报为全部成功。

---

## 12. 实施前仍需后端拍板的问题

1. 各 Resource Category 的默认 Zone 和继承优先级是什么？
2. 标准 Zone 是否是所有 Composition Preset 必须保留的兼容接口？
3. Folder 与 Zone 的 `enabled` 是相同字段语义，还是使用独立 Gate 配置？
4. Resource Binding 是否需要独立 Enabled，还是只表达是否被引用？
5. Main Order 默认展示 Effective Enabled 候选，还是在存在 Session Context 时默认进一步过滤 Active？
6. 未知 Zone 默认 hard error、fallback 还是 authoring isolate？
7. 批量 Zone / Slot 更新跨越多个 Resource Document 时，使用事务、部分成功还是预检后提交？
8. Tool Mount、Mode Gate 和 Agent Step 是否参与 Zone Tree，还是作为并行 Capability 结构显示？

这些问题未拍板前，前端可以完成资源内选择、批量交互和静态 Projection 表现，但不得宣称与最终 PromptBuild 行为完全一致。
