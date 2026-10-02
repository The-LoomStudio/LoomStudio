# `@loom-studio/studio-client`

> **状态**：Active Workspace Guide / Current Source Is Authority

Studio Client 是 React/Vite Web Client，负责页面组合、交互状态和 typed RPC 消费。它不直接访问 Kernel、SQLite、文件系统或 `@loom/core`。

## 开发入口

正常开发从仓库根目录，在两个独立终端分别启动 Server 与 Client：

```bash
pnpm dev:server
pnpm dev:client
```

`dev:client` 会先构建并监听内部 Packages，再启动 `127.0.0.1:5173`。Vite 将 `/auth`、`/assets`、`/cards`、`/extensions` 和 `/rpc` 代理到 `STUDIO_SERVER_URL`，默认是 `http://127.0.0.1:4173`。

若 Server 通过 `PORT` 改用其他端口，启动 Client 时也需设置对应的 `STUDIO_SERVER_URL`。RPC 使用 HTTP `POST /rpc`；Extension Catalog 变化使用 `/extensions/events` SSE。

定向命令：

```bash
pnpm --filter @loom-studio/studio-client dev
pnpm --filter @loom-studio/studio-client build
pnpm --filter @loom-studio/studio-client lint
pnpm exec vitest run tests/unit/client
```

直接运行 Package `dev` 不会替你监听其他 Workspace 的构建产物；日常联调优先使用根命令。上述测试命令从仓库根目录执行，使用根 Vitest 配置收集 `tests/unit/client/` 用例。Package `test` 已显式指定仓库根与 Client 测试目录，根配置拒绝零测试成功；验证时仍需核对实际执行的文件和用例数量。

## 开发组件预览

开发预览入口 `/dev/preview/:id` 保留，当前可用样例以 [预览注册表](./src/dev/preview/index.tsx) 为准。入口在开发模式下先于认证启动分流，未知 ID 显示未找到。新增样例在该注册表接入，复用生产组件，不动态解析用户提供的模块路径。

消息 HTML 样例已于 2026-09-24 经用户验收后[归档](./src/dev/archive/message-html/README.md)，不再注册 `message-html` 预览。正式 Narrative 与 Agent 消息消费 `features/message-content`：安全片段直接进入消息 DOM，完整 HTML 文档使用隔离 iframe，Agent 流式未闭合 HTML 使用占位。Display 只影响显示，编辑与复制保留原文。外部图床与 ST／酒馆助手 API 桥尚未开放。

普通应用仍走认证启动流程。预览设计与生产隔离验收要求见 [组件预览计划](../../docs/archive/plans/ui/component-preview-workbench-plan.md)；入口存在不代表生产构建、无副作用检查或人工视觉验收已经完成。

`/studio/logs` 可作为日志入口，进入后归一化到 `/studio`；面板与筛选范围保存在 History State。日志页支持合并/分别查看 Server 与 Client 当前缓冲、增量轮询、扩展/运行筛选和 JSONL 历史搜索。扩展管理提供“查看日志”；`logPackage`、`logRun`、`logSource` 属于导航保存的搜索条件，不要求持续显示在地址栏。复制诊断信息提供固定预览、故障上下文/筛选结果选择与隐私提示，历史查询和当前内存的完整性分开报告。

历史只包含 Server 已保存文件；Browser 日志刷新后丢失，不自动上传。资源 URI 在用户打开时读取名称/角色头像，不写入日志或默认分享。Runs Inspector 和原生诊断助手尚未接入。

## 入口与数据流

- [`src/main.tsx`](./src/main.tsx)：创建 Client Logger，通过 `POST /auth/session` 建立应用会话，再挂载 Router 和 Error Boundary。
- [`src/app/app.tsx`](./src/app/app.tsx)：组合 Studio 页面和各 Workspace/Panel。
- [`src/app/use-studio-state.ts`](./src/app/use-studio-state.ts)：组合 Feature hooks，形成 App facade。
- [`src/shared/api/studio-api.ts`](./src/shared/api/studio-api.ts)：把 Client Bridge 映射为 typed `application.*`、`settings.*`、`logs.*` 等 API。

普通面板切换使用同一 `/studio` 的 History State，显式 URI 负责资源身份与外部跳转，不能重新用每个面板的 Path 覆盖 Timeline 上下文。恢复优先级和来源隔离见[导航架构](../../docs/architecture/ui/navigation-and-routing.md)。

资源浏览按归属进入角色或扩展面板；浏览角色不切换当前游玩角色。临时按原 ID 打开单项资源只改变查看/编辑目标，不改变归属、安装或挂载。复杂 Settings 由专用面板承载；当前不维护独立工作区包成员清单。目录或 Manifest 静态声明不等于某轮运行的实际激活结果。

Agent Preset 配置使用 Settings、正则 / 提取器、工具三个子 Tab，复用来源 FileTree、搜索和图标开关；Settings / 规则行点击跳转定义编辑，工具说明按行展开。当前角色 Settings 置顶并用星号标记，显示随 `useCardSettings` 草稿变化，不为展示增加 Mount；默认采用由角色世界书总开关控制，关闭后仍可显式采用。目录不显示实际触发结果，不提供额外编辑按钮或 Settings 上下移控件。详见[资源浏览与消费配置](../../docs/architecture/ui/navigation-and-routing.md#资源浏览与消费配置)。

Session 不能中途改绑预设。“主写作”是 Narrative 输入接收 Session，与正在查看的 Session 分离；选择按 endpoint 存储范围和 Timeline 在本机持久化，不是后端全局主槽位。生成时禁止换主；暂停任务须先成功放弃，不能借切换恢复旧任务。具体合同见[Agent Runtime 与 Session](../../docs/architecture/application/agent/runtime-and-session.md#1-身份与绑定)。

```text
Route / UI
  -> Feature hook / useStudioState
  -> createStudioApi(Client Bridge)
  -> authenticated POST /rpc
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
- **服务端状态必须用 TanStack Query**：Prompt Resource、Setting Mount 等远端实体必须由 Query 管理缓存与失效，表单未保存草稿不进入 Query Cache。
- **长文本与代码编辑**：需要语法、搜索或高亮的场景必须复用 CodeMirror / Lezer；短文本用原生 input/textarea。
- **消息展示**：复用 `features/message-content`；Markdown 使用 `react-markdown` / `remark-gfm`，HTML 使用现有消毒和隔离路径。不能绕过这些入口手写正则 parser 或直接注入未经处理的 HTML。
- **菜单与弹层**：上下文菜单与下拉菜单必须基于 Radix primitives，不手写底层 focus/dismiss 机制；轻量反馈使用 Sonner。
- **图标**：通用操作图标必须优先使用 Lucide 图标，品牌图标使用已有静态资产，不私自手绘重复 SVG。
- **分页消费完整性（`collectPages`）**：消费 Provider、Capability Profile 与 Agent Profile 等后端分页时，统一通过 `collectPages` 收集完整列表后再发布，避免半列表暴露。
- **失效引用容错呈现**：业务依赖（如绑定的 Provider 账号被删除）缺失时，UI 宽容呈现为不可用警告并提供显式重新绑定入口，严禁因坏引用阻断列表或白屏崩溃。

## 编辑与正文生命周期

- Context Asset 草稿不进入 Query Cache；失焦保存携带首次编辑版本。冲突保留输入，只有用户明确重新应用才读取最新版本并合并已编辑字段；不自动覆盖 Agent 的新提交。
- 保存调用使用保留 rejection 的 `operations.run()`；`runReported()` 不能作为成功信号。已经提交的对象身份不能因刷新失败丢失。
- 游玩先 `appendNarrativeInput` 持久化用户节点，再向 Agent Session 投递；重投递复用节点。Assistant 最终回复不自动追加正文，正文写入及失败结果由工具负责。
- Narrative 正文使用 TanStack Virtual；离屏消息及消息内 Renderer/iframe 可卸载，编辑节点例外保留。外观设置的缓冲默认上下各5条，可调整0～50；不是所有已加载数据的内存上限。

具体行为、失败恢复和源码入口见[Application UI 架构](../../docs/architecture/application/ui/README.md)，不要从已归档审查反推当前合同。

---

## 文档入口

- [Workspace 开发路由](../../docs/guide/workspace-development.md)
- [项目全量文件地图与前端任务路由](../../docs/guide/project-structure.md)
- [Studio UI Architecture](../../docs/architecture/ui/README.md)
- [Application UI Architecture](../../docs/architecture/application/ui/README.md)
- [External Dependency Ownership](../../docs/architecture/platform/external-dependency-ownership.md)
- [Logging Architecture](../../docs/architecture/platform/logging.md)
