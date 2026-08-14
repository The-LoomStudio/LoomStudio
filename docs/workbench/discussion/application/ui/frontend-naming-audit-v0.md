# Frontend Naming Audit v0

> **状态**：Migration Complete / Deferred Items Recorded  
> **基线**：2026-08-13，`apps/studio-client/src` 当前工作树。  
> **上游词汇**：[`frontend-interface-language-v0.md`](frontend-interface-language-v0.md)。  
> **范围**：组件、文件、类型、状态、动作、CSS Module、`data-loom-*`、CSS Token 与 I18N Key 的命名一致性。  
> **非目标**：不改变后端 Schema、RPC、Session/Card Resources，也不把局部私有类名升级为公共 API。

## 1. 结论

当前 Client 的文件形态规范基本稳定：源码使用 kebab-case，React 导出使用 PascalCase，模块目录也大多能表达所属领域。主要问题不是大小写或文件格式，而是界面对象语言尚未统一：

1. Studio Shell、Dock、Window、Panel 在当前复合实现中互相混用；
2. `Overlay`、`Sheet`、`Canvas` 等旧名称已经不符合当前交互合同；
3. `Entry`、`Message`、`Card`、`Item` 有时按领域身份命名，有时按视觉外形命名；
4. `active`、`selected`、`focused`、`open`、`mode`、`view` 的局部语义没有始终写进名称；
5. `data-loom-*` 和 `--loom-*` 已承担 Custom CSS 公共入口，不能按内部重构方式直接替换。

这不是一个适合“统一改名”的任务。合理顺序是先冻结新增代码规范，再按对象链进行迁移，每批同时更新组件、文件、Props、Store、CSS Hook、I18N、测试和文档。

## 2. 调查范围

当前 Client 约包含：

| 对象 | 数量 |
| --- | ---: |
| TSX 文件 | 41 |
| 导出的 React Component / Class | 39 |
| CSS Module 文件 | 29 |
| 静态 `data-loom-component` 使用 | 37 |
| 静态 `data-loom-slot` 使用 | 1 |
| 中文 I18N Key | 343 |
| 唯一 `--loom-*` 定义 | 94 |

审计按七条命名链检查：

```text
产品对象
→ 中文 / 英文术语
→ React Component / Type
→ kebab-case file
→ state / action
→ CSS Module / data-loom hook / token
→ I18N key and visible label
```

## 3. 当前已经一致的部分

以下命名无需为了本轮规范机械修改：

- `SettingsPanel`、`CharacterPanel`、`ModelPanel`、`InspectorPanel` 已明确表示 Window 内的功能 Panel；
- `AssetWorkbenchLayout` 正确表达 Panel 内的复合资产编辑工作台；
- `AssetExplorer`、`detailPane` 和 `splitter` 基本符合 Explorer / Pane / Splitter 的层级；
- `NarrativeEntry`、`Timeline`、`Session`、`Branch`、`AgentTranscriptEntry` 等领域类型已经区分正文与运行记录；
- `ChatComposer` 准确表达输入区不仅是一个 Message Input；
- `Dialog`、`ContextMenu`、`Toast` 已有不同交互合同，没有全部塞进通用 Overlay；
- `activePanel`、`selectedCardIds`、`expandedIds` 等多数状态在所属范围内语义明确；
- kebab-case 文件名与 PascalCase 导出整体符合现有 Code Style。

规范化不等于把所有名称换掉。已经准确的名称应保持稳定。

## 4. 空间对象命名审计

### 4.1 Studio Shell 链

当前实现：

```text
StudioPage
└── .workbench / data-loom-component="studio-workspace-shell"
    ├── application-layer-stage
    ├── base-chat-canvas-layer
    └── floating-widget-dock
        ├── dockSidebar
        ├── StudioRail
        └── StudioPanelHost
```

主要问题：

- `studio-workspace-shell` 同时包含 Workbench 和 Shell，两者层级不同；
- `floating-widget-dock` 把代码分层词 `Widget` 暴露为公共 UI 名称；
- 当前 `.floatingDock` 同时包含 Dock、Rail、Window Frame 和 Panel Host，名称只描述了其中一部分；
- `.dockSidebar` 实际是 Dock 内部容器，不是产品意义上的固定 Sidebar；
- `.floatingDockActive` 实际意味着存在活动 Panel，并且复合容器展开为工作 Window，`active` 所有者不明确；
- `dockWorkspaceToggle` 实际执行打开 Character Panel 或关闭当前 Panel，不是简单的 Workspace Toggle。

目标语言：

```text
StudioShell
├── BaseCanvas
├── StudioDock
│   ├── DockTrigger
│   └── StudioRail
└── WindowHost
    └── StudioWindow
        ├── WindowFrame
        └── PanelHost
```

这里先确定对象，不预设必须立即拆成相同数量的 React 组件。当前复合 DOM 可以逐步演进，但新增名称必须按目标层级表达。

### 4.2 Window 与 Panel 状态

当前 `PanelWindowMode`、`panelWindowSizes` 和 `togglePanelWindowMode(panel)` 把 Window 几何挂在 Panel ID 上。这在单窗口、单 Panel 实例阶段可以工作，但长期语言存在所有权冲突：

- Panel 是功能内容；
- Window 才拥有 Size、Placement、Mode 和实例生命周期；
- 同一个 Panel 未来可能在多个 Window Instance 中打开。

当前不应只做表面重命名。多窗口建模前保留现有数据结构，未来应演进为：

```text
WindowId → WindowLayout
WindowLayout.panelId → Panel identity
WindowLayout.size / mode / placement → Window state
```

因此 `PanelWindowMode` 属于“架构迁移后改名”，不是当前独立清理项。

### 4.3 Panel、Pane 与 Stage

明确冲突：

- `StudioPanelStage` 内部 Class 使用 `.stagePanel`，词序和所有者不稳定；
- 动态 Hook `overlay-${panel}-layer` 把长期 Panel 称作 Overlay；
- `InspectorPanel` 使用 `data-loom-component="overlay-utility-layer"`，与实际 Panel 身份冲突；
- `ModelPanel` 根 Class 叫 `.modelPane`，组件与样式层级不一致；
- Asset Workbench 的局部根变量叫 `shell`、`shellWidth`，容易与正式 `StudioShell` 混淆。

候选方向：

| 当前 | 候选 | 说明 |
| --- | --- | --- |
| `stagePanel` | `panelStage` | 表达 Panel 在 Host 中的 Stage |
| `overlay-${panel}-layer` | `${panel}-panel` | Panel 不是 Overlay |
| `overlay-utility-layer` | `inspector-panel` | 使用真实产品对象 |
| `modelPane` | `modelPanel` | 根对象是 Panel |
| Asset `shell` | `workbench` / `layoutRoot` | 避免占用 Studio Shell 术语 |
| `shellWidth` | `workbenchWidth` / `containerWidth` | 表达真实测量对象 |

## 5. 内容与叙事对象命名审计

### 5.1 `NarrativeCanvas`

当前组件同时负责：

- Timeline Scroll；
- Active Entry；
- Entry Anchor；
- Conversation Navigator；
- Message Rendering；
- Message Edit / Copy / Fork Actions。

它的主体是 Narrative Timeline，而不是自由布局 Canvas。`Base Chat Canvas` 可以继续作为上层空间对象，但组件建议迁移为：

```text
NarrativeTimeline
narrative-timeline.tsx
NarrativeTimelineProps
data-loom-component="narrative-timeline"
```

内部继续保持：

```text
NarrativeEntry：领域记录
ChatMessage：Entry 的 UI 呈现
MessageBody / MessageFooter / MessageActions：消息组成
```

不应把领域类型 `NarrativeEntry` 重命名成 Message。

### 5.2 `ConversationNavigator`

当前组件只消费 Timeline Item、Active ID 和 Navigate Action，但位于 Shared UI。这里存在两个合理方向：

1. 保持通用：`TimelineNavigator<T>`；
2. 承认产品专用：`NarrativeNavigator`。

在没有第二个消费者前，不为理论复用泛型化。建议随 Narrative Timeline 迁移时收紧为 `NarrativeNavigator`，除非届时出现真实的其他 Timeline 消费者。

### 5.3 Card、Entry 与视觉 Card

明确问题：

- Character Panel 内局部类型 `CardView` 过于宽泛；
- `SessionCard` 实际 Props 是 `BranchView`，领域身份与视觉名称不一致；
- `ProviderAccountItem` 使用 Item 合理，但如果未来成为完整可编辑对象，应根据交互身份升级为 Row 或 Card。

候选：

```text
CardView → CharacterCardSummary / CharacterCardView
SessionCard → SessionBranchCard / BranchCard
```

是否使用 Card 取决于领域身份和稳定视觉合同，不能因为有圆角就叫 Card。

### 5.4 Group Picker

`GroupSheet` 当前拥有 `role="dialog"`、Backdrop、Focus Trap 和 Panel-local Modal 行为，已不再是 Sheet。

建议：

```text
CharacterGroupDialog
character-group-dialog.tsx（真正拆文件时）
openCharacterGroupDialog()
closeCharacterGroupDialog()
--loom-radius-dialog
data-loom-component="character-group-dialog"
```

如果其主要任务最终仅是选择目标分组，也可以使用 `GroupPickerDialog`。`Picker` 表达任务，`Dialog` 表达交互层，两者不冲突。

## 6. Widget、Workbench、Manager 与 Viewer

### 6.1 Widget

`widgets/` 是代码分层目录，表示页面级组合组件。它可以继续存在，但不得进入：

- 用户 UI 文案；
- 产品对象词汇；
- 公共 CSS Hook；
- Window / Panel 架构名称。

因此 `floating-widget-dock` 是明确迁移项，而 `apps/studio-client/src/widgets/` 不是。

### 6.2 Workbench

Workbench 用于复杂任务界面是合理的：

- `ContextWorkbench`：目录、详情、Projection 等组合任务；
- `PresetWorkbench`：资产与 Agent Runtime Profile 的组合任务；
- `AssetWorkbenchLayout`：Shared 复合布局。

但这些组件当前直接作为 Panel 内容装配。未来可以选择：

```text
ResourcePanel
└── ContextWorkbench

PresetPanel
└── PresetWorkbench
```

不要求为了名词纯洁立即增加一层空 Wrapper；等 Panel Header、生命周期或权限需要真实边界时再拆。

### 6.3 Manager

`AgentRuntimeManager` 是 React UI，但 `Manager` 容易被理解为长期状态或服务对象。当前组件实际提供 Profile 列表、创建、选择和编辑。

候选名称取决于最终 UI：

- `AgentRuntimeProfileEditor`：强调编辑；
- `AgentRuntimeProfileList`：只负责列表；
- `AgentRuntimeProfilesPanel`：成为完整 Panel；
- `AgentRuntimeProfileSection`：仍是 Preset Panel 内一部分。

Provider 后端合同尚未稳定，本项只记录，不立即迁移。

### 6.4 Viewer

`LogViewer` 作为“日志查看器”本身不是错误，但它当前直接承担 Logs Panel 内容。如果未来需要 Panel Header、筛选布局和可复用 Records Viewer，建议拆成：

```text
LogsPanel
└── LogViewer / LogRecords
```

没有第二个消费场景前不强制拆分。

## 7. 状态命名审计

### 7.1 正确区分

建议冻结：

```text
activePanelId       当前驱动 Window 内容的 Panel
selectedEntryId     用户选择的 Entry
focusedNodeId       DOM 键盘焦点对应 Node
expandedNodeIds     已展开的 Tree Node
openDialogId        已打开的 Dialog
previewedEntryId    临时预览但未激活的 Entry
```

### 7.2 当前明确冲突

| 当前状态 | 实际含义 | 候选 |
| --- | --- | --- |
| FileTree `activeNode` | 正在 DnD Overlay 中拖动的 Node | `draggedNode` / `dragPreviewNode` |
| Character `editing` | 当前 Profile 是否处于编辑模式 | `profileEditing` / `profileEditMode` |
| Character `page` | Gallery / Profile 两种 Panel View | `characterView` / `panelView` |
| Context `viewModes` | 每个 Asset 的 Asset / Projection 内容视图 | `assetContentViews` / `workspaceViews` |
| `floatingDockActive` | 有活动 Panel，复合容器展开成工作 Window | 架构拆分后分别表达 `windowOpen` 与 Panel Active |

局部短函数中的 `current`、`result`、`value` 不自动视为问题。只有当变量跨越较大作用域、代表稳定产品对象或需要跨文件理解时，才要求完整名称。

### 7.3 Mode、View 和 Layout

当前需要校准：

- `AssetViewMode = explorer | split | editor` 同时包含可见内容和布局排列，更接近 `AssetWorkspaceView`；
- I18N 的“全屏编辑模式”实际只是隐藏 Explorer，不是 Browser Fullscreen 或 Window Immersive；
- `PresetPanel = assets | order` 实际是 Preset Panel 内的 Section/View，不是 Panel ID；
- `PanelWindowMode = reference | immersive` 的 Mode 语义正确，但所有者未来应迁到 Window Instance。

候选：

```text
PresetPanel → PresetSection / PresetView
context.viewModeEditor → “仅编辑器视图” / Editor-only View
AssetViewMode → AssetWorkspaceView（领域确认后）
```

## 8. 动作命名审计

### 8.1 当前良好模式

- `openAssetDetail()`、`navigateToEntry()`、`assignCardsToGroup()`、`refreshTimeline()` 能明确表达对象和动作；
- DOM Event Adapter 使用 `handleKeyDown()`、`handlePointerMove()` 合理；
- Model Helper 使用 `read*`、`create*`、`sanitize*` 与现有代码风格一致。

### 8.2 需要收紧的模式

- `enterSelection()` / `exitSelection()` 实际操作 Selection Mode，应使用 `enterSelectionMode()` / `exitSelectionMode()`；
- `closeGroups()` 实际关闭 Group Dialog，不是关闭 Group 领域对象；
- `openGroupsForCards()` 实际准备选择并打开 Group Picker Dialog；
- `togglePanelWindowMode(panel)` 把目标模式隐藏在 Toggle 中，未来跨窗口 API 应使用明确 `setWindowMode(windowId, mode)`；
- `dockWorkspaceToggle` 既可打开 Character Panel 又可关闭 Panel，不应继续作为长期对象名。

新增跨模块 API 优先使用明确目标状态。局部按钮回调仍可在确实双态时使用 `toggle`。

## 9. I18N 命名审计

当前 I18N Key 多数按领域 Namespace 组织，基本健康。明确需要校准的项目：

| 当前 Key / 文案 | 问题 | 候选方向 |
| --- | --- | --- |
| `rail.label = 工作台` | Rail 不是整个 Workbench | `导航`、`功能导航`，或拆分 `dock.label` / `rail.label` |
| `rail.closeWorkspace = 收起工作面板` | Action 实际关闭当前 Panel，Workspace/Panel 混用 | 随 Window/Panel 行为确认后改为 `关闭当前面板` 或 `关闭窗口` |
| `context.assetsLabel` | 中文“资产视图”，英文“Asset Explorer”不一致 | 明确是 Explorer Label 还是 View Label |
| `context.viewModeEditor = 全屏编辑模式` | 不是 Fullscreen，只是 Editor-only | `仅编辑器视图` |
| `timeline.*` | 与组件 `NarrativeCanvas` 不一致 | 组件迁移到 Narrative Timeline 后对齐 |

I18N Key 是内部 typed contract，可以在单批中原子修改；用户可见文案则必须先确认产品称呼。

## 10. CSS Module 与公共 Hook

### 10.1 CSS Module

CSS Module Class 是局部实现，不需要把所有 `.content`、`.header`、`.actions` 改成长名称。以下情况才进入整改：

- 名称和所属对象层级冲突，例如 `modelPane` 对应 Panel 根；
- 同文件内难以区分多个 Header / Content；
- Class 被 TSX 当作稳定状态语言使用；
- 后续拆组件时会造成对象所有权误判。

### 10.2 `data-loom-*`

这些 Hook 已被文档定义为 Custom CSS 公共入口。明确冲突包括：

```text
studio-workspace-shell
floating-widget-dock
overlay-utility-layer
overlay-${panel}-layer
narrative-canvas
message-content（应评估 message-body）
```

不能直接替换的原因：外部 Custom CSS 可能使用精确属性选择器：

```css
[data-loom-component="narrative-canvas"] { ... }
```

建议迁移策略：

1. 新对象先增加独立 `data-loom-object` 或稳定父/子边界，不立即删除旧 Hook；
2. 文档把旧 Hook 标记 Deprecated，并说明新入口；
3. 在约定的兼容版本窗口内继续保留旧 Hook 所在 DOM；
4. 只有明确进行 CSS Contract Major Revision 时才删除旧入口。

同一属性不能安全承载两个精确值，因此不要简单把值改成空格列表并假设旧 `[attr="value"]` 仍能匹配。

### 10.3 CSS Token

Token 重命名也必须保持旧 Custom CSS Override 可继续生效。推荐别名方式：

```css
:root {
  --loom-radius-control: var(--loom-control-radius, 4px);
}
```

具体 Alias 方向需要根据旧 Token 是否已有消费决定。零消费 Token 可以更自由地删除，但已公开文案承诺 `--loom-*` 可覆盖，仍应记录变更。

## 11. 问题分级

### P1：新增代码立即禁止继续扩散

- 产品对象或公共 Hook 中使用 `Widget`；
- 把长期 Panel 命名为 Overlay；
- 新增含糊的 `Container`、`Wrapper`、`ThingManager`；
- 使用 `active` 代替明确的 selected / focused / open；
- 用 `Mode` 命名纯视觉 View，或用 `View` 命名持久领域状态；
- 新增未进入词汇表的全局 Token 或 `data-loom-component`。

### P2：下一轮可独立迁移

- `GroupSheet` → Group Picker Dialog；
- FileTree `activeNode` → `draggedNode`；
- `overlay-utility-layer` → Inspector Panel Hook；
- `overlay-${panel}-layer` → Panel Hook；
- `modelPane` → `modelPanel`；
- I18N 中 `全屏编辑模式` 和中英文 Explorer Label 不一致。

这些对象边界清楚，迁移风险主要来自 Custom CSS Hook 兼容。

### P3：随所属模块重构迁移

- `NarrativeCanvas` → `NarrativeTimeline`；
- `ConversationNavigator` → `NarrativeNavigator`；
- Character 的 `CardView`、`SessionCard`、Selection Mode 动词；
- Asset Workbench 局部 `shell` 变量；
- `PresetPanel` 类型；
- Logs Panel / Log Viewer 边界。

### Deferred：等待架构或领域稳定

- Dock 与 Window 从当前复合 DOM 中真正分离；
- `PanelWindowMode`、`panelWindowSizes` 迁移为 Window Instance State；
- Agent Runtime `Manager` 的最终产品对象；
- Context / Resource / Worldbook 的领域词汇统一；
- 多窗口 Track、Tile、Stack、Placement 与 Focus Model。

## 12. 新增代码即时规范

从本文确认后，新代码应遵守：

1. 先在 [`frontend-interface-language-v0.md`](frontend-interface-language-v0.md) 找对象名；没有定义则先补术语，不在代码里自造近义词。
2. 组件使用“所有者 + 对象类型”：`EntryContextMenu`、`SettingsPanel`、`WindowResizeHandle`。
3. 文件名与主要导出对应，使用 kebab-case。
4. Props 使用领域动作；DOM Adapter 才使用 `handle*`。
5. State 名称同时表达对象和状态：`selectedEntryIds`、`dialogOpen`、`activePanelId`。
6. `Widget`、`Feature`、`Entity` 只描述代码层，不进入 UI 文案和公共 CSS Hook。
7. 新 `data-loom-*` 和全局 Token 必须记录到 CSS/Theming 文档或对应 Workbench 提案。
8. 不为局部一次性 Wrapper、单个像素或理论复用创建全局命名体系。

## 13. 推荐迁移顺序

```text
Phase 0：冻结新增命名规则
  本文与界面词汇表作为 Review 基线。

Phase 1：纯内部低风险命名
  FileTree activeNode、Character Mode 动词、Asset 局部 shell、modelPane。

Phase 2：交互对象纠正
  GroupSheet → Dialog；Panel / Overlay Hook 纠正；I18N 文案对齐。

Phase 3：Narrative 对象链
  NarrativeCanvas → Timeline，Navigator、Message Slot、文件和测试同步迁移。

Phase 4：CSS Token / Radius / Layout
  使用已冻结的 Window、Panel、Pane、Surface、Popover、Dialog 语言建立公开 Token。

Phase 5：Window Architecture
  真正分离 Dock、Window Host、Window Instance 和 Panel Host，再迁移 Store 与公共 Hook。
```

每个 Phase 单独 Review，不做全仓一次性 Rename。公共 CSS 入口迁移必须提供兼容说明。

## 14. 开放问题

仍需继续讨论的主要不是代码拼写，而是产品对象：

1. 当前活动 Panel 展开后的复合区域，在多窗口落地前 UI 上称“工作窗口”还是仍只称“面板”；
2. Resource、Context Asset、Worldbook 和 Setting Layer 的用户可见边界；
3. Narrative Timeline 在普通 UI 中显示“对话”“时间线”还是“叙事”；
4. Popover、Picker、Dropdown 和 Context Menu 的 Shared Primitive 边界；
5. Custom CSS Hook 和 Token 的兼容版本政策。

这些问题应逐个形成决策，不阻塞已清楚的内部命名收口。

## 15. 迁移结果（2026-08-13）

本审计中边界清楚、无需等待后端或多窗口架构的项目已完成迁移：

- FileTree `activeNode` → `draggedNode`；Character 的 Profile/Selection 动词、`GroupSheet`、`CardView`、`SessionCard` 已按真实对象收口；
- `modelPane`、`stagePanel` 与 Asset Workbench 局部 `shell*` 已纠正；
- `PresetPanel` → `PresetView`，持久化版本升级为 9，Sanitizer 继续读取旧 `presetPanel`；
- `NarrativeCanvas` 与单一消费者的 `ConversationNavigator` 已物理迁为 Narrative Timeline 对象链；
- Rail、关闭 Panel、Asset Explorer 与 Editor-only View 的 I18N Key/文案已对齐；
- Radius 建立 primitive + semantic Token，Window Gap、最小尺寸与 Rail 宽度进入可覆盖的布局 Token；Window Resize 从 Computed Style 读取对应约束；
- 新对象使用 `data-loom-object`，旧 `data-loom-component` 精确 Hook 继续保留兼容。

以下项目仍按原结论延期：Dock/Window 的复合 DOM 真正拆分、Window Instance Store、Agent Runtime Manager 最终产品名、Context/Resource/Worldbook 领域词汇和多窗口 Track/Tile/Stack 模型。旧公共 Hook 只在未来明确的 CSS Contract Major Revision 中删除。
