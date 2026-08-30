# `@loom-studio/studio-server`

> **状态**：Active Workspace Guide / Current Source Is Authority

Studio Server 是本地 Node.js 进程的 Composition Root 与 Transport Adapter。它组装 Data Engine、Stores、Application Runtime、Kernel、Extension Host/Manager、RPC Router 和 HTTP Server，但不重新实现 Application 领域逻辑。

## 开发入口

正常开发从仓库根目录运行：

```bash
pnpm dev:server
```

该命令会先构建并监听内部 Packages，再通过 `tsx watch` 启动 Server。默认监听 `127.0.0.1:4173`，可通过 `PORT` 覆盖；开发数据默认写入仓库 `.loomstudio-dev`。

定向命令：

```bash
pnpm --filter @loom-studio/studio-server dev
pnpm --filter @loom-studio/studio-server build
pnpm --filter @loom-studio/studio-server lint
pnpm exec vitest run tests/unit/studio-server tests/integration/studio-server apps/studio-server/src/card-png.test.ts apps/studio-server/src/card-bundle-zip.test.ts
```

直接运行 Package `dev` 依赖当前 Workspace 的 `dist` 已经是最新版本；正常联调优先使用根命令。

## 入口与组成

- [`src/main.ts`](./src/main.ts)：进程入口、服务组装和关闭顺序（Composition Root）。
- [`src/http/`](./src/http/)：HTTP 传输接入与本地安全认证（`http-server.ts`, `application-session-auth.ts`）。
- [`src/rpc/`](./src/rpc/)：RPC 路由分发、参数校验与领域处理器（`studio-rpc-router.ts`, `rpc-params.ts`, `handlers/`）。
- [`src/codecs/`](./src/codecs/)：Card PNG / ZIP 编解码与打包器（`card-png.ts`, `card-bundle-zip.ts`）。
- [`src/platform/`](./src/platform/)：本地运行路径、系统代理与网络设置（`local-paths.ts`, `system-proxy.ts`, `network-settings.ts`）。
- [`src/logging/`](./src/logging/)：结构化日志观测适配器（`ai-gateway-logging.ts`, `document-store-logging.ts`）。
- [`src/extensions/`](./src/extensions/)：Package Source、安装、desired state 和 Server Module 编排。

```text
Studio Server
  -> shared SQLite Data Engine + domain Stores
  -> Application Runtime
  -> Extension Host + Extension Manager
  -> Kernel
  -> authenticated HTTP / RPC adapters
```

## 当前 HTTP 面

- `GET /health`
- `POST /auth/session`
- 认证后的 `POST /rpc`
- Asset 上传与读取
- Card PNG、`.loomcard` 和 Polyglot PNG 导入导出
- Extension Icon
- `GET /extensions/events`：只用于 Extension Catalog 变化的 SSE

Kernel 不依赖 HTTP、WebSocket 或 SSE。Server 负责进程、Transport、本地路径、认证和依赖组装；Card、Narrative、Agent、State、PromptBuild 等业务规则属于 Application Runtime。

## 文档入口

- [Workspace 开发路由](../../docs/guide/workspace-development.md)
- [Project Structure](../../docs/guide/project-structure.md)
- [Kernel Architecture](../../docs/architecture/kernel/README.md)
- [Application Architecture](../../docs/architecture/application/README.md)
- [Data Architecture](../../docs/architecture/data/README.md)
- [Extension Architecture](../../docs/architecture/extensions/README.md)
- [Logging Architecture](../../docs/architecture/platform/logging.md)
