# `@loom-studio/studio-client`

> **状态**：Active Workspace Guide / Current Source Is Authority

Studio Client 是 React/Vite Web Client，负责页面组合、交互状态和 typed RPC 消费。它不直接访问 Kernel、SQLite或文件系统。

开发后端运行时，可在仓库根执行 `pnpm preview:client`，构建并于 `http://127.0.0.1:18013/studio` 预览生产前端，与开发页并行。预览复用同一后端及数据，重跑命令才更新产物；使用与端口约定见[开发启动指南](../../docs/guide/getting-started.md#在开发期间预览生产前端)。

## 任务到文件与验证入口

先按任务选一行，不必从 App 逐层翻目录。下表测试是定位入口，不是每次改动都要执行的清单；按实际风险选择其中一个，存在测试也不代表当前已通过。

| 任务 / 关键词 | 第一实现入口 | 相关验证入口 |
|---|---|---|
| 角色卡列表、创建、选择、Card | [use-cards.ts](src/features/cards/model/use-cards.ts)、[character-panel/](src/widgets/character-panel/) | [card-operation-failures.test.ts](../../tests/unit/client/card-operation-failures.test.ts) |
| 角色资料/开场编辑、远程导入、目录发现 | [use-character-profile-editor.ts](src/features/cards/model/use-character-profile-editor.ts)、[use-remote-card-import.ts](src/features/cards/model/use-remote-card-import.ts)、[use-card-directory-discovery.ts](src/features/cards/model/use-card-directory-discovery.ts) | [card-editor-lifecycle.test.ts](../../tests/unit/client/card-editor-lifecycle.test.ts)；Widget 布局仍归 CharacterPanel |
| 历史面板预览、批量删除结果 | [use-history-previews.ts](src/features/sessions/model/use-history-previews.ts)、[delete-history-items.ts](src/features/sessions/model/delete-history-items.ts) | [sessions-panel-source.test.ts](../../tests/unit/client/sessions-panel-source.test.ts) |
| Timeline/Session 目录缓存、Run 控制与重放 | [use-narrative-collections.ts](src/features/narrative-runtime/model/use-narrative-collections.ts)、[use-session-run.ts](src/features/narrative-runtime/model/use-session-run.ts)、[agent-run-observer.ts](src/features/narrative-runtime/model/agent-run-observer.ts) | [card-timeline-selection.test.ts](../../tests/unit/client/card-timeline-selection.test.ts)、[narrative-run-recovery.test.ts](../../tests/unit/client/narrative-run-recovery.test.ts)、[use-timeline-session.test.ts](../../tests/unit/client/use-timeline-session.test.ts) |
| Text Transform 作者编辑与运行检查 | [use-text-transform-controller.ts](src/features/text-transforms/model/use-text-transform-controller.ts)、[use-text-transform-inspection.ts](src/features/text-transforms/model/use-text-transform-inspection.ts) | [text-transform-source.test.ts](../../tests/unit/client/text-transform-source.test.ts) |
| 剧情、主写作、Agent Session、输入投递 | [use-narrative-runtime.ts](src/features/narrative-runtime/model/use-narrative-runtime.ts) | [use-narrative-runtime.test.ts](../../tests/unit/client/use-narrative-runtime.test.ts)、[narrative-session-lifecycle.test.ts](../../tests/unit/client/narrative-session-lifecycle.test.ts) |
| 独立 Session 搜索、改名与查看 | [agent-session-picker.tsx](src/widgets/agent-chat-panel/agent-session-picker.tsx) | [agent-session-picker.test.ts](../../tests/unit/client/agent-session-picker.test.ts) |
| Agent Preset、预设选择与 Lore 使用 | [use-agent-presets.ts](src/features/prompt-resources/model/use-agent-presets.ts)、[preset-workbench.tsx](src/widgets/preset-workbench/preset-workbench.tsx) | [preset-lore-uses.test.ts](../../tests/unit/client/preset-lore-uses.test.ts)（使用配置 UI） |
| 世界书、Context Assets、资源树操作 | [tree-ops.ts](src/features/prompt-resources/model/tree-ops.ts)、[use-context-assets.ts](src/features/prompt-resources/model/use-context-assets.ts) | [context-assets.test.ts](../../tests/unit/client/context-assets.test.ts) |
| PromptBuild 展示步骤 | [build-prompt-build-steps.ts](src/features/prompt-build/model/build-prompt-build-steps.ts) | [prompt-build-steps.test.ts](../../tests/unit/client/prompt-build-steps.test.ts) |
| Provider 账号、模型选择、凭据表单 | [use-provider-settings.ts](src/features/provider-settings/model/use-provider-settings.ts) | [provider-settings.test.ts](../../tests/unit/client/provider-settings.test.ts) |
| typed API、RPC 方法映射 | [studio-api.ts](src/shared/api/studio-api.ts) | [studio-api.test.ts](../../tests/unit/client/studio-api.test.ts) |
| 全局搜索、Cmd+K、范围 Token | [use-global-search.ts](src/features/global-search/model/use-global-search.ts)、[global-search-dialog.tsx](src/widgets/global-search/global-search-dialog.tsx) | [搜索模型](../../tests/unit/client/global-search.test.ts)、[实际键盘交互](../../tests/unit/client/global-search-dialog.test.ts) |
| 通用文件树、拖放、多选 | [file-tree-model.ts](src/shared/ui/file-tree/file-tree-model.ts) | [file-tree-model.test.ts](../../tests/unit/client/file-tree-model.test.ts)、[多选交互](../../tests/unit/client/file-tree-multi-selection.test.ts) |
| Markdown、HTML、正文展示 | [message-content/](src/features/message-content/) | [message-html.test.ts](../../tests/unit/client/message-html.test.ts) |
| Token 文本计数与 Worker | [use-token-counts.ts](src/shared/tokenizer/use-token-counts.ts) | [token-counting.test.ts](../../tests/unit/client/token-counting.test.ts)、[token-worker.test.ts](../../tests/unit/client/token-worker.test.ts) |
| 撤销、编辑历史、Undo | [use-edit-history.ts](src/features/edit-history/model/use-edit-history.ts) | [edit-history.test.ts](../../tests/unit/client/edit-history.test.ts) |
| 面板、窗口、返回、导航恢复 | [studio-shell/](src/shared/studio-shell/)、[studio-page.tsx](src/pages/studio/studio-page.tsx) | [studio-workspace-navigation.test.ts](../../tests/unit/client/studio-workspace-navigation.test.ts) |
| 文案、翻译、i18n | [zh-cn.ts](src/shared/i18n/zh-cn.ts)、[en-us.ts](src/shared/i18n/en-us.ts) | [国际化规范](../../docs/guide/i18n.md)；按使用方核对，不为纯文案默认构建 |

旧名称 `agent-profiles` / `features/agent-runtime` 不能作为当前源码入口：预设选择在 `features/prompt-resources`，独立工具管理仍在 `features/agent-presets`；Narrative 与独立 Session 的客户端编排在 `narrative-runtime`。不要因为旧生成物目录仍存在而重建旧层。

## 复杂模块阅读入口

FSD 分层与状态归属见本文[架构规范](#源码导航与-fsd-架构规范)；遇到需要追踪跨模块接线的任务，再看这些局部入口：

- [App 装配](src/app/README.md)：启动前提、跨 Feature 接线与状态 facade。
- [Narrative Runtime](src/features/narrative-runtime/README.md)：Timeline、Session、Transcript 投影与 Run 生命周期。
- [Prompt Resources](src/features/prompt-resources/README.md)：资源查询缓存、Context Asset 草稿与预设选择。
- [Shared API](src/shared/api/README.md)：AppRouter 推导、tRPC 传输与领域 API 适配。

## 开发入口

正常开发从仓库根目录，在两个独立终端分别启动 Server 与 Client：

```bash
pnpm dev:server
pnpm dev:client
```

`dev:client` 会先构建并监听内部 Packages，再启动 `127.0.0.1:18011`（可通过 `PORT` 覆盖）。Vite 将 `/auth`、`/assets`、`/cards`、`/extensions` 和 `/trpc` 代理到 `STUDIO_SERVER_URL`，默认是 `http://127.0.0.1:18010`。

若 Server 通过 `PORT` 改用其他端口，启动 Client 时也需设置对应的 `STUDIO_SERVER_URL`；反之若 Client 改用其他端口，Server 亦可通过 `STUDIO_CLIENT_URL` 放行开发 Origin。RPC 使用 HTTP `POST /trpc/<procedure>`；Extension Catalog 变化使用 `/extensions/events` SSE。

定向命令：

```bash
pnpm --filter @loom-studio/studio-client dev
pnpm --filter @loom-studio/studio-client build
pnpm --filter @loom-studio/studio-client lint
pnpm exec vitest run tests/unit/client
```

直接运行 Package `dev` 不会替你监听其他 Workspace 的构建产物；日常联调优先使用根命令。上述测试命令从仓库根目录执行，使用根 Vitest 配置收集 `tests/unit/client/` 用例。Package `test` 已显式指定仓库根与 Client 测试目录，根配置拒绝零测试成功；验证时仍需核对实际执行的文件和用例数量。

## 开发组件预览

`/dev/preview/observability` 是“模型日志”的开发样例预览，固定使用样例；正式入口“日志 → 模型日志”读取后端临时观测。支持记录搜索/分类、步骤切换、消息展开与来源跳转、宏变量、工具和单步用量视图；窄屏下钻返回、列表宽度拖动均只保存在内存中。顶部可切换正常、运行中、失败、空列表和较多记录（也可用 `?scene=normal|running|failed|empty|many`），运行中为固定状态样例。所有内容与数字均为示例，不代表已有 Trace 字段或真实调用结果。

模型日志领域模型与局部展示位于 `src/features/observability/`，完整工作台和跨 Feature 接线位于 `src/widgets/log-viewer/`；`observation-view.ts` 只定义 UI 输入，不是后端契约。样例与场景控制位于 `src/dev-preview/observability-fixtures.ts`、`observability-preview.tsx`。正式数据通过 `features/observability/` 和 `observations.*` 只读 RPC 按记录、步骤懒加载，样例入口继续复用同一组件。本草稿复用不含持久状态的 `WindowColumnLayout`，避免导入会初始化布局 Storage 的工作台宿主。整体 UI 方向已获用户认可，具体状态与真实业务接入继续迭代，已确认目标见[模型日志计划](../../docs/archive/plans/prompt-run-observability-plan.md)。

开发预览仅在 Vite 开发环境显式注册，认证和业务初始化前分流，不访问真实数据或持久 Storage。启动 Client 后打开 `/dev/preview/narrative-session`，体验 Timeline Session 统一交互草稿；`?scene=empty` 从空白开始，`?scene=long` 展示较多轮次。页面内可重播工具/正文流程、讨论修订、整轮 Swipe、切换候选/预设/输出模式，以及查看副 Session 和上下文投影。模拟输出为固定样例，不调用模型。


流式阅读草稿仍使用该路由：`?scene=streaming` 自动播放长思考、工具参数与多段正文；顶部可切换慢速、均匀、突发并暂停/单步。副 Session 复用正式 `AgentChatPanel`，点击「重播副 Session」独立播放。新跟随与限高行为已接入正式 Timeline 和副 Session；真实增量继续消费现有 Run API，详情见 [局部 README](src/dev-preview/narrative-session/README.md) 和 [实施计划](../../docs/archive/plans/ui/streaming-reading-preview-plan.md)。

预览注册位于 `src/dev-preview/preview-entry.tsx`，样例与模拟控制器位于 `src/dev-preview/narrative-session-preview.tsx`，正式复用展示和轮次投影位于 `src/features/narrative-runtime/`，预览宿主与预览 Composer 位于 `src/dev-preview/narrative-session/`。新增预览必须同时在 `main.tsx` 的开发分流和显式注册中列出路径；不得加入生产路由。旧消息 HTML 演示未恢复，回归样例保留在 `tests/fixtures/client/message-html-examples.ts`。

`/dev/preview/dashboard` 提供 Dashboard 浮层草稿：复用通用 Dialog，桌面大窗口、窄屏接近全屏，关闭后保留模拟故事位置。包含概览、模型用量、游玩统计、资源、数据与存储五个视图；支持日期范围、每日柱状图选择、提供商筛选、角色搜索与排序、角色 / 提供商 / 存储分类下钻和返回。快捷管理关闭浮层并显示模拟工作区落点，再次打开保留视图与筛选。窗口标题栏切换正常、空数据、较多角色场景（也支持 `?scene=empty|many`），重置恢复内存样例。

Dashboard 展示组件为 `src/widgets/dashboard/dashboard-panel.tsx` 的 `DashboardDialog` / `DashboardPanel`，输入与操作意图位于 `dashboard-view.ts`；样例与宿主位于 `src/dev-preview/dashboard-fixtures.ts`、`dashboard-preview.tsx`。输入 `data / period`，通过 `onPeriodChange / onAction` 交给宿主处理；该类型仅为 UI 输入，不是已确定的 RPC 或持久化合同。预览页的用量、资源、分类空间及磁盘剩余仍是模拟数据，无业务请求或真实管理操作。正式 Dashboard 由 `src/app/studio-dashboard.tsx` 与 `src/features/dashboard/model/use-dashboard.ts` 接线，从工作区「活动」分组的历史下方打开浮层；查询真实统计、分页调用记录、当前资源库存及按需存储快照，快捷管理进入现有页面。已取消游玩时长，不增加活动监听。采集起点、累计保留口径、验证证据及剩余限制见 [Dashboard 实施方案](../../docs/workbench/plans/dashboard-statistics-and-resource-inventory-plan.md)。

该预览对应的[融合架构计划](../../docs/archive/plans/narrative-timeline-session-unification-plan.md)于 2026-10-24 重新授权实施。预览本身继续使用内存样例，不代表真实后端已接通；正式接线及实际验证范围见实施计划。

正式搜索入口位于工作区左上角，也可按 `⌘K` / `Ctrl+K`。最近访问仅记录本次应用会话中从搜索打开的条目。正式 Narrative 与 Agent 消息消费 `features/message-content`，完整 HTML 文档使用隔离 iframe。

`/studio/logs` 可作为日志入口，进入后归一化到 `/studio`；面板与筛选范围保存在 History State。日志页支持合并/分别查看 Server 与 Client 当前缓冲、增量轮询、扩展/运行筛选和 JSONL 历史搜索。扩展管理提供“查看日志”；`logPackage`、`logRun`、`logSource` 属于导航保存的搜索条件，不要求持续显示在地址栏。复制诊断信息提供固定预览、故障上下文/筛选结果选择与隐私提示，历史查询和当前内存的完整性分开报告。

历史只包含 Server 已保存文件；Browser 日志刷新后丢失，不自动上传。资源 URI 在用户打开时读取名称/角色头像，不写入日志或默认分享。Runs Inspector 和原生诊断助手尚未接入。

## 入口与数据流

- [`src/main.tsx`](./src/main.tsx)：创建 Client Logger，通过 `POST /auth/session` 建立应用会话，再挂载 Router 和 Error Boundary。
- [`src/app/app.tsx`](./src/app/app.tsx)：组合 Studio 页面和各 Workspace/Panel。
- [`src/app/use-studio-state.ts`](./src/app/use-studio-state.ts)：组合 Feature hooks，形成 App facade。
- [`src/shared/api/studio-api.ts`](./src/shared/api/studio-api.ts)：封装由 Server `AppRouter` 推导的 typed `application.*`、`settings.*`、`logs.*` 等 API；底层使用 [`trpc-client.ts`](./src/shared/api/trpc-client.ts) 与 Session fetch。

普通面板切换使用同一 `/studio` 的 History State，显式 URI 负责资源身份与外部跳转，不能重新用每个面板的 Path 覆盖 Timeline 上下文。恢复优先级和来源隔离见[导航架构](../../docs/architecture/ui/navigation-and-routing.md)。

资源浏览按归属进入角色或扩展面板；浏览角色不切换当前游玩角色。临时按原 ID 打开单项资源只改变查看/编辑目标，不改变归属、安装或挂载。复杂 Lore 由专用面板承载；当前不维护独立工作区包成员清单。目录或 Manifest 静态声明不等于某轮运行的实际激活结果。

Agent Preset 配置使用 Lore、正则 / 提取器、工具三个子 Tab，复用来源 FileTree、搜索和图标开关；Lore / 规则行点击跳转定义编辑，工具说明按行展开。当前角色 Lore 置顶并用星号标记，显示随 `useCardLore` 草稿变化，不为展示增加 Mount；默认采用由角色世界书总开关控制，关闭后仍可显式采用。目录不显示实际触发结果，不提供额外编辑按钮或 Lore 上下移控件。详见[资源浏览与消费配置](../../docs/architecture/ui/navigation-and-routing.md#资源浏览与消费配置)。

Session 不能中途改绑预设。“主写作”是 Narrative 输入接收 Session，与正在查看的 Session 分离；选择按 endpoint 存储范围和 Timeline 在本机持久化，不是后端全局主槽位。生成时禁止换主；暂停任务须先成功放弃，不能借切换恢复旧任务。具体合同见[Agent Runtime 与 Session](../../docs/architecture/application/agent/runtime-and-session.md#1-身份与绑定)。

Agent Chat 使用独立 [`AgentSessionPicker`](./src/widgets/agent-chat-panel/agent-session-picker.tsx)：名称输入、可搜索弹窗、重命名和主写作星号选择分别复用现有操作；新建对话通过可搜索的预设列表创建固定绑定 Session。失败保留输入或弹窗，查看切换不改变主写作选择，见[会话选择](../../docs/architecture/ui/navigation-and-routing.md#agent-会话选择)。

```text
Route / UI
  -> Feature hook / useStudioState
  -> createStudioApi
  -> typed tRPC client (AppRouter) / Session fetch
  -> authenticated POST /trpc/<procedure>
  -> Studio Server / Application Runtime
  -> DTO / Client state / UI
```

## 源码导航与 FSD 架构规范

前端严格采用 **Feature-Sliced Design (FSD)** 分层架构与单向依赖规约。下层**绝不**允许反向 import 上层；同层兄弟切片（如 widget 与 widget、feature 与 feature）**绝不**允许横向 deep import。

| 层级 (由顶至底) | 目录 | 职责与定位 | 严禁事项 (DON'Ts) |
| --- | --- | --- | --- |
| 1. App | `app/` | Provider、顶层 facade (`use-studio-state.ts`)、全局错误处理和应用装配 | 严禁直接实现具体领域状态或复杂算法 |
| 2. Pages | `pages/` | 页面 Shell 容器与全局路由视图 (`pages/studio/`) | 严禁承载具体业务操作细节 |
| 3. Widgets | `widgets/` | 页面级复杂功能块组合、局部布局与 props 传递 | **严禁包含 `bridge.call(...)` RPC 调用、树递归算法或跨 feature 刷新编排**；组件间严禁互相引用 |
| 4. Features | `features/` | 纯粹的业务模型与领域逻辑（按领域细分）：<br>• `model/`: TanStack Query 钩子、业务状态、RPC 编排与纯函数<br>• `ui/`: 绑定单个 feature 的局部 UI 组件 | 严禁包含整页级复杂排版；严禁跨 feature 直接 deep import 内部逻辑 |
| 5. Entities | `entities/` | Client 视角领域数据模型与 DTO 类型（`card.ts`, `agent.ts`, `narrative.ts` 等） | 严禁包含 widget props glue、RPC transport 或可变状态 |
| 6. Shared | `shared/` | 跨领域共享基础设施、Studio 宿主 UI 适配、typed API Client、i18n、hooks 与工具库 | 严禁重建 `@loom-studio/ui` 已有 primitive；严禁包含业务领域语义 |

### 强制开发红线
当前共享宿主能力的具体所有者：

- `shared/studio-shell/`：布局与外观偏好、Panel 标识与展示信息、导航路径、Header Portal 和窗口尺寸计算。只拥有宿主界面状态，不读取业务数据或编排业务操作；页面和 Widget 消费同一 Store，保留既有持久化键。
- `shared/extension-renderer-runtime/`：Extension 与 Loom Script 共用的 Renderer 注册、排序、Surface 策略和 Host。扩展加载及 UI 挂载仍由 `features/extension-renderers/` 负责。

1. **命名规范**：组件文件强制使用 `kebab-case.tsx`，样式模块强制使用 `kebab-case.module.scss`，**严禁使用 `PascalCase` 文件名**。
2. **Widget 边界**：Widget 只做排版组合，所有 RPC 流程与领域算法必须下沉到 `features/*/model/`。
3. **样式规范**：使用 SCSS Modules 与全局 `--loom-*` CSS 自定义属性；当前没有 Tailwind 或 CSS-in-JS 合同。
4. **UI 所有权**：Button、IconButton、Field、SearchField、Dialog、Menu、Toggle、Skeleton 等直接从 `@loom-studio/ui` 导入。Client `shared/ui` 只允许保留宿主绑定或重型分包组件，不得作为第二套 UI Kit。

---

## 状态与外部依赖所有权 (External Dependency Ownership)

根据 [`external-dependency-ownership.md`](../../docs/architecture/platform/external-dependency-ownership.md)，前端各类状态必须严格归属到唯一合法的所有者，严禁随意手写平行状态源：

```text
URL / History 路由导航       -> React Router
已迁移的远端资源缓存 (Remote)  -> TanStack Query (Query Key、去重、失效与缓存)
本地界面偏好与布局 (Local)      -> Zustand (`studio-layout-store.ts`，如面板尺寸、折叠、外观)
瞬时交互与表单草稿 (Ephemeral) -> React 组件局部 state 或 feature hook
叙事与智能体流式生命周期       -> 归属的 Narrative / Agent feature
```

### 关键依赖使用提醒
- **本地偏好沿用 Zustand**：面板折叠、展开偏好、主题外观写入所属 store。工作区导航恢复由 `shared/studio-shell/studio-workspace.ts` 按 endpoint 持久化位置；组件不得另建平行 `localStorage` 状态。
- **缓存型服务端状态沿用 TanStack Query**：Prompt Resource、Lore Mount、Preset Tool Mount、用户档案与全局搜索结果已有 Query 消费入口；这些缓存与失效由 Query 管理，表单未保存草稿不进入 Query Cache。
- **长文本与代码编辑**：需要语法、搜索或高亮的场景必须复用 CodeMirror / Lezer；短文本用原生 input/textarea。
- **消息展示**：复用 `features/message-content`；Markdown 使用 `react-markdown` / `remark-gfm`，HTML 使用现有消毒和隔离路径。不能绕过这些入口手写正则 parser 或直接注入未经处理的 HTML。
- **菜单与弹层**：上下文菜单与下拉菜单必须基于 Radix primitives，不手写底层 focus/dismiss 机制；轻量反馈使用 Sonner。
- **图标**：通用操作图标必须优先使用 Lucide 图标，品牌图标使用已有静态资产，不私自手绘重复 SVG。
- **分页消费完整性（`collectPages`）**：消费 Provider 与 Capability Profile 等后端分页时，统一通过 `collectPages` 收集完整列表后再发布，避免半列表暴露。
- **失效引用容错呈现**：业务依赖（如绑定的 Provider 账号被删除）缺失时，UI 宽容呈现为不可用警告并提供显式重新绑定入口，严禁因坏引用阻断列表或白屏崩溃。

### 依赖职责与复用入口

精确依赖见本 Workspace 的 `package.json`；下表记录实际消费者。新增类似能力时，从对应入口复用，不把服务端缓存、UI 偏好与草稿合成一个 Store。

| 能力 | 依赖与当前入口 | 使用边界 |
| --- | --- | --- |
| 布局、外观、主题、搜索偏好、计数系数 | Zustand `create` / `persist`；[布局 Store](src/shared/studio-shell/studio-layout-store.ts)、[外观 Store](src/shared/studio-shell/appearance-store.ts)、[主题 Store](src/features/themes/model/theme-store.ts)、[搜索 Store](src/features/global-search/model/global-search-store.ts)、[计数设置](src/shared/tokenizer/settings.ts) | 持久偏好复用 `safeLocalStorage` adapter；导航位置仍由 History / `studio-workspace.ts` 拥有，不将远端正文搬入 Store。 |
| 远端缓存与分页 | TanStack Query；[资源缓存](src/features/prompt-resources/model/use-prompt-resource-state.ts)、[用户档案](src/features/user-profiles/model/use-user-profiles-query.ts)、[搜索查询](src/features/global-search/model/global-search-queries.ts) | 使用已有 Query key 和失效入口；未迁移领域仍由其当前 feature 拥有，不据此宣称全站状态已迁移。 |
| 大列表窗口 | TanStack Virtual；[文件树](src/shared/ui/file-tree/file-tree.tsx)、[NarrativeTimeline](src/widgets/narrative-timeline/narrative-timeline.tsx) | 管理可见 DOM，数据分页及流式跟随分别沿用领域 API 和 [useSmoothFollow](src/shared/ui/streaming-viewport/use-smooth-follow.ts)。 |
| 命令菜单、弹层与通知 | `@loom-studio/ui` 的 cmdk `CommandMenu`、Radix 菜单、原生 Dialog，以及 Sonner；[全局搜索](src/widgets/global-search/global-search-dialog.tsx) | 搜索排序和范围由 feature 决定；不另写键盘列表、菜单焦点和 dismiss 基础设施。 |
| 长文本与差异编辑 | CodeMirror / Lezer；[长文本编辑器](src/shared/ui/long-text-editor/) | 已有语言、高亮、搜索与 merge 扩展；普通短字段使用现有 input/textarea。 |
| Markdown 与安全 HTML | `react-markdown`、`remark-gfm`、`rehype-raw`、`rehype-sanitize`；[Markdown adapter](src/shared/ui/markdown-content/) | 沿用现有消毒 Schema 和文档 iframe 边界；不自行拼接 HTML 注入。 |
| 消息切块与 HTML 文档解析 | `unified` / `remark-parse` / `parse5`；[消息切块](src/features/message-content/model/message-segments.ts)、[HTML 文档](src/features/message-content/model/html-document.ts) | 使用语法树识别 Markdown / HTML 范围；解析不代替消毒，也不改变保存的正文。 |
| State / 引用文本格式 | `yaml`；[State 编辑](src/features/state-variables/model/state-variable-editor.ts)、[引用模型](src/features/resource-references/reference-model.ts) | 解析和序列化使用库；校验与提交由领域入口负责。 |
| typed RPC 与文本计数 | `@trpc/client` 和 Server 的 type-only AppRouter；`@loom-studio/tokenizer` 的共享 Worker adapter | 分别复用 [API](src/shared/api/) 和 [计数入口](src/shared/tokenizer/)；不在浏览器导入 Server Runtime，也不另加载一份词表。 |

## 编辑与正文生命周期

- Context Asset 草稿不进入 Query Cache；失焦保存携带首次编辑版本。冲突保留输入，只有用户明确重新应用才读取最新版本并合并已编辑字段；不自动覆盖 Agent 的新提交。
- 保存调用使用保留 rejection 的 `operations.run()`；`runReported()` 不能作为成功信号。已经提交的对象身份不能因刷新失败丢失。
- 游玩先 `appendNarrativeInput` 原子保存 canonical user message 和 Narrative 正文索引，再向当前 Timeline 根 Session 投递；当前页面的提交重投递复用节点，持久 Run 恢复使用已有检查点。Assistant 最终回复不自动追加正文，正文写入及失败结果由工具负责。
- Narrative 正文使用 TanStack Virtual；离屏消息及消息内 Renderer/iframe 可卸载，编辑节点例外保留。外观设置的缓冲默认上下各5条，可调整0～50；不是所有已加载数据的内存上限。

具体行为、失败恢复和源码入口见[Application UI 架构](../../docs/architecture/application/ui/README.md)，不要从已归档审查反推当前合同。

---

## 文档入口

- [Workspace 开发路由](../../docs/guide/workspace-development.md)
- [仓库目录与职责地图](../../docs/guide/project-structure.md)
- [Studio UI Architecture](../../docs/architecture/ui/README.md)
- [Application UI Architecture](../../docs/architecture/application/ui/README.md)
- [External Dependency Ownership](../../docs/architecture/platform/external-dependency-ownership.md)
- [Logging Architecture](../../docs/architecture/platform/logging.md)

`/dev/preview/scene-card` 运行同一份[场景背景卡脚本](../../docs/architecture/extensions/examples/scene-background-card.md)，复用 Script Runtime 和 Renderer 宿主，使用仓库官方图片与内存资源目录。支持切图、展开、停用、局部刷新、模拟缺包及下载；不调用业务 API，也不自动安装或授权脚本。

`/dev/preview/scripts` 复用正式 `ScriptManagementPanel`，提供正常、空列表与较多脚本的交互预览。正常场景包含“全局停用、角色启用”的同一脚本，用于核对各范围开关及全部停用。API 和布局 Storage 均使用当前预览文档内存，不调用业务接口、不执行源码；关闭详情与停用实例是独立操作。只在开发环境注册，视觉与交互方向待用户验收。

`/dev/preview/presets` 提供预设库草稿：单栏按个人、官方与扩展来源分组，来源默认展开且可收起，个人预设直接列出；搜索展开匹配来源，移动端无需先下钻来源，以浮层打开单个预设的配置，保留底下的目录、筛选与滚动位置；修改即时作用于内存样例，点击浮层外、关闭按钮或按 Escape 关闭，无需保存或返回步骤；浮层标题下固定并列的模型与审批、Lore、正则 / 提取器、工具、脚本 / 模块标签；各标签内容独立滚动，模型页包含模型选择、流式输出与工具审批，再独立进入消息编排，查看公共资源与实际采用关系，再通过双栏将条目、分组或整条 Message 复制到当前预设。包含正常、空列表、较多内容、长名称与嵌套样例；可编辑样例文本、采用资源、复制及撤销上次复制。刷新或重置后恢复样例，数据和布局 Storage 只在内存中，不请求业务接口。样例入口仅开发环境可用；目录与配置浮层宿主已被正式预设面板复用，双栏复制仍为预览能力。

正式预设面板现在默认显示来源目录。点击名称、图标或行主体进入当前预设的消息编排；只有“配置”按钮打开浮层。目录使用 `PresetLibraryCatalog`，浮层使用 `PresetConfigurationDialog`，两者也供预览复用。正式配置复用现有模型选择、审批、Lore、正则/提取器及工具挂载，按顶部标签切换；修改立即保存，保存中阻止重复写入与关闭，失败保留提示与重试。编排的深链接、节点编辑和导入导出继续使用原接口，返回库目录保留筛选和列表位置。脚本/模块预设绑定与跨预设双栏复制尚未接入正式业务。

展示组件位于 `src/features/prompt-resources/ui/preset-library/preset-library-workbench.tsx`；样例和操作位于 `src/dev-preview/preset-library-fixtures.ts`、`preset-library-preview.tsx`。正式接入时复用展示组件及其 `presets / sources / resources / models / tools` 输入和配置、编辑、采用、复制回调；当前复制资源选项沿用来源预设的全部资源引用，不自动推断条目依赖，也不复制公共资源实体。套件来源、模型连接和工具目录均为样例展示，不预设正式扩展包 Schema 或更新策略。配置浮层与编排页采用同一份内存数据；模型、审批、Lore 来源开关与工具只演示选择，不连接真实 Provider 或执行工具。

动态扩展 RPC adapter 与会话恢复位于 `src/shared/api/client-bridge.ts`、`session-fetch.ts`，与 typed client 共用 session fetch，不再独立为 workspace 包。

### 目录归属收敛（2026-10-25）

- `features/prompt-resources` 统一资源库、树编辑和预设选择，`usePromptResourceWorkspace` 连接快照与草稿；`features/agent-presets/model/use-agent-tools.ts` 仅保留独立工具管理。
- `features/provider-settings/ui` 拥有模型选择与品牌图标，预设模型绑定位于 `features/prompt-resources/ui`，由 PresetWorkbench 组合。
- `features/sessions` 拥有共用 Transcript 渲染构造、工具展示、创建对话框和摘要状态；聊天、历史和记忆 Widget 保留各自布局。
- `widgets/text-transform-workbench` 组合文本转换与 `loom-scripts` 的局部状态；`widgets/extension-workbench` 将脚本管理注入扩展工作台，Feature 不导入兄弟 Feature。

实施合同与验证范围见[前端目录边界计划](../../docs/archive/plans/frontend-feature-boundary-consolidation-plan.md)。
