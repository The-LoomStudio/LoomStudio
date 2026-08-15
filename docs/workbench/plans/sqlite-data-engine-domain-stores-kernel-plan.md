# SQLite Data Engine / Domain Stores / Kernel 提交事实实施计划

> **状态**：Implemented / Phase 1–6 Complete / Phase 7 Deferred
> **日期**：2026-08-12
> **范围**：将当前“Document Store 同时承担 SQLite 生命周期、所有业务持久化与全平台提交事实”的实现，收束为共享 SQLite Data Engine、版本化 Document Store、Application-owned Domain Stores 与统一 Commit Journal。
> **事实边界**：共享 SQLite Data Engine、Document Store、Narrative Store、Agent Store、Commit Journal 与 Kernel `DataCommitSource` 已完成；本文保留实施背景。Phase 7 的容量测量、Retention、FTS5 与冷归档仍未实施。
> **数据兼容**：当前数据库主要是开发测试数据。本计划不要求保留旧 AIRP Session 数据；Document Store 中仍有价值的 Card、Prompt Resource、Provider 配置应由实施阶段明确决定保留或重新导入。

相关文档：

- [`document-store-kernel-data-foundation-plan.md`](document-store-kernel-data-foundation-plan.md)
- [`agent-session-narrative-timeline-data-layer-plan.md`](agent-session-narrative-timeline-data-layer-plan.md)
- [`local-data-blob-store-foundation-plan.md`](local-data-blob-store-foundation-plan.md)
- [`../discussion/data/studio-data-layer-architecture.md`](../discussion/data/studio-data-layer-architecture.md)
- [`../discussion/data/studio-document-store-engineering-v0.md`](../discussion/data/studio-document-store-engineering-v0.md)
- [`../discussion/kernel/studio-kernel-public-surface-v0.md`](../discussion/kernel/studio-kernel-public-surface-v0.md)

---

## 0. 本轮收束决定

Loom Studio 继续使用单个本地 SQLite 数据库作为活跃结构化数据的主要持久化引擎，但不再要求所有数据都变成带完整 Revision 的 Document。

目标边界：

```text
Studio Server Composition Root
  -> SQLite Data Engine
       -> Document Store
       -> Narrative Store
       -> Agent Store
       -> Commit Journal
       -> future rebuildable projections

  -> Kernel
       -> Document Store public capability
       -> Data Commit subscription
       -> RPC Registry / Event Bus / Extension Host

  -> Application Runtime
       -> Data Transaction Runner
       -> Document Store
       -> Narrative Store
       -> Agent Store

Filesystem
  -> content-addressed Blob Store / Export / Log / Cache / Cold Archive
```

基础规则：

1. SQLite 是共享存储引擎，不等于只有一张通用业务表；
2. Document 是“中小型、可编辑、需要独立版本和 Revision”的领域聚合；
3. 高频追加、创建后不可变、按稳定关系键分页的数据使用专用 Domain Store；
4. 所有权威 Store 共用同一个 SQLite transaction 与 Commit Journal；
5. Kernel 只理解领域无关的 Commit Fact，不理解 Narrative、Agent、Card 或 Prompt Schema；
6. Kernel 继续公开 `docs.*`，但不向普通 Client 或 Extension 公开原始 SQL 或 Domain Store；
7. `docs.changed` 只描述 Document 操作；跨 Store 提交通过新的 `data.changed` 描述；
8. 自动 Revision 回滚只属于 Document Store；Domain Store 使用明确的领域补偿命令；
9. FTS、反向引用和统计表是可重建投影，不成为第二事实源；
10. 不引入 ORM、Repository 基类、通用 Query DSL、Event Sourcing 或多数据库协调器。

---

## 1. 当前实现事实与失配

### 1.1 当前组合根

`apps/studio-server/src/main.ts` 当前只创建一个 `DocumentStore`：

```text
createSqliteDocumentStore
  -> Application Runtime
  -> AI Gateway
  -> Extension Host
  -> Kernel
```

该结构保证所有 Document 写入共享同一 Commit Fact，但也使 Application Runtime 只能通过 Document 语义持久化任何新对象。

### 1.2 当前 SQLite 写入

每次 Document create / update / delete 都会：

```text
serialize content/meta
  -> upsert documents current row
  -> insert full document_revisions row
  -> append operation to changeset
```

因此一次写入至少保存一份当前内容和一份完整 Revision。对于真正需要历史版本的资源，这是有意的能力；对于只创建一次的 append-only record，这是无意义的重复。

### 1.3 当前查询能力

Document Store 当前主要支持：

- `id` 精确读取；
- `type`、`ownerExtensionId`、tombstone 的通用分页；
- `documentId + version` 历史读取；
- Changeset 查询与 Document Revision 回滚。

它没有按 JSON 内部关系字段建立通用查询合同。Narrative Node 或 Agent Message 如果继续作为 Document，将无法直接利用：

```text
(timeline_id, parent_node_id)
(agent_session_id, sequence)
run_id
created_at
```

等稳定 SQL 索引。

### 1.4 Kernel 当前耦合点

Kernel 当前直接订阅：

```text
DocumentStore.subscribeCommits(DocumentCommitFact)
  -> docs.changed
```

这把两个本应独立的概念绑定在了一起：

```text
Document revision commit
platform data commit
```

当 Narrative / Agent 使用专用表后，Kernel 不应分别订阅业务 Store，也不应由 Application Runtime 手工补发平台事件。统一提交事实必须下沉到所有 Store 共享的 Data Engine。

---

## 2. 数据分类与 Store 边界

### 2.1 Document Store

适合：

- Card Manifest；
- Preset / Agent Preset；
- Setting Layer / Prompt Resource；
- Provider Account / Model Profile；
- Extension 的中小型、用户可见、可编辑 typed data；
- 确实需要 optimistic version、Revision、Changeset revert 的对象。

Document Store 保留：

```text
documents
document_revisions
docs.* RPC
typed JSON content
owner extension metadata
tombstone
expectedVersion
document-only revert
```

这里的 Revision 当前仍是完整 JSON snapshot，不是 JSON Diff。Document 适合的是体积可控、编辑频率有限、整份聚合版本有产品价值的文本/配置对象；不能因为一次逻辑修改很小，就假定物理 Revision 也只保存一个小 diff。

不适合：

- Narrative Node；
- Agent Message；
- Runtime Trace / Log；
- 大型二进制；
- 向量索引、缓存与 Extension scratch data；
- 每轮都会更新 head、但没有独立用户编辑历史价值的状态行。

### 2.2 Narrative Store

Narrative Store 是 Application-owned persistence capability，使用专用关系表保存 Timeline、Branch 与 Node。

首版目标表：

```text
narrative_timelines
narrative_branches
narrative_nodes
```

稳定身份、关系、分页和并发字段进入 SQL 列；复杂来源信息继续使用受控 JSON：

```text
narrative_timelines:
  id
  version
  title
  created_from_card_id
  created_from_card_version
  prompt_resource_ids_json
  active_branch_id
  tombstoned
  created_at
  updated_at

narrative_branches:
  id
  timeline_id
  version
  title
  head_node_id
  parent_branch_id
  forked_from_node_id
  created_at
  updated_at

narrative_nodes:
  id
  timeline_id
  parent_node_id
  body_format
  body_raw
  source_json
  created_at
```

Node 首版创建后不可变，因此不建立 `narrative_node_revisions`。

### 2.3 Agent Store

Agent Store 保存 Agent Session 根状态和 append-only Chat Message。

首版目标表：

```text
agent_sessions
agent_messages
```

建议字段：

```text
agent_sessions:
  id
  version
  agent_preset_id
  title
  head_message_id
  message_count
  tombstoned
  created_at
  updated_at

agent_messages:
  id
  agent_session_id
  parent_message_id
  sequence
  run_id
  message_json
  created_at
```

Message 首版创建后不可变，因此不建立 `agent_message_revisions`。

### 2.4 Filesystem 与非权威数据

Filesystem 继续承载：

- 图片、音频、视频和原始 PNG；
- byte-perfect Artifact；
- 大型 Provider / Tool payload；
- JSON / YAML / JSONL 导出；
- 日志；
- 已关闭会话的未来冷归档。

活跃 Timeline 和 Agent Session 不直接以一组可被外部任意修改的 JSON/JSONL 文件作为权威源。

---

## 3. SQLite Data Engine

### 3.1 最小职责

Data Engine 只负责：

```text
SQLite connection lifecycle
foreign_keys / WAL initialization
namespaced schema migrations
single-connection transaction serialization
transaction metadata
Commit Journal insertion
post-commit observer notification
close
```

Data Engine 不负责：

- 业务 Schema 校验；
- Narrative 或 Agent 领域操作；
- Extension 权限；
- RPC；
- PromptBuild；
- 自动把任意 JSON 映射为 SQL。

### 3.2 Transaction Contract

概念接口：

```ts
type DataTransactionMeta = {
  actor: ActorRef
  reason?: string
  correlationId?: string
  callId?: string
  parentCallId?: string
}

type DataEngine = {
  transact<T>(
    meta: DataTransactionMeta,
    run: (tx: DataTransaction) => Promise<T>,
  ): Promise<{ value: T; commit: DataCommitFact }>

  subscribeCommits(handler: (fact: DataCommitFact) => void): Disposable
  close(): void
}

type DataTransactionRunner = Pick<DataEngine, 'transact'>
type DataCommitSource = Pick<DataEngine, 'subscribeCommits'>
```

`DataTransaction` 是 Store implementation 使用的受控 transaction handle，不进入 Client、Extension SDK 或普通业务 RPC。

### 3.3 Store 写入规则

每个 Store 在 transaction 内：

1. 校验自己的领域约束；
2. 执行 SQL；
3. 向 transaction collector 记录不含正文的 operation summary；
4. 不自行发布事件；
5. 不自行写入第二份 Changeset。

transaction 成功后，Data Engine：

1. 写入一次 Commit Journal；
2. commit SQLite transaction；
3. 生成一次 `DataCommitFact`；
4. 通知 observers；
5. observer 失败不得反向破坏已提交数据。

空 transaction 应拒绝提交，避免产生没有事实内容的 Changeset。

### 3.4 Migration

当前 `PRAGMA user_version` 只描述 Document Store 自己的 schema。多 Store 后改用最小 namespaced migration registry：

```text
schema_migrations
  namespace TEXT PRIMARY KEY
  version INTEGER NOT NULL
```

首版 namespace：

```text
platform.documents
application.narrative
application.agent
```

规则：

- 同一 namespace 内 migration 严格递增；
- Server composition 明确注册顺序；
- migration 与 version 更新处于同一 transaction；
- 高于程序支持版本时拒绝启动；
- 当前开发数据允许清理后建立新 schema，不实现旧 Session 自动迁移。

---

## 4. Commit Journal 与回滚边界

### 4.1 Data Commit Fact

目标事实只携带 identity 与关联信息，不携带正文、Prompt、Message 或隐私数据：

```ts
type DataCommitOperation = {
  store: 'documents' | 'narrative' | 'agent'
  kind: 'create' | 'update' | 'delete' | 'restore'
  entityType: string
  entityId: string
  fromVersion?: number
  toVersion?: number
}

type DataCommitFact = {
  changesetId: string
  committedAt: string
  actor: ActorRef
  reason?: string
  correlationId?: string
  callId?: string
  parentCallId?: string
  operations: DataCommitOperation[]
}
```

`entityType` 使用领域命名空间字符串，例如：

```text
airp.promptResource
airp.narrativeTimeline
airp.narrativeBranch
airp.narrativeNode
airp.agentSession
airp.agentMessage
```

Data Engine 不解释这些字符串。

### 4.2 Changeset 不是全能 Undo

新的 Changeset 表示“一次已提交数据 transaction 的事实”，不再承诺所有 operation 都能通过通用 Revision 自动恢复。

首版规则：

- 纯 Document Changeset 可以继续由 `docs.revertChangeset` 生成反向 Revision；
- 包含 Narrative 或 Agent operation 的 Changeset，`docs.revertChangeset` 必须拒绝；
- Narrative 回退通过移动 Branch head、Fork 或明确删除命令完成；
- Agent Message 首版不可原地编辑或通用回滚；
- 未来如需跨 Store Undo，必须由 Application 提供明确的补偿 operation，不在 Data Engine 中建立业务补偿注册表。

这保留审计与关联价值，同时避免把所有数据重新塞回 Revision 模型。

---

## 5. Kernel 目标边界

### 5.1 Constructor

目标 Kernel 组合依赖：

```ts
type CreateKernelOptions = {
  documents: DocumentStore
  dataCommits: DataCommitSource
  diagnostics: DiagnosticsRegistry
  traceAudit: TraceAuditStore
  extensionHost: ExtensionHost
  loomRunner: LoomRunner
}
```

Kernel 不接收：

```text
NarrativeStore
AgentStore
SQLite DatabaseSync
DataTransaction
Application Runtime
```

`documents` 继续用于 `docs.*` RPC；`dataCommits` 只用于订阅平台提交事实。

### 5.2 Event Projection

Kernel 从同一个 `DataCommitFact` 投影事件：

```text
every successful data commit
  -> data.changed

commit contains document operations
  -> docs.changed
```

规则：

- 一次 commit 最多产生一次 `data.changed`；
- 一次含 Document operation 的 commit 最多产生一次 `docs.changed`；
- `docs.changed` payload 只包含 Document 子集；
- Kernel 不自动生成 `narrative.changed` 或 `agent.changed`；
- Application / Extension 可以订阅 `data.changed` 后按 entity type 派生自己的领域行为；
- 事件 payload 不包含完整 content。

`data.*` 首版只保留为 Kernel-owned event namespace，不新增 `data.*` 通用 RPC family。

### 5.3 Public Surface

Kernel 继续提供：

```text
getDocumentStore()
docs.*
events.*
system.introspect
```

首版不提供：

```text
getNarrativeStore()
getAgentStore()
data.querySql
data.transact RPC
Extension raw database handle
```

Narrative / Agent 能力通过 Application RPC 或未来受控 Capability 暴露。

---

## 6. Application Runtime 与 Server 组合

### 6.1 Server Composition Root

目标启动顺序：

```text
create SQLite Data Engine
  -> register / run Document migrations
  -> register / run Narrative migrations
  -> register / run Agent migrations
  -> create Document Store
  -> create Narrative Store
  -> create Agent Store
  -> create Application Runtime
  -> create Extension Host with Document Store only
  -> create Kernel with Document Store + Data Commit Source
```

Extension Host 首版仍然只获得受控 Document capability。Extension 的大型私有数据继续走自己的 Scratch Space，不自动获得平台 Domain Store。

### 6.2 Application Runtime Options

目标：

```ts
type ApplicationRuntimeOptions = {
  data: DataTransactionRunner
  documents: DocumentStore
  narrative: NarrativeStore
  agents: AgentStore
  // existing gateway/logger/clock
}
```

Prompt Resource、Card、Preset 等继续走 Document Store；Timeline 与 Agent Session 不再通过 `readDocument/listDocuments` helper 读取。

Application Runtime 需要跨 Store 原子写入时显式打开 Data transaction：

```ts
await data.transact(meta, async tx => {
  const messages = await agents.appendMessages(tx, input.messages)
  const narrative = input.commit
    ? await narrativeStore.appendNode(tx, input.commit)
    : undefined

  return { messages, narrative }
})
```

Domain Store mutation 接受受控 `DataTransaction`；read operation 可以直接使用 Store reader。普通 Client、Extension 与 Provider Adapter 不获得该 transaction handle。

### 6.3 In-memory Tests

Data Engine 重构不能迫使所有单元测试启动真实磁盘数据库。

首版提供：

- SQLite `:memory:` Data Engine，覆盖真实 SQL transaction；
- 纯领域函数测试使用轻量 Store fake；
- 不再要求为所有 Domain Store 复制一整套通用 InMemory Document Store 行为。

SQLite `:memory:` 应成为跨 Store transaction 和 migration 测试的主要入口。

---

## 7. 分阶段实施

### Phase 0：文档边界

1. 将旧“所有 Kernel-managed state 都是 Document”的 Discussion 标记为历史假设；
2. 将 Agent Session / Narrative Timeline 计划改为专用 Domain Store；
3. 保持 Architecture 文档继续描述当前实现，不提前写入目标事实；
4. 固化 Document、Domain Record、Asset、Projection 的边界。

验证检查点：Workbench 不再要求 Narrative Node / Agent Message 进入 `documents` 或 `document_revisions`。

### Phase 1：Data Commit Contract

状态：**Complete（2026-08-12）**。

1. 新增领域无关 `DataCommitOperation` / `DataCommitFact`；
2. 将当前 Document Commit summary 适配到新 contract；
3. 保持 payload 不含 content；
4. 建立 observer isolation 与 exactly-once process notification 测试。

验证检查点：现有 Document 写入可以产生与当前等价的 `docs.changed`，同时产生一次 `data.changed`。

Phase 1 完成时边界：

- 新增 `@loom-studio/data-engine` 的 `DataCommitFact / DataCommitSource / notifier`；
- Document Store Commit Fact 兼容携带领域无关 operation；
- Kernel constructor 显式接收 `dataCommits`；
- 当时 Server 通过 Document Store adapter 提供 Data Commit Source；
- Kernel 对一次 Document commit 先发布一次 `data.changed`，再发布一次兼容 `docs.changed`；
- SQLite connection、transaction、migration 与 Commit Journal 的提取留给 Phase 2，现已完成。

### Phase 2：SQLite Data Engine

状态：**Complete（2026-08-12）**。

1. 从 `createSqliteDocumentStore` 提取 connection lifecycle、FIFO 和 transaction；
2. 建立 namespaced migration registry；
3. 建立 transaction operation collector 与 Commit Journal；
4. Document Store 改为依赖 Data Engine transaction；
5. 保留 Document create/update/delete/revision/revert 契约。

验证检查点：现有 Document Store contract tests 继续通过；失败 transaction 不写 current row、Revision、Changeset 或 event。

已实现边界：

- Data Engine 统一持有 SQLite connection、FIFO、transaction 与 post-commit notifier；
- `schema_migrations` 按 namespace 管理 `platform.data-engine@1` 与 `platform.documents@1`；
- 通用 `changesets` Commit Journal 由 Engine 写入，operation 不含实体正文；
- Document Store 通过 Engine transaction 写 current row、Revision 与 Document operation；
- Document Store 保留 `{ filename }` 便利入口，并支持组合根注入 `{ engine }`；
- Studio Server 创建和关闭共享 Engine，Document Store 与 Kernel 使用同一提交来源；
- 失败、空 transaction 均回滚且不通知 observer；observer failure 相互隔离。

### Phase 3：Kernel Commit Source 迁移

状态：**Complete（2026-08-12；核心迁移已随 Phase 1 完成，Phase 2 将 Studio Server 切换到共享 Engine source）**。

1. Kernel 从 `DocumentStore.subscribeCommits` 改为 `DataCommitSource.subscribeCommits`；
2. 增加 `data.changed`；
3. `docs.changed` 改为 Document operation projection；
4. `docs.revertChangeset` 拒绝非 Document-only changeset；
5. 更新 introspection 与 event contract tests。

验证检查点：Kernel 不依赖 Domain Store；Application、Extension 和 Kernel Document 写入仍只广播一次。

### Phase 4：Narrative Store

状态：**Foundation Complete（2026-08-12）**。

1. 创建 Narrative tables、constraints 与 indexes；
2. 实现 create timeline、append node、fork branch、switch branch、page；
3. Node insert 与 Branch head update 处于一个 Data Engine transaction；
4. 记录 Narrative operations 到同一 Commit Journal；
5. 不写 Document Revision。

验证检查点：追加 Node 只产生一条 Node row、一次 Branch update 和一个 Changeset，不产生 `documents` / `document_revisions` 行。

已实现边界：

- 新增独立 `@loom-studio/narrative-store`；
- 建立 `application.narrative@1` migration 与 Timeline / Branch / Node 三张表；
- 实现 Timeline + Opening 创建、expected-head append、Branch fork/switch、parent-chain page 与 Timeline tombstone；
- Store 可独立提交，也可通过 `transaction(dataTx)` 参与跨 Store transaction；
- Node provenance 自动记录当前 Changeset ID；
- cursor、fork source 与 Branch/Timeline 归属均在 Store 内校验；
- Studio Server 已创建并注入 Narrative Store；Application Runtime 与 Server RPC 已提供 create/get/page/fork/switch/delete 生命周期；
- 后续 Phase 6 已删除旧 Session / submitTurn 后端链；Studio Client 迁移状态见独立的 Agent Session / Narrative Timeline 数据层计划。

### Phase 5：Agent Store

状态：**Foundation + Lifecycle API Complete（2026-08-12）**。

1. 创建 Agent tables、constraints 与 indexes；
2. 实现 Session create/delete、Message append/page；
3. Message append 与 Session head/count update 原子提交；
4. Message 不写 Revision；
5. ToolCall / ToolResult 关联由 Agent Store / Runtime 校验。

验证检查点：一万条 Message 可以按 `(agent_session_id, sequence)` 分页，不扫描全部 `documents.content_json`。

已实现边界：

- 新增独立 `@loom-studio/agent-store` 与 `application.agent@1` migration；
- 建立 Agent Session、append-only Message 与 ToolCall 配对索引；
- 实现 create/get/page/delete 与内部批量 append；
- sequence 由 Store 在 transaction 内分配，`expectedMessageCount` 负责并发保护；
- 支持已批准的 `system/developer/user/assistant/tool` Message 子集与工具调用配对校验；
- Studio Server 已创建并注入 Agent Store，公开 create/get/page/delete RPC；
- append 保持 Runtime 内部能力，不向普通 Client RPC 暴露；
- 后续 Phase 6 已将 AIRP Turn Flow 与 Provider 调用切换到 Agent / Narrative Store，并删除 Transcript 镜像后端链；Studio Client 仍待迁移。

### Phase 6：Application / Server 切换

状态：**Complete（2026-08-12）**。

1. Server 创建并关闭 Data Engine；
2. Application Runtime 注入三个 Store；
3. Extension Host 继续只接收 Document capability；
4. AIRP Turn Flow 改用 Narrative / Agent transaction；
5. 删除旧 Session / Transcript Document 路径；
6. 清理开发数据库后建立新 schema。

验证检查点：Card / Prompt Resource 仍走 Document Store；Timeline / Agent 历史完全不再写入 Document 表。

### Phase 7：测量与后续策略

测量：

- Document Revision / WAL 增长；
- 500 Entry Prompt Resource 连续编辑；
- 1k / 10k / 100k Narrative Node 和 Agent Message 的 append/page；
- Data Commit Journal 体积；
- Server startup migration 时间；
- SQLite file / WAL size。

测量后才决定：

- Document Revision retention；
- FTS5；
- closed Timeline JSONL cold archive；
- commit journal retention；
- 大型 Tool Payload Store。

---

## 8. 最小验证策略

### Data Engine

- 同一 transaction 跨两个 Store 提交成功；
- 任一 Store 失败时整体回滚；
- 一个 transaction 只有一个 Changeset；
- commit 后才通知 observer；
- observer failure 不影响其他 observer；
- migration 失败完整回滚；
- 新于程序支持版本的 namespace 拒绝启动。

### Document Store

- current row 与 Revision 仍保持一致；
- optimistic concurrency；
- tombstone / restore；
- Document-only changeset revert；
- Extension ownership metadata；
- 旧 `docs.*` RPC contract。

### Narrative / Agent

- append 与 head update 原子性；
- FK / ownership relation 校验；
- cursor pagination；
- restart recovery；
- 不产生 Document Revision；
- Data Commit Fact 只含 identity；
- 非 Document Changeset 不能经 `docs.revertChangeset` 回滚。

### Kernel

- 一次 commit 一次 `data.changed`；
- 含 Document operation 时一次 `docs.changed`；
- Domain-only commit 不产生 `docs.changed`；
- Kernel constructor 和 public getters 不暴露 Domain Store；
- event metadata 保留 correlation / call chain。

---

## 9. 风险与停止条件

### 9.1 Data Engine 变成第二个 Kernel

风险：Data Engine 开始注册 Store、理解业务类型或提供通用数据 RPC。

处理：Data Engine 只管理 SQLite、transaction、migration 和 Commit Journal；Store 由 Server composition 显式创建。

### 9.2 通用 Changeset 回滚语义被误用

风险：调用方认为所有 `changesetId` 都能通过 `docs.revertChangeset` 自动恢复。

处理：RPC 明确验证 operation store；非 Document-only Changeset 返回稳定错误，领域回退使用领域命令。

### 9.3 Store 各自发布事件

风险：同一提交出现 Data Engine、Application 和 Kernel 三次广播。

处理：平台事实只由 Data Engine post-commit observer 产生；Application 领域事件必须引用同一个 `changesetId`，且不能伪装成第二次 data commit。

### 9.4 为插件开放原始 Domain Store

风险：Extension 绕过 Capability、Schema 校验与权限直接修改核心表。

处理：Extension Host 继续提供受控 Documents/RPC/Capability；不暴露 SQL handle。

### 9.5 过早迁移现有资源

风险：为统一新架构，同时重写已工作的 Card、Prompt Resource 与 Provider 数据。

处理：本计划只移动底层 transaction/commit ownership；现有适合 Document 的资源保持当前 Schema。

---

## 10. 完成标准

1. SQLite connection、migration、transaction 与 Commit Journal 不再由 Document Store 私有拥有；
2. Document Store 只承担版本化 typed JSON Document；
3. Narrative Timeline / Branch / Node 使用专用 SQL tables；
4. Agent Session / Message 使用专用 SQL tables；
5. Node / Message 不生成完整 Revision；
6. 所有权威 Store 可以共享同一个 SQLite transaction；
7. 所有成功 transaction 只生成一个 Data Commit Fact；
8. Kernel 只订阅 Data Commit Source，不依赖 Narrative / Agent Store；
9. `data.changed` 覆盖所有 Store，`docs.changed` 只覆盖 Document operation；
10. Document-only Changeset 仍可通用 revert，Domain Changeset 必须使用领域补偿；
11. Extension 不能直接访问 SQLite 或核心 Domain Store；
12. Architecture 文档在代码和测试完成后再更新为最终事实。

---

## 11. 本计划明确不处理

- ORM；
- 通用 Repository framework；
- SQL Query RPC；
- Extension 自定义平台 SQL tables；
- 分布式 transaction；
- 多进程 SQLite writer；
- Event Sourcing；
- 任意跨 Store 自动 Undo；
- Narrative State Store / checkpoint；
- FTS 与向量检索；
- Revision / Commit Journal 自动 GC；
- JSONL 活跃会话权威存储；
- 旧 AIRP Session 数据迁移器。

这些能力只能由真实产品依赖与测量结果触发，不能为了“统一架构”提前进入 Data Engine。
