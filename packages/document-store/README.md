# `@loom-studio/document-store`

> **状态**：Active Package Guide / Current Source Is Authority

`@loom-studio/document-store` 是 Loom Studio 的通用版本化文档存储。它为需要完整历史追踪、差异对比、乐观并发控制与原子回滚的文档型数据提供底座支持。

## 业务使命与设计定位

不同于高频追加的 Narrative 消息流或树形展开的 Prompt 资源，系统内存在部分需要像 Git Commit 一样进行版本快照与回滚追踪的文档。
`@loom-studio/document-store` 提供：
- **`Document`**：由命名空间 ID 唯一标识的 JSON 文档；
- **`Revision`**：递增的版本号与不可变内容快照；
- **`Changeset`**：跨单文档或多文档写操作的原子变更集；
- **双实现支持**：生产环境由 `@loom-studio/data-engine` 驱动的 SQLite 持久化实现，以及测试/沙箱专用的纯内存实现（`createInMemoryDocumentStore`）。

---

## 架构规约与边界红线 (Rules & Boundaries)

1. **乐观并发与因果保障**：
   - 每次写入必须显式携带 `expectedVersion: 'new' | number`，版本冲突时必须原子回滚并拒绝写入；
   - 写入操作自动生成全局递增的 `changesetId` 与 Commit Fact，保障事件总线能够向外投影事实变更。
2. **拒绝全量业务数据泛滥（Scope Limitation）**：
   - **本包不承载全部业务数据**。高频的 Narrative 时间线、Agent 会话与 Prompt Resource 树均由 `@loom-studio/application-data` 专职处理；
   - 严禁将非版本化、超大二进制或高频纯瞬时状态存入本包。

---

## 公共入口

Package 主入口为 [`src/index.ts`](./src/index.ts)：

- `createSqliteDocumentStore(options)`：生产 SQLite 文档存储工厂；
- `createInMemoryDocumentStore()`：测试与 Playground 沙箱专用内存工厂；
- `createDocumentDataCommitSource(documents)`：连接 Document 变更与 Data Engine 提交事件源的适配器；
- 核心类型：`DocumentStore`、`DocumentRecord`、`RevisionRecord`、`ChangesetRecord`、`DocumentStoreError`。

---

## 构建与验证

```bash
# 编译 TypeScript 产物
pnpm --filter @loom-studio/document-store build

# 运行文档存储契约与 SQLite 测试
pnpm exec vitest run tests/unit/document-store
```

---

## 正式文档

- [Data Architecture 统一持久化架构](../../docs/architecture/data/README.md)
- [Kernel Architecture 平台协调说明](../../docs/architecture/kernel/README.md)
