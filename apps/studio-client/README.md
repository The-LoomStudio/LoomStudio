# `@loom-studio/studio-client`

> **状态**：Active Workspace Guide / Current Source Is Authority

Studio Client 是 React/Vite Web Client，负责页面组合、交互状态和 typed RPC 消费。它不直接访问 Kernel、SQLite、文件系统或 `@loom/core`。

## 开发入口

正常开发从仓库根目录分别启动 Server 与 Client：

```bash
pnpm dev:server
pnpm dev:client
```

`dev:client` 会先构建并监听内部 Packages，再启动 `127.0.0.1:5173`。Vite 将 `/auth`、`/assets`、`/cards` 和 `/rpc` 代理到 `STUDIO_SERVER_URL`，默认是 `http://127.0.0.1:4173`。

定向命令：

```bash
pnpm --filter @loom-studio/studio-client dev
pnpm --filter @loom-studio/studio-client build
pnpm --filter @loom-studio/studio-client lint
pnpm exec vitest run tests/unit/client apps/studio-client/src/widgets/log-viewer/log-viewer.test.ts
```

直接运行 Package `dev` 不会替你监听其他 Workspace 的构建产物；日常联调优先使用根命令。

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

## 源码导航

| 目录            | 当前职责                                      |
| --------------- | --------------------------------------------- |
| `app/`          | Provider、顶层 facade、全局错误处理和页面组合 |
| `pages/studio/` | URL 导航、Studio Shell、Panel 与布局状态      |
| `features/`     | 领域状态、RPC 编排和可测试算法                |
| `entities/`     | Client 视角 DTO、领域类型和薄映射             |
| `widgets/`      | 页面级工作面、局部 UI 状态和 Feature 组合     |
| `shared/api/`   | Transport adapter 和 typed API Client         |
| `shared/ui/`    | 无业务含义的通用 UI 原语                      |
| `shared/i18n/`  | `zh-CN` / `en-US` 字典与 Translator           |
| `styles/`       | 全局 CSS、SCSS abstracts 与 `--loom-*` token  |

状态边界：Router 管理可分享的页面与资源定位；Zustand 管理布局和交互状态；Server 持有 canonical 业务状态、PromptBuild、Agent Loop 和持久化事实。不要把 RPC、树算法或跨领域刷新编排塞进 Widget。

## 文档入口

- [Workspace 开发路由](../../docs/guide/workspace-development.md)
- [项目结构与前端任务路由](../../docs/guide/project-structure.md)
- [Studio UI Architecture](../../docs/architecture/ui/README.md)
- [Application UI Architecture](../../docs/architecture/application/ui/README.md)
- [Logging Architecture](../../docs/architecture/platform/logging.md)
