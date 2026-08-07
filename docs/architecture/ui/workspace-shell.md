# Workspace Shell

## 1. 空间模型

Studio 当前使用双层界面，而不是由固定侧栏挤压主内容：

```text
Base Chat Canvas
  长期存在的聊天、输入和主要内容层。

Floating Dock / Workspace
  覆盖在 Base Canvas 上方的导航与工作面板。
```

Workspace 的开合和尺寸变化不触发聊天正文重新排版。用户可以在查看资源时继续看到聊天上下文；需要完整编辑空间时，再将资源面板切换为沉浸模式。

当前实现不是多窗口管理器。一个时刻只有一个活动工作面板，横向并列窗口仍属于 Workbench 设计。

## 2. Dock 与工作面板

左上角 Menu 按钮是 Dock 的稳定入口。Dock 打开后包含：

- 统一 Page Header；
- 官方功能导航；
- 当前活动工作面板；
- 面板级窗口和视图操作。

关闭 Dock 不改变当前聊天身份。活动工作面板由 URL 表达；仅悬停 Menu 入口可以临时预览导航，但不会写入路由或展开工作面板，移出后自动关闭。

Dock 导航负责切换模块，不承担领域数据本身。资源、预设、API 配置等内容由各自工作面板渲染。

## 3. 统一 Page Header

Dock 和工作面板都被视为独立页面，使用同一 Header 语法：

- 左侧为页面身份和主操作；
- 标题、图标和导航条目遵循同一对齐基线；
- 页面级视图切换、窗口模式和更多操作位于 Header；
- Header 不进入页面主体滚动容器；
- 分隔使用有内距的短线，不使用贯穿容器的完整边框。

Header 中的按钮改变页面或窗口状态；领域表单操作留在内容区，避免把不同作用域的操作混在一起。

## 4. 窗口模式与尺寸

工作面板支持两种窗口模式：

```text
reference:
  保留 Base Canvas 和底部输入区域，用于边看资料边对话。

immersive:
  扩大编辑空间，用于长文本资源的集中创作。
```

所有非沉浸活动面板都可调整宽度、高度或双向尺寸；普通工具面板不因共享同一 Shell 就被强制全屏。窗口几何由 Shell 管理，内容组件只消费可用空间。

资产工作台内部另有三种视图动作：

- `explorer`：只显示目录；
- `split`：目录与 Detail 并列；
- `editor`：只显示 Detail。

这些是快捷布局动作，不是永久限制。在 `explorer` 中选择条目仍会进入 `split`，中线拖拽仍可调整目录宽度。

## 5. 布局状态

当前布局状态使用 Zustand 管理，并通过 `localStorage` 持久化。已保存的状态包括：

- Dock 是否打开；
- 每个面板的窗口尺寸与 `reference` / `immersive` 模式；
- 资源工作台的目录宽度；
- 每个工作区的展开目录和视图模式；
- 元信息面板是否打开；
- 长文本编辑器的源码 / 渲染模式。

当前 Panel、角色 Profile、Session 与 Branch 属于 Router 状态。资源条目选择属于工作台本地状态；显式 Asset URL 只负责初始化该选择。边界详见 [`navigation-and-routing.md`](navigation-and-routing.md)。

持久化是客户端体验状态，不是领域数据。浏览器存储不可用、内容损坏或版本迁移失败时，必须安全回退到默认布局，不能阻止 Studio 启动。

## 6. 启动恢复与开发 Fixtures

根应用使用 Error Boundary 捕获 React 渲染失败，记录到客户端 Logger，并提供重新加载和返回聊天的最小恢复入口。该入口不依赖 Router，以便 Router 自身失败时仍可使用。

角色墙、长对话、搜索压力资产、模型目录和外部图片 CDN 等视觉验收 Fixtures 仅在 Vite 开发环境启用。生产环境以真实数据或空状态启动，不自动创建 Demo Card，也不向真实角色注入测试媒体。

## 7. 当前边界

### 异步操作状态

Studio 的临时异步状态按 `bootstrap`、`cards`、`resources`、`provider-settings`、`session` 和 `mutation` 分域管理。一个域的读取或写入不会锁死其他无关面板；错误也保留在发生操作的域内，再由 Shell 选择最新错误展示。

可能竞态的读取使用 latest-wins：旧请求可以在 Bridge 中自然完成，但完成后不得覆盖更新的界面状态。Mutation 不采用 latest-wins，必须完整执行；Context Asset 写入继续由现有队列保证顺序。

这些状态只描述当前页面进程内的操作，不属于领域数据，也不持久化。当前不提供请求缓存、自动重试或 `AbortSignal`；需要这些能力时应先由 Bridge 明确取消契约，而不是在 UI 中伪装 RPC 已被取消。

下列能力尚未实现，不属于当前 Shell contract：

- 多个窗口沿横向轨道并列；
- 同一资源的多实例编辑；
- 插件注册和恢复独立窗口；
- 跨窗口拖动、排序和 suspend；
- 完整移动端窗口交互。

演进方向见 [`../../workbench/discussion/ui/widget-workspace-and-motion-v0.md`](../../workbench/discussion/ui/widget-workspace-and-motion-v0.md)。
