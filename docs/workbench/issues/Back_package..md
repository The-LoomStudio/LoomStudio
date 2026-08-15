# 后端包审查 #1：document-store / narrative-store / agent-store

## 包概况

| 包 | 职责 | 源文件 | 行数 |
|---|---|---|---|
| `document-store` | 通用文档 CRUD + 版本 + 变更集 + Undo/Redo | 6 files | ~1200 行 |
| `narrative-store` | 叙事时间线/分支/节点，链表式 append-only | 3 files | ~760 行 |
| `agent-store` | AI Agent 会话 + 消息 + Tool Call 状态 | 3 files | ~490 行 |

三个包共享同一个 `data-engine` 抽象（`SqliteDataEngine`），由 `data-engine` 统一管理 `transact` / `commit` / `migrate`。

---

## 1. 代码异味 / 问题

### 🔴 [高] `readPage` (narrative) 和 `readMessagePage` (agent) 链表遍历没有上限保护

**文件：**
- [`narrative-store/store.ts` L349-L357](file:///Users/macbookair/Desktop/LoomStudio/packages/narrative-store/src/store.ts)
- [`agent-store/store.ts` L219-L223](file:///Users/macbookair/Desktop/LoomStudio/packages/agent-store/src/store.ts)

```ts
// narrative-store
while (nodeId && reverseNodes.length < limit) {
  const node = requireNode(database, nodeId)       // ← 每次 1 条 SQL
  reverseNodes.push(node)
  nodeId = node.parentNodeId
}

// agent-store — 同样模式
while (messageId && reverseMessages.length < limit) {
  const message = requireMessage(database, messageId) // ← 每次 1 条 SQL
  reverseMessages.push(message)
  messageId = message.parentMessageId
}
```

**问题：**
- **N+1 查询问题**：每加载一条记录就执行一次 `SELECT ... WHERE id = ?`。`limit` 默认 50，最大 100，意味着一次分页请求最多发 100 条独立 SQL。虽然 SQLite 走的是本地文件没有网络开销，但在数据量大时仍然有显著性能影响。
- **链表遍历无安全上限**：如果 `parentNodeId` / `parentMessageId` 因为 bug 产生了循环引用，这段代码会无限循环（虽然 `limit` 限制了结果集大小，但如果循环引用导致永远找不到 `null` 的 parent，`limit` 就是唯一的退出条件——这确实能兜住，但依赖的是业务 limit 而不是显式的循环检测）。

**建议：**
1. 用一条 SQL 替代 N 次查询：
   - SQLite 支持 `WITH RECURSIVE` CTE，可以一条 SQL 完成链表遍历
   - 或者用 `WHERE timeline_id = ? ORDER BY created_at DESC LIMIT ?` 直接按时间排序（前提是同 branch 内节点的 `created_at` 是严格递增的，但考虑 fork 的情况可能不成立）
2. 加一个显式的 `maxTraversal` 安全阈值（如 10000），在超过时抛出错误。

---

### 🟡 [中] `in-memory-store` 的 `snapshotState` 全量深拷贝是 O(N) 的开销

**文件：** [`in-memory-store.ts` L257-L271](file:///Users/macbookair/Desktop/LoomStudio/packages/document-store/src/in-memory-store.ts)

```ts
function snapshotState(current, revisions, changesets) {
  return {
    current: new Map([...current.entries()].map(([id, document]) => [id, cloneDocument(document)])),
    revisions: new Map([...revisions.entries()].map(([id, items]) => [id, items.map(cloneDocument)])),
    changesets: new Map([...changesets.entries()].map(([id, changeset]) => [id, cloneChangeset(changeset)])),
  }
}
```

**问题：**
- 每次 `transact()` 和 `revertChangeset()` 都会 `structuredClone` 整个 store 的所有文档和所有历史修订版本。随着文档和修订版本的积累，开销会迅速增长。
- `revisions` 是一个 append-only 的数组列表，在大量操作后，每次 snapshot 都要深拷贝全部修订，但事务回滚只需要撤销事务内的改动。

**建议：** 既然 in-memory store 主要用于测试，如果性能不是紧要问题可以保持原样，但加一个注释说明这一点。如果将来用于开发环境，可以考虑：
- 记录事务内的变更 diff（类似 `PendingChangeset` 的方式），回滚时只逆向应用变更
- 或者用 COW（Copy-on-Write）策略替代全量 snapshot

---

### 🟡 [中] `sqlite-store` 的 `list` 分页实现有冗余查询

**文件：** [`sqlite-store.ts` L128-L141](file:///Users/macbookair/Desktop/LoomStudio/packages/document-store/src/sqlite-store.ts)

```ts
const rows = database
  .prepare(`SELECT ... FROM documents ${where} ORDER BY rowid LIMIT ? OFFSET ?`)
  .all(...values, limit, offset)

const hasMore = rows.length === limit && database
  .prepare(`SELECT 1 FROM documents ${where} ORDER BY rowid LIMIT 1 OFFSET ?`)
  .get(...values, nextOffset)   // ← 额外一条 SQL 只为判断 hasMore
```

**问题：** 为了判断是否有下一页，额外执行了一条 `SELECT 1 ... LIMIT 1 OFFSET ?` 查询。经典的做法是在主查询中多取一条（`LIMIT ? + 1`），然后看结果是否超过 limit，省去第二条查询。

**建议：** 改为 `LIMIT limit + 1`，返回 `rows.slice(0, limit)`，用 `rows.length > limit` 判断 hasMore。

---

### 🟡 [中] `document-store` 和 `narrative-store` / `agent-store` 的验证工具函数大量重复

**跨包重复：**

| 函数 | `document-store` | `narrative-store` | `agent-store` |
|---|---|---|---|
| `optionalString(value)` | ✗ | ✓ (L600) | ✓ (L404) |
| `validateId(value, field)` | ✗ | ✓ (L572) | ✓ (L394) |
| `validateOptionalId(value, field)` | ✗ | ✓ (L578) | ✓ (L390) |
| `validateOptionalText(value, field)` | ✗ | ✓ (L566) | ✓ (L384) |
| `operation(kind, entityId, entityType)` | ✗ | ✓ (L582) | ✓ (L400) |
| Custom Error class pattern | `DocumentStoreError` | `NarrativeStoreError` | `AgentStoreError` |
| `readPage` 链表遍历模式 | ✗ | ✓ (L349) | ✓ (L218) |

**问题：** 这三个 store 的验证函数、error class 模式、链表分页模式几乎完全一样，但各自独立实现。如果将来需要修改分页策略或验证逻辑（比如加上面建议的 recursive CTE），就需要改三处。

**建议：** 考虑把共通的 `validateId`、`validateOptionalText`、`optionalString`、`operation`、链表分页等提取到 `data-engine` 或一个共享的 `store-utils` 包里。Error class 也可以用泛型基类统一。

---

### 🟡 [中] `narrative-store` 的 `readPage` 没有利用已建索引

**文件：** [`narrative-store/store.ts` L283](file:///Users/macbookair/Desktop/LoomStudio/packages/narrative-store/src/store.ts)

```sql
-- 已建索引
CREATE INDEX idx_narrative_nodes_timeline_parent ON narrative_nodes(timeline_id, parent_node_id);
CREATE INDEX idx_narrative_nodes_timeline_created ON narrative_nodes(timeline_id, created_at);
```

**问题：** `readPage` 的链表遍历通过 `WHERE id = ?` 逐条查询（走主键索引），完全没有利用 `idx_narrative_nodes_timeline_parent`（timeline_id + parent_node_id 的复合索引）和 `idx_narrative_nodes_timeline_created`（按时间排序的索引）。

`idx_narrative_nodes_timeline_created` 看起来是为了未来按时间批量查询准备的，但目前没有任何查询路径使用它。这个索引只在写入时增加开销，没有在读取中产生价值。

**建议：** 如果确定不需要按时间排序查询，可以暂时去掉 `idx_narrative_nodes_timeline_created`，减少写入时的索引维护开销；如果未来计划用它来替代链表遍历，在注释中标明意图。

---

### 🟢 [低] `rowToDocument` 和 `rowToChangeset` 使用 `as` 强转而非运行时校验

**文件：** [`sqlite-store.ts` L397-L412, L415-L448](file:///Users/macbookair/Desktop/LoomStudio/packages/document-store/src/sqlite-store.ts)

```ts
function rowToDocument(row: unknown): DocumentRecord {
  const value = row as { id: string; type: string; ... }  // ← 无运行时校验
  return {
    id: value.id,
    content: JSON.parse(value.content_json) as JsonValue,
    meta: JSON.parse(value.meta_json) as DocumentMeta,
    ...
  }
}
```

**问题：** 所有 `rowToXxx` 函数都对 SQLite 返回的 `row` 做 `as` 强转，没有验证字段是否存在或类型是否正确。如果 migration 不完整、schema 不一致、或者 `content_json` 不是合法 JSON，会得到不明确的 runtime error（如 `JSON.parse` 抛 `SyntaxError`），而不是包含上下文的 store error。

`narrative-store` 和 `agent-store` 也有同样的模式（`row as Record<string, unknown>` 然后直接 `String(value.id)`）。

**建议：** 这是一个取舍问题——加验证会增加代码量但提升可调试性。至少在 `JSON.parse` 的位置 wrap 一个 try-catch 给出更好的错误信息（如 "Failed to parse document content: {id}"）。

---

### 🟢 [低] `createDocumentDataCommitSource` 是一个纯透传函数

**文件：** [`data-commit.ts` L4-L10](file:///Users/macbookair/Desktop/LoomStudio/packages/document-store/src/data-commit.ts)

```ts
export function createDocumentDataCommitSource(
  documents: Pick<DocumentStore, 'subscribeCommits'>,
): DataCommitSource {
  return {
    subscribeCommits: observer => documents.subscribeCommits(commit => observer(commit)),
  }
}
```

**问题：** 这个函数的 lambda `commit => observer(commit)` 等价于直接传 `observer`，整个函数可以简化为 `{ subscribeCommits: documents.subscribeCommits }`。当前的包装层没有任何附加逻辑。

**建议：** 如果将来计划在这里加过滤或转换逻辑，保留这个 adapter 层是合理的，但加个注释说明为什么需要这层包装。如果纯粹是"interface adapter"，可以简化。

---

### 🟢 [低] `assertExpectedVersion` 对 `expectedVersion === 'new'` 且 `existing` 有 tombstone 的情况没有特殊处理

**文件：** [`changeset.ts` L171-L179](file:///Users/macbookair/Desktop/LoomStudio/packages/document-store/src/changeset.ts)

```ts
export function assertExpectedVersion(id, existing, expectedVersion) {
  if (expectedVersion === 'new' && existing) {
    throw new DocumentStoreError('document.conflict', `Document already exists: ${id}`)
  }
  // ...
}
```

**问题：** 如果一个文档已被 tombstone（soft-delete），对同 id 使用 `expectedVersion: 'new'` 写入时会抛 "already exists"，即使从用户角度看这个文档已经被删除了。这是正确的行为（id 确实被占用了），但 error message 可能让调试者困惑。

**建议：** 在 tombstoned 文档上使用 `expectedVersion: 'new'` 时，可以给出更明确的错误信息，如 "Document exists but is tombstoned: {id}. Use update to restore."

---

## 2. 值得肯定的设计

| 设计 | 包 | 说明 |
|---|---|---|
| **Changeset + Revision 双写** | `document-store` | 每次 write/delete 同时写入 `documents`（当前状态）和 `document_revisions`（历史快照），支持完整的 undo/redo，设计精巧 |
| **Tombstone 软删除** | 全部 | 三个包都用 `tombstoned` 标志而非物理删除，保留了数据恢复能力 |
| **乐观并发控制** | 全部 | `expectedVersion` / `expectedHeadNodeId` / `expectedMessageCount` 分别对应各自的 OCC 策略，一致且完整 |
| **事务边界清晰** | 全部 | `Store` 接口的方法自带 commit，`Transaction` 接口的方法不 commit，交由上层（`data-engine.transact`）统一提交 |
| **Tool Call 状态追踪** | `agent-store` | `agent_tool_calls` 表独立追踪每个 tool call 的生命周期（创建 → 结果），验证 tool result 时能检测重复和缺失 |
| **Migration 版本化** | 全部 | 通过 `engine.migrate({ namespace, migrations })` 管理 schema 版本，`narrative-store` 已有 v1→v2 的演进实例（加索引） |
| **`assertDocumentOnlyChangeset`** | `document-store` | revert 时校验 changeset 只含 document 操作，防止跨 store 的 changeset 被错误 revert |
| **`compactSource`** | `narrative-store` | 把全 `undefined` 的 `source` 对象转为 `undefined`，保持 JSON 输出干净 |
