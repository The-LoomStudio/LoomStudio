# `@loom-studio/data-engine`

> **状态**：Active Package Guide / Current Source Is Authority

Data Engine 是 Loom Studio 的业务无关 SQLite 基础层。它管理单一 connection、namespaced migration、FIFO 读写、transaction、Changeset/Commit Journal 和提交后通知。

## 公共入口

[`src/index.ts`](./src/index.ts) 公开：

- `createSqliteDataEngine()`、`SqliteDataEngine` 和 `DataEngineError`；
- Migration、Transaction 与 Engine options 类型；
- `DataCommitFact`、operation、observer、source 和 notifier。

源码集中在：

| 文件        | 当前职责                                                             |
| ----------- | -------------------------------------------------------------------- |
| `sqlite.ts` | Connection、Migration、FIFO read/transact、Commit Journal 与关闭状态 |
| `commit.ts` | 领域无关 Commit Fact、Observer 和通知隔离                            |
| `index.ts`  | Package public exports                                               |

## 事务边界

- 所有公开 `read()` / `transact()` 进入同一个 FIFO；
- 写事务使用 `BEGIN IMMEDIATE`，失败时回滚；
- transaction 必须记录至少一个 operation；
- 一次成功事务只写一份 Changeset/Commit Fact；多个 Store 必须参与同一个 transaction 才有跨 Store 原子性，连续调用多次 `transact()` 不构成整体事务；
- `AsyncLocalStorage` 会拒绝 transaction 内重新进入 Engine API；
- Commit observer 只在 SQLite commit 成功后运行，observer 异常不能回滚已持久化数据；
- `close()` 后的读写会返回 `data.engine_closed`。

本包不拥有 Document、Narrative、Agent、Asset 等业务 Schema，不提供 ORM/Repository，也不理解 Application 语义。领域 Store 在事务内直接使用 transaction 暴露的 SQLite connection，不重新进入公开排队方法。

## Schema 版本边界

`migrate()` 是 Store 启动装配时的同步入口，不进入运行期 FIFO。版本保存在 `schema_migrations(namespace, version)`；每个 namespace 只按已注册的连续版本升级，缺口返回 `data.sqlite_migration_gap`，本次升级失败时 DDL 与版本记录一起回滚。

数据库 namespace 版本高于当前程序支持版本时返回 `data.sqlite_schema_newer`，拒绝继续装配；不会自动降级、兼容读取或猜测迁移。核心 namespace 与领域 namespace 的检查均在 [`sqlite.ts`](./src/sqlite.ts)。

## 构建与验证

```bash
pnpm --filter @loom-studio/data-engine build
pnpm exec vitest run tests/unit/data-engine/sqlite-data-engine.test.ts
```

Package 的 `test` 脚本定位根目录 `tests/unit/data-engine`；上面的命令只验证 Engine 合同对应的单个文件。

## 正式文档

- [Data Architecture](../../docs/architecture/data/README.md)
- [Kernel Architecture](../../docs/architecture/kernel/README.md)
