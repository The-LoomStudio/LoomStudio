# Frontend Interface Language v0

> **状态**：Open Design / Naming Baseline
> **范围**：Studio Client 的产品称呼、中文 UI 文案、英文工程术语、React 组件、文件、CSS Hook、状态与动作命名。
> **目标**：让同一个界面对象在设计、讨论、文档、UI 文案和代码中拥有可追踪的一组名称，逐步结束 `Panel`、`Window`、`Widget`、`Workbench`、`Canvas`、`Entry`、`Message` 等词的混用。
> **非目标**：本文不修改后端 Schema，不要求立即批量重命名生产代码，也不把所有普通 HTML 元素包装成组件。

## 1. 核心原则

Studio 的界面语言同时服务四类场景：

1. 用户在 UI 中看到和操作的对象；
2. 产品、设计和开发讨论中的指代；
3. React 组件、TypeScript 类型、状态与函数命名；
4. Custom CSS Token 与 `data-loom-*` 公共定制入口。

同一个对象允许拥有自然的中文名和稳定的英文工程名，但不应在不同文件中被随意换成近义词。命名优先表达对象的职责和层级，不按当前视觉外形命名。

```text
中文产品名 ←→ English Canonical Term
                      ↓
              React Component / Type
                      ↓
              kebab-case file / CSS hook
                      ↓
              state and action vocabulary
```

基本约束：

- `Widget`、`Feature`、`Entity` 是代码组织层，不是用户可见对象名。
- `Window`、`Panel`、`Pane`、`Surface` 是不同层级，不互作近义词。
- `Entry`、`Item`、`Card`、`Message` 按领域身份区分，不按“列表中的一项”混用。
- 同一状态只使用一个准确动词；避免所有布尔状态都叫 `active`，所有操作都叫 `handleChange`。
- 新增公共 CSS Token 或 Hook 时，名称必须与本文对象语言一致。

## 2. 空间与容器层级

```text
Studio / 工作室
└── Studio Shell / 工作台外壳
    ├── Base Canvas / 基础画布
    ├── Dock / 浮动导航坞
    │   ├── Dock Trigger / 工作台入口
    │   └── Rail / 功能导航轨
    └── Window Host / 窗口承载区
        └── Window / 窗口
            ├── Window Frame / 窗框
            │   └── Window Controls / 窗口控制区
            └── Panel / 面板
                ├── Header / 页头
                ├── Toolbar / 工具栏
                ├── Pane / 分区
                └── Surface / 内容表面
```

### 2.1 Studio / 工作室

整个 Loom Studio 应用及其产品环境。`Studio` 是产品范围，不用于命名单个页面容器。

建议：

- 产品或文档：`Studio` / `工作室`；
- 根组件：`StudioApp`、`StudioPage`；
- 不使用：`StudioPanel` 表达整个应用。

### 2.2 Workbench / 工作台

用户组织窗口、面板和主要任务的整体工作环境。Workbench 比 Window 更高一层，也可以指 Panel 内围绕一种复杂任务形成的复合编辑界面。

允许的两种使用：

- `Studio Workbench`：整个 Studio 工作环境；
- `Asset Workbench`：Panel 内组合 Explorer、Detail、Splitter 和 View Mode 的资产编辑工作台。

Workbench 不代表一个可独立浮动的矩形，也不等于 Window。

### 2.3 Studio Shell / 工作台外壳

长期存在、负责组织 Base Canvas、Dock、Window Host 和全局交互规则的顶层界面基础设施。Shell 是架构容器，不是某个具体可见方框，也不等于“尚未打开的 Window”。

无论当前是否存在活动 Window，Studio Shell 都存在。Shell 负责：

- 提供 Base Canvas 和 Window Host；
- 保持 Dock Trigger 的稳定位置；
- 协调全局快捷键、窗口层级和可用空间；
- 为未来多窗口管理器提供宿主边界。

建议代码词：

```text
StudioShell
WindowHost
shellInsets
```

Shell 通常不拥有独立圆角，因为它不对应一个单独 Surface。

### 2.4 Dock / 浮动导航坞

工作功能与 Window 的稳定入口。Dock 可以处于收起、预览或展开状态，但它不是 Window，也不承载完整领域内容。

```text
Dock
├── Dock Trigger / 工作台入口
└── Rail / 功能导航轨
```

当前左上角 Menu 按钮是 Dock Trigger。没有打开 Panel 时，应描述为“Dock 收起且没有活动 Window”，而不是“Window 变成侧边栏”。未来 Dock 应作为 Window Launcher 独立于具体 Window。

建议代码词：

```text
StudioDock
DockTrigger
dockOpen
openDock()
closeDock()
```

### 2.5 Window Host / 窗口承载区

Shell 中管理一个或多个 Window 实例的位置。当前实现只有一个活动工作区，未来 Window Host 可以演进为横向轨道、平铺树或浮动层。

Window Host 管理实例集合与空间安排，不渲染具体领域 Panel 内容。

### 2.6 Window / 窗口

可以被窗口管理器独立定位、调整尺寸、浮动、平铺、恢复或关闭的顶层工作单元。

当前 Studio Shell 只有一个主要工作窗口。未来可能出现：

- 双浮动窗口；
- Niri 风格横向窗口轨道；
- 平铺窗口；
- “在新窗口打开”某个世界书条目或资源；
- 同一 Panel 的多个 Window Instance。

命名合同：

- `Window` 管理几何、窗口模式、平铺/浮动身份和实例生命周期；
- `Window` 不拥有具体领域数据逻辑；
- “设置”当前是 `Settings Panel`，不是 `Settings Window`；只有它被独立打开为窗口实例后，才存在 `Settings Window`。

建议代码词：

```text
StudioWindow
WindowFrame
WindowId
WindowMode
WindowPlacement
openInNewWindow()
closeWindow()
resizeWindow()
```

### 2.7 Window Frame / 窗框

Window 的非领域外壳，负责边界、尺寸 Handle、窗口标题与窗口级操作。Frame 不等于 Panel Header。

未来窗口管理器应把以下职责放在 Frame：

- 浮动、平铺和沉浸模式；
- Resize / Move；
- Window Title 与 Window Controls；
- Window Focus / Z-order；
- 窗口实例关闭和恢复。

### 2.8 Panel / 面板

Window 内承载一个完整功能域的内容区域。Panel 是用户可以明确指代的产品对象，应保留并严格使用。

现有示例：

```text
Model Panel       模型面板
Character Panel   角色面板
Preset Panel      预设面板
Resource Panel    资源面板
Inspector Panel   调试面板
Logs Panel        日志面板
Settings Panel    设置面板
```

Panel 不负责窗口几何。一个 Panel 未来可以被不同 Window 承载，也可以在同一 Window 中切换。

建议代码词：

```text
SettingsPanel
activePanelId
openPanel()
closePanel()
switchPanel()
panelHeader
```

### 2.9 Pane / 分区

Panel 或 Workbench 内由布局划分出的区域。Pane 没有独立的产品生命周期，通常随父 Panel 存在。

示例：

```text
Explorer Pane   目录分区
Detail Pane     详情分区
Preview Pane    预览分区
Metadata Pane   元信息分区
```

Pane 可以拥有独立滚动，但不因此升级为 Panel。代码中只有真实布局分区使用 `Pane`，不要用它代替 Panel。

`Pane` 描述内容区域的产品或结构身份；`Column` 描述该区域在 Window 水平布局中的几何身份。同一个 Explorer 可以同时是 Explorer Pane，并作为一个 Window Column 的内容。不要因为接入 Column Layout 就把所有内容组件重命名为 Column。

### 2.10 Surface / 内容表面

用于建立视觉层级的局部区域，不是功能模块，也没有导航身份。

示例包括编辑器外壳、日志记录块、详情信息块、代码块和局部 Raised Surface。Surface 主要影响 CSS、Radius、Background 和 Border，不应承载跨领域状态。

### 2.11 Canvas / 画布

持续存在、承载主要创作或阅读内容的开放区域。Canvas 不是任何 `div` 的美化称呼。

当前可确认的 Canvas：

- `Base Canvas` / `基础画布`：Studio 的长期背景和主要内容层；
- `Chat Canvas` / `对话画布`：承载叙事时间线与输入区的主要对话空间。

如果内容本质是有序列表或时间线，组件应优先按 Timeline 命名，Canvas 只用于更高层的空间容器。

## 3. 导航与布局对象

| 中文名 | English | 定义 | 典型代码名 |
| --- | --- | --- | --- |
| 导航轨 | Rail | Window 或 Workbench 边缘的一级功能导航 | `StudioRail`, `railTab` |
| 导航项 | Navigation Item | Rail、Menu 等导航容器中的目标 | `RailTab`, `navigationItem` |
| 页头 | Header / Page Header | Panel 或页面的身份与页面级操作区 | `PanelHeader`, `PageHeader` |
| 工具栏 | Toolbar | 针对当前内容或选择的操作集合 | `SelectionToolbar`, `EditorToolbar` |
| 标签页 | Tab | 同一区域内互斥内容视图的切换项 | `TabList`, `Tab`, `activeTabId` |
| 目录 | Explorer | 浏览层级、集合或资源结构的区域 | `AssetExplorer` |
| 窗口列布局 | Window Column Layout | Window 内不关心内容身份的水平多列布局 | `WindowColumnLayout` |
| 窗口列 | Column | 参与 Window 水平宽度分配的几何区域 | `WindowColumn`, `ColumnId` |
| 列分隔拖柄 | Column Splitter | 调整相邻 Column 宽度的交互边界 | `ColumnSplitter` |
| 窗口浮层 | Window Overlay | 覆盖 Column 且不触发布局重排的 Window 内区域 | `WindowOverlay` |
| 调整手柄 | Resize Handle | 调整 Window 或局部区域尺寸的控件 | `WindowResizeHandle` |
| 面包屑 | Breadcrumbs | 表达层级路径的导航 | `AssetBreadcrumbs` |

约束：

- `RailTab` 当前虽然使用 Button 实现，但语义是导航项，不等同于内容 Tab。
- `Sidebar` 只用于固定在一侧、长期可见的辅助区域；当前 Studio 浮动结构不应继续泛称 Sidebar。
- `Header` 必须带所有者：`WindowHeader`、`PanelHeader`、`EntryHeader`；避免单独的 `Header` 文件。
- 长期并列并占用宽度的 Sidebar 是 Column 内容；覆盖内容且不改变列宽的 Sidebar 是 Sidebar Overlay。
- Header、Bottom 或其他 Window Overlay 不进入 Column Layout；需要避让时通过 Safe Area 或滚动 clearance 表达，不改变 Column 几何。

## 4. 内容对象语言

### 4.1 Asset / 资产

可被浏览、选择、编辑、引用或组织的领域内容总称。Asset 是产品层概念，不表示某一种存储格式。

### 4.2 Resource / 资源

被某个领域消费、挂载或打包的资产。Resource 强调用途和归属关系，而不是 UI 外形。

例如 Prompt Resource 是进入 Prompt 构建体系的资源；不是所有 Asset 都自动叫 Resource。

### 4.3 Entry / 条目

具有稳定身份、可被选中、编辑、排序或引用的领域记录。

示例：

- Narrative Entry / 叙事条目；
- Worldbook Entry / 世界书条目；
- Log Entry / 日志条目；
- Transcript Entry / 运行记录条目。

`Entry` 是领域身份，不代表显示样式。一个 Entry 可以显示为 Row、Card、Message 或 Tree Item。

### 4.4 Item / 项

仅用于没有更具体领域名称的局部集合成员，或泛型组件 API。产品文案和领域类型应优先使用 Entry、Card、Message、Node、Action 等准确名称。

允许：

```ts
type ListProps<TItem> = { items: TItem[] }
```

不建议：

```ts
const item = narrativeEntry
function deleteItem() {}
```

### 4.5 Card / 卡片

Card 有两种必须区分的语义：

1. `Card` 领域实体：Loom 的角色卡/资源包身份；
2. `Card View` 视觉呈现：一个内容对象的卡片式布局。

为了避免混淆：

- 领域实体继续使用 `Card`、`CharacterCard`；
- 纯视觉容器不创建泛用 `Card` 类型；使用具体名称，如 `ModelProfileCard`、`SessionCard`；
- 世界书条目即使以卡片显示，领域身份仍是 `WorldbookEntry`。

### 4.6 Node / 节点

树或图中的结构身份。Node 负责层级、父子关系、展开状态和路径，不自动等于 Entry。

例如 `ContextAssetNode` 可以包装 Folder、Entry 或 Virtual Node。UI 文案应显示其领域名称，不把所有对象都称作“节点”。

## 5. 对话、消息与运行记录

```text
Session / 会话
└── Branch / 分支
    └── Narrative Timeline / 叙事时间线
        └── Narrative Entry / 叙事条目
            └── Message / 消息呈现
                ├── Message Header / 消息头部
                ├── Message Body / 消息正文
                ├── Message Footer / 消息尾部
                └── Message Actions / 消息操作
```

### 5.1 Narrative Timeline / 叙事时间线

当前故事正文的有序展示与阅读结构。Timeline 表达顺序、当前位置、跳转和锚点；它不是 Agent 的内部运行日志。

建议：

- UI 中文：`叙事时间线`；一般对用户可简写为 `对话`；
- 组件：`NarrativeTimeline`；
- 文件：`narrative-timeline.tsx`；
- 当前 `NarrativeCanvas` 是待迁移候选，因为其主体实际拥有 Timeline、Entry Navigation 和 Message Rendering。

### 5.2 Narrative Entry / 叙事条目

Timeline 中具有稳定 ID、Role、Content、Parent 和 CreatedAt 的领域记录。Entry 是数据与编辑身份。

建议代码：

```text
NarrativeEntry
entryId
activeEntryId
editEntry()
forkFromEntry()
navigateToEntry()
```

### 5.3 Message / 消息

Narrative Entry 在对话界面中的用户可见呈现。Message 是 UI 对象，不应替代领域层的 `NarrativeEntry` 类型。

建议 UI 和组件结构：

```text
ChatMessage          消息整体
MessageSurface       消息内容表面
MessageBody          消息正文
MessageFooter        时间与附属信息
MessageActions       复制、编辑、分支等操作
```

用户消息、Assistant 消息和未来 Tool/Artifact 消息可以共享 Message 外层合同，但内部 Renderer 不必相同。

### 5.4 Turn / 回合

一次用户意图提交及其运行、生成和提交结果的过程。Turn 是操作和生命周期单位，不是某一条消息。

不要把 User Message 或 Assistant Message 单独叫作 Turn。

### 5.5 Composer / 输入区

负责组织并提交下一次用户输入的交互区域。中文统一称 `输入区`；需要强调能力时可称 `对话输入区`。

建议：

```text
ChatComposer
composerInput
submitComposer()
clearComposer()
```

不使用 `MessageBox`，因为 Composer 还可能包含 Preview、Attachment、Activation 和 Agent Mode。

### 5.6 Transcript / 运行记录

Agent 或 Runtime 的内部执行记录。Transcript 与 Narrative Timeline 必须分离：前者解释运行过程，后者是故事正文权威。

### 5.7 Log Entry / 日志条目

结构化日志中的一条记录。不要称作 Message，以免与对话消息混淆。代码可使用 `LogEntry`、`logEntryId`、`selectLogEntry()`。

## 6. 临时交互层

| 中文名 | English | 行为合同 | 示例 |
| --- | --- | --- | --- |
| 弹出层 | Popover | 锚定触发点、非阻断、点击外部关闭 | 条目操作、轻量选择器 |
| 右键菜单 | Context Menu | Popover 的菜单特化，来自 Context Menu 触发 | 世界书条目操作 |
| 下拉菜单 | Dropdown Menu | 由按钮触发的菜单型 Popover | 更多操作 |
| 提示 | Tooltip | 只提供简短说明，不承载操作流程 | 图标说明 |
| 对话框 | Dialog | 阻断当前流程，使用 Top Layer 和焦点约束 | 删除确认、短表单 |
| 抽屉 | Drawer | 从边缘进入、占据持续布局空间或覆盖空间 | 元信息抽屉 |
| 提示条 | Toast | 全局、短暂、非阻断反馈 | 异步错误 |
| 遮罩 | Backdrop | Dialog 等阻断层背后的交互隔离层 | Dialog Backdrop |

`Sheet` 不作为默认通用术语。只有明确采用 Bottom Sheet、Side Sheet 等空间行为时才使用；当前 Character Group Picker 的产品对象是 Panel-local Dialog，不应仅因旧组件名继续称 Group Sheet。

## 7. 交互与状态词汇

### 7.1 身份和焦点

| 状态 | 含义 | 不应混用 |
| --- | --- | --- |
| `selected` / 已选择 | 用户选择的内容对象，可用于批量操作 | `active`, `focused` |
| `active` / 当前活动 | 当前正在驱动内容或路由的唯一对象 | `selected` |
| `current` / 当前 | ARIA 或流程中的当前位置，如当前页、当前步骤 | 泛用高亮 |
| `focused` / 已聚焦 | DOM 键盘焦点所在对象 | `active` |
| `hovered` / 已悬停 | Pointer 当前悬停对象 | `previewed` |
| `previewed` / 正在预览 | 临时查看但未提交为 Active | `selected` |

示例：角色位置编辑允许多个 `selectedCardIds`；Studio 同一时刻只有一个 `activePanel`；FileTree 同时存在一个 `focusedNodeId` 和一个 `selectedNodeId`。

### 7.2 可见性和生命周期

| 状态 | 含义 |
| --- | --- |
| `open` | 可交互容器已打开，如 Dialog、Popover、Panel |
| `closed` | 容器未打开 |
| `visible` | 视觉上可见，不保证已挂载或可交互 |
| `hidden` | 已挂载但不展示 |
| `mounted` | React/DOM 实例存在 |
| `visited` | 曾打开过，因此允许 Lazy Mount 后保留实例 |
| `expanded` | 层级内容展开，如 Tree Node、Section |
| `collapsed` | 层级内容收起 |

### 7.3 操作状态

| 状态 | 含义 |
| --- | --- |
| `idle` | 当前没有进行操作 |
| `pending` | 已发起、尚未完成 |
| `busy` | 当前 UI 因某类操作不允许继续执行相关动作 |
| `loading` | 正在读取首次需要的数据 |
| `refreshing` | 已有内容仍可见，正在重新读取 |
| `saving` | 正在持久化编辑 |
| `dirty` | 本地编辑尚未提交 |
| `error` | 操作失败且需要表达失败原因 |
| `degraded` | 部分能力不可用，但核心界面仍可使用 |

不要用一个全局 `loading` 覆盖所有读取、写入和刷新。

### 7.4 Mode、View 与 Layout

- `Mode / 模式`：改变交互合同，例如 Edit Mode、Selection Mode、Immersive Mode；
- `View / 视图`：同一内容的展示方式，例如 Grid View、List View、Preview View；
- `Layout / 布局`：Pane、Window 等空间排列，例如 Split Layout、Tiled Layout；
- `State / 状态`：当前事实，不作为用户选择名称的替代品。

## 8. 动作命名

### 8.1 推荐动词

| 动词 | 使用场景 |
| --- | --- |
| `open` / `close` | Window、Panel、Dialog、Popover 等容器 |
| `show` / `hide` | 不改变对象打开合同的视觉显示 |
| `select` / `deselect` | 内容选择和批量操作 |
| `activate` / `deactivate` | 运行或规则激活，不用于普通点击选择 |
| `expand` / `collapse` | Tree、Section 等层级结构 |
| `enter` / `exit` | Mode，例如 `enterSelectionMode()` |
| `navigateTo` | 路由或 Timeline 定位 |
| `switch` | 在同级唯一对象之间切换，如 Branch、Panel |
| `create` / `delete` | 领域对象生命周期 |
| `add` / `remove` | 集合关系或临时 UI 成员 |
| `attach` / `detach` | 资源绑定关系 |
| `assign` / `unassign` | 分组、角色、责任归属 |
| `save` / `discard` | 编辑草稿提交或放弃 |
| `load` / `refresh` | 首次读取或重新读取 |
| `resize` / `move` | 几何操作 |

### 8.2 `toggle` 的边界

`toggle` 只适合调用方不需要指定目标状态的局部双态操作。跨模块 API、测试和复杂流程优先使用明确目标：

```ts
openPanel('settings')
closePanel()
enterSelectionMode()
exitSelectionMode()
```

而不是让所有行为都依赖：

```ts
toggleThing()
```

### 8.3 Event Handler

组件边界 Props 使用领域动作：

```ts
onSelectEntry
onClosePanel
onSaveDraft
```

组件内部适配 DOM Event 时才使用 `handle*`：

```ts
function handleSubmit(event: FormEvent) {
  event.preventDefault()
  props.onSaveDraft()
}
```

避免 `handleChange`、`handleClick` 这类脱离对象后无法理解的名称。

## 9. 代码与文件映射

### 9.1 React 组件

组件名使用“领域或所有者 + 对象类型”：

```text
StudioWindow
SettingsPanel
AssetExplorerPane
NarrativeTimeline
ChatMessage
MessageActions
EntryContextMenu
DeleteCardDialog
```

避免：

```text
Container
Wrapper
Box
Content
MainView
CustomPanel
```

除非这些词被清晰所有者限定并且确实表达结构。

### 9.2 文件名

文件继续遵守 kebab-case，并与主要导出对象对应：

```text
settings-panel.tsx
narrative-timeline.tsx
chat-message.tsx
entry-context-menu.tsx
delete-card-dialog.tsx
window-layout-store.ts
```

一个文件只有局部私有子组件时，不要求为每个视觉片段拆文件。

### 9.3 Hooks 与 Model

Hook 按拥有的生命周期命名：

```text
useWindowResize
usePanelNavigation
useNarrativeTimeline
useEntrySelection
```

纯模型函数按结果或动作命名：

```text
readVisibleEntries()
calculateWindowBounds()
moveSelection()
sanitizeWindowLayout()
```

不使用 `manager`、`controller`、`service` 作为默认逃生名称；只有对象真的拥有对应长期职责时才使用。

### 9.4 CSS Token 与公共 Hook

公开 Token 使用“属性 + 语义对象”：

```text
--loom-radius-window
--loom-radius-panel
--loom-radius-popover
--loom-window-gap
--loom-panel-gap
```

稳定 DOM Hook 使用同一对象语言：

```html
data-loom-object="studio-shell"
data-loom-object="settings-panel"
data-loom-object="narrative-timeline"
data-loom-component="chat-message"
data-loom-slot="message-content"
```

CSS Class 可以表达实现结构，但不应重新发明产品名。

## 10. 当前实现中的主要命名冲突

以下是迁移候选，不代表本文批准立即批量重命名：

| 当前名称 | 问题 | 候选方向 |
| --- | --- | --- |
| `NarrativeCanvas` | 主体实际是 Timeline 与 Message Renderer，Canvas 层级过宽 | `NarrativeTimeline` |
| `floating-widget-dock` | `Widget` 是代码层词，Dock 当前又承载 Window/Panel | 按窗口架构稳定后改为 `studio-window` / `window-dock` |
| `StudioPanelHost` | 当前同时渲染 Panel Header 和 Stage，名称基本成立，但应明确它不是 Window | 保留或收紧为 `PanelHost` |
| `stagePanel` | 把 Stage 和 Panel 混在一个类名中 | `panelStage` 或按滚动所有者拆分 |
| `overlay-*-layer` | 活动 Panel 并非临时 Overlay | 改为 `*-panel` Hook |
| `GroupSheet` | 当前合同是 Panel-local Modal Dialog，不是 Sheet | `CharacterGroupDialog` / `GroupPickerDialog` |
| `ContextWorkbench` | 复合资产编辑界面，Workbench 合理；`Context` 与 `Resource` 产品称呼仍需领域轮次统一 | 暂保留 |
| `CardView` | 既可能指 View Model，也可能被误解为视觉 Card | 使用具体 `CharacterCardView` 或 `CardSummary` |
| `message` CSS Class | UI 呈现合理，但对应数据类型应继续叫 `NarrativeEntry` | 保留 UI 名，避免类型改成 Message |
| `active` 泛用状态 | 混合 Panel、Entry、Filter、Selection 等不同语义 | 分别使用 `activePanelId`、`selectedEntryId`、`focusedNodeId` |

## 11. 文档与 UI 文案规则

- 第一次出现对象时写作 `中文名（English Term）`，后文统一使用中文或已定义缩写。
- UI 文案使用用户能理解的中文名，不展示代码分层词。
- Architecture 文档描述已实现合同；尚未落实的术语和迁移先保留在本文。
- Workbench 提案不得用尚未定义的近义词绕开既有对象，例如把 Panel 临时改叫 Module View。
- I18N Key 应按产品对象和动作组织，不按当前组件文件组织：`window.close`、`panel.settings.title`、`message.copy`。
- 删除或重命名术语时，同时检查组件、文件、Props、Store、CSS Token、`data-loom-*`、I18N Key、测试和文档引用。

## 12. 后续讨论域

本文先冻结通用界面骨架。下列领域仍需分别建立更细词汇表，不能在本文件中一次性拍脑袋决定：

1. Window Management：Window Track、Tile、Stack、Focus、Placement、Workspace；
2. Narrative：Timeline、Entry、Message、Turn、Checkpoint、Branch、Fork；
3. Asset and Worldbook：Asset、Resource、Document、Folder、Entry、Binding、Projection；
4. Agent and Runtime：Agent、Profile、Preset、Run、Step、Transcript、Tool Call、Artifact；
5. Editing：Draft、Dirty、Save、Commit、Revision、Undo、Redo、Conflict；
6. Interaction Layer：Popover、Menu、Picker、Dialog、Drawer、Toast、Inline Feedback；
7. Status Language：Empty、Loading、Pending、Refreshing、Degraded、Unavailable、Error。

每个领域讨论完成后，应把稳定部分晋升到对应 Architecture 文档，并建立代码迁移清单。迁移应按模块进行，不做一次性全仓重命名。

## 13. 当前提案摘要

本轮先确认以下基础语言：

```text
Window：可独立管理几何和生命周期的工作单元。
Panel：Window 内的完整功能区域。
Pane：Panel 内的布局分区。
Surface：局部视觉层级。
Workbench：组织复杂任务的工作环境或复合编辑界面。
Entry：稳定领域记录。
Message：Narrative Entry 的对话 UI 呈现。
Widget：仅用于代码分层，不进入产品对象语言。
```

这组定义是后续 Radius、Layout Token、DOM Hook、组件和文件命名整改的共同前置条件。
