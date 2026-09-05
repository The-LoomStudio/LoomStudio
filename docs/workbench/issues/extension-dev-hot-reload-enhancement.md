# Issue: 插件开发态热重载机制增强（Extension Dev Hot-Reload）

- **状态**: Pending / Backlog
- **优先级**: Low (暂时不急着推进)
- **创建时间**: 2026-09-04

---

## 1. 背景与现状

当前 Loom Studio 扩展系统的运行时基础设施已经完备：
- **Server 端**：`ServerExtensionManager` 和 `ExtensionHost` 已经内置了 `host.reload(packageId, moduleId)`，支持卸载旧实例、清理句柄、释放资源并重新 `import()` 磁盘上的最新构建产物；
- **跨端通知**：Server 具备 `GET /extensions/events` SSE 流，在模块 reload 后通过 EventBus 广播 `extensions.changed`（`action: 'reloaded'`）；
- **Client 端**：`useClientExtensionRuntime` 监听到 SSE 后，驱动 `ClientExtensionHost.reconcile()` 重新加载前端模块与沙箱。

**当前限制**：
缺乏“文件级自动监听触发源”：
1. `scripts/dev-with-packages.mjs` 中的 `tsx watch` 只监听了 `packages/**/dist/**/*` 和 `apps/studio-server/src/main.ts`，未将 `extensions/**/*` 纳入监听范围；
2. Server 进程在开发模式下没有为 DevLink 映射的扩展目录挂载 `fs.watch`。
因此改动扩展源码或重新打包后，Server 和 Client 不会自动感知并热重载，需手动调用 `extensions.reloadModule` RPC 或重启 Server。

---

## 2. 优化方案选型

后续推进时，可二选一实施：

1. **方案 A（极简粗暴）**：
   在 `scripts/dev-with-packages.mjs` 中让 `tsx watch` 将 `extensions/**/dist/**/*` 纳入监听范围，扩展重新打包后自动重启 Server。
2. **方案 B（优雅免重启）**：
   在 Server 开发态发现本地 DevLink 扩展时，为其根目录挂载轻量 `fs.watch`。文件变动后在防抖时间内自动调用内部 `extensionManager.reloadModule`，通过现有 SSE 通道无缝推送给 Client，实现前后端无感热重载。
