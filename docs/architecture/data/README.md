# Data Architecture

本分类用于收录 Loom Studio 已实现并稳定的数据基础语义，包括 Document、Revision、Changeset、持久化、Workspace 同步边界以及 Trace/Audit 数据。

放置规则：

- 与业务无关的持久化原语放在这里；
- Card、Session、Setting Layer 等业务 Document schema 放在 [`../application/`](../application/)；
- Extension 私有 schema 由对应 Extension 负责；
- Kernel 如何通过 RPC 暴露数据能力记录在 [`../kernel/`](../kernel/)；
- UI Undo/Redo history 不等同于 Document Store 的持久化历史。

当前数据层设计过程位于 [`../../workbench/discussion/data/`](../../workbench/discussion/data/)。具体专题在与当前实现逐项核对后再晋升，本目录暂不复制 Draft 文档。

本地路径、Blob、Source Artifact 与 Media Asset 的已实现边界见 [`local-storage-and-assets.md`](local-storage-and-assets.md)。

## 当前 SQLite Data Engine 基线

Studio Server 当前创建一个 `@loom-studio/data-engine` SQLite Engine，并把同一 Engine 注入 Document Store。Engine 负责：

- 单 SQLite connection 的生命周期；
- 公开读写的 FIFO 串行化；
- `BEGIN IMMEDIATE` transaction 与失败回滚；
- namespaced schema migration；
- 一次 transaction 对应一个 Changeset / Data Commit Fact；
- commit 成功后的进程内通知。

迁移版本记录在 `schema_migrations(namespace, version)`，不再使用单一 `PRAGMA user_version`。当前已注册：

- `platform.data-engine@1`：`schema_migrations` 与通用 `changesets` Commit Journal；
- `platform.documents@1`：`documents`、`document_revisions` 及其索引。
- `platform.blob-store@1`：`stored_blobs` 与 SHA-256 唯一索引；
- `platform.asset-store@1`：`source_artifacts`、`media_assets` 及 Blob / owner 索引。

每个 migration namespace 独立按连续版本升级。迁移失败会回滚该 namespace 的本次升级；数据库中某 namespace 的版本高于当前程序支持版本时会拒绝打开。Engine 使用 WAL 与 foreign key，不依赖 ORM、通用 Repository 或外部 migration framework。

`migrate()` 只用于组合根创建 Store 的启动阶段；运行时读写统一进入 Engine FIFO。transaction callback 直接使用当前 transaction 暴露的 SQLite connection，不能重新进入排队中的 Engine 方法。

## 当前 Document Store 持久化基线

Document Store 只拥有 Document 领域表与行为：

- `documents`：当前版本的完整 typed JSON Document；
- `document_revisions`：按 Document ID 与 version 保存历史 Revision；
- Document create、update、delete、restore、optimistic concurrency 与 Document-only revert。

Document Store 不再自行打开第二条 SQLite connection，也不再写第二份 Changeset。它把 Document operation 交给 Engine transaction collector，由共享 `changesets` 表记录提交事实。使用 `{ filename }` 创建仍是兼容便利入口；Studio Server 使用 `{ engine }` 共享平台 Engine，外部 Engine 的关闭责任仍属于组合根。

## 当前 Data Commit Contract

平台已经定义领域无关的 `DataCommitFact` 与 `DataCommitSource`。当前 Engine 在 SQLite commit 成功后生成 Commit Fact，其中包含：

- 通用 `changesetId / createdAt / committedAt / actor / correlation`；
- 不含正文的 `store / kind / entityId / entityType / version` operations；
- 兼容 Document API 使用的 Changeset 与 Document summary。

Studio Server 直接把共享 SQLite Data Engine 作为 Kernel 的 Data Commit Source。测试或外部调用如果注入非 Engine Document Store，仍可使用 `createDocumentDataCommitSource()` 兼容适配。

当前 Document Store 与 Narrative Store 已接入共享 Engine。Narrative Store 使用 `application.narrative@1` migration namespace，拥有：

- `narrative_timelines`：Timeline 根、来源 Card、资源链接、active branch 与 tombstone；
- `narrative_branches`：Branch head、父 Branch 与 fork 来源；
- `narrative_nodes`：不可变的 `loom-markdown.v1` 正文、parent 关系与可选 provenance。

Narrative append 在一个 Engine transaction 中同时插入 Node、更新 Branch head 与 Timeline `updated_at`；分页沿 parent 链向历史读取，不使用 SQLite offset。

Studio Server 已在组合根创建 Narrative Store，并注入 Application Runtime。当前新增独立 RPC：

- `application.createNarrativeTimelineFromCard`；
- `application.getNarrativeTimeline`；
- `application.getNarrativePage`；
- `application.forkNarrativeBranch`；
- `application.switchNarrativeBranch`；
- `application.deleteNarrativeTimeline`。

创建 Timeline 时读取 Card 当前版本，将有序 Prompt Resource ID 与经现有宏规则处理后的 Opening materialize 为 roleless Narrative Nodes。Card 后续修改不会静默更新既有 Timeline 的来源版本、标题或资源链接。

后端旧 `Session / NarrativeEntry / submitTurn` 路径已经删除，不再公开旧 Session、Transcript、Run RPC，也不保留双轨或兼容读取。Studio Client 已切换到 Narrative Timeline、Agent Profile 与按需 Agent Session 合同。

Agent Store 也已接入共享 Engine，使用 `application.agent@2` migration namespace：

- `agent_sessions`：Agent Profile identity、标题、message head/count 与 tombstone；
- `agent_messages`：不可变 Chat Completions-compatible Message、parent、sequence 与可选 runId；
- `agent_tool_calls`：ToolCall 与 ToolResult 的轻量配对索引，不保存参数或结果正文。

Message append 在同一 transaction 内分配连续 sequence、插入一条或多条 Message，并更新 Session head/count。写入通过 `expectedMessageCount` 防止并发覆盖；分页沿 parent 链读取，不使用 offset。assistant tool call 与 tool result 可以跨批提交，但重复 call ID、未知 result 或重复 result 都会被拒绝。

Studio Server 已注入 Agent Store。当前公开生命周期 RPC 包括：

- `application.createAgentSession`；
- `application.getAgentSession`；
- `application.getAgentMessagePage`；
- `application.deleteAgentSession`。

`appendAgentMessages` 当前只作为 Application Runtime 内部能力，不公开给普通 Client，避免绕过 Agent Runtime 伪造 assistant/tool 历史。`agentProfileId` 必须绑定真实 Agent Profile Document；Profile 再确定 Preset Prompt Resource 与 Provider Model，调用时不接受第二套临时绑定。

Prompt Resource 不再使用 `airp.promptResource` Document 作为权威存储。它由 Application-owned `PromptResourceStore` 管理，并与同一个 SQLite Data Engine 共享 transaction / Changeset：

- `prompt_resources`：Resource Header、版本和 tombstone；
- `prompt_resource_nodes`：Resource Node 当前状态；
- `prompt_resource_node_revisions`：受影响 Node 的 before/after Revision；
- `prompt_resource_header_revisions`：Header before/after Revision；
- `global_setting_mounts`：manual 与 Preset 来源的 Setting Mount Registry。

`PromptResourceContent`、嵌套 `rootNode.children[]` 和 `loom.promptResource` 是当前 RPC、PromptBuild 与 Card Bundle 使用的兼容投影/外部格式，不是 SQL 权威模型。Setting Mount 通过独立的 `application.listSettingMounts` / `application.replaceSettingMounts` API 读取和修改，不再嵌入 Prompt Resource 响应。

其他小型、低频配置继续使用 Document Store：

- `airp.cardSource`：Card Source / Manifest；
- `airp.agentProfile`：本机 Profile 名称、直接指向 Preset Resource 的 `presetId` 与 `{ providerProfileId, modelId }`；
- `airp.providerProfile`、`airp.importBundle`：Provider 配置与 Card Bundle 导入来源。

旧 `airp.agentPreset` 权威类型、对应 RPC 与启动迁移均已删除；开发数据不再保留这条兼容路径。

`createAgentSession` 必须引用真实 Agent Profile。`previewAgentTurn` 与 `invokeAgentTurn` 共用同一 Prompt 构建入口；后者从 Agent Session、Profile 选择的唯一 Preset、Preset 关联 Setting、可选 Narrative Timeline Setting 及 Provider Model 构造 canonical Chat Message，并在 Provider 成功后持久化本轮 Message。Provider 失败不会留下半轮。Settings 工作台的当前选中项只是编辑状态，不参与运行时绑定。

当 `narrativeTarget.commit = true` 时，两条 Agent Message 与一条 Narrative Node 在同一 Data Engine transaction / Changeset 中提交；未指定目标或 `commit = false` 时只写 Agent Session。Narrative provenance 可以记录 Agent Session、Agent Message、runId 与 changesetId，但 Timeline 和 Agent Session 仍然互不拥有。

Provider Message 已支持 canonical assistant tool calls 与 tool result 关联。当前 M0 仅投影最近 100 条 Agent Message / Narrative Node；这是明确容量上限，后续由上下文窗口与摘要策略替换，不在本阶段引入通用 Run Document、JSONL 活跃存储或额外 Repository 抽象。
