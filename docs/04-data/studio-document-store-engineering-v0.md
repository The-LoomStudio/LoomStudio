# Loom Studio Document Store Engineering v0

> **Status**: Draft v0.1（第一批工程约束，2026-05-13）
> **Purpose**: 定义 Studio MVP Document Store 的最小工程接口与语义边界。
> **Audience**: Studio Kernel、Data Layer、Extension Host、Concept Stack / Workspace Adapter 实现者。
> **Related**: [`studio-data-layer-architecture.md`](studio-data-layer-architecture.md), [`../adr/ADR-001-data-layer-workspace-sync.md`](../adr/ADR-001-data-layer-workspace-sync.md)

---

## 0. 成功标准

MVP Document Store 应满足：

1. 保存 typed JSON Documents；
2. 每次写入生成新 revision；
3. 一组逻辑写入形成 changeset；
4. 删除使用 tombstone，不物理抹除历史；
5. `get/list` 默认不返回 tombstoned documents；
6. 支持 `expectedVersion` 乐观冲突检查；
7. 支持 checkpoint 与 restore-as-new-version；
8. 写入后发布 `docs.changed` events；
9. Trace / Audit facts 不参与 rollback；
10. 不内置 Chat / Provider / Tool / Agent 业务 schema。

---

## 1. Core Model

Document Store 是 Studio Kernel 管理的通用数据原语。

它保存：

```text
Document current state
Document revisions
Changesets
Checkpoints
Document events
Trace / Audit correlation references
```

它不保存 Manifest 配置，也不强制成为 Extension scratch/cache 的唯一存储方案。

---

## 2. Public Types

```ts
type DocumentId = string
type DocumentType = string
type RevisionNumber = number
type ChangesetId = string
type CheckpointId = string

type DocumentRecord<T = unknown> = {
  id: DocumentId
  type: DocumentType
  version: RevisionNumber
  content: T
  meta: DocumentMeta
}

type DocumentMeta = {
  createdAt: string
  updatedAt: string
  createdBy: ActorRef
  updatedBy: ActorRef
  ownerExtensionId?: string
  source?: DocumentSourceRef
  tombstone?: TombstoneMeta
}

type ActorRef = {
  kind: 'kernel' | 'client' | 'extension' | 'workspace-adapter' | 'system'
  id: string
}

type DocumentSourceRef = {
  kind: 'workspace-file' | 'import-package' | 'generated' | 'manual' | string
  uri?: string
  adapterId?: string
  externalId?: string
}

type TombstoneMeta = {
  deletedAt: string
  deletedBy: ActorRef
  reason?: string
}
```

规则：

- `DocumentId` 在 project 内唯一；
- `DocumentType` 使用 dot namespace，例如 `loom.fragmentSet`、`sillytavern.character`、`extension.example.settings`；
- `system.*` document types 由 Kernel 或 official extension 保留；
- Extension-owned document type 应以 extension id 或明确 namespace 前缀命名；
- Document content 必须 JSON-serializable；
- `source` 用于 Dev Workspace source mapping，不是 Runtime 输入 contract。

---

## 3. Revision / Changeset / Checkpoint

```ts
type DocumentRevision<T = unknown> = {
  id: string
  documentId: DocumentId
  type: DocumentType
  version: RevisionNumber
  content: T | null
  meta: DocumentMeta
  changesetId: ChangesetId
  createdAt: string
  createdBy: ActorRef
}

type Changeset = {
  id: ChangesetId
  createdAt: string
  createdBy: ActorRef
  reason?: string
  correlationId?: string
  callId?: string
  parentCallId?: string
  operations: ChangesetOperation[]
}

type ChangesetOperation = {
  kind: 'create' | 'update' | 'delete' | 'restore'
  documentId: DocumentId
  type: DocumentType
  fromVersion?: RevisionNumber
  toVersion: RevisionNumber
}

type Checkpoint = {
  id: CheckpointId
  name?: string
  createdAt: string
  createdBy: ActorRef
  reason?: string
  documentVersions: Record<DocumentId, RevisionNumber>
  correlationId?: string
  callId?: string
}
```

规则：

- version 从 1 开始递增；
- 每次 write/delete/restore 都创建新 revision；
- 历史 revision 与 changeset append-only；
- checkpoint 记录 document version map，不是数据库 snapshot dump；
- checkpoint restore 必须 restore-as-new-version；
- **大 Checkpoint 机制约束**：核心存储推荐仅在**用户单次输入/交互开启（即任务层级）**时创建 Checkpoint。Agent 内部一系列的原子级操作（如多次高频 ToolCall、子 Agent 调度等）不生成单独的 checkpoint，避免频繁持久化导致 revision 和 checkpoint 链条膨胀。原子级的小回滚可作为插件扩展支持，不属于核心底座规格。

---

## 4. Public Interface MVP

```ts
type DocumentStore = {
  get<T = unknown>(id: DocumentId, options?: DocumentGetOptions): Promise<DocumentRecord<T> | null>
  list(options?: DocumentListOptions): Promise<DocumentRecord[]>
  write<T = unknown>(input: DocumentWriteInput<T>, options: DocumentWriteOptions): Promise<DocumentWriteResult>
  delete(id: DocumentId, options: DocumentDeleteOptions): Promise<DocumentWriteResult>
  transact<T>(input: DocumentTransactionInput, fn: DocumentTransactionFn<T>): Promise<T>
  createCheckpoint(input: CreateCheckpointInput): Promise<Checkpoint>
  restoreCheckpoint(input: RestoreCheckpointInput): Promise<DocumentWriteResult>
  getRevision<T = unknown>(documentId: DocumentId, version: RevisionNumber): Promise<DocumentRevision<T> | null>
  listRevisions(documentId: DocumentId): Promise<DocumentRevision[]>
}
```

MVP 可以先实现 `get/list/write/delete/transact`，但类型应预留 checkpoint / revision。

---

## 5. Read / Write Options

```ts
type DocumentGetOptions = {
  includeTombstone?: boolean
  version?: RevisionNumber
}

type DocumentListOptions = {
  type?: DocumentType
  includeTombstone?: boolean
  ownerExtensionId?: string
  limit?: number
  cursor?: string
}

type DocumentWriteInput<T = unknown> = {
  id?: DocumentId
  type: DocumentType
  content: T
  meta?: Partial<DocumentMeta>
}

type DocumentWriteOptions = {
  expectedVersion?: RevisionNumber | 'new'
  reason?: string
  actor: ActorRef
  correlationId?: string
  callId?: string
  parentCallId?: string
}

type DocumentDeleteOptions = {
  expectedVersion?: RevisionNumber
  reason?: string
  actor: ActorRef
  correlationId?: string
  callId?: string
  parentCallId?: string
}

type DocumentWriteResult = {
  changesetId: ChangesetId
  documents: DocumentRecord[]
  operations: ChangesetOperation[]
}
```

规则：

- `get(id)` 与 `list()` 默认不返回 tombstoned documents；
- `get(id, { version })` 读取历史 revision，不改变 current state；
- `expectedVersion: 'new'` 表示必须 create；
- `expectedVersion: number` 表示 optimistic concurrency check；
- 未提供 `expectedVersion` 时允许 last-write-wins，但 DevTool 应提示风险；
- `actor` 必填；
- `correlationId` / `callId` 应从 transport 或 extension context 继承。

---

## 6. Transaction Semantics

```ts
type DocumentTransactionInput = {
  reason?: string
  actor: ActorRef
  correlationId?: string
  callId?: string
  parentCallId?: string
}

type DocumentTransactionFn<T> = (tx: DocumentTransaction) => Promise<T>

type DocumentTransaction = {
  get<T = unknown>(id: DocumentId, options?: DocumentGetOptions): Promise<DocumentRecord<T> | null>
  list(options?: DocumentListOptions): Promise<DocumentRecord[]>
  write<T = unknown>(input: DocumentWriteInput<T>, options?: Omit<DocumentWriteOptions, 'actor'>): Promise<DocumentRecord<T>>
  delete(id: DocumentId, options?: Omit<DocumentDeleteOptions, 'actor'>): Promise<DocumentRecord>
}
```

规则：

- 一个 successful transaction 生成一个 changeset；
- transaction 内多个 write/delete 合并进同一 changeset；
- SQL transaction rollback 只撤销未提交写入；
- 已提交用户级 rollback 由 restore-as-new-version 实现；
- transaction commit 后再发布 events，避免观察者看到半提交状态。

---

## 7. Tombstone Delete

删除不是物理删除。

`delete(id)` 必须：

1. 校验 document 存在且未 tombstoned；
2. 校验 `expectedVersion`；
3. 写入新 revision；
4. current state 标记 `meta.tombstone`；
5. 在 changeset 中记录 `kind: 'delete'`；
6. 发布 `docs.changed` event。

恢复 tombstoned document 也不是抹掉 tombstone 历史，而是写入新的 current revision。

---

## 8. Restore-as-New-Version

回滚原则与粒度约束：

```text
Kernel-managed Documents are rollbackable.
Extension-managed scratch data is rollback-notified.
External side effects are audit-only.
Trace and Audit are facts, never rolled back.
Business rollback semantics are extension-defined.
```

- **任务级大 Checkpoint 回滚**：为了兼顾性能与使用体验，回滚是以“用户输入/新一轮交互开始时的大 Checkpoint”为基准。回滚时，中间所有的原子化状态变动（如 ToolCall 产生的 hp 扣减、临时草稿等）全部同步恢复，无需也禁止在中间每一个微小步骤都创建 checkpoint。

Document restore 流程：

```text
select target revision/checkpoint
  -> read historical content/state
  -> create new revisions with restored content/state
  -> create new changeset kind=restore
  -> emit docs.changed
  -> emit scratch invalidation notification
  -> append audit fact
```

禁止：

- 移动 current version 指针到旧 revision；
- 删除 newer revisions；
- 改写 trace / audit facts；
- 试图撤销外部 provider/tool side effects。

---

## 9. Document Events

写入后发布：

```ts
type DocumentChangedEvent = {
  name: 'docs.changed'
  payload: {
    changesetId: ChangesetId
    operations: ChangesetOperation[]
    documents: Array<{
      id: DocumentId
      type: DocumentType
      version: RevisionNumber
      tombstoned: boolean
    }>
  }
  meta: EventMeta
}
```

规则：

- event 在 commit 成功后发布；
- event payload 不需要携带完整 document content；
- 需要内容的订阅者应再调用 `docs.get`；
- restore / import / workspace sync 都使用同一事件模型；
- Extension scratch/cache/index 通过 event 或专门 invalidation event 自行失效。

---

## 10. Conflict and Error Semantics

推荐错误码：

| Code | Meaning |
|---|---|
| `document.not_found` | document 不存在，或 tombstoned 且未 includeTombstone |
| `document.conflict` | `expectedVersion` 不匹配 |
| `document.type_forbidden` | 尝试写入保留类型 |
| `document.invalid_content` | content 非 JSON-serializable 或 schema 校验失败 |
| `document.transaction_failed` | transaction 内部失败并 rollback 未提交写入 |

所有错误应转成 `SerializedError`，并保留 correlation 信息。

---

## 11. Permission Boundary

MVP 最小规则：

- `system.*` 只能由 Kernel 或显式授权 official extension 写入；
- Extension 只能写自己拥有或被授权的 document types；
- `ownerExtensionId` 不能由普通 caller 任意伪造；
- Workspace Adapter import 应使用 adapter actor，并记录 source mapping；
- Client 写入必须通过 Kernel method，不得直接访问 store implementation。

完整 capability security model 延后。

---

## 12. Non-Goals

本文不定义：

- 具体 SQLite schema；
- index strategy；
- migration framework；
- query language；
- CRDT / 多人协作；
- Git-backed rollback；
- Chat message schema；
- Provider call persistence schema；
- Tool result schema。

---

## 13. Document History

- 2026-05-13: Draft v0.1. 定义 Document Store MVP interface、revision/changeset/checkpoint、tombstone、transaction、restore-as-new-version 与 event 语义。
