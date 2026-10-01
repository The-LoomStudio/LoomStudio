# `@loom-studio/studio-server`

> **状态**：Active Workspace Guide / Current Source Is Authority

Studio Server 是本地 Node.js 进程的 Composition Root 与 Transport Adapter。它组装 Data Engine、Stores、Application Runtime、Kernel、Extension Host/Manager、RPC Router 和 HTTP Server，但不重新实现 Application 领域逻辑。

## 开发入口

正式 Beta 入口由根目录启动脚本提供：前端预构建后由同一 Node HTTP 服务托管，
不需要 Vite。发行资源按安装位置解析，正式入口不扫描仓库开发扩展，
并使用生产 Extension 合同与同源会话。准备与限制见 [Beta 发布](../../docs/guide/beta-release.md)。

正常开发从仓库根目录运行：

```bash
pnpm dev:server
```

该命令会先构建内部 Packages 和 `official/extensions/the-world`，持续监听 Packages 与该扩展的 Client bundle，再通过 `tsx watch` 启动 Server。默认监听 `127.0.0.1:4173`，可通过 `PORT` 覆盖；持久数据默认写入仓库 `data/`，缓存和日志默认在 `.loomstudio-dev/`。`LOOM_STUDIO_DATA_ROOT` 可覆盖持久数据根；已有旧目录的迁移及显式 `LOOM_STUDIO_HOME` 行为见 [Getting Started](../../docs/guide/getting-started.md)。

监听排除 `.tsbuildinfo`，避免 TypeScript 构建元数据更新引起无效重启和重复启动 banner；运行文件发生变化仍会正常重启并打印新的启动信息。修改监听参数后需重新启动 `pnpm dev:server`。

终端日志默认使用紧凑摘要，显示 Run/Step/Provider/Tool/Commit 与 PromptBuild 生命周期，不展开全部 ID。设置 `LOOM_STUDIO_LOG_DETAILS=1` 可查看完整安全字段；该开关不放行请求/响应正文，也不改变 JSONL 保存策略。

`logs.list` 查询当前 Memory，`logs.history` 通过 Node Reader 搜索已保存 JSONL；必填 since/until、最长 31 天查询范围、有界扫描和分页，不接受文件路径。取消 HTTP 请求会停止历史扫描。文件轮转/删除、坏行和不完整尾行通过 issues 报告，cursor 过期须重新搜索。成功的日志查询不产生自观察 INFO。

定向命令：

```bash
pnpm --filter @loom-studio/studio-server dev
pnpm --filter @loom-studio/studio-server build
pnpm --filter @loom-studio/studio-server lint
pnpm exec vitest run tests/unit/studio-server tests/integration/studio-server
```

直接运行 Package `dev` 仅执行 `tsx src/main.ts`，不启用 watch，且依赖当前 Workspace 的 `dist` 已经是最新版本；正常联调优先使用根命令。上述命令均从仓库根目录执行。

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
- Card ZIP（下载为 `.loomcard.zip`）与承载同一 ZIP 的 PNG 导入导出；保留的旧入口及 Polyglot 行为见[Card 容器合同](../../docs/architecture/application/card-bundle-files.md)
- Extension Icon
- 全局 Extension 文件与按 Card 安装归档摘要校验的私有扩展文件读取入口
- `GET /extensions/events`：只用于 Extension Catalog 变化的 SSE

`POST /rpc` 的完整 JSON 请求体上限为 384 MiB，按传输字节累计。声明或实际大小超限时，
在 JSON 解析和业务调用前返回 HTTP 413 / `rpc.request_too_large`，停止累积并关闭该连接。
Card、Asset 的独立二进制入口保持各自上限；此请求预算不是进程峰值内存保证。

官方内容使用 `official.listContent` / `official.installContent` / `official.exportContent` RPC。
默认读取仓库根目录下的 `official/starter`，部署时应携带该目录或设置
`CreateStudioServerOptions.officialContentDirectory`。Server 启动时自动安装缺失的默认预设与
Setting；保留已有内容、挂载和删除记录，不覆盖用户修改。此步骤由 Server 组合根执行，
Application 初始化本身不安装内容；当前只有本地来源，不包含在线更新。
详见 [官方内容说明](../../official/README.md)。

---

## 架构规约与外部依赖所有权 (Server Architecture Rules)

根据 [`external-dependency-ownership.md`](../../docs/architecture/platform/external-dependency-ownership.md)，Server 端具备严格的技术栈选型与职责边界：

1. **HTTP 服务选型**：纯原生 Node `node:http` 处理 HTTP/RPC，**严禁引入 Express、Fastify 或 Hono 等平行服务端框架**。
2. **数据库基座**：统一通过 `@loom-studio/data-engine` 暴露的单一 SQLite connection 和事务管道运行，**严禁各领域 Store 私自建立独立的数据库连接，严禁引入 Prisma、TypeORM 或自制 ORM/Repository 层**。
3. **压缩格式处理**：统一采用 `fflate` 进行 Card Bundle、Prompt Resource、Extension 压缩包处理，严禁私自编写第二套 ZIP 编解码器。
4. **业务逻辑绝不上移**：Server 仅作为装配各 Store、Kernel、Host 与提供 HTTP/RPC 协议适配的组合根（Composition Root），**绝不编写 Card、Narrative、Agent、State 或 PromptBuild 的业务规则**（必须全部由 Application Runtime 承载）。
5. **凭据安全边界**：为 `SecretStore` 注入系统 Keyring 或内存凭据后端，确保 SQLite 中仅持久化 Secret 元数据与引用，严禁明文凭据打印到日志或返回给前端。
6. **优雅停机流程 (Graceful Shutdown)**：先停止媒体监听和 HTTP 接纳，向在途业务与长连接传递 `AbortSignal` 并等待请求/流收敛；再停止 Kernel、释放扩展，最后重试未决凭据清理并关闭 SQLite Data Engine。传递取消不等于业务已结束，不在仍使用数据库时抢先关闭它。
7. **Card 打包完整性与解压安全**：采用增量流式解压与原生 CRC32 校验，严格防御目录越界（zip-slip）与超限解压炸弹（单包 128 MiB / 单文件 64 MiB 预算），损坏包在入库前明确拒绝。
8. **扩展卸载一致性**：扩展卸载采用“持久化禁用 → 尽力清理”策略，异常时保留状态并支持重试恢复，不损坏全局 Catalog。

Timeline 用户输入经 `application.appendNarrativeInput` 先写入 Narrative Store，再由 Client 投递 Session；`application.editNarrativeNode` 是带分支并发基线的正文编辑，不是运行结束后的自动追加。RPC 层只解析请求并传播可信调用上下文，不补造旧输入的最新版本，也不将整轮 Agent/工具执行包装成一个数据库事务。具体写入合同见[Agent Runtime](../../docs/architecture/application/agent/runtime-and-session.md#6-narrative-边界)。


## 文档入口

- [Workspace 开发路由](../../docs/guide/workspace-development.md)
- [Project Structure](../../docs/guide/project-structure.md)
- [Kernel Architecture](../../docs/architecture/kernel/README.md)
- [Application Architecture](../../docs/architecture/application/README.md)
- [Data Architecture](../../docs/architecture/data/README.md)
- [Extension Architecture](../../docs/architecture/extensions/README.md)
- [Logging Architecture](../../docs/architecture/platform/logging.md)
