# `@loom-studio/extension-host`

> **状态**：Active Package Guide / Current Source Is Authority

Extension Host 是 Server Extension Module 的 Node.js 宿主实现。它位于 `packages/extension-sdk/extension-host/`，但拥有独立 `package.json`、public export 和 Workspace Package identity；它不是 `@loom-studio/extension-sdk/extension-host` 子路径。

## 公共入口

[`src/index.ts`](./src/index.ts) 主要公开：

- `createExtensionHost()` 与 `ExtensionHostOptions`；
- `parseExtensionManifest()`；
- Extension/Instance state 和 summary；
- Host Logger、Event、RPC 类型；
- 少量 SDK identity/capability 类型重导出。

## 当前职责

- 读取、解析和校验 Manifest v2；
- discover、activate、reload、dispose Server Module；
- 动态导入 Server entry；
- 管理 Package/Module/Instance identity 与 Instance Scope；
- 在停止时 abort、等待 in-flight callback，并按反序执行 disposer；
- 为扩展日志写入注入固定的 Package/Module/Instance/Runtime 身份，并提供 Host 归属的只读日志查询；
- 对 RPC、Event、Document、Asset、AI、Storage 和 Portable Payload 执行 capability gate；
- 校验 namespace、owner、grant 和 Manifest declaration/runtime registration；
- 记录生命周期日志和 Diagnostics。

Host 不负责 Package Source、Catalog、Installer 或 desired-state orchestration；这些属于 Studio Server Extension Manager。它也不实现 Client Host、UI Runtime、通用跨端 Event Transport 或恶意代码强沙箱，不保存 Extension 自己的业务状态。

安装 target 可以是 Global 或 Card；同一 Package 在不同 target 下的 Instance、启用状态和 capability grants 分开识别。Card target 的 API 访问受宿主授权与归属校验约束，但 Server Module 与宿主同进程运行，不构成恶意代码的强安全沙箱。

扩展日志通过 `ctx.logger` 写入，`ctx.logger.child(namespace)` 只能创建受限命名空间；`ctx.logs.query(input)` 由 Host 强制绑定当前 Package，查询成功不额外产生日志。扩展不能通过 `ctx.rpc.call('logs.list', ...)` 绕过该边界。

```text
Studio Server Extension Manager
  -> Extension Host
       -> discover Server Module
       -> create Instance Scope
       -> activate(ctx)
       -> capability-gated registrations
       -> reload / dispose
```

## 依赖与运行环境

本包依赖 SDK 的 Manifest/Context 合同、Document Store 与 Diagnostics 的平台接口、Logging 的受控扩展 writer/query、Shared 的纯数据逻辑和 Tokenizer 的计数能力。模块导入与文件操作使用 Node 原生 API；不引入通用 DI、插件加载框架或独立数据库连接。

Manifest parser 识别 `client-worker`，但本包只激活 Server Module。Client Module 与 Dedicated Worker 的加载、MessagePort 能力桥和 UI 资源释放由 [`apps/studio-client/src/features/extension-renderers/model/client-extension-host.ts`](../../../apps/studio-client/src/features/extension-renderers/model/client-extension-host.ts)及 Client `shared/worker-runtime/` 负责，不把 Worker 的线程隔离当作 Server 沙箱。

Host 提供的 Timeline / Narrative / Agent Task / VFS 等业务能力由 Server 注入 adapter；Host 负责声明、授权和实例范围，Application Runtime / Store 拥有领域语义和持久化。扩展应复用已有 capability，不通过通用 RPC 绕过保留 namespace 或直接访问内部 Store。

## 构建与验证

```bash
pnpm --filter @loom-studio/extension-host build
pnpm exec vitest run tests/contract/extension-host
```

当前根合同测试覆盖 Manifest、RPC、Logging、Scope 清理、Document ownership、Asset、AI、Storage 和 Portable Payload。Package 的 `test` 脚本也指向根目录 `tests/contract/extension-host`，不在包内维护另一套测试。

## 正式文档

- [Extension SDK Package Guide](../README.md)
- [Extension Architecture](../../../docs/architecture/extensions/README.md)
- [Kernel Architecture](../../../docs/architecture/kernel/README.md)
- [Extension Data and Portable Payload](../../../docs/architecture/application/extension/data-and-portable-payload.md)
