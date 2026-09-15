# `@loom-studio/studio-client`

> **状态**：Active Workspace Guide / Current Source Is Authority

Studio Client 是 React/Vite Web Client，负责页面组合、交互状态和 typed RPC 消费。它不直接访问 Kernel、SQLite、文件系统或 `@loom/core`。

## 开发入口

正常开发从仓库根目录分别启动 Server 与 Client：

```bash
pnpm dev:server
pnpm dev:client
```

`dev:client` 会先构建并监听内部 Packages，再启动 `127.0.0.1:5173`。Vite 将 `/auth`、`/assets`、`/cards`、`/extensions` 和 `/rpc` 代理到 `STUDIO_SERVER_URL`，默认是 `http://127.0.0.1:4173`。

定向命令：

```bash
pnpm --filter @loom-studio/studio-client dev
pnpm --filter @loom-studio/studio-client build
pnpm --filter @loom-studio/studio-client lint
pnpm exec vitest run tests/unit/client
```

直接运行 Package `dev` 不会替你监听其他 Workspace 的构建产物；日常联调优先使用根命令。

## 开发组件预览

启动 `pnpm dev:client` 后，可直接访问 `/dev/preview/ui-primitives`、`/dev/preview/text-pipeline` 或 `/dev/preview/card-resources`。入口在开发模式下先于认证启动分流，使用 [预览注册表](./src/dev/preview/index.tsx) 显式选择样例，未知 ID 显示未找到。新增样例在该注册表接入，复用生产组件，不动态解析用户提供的模块路径。

普通应用仍走认证启动流程。预览设计与生产隔离验收要求见 [组件预览计划](../../docs/archive/plans/ui/component-preview-workbench-plan.md)；入口存在不代表生产构建、无副作用检查或人工视觉验收已经完成。

## 入口与数据流

- [`src/main.tsx`](./src/main.tsx)：创建 Client Logger，通过 `POST /auth/session` 建立应用会话，再挂载 Router 和 Error Boundary。
- [`src/app/app.tsx`](./src/app/app.tsx)：组合 Studio 页面和各 Workspace/Panel。
- [`src/app/use-studio-state.ts`](./src/app/use-studio-state.ts)：组合 Feature hooks，形成 App facade。
- [`src/shared/api/studio-api.ts`](./src/shared/api/studio-api.ts)：把 Client Bridge 映射为 typed `application.*`、`settings.*`、`logs.*` 等 API。

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
1. **命名规范**：组件文件强制使用 `kebab-case.tsx`，样式模块强制使用 `kebab-case.module.scss`，**严禁使用 `PascalCase` 文件名**。
2. **Widget 边界**：Widget 只做排版组合，所有 RPC 流程与领域算法必须下沉到 `features/*/model/`。
3. **样式规范**：使用 SCSS Modules 与全局 `--loom-*` CSS 自定义属性；当前没有 Tailwind 或 CSS-in-JS 合同。
4. **UI 所有权**：Button、IconButton、Field、SearchField、Dialog、Menu、Toggle、Skeleton 等直接从 `@loom-studio/ui` 导入。Client `shared/ui` 只允许保留宿主绑定或重型分包组件，不得作为第二套 UI Kit。

---

## 状态与外部依赖所有权 (External Dependency Ownership)

根据 [`external-dependency-ownership.md`](../../docs/architecture/platform/external-dependency-ownership.md)，前端各类状态必须严格归属到唯一合法的所有者，严禁随意手写平行状态源：

```text
URL / History 路由导航       -> React Router
远端缓存服务端状态 (Remote)    -> TanStack Query (Query Key、去重、失效与缓存)
本地界面偏好与布局 (Local)      -> Zustand (`studio-layout-store.ts`，如面板尺寸、折叠、外观)
瞬时交互与表单草稿 (Ephemeral) -> React 组件局部 state 或 feature hook
叙事与智能体流式生命周期       -> 归属的 Narrative / Agent feature
```

### 关键依赖使用提醒
- **本地偏好必须用 Zustand**：面板折叠、展开偏好、主题外观等可持久化 UI 偏好必须写入所属的 Zustand store，**严禁在组件中私自直接读写 `localStorage`**。
- **服务端状态必须用 TanStack Query**：Prompt Resource、Setting Mount 等远端实体必须由 Query 管理缓存与失效，表单未保存草稿不进入 Query Cache。
- **长文本与代码编辑**：需要语法、搜索或高亮的场景必须复用 CodeMirror / Lezer；短文本用原生 input/textarea。
- **Markdown 展示**：必须走 `react-markdown` + `remark-gfm` 渲染管线，**严禁手写正则 parser 或注入 `innerHTML`**。
- **菜单与弹层**：上下文菜单与下拉菜单必须基于 Radix primitives，不手写底层 focus/dismiss 机制；轻量反馈使用 Sonner。
- **图标**：通用操作图标必须优先使用 Lucide 图标，品牌图标使用已有静态资产，不私自手绘重复 SVG。

---

## 文档入口

- [Workspace 开发路由](../../docs/guide/workspace-development.md)
- [项目全量文件地图与前端任务路由](../../docs/guide/project-structure.md)
- [Studio UI Architecture](../../docs/architecture/ui/README.md)
- [Application UI Architecture](../../docs/architecture/application/ui/README.md)
- [External Dependency Ownership](../../docs/architecture/platform/external-dependency-ownership.md)
- [Logging Architecture](../../docs/architecture/platform/logging.md)
