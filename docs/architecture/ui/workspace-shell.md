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

关闭 Dock 不改变当前聊天身份。活动工作面板由统一 `/studio` 下的 History State 表达，URL 主要承接外部入口；仅悬停 Menu 入口可以临时预览导航，但不会写入历史或展开工作面板，移出后自动关闭。

Dock 导航负责切换模块，不承担领域数据本身。资源、预设、API 配置等内容由各自工作面板渲染。此外，应用顶层（`app.tsx`）统一挂载跨面板全局浮层宿主：Promise 驱动的阻断确认弹窗 `ConfirmDialogHost`、从 Rail「统计」入口打开的 [`StudioDashboard`](../../../apps/studio-client/src/app/studio-dashboard.tsx) 浮层（由 `StudioDashboard` 单点持有 `useWorkbenchView('dashboard.tab', 'overview', ...)` 状态并向 `useDashboard` 与 [`DashboardDialog`](../../../apps/studio-client/src/widgets/dashboard/dashboard-panel.tsx) 传入 `view` / `onViewChange`，`storage` 标签页提供受服务端序列化保护的“备份数据库”/`dashboard.createBackup` 入口并在成功后递增 `storageRevision` 刷新快照）、资源下载更新提示以及官方扩展首次安装引导。

在排查与观测入口上，[`InspectorPanel`](../../../apps/studio-client/src/widgets/inspector-panel/inspector-panel.tsx) 顶部嵌入三联排错视图 [`RunTroubleshootingLedgers`](../../../apps/studio-client/src/features/observability/ui/run-troubleshooting-ledgers.tsx)（由 [`use-run-ledgers.ts`](../../../apps/studio-client/src/features/observability/model/use-run-ledgers.ts) 驱动），将同一轮次的 Prompt Projection（`observations.getBuild`）、Model Calls（`observations.getRequest`）与 Diagnostics & Logs（`logs.list` + `diagnostics.list`）按 `runId`、`correlationId` 与 `buildId` 关联展示，支持 `All (3-Ledger)` 统一视图与单账本聚焦切换，并通过 `isLoading` 区分首次加载、在 Query Key 中携带 `activeSummary?.status` 以防止终态切换冻结，以及经 `role="alert"` 显式呈现 `errors.runs` / `errors.detail`。

在移动端阅读与后台生成场景下，Shell 还负责两项壳层反馈：`useMobileReadingChrome` 根据正文滚动方向与增量连续更新 `--loom-mobile-chrome-progress`，平滑收放移动端顶栏与底部输入区；`tab-attention` 在标签页失焦且后台运行结束时动态绘制红点 Favicon、更新标题前缀并触发移动端触觉反馈。

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

资产工作台内部使用 `master-detail` 与 `drilldown` 两种布局偏好，见 [AssetWorkbenchLayout](../../../apps/studio-client/src/shared/ui/asset-workbench-layout/asset-workbench-layout.tsx)。窄面板自动使用下钻导航；`mobilePane: explorer | detail` 只表示当前下钻页面，不是第三种持久布局模式。Master–Detail 的目录宽度仍由分隔条调整，旧 explorer/split/editor 三态不再是当前合同。

Window 内部使用 Column Layout 表达水平并列区域。Rail、Explorer、Detail 或其他内容只作为 Column 内容参与宽度分配；Header、Bottom 和覆盖式 Sidebar 属于 Window Overlay，不进入 Column Track。Reference Window 根据 Narrative 与 Composer 的实时锚点选择并行或遮挡正文的默认 Placement。正式合同见 [`window-layout.md`](window-layout.md)。

## 5. 布局状态

当前布局状态使用 Zustand 管理，并通过 `localStorage` 持久化。已保存的状态包括：

- Dock 是否打开；
- 每个面板各自的窗口尺寸，以及所有工作面板共享的 `reference` / `immersive` 窗口模式；
- 工作窗口功能导航 Column 的宽度；
- 资源工作台的目录宽度；
- 每个工作区的展开目录、当前条目和视图模式；
- 元信息面板是否打开；
- 长文本编辑器的源码 / 渲染模式。

当前 Panel、Timeline/Branch、明确的资源目标与查看条件由导航的 History State 持有，并按 endpoint 恢复最后工作区位置；普通目录节点的局部编辑器选择仍归工作台。资源 URI 标识目标，外部深链解析后归一化到 `/studio`，不把资源正文或未提交草稿放进导航。Session 的查看入口和工具浮层按各自导航合同处理，边界详见 [`navigation-and-routing.md`](navigation-and-routing.md)。

子 Tab、分类等枚举浏览偏好统一使用 `shared/studio-shell/use-workbench-view.ts`，由同一个 `useStudioLayoutStore.viewPreferences` 持久化。调用方声明稳定 key、默认值和当前可用值；移除或不可用的 Tab 回退到默认值。普通重挂载不重置偏好，明确的路由目标仍由宿主优先处理。不要把业务草稿、加载结果、错误或 Dialog 开关接入此 Hook。

同次客户端会话中，`useStudioNavigation` 在离开位置前把面板的 `search/resourceId/assetId`、工具浮层的 `toolSearch` 保存到 `panelPositions`，按 endpoint、浏览角色、展示类型（panel/tool）与面板 ID 隔离；扩展工作面板不会覆盖扩展管理工具的位置。普通面板入口恢复该位置，明确 URI / 资源跳转不套用记忆。这份位置表不写入 localStorage，重载后的最后工作区仍沿用既有 workspace 恢复合同，避免持久化第二份完整导航历史。

持久化是客户端体验状态，不是领域数据。浏览器存储不可用、内容损坏或版本迁移失败时，必须安全回退到默认布局，不能阻止 Studio 启动。

## 6. 启动恢复与开发 Fixtures

根应用使用 Error Boundary 捕获 React 渲染失败，记录到客户端 Logger，并提供重新加载和返回聊天的最小恢复入口。该入口不依赖 Router，以便 Router 自身失败时仍可使用。

角色墙、长对话、搜索压力资产、模型目录和外部图片 CDN 等视觉验收 Fixtures 仅在 Vite 开发环境启用。生产环境以真实数据或空状态启动，不自动创建 Demo Card，也不向真实角色注入测试媒体。

## 7. 当前边界

### 异步操作状态、Query 缓存与前端基础设施边界

Studio 的临时异步状态按 `bootstrap`、`cards`、`resources`、`provider-settings`、`session` 和 `mutation` 分域管理。一个域的读取或写入不会锁死其他无关面板；错误也保留在发生操作的域内，再由 Shell 选择最新错误展示。

尚未迁移到 Query 的可能竞态读取使用 latest-wins：旧请求可以在 Bridge 中自然完成，但完成后不得覆盖更新的界面状态。Mutation 不采用 latest-wins，必须完整执行；Context Asset 写入继续由现有队列保证顺序。

`@tanstack/react-query`（根应用在 [`main.tsx`](../../../apps/studio-client/src/main.tsx) 配置 `refetchOnWindowFocus: false`、`refetchOnReconnect: false`、`retry: false`、`staleTime: 30_000`）作为已迁移远端状态的权威缓存层，负责同 key 请求去重、缓存、占位保留与失效；Query Cache 不是领域持久化，也不保存未提交草稿。当前权威消费者已覆盖：

- 角色卡目录与详情（[`use-cards.ts`](../../../apps/studio-client/src/features/cards/model/use-cards.ts)）；
- Provider 账号、AI 能力预设与网关提供商（[`use-provider-settings.ts`](../../../apps/studio-client/src/features/provider-settings/model/use-provider-settings.ts)、[`use-explicit-catalog.ts`](../../../apps/studio-client/src/shared/api/use-explicit-catalog.ts)）；
- 用量、游玩、资源库存与存储/数据库快照（[`use-dashboard.ts`](../../../apps/studio-client/src/features/dashboard/model/use-dashboard.ts)、[`studio-dashboard.tsx`](../../../apps/studio-client/src/app/studio-dashboard.tsx)）；
- 模型观测与 Inspector 三联排错账本（[`use-observations.ts`](../../../apps/studio-client/src/features/observability/model/use-observations.ts)、[`use-run-ledgers.ts`](../../../apps/studio-client/src/features/observability/model/use-run-ledgers.ts)）；
- 历史预览与会话摘要状态（[`use-history-previews.ts`](../../../apps/studio-client/src/features/sessions/model/use-history-previews.ts)、[`use-session-summary-status.ts`](../../../apps/studio-client/src/features/sessions/model/use-session-summary-status.ts)、[`session-summary-activity.tsx`](../../../apps/studio-client/src/features/sessions/ui/session-summary-activity.tsx)）；
- 运行时状态变量与来源检查（[`state-variables-panel.tsx`](../../../apps/studio-client/src/features/state-variables/ui/state-variables-panel.tsx)、[`state-sources-panel.tsx`](../../../apps/studio-client/src/features/state-variables/ui/state-sources-panel.tsx)）；
- 扩展包列表、模块批处理与包内资源预览（[`use-client-extension-runtime.ts`](../../../apps/studio-client/src/features/extension-renderers/model/use-client-extension-runtime.ts)、[`extension-module-batches.tsx`](../../../apps/studio-client/src/features/extension-renderers/ui/extension-module-batches.tsx)、[`extension-package-resources.tsx`](../../../apps/studio-client/src/features/extension-renderers/ui/extension-package-resources.tsx)）；
- 文本转换目录、Prompt Resource / Lore Mount / Tool Mount、官方内容、用户档案、个人背景与全局搜索等其余已迁移模块。

实时缓存失效统一通过 [`subscribeDataCommits`](../../../apps/studio-client/src/shared/api/data-commit-events.ts) 监听共享 `/extensions/events` SSE 连接上的 `data.changed` 事件：消费者匹配 `entityType` 与 `scope?.entityType`（包括 `airp.*` 文档类型如 `airp.cardSource`、`airp.providerProfile`、`airp.aiCapabilityProfile`、`airp.textTransformRule`、`airp.textExtractor`，以及大提交折叠后的 `documents.*` 通配符）；当事件携带 `overflow: true` 时（即使 `operations` 非空而是包含折叠后的 `documents.*` 条目），`subscribeDataCommits` 立即触发 `onConnected()` 回调使订阅方执行全量刷新，避免遗漏变更。未迁移领域仍按各自 feature 的现有读取模型工作，完整依赖所有权见 [`../platform/external-dependency-ownership.md`](../platform/external-dependency-ownership.md)。

此外，两项客户端专项基础设施约定如下：

- **Tokenizer 惰性 Worker 隔离**：主包仅从 `@loom-studio/shared/tokenizer/contracts` 导入类型、限额常量与 `applyTokenMultiplier`，绝不将 `gpt-tokenizer` 词表打入主 bundle；完整计数入口 `@loom-studio/shared/tokenizer` 只在 [`tokenizer.worker.ts`](../../../apps/studio-client/src/shared/tokenizer/tokenizer.worker.ts) 内加载，由 [`client.ts`](../../../apps/studio-client/src/shared/tokenizer/client.ts) 在首次计数时惰性创建 Dedicated Worker（`use-token-counts.ts` 提供 300ms 防抖与 `AbortSignal` 取消，支持单批最多 128 项、单文本 1,000,000 UTF-16 code units、队列上限 32）。
- **角色媒体 `?v=` 不可变缓存**：[`cardMediaUrl`](../../../apps/studio-client/src/shared/lib/card-media.ts) 在 `/cards/:cardId/media/:target` 地址中拼接 `&revision=${mediaRevision}` 及可选 `&v=${encodeURIComponent(updatedAt)}`；服务端 `handleCardMedia` 在 `?v=` 匹配角色 `updatedAt` 或 `version` 时返回 `Cache-Control: private, max-age=31536000, immutable`，否则回退 `no-cache` 并结合 `ETag` / `304` 协商，SSE `directories.media.changed` 与重连触发 `invalidateCardMedia()` 刷新 `mediaRevision`。

下列能力尚未实现，不属于当前 Shell contract：

- 多个窗口沿横向轨道并列；
- 同一资源的多实例编辑；
- 插件注册和恢复独立窗口；
- 跨窗口拖动、排序和 suspend；
- 完整移动端窗口交互。

历史设计依据见 [`Workspace 与 Motion 旧稿`](../../archive/discussion/ui/widget-workspace-and-motion-v0.md)，当前演进以 [UI Plan](../../workbench/plans/ui/README.md) 为准。
