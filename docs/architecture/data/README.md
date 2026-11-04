# Data Architecture

本分类用于收录 Loom Studio 已实现并稳定的数据基础语义，包括 Document、Revision、Changeset、持久化、Workspace 同步边界以及提交事实。

## 持久化源码路线

| 要定位的职责 | 下一入口 |
| --- | --- |
| Connection、FIFO、事务、Schema 初始化与提交通知 | [Data Engine README](../../../packages/data-engine/README.md) |
| Document / Revision / Changeset 的版本化操作 | [Document Store README](../../../packages/document-store/README.md) |
| Transcript、正文分支索引、State、Workspace、Prompt Resource 与统计 | [Application Data README](../../../packages/application-data/README.md)；统计的采集与保留口径就近维护在该包内 |
| Blob 字节、Source Artifact 与 Media Asset 元数据 | [Asset Store README](../../../packages/asset-store/README.md) |

本页维护跨 Store 的事务与数据边界，表结构和具体 Store 操作从所属包继续定位。观测存储与模型请求链由 [Application Runtime](../../../packages/application-runtime/README.md)拥有，不按 SQLite 是否存在判断领域归属。

## 资源身份与消费者地址

应用新生成的普通内部 ID 使用 11 位 base62 随机字符串，不包含资源类型前缀；实现见 `packages/shared/src/index.ts` 的 `createId`。类型由领域字段、所属表或既有实体引用协议表达。外部协议身份、固定语义键、内容哈希和安全凭据不套用该格式。

ID 在存取和关联中是不透明字符串。已有长 ID 与新短 ID 使用同一套逻辑，不需要换号、重导或专用旧格式兼容层。身份生成时的冲突处理不能覆盖既有对象；Card 目录还需防止大小写不敏感文件系统将两个不同 ID 视为同一目录。

Narrative 面向 Agent 的地址为 `/narrative/<floor>.md`。宿主在绑定的 Timeline、Branch 和访问范围内解析固定楼号，内部仍保留节点身份、Head 和正文基线。新执行工具的列表、读取、写入与追加回执使用楼层路径；`readNarrative` 的继续读取使用楼层边界。历史工具记录不改写，旧节点 ID 路径不作为新工具接口维护；历史节点本身无需重新生成 ID。

界面和日志消费资源名称及明确的导航目标；完整 ID 放在诊断入口。当前名称属于读取时投影，与运行当时记录的来源、配置和版本事实分开。

## Lore schema 当前基线

Prompt Resource 使用当前 schema namespace `application.prompt-resource@9`。Store 创建时只初始化空 namespace 的最终 DDL；现有 namespace 版本与 9 不匹配时拒绝打开，不执行旧版数据库升级或回填。已完成的 Lore 命名调整属于当前 schema 定义，不是仍可运行的旧库迁移入口。旧数据库和文件型 Lore 迁移脚本均已退出，当前格式输入直接遵循现行合同。

放置规则：

- 与业务无关的持久化原语放在这里；
- Card、Session、Lore 等业务 Document schema 放在 [`../application/`](../application/)；
- Extension 私有 schema 由对应 Extension 负责；
- Kernel 如何通过 RPC 暴露数据能力记录在 [`../kernel/`](../kernel/)；
- UI Undo/Redo history 不等同于 Document Store 的持久化历史。

数据层历史设计过程保留在 [`讨论归档`](../../archive/discussion/README.md)，当前演进从 [Plan](../../workbench/plans/README.md) 进入。具体专题在与当前实现逐项核对后再晋升，本目录不复制候选设计。

本地路径、Blob、Source Artifact 与 Media Asset 的已实现边界见 [`local-storage-and-assets.md`](local-storage-and-assets.md)。

## 当前 SQLite Data Engine 基线

Studio Server 当前创建一个 `@loom-studio/data-engine` SQLite Engine，并把同一 Engine 注入 Document Store。Engine 负责：

- 单 SQLite connection 的生命周期；
- 公开读写的 FIFO 串行化；
- `BEGIN IMMEDIATE` transaction 与失败回滚；
- namespaced schema 初始化；
- 一次 transaction 对应一个 Changeset / Data Commit Fact；
- commit 成功后的进程内通知。

当前 namespace 版本记录在 `schema_migrations(namespace, version)`，不再使用单一 `PRAGMA user_version`。当前已注册：

- `platform.data-engine@1`：`schema_migrations` 与通用 `changesets` Commit Journal；
- `platform.documents@2`：`documents`、`document_revisions` 及其索引与外键约束。
- `platform.blob-store@1`：`stored_blobs` 与 SHA-256 唯一索引；
- `platform.asset-store@1`：`source_artifacts`、`media_assets` 及 Blob / owner 索引。

Store 通过 `initializeSchema({ namespace, version, initialize })` 声明当前 schema。空 namespace 在事务中直接建立当前最终 DDL 并记录版本；版本相同时继续打开；任意已有非零版本不匹配都会拒绝打开，不做连续版本升级、降级或兼容读取。初始化失败时 DDL 与版本记录一起回滚。Engine 使用 WAL 与 foreign key，不依赖 ORM、通用 Repository 或外部 migration framework。

这些数字是持久化 Schema 的内部序号，不是应用发布版本。版本匹配是打开 Store 的条件；当前代码不会自动升级、降级、重建或清空版本不匹配的数据库。

`initializeSchema()` 只用于组合根创建 Store 的启动阶段；运行时读写统一进入 Engine FIFO。transaction callback 必须返回 Promise，并直接使用当前 transaction 暴露的 SQLite connection，不能重新进入排队中的 Engine 方法。

公共写入上下文的字段由 Engine 的 `DataTransactionInput` 统一定义。Agent、Narrative、State、Prompt Resource、Secret、Asset、Blob 的 `*WriteContext` 以及 `DocumentTransactionInput` 保留领域名称并直接别名该类型；Document 单次 `write()` 的可选 actor 合同不因此变为必填。

## 当前 Document Store 持久化基线

Document Store 只拥有 Document 领域表与行为：

- `documents`：当前版本的完整 typed JSON Document；
- `document_revisions`：按 Document ID 与 version 保存历史 Revision；
- Document create、update、delete、restore、optimistic concurrency 与 Document-only revert。

Document Store 不再自行打开第二条 SQLite connection，也不再写第二份 Changeset。它把 Document operation 交给 Engine transaction collector，由共享 `changesets` 表记录提交事实。使用 `{ filename }` 创建仍是兼容便利入口；Studio Server 使用 `{ engine }` 共享平台 Engine，外部 Engine 的关闭责任仍属于组合根。

## 统一分页契约（Keyset Pagination）

当前 Document / Prompt Resource 列表使用明确的游标边界；Narrative 和 Transcript 的历史分页则沿各自 parent 链读取，不能把它们当成同一种排序或快照合同：

- **Document 首次插入顺序**：`DocumentStore.list` 按首次插入序号遍历，更新、tombstone 和恢复保留原行身份；SQLite 采用 UPSERT 保持物理稳定性。游标是不透明的边界令牌，严格绑定所属 `type`、`ownerExtensionId` 与 `includeTombstone` 等筛选条件；篡改游标或更换筛选条件时返回 `document.input_invalid`。默认页长 100，允许范围 1～1000。
- **Prompt Resource 双模游标**：`listResources` 默认按更新时间降序（`updated_at DESC, id DESC`），游标记录读取时的时间与 ID 边界；同时支持按稳定 ID 降序（`order: 'id'`），供 Runtime 全量加载、导出与导入冲突扫描使用。
- **动态集合与一致性边界**：Keyset 游标属于动态集合遍历，不是跨请求只读快照。条目在请求间更新可能越过游标边界；需要全局一致集合的导出、初始化检测与级联清理，必须依赖领域事务、版本校验或提交事实保护。Client 的 Provider、Capability Profile 与 Agent Preset 选择列表用 `collectPages` 完整收集后发布；Narrative 历史仍按需加载旧页，不要求一次读完。

`createInMemoryDocumentStore()` 直接创建独立的 SQLite `:memory:` Store，与文件实例共用 CRUD、JSON、Revision、分页和事务实现，不再维护 Map Store。创建方须在消费者停止后等待 `close()`；外部注入的 Engine 则由组合根关闭。事务内部只使用传入的 transaction 对象，重入外层 Store 会明确失败，而不是排队等待自身。

## 数据保真底线（JSON Fidelity）

数据持久化与序列化严格恪守数据保真底线：

- **拒绝非有限数值**：在写入 SQLite 与跨进程传输边界，显式拒绝 `NaN`、`Infinity` 与 `-Infinity`，严禁将其静默洗成 `null`；
- **保留结构合法值**：保留合法的 `null`、布尔值 `false`、数值 `0`、空字符串对象键以及扩展槽中的合法自定义属性，不通过私自白名单收紧领域演进空间；
- **State Delta 空键重放**：状态变更增量（Delta）对合法空字符串键与嵌套路径提供完整保真支持，确保重放与合并不会造成状态损坏。

## 当前 Data Commit Contract

平台已经定义领域无关的 `DataCommitFact` 与 `DataCommitSource`。当前 Engine 在 SQLite commit 成功后生成 Commit Fact，其中包含：

- 通用 `changesetId / createdAt / committedAt / actor / correlation`；
- 不含正文的 `store / kind / entityId / entityType / version` operations；
- 兼容 Document API 使用的 Changeset 与 Document summary。

Studio Server 直接把共享 SQLite Data Engine 作为 Kernel 的 Data Commit Source。测试或其他宿主组合如果使用非 Engine Document Store，可直接注入 Store；其 `subscribeCommits` 已满足同一订阅合同，不需要转发工厂。

## Application Store 的物理归属

Application Store 与 Document Store 共用 Engine，但各自拥有领域表。以下是当前持久化边界，业务执行与恢复合同由 [Application 数据生命周期](../application/data-capabilities-and-lifecycle.md)和 [Runtime 与 Session](../application/agent/runtime-and-session.md)维护，不在平台层复制 RPC 清单。

| Store / schema namespace | 当前版本 | 权威数据 |
| --- | --- | --- |
| Narrative / `application.narrative` | 9 | `narrative_timelines`、`narrative_branches`、`narrative_nodes`、`narrative_recovery_points`：Timeline 来源、分支、稳定楼号及 State / Workspace / Transcript 引用 |
| Workspace / `application.workspace` | 1 | `workspace_revisions`：Timeline 文件树的不可变版本；文本在树中保存，二进制引用 Blob |
| Agent / `application.agent` | 9 | `agent_sessions`、`agent_transcript_entries`、`agent_tool_invocations`、`agent_summary_tasks`：Session 身份、Transcript、轻量工具配对索引与摘要任务 |
| State / `application.state` | 2 | `state_scopes`、`state_revisions`：State 当前 Head 与历史修订 |
| Prompt Resource / `application.prompt-resource` | 9 | Resource Header / Node、修订、Lore Mount 与 Preset Tool Mount |

精确 namespace 与当前 schema 版本以 [Narrative Store](../../../packages/application-data/src/narrative/store.ts)、[Workspace Store](../../../packages/application-data/src/workspace/store.ts)、[Agent Store](../../../packages/application-data/src/agent/store.ts)、[State Store](../../../packages/application-data/src/state/store.ts)和 [Prompt Resource Store](../../../packages/application-data/src/prompt-resource/store.ts)的声明为准。

Narrative v9 将正文权威放在 `agent_transcript_entries`，`narrative_nodes.entry_id` 引用正文 Entry；`narrative_node_projection` 将其投影为 Node body 读取形状。Branch 与恢复点分别保存 `head_entry_id`。Agent v9 增加 Session `kind`、可空预设绑定、Narrative mode，以及 Entry 的 round / candidate 引用；Timeline 主 Session 与普通 Agent Session 的行为由 Runtime 约束。Store 不提供从其他 namespace 版本升级到这些 schema 的路径。

摘要任务的持久化不表示重启后可以继续原 Provider 请求。

Workspace 新版本、Branch Head 及 State 恢复引用由领域事务推进。历史分页沿各自 parent 链读取，不使用 SQLite offset，也不能把 Transcript 顺序等同于当前分支投影。完整恢复点与稳定楼号合同见[数据生命周期](../application/data-capabilities-and-lifecycle.md#timeline-workspace-与稳定楼号)。

### Prompt Resource 与 Mount

Prompt Resource 不使用 `airp.promptResource` Document 作为权威存储。`PromptResourceStore` 拥有：

- `prompt_resources`：Resource Header、版本、metadata 和 tombstone；
- `prompt_resource_nodes`：当前 Resource Node；
- `prompt_resource_node_revisions` / `prompt_resource_header_revisions`：受影响 Node 与 Header 的 before/after Revision；
- `global_lore_mounts`：名称沿用，保存 `manual/global` 与 `preset/<id>` 消费关系；
- `preset_tool_mounts`：Preset 到 Tool Definition 的挂载、默认开关、Activation 与 Provider / Content 投影策略。

`PromptResourceContent`、嵌套 `rootNode.children[]` 与 `loom.promptResource` 是 RPC、PromptBuild 和导入导出使用的投影/外部格式。Lore Mount 与 Preset Tool Mount 分别读取、替换，不嵌入 Resource 响应，也不复制引用资源。

Lore Mount 的 `resolvedLoreResourceId: null` 表示引用暂不可解析，不等于删除。替换列表二选一：资源 ID 列表，或可保留原 Mount ID 的 Mount 列表；Mount ID 必须属于指定来源。资源可消费性与包内引用映射由 Runtime 处理。

资源编辑携带读取时的 `expectedVersion`，Store 在写入事务内检查。失败草稿和重新应用策略属于 [Application UI](../application/ui/README.md)，不是 Store 自动合并。包图标等展示 metadata 仍随 Header 存储，不改变资源身份、归属或消费配置。

其他小型低频配置与资源采用既有 Document 类型，例如 Card Source、Provider 配置、Import Bundle、Loom Script 和 Script Mount。旧 `airp.agentPreset` / `airp.agentProfile` 不再是 Agent Preset 权威，Preset CRUD 操作 PromptResourceStore。Script 的源码字节与 Document/Mount 分工见 [Script Runtime](../extensions/loom-script-runtime.md)。

一次 Engine transaction 只保证其参与的持久化修改；Provider 请求、工具外部副作用与后续提交不能因此描述为整个 Run 的原子事务。具体失败与重试边界以 Runtime 合同为准。
