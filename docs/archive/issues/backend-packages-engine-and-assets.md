# 后端包审查 #2：data-engine / blob-store / asset-store

> **状态**：Audited / Resolved
> **最后审计**：2026-08-19（Phase 1 底座加固完成）

## 包概况

| 包 | 职责 | 源文件 | 行数 |
|---|---|---|---|
| `data-engine` | SQLite 连接管理、FIFO 串行化事务、Schema 迁移与 Commit 事件总线 | 3 files | ~360 行 |
| `blob-store` | 基于 SHA-256 的内容寻址二进制存储（CAS）、分片目录、流式写入计量 | 3 files | ~320 行 |
| `asset-store` | 业务资产（源文件包 SourceArtifact / 媒体资产 MediaAsset）与 Blob 的关联及元数据管理 | 3 files | ~400 行 |

这三个包构成了系统底层的数据持久化与二进制对象存储底座。

---

## 1. 代码异味 / 潜在缺陷

### ✅ [已解决] `data-engine`：FIFO 串行化队列存在重入死锁隐患且无运行时防护

**文件：** [`packages/data-engine/src/sqlite.ts`](file:///Users/macbookair/Desktop/LoomStudio/packages/data-engine/src/sqlite.ts)

**审查结论：**
- **已引入 Node.js 原生 `AsyncLocalStorage`** 记录当前活跃的 `SqliteDataTransaction` 实例。
- 在 `engine.read()` 与 `engine.transact()` 入口处，若检测到处于活跃事务上下文中，立即抛出 `DataEngineError('data.reentrant_transaction', ...)` 快速失败，彻底消除单链 FIFO 队列的永久死锁隐患。
- 增加了 `close()` 状态检查，在引擎关闭后调用抛出 `DataEngineError('data.engine_closed', ...)`。

---

### ✅ [已改善] `asset-store`：Blob 与 Asset 写入非原子导致潜在孤儿 Blob

**文件：** [`packages/asset-store/src/store.ts`](file:///Users/macbookair/Desktop/LoomStudio/packages/asset-store/src/store.ts)

**审查结论：**
- 已将所有的参数校验与 normalization（`kind`、`width`、`height`、`label`、`mediaType`）前置到调用 `blobs.write` 之前执行，防止因参数校验失败而产生无用孤儿 Blob。
- 不可变 CAS Blob 天然支持内容寻址去重，未引用的 Blob 将由后台 GC 定期清理。
- 如果第二步因校验错误（例如 `media_type_mismatch`、`invalid_dimension`）、数据库约束失败或进程中断，第一步写入的 Blob 已永久落盘且已提交。
- 系统中目前没有针对无引用 Blob 的垃圾回收（GC）机制，可能累积磁盘孤儿文件。

**建议方案：**
- 将所有参数校验（如 `normalizeDimension`、`normalizeToken`、`mediaType`）前置在调用 `blobs.write` 之前执行。
- 规划长期的孤儿 Blob 清理/GC 机制。

---

### 🟡 [中] `blob-store`：POSIX 环境下 `rename` 假设不符（原子覆盖而非抛出 EEXIST）

**文件：** [`packages/blob-store/src/store.ts`](file:///Users/macbookair/Desktop/LoomStudio/packages/blob-store/src/store.ts)

```ts
try {
  await rename(temporary, finalFilename)
} catch (error) {
  if (!isNodeError(error, 'EEXIST') && !isNodeError(error, 'ENOTEMPTY')) throw error
  await unlink(temporary)
}
```

**问题分析：**
- 在标准 POSIX 系统（macOS / Linux）上，`fs.rename(src, dst)` 当目标已存在时会原子覆盖已有文件，不会抛出 `EEXIST`。
- 虽然文件基于 SHA-256 寻址、内容一致不会导致数据损坏，但并发写入同一 Blob 时可能发生非必要的覆盖操作，且代码对 `EEXIST` 的捕获主要在非 POSIX（如 Windows）下才会生效。

**建议方案：**
- 明确 POSIX 下原子覆盖属于预期幂等行为，并在注释中补充说明。
- 可在 `rename` 前通过 `access(finalFilename)` 探测以尽早清理 temporary 文件。

---

### 🟡 [中] `data-engine`：`close()` 缺少对排队操作的安全排空与状态标记

**文件：** [`packages/data-engine/src/sqlite.ts`](file:///Users/macbookair/Desktop/LoomStudio/packages/data-engine/src/sqlite.ts)

```ts
close: () => database.close(),
```

**问题分析：**
- `close()` 立即同步关闭 SQLite 连接。
- 若此时 `operationQueue` 中尚有等待执行的读取或事务，调度执行时将直接抛出底层 SQLite 报错（`Cannot operate on a closed database`），调用方无法获取清晰的引擎已关闭状态。

**建议方案：**
- 增加 `isClosed` 标记。
- 在关闭后让后续操作直接拒绝（reject），并可优雅等待当前飞行中的操作完成。

---

### 🟢 [低] `data-engine`：Commit Notifier 同步通知可能阻塞事务返回

**文件：** [`packages/data-engine/src/commit.ts`](file:///Users/macbookair/Desktop/LoomStudio/packages/data-engine/src/commit.ts)

```ts
notify: commit => {
  for (const observer of observers) {
    try {
      observer(structuredClone(commit) as TFact)
    } catch {
      // ponytail: Post-commit observer failures cannot roll back persisted data...
    }
  }
}
```

**问题分析：**
- `notify` 在事务提交后同步遍历触发所有 observer。
- 若某个 observer 处理耗时较长，会直接增加当前 `transact` Promise 的耗时并推迟队列中后续数据库操作的执行。

**建议方案：**
- 若订阅方无需同步阻塞，可使用 `queueMicrotask` 或异步通知机制解耦。

---

### 🟢 [低] 基础数据读取与校验工具函数跨包重复

**涉及文件：**
- `packages/asset-store/src/store.ts` (`readString`, `readNumber`, `normalizeOptionalText`)
- `packages/blob-store/src/store.ts` (`toBlobRecord`, `normalizeMediaType`, `assertSha256`)
- `packages/data-engine/src/sqlite.ts` (`ensureRequiredColumns`, `ensureOptionalColumn`)

**问题分析：**
- 各包自行维护小型的 Row 解析与断言辅助函数，缺乏统一收敛。

**建议方案：**
- 将通用校验与 DB Row 解析辅助函数沉淀至 `@loom-studio/shared` 或 `@loom-studio/data-engine`。

---

## 2. 值得肯定的设计

| 设计 | 包 | 说明 |
|---|---|---|
| **单连接 FIFO 串行化** | `data-engine` | 通过 Promise 链保证所有 SQLite 操作单线程顺序进入，避免并发事务锁竞争 |
| **流式边写边算与计量限流** | `blob-store` | 采用 `Transform` 流计算 SHA-256 并实时累加字节数，超限即刻中断销毁，无内存暴涨风险 |
| **两级分片目录结构** | `blob-store` | 采用 `sha256/xx/yy/...` 分片，防止海量小文件导致单目录 inode 性能退化 |
| **暂存文件隔离与安全清理** | `blob-store` | 写入 staging 目录并在 `finally` 中保证未成功重命名的临时文件被删除 |
| **命名空间版本化 Schema 迁移** | `data-engine` | 支持多个独立模块按 namespace 管理迁移版本，并严格检查版本连续性与向下兼容 |
| **严格的资产元数据约束** | `asset-store` | 对维度、Token 格式、Label 长度均有前置校验，DB 设有非负及正整数约束 |
