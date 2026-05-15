# Loom Studio Data Layer Architecture

> **Status**: Draft v0.1（数据层问题与能力清单，2026-05-04）
> **Purpose**: 明确 Loom Studio 数据层必须解决的问题、必须提供的能力，以及不应承诺的边界。
> **Audience**: Studio Kernel 实现者、Extension 作者、Runtime Extension 作者、DevTool 作者。
> **Principle**: 本文只定义“我们需要解决的问题”和“平台需要提供的能力”。具体 schema / SQLite 表结构 / API 细节可在后续工程文档中继续收敛。

---

## 0. 这份文档解决什么问题

Loom Studio 的数据层不是一个简单的 KV store，也不是 chat 专用数据库。它要支撑的是一个 Extension 生态：

- 多个 Concept Stack 共存；
- Chat / Agent / Workflow / Tool / Provider 等 Runtime Extension 自己定义业务状态；
- `@loom/core` 的 trace / diagnostics / replay 需要可持久化；
- Extension 可以维护私有索引 / cache / 外部资源；
- 用户需要回滚、重 roll、分支、撤销实验；
- DevTool 需要解释“这次操作改了哪些数据”；
- Kernel 不能内置 chat / message / provider / agent 语义。

因此，数据层要回答的问题不是“chat 表怎么设计”，而是：

> **Studio 如何提供一组通用的数据原语，让 Extension 可以安全、可观测、可回滚地维护自己的业务状态。**

---

## 1. 数据层需要解决的核心问题

### P1. Extension 需要统一的持久化对象

Studio 必须允许 Extension 持久化自己的业务数据，例如：

- chat session；
- chat message；
- character card；
- worldbook entry；
- agent run；
- agent step；
- workflow node；
- tool execution；
- provider call record；
- memory entry；
- user setting；
- system trace；
- system audit。

但 Kernel 不能理解这些类型的业务语义。

需要的能力：

- typed JSON Document；
- document type namespace；
- document type schema introspection；
- CRUD；
- list / query；
- optimistic version；
- system namespace。

---

### P2. 一次操作可能修改多个 Document

一次用户操作 / Runtime step 可能同时修改多份数据。

例如一次 chat send 可能写入：

- user message；
- assistant message；
- session head pointer；
- provider call record；
- tool execution record；
- memory entry；
- system trace；
- system audit。

如果这些写入不能被归为同一个逻辑操作，DevTool 无法解释，回滚也无法一致执行。

需要的能力：

- changeset；
- write grouping；
- operation reason；
- actor / caller；
- correlationId；
- parentCallId；
- traceId 关联；
- changeset-level event。

---

### P3. 用户需要回滚到某个业务位置

用户并不会说“恢复 document A 到 version 7”。用户会说：

- 重 roll 这一条回复；
- 回到第 N 条消息；
- 撤销这次 agent step；
- 回到 workflow 的某个节点；
- 撤销刚才导入的一批数据；
- 把实验参数恢复到生成前。

这些是业务语义，Kernel 不应该内置。但 Kernel 必须提供足够的数据原语，让 Extension 能实现这些语义。

需要的能力：

- document revision history；
- checkpoint；
- rollback to checkpoint；
- revert changeset；
- restore document version；
- tombstone delete；
- rollback event；
- rollback audit。

---

### P4. 回滚必须跨 Extension 可见

一个 Extension 的回滚可能影响另一个 Extension 的派生状态。

例如：

- chat message 回滚后，memory extension 的向量索引需要重建；
- worldbook entry 回滚后，search extension 的缓存需要失效；
- agent step 回滚后，UI projection 需要刷新；
- document 删除恢复后，DevTool 的 timeline 需要重新标记。

Kernel 不应该直接修改 Extension 的私有派生数据，但必须通知。

需要的能力：

- system-level document changed event；
- checkpoint created event；
- rollback started / completed / failed event；
- changed document list；
- affected type list；
- oldVersion / newVersion；
- operation kind；
- correlationId。

---

### P5. 数据分为 Kernel 管理、Extension 自管、外部副作用三类

Studio 中不是所有状态都能被 Kernel 回滚。

#### Kernel-managed state

放在 Document Store 中。

Kernel 可以：

- version；
- changeset；
- checkpoint；
- rollback；
- emit event；
- audit。

#### Extension-managed state

放在 Extension Scratch Space 中，例如：

- vector index；
- cache；
- local sqlite；
- binary blobs；
- embeddings store；
- provider response cache。

Kernel 不读、不写、不回滚，只能通知。

#### External side effects

已经离开 Studio 进程，例如：

- provider request；
- MCP filesystem write；
- HTTP webhook；
- remote API mutation；
- 已扣费调用。

Kernel 不能回滚，只能 audit。

需要的能力：

- 明确三类状态边界；
- rollback event；
- scratch dirty / rebuild convention；
- audit-only side effect record；
- Extension 自行补偿的 hook。

---

### P6. Trace / Audit 是事实记录，不应回滚

业务状态可以回滚，但事实记录不能回滚。

如果用户重 roll 一条 assistant message：

- 原 assistant message 可以被 tombstone / restore / branch；
- 新 assistant message 可以生成；
- 旧 provider call audit 仍然存在；
- 旧 Loom trace 仍然存在；
- rollback 本身也要被 audit。

需要的能力：

- `system.trace` immutable；
- `system.audit` append-only；
- rollback creates new facts；
- DevTool 能看到“旧事实 + 当前状态”。

---

### P7. Extension 需要维护自己的业务图结构

Chat / Agent / Workflow 都不是简单列表。

可能需要：

- chat message tree；
- swipe / branch；
- current head；
- parent message；
- agent step graph；
- workflow DAG；
- tool execution dependency；
- memory source reference。

Kernel 不应提供图数据库语义，但 Document Store 必须允许 Extension 在 JSON data 中表达这些关系。

需要的能力：

- arbitrary JSON data；
- stable document id；
- references by id；
- list by type；
- tag / metadata query；
- no hard foreign key requirement；
- orphan detection as introspection / DevTool aid。

---

### P8. 数据层必须支撑本地优先与可迁移

Studio 面向本地部署用户。数据层必须支持：

- 单 workspace 携带全部内容；
- 可备份；
- 可迁移；
- 可压缩；
- 可 git 管理部分内容；
- Extension 卸载后数据不立刻丢失；
- 未来 backend 可替换。

需要的能力：

- workspace-local storage；
- default SQLite backend；
- backend interface；
- orphan document policy；
- export / import 能力；
- lockfile / extension id / schema metadata 关联。

---

## 2. 数据层需要提供的核心能力

### C1. Document Store

Document 是 Studio 数据层的最小持久化单位。

需要提供：

```text
get(id)
put(doc)
patch(id, patch, expectedVersion)
delete(id, expectedVersion)
list(type, query?)
getVersion(id, version)
```

能力要求：

- 每个 Document 有 `id`、`type`、`version`、`content`、`meta`；
- `type` 只是命名空间字符串，Kernel 不理解业务语义；
- `content` 是 JSON；
- `version` 单调递增；
- 删除默认为 tombstone，不直接物理删除；
- system documents 也走同一套 Document Store。

---

### C2. Document Type Registry

Extension 可以注册 Document type。

需要提供：

- type name；
- owner extension id；
- schema；
- description；
- version；
- whether system-owned；
- introspection output。

Kernel 不需要用 schema 做业务校验，但 schema 必须被 DevTool / UI / 外部客户端发现。

---

### C3. Revision History

为了支持回滚，Document Store 需要保留历史版本。

需要提供：

- 每次 create / update / delete / restore 都生成 revision；
- 可以读取指定 version；
- revision 记录 operation；
- revision 关联 changeset；
- revision 可被 DevTool 展示；
- retention policy 后续可配置。

关键原则：

> 回滚不是把 version 倒退，而是基于旧版本创建新的当前版本。

---

### C4. Changeset

Changeset 表示一次逻辑操作产生的一组 Document writes。

需要提供：

- changeId；
- actor；
- reason；
- correlationId；
- parentCallId；
- traceId；
- write records；
- commit status；
- revert capability。

MVP 可以先提供隐式 changeset：每个 write 自动归属一个 changeId；Runtime / RPC / LoomRunner 可以显式传入 correlationId。

后续可以提供显式事务式 API：

```text
withChangeset({ reason, correlationId }, fn)
```

---

### C5. Checkpoint

Checkpoint 表示一组 Document 在某一刻的版本集合。

需要提供：

- checkpoint id；
- label / reason；
- actor；
- correlationId；
- docId -> version/null；
- rollback to checkpoint。

MVP 只需要支持显式 docIds：

```text
createCheckpoint({ docIds })
rollbackCheckpoint(checkpointId)
```

不需要第一版支持复杂 query scope。

---

### C6. Rollback / Restore

Rollback 是数据层能力，不是 chat 语义。

需要提供：

- restore document to version；
- rollback checkpoint；
- revert changeset；
- rollback result；
- rollback diagnostics；
- rollback event；
- rollback audit。

语义要求：

- restore 生成新版本；
- 被恢复的旧版本不消失；
- Trace / Audit 不回滚；
- Scratch Space 不自动回滚；
- External side effects 不回滚。

---

### C7. Data Events

数据变化必须可被 Extension / UI / DevTool 观察。

需要提供系统事件：

```text
docs.changed
docs.checkpoint.created
docs.rollback.started
docs.rollback.completed
docs.rollback.failed
```

事件必须包含：

- changeId / rollbackId；
- actor；
- correlationId；
- affected documents；
- doc type；
- oldVersion；
- newVersion；
- operation。

业务 Extension 可以在此基础上发自己的事件，例如：

```text
st.chat.rerolled
st.chat.branch.created
agent.step.reverted
```

---

### C8. Orphan Handling

Extension 卸载后，其 Document 可能仍然存在。

需要提供：

- orphan detection；
- orphan introspection；
- preserve / export / delete 选项；
- reload extension 后恢复解释能力；
- DevTool 可查看 orphan document raw JSON。

Kernel 不应该因为 type owner 不存在就删除数据。

---

### C9. Scratch Space Notification

Extension 私有数据不参与 Kernel rollback，但需要通知。

需要提供：

- rollback completed event；
- document changed event；
- affected document ids / types；
- Extension 可以根据事件重建 index / 清 cache / 标 dirty。

推荐约定：

```text
共享事实进 Document Store；
私有派生进 Scratch Space；
外部副作用进 Audit。
```

---

### C10. Audit Correlation

数据写入、RPC、Loom trace、rollback 必须能串起来。

需要提供：

- correlationId；
- parentCallId；
- traceId；
- actor；
- clientId；
- extensionId；
- changesetId；
- rollbackId。

DevTool 应能从一次用户操作看到：

```text
RPC call
  -> Document writes
  -> Loom trace
  -> Provider RPC audit
  -> Tool RPC audit
  -> Rollback / restore
```

---

## 3. Chat 场景如何使用这些能力

本节不是 Kernel 设计，而是验证数据原语是否足够。

### 3.1 重 roll assistant message

Chat Runtime 可以选择：

- 保留 user message；
- tombstone 当前 assistant message；
- 生成新的 assistant message；
- update session head；
- 写入 changeset；
- 发 `st.chat.rerolled`。

Kernel 只看到 Document writes。

### 3.2 回到第 N 条消息

Chat Runtime 可以选择截断式或分支式。

#### 截断式

- tombstone N 之后的 message docs；
- update session head；
- changeset commit。

#### 分支式

- 保留旧 messages；
- create branch doc；
- update current head pointer；
- changeset commit。

Kernel 不知道 message 顺序，不知道 branch 语义。

### 3.3 回到生成前状态

Chat Runtime 可以在生成前创建 checkpoint：

```text
checkpoint includes:
  session doc
  current message docs
  runtime state docs
```

需要回滚时调用：

```text
rollbackCheckpoint(checkpointId)
```

Kernel 恢复这些 Document，发 rollback event。Chat Runtime 再决定是否发业务事件。

---

## 4. Agent / Tool 场景如何使用这些能力

### 4.1 Agent step rollback

Agent Runtime 可以把每一步写成：

- `agent.step`；
- `tool.execution`；
- `agent.observation`；
- `agent.state`。

每一步归属一个 changeset。

回滚某一步时：

- revert changeset；
- 或 rollback checkpoint；
- Trace / provider audit 保留；
- Scratch Space 收事件后自行修复。

### 4.2 Tool side effect

如果 tool 只写 Document Store，可以回滚。

如果 tool 修改外部系统，例如 MCP filesystem write，Kernel 不能撤销。Tool Extension 应：

- 在 audit 中记录外部副作用；
- 可选实现 compensating RPC；
- 在 rollback event 后自行决定是否补偿。

Kernel 不承诺外部 side effect rollback。

---

## 5. 数据层非目标

数据层不做：

- chat schema；
- message schema；
- branch / swipe / reroll 业务语义；
- Agent step 语义；
- Provider call 语义；
- Tool loop；
- MCP rollback；
- 外部 API 副作用撤销；
- Scratch Space 自动回滚；
- schema 驱动业务校验；
- graph database；
- vector search；
- full-text search；
- cloud sync；
- multi-user permission model。

这些可以由 Extension / backend / 后续文档提供。

---

## 6. 需要后续工程化的问题

本文刻意不直接拍板所有实现细节，但以下问题必须在工程文档中继续解决：

1. SQLite 表结构如何表达 documents / revisions / changesets / checkpoints；
2. tombstone delete 的查询默认行为；
3. revision retention policy；
4. rollback 与并发写冲突如何处理；
5. changeset 是否需要显式 transaction API；
6. rollback event 是否在事务提交后同步发出；
7. memory backend 是否必须完整模拟 revision 语义；
8. checkpoint 是否允许 doc 不存在时记录 null；
9. orphan document 的 export 格式；
10. DevTool 如何展示 current state vs historical facts；
11. Scratch Space dirty / rebuild convention；
12. external side effect compensation convention。

---

## 7. 初步成功标准

数据层 MVP 完成的判据：

1. Document CRUD 可用；
2. Document version 单调递增；
3. Document revision history 可读；
4. delete 是 tombstone；
5. write 产生 changeset / change record；
6. createCheckpoint(docIds) 可用；
7. rollbackCheckpoint(checkpointId) 可用；
8. rollback 以 restore-as-new-version 方式实现；
9. docs.changed event 可用；
10. rollback started / completed / failed event 可用；
11. Trace / Audit 不参与回滚；
12. Scratch Space 不参与回滚，但能收到事件；
13. Extension 能基于这些能力实现 chat reroll / truncate / branch；
14. DevTool 能展示一次 rollback 改了哪些 Document。

---

## 8. 核心原则总结

```text
Kernel-managed Documents are rollbackable.
Extension-managed scratch data is rollback-notified.
External side effects are audit-only.
Trace and Audit are facts, never rolled back.
Business rollback semantics are extension-defined.
```

中文：

```text
Kernel 管理的 Document 可回滚；
Extension 自管的 Scratch 数据只通知回滚；
外部副作用只审计记录；
Trace / Audit 是事实记录，永不回滚；
业务级回滚语义由 Extension 定义。
```

这就是 Studio 数据层的边界纪律。
