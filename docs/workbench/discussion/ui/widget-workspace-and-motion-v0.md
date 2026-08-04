# Widget Workspace and Motion v0

> **状态**：Accepted Direction / Open Design
> **日期**：2026-08-04
> **主题**：Sidebar / Dock / Window 统一形态、双层应用桌面、横向一维窗口工作区，以及与之配套的 Motion Contract。
> **文档边界**：本文记录已经接受的 UI 方向与仍待验证的工程问题，不是当前实现说明，也不锁定最终 React、Extension SDK 或 Renderer SDK API。

---

## 1. 决策摘要

LoomStudio 接受以下 UI 演进方向：

```text
Layer 0: Base Desktop
  长期承载 Chat、Editor、Diff、Trace 等深度工作内容。

Layer 1: Focus Treatment
  Widget Workspace 唤起时可弱化 Base Desktop，但不承担业务交互。

Layer 2: Horizontal Window Workspace
  官方模块与插件 UI 统一进入一维横向排列的 Window Frame。
```

Sidebar 不再只是传统固定侧栏。它在产品语义上同时承担：

```text
Window:
  自己拥有可交互内容和局部状态。

Sidebar:
  承载默认原生功能的导航与 Master-Detail 入口。

Dock:
  展示官方模块和插件注册入口，负责打开、唤醒和聚焦窗口。
```

本文同时接受以下初期限制：

- 同一资源只允许存在一个展示窗口；重复打开时聚焦已有实例；
- 普通条目点击只切换当前窗口内的 Detail，不新建窗口；
- 只有显式的“在工作区并排打开”动作才创建独立窗口；
- 初期不实现同一资源的多实例编辑；
- Sidebar / Dock 在桌面窗口模式中的最终位置仍未决定；
- 移动端方向上 Dock 固定在底部，但本文不定义完整移动端 Shell；
- 插件不能自行争抢全屏浮层或任意 z-index，窗口几何由 Host 统一管理。

---

## 2. 设计动机

传统 Side Panel 只能表达“当前打开一个工具面板”。随着 Studio 同时出现 Resources、Preset、Setting Layers、API、Inspector、Logs、Trace、Renderer 和插件 UI，单活动面板会产生三个问题：

1. 工具之间反复切换，失去滚动、筛选和输入上下文；
2. 固定左右栏持续挤压 Base Canvas；
3. 插件缺少统一空间，只能争抢全屏 Overlay、独立页面或自定义浮层。

另一方面，任意二维浮窗会引入窗口遮挡、z-index 竞争、拖拽、缩放和恢复布局等桌面窗口管理器复杂度。

因此采用收敛的一维模型：

> 窗口可以并列、聚焦、关闭和恢复，但只能沿水平方向排列，不允许自由重叠。

该模型保留并排比对能力，同时把空间仲裁留在 Shell 内。

---

## 3. 空间术语

### 3.1 Base Desktop

Base Desktop 是长期存在的深度工作层，候选 Surface 包括：

- Chat / Narrative；
- Card、Preset、Setting Layer 等完整 Editor；
- Diff；
- PromptBuild / Trace 深度检查；
- Dashboard；
- 完整 Custom Renderer。

Base Desktop 不因 Widget Workspace 唤起而销毁。Workspace 隐藏后，用户应返回原来的 Session、Branch、输入、滚动和编辑上下文。

### 3.2 Focus Surface

当替换 Base Desktop 的成本过高，或目标内容需要临时占领完整视口时，可以使用独立的 Focus Surface。

Focus Surface：

- 不是阻塞式 Modal；
- 拥有独立滚动和焦点边界；
- 关闭后恢复原有 Base Desktop 和 Widget Workspace；
- 适合完整 Editor、Trace、Diff 或 Renderer；
- 不作为普通列表、表单或插件设置页的默认路径。

### 3.3 Window Workspace

Window Workspace 是一维横向窗口轨道：

```text
[Sidebar / Dock] [Preset Window] [Preset Detail] [Setting Layers] [Plugin Window]
```

候选约束：

- 单行排列；
- Window 不允许互相覆盖；
- Window 使用固定尺寸档位，而不是任意 resize；
- 每个 Window 有独立纵向滚动所有权；
- Workspace 负责横向移动、聚焦和排列；
- Launcher / Dock 可以直接聚焦已打开窗口，避免 O(n) 线性查找；
- Workspace 可以整体隐藏，但隐藏不等于卸载所有窗口。

### 3.4 Window Frame

Window Frame 由 Host 负责：

- 标题、图标；
- 关闭；
- 聚焦；
- “在 Base Desktop / Focus Surface 打开”；
- 尺寸档位；
- 窗口进入、退出和排列动画；
- 焦点、键盘、ARIA；
- 可见性和 suspend 通知；
- 插件内容隔离边界。

Window Body 由第一方 Application UI 或插件负责。

---

## 4. Sidebar / Dock 统一模型

### 4.1 默认原生交互

点击官方功能或使用 Host 原生 UI 的插件入口时，默认在 Sidebar 自身的内容窗口中打开或切换：

```text
Preset Sidebar Window
├─ Master: Preset 目录、搜索、分类
└─ Detail: 当前选中的 Preset
```

普通点击目录条目：

- 只更新当前窗口内 Detail；
- 不创建新 WindowInstance；
- 保留 Master 的筛选和滚动状态。

### 4.2 显式并排打开

以下入口可以提供“在工作区并排打开”：

- 桌面端 Context Menu；
- 条目或 Toolbar 的更多操作；
- Command Palette；
- 键盘快捷键；
- 移动端长按菜单。

该动作创建独立窗口：

```text
Preset Sidebar Window
Preset Detail Window: A
Setting Layers Window
```

右键和长按不能是唯一入口。必须保留可发现且键盘可访问的命令入口。

### 4.3 默认窗口与资源单例

初期窗口身份规则：

```text
Home Window:
  每个 contribution 默认最多一个。

Resource Window:
  每个 contributionId + resourceId 默认最多一个。
```

重复打开相同资源时：

1. 唤起 Window Workspace；
2. 滚动并聚焦已有窗口；
3. 不创建第二份实例。

同一资源多实例属于高级编辑能力，初期不实现。

### 4.4 桌面位置仍待决定

Sidebar / Dock 在桌面窗口模式中的位置是当前最大开放问题。

候选方案：

#### A. 永久固定在左侧

优点：入口稳定、随时可见、实现直接。
缺点：持续占用水平空间，与浮动 Window 形态存在割裂。

#### B. 进入窗口模式后收缩或移动到顶部

优点：释放横向空间，仍保留 Launcher。
缺点：需要明确的形态转换、焦点迁移和动画生命周期，复杂度最高。

#### C. Sidebar 是轨道第一个窗口

优点：空间模型最统一。
缺点：随横向滚动离开视口后 Dock 消失，必须额外提供唤醒入口。

当前不选定方案。实现前需通过实际桌面原型验证：

- 多窗口下入口是否仍容易到达；
- Sidebar 收回是否造成视觉和焦点跳动；
- 窗口数量增长后是否仍能快速定位；
- 顶部 Dock 是否与 Title Bar、Command Palette 或全局状态冲突。

移动端方向暂定为底部固定 Dock；移动端窗口内容更接近单窗口分页，不照搬桌面横向并列。

---

## 5. 候选状态模型

以下只是前端 Shell UI 状态，不进入 Document Store 业务 Schema。

```ts
type WindowMode = 'home' | 'resource' | 'custom'

type WindowSize = 'narrow' | 'medium' | 'wide'

type WindowInstance = {
  instanceId: string
  contributionId: string
  mode: WindowMode
  resourceId?: string
  size: WindowSize
  visibility: 'visible' | 'offscreen' | 'workspace-hidden'
}

type WindowWorkspaceState = {
  visible: boolean
  focusedWindowId?: string
  order: string[]
  windows: WindowInstance[]
}
```

最小命令面：

```text
openHomeWindow(contributionId)
openResourceWindow(contributionId, resourceId)
focusWindow(instanceId)
closeWindow(instanceId)
showWorkspace()
hideWorkspace()
openInDesktop(instanceId)
```

禁止让 Window Registry 直接拥有业务数据。Window Body 仍通过对应 feature hook、typed API 或 Renderer SDK 获取数据。

---

## 6. 插件 UI Contribution

### 6.1 Host Native UI

插件可以贡献使用 Host 原生 UI 原语的内容：

- Tree / List；
- Form；
- Master-Detail；
- Toolbar / Context Menu；
- 状态与命令。

它可以复用 Sidebar 默认内容窗口，也可以通过显式动作进入独立 Window Frame。

### 6.2 Custom UI

复杂自定义 UI 默认使用独立 Window Frame，Body 可由 iframe 或受隔离 Renderer 承载：

```text
Host Window Frame
├─ Host title / close / focus / size / motion
└─ Plugin iframe or renderer body
```

Host 负责空间，插件负责内容。插件不得：

- 修改其他 Window DOM；
- 控制 Window Workspace 的 position 或 z-index；
- 自行创建覆盖整个 Studio 的全屏浮层；
- 绕过 Host 申请任意窗口几何；
- 通过 CSS 污染 Host 或其他插件。

插件间协作通过 Command、Event、Capability 或业务数据完成，不通过跨窗口 DOM 操作完成。

### 6.3 候选 Contribution 描述

```ts
type WindowContribution = {
  id: string
  title: string
  icon?: string
  preferredSize: 'narrow' | 'medium' | 'wide'
  renderMode: 'host' | 'iframe'
}
```

该类型尚未进入 Extension SDK contract。

---

## 7. 为什么 Motion 是空间系统的一部分

传统按钮 hover 可以没有动画，但双层窗口系统需要让用户理解内容去了哪里。

Motion 只服务以下空间事实：

1. Workspace 被唤起或折叠；
2. Window 被打开、关闭或聚焦；
3. Window 在一维轨道中重新排列；
4. 条目从 Sidebar / Window 打开到 Base Desktop 或 Focus Surface；
5. Sidebar / Dock 如果发生形态或位置转换，需要表达连续空间关系。

Motion 不用于：

- 每次文本刷新；
- 高频 Tab 切换；
- 大量列表项逐个 stagger；
- 装饰性无限循环；
- 用延迟掩盖数据加载；
- 让所有组件都拥有“高级感”。

---

## 8. Motion 技术分层

### 8.1 CSS Motion

CSS 负责：

- hover / pressed / focus；
- 简单 opacity / transform 反馈；
- Workspace 整体进入和退出；
- 单 Window 的基础进入和退出；
- reduced motion 下的退化。

默认不动画：

- `width`；
- `height`；
- `left` / `right`；
- 大量影响 Flex 布局的 margin；
- 无法中断的长序列 stagger。

Window 在加入轨道前先确定最终宽度，入场只动画 `opacity + transform`。空位重新排列初期可以直接发生；只有实际体验证明需要时才引入 FLIP。

### 8.2 JS / Web Animations API

JS Motion 只用于 CSS 无法可靠表达的场景：

- 可中断的 Pin to Desktop；
- FLIP 排列动画；
- 根据真实起止位置计算共享元素移动；
- Sidebar / Dock 跨区域形态转换；
- 拖拽或手势驱动动画。

初期优先使用浏览器 Web Animations API，不把第三方动画框架作为平台 baseline。

组件不得直接散落调用 `element.animate()`。出现首个真实 JS Motion 场景后，再增加极薄的 Host Motion Driver，用于统一：

- Motion Policy；
- token 读取；
- cancel / interrupt；
- reduced motion；
- 动画完成后的样式清理。

当前不创建完整 UI Motion Library。

---

## 9. Motion Policy 与 Custom CSS

关闭原生动画和关闭所有动画是不同需求。

候选 Policy：

```ts
type MotionPolicy =
  | 'full'
  | 'reduced'
  | 'custom'
  | 'off'
```

含义：

| Policy | Host 原生 Motion | 用户 Custom CSS Motion | JS Motion |
|---|---|---|---|
| `full` | 开启 | 可以覆盖公开 hook | 开启 |
| `reduced` | 仅必要反馈 | 应遵守 reduced motion | 退化或关闭 |
| `custom` | 关闭 | 允许接管 | Host JS 不启动 |
| `off` | 强制关闭 | 强制关闭 | 不启动 |

候选根属性：

```html
<main data-loom-motion-policy="full">
```

Host 原生动画规则必须显式依赖 Policy：

```css
[data-loom-motion-policy="full"]
[data-loom-component="window-workspace"][data-loom-state="opening"] {
  animation: loom-workspace-enter
    var(--loom-motion-workspace-duration)
    var(--loom-motion-easing-standard);
}
```

`custom` 模式下该规则不匹配，默认 CSS 和默认 JS 都退出，用户可以通过稳定 hook 接管，而不需要覆盖 CSS Module 类名。

候选公开状态：

```text
data-loom-component="window-workspace"
data-loom-component="window-frame"
data-loom-component="sidebar-dock"

data-loom-state="closed | opening | open | closing"
data-loom-window-id
data-loom-contribution-id
```

候选 Motion Tokens：

```css
:root {
  --loom-motion-feedback-duration: 100ms;
  --loom-motion-window-enter-duration: 160ms;
  --loom-motion-window-exit-duration: 120ms;
  --loom-motion-workspace-duration: 180ms;
  --loom-motion-easing-standard: cubic-bezier(.2, 0, 0, 1);
  --loom-motion-distance-small: 6px;
}
```

Token 是候选 public surface，正式公开前需要版本与废弃策略。

### 9.1 Cascade 和内联样式限制

为了给 Custom CSS 留出可靠空间，长期方向是：

- 内部 CSS 进入明确的 Cascade Layer；
- 用户 Custom CSS 获得更高的正常级联优先级；
- 内部 Motion 不使用 `!important`；
- Host JS 不持久化 inline `transform` / `opacity`；
- Web Animations API 完成或取消后恢复 CSS 所有权；
- CSS Motion 和 JS Motion 不同时争夺同一元素的同一属性。

`off` 模式可以作为唯一的全局强制禁用层，用于无障碍和故障排查。

### 9.2 Reduced Motion

所有非必要 Motion 必须遵守 `prefers-reduced-motion`。

Reduced 模式候选行为：

- 移除大幅位移、缩放和弹性；
- 保留必要的短 opacity 状态反馈；
- 禁用自动平滑滚动；
- Pin 操作直接完成最终布局；
- 不以动画作为状态可见性的唯一来源。

---

## 10. Window 生命周期与动画

退出动画要求 Window 在视觉关闭期间短暂保留 DOM，因此状态不能只使用 `open: boolean`。

候选生命周期：

```text
closed -> opening -> open -> closing -> closed
```

进入 `closing` 时必须立即：

- 禁止 Pointer Interaction；
- 设置 `inert`；
- 从键盘 Tab 顺序移除；
- 恢复或迁移焦点；
- 通知 Window Body 停止高成本后台活动；
- 动画结束后才卸载 DOM。

必须防止快速 open / close / reopen 产生旧回调覆盖新状态。未来实现需使用 cancel、generation id 或 AbortSignal，不依赖裸 `setTimeout`。

Custom CSS 的退出时长不能无限决定 Host 生命周期。Host 必须有可配置但有上限的退出等待时间，避免无效或无限动画阻止窗口关闭。

---

## 11. iframe 与 Renderer Motion

iframe 不继承 Host CSS Variables，也不能由 Host 跨边界控制内部 DOM。

Host 只负责：

- Window Frame Motion；
- iframe 容器尺寸；
- focus / visibility / suspend；
- 关闭和销毁。

未来 Renderer SDK 可以同步只读 Appearance Snapshot：

```ts
type AppearanceSnapshot = {
  motionPolicy: 'full' | 'reduced' | 'custom' | 'off'
  motion: {
    feedbackDuration: string
    windowDuration: string
    easingStandard: string
  }
}
```

Renderer 可以选择复用默认 Motion Contract，但 Host 无法强制不合规的隔离 iframe 停止内部动画。遵守 Motion Policy 应成为 Renderer contract，而不是虚假的跨 iframe 技术保证。

---

## 12. 滚动所有权

Window Workspace 拥有横向滚动，每个 Window Body 拥有自己的纵向滚动。

初期不全局劫持鼠标纵向 Wheel。原因：

- Window 内可能有长列表、Tree、Editor、textarea 或 iframe；
- 把 `deltaY` 直接映射为 `scrollLeft` 会抢走内部纵向滚动；
- iframe 和虚拟列表很难通过简单 `event.target` 判断；
- Trackpad 已天然提供横向输入。

初期候选输入：

- Trackpad 原生横向滚动；
- Shift + Wheel；
- Workspace 空白区域 Wheel 映射；
- Pointer Drag on Workspace Gutter；
- Launcher / Dock 直接聚焦窗口；
- `scroll-snap-type: x proximity`，不使用强制 snap。

只有真实使用证明仍然困难时，才实现“最近纵向滚动容器能否消费 delta”的 Wheel Arbitration。

---

## 13. 状态驻留与 Suspension

隐藏不等于冻结。

```css
visibility: hidden;
pointer-events: none;
```

不会自动停止 React Effect、SSE、WebSocket、timer、Canvas、WebGL 或 iframe JS。

未来需要区分：

```text
hidden:
  视觉不可见。

inert:
  不可交互、不可聚焦。

suspended:
  Body 收到提示，主动降低后台活动。

unmounted:
  销毁 DOM 和局部状态。
```

初期优先限制同时打开的 Window 数量并测量实际性能，不提前引入全局 IntersectionObserver、虚拟窗口管理或 LRU 卸载。

`content-visibility: auto` 只能在验证 sticky、focus、尺寸测量和 Popover 行为后使用；它不是免费虚拟化，也不保证释放图片、Canvas 或 GPU 资源。

---

## 14. 分阶段路线

### Phase 0: Discussion Baseline

- 记录本文；
- 不修改现有 Studio Page；
- 不创建 Window Manager package；
- 不冻结 Extension SDK API。

### Phase 1: First-party Window Workspace

- 保留 Base Chat Canvas；
- 将少量第一方面板接入 Window Frame；
- 支持多个不同窗口并排；
- 支持 Home Window 单例；
- 支持 Resource Window 单例；
- 支持 show / hide / focus / close；
- 只使用短 CSS Motion；
- 支持 `prefers-reduced-motion`；
- 不做 Pin 共享元素动画。

### Phase 2: Explicit Parallel Open

- 增加 Context Menu、Toolbar、Command Palette 的“在工作区并排打开”；
- 选取一个真实资源类型验证 Resource Window；
- 验证窗口聚焦、滚动和状态恢复；
- 决定 Sidebar / Dock 的桌面位置。

### Phase 3: Motion and Pin

- 基于真实 Pin 场景决定是否需要 Host Motion Driver；
- 必要时实现 FLIP 或共享元素过渡；
- 加入 `custom` / `off` Motion Policy；
- 验证 Custom CSS 覆盖和退出生命周期。

### Phase 4: Plugin Contribution

- 冻结最小 WindowContribution；
- Host Native UI 先接入；
- 再接入 iframe / Renderer Body；
- 同步 appearance / focus / visibility / size；
- 验证多个插件窗口同时存在但互不污染。

---

## 15. 初期非目标

- 同一资源多实例窗口；
- 任意二维浮窗；
- Window z-index 管理；
- 任意拖拽排序与 resize；
- 多行 Window Workspace；
- 完整 UI Library；
- 第三方动画框架 baseline；
- 物理 Spring 系统；
- 全局 Wheel 劫持；
- 自动 IntersectionObserver culling；
- 插件自定义 Host Window Frame；
- 插件直接修改其他插件或 Host DOM；
- 完整移动端 Shell。

---

## 16. 验收场景

未来进入实现前，至少用以下场景审查设计：

1. 点击 Preset 入口，在 Sidebar 中显示 Master-Detail；
2. 普通点击 Preset A，只更新当前 Detail；
3. 选择“在工作区并排打开”，创建 Preset A Window；
4. 再次打开 Preset A，聚焦已有 Window，不创建重复实例；
5. 打开 Setting Layers，与 Preset A 横向并列；
6. 隐藏 Workspace，再恢复时保留两个窗口的滚动和输入；
7. 关闭当前聚焦窗口后，焦点移动到明确的相邻窗口或 Dock；
8. reduced motion 下所有最终状态一致；
9. custom motion 下 Host 默认 CSS 和 JS Motion 不运行；
10. 两个插件 Custom UI 同时打开，各自在 Host Window Frame 内，不争抢全屏 Overlay；
11. 插件 iframe 不遵守 suspend 时，不影响 Host 正确关闭其 Window Frame；
12. 快速 open / close / reopen 不被旧动画回调错误关闭。

---

## 17. 开放问题

1. Sidebar / Dock 在桌面窗口模式中固定、移动还是成为轨道首窗？
2. Window Workspace 是否允许用户调整 Window 顺序？
3. 初期同时打开窗口的软上限是多少？
4. Base Desktop 是否保留多个可恢复 Surface，还是每次只有一个当前 Surface？
5. Focus Surface 与 Base Desktop 的历史和返回语义是什么？
6. Window Frame 的 `narrow / medium / wide` 具体尺寸是多少？
7. Pin 是替换 Desktop、打开 Focus Surface，还是由目标 Surface 类型决定？
8. Host Native Plugin UI 的技术边界是 React contribution、schema-driven UI，还是二者并存？
9. Custom CSS 是否可以修改 Window Frame 几何，还是只能修改 token 和 Body？
10. Window 和 Renderer 的 visibility / suspend contract 何时进入 SDK？
