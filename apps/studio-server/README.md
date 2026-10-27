# `@loom-studio/studio-server`

> **状态**：Active Workspace Guide / Current Source Is Authority

Studio Server 是本地 Node.js 进程的 Composition Root 与 Transport Adapter。它组装 Data Engine、Stores、Application Runtime、Kernel、Extension Host/Manager、RPC Router 和 HTTP Server，但不重新实现 Application 领域逻辑。

## 从哪里读

先读[系统总览](../../docs/architecture/system-overview.md)确定请求与数据所有者，再按问题进入本地边界：

| 当前问题 | 下一入口 |
| --- | --- |
| 服务如何创建、启动前要准备什么、关闭次序 | 本文“组合根与启动前提” → [`src/server.ts`](./src/server.ts) |
| 请求为什么被拒绝、静态文件/媒体/SSE如何投递、取消与请求预算 | [HTTP 边界](./src/http/README.md) → `http-server.ts` / `trpc-request.ts` |
| procedure 在哪里、参数交给谁、服务如何注入、扩展动态调用 | [RPC 边界](./src/rpc/README.md) → `trpc/router.ts` / `context.ts` |
| 领域写入、恢复或权限合同 | [Application Architecture](../../docs/architecture/application/README.md)、[Kernel](../../docs/architecture/kernel/README.md)、[Extensions](../../docs/architecture/extensions/README.md) |

## 开发入口

正式 Beta 入口由根目录启动脚本提供：前端预构建后由同一 Node HTTP 服务托管，
不需要 Vite。发行资源按安装位置解析，正式入口不扫描仓库开发扩展，
并使用生产 Extension 合同与同源会话。准备与限制见 [Beta 发布](../../docs/guide/beta-release.md)。

正常开发从仓库根目录运行：

```bash
pnpm dev:server
```

该命令会先构建内部 Packages，持续监听 Packages，再通过 `tsx watch` 启动 Server。独立扩展在根目录 `extensions/` 开发，自行构建并通过扩展中心重载，不由主程序代为构建。默认监听 `127.0.0.1:18010`，可通过 `PORT` 覆盖；开发客户端 Origin 默认放行 `http://127.0.0.1:18011`，可通过 `STUDIO_CLIENT_URL` 覆盖。持久数据默认写入仓库 `data/`，缓存和日志默认在 `.loomstudio-dev/`。`LOOM_STUDIO_DATA_ROOT` 可覆盖持久数据根；已有旧目录的迁移及显式 `LOOM_STUDIO_HOME` 行为见 [Getting Started](../../docs/guide/getting-started.md)。

监听排除 `.tsbuildinfo`，避免 TypeScript 构建元数据更新引起无效重启和重复启动 banner；运行文件发生变化仍会正常重启并打印新的启动信息。修改监听参数后需重新启动 `pnpm dev:server`。

终端日志默认使用紧凑摘要，显示 Run/Step/Provider/Tool/Commit 与 PromptBuild 生命周期，不展开全部 ID。设置 `LOOM_STUDIO_LOG_DETAILS=1` 可查看完整安全字段；该开关不放行请求/响应正文，也不改变 JSONL 保存策略。

日志查询、保留与模型观测边界见[Logging Architecture](../../docs/architecture/platform/logging.md)；请求入口见 [RPC 边界](./src/rpc/README.md)。

定向命令：

```bash
pnpm --filter @loom-studio/studio-server dev
pnpm --filter @loom-studio/studio-server build
pnpm --filter @loom-studio/studio-server lint
pnpm exec vitest run tests/unit/studio-server tests/integration/studio-server
```

直接运行 Package `dev` 仅执行 `tsx src/main.ts`，不启用 watch，且依赖当前 Workspace 的 `dist` 已经是最新版本；正常联调优先使用根命令。上述命令均从仓库根目录执行。

## 组合根与启动前提

- [`src/main.ts`](./src/main.ts)：直接执行入口，保留 `main`、`createStudioServer` 与类型导出。
- [`src/cli.ts`](./src/cli.ts)：日志启动、进程信号、终端展示及 CLI 失败清理。
- [`src/server.ts`](./src/server.ts)：服务组合根、启动与关闭顺序。
- [`src/extensions/extension-application-adapter.ts`](./src/extensions/extension-application-adapter.ts)：Extension Host 的应用能力、权限与数据适配。
- [`src/codecs/card-transfer-service.ts`](./src/codecs/card-transfer-service.ts)：Card 媒体读取、PNG/ZIP 导入导出与导入后目录保存。
- [HTTP 边界](./src/http/README.md)：本地认证、静态/媒体投递、请求取消与 tRPC adapter。
- [RPC 边界](./src/rpc/README.md)：类型化路由、参数校验与 Runtime/宿主服务交接。
- [`src/codecs/`](./src/codecs/)：Card PNG / ZIP 编解码与打包器（`card-png.ts`, `card-bundle-zip.ts`）。
- [`src/platform/`](./src/platform/)：本地运行路径、系统代理与网络设置（`local-paths.ts`, `system-proxy.ts`, `network-settings.ts`）。
- [`src/logging/`](./src/logging/)：结构化日志观测适配器（`ai-gateway-logging.ts`, `document-store-logging.ts`）。
- [`src/extensions/`](./src/extensions/)：Package Source、安装、desired state 和 Server Module 编排。
- [`src/scripts/`](./src/scripts/)：Loom Script 的 Server 实例协调、源码准备与停止清理。

```text
Studio Server
  -> shared SQLite Data Engine + domain Stores
  -> Application Runtime
  -> Extension Host + Extension Manager
  -> Kernel
  -> authenticated HTTP / RPC adapters
```

`createStudioServer()` 创建并注入长期服务；返回对象的 `listen()` 才执行启动准备并监听 loopback。正常持久化路径由同一个 Data Engine 装配 Document、Agent、Narrative、State、Prompt Resource、Blob/Asset 与 Secret Store；测试注入独立 Document Store 不能被当作完整持久化组合的替代。

开始接纳请求前，`listen()` 依次重试凭据清理、等待目录扫描并处理目录恢复、加载 Observation、扫描目录、初始化 Runtime、恢复扩展任务、安装缺失 starter、启动 Kernel、初始化扩展 Manager、协调 Server Script，最后建立媒体监听和 HTTP listener。各步骤的失败/恢复策略归相应服务，不能仅凭 `/health` 响应推断所有外部 Provider 可用。

## 当前 HTTP 面

- `GET /health`
- `POST /auth/session`
- 认证后的 `POST /trpc/<procedure>`
- Asset 上传与读取
- Card ZIP（下载为 `.loomcard.zip`）与承载同一 ZIP 的 PNG 导入导出；保留的旧入口及 Polyglot 行为见[Card 容器合同](../../docs/architecture/application/card-bundle-files.md)
- Extension Icon
- 全局 Extension 文件与按 Card 安装归档摘要校验的私有扩展文件读取入口
- `GET /extensions/events`：Extension Catalog/Data、实体生命周期、目录媒体和 Data Commit 的失效通知 SSE；不是通用 Event Transport

`POST /trpc/<procedure>` 的完整 JSON 请求体上限为 384 MiB，按传输字节累计。声明或实际大小超限时，
在 JSON 解析和业务调用前返回 HTTP 413 / `rpc.request_too_large`，停止累积并关闭该连接。
Card、Asset 的独立二进制入口保持各自上限；此请求预算不是进程峰值内存保证。

官方内容使用 `official.listContent` / `official.installContent` / `official.exportContent` RPC。
默认读取仓库根目录下的 `official/starter`，部署时应携带该目录或设置
`CreateStudioServerOptions.officialContentDirectory`。Server 启动时自动安装缺失的默认预设与
Lore；保留已有内容、挂载和删除记录，不覆盖用户修改。此步骤由 Server 组合根执行，
Application 初始化本身不安装内容；当前只有本地来源，不包含在线更新。
详见 [官方内容说明](../../official/README.md)。

---

## 架构规约与外部依赖所有权 (Server Architecture Rules)

根据 [`external-dependency-ownership.md`](../../docs/architecture/platform/external-dependency-ownership.md)，Server 端具备严格的技术栈选型与职责边界：

1. **HTTP 与 RPC**：Node `node:http` 拥有 listener、认证、Origin、请求体预算和取消/排空；`@trpc/server` Fetch adapter 拥有 procedure 路由与响应协议。`src/rpc/trpc/router.ts` 导出 `AppRouter`，Client 只引用其声明类型，不加载 Server 运行时代码；不另建平行 RPC 方法表或 HTTP 框架。
2. **数据库基座**：统一通过 `@loom-studio/data-engine` 暴露的单一 SQLite connection 和事务管道运行，**严禁各领域 Store 私自建立独立的数据库连接，严禁引入 Prisma、TypeORM 或自制 ORM/Repository 层**。
3. **压缩格式处理**：统一采用 `fflate` 进行 Card Bundle、Prompt Resource、Extension 压缩包处理，严禁私自编写第二套 ZIP 编解码器。
4. **业务逻辑绝不上移**：Server 仅作为装配各 Store、Kernel、Host 与提供 HTTP/RPC 协议适配的组合根（Composition Root），**绝不编写 Card、Narrative、Agent、State 或 PromptBuild 的业务规则**（必须全部由 Application Runtime 承载）。
5. **凭据安全边界**：为 `SecretStore` 注入系统 Keyring 或内存凭据后端，确保 SQLite 中仅持久化 Secret 元数据与引用，严禁明文凭据打印到日志或返回给前端。
6. **优雅停机流程 (Graceful Shutdown)**：`server.ts` 先释放媒体监听，再调用 HTTP `shutdown()`，停止接纳、取消并等待已登记请求收敛；随后释放 Script Runtime、停止 Kernel/扩展，重试未决凭据清理，关闭 Observation Store，最后关闭 SQLite Data Engine。传递取消不等于业务已结束，不以超时强行越过仍使用数据库的请求。
7. **Card 打包完整性与解压安全**：采用增量流式解压与原生 CRC32 校验，严格防御目录越界（zip-slip）与超限解压炸弹（单包 128 MiB / 单文件 64 MiB 预算），损坏包在入库前明确拒绝。
8. **扩展卸载一致性**：扩展卸载采用“持久化禁用 → 尽力清理”策略，异常时保留状态并支持重试恢复，不损坏全局 Catalog。

当前外部依赖的入口与复用边界：

| 依赖 | 实际入口与职责 |
| --- | --- |
| `@trpc/server` | [`http/trpc-request.ts`](./src/http/trpc-request.ts) 使用官方 Fetch adapter；主应用统一 POST、关闭 batching；[`rpc/trpc/context.ts`](./src/rpc/trpc/context.ts) 传播调用链与取消、封装领域错误码，不向客户端输出 stack。动态扩展经 `kernel.invoke` 进入原 Kernel 调度。 |
| `zod` | `rpc/trpc/` 的结构化输入边界；已有领域 reader 通过 adapter 复用，不机械重写已存在的 Manifest/Artifact parser，也不在可信内部函数重复 parse。 |
| `fflate` | `codecs/`、扩展安装与官方内容的 ZIP 编解码。`zip-checksums.ts` 只读取完整性元数据，Card 导入另以原生 `node:zlib` CRC32 校验实际字节，不建立第二套解压器。 |
| `semver` | [`extensions/extension-download.ts`](./src/extensions/extension-download.ts) 校验扩展依赖版本范围；来源与循环检查由安装流程负责，不等于自动版本求解或自动更新。 |

SQLite 由 Data Engine 的原生 `node:sqlite` 实现拥有；系统凭据由 Secret Store 的 `@napi-rs/keyring` 后端拥有。Server 注入这些能力，不复制连接管理或凭据持久化。

RPC 只解析输入并传播可信调用上下文；领域事务、Session/Timeline 绑定与资源消费仍由 Runtime 拥有。具体路由与修改入口见 [RPC 边界](./src/rpc/README.md)，写入/恢复语义见[Runtime 与 Session](../../docs/architecture/application/agent/runtime-and-session.md)。

## 文档入口

- [Workspace 开发路由](../../docs/guide/workspace-development.md)
- [Project Structure](../../docs/guide/project-structure.md)
- [Kernel Architecture](../../docs/architecture/kernel/README.md)
- [Application Architecture](../../docs/architecture/application/README.md)
- [Data Architecture](../../docs/architecture/data/README.md)
- [Extension Architecture](../../docs/architecture/extensions/README.md)
- [Logging Architecture](../../docs/architecture/platform/logging.md)
