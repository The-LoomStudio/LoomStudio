# LoomStudio 后端数据层 Schema 与 ID 绑定审计（2026-09-21）

> **状态**：Open
>
> **审计基线**：`main` / `517a05f` + 当前未提交工作树
>
> **范围**：SQLite Data Engine、Document Store、Blob / Asset Store、State Store、Narrative Store、Prompt Resource Store；重点检查 SQL Schema、迁移、主外键、权威指针 ID、跨 Store 绑定和删除/恢复后的引用完整性
>
> **明确排除**：Agent、CodeAct 及其直接运行链路；不审 Agent Session、Transcript、Provider Step、VFS 执行器和相关生命周期行为

## 结论

本轮集中审查后端数据底座，确认 **2 个 P2**：

| 编号 | 级别 | 结论 |
| --- | --- | --- |
| DATA-001 | P2 | Prompt Resource v4 迁移重建 `prompt_resource_nodes` 时丢失资源归属与父子关系外键；迁移完成后 SQLite 仍显示外键开启，但 Schema 已不再约束节点绑定 |
| DATA-002 | P2 | 多个同一数据域内的权威指针 ID 没有 SQL 外键或复合外键约束，完整性主要依赖 Store 函数；Schema 启动检查也不会发现这些绑定约束缺失 |

当前没有把跨 Store 的 `promptResourceIds`、Narrative 的 `stateRevisionId`、Card 来源 ID 等登记为缺陷。文档明确允许这类引用由 Application Runtime 负责解析和校验；本轮只登记同一数据域内部应该由 SQL 约束保护的绑定。

## 已确认问题

### DATA-001 · P2 · Prompt Resource v4 迁移丢失节点外键

Prompt Resource v1 为 `prompt_resource_nodes` 声明了两项关键约束：

- `resource_id REFERENCES prompt_resources(id)`，保证节点属于已存在的 Resource；
- `FOREIGN KEY(resource_id, parent_id) REFERENCES prompt_resource_nodes(resource_id, id)`，保证父节点与子节点属于同一个 Resource。

证据见 `packages/application-data/src/prompt-resource/schema.ts:22-39`。

但 v4 为重建节点表创建 `prompt_resource_nodes_new` 时只保留了列和 `UNIQUE(resource_id, id)`，没有重新声明这两项外键，随后直接 `DROP TABLE` 旧表并改名，见 `packages/application-data/src/prompt-resource/schema.ts:124-146`。当前 Data Engine 迁移流程会在迁移期间关闭外键并在结束时重新开启，但不会验证迁移后的外键列表或运行约束合同，见 `packages/data-engine/src/sqlite.ts:245-269`。

运行时探针在全新内存数据库中创建当前 Prompt Resource Schema，结果为：

```text
PRAGMA foreign_keys = 1
PRAGMA foreign_key_list('prompt_resource_nodes') = []
```

在同一数据库中，直接插入 `resource_id = 'missing-resource'`、`parent_id = 'missing-parent'` 的节点也能成功，`PRAGMA foreign_key_check` 不报告任何问题。这说明问题不是“迁移时临时关闭外键”，而是迁移完成后约束本身已经不存在。正常 Store API 仍会通过 `validateTree()` 拦截多数错误，所以现有 Prompt Resource 单元测试可以全部通过；但任何直接使用同一 Engine 的维护代码、未来 Store 路径或数据修复脚本都可以写入无法归属的节点，后续 `readResource()` 只能在读到缺失 Root 时抛出错误，而不是在写入时拒绝，见 `packages/application-data/src/prompt-resource/mutations.ts:333-339`。

**最小修复方向**：

- 新增迁移恢复 `prompt_resource_nodes.resource_id` 外键和 `(resource_id, parent_id)` 复合外键；
- 同时为 `prompt_resources.root_node_id` 建立能够约束“Root 必须属于当前 Resource”的复合绑定，不能只依赖 `root_node_id` 的单列存在性；
- 为每个迁移 Namespace 增加约束级 Schema 断言，至少核对关键 `PRAGMA foreign_key_list`、唯一索引和 `PRAGMA foreign_key_check`；
- 增加从旧版本升级到 v4/v5 的迁移测试，不能只测全新数据库从头创建。

**关闭条件**：

- 当前版本及升级后的数据库中，节点 Resource 归属和父子关系均由 SQL 外键约束；
- `root_node_id` 不可能指向其他 Resource 的节点；
- 迁移测试覆盖已有数据、外键保留和错误数据拒绝；
- 不依赖 Store 层的 `validateTree()` 单独证明底层 Schema 完整。

### DATA-002 · P2 · 权威指针 ID 缺少同域 SQL 绑定

当前多个字段在逻辑上是同一数据域内的权威指针，但 Schema 只把它们定义为普通 `TEXT`，没有外键或复合外键：

- `prompt_resources.root_node_id` 没有指向 `prompt_resource_nodes` 的约束，见 `packages/application-data/src/prompt-resource/schema.ts:7-20`；
- `state_scopes.head_revision_id` 没有指向 `state_revisions(id)` 的约束；`StateStore` 只能在 `setGlobalHead()` 和读取时用代码检查，见 `packages/application-data/src/state/store.ts:522-543`、`packages/application-data/src/state/store.ts:279-287`；
- `narrative_timelines.active_branch_id`、`narrative_branches.head_node_id`、`narrative_branches.forked_from_node_id` 没有对应外键；`narrative_nodes.parent_node_id` 虽有自引用外键，但没有约束父节点与当前 Node 属于同一 Timeline，见 `packages/application-data/src/narrative/store.ts:351-389`；
- `document_revisions.document_id` 没有指向 `documents(id)` 的外键，见 `packages/document-store/src/sqlite-store.ts:49-70`。

这些字段并非普通来源标签，而是读路径会继续追踪的身份绑定。例如 State 的全局快照会先读取 `head_revision_id`，再按该 ID 读取 Revision；一旦数据库中出现悬空 ID，错误会延迟到读取时才暴露。Narrative 的 Branch / Node 指针也会被分页、分支路径和归档读取继续使用。

这类缺口的风险在于：当前写入函数确实做了部分语义校验，但 SQL 本身无法阻止同一连接内的直接写入、遗漏校验的新代码、迁移脚本错误或恢复工具写入跨对象 ID。对于底层数据模块，Store 逻辑校验应该是错误信息和业务规则层，不能替代同域身份关系的数据库约束。

**最小修复方向**：

- 对 `State` 的 Global Head、`Document Revision -> Document`、`Prompt Resource Root -> Node` 增加外键；
- 对 Narrative 的 Active Branch、Branch Head / Fork Node、Node Parent 使用包含所属 ID 的复合外键，确保“存在”与“属于同一 Timeline”同时成立；
- 需要保留 tombstone / immutable history 时使用普通 `NO ACTION` 外键，不要为了方便使用级联删除；
- 为迁移后的 Schema 写一份集中式关系合同，避免只检查列名存在。

**关闭条件**：

- 每个同域权威指针都有可检查的 SQL 关系约束，或在 issue 中明确记录为什么必须保持软引用；
- 跨域软引用与同域硬绑定的边界写入数据架构文档；
- 测试覆盖悬空 ID、跨 Timeline 父节点、跨 Resource Root 和孤立 Document Revision 的拒绝行为；
- 正常 Store API 与直接 SQL 约束的失败语义没有互相矛盾。

## 已核对但不登记为问题

- `state_revisions.scope_id`、`parent_revision_id` 以及 Asset 到 Blob 的外键当前存在；没有把已有约束重复登记。
- Setting Mount 的 `setting_resource_id`、Preset Tool Mount 的 `preset_resource_id` 当前有 Resource 外键；`global_setting_mounts.source_id` 同时承载 `manual/global` 和 Preset ID，是带判别字段的业务绑定，当前由 `validateMountSource()` 校验，暂不把它与同域主从关系混为一谈。
- Narrative 的 `prompt_resource_ids_json` 与 `state_revision_id` 属于跨 Store 软绑定。当前 Application Runtime 会在组合、归档导入和删除流程中解析或重写这些 ID；本轮不强行把跨域关系下沉为 SQLite 外键。
- Blob Store 的内容寻址、SHA-256 唯一约束、Asset 到 Blob 的引用关系和两阶段写入属于另一条存储链，本轮没有发现足以升级为独立问题的 SQL 缺陷。
- Data Engine 的单连接 FIFO、`BEGIN IMMEDIATE`、空事务拒绝、失败回滚和提交后通知均有对应测试；提交后观察者异常被吞掉是已记录的通知边界，不属于本轮 SQL / Schema / ID 绑定问题。

## 验证记录

- 阅读 `docs/architecture/data/README.md`、`docs/architecture/data/local-storage-and-assets.md`、`docs/architecture/application/data-capabilities-and-lifecycle.md` 及相关 Package README。
- 静态检查 Data Engine、Document、Blob、Asset、State、Narrative、Prompt Resource 的迁移和 SQL 外键声明。
- 使用真实 `createSqliteDataEngine()` 与 `createPromptResourceStore()` 创建内存数据库，查询 `PRAGMA foreign_keys`、`PRAGMA foreign_key_list(...)` 和 `PRAGMA foreign_key_check`；确认 Prompt Resource v4 后节点外键列表为空，并确认悬空节点插入成功。
- `pnpm exec vitest run tests/unit/data-engine/sqlite-data-engine.test.ts tests/unit/prompt-resource-store/prompt-resource-store.test.ts tests/unit/state-store/state-store.test.ts tests/unit/narrative-store/narrative-store.test.ts tests/unit/document-store/sqlite-store.test.ts tests/unit/asset-store/asset-store.test.ts`：6 个文件、49 个测试通过。
- 未修改业务代码；未运行全仓 build、lint 或全量测试。当前工作区已有哥哥未提交的改动，本轮没有覆盖、回滚或格式化这些改动。

## 不纳入本轮

- Agent、CodeAct、Agent Runtime、Provider Step、Transcript 和 VFS；
- 仅凭“某个 ID 没有跨表外键”就要求所有跨领域引用改成硬 FK；
- Blob 文件 GC、备份恢复策略、数据库加密和部署运维；
- 性能、分页稳定性和客户端视觉行为。
