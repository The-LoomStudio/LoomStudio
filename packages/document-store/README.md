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
   - `write()` 接受 `expectedVersion: 'new' | number`，`delete()` 接受数值版本；参数在 API 中可选，省略时不做版本比较。需要并发保护的消费者必须显式传入基线，冲突返回 `document.conflict` 并回滚所在事务；
   - 成功事务生成 Changeset ID 与 Commit Fact；ID 是不透明标识，不是全局递增序号，不能据此推断提交顺序。
2. **拒绝全量业务数据泛滥（Scope Limitation）**：
   - **本包不承载全部业务数据**。高频的 Narrative 时间线、Agent 会话与 Prompt Resource 树均由 `@loom-studio/application-data` 专职处理；
   - 严禁将非版本化、超大二进制或高频纯瞬时状态存入本包。

---

## 公共入口

Package 主入口为 [`src/index.ts`](./src/index.ts)：

- `createSqliteDocumentStore(options)`：生产 SQLite 文档存储工厂；
- `createInMemoryDocumentStore()`：测试与 Playground 沙箱专用内存工厂；
- `createDocumentDataCommitSource(documents)`：连接 Document 变更与 Data Engine 提交事件源的适配器；
- 核心类型：`DocumentStore`、`SqliteDocumentStore`、`DocumentRecord`、`Changeset`、`DocumentStoreError`；历史版本通过 `get(id, { version })` 返回 `DocumentRecord`。

SQLite 实现通过 `{ engine }` 共享连接与提交日志，或通过 `{ filename }` 自建 Engine；外部注入的 Engine 由组合根关闭。跨 Store 写入使用 `participateTransaction(dataTx, callback)` 加入已有 Engine 事务，不再另开事务或另写提交日志，见 [`sqlite-store.ts`](./src/sqlite-store.ts)。

`revertChangeset()` 只撤销纯 Document Changeset，并校验当前版本后产生新的版本和 Changeset；包含其他 Store operation 的提交返回 `document.changeset_not_revertible`。它不是 Narrative、State、Prompt Resource、文件或外部副作用的通用撤销器。

`list()` 按首次插入序号分页，更新、tombstone 和恢复保留行身份；SQLite 使用 UPSERT 而非 REPLACE，内存实现保留 Map 插入位置。默认页长 100，允许 1～1000 的安全整数。cursor 是绑定 type、ownerExtensionId、includeTombstone 的不透明边界，调用者只回传，不解析为 OFFSET；无效 cursor 或改变筛选会得到 `document.input_invalid`。

这是动态集合遍历，不是跨请求快照：后插入项可在后续页出现，已越过边界的条目即使恢复或改为匹配筛选也不会重新返回。需要一致集合的导出、初始化与破坏性操作必须保留其事务/版本保护。游标不承诺跨数据库重建、离线 VACUUM 等维护操作继续有效。

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
