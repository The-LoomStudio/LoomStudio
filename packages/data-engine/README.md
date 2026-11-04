# `@loom-studio/data-engine`

> **状态**：Active Package Guide / Current Source Is Authority

Data Engine 是 Loom Studio 的业务无关 SQLite 基础层。它管理单一 connection、namespaced schema 初始化、FIFO 读写、transaction、Changeset/Commit Journal 和提交后通知。

## 公共入口

[`src/index.ts`](./src/index.ts) 公开：

- `createSqliteDataEngine()`、`SqliteDataEngine` 和 `DataEngineError`；
- `SqliteSchema`、`DataTransactionInput`、Transaction 与 Engine options 类型；
- `DataCommitFact`、operation、observer、source 和 notifier；
- `readSqliteSpaceUsage()`：读取当前 SQLite 空间统计。

源码集中在：

| 文件        | 当前职责                                                             |
| ----------- | -------------------------------------------------------------------- |
| `sqlite.ts` | Connection、Schema 初始化、FIFO read/transact、Commit Journal 与关闭状态 |
| `commit.ts` | 领域无关 Commit Fact、Observer 和通知隔离                            |
| `storage-statistics.ts` | SQLite 页面与 freelist 空间统计 |
| `index.ts`  | Package public exports                                               |

## 事务边界

- 所有公开 `read()` / `transact()` 进入同一个 FIFO；
- 写事务使用 `BEGIN IMMEDIATE`，callback 必须返回 Promise，失败时回滚；
- transaction 必须记录至少一个 operation；
- 一次成功事务只写一份 Changeset/Commit Fact；多个 Store 必须参与同一个 transaction 才有跨 Store 原子性，连续调用多次 `transact()` 不构成整体事务；
- `AsyncLocalStorage` 会拒绝 transaction 内重新进入 Engine API；
- Commit observer 只在 SQLite commit 成功后运行，observer 异常不能回滚已持久化数据；
- `close()` 后的读写会返回 `data.engine_closed`。

本包不拥有 Document、Narrative、Agent、Asset 等业务 Schema，不提供 ORM/Repository，也不理解 Application 语义。领域 Store 在事务内直接使用 transaction 暴露的 SQLite connection，不重新进入公开排队方法。

`DataTransactionInput` 是公共写入上下文的字段来源；领域 Store 的 `*WriteContext` 与 `DocumentTransactionInput` 保留各自名称并直接引用该类型。领域 API 的其他参数与可选 actor 合同仍由各 Store 定义。

## 原生依赖职责

本包没有第三方运行时依赖。[`sqlite.ts`](./src/sqlite.ts) 直接使用 Node 的 `node:sqlite` `DatabaseSync`，`node:async_hooks` 的 `AsyncLocalStorage` 检测事务重入，文件与路径 API 只负责数据库父目录。FIFO 是本包对共享连接的访问合同，不是异步 SQLite 驱动；领域 Store 应参与既有 transaction，不再引入连接池或 ORM。

## Schema 版本边界

Store 创建时调用 `initializeSchema({ namespace, version, initialize })`。版本仍记录在 `schema_migrations(namespace, version)`：空 namespace 在一个事务中执行当前完整 DDL 并写入当前版本；版本相同则直接使用；已有非零版本与当前版本不同则返回 `data.sqlite_schema_unsupported`，不升级、降级或兼容读取。运行期读写仍统一进入 Engine FIFO；核心 namespace 检查见 [`sqlite.ts`](./src/sqlite.ts)。

## 构建与验证

```bash
pnpm --filter @loom-studio/data-engine build
pnpm exec vitest run tests/unit/data-engine/sqlite-data-engine.test.ts
```

Package 的 `test` 脚本定位根目录 `tests/unit/data-engine`；上面的命令只验证 Engine 合同对应的单个文件。

## 正式文档

- [Data Architecture](../../docs/architecture/data/README.md)
- [Kernel Architecture](../../docs/architecture/kernel/README.md)
