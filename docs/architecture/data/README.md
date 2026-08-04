# Data Architecture

本分类用于收录 Loom Studio 已实现并稳定的数据基础语义，包括 Document、Revision、Changeset、持久化、Workspace 同步边界以及 Trace/Audit 数据。

放置规则：

- 与业务无关的持久化原语放在这里；
- Card、Session、Setting Layer 等业务 Document schema 放在 [`../application/`](../application/)；
- Extension 私有 schema 由对应 Extension 负责；
- Kernel 如何通过 RPC 暴露数据能力记录在 [`../kernel/`](../kernel/)；
- UI Undo/Redo history 不等同于 Document Store 的持久化历史。

当前数据层设计过程位于 [`../../workbench/discussion/data/`](../../workbench/discussion/data/)。具体专题在与当前实现逐项核对后再晋升，本目录暂不复制 Draft 文档。

## 当前 Document Store 持久化基线

SQLite backend 使用三张权威表：

- `documents`：当前版本的完整 typed JSON Document；
- `document_revisions`：按 Document ID 与 version 保存历史 Revision；
- `changesets`：保存一次 transaction 聚合后的操作事实。

当前 SQLite schema version 为 1，通过原生 `PRAGMA user_version` 管理。version 0 数据库按顺序事务迁移到 version 1；高于当前程序支持版本的数据库会被拒绝打开。WAL 与 foreign key 设置仍由 SQLite backend 初始化，不依赖 ORM 或外部 migration framework。

SQLite backend 在单连接内按 FIFO 串行执行公开读写，transaction 内部操作直接复用当前事务，避免并发顶层操作形成嵌套事务或读取未提交状态。version 0 升级在推进 `user_version` 前会校验三张核心表的必需列；不完整 Schema 会完整回滚并拒绝打开。
