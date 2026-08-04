# Document Store / Kernel 数据基础实施计划

> **状态**：In Progress / Phase 4 Complete — Pause and Measure
> **日期**：2026-07-30
> **范围**：统一 Document Store 提交事实、Kernel 事件传播、SQLite Schema 演进、Card Resource 引用完整性和 Extension 数据权限边界。
> **实施约束**：本文属于 Workbench 工程计划；只有经过代码与测试证明的稳定事实才能写入 `docs/architecture`。

---

## 0. 本轮收束决定

Loom Studio 继续采用统一、版本化的 Document Store 作为业务事实源：

```text
Application / Kernel / Extension
  -> Document Store Transaction
  -> SQLite Commit
  -> Changeset
  -> Commit Fact
       -> Kernel docs.changed
       -> Structured Document Log
       -> future projections
```

核心决定：

1. `documents.content_json` 继续保存完整 typed JSON Document；
2. 修改 Document 时允许全量重写 `content_json`，不把所有 JSON KV 映射为 SQL 行；
3. Card、Session、Prompt Resource 和 Extension Document 继续共享 `documents`、`document_revisions`、`changesets` 三张权威表；
4. SQL 关系表、FTS 搜索表只允许作为可重建投影，不得成为第二事实源；
5. 二进制 Asset、日志、Metric、Cache 和重型 Extension scratch data 不进入普通 Document；
6. Kernel 不理解 Card、Prompt、Setting、Session 或 Extension 业务 Schema；
7. 所有成功 Document Store 提交必须经过同一条 Commit Fact 管线，不能由不同调用方各自补发事件；
8. 没有测量证据前，不拆 Setting Entry Document，不建设 Patch、EAV、通用 Binding Graph 或分布式数据层。

本计划承接但不重复：

- `card-resource-manifest-migration-plan.md`：Card / Resource / Session 权威链；
- `archive/plans/document-edit-history-plan.md`：transaction、revision、changeset、revert 基础语义；
- `ADR-003-asset-store-and-binary-payload-boundary.md`：二进制与 JSON 控制面的边界。

---

## 1. 当前代码事实

### 1.1 SQLite 物理结构

当前 SQLite backend 维护：

```text
documents
document_revisions
changesets
```

`documents` 使用：

```text
id                 -> 全局本地 Document 主键
type               -> Application / Extension 定义的领域类型
version            -> optimistic concurrency 版本
content_json       -> 完整 Document 内容
meta_json          -> actor、source、ownership、tombstone 等 metadata
owner_extension_id -> Extension 所有权查询索引
tombstoned         -> 当前删除状态
updated_at         -> 通用更新时间索引候选
```

当前有效查询能力主要是：

- 按 `id` 精确读取；
- 按 `type`、`ownerExtensionId`、tombstone 状态分页列举；
- 按 Document ID + version 读取历史 Revision；
- 按 Changeset ID 查询和反向恢复。

当前没有：

- JSON 内部字段索引；
- Card -> Resource 反向引用索引；
- Prompt Entry FTS；
- SQLite Schema migration version；
- Revision retention / compact / GC；
- Application mutation 的统一 Kernel Commit Event 管线。

### 1.2 当前 Document 聚合边界

当前一个顶层 Prompt Resource 是一个完整 Document：

```ts
type PromptResourceContent = {
  resourceKind: PromptResourceKind
  rootNode: PromptResourceNode
  sourceArtifactRef?: CardBundleSourceArtifactRef
  createdAt: string
  updatedAt: string
}
```

修改其中一个 Entry 会：

```text
读取完整 Resource JSON
  -> 修改一棵内存树中的一个节点
  -> 序列化完整 content_json
  -> 写入完整新 Revision
```

这是当前接受的聚合写入语义，不是待修 Bug。

### 1.3 当前 Commit 传播缺口

Kernel `docs.write`、`docs.delete`、`docs.revertChangeset` 会在成功提交后发布 `docs.changed`。

Extension Host 写入后也会通过 Server adapter 显式发布 `docs.changed`。

Application Runtime 直接使用同一个 Document Store，但 Application transaction 当前不会统一进入 Kernel EventBus。因此目前存在：

```text
Document 已提交
Changeset 已生成
结构化日志可记录
但 Kernel docs.changed 可能缺失
```

这不是 Document Store 原子性问题，而是 Commit Fact 的跨层传播缺口。

---

## 2. 基准负载与拆分判断

### 2.1 当前目标负载

参考现有 SillyTavern 生态，一张完成度较高的 Card 常见约：

```text
400–500 Setting / World Info Entries
```

其中会包含大量动态提示词条件，例如：

- 变量条件；
- 阶段性开关；
- keyword / tag activation；
- 角色状态或剧情阶段选择；
- 不同 Zone / Slot 的条件贡献。

这类动态性首先是 Prompt Resource 的声明式规则和 Session Runtime State 的组合，不等于每轮都要高频重写 400–500 条静态 Resource Entry。

### 2.2 当前判断

400–500 个 Entry 本身不触发以下重构：

- 每 Entry 独立 Document；
- 每 KV 独立 SQL 行；
- JSON Patch / Diff Revision；
- Resource 内部关系表；
- 通用动态变量覆盖层；
- 专用分库。

必须先测量：

- 序列化后的 Resource byte size；
- 单 Entry 编辑的事务耗时；
- PromptBuild 读取和 JSON parse 耗时；
- 100 次编辑后的 Revision / WAL 增长；
- export / import 的峰值内存；
- 多 Card / Session 引用相同 Resource 时的读取规模。

### 2.3 Entry 拆分触发条件

只有出现至少一项真实证据时，才重新讨论 Entry Document 化：

1. 单 Resource 持续达到数 MB 且经常编辑；
2. 高频修改单个 Entry 导致明显写放大；
3. Revision 体积成为用户可见问题；
4. Entry 需要独立版本、权限、共享或撤销；
5. Resource 内部搜索无法由派生 FTS 投影满足；
6. 加载完整 Resource 成为可复现的交互延迟来源。

即使触发，也应先调整 Document 聚合边界，而不是把 JSON 变成通用 KV / EAV 表。

---

## 3. 目标职责边界

### 3.1 Document Store

Document Store 负责：

- typed JSON persistence；
- transaction；
- optimistic version；
- revision；
- changeset；
- tombstone；
- revert-as-new-changeset；
- backend-neutral commit fact。

Document Store 不负责：

- 发布 Kernel Event；
- 解释 Card / Prompt / Session Schema；
- 决定 Extension 权限；
- 维护 UI state；
- 保存二进制、日志或 Metric；
- 直接实现领域搜索和推荐。

### 3.2 Kernel

Kernel 负责：

- 将已提交的通用 Commit Fact 转换为 `docs.changed`；
- 根据 Commit actor 生成当前 MVP 的 source / clientId，并传播 correlationId、callId 和 parentCallId；完整 actor 以 Changeset 为权威来源；
- 保持事件为提交后事实，不把 EventBus 变成 Command Bus；
- 对远程 `docs.*` 补充可信调用身份。

Kernel 不负责：

- 解析 `content_json`；
- 校验 Prompt Resource Node；
- 判断 Card Resource 顺序；
- 决定 Setting Entry 是否应拆分；
- 维护 SQL 投影的领域规则。

### 3.3 Application Runtime

Application Runtime 负责：

- Card Bundle 与 Prompt Resource Schema 校验；
- Card Manifest 引用完整性；
- Prompt Resource 内 Node ID 唯一性；
- Session 启动时复制 Resource IDs；
- Bundle import / export round-trip；
- 领域操作 reason 和 mutation receipt。

### 3.4 Extension Host

Extension Host 负责：

- 注入 Extension actor 和 `ownerExtensionId`；
- 强制 Document Type 声明与 namespace；
- 执行读写 capability；
- 禁止 Extension 直接访问 SQLite implementation；
- 让 Extension 写入复用统一 Commit Fact 管线。

---

## 4. Commit Fact 最小契约

目标是让一次成功 transaction 产生一个与后端实现无关的提交事实。

建议最小形态：

```ts
type DocumentChangeSummary = {
  id: string
  type: string
  version: number
  tombstoned: boolean
}

type DocumentCommitFact = {
  changeset: Changeset
  documents: DocumentChangeSummary[]
}
```

约束：

- 不包含完整 `content_json`；
- 不泄漏敏感字段；
- 一次 transaction 只产生一个 Fact；
- 失败 transaction 不产生 Fact；
- 同一 transaction 多次修改同一 Document，只报告最终版本；
- create + delete 等归并语义与 Changeset 完全一致；
- In-memory 与 SQLite backend 行为一致。

具体实现可在施工前从以下最小方案中选择：

1. 扩展 `DocumentTransactionResult`，直接返回最终 Document summaries；
2. 在 Document Store public API 外增加统一 observer decorator；
3. 两者组合：Store 返回 Commit Fact，Server decorator 负责分发。

不得采用：

- Application、Kernel、Extension Host 分别手写不同的事件逻辑；
- Document Store import Kernel EventBus；
- 为生成事件在提交后重新读取完整 `content_json`；
- 一个多 Document transaction 广播 N 个不相关 `docs.changed`。

---

## 5. 分阶段实施计划

### Phase 1：统一 Document Commit Fact

状态：已完成（2026-07-30）。

目标：建立所有写入路径共用的提交事实。

任务：

1. 为 transaction result 增加最终 Document summary；
2. In-memory / SQLite 共用同一 Commit Fact 契约；
3. 单次 `write/delete` 继续表现为单操作 transaction；
4. `revertChangeset` 返回反向 Changeset 的 Commit Fact；
5. 保持现有 `WriteDocumentResult` 对外兼容，避免一次性扩大调用面；
6. 增加 backend parity tests。

验证：

- 一次 Bundle import 创建多个 Documents，但只得到一个 Commit Fact；
- transaction 内同一 Document 多次写入只报告最终版本；
- rollback 后没有 current、revision、changeset 或 Commit Fact 残留；
- delete / restore / redo summary 正确；
- Commit Fact 不包含 Document content。

实施结果：

- 新增 `DocumentChangeSummary`、`DocumentCommitFact` 和兼容的 `DocumentCommitResult`；
- 顶层 `write/delete/revertChangeset` 返回已提交的 `commit`，事务内部 `tx.write/delete` 不伪造未提交事实；
- `DocumentTransactionResult` 保留原有 `changeset`，同时提供统一 `commit`；
- 最终摘要直接从 Pending Changeset 的聚合状态生成，不在提交后重新读取 `content_json`；
- In-memory / SQLite 共用同一生成函数和契约；
- backend parity tests 已覆盖多 Document、同 Document 多次写入、rollback、delete / restore / redo 和内容隔离。

验证记录：

- TypeScript：`pnpm exec tsc -b --pretty false` 通过；
- 聚焦测试：2 files / 17 tests 通过；
- 全量测试：56 files / 231 tests 通过；
- 沙箱内全量测试曾因 `listen EPERM` 失败，允许本地端口后全部通过。

### Phase 2：统一 Kernel `docs.changed`

状态：已完成（2026-07-30）。

目标：所有写入者只通过 Commit Fact 发布一次平台事实事件。

任务：

1. Server 组合层订阅或观察 Commit Fact；
2. 将 Fact 转换成现有 `docs.changed` payload；
3. 删除 Kernel `docs.write/delete/revert` 中的重复手动发布；
4. 删除 Extension Host adapter 中的重复手动发布；
5. Application transaction 自动获得同样事件；
6. 保持 `docs.rollback.completed/failed` 的领域无关语义；
7. Document 日志与事件共享同一提交事实，但保持 Log 与 Event 类型分离。

实施结果：

- Document Store 提供领域无关的 `subscribeCommits`，只在持久化成功后通知一次；
- Kernel 启动时订阅 Commit Fact，并统一生成 `docs.changed` payload 与 trace metadata；
- Application Runtime 通过共享 Store transaction 自动进入同一事件链；
- Extension 写入依据 Changeset actor 自动获得 `extension:<id>` source，不再由 Host 手动补发；
- 删除 Kernel `docs.write/delete/revertChangeset` 和 Extension Host 的重复 `docs.changed` 拼装逻辑；
- `docs.rollback.completed/failed` 保留独立语义，成功回滚仍先产生一次 `docs.changed`；
- post-commit observer 异常与已提交写入隔离，避免数据已落盘但调用方收到写入失败。

验证记录：

- TypeScript：`pnpm exec tsc -b --pretty false` 通过；
- 聚焦测试：6 files / 41 tests 通过；
- 全量测试：56 files / 234 tests 通过；
- Studio Server 集成测试在允许本地端口的环境中通过；
- `git diff --check` 通过。

验证：

- Application、Kernel、Extension 三条写入路径各发布一次事件；
- event metadata 与 Changeset metadata 一致；
- Bundle import 的一次 transaction 不产生事件风暴；
- 失败不发布 `docs.changed`；
- 日志与 Event 都不包含 Card 名称、Prompt 内容或私密字段。

### Phase 3：Application 数据正确性

状态：已完成（2026-07-30）。

目标：补齐 Card Resource Manifest 和 Bundle 信任边界。

任务：

1. 修复 `artifact.card.preset` / `settingLayer` 导入导出往返丢失；
2. 为 `importCardBundle` 接入 `RuntimeRequestContext`；
3. 增加 Card Bundle 递归结构校验；
4. 校验单 Resource 内 Node ID 不重复；
5. 增加最小 Card Manifest 更新 API；
6. 校验 `promptResourceIds` 不重复、存在且类型正确；
7. 明确旧 Session 不随 Card Manifest 更新；
8. 保持删除 Card 不级联删除共享 Resource。

建议窄 API：

```ts
application.updateCardPromptResources({
  cardId,
  promptResourceIds,
})
```

实施结果：

- Bundle 导入使用统一 Card normalizer 保存 `preset`、`opening` 与 `settingLayer`，导出和重新导入不再丢失这些字段；
- `importCardBundle` 接收 `RuntimeRequestContext`，Changeset 继承可信 client actor、correlationId、callId 与 parentCallId；
- `isCardBundleArtifact` 从浅层检查升级为递归 Card / Prompt Resource Node / Capability 校验；
- 每个 Prompt Resource 内 Node ID 必须唯一，导入和后续 Resource root 写入共用同一规则；
- 新增 `application.updateCardPromptResources`，只接受完整有序 `promptResourceIds`；
- Manifest 更新拒绝重复 ID、缺失 Document 与错误 Document Type；
- 已创建 Session 保留创建时 Resource IDs，新 Session 使用更新后的 Card Manifest；
- 删除 Card 不级联删除 Resource，两张 Card 可以继续共享同一 Prompt Resource；
- Client typed API 与 RPC reference 已同步新增方法。

验证记录：

- TypeScript：`pnpm exec tsc -b --pretty false` 通过；
- 聚焦测试：9 files / 40 tests 通过；
- 全量测试：56 files / 239 tests 通过；
- Studio Server 集成测试在允许本地端口的环境中通过；
- `git diff --check` 通过。

本阶段不增加通用 Binding Graph。

### Phase 4：SQLite Schema Migration 基线

状态：已完成（2026-07-30）。

目标：结束仅依靠 `CREATE TABLE IF NOT EXISTS` 的 Schema 演进方式。

任务：

1. 使用 SQLite 原生 `PRAGMA user_version`；
2. 将当前三表四索引定义固化为 schema version 1；
3. 建立顺序、幂等、事务化 migration runner；
4. 数据库版本高于当前程序时拒绝启动；
5. migration 失败时完整 rollback；
6. 不引入 Prisma、TypeORM 或 migration dependency；
7. In-memory backend 不伪装 SQL migration，但保持 Document Store contract 一致。

验证：

- 空数据库创建为 version 1；
- version 0 可升级到 version 1；
- migration 中途失败不留下半更新 Schema；
- 高版本数据库不会被低版本程序静默打开；
- WAL、foreign key 和索引设置保持有效。

实施结果：

- 使用 SQLite 原生 `PRAGMA user_version`，当前程序支持 schema version 1；
- 原有三张表与四个索引原样固化为 migration 1；
- migration runner 只按连续版本顺序执行，每个版本使用独立 `BEGIN IMMEDIATE` transaction；
- migration 成功后在同一事务中更新 `user_version`，失败时完整 rollback；
- version 0 的现有数据库可升级并保留 Documents、Revisions 与 Changesets；
- SQLite 单连接的公开读写使用最小 FIFO 串行化，transaction 内部操作不重复入队；
- version 0 在推进版本前校验三张核心表的必需列，不完整 Schema 会回滚并拒绝打开；
- 数据库版本高于当前程序时，在修改 WAL 等持久设置前拒绝打开；
- 初始化或 migration 失败时主动关闭 SQLite handle；
- 未引入 ORM、migration package 或新的运行时依赖。

验证记录：

- TypeScript：`pnpm exec tsc -b --pretty false` 通过；
- 聚焦测试：2 files / 23 tests 通过；
- 全量测试：56 files / 243 tests 通过；
- fresh create、version 0→1、失败 rollback、高版本拒绝、reopen persistence 与 WAL mode 均已覆盖；
- Studio Server 集成测试在允许本地端口的环境中通过；
- `git diff --check` 通过。

审计收口（2026-08-03）：

- SQLite 公开读写按单连接 FIFO 串行执行，避免嵌套事务与未提交读取；
- migration 在推进 `user_version` 前校验核心表必需列；
- MVP EventBus 隔离单个订阅者异常，坏消费者不再截断后续广播；
- 当前 Event metadata 只保留归一化 `source` / `clientId`，完整 actor 继续以 Changeset 为权威来源；
- 聚焦测试 5 files / 46 tests、全量测试 56 files / 246 tests、TypeScript 与 `git diff --check` 均通过。

### Phase 5：Extension Document 权限门

状态：待实施，不阻塞 Phase 1–4。

目标：把 `ownerExtensionId` 从 metadata 标记升级为 Host 授权边界。

任务：

1. Extension 写入的 type 必须在 manifest 声明；
2. 默认要求 type 位于 Extension namespace；
3. 默认只能修改自己拥有的 Document；
4. 读取官方或其他 Extension Document 需要显式 capability；
5. 禁止伪造 actor、owner 和 correlation metadata；
6. Extension transaction API 复用统一 Commit Fact；
7. 保留可信官方 Extension 的可配置高级能力。

### Phase 6：数据库健康度观测

状态：待实施，不实施自动 GC。

目标：先收集是否需要拆分和清理的证据。

建议只读统计：

```ts
type DocumentStoreStats = {
  documentCount: number
  revisionCount: number
  changesetCount: number
  tombstoneCount: number
  databaseBytes?: number
  walBytes?: number
  documentsByType?: Record<string, number>
}
```

增加 400–500 Entry Resource probe：

- import；
- get；
- 单 Entry edit；
- 100 次顺序 edit；
- preview PromptBuild；
- export；
- Revision / WAL size observation。

Probe 用于形成基线，不在普通 CI 中设置脆弱的毫秒级硬门槛。

### Phase 7：触发式派生投影

状态：Deferred / Trigger-gated。

#### `document_links`

触发条件：

- 需要反查引用者；
- 实施 Resource 安全删除 / GC；
- Card / Session 共享 Resource 成为正式产品能力；
- 扫描全部 Card / Session 出现可测瓶颈。

权威来源仍是 Document content，Link 表必须可重建。

#### SQLite FTS5

触发条件：

- Resource Explorer 需要跨 Resource 搜索；
- 需要按 path、tag、label、body 检索 Entry；
- JSON 全量加载和前端过滤出现可复现问题。

FTS 表只保存检索投影，不保存权威 Prompt 内容。

#### Entry Document 化

触发条件见第 2.3 节。不得因为 400–500 Entry 的正常生态规模自动触发。

---

## 6. SQL / 文件 / 其他存储边界

### Document Store / SQLite

适合：

- Card、Session、Prompt Resource；
- Narrative Entry、State、Provider Profile；
- Extension typed user-facing data；
- revision、changeset、tombstone 和 ownership metadata。

### Asset Store / Filesystem

适合：

- PNG、图片、音频、视频；
- 原始导入包和需要 byte-perfect round-trip 的 artifact；
- checksum、thumbnail、streaming data。

Document 只保存 asset reference。

### JSONL / Log Store

适合：

- 结构化运行日志；
- 不参与业务撤销和资源导出的诊断数据。

### Extension Scratch Space

适合：

- 向量索引；
- 可删除派生数据库；
- 大型缓存；
- Extension 私有重型计算数据。

Scratch data 不自动进入平台备份、Document introspection 或 Edit History。

---

## 7. 最小测试闭环

### Document Store

1. In-memory / SQLite Commit Fact parity；
2. multi-document transaction -> one changeset -> one fact；
3. rollback -> zero fact；
4. delete / restore / redo fact；
5. same-document multi-write aggregation；
6. `content_json` 不进入 fact payload。

### Kernel / Server

1. Kernel `docs.write/delete/revert` 各发布一次 `docs.changed`；
2. Application Card / Resource mutation 发布一次 `docs.changed`；
3. Extension write 发布一次 `docs.changed`；
4. Bundle import 创建多个 Documents 但只发布一次；
5. correlation / actor / reason 贯穿 RPC、Changeset、Log、Event；
6. 失败 transaction 不发布成功事件。

### Application

1. Card Bundle `preset` / `settingLayer` 往返保真；
2. 递归非法 Resource Node 在事务前被拒绝；
3. Card Manifest 更新后旧 Session Resource IDs 不变；
4. Resource ID 重复、缺失、错误类型明确失败；
5. 两张 Card 可引用同一 Resource；
6. 删除一张 Card 不删除共享 Resource。

### SQLite migration

1. fresh create；
2. version 0 -> 1；
3. failed migration rollback；
4. newer database rejection；
5. reopen persistence。

---

## 8. 明确非目标

本计划不实施：

- 把每个 JSON KV 映射成 SQL 行；
- 通用 EAV 表；
- Card / Preset / Setting 各自一张权威 SQL 表；
- 默认每 Entry 独立 Document；
- JSON Patch / Diff Revision；
- Runtime Variable System；
- Session Resource Overlay / CoW；
- 通用 Binding Graph；
- Resource 自动去重和网络 Registry；
- Asset Store 具体实现；
- Revision 自动压缩 / GC；
- 多进程写入、远程数据库或 CRDT；
- 让 Extension 直接创建平台 SQLite 表。

这些能力必须由测量结果或独立功能需求重新触发。

---

## 9. 风险与控制

### 9.1 Commit Event 重复

风险：保留 Kernel、Extension Host 的手动 emit，同时增加统一 observer，导致一个 Changeset 广播两次。

控制：Phase 2 必须建立写入路径矩阵并删除旧手动发布；测试按 changesetId 去重审计。

### 9.2 Commit Fact 携带敏感内容

风险：为方便投影而把完整 Card、Prompt 或 Session content 放进通用事件。

控制：Commit Fact 只包含 Document identity、type、version、tombstone 和 Changeset metadata。

### 9.3 投影成为第二事实源

风险：未来 `document_links` 或 FTS 与 `content_json` 漂移。

控制：投影必须可从 Documents 重建；领域读取默认不依赖投影恢复业务内容。

### 9.4 大 Resource 写放大

风险：500 Entry Resource 经频繁编辑导致 Revision 和 WAL 增长。

控制：先建立 probe 和 stats；只有证据满足第 2.3 节条件才调整聚合边界。

### 9.5 权限检查下沉到 Document Store

风险：Document Store 开始理解官方 Card 或具体 Extension capability。

控制：Store 只执行通用 ownership metadata 和版本规则；授权策略由 Kernel / Host facade 执行。

---

## 10. 完成定义

本计划的近期阶段完成时应满足：

```text
所有 Document 写入共享同一个 Commit Fact。
所有成功 Changeset 只产生一次 docs.changed。
Kernel 继续对 Application 业务无感知。
Card Bundle 导入不丢数据并继承可信调用上下文。
Card Manifest 可以通过窄 API 安全修改。
SQLite Schema 有明确版本和 migration 路径。
400–500 Entry Resource 仍作为单个 Document 工作，并有可复现基准数据。
SQL 投影、Entry 拆分和 GC 仍由真实证据触发。
```

建议实施顺序：

```text
Phase 1 Commit Fact
  -> Phase 2 Kernel docs.changed
  -> Phase 3 Application correctness
  -> Phase 4 SQLite migration
  -> pause and measure
  -> Phase 5 Extension permission
  -> Phase 6 stats
  -> Phase 7 trigger-gated projections
```
