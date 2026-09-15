# `@loom-studio/studio-server`

> **状态**：Active Workspace Guide / Current Source Is Authority

Studio Server 是本地 Node.js 进程的 Composition Root 与 Transport Adapter。它组装 Data Engine、Stores、Application Runtime、Kernel、Extension Host/Manager、RPC Router 和 HTTP Server，但不重新实现 Application 领域逻辑。

## 开发入口

正常开发从仓库根目录运行：

```bash
pnpm dev:server
```

该命令会先构建并监听内部 Packages，再通过 `tsx watch` 启动 Server。默认监听 `127.0.0.1:4173`，可通过 `PORT` 覆盖；持久数据默认写入仓库 `data/`，缓存和日志默认在 `.loomstudio-dev/`。`LOOM_STUDIO_DATA_ROOT` 可覆盖持久数据根；已有旧目录的迁移及显式 `LOOM_STUDIO_HOME` 行为见 [Getting Started](../../docs/guide/getting-started.md)。

定向命令：

```bash
pnpm --filter @loom-studio/studio-server dev
pnpm --filter @loom-studio/studio-server build
pnpm --filter @loom-studio/studio-server lint
pnpm exec vitest run tests/unit/studio-server tests/integration/studio-server
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

官方内容使用 `official.listContent` / `official.installContent` / `official.exportContent` RPC。
默认读取仓库根目录下的 `official/starter`，部署时应携带该目录或设置
`CreateStudioServerOptions.officialContentDirectory`。安装必须由用户显式请求，不在
Application 初始化时创建或覆盖官方预设与 Setting；当前只有本地来源，不包含在线更新。
详见 [官方内容说明](../../official/README.md)。

---

## 架构规约与外部依赖所有权 (Server Architecture Rules)

根据 [`external-dependency-ownership.md`](../../docs/architecture/platform/external-dependency-ownership.md)，Server 端具备严格的技术栈选型与职责边界：

1. **HTTP 服务选型**：纯原生 Node `node:http` 处理 HTTP/RPC，**严禁引入 Express、Fastify 或 Hono 等平行服务端框架**。
2. **数据库基座**：统一通过 `@loom-studio/data-engine` 暴露的单一 SQLite connection 和事务管道运行，**严禁各领域 Store 私自建立独立的数据库连接，严禁引入 Prisma、TypeORM 或自制 ORM/Repository 层**。
3. **压缩格式处理**：统一采用 `fflate` 进行 Card Bundle、Prompt Resource、Extension 压缩包处理，严禁私自编写第二套 ZIP 编解码器。
4. **业务逻辑绝不上移**：Server 仅作为装配各 Store、Kernel、Host 与提供 HTTP/RPC 协议适配的组合根（Composition Root），**绝不编写 Card、Narrative、Agent、State 或 PromptBuild 的业务规则**（必须全部由 Application Runtime 承载）。
5. **凭据安全边界**：为 `SecretStore` 注入系统 Keyring 或内存凭据后端，确保 SQLite 中仅持久化 Secret 元数据与引用，严禁明文凭据打印到日志或返回给前端。


## 文档入口

- [Workspace 开发路由](../../docs/guide/workspace-development.md)
- [Project Structure](../../docs/guide/project-structure.md)
- [Kernel Architecture](../../docs/architecture/kernel/README.md)
- [Application Architecture](../../docs/architecture/application/README.md)
- [Data Architecture](../../docs/architecture/data/README.md)
- [Extension Architecture](../../docs/architecture/extensions/README.md)
- [Logging Architecture](../../docs/architecture/platform/logging.md)
