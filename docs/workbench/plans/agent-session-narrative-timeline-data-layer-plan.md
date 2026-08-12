# Agent Session / Narrative Timeline 数据层实施计划

> **状态**：Backend Complete / Client Migration Pending
> **日期**：2026-08-12
> **范围**：重建 AIRP 的会话数据层，将旧 `Session` 拆分为 Narrative Timeline 与 Agent Session，并迁移 Document、Application Runtime、RPC 和 Client 的权威数据链。
> **事实边界**：后端 Store、Application Runtime、Provider 调用和 Server RPC 已完成单轨切换；旧 Session / Transcript / Run 后端链已删除。Studio Client 迁移明确留给独立前端分支。
> **数据兼容**：当前数据库主要是开发测试数据。本计划不保留旧 Session Schema 的兼容读取、双写或自动迁移；实施阶段可以清理旧 AIRP 会话数据后重新初始化。

相关文档：

- [`agent-session-chat-message-foundation-plan.md`](agent-session-chat-message-foundation-plan.md)
- [`../discussion/application/narrative-timeline-content-schema-v0.md`](../discussion/application/narrative-timeline-content-schema-v0.md)
- [`../discussion/application/session-timeline-data-model-v0.md`](../discussion/application/session-timeline-data-model-v0.md)
- [`card-resource-manifest-migration-plan.md`](card-resource-manifest-migration-plan.md)
- [`document-store-kernel-data-foundation-plan.md`](document-store-kernel-data-foundation-plan.md)
- [`sqlite-data-engine-domain-stores-kernel-plan.md`](sqlite-data-engine-domain-stores-kernel-plan.md)
- [`search-and-timeline-indexing-plan.md`](search-and-timeline-indexing-plan.md)

---

## 0. 本轮收束决定

旧 `Session` 同时承担了游玩实例、资源链接、Narrative 容器、Agent Binding 和 Transcript 镜像。目标实现将其拆成两个相互独立的聚合：

```text
Narrative Timeline:
  剧情世界线的权威对象。
  拥有资源链接、Narrative Branch、Narrative Node 和未来的世界状态。

Agent Session:
  Agent 工作对话的权威对象。
  拥有 Chat Completion-compatible Message 历史。
```

二者不互相拥有，也不结构性嵌套。一次 AIRP 调用通过显式 invocation target 同时指定需要使用的 Agent Session 与 Narrative Timeline：

```text
invoke AIRP Agent
  agentSessionId
  timelineId
  branchId?
  userInput
```

已确定的基础规则：

1. Narrative Timeline 不是 Chat，不保存 `user | assistant` role；
2. Agent Session 使用 Chat Completions-compatible Message 心智模型；
3. `Step` 只是 Runtime 内存状态机状态，不创建 Step Document；
4. `runId` 首版只作为 Message、Log、Trace 和 Changeset 的关联标识，不新增通用 Agent Run 权威对象；
5. Provider 普通输出不因为是 assistant message 就自动成为 Narrative；Narrative 只能由明确的领域提交写入；
6. Narrative Node 与 Agent Message 都是独立持久化记录，不把整条历史内联进根对象；
7. SQLite Data Engine 继续作为活跃结构化数据的权威事实源，但 Narrative / Agent 不再强行使用 Document Revision 模型；
8. Timeline / Branch / Node 使用 Narrative Store，Agent Session / Message 使用 Agent Store；
9. Node 与 Message 创建后不可变，不写入 `documents` 或 `document_revisions`；
10. 所有 Store 共用同一 SQLite transaction 与 Commit Journal；
11. JSONL 只作为日志、导出或未来冷归档格式，不作为活跃会话的第二事实源；
12. 不引入 ORM、Repository 基类、通用 Query DSL、Event Sourcing 或外部运行时依赖；
13. 迁移完成后删除旧 Session、镜像 Transcript 和固定 M0 Run 路径，不维持双轨。

---

## 1. 施工前实现基线（历史）

### 1.1 当前 Document Types

`packages/application-runtime/src/document-types.ts` 当前包含：

```text
airp.session
airp.narrativeBranch
airp.narrativeEntry
airp.runtimeEntry
airp.run
airp.commitCandidate
airp.branchStateSnapshot
airp.agentTranscriptEntry
```

其中 `airp.session` 是多个领域的聚合点；`airp.agentTranscriptEntry` 只是 Narrative Entry 的镜像，不是独立 Agent 会话事实。

### 1.2 当前 Session 创建

`createSessionFromCard` 当前执行：

```text
read Card
  -> cardToSnapshot
  -> copy promptResourceIds
  -> create Session
  -> materialize Opening as user / assistant Narrative Entries
  -> mirror every Narrative Entry into Agent Transcript
  -> create Primary Narrative Branch
```

当前 `SessionContent` 保存：

```text
cardSourceVersionId
cardSnapshot
agentRuntimeProfileId?
promptResourceIds?
title?
activeBranchId
createdAt / updatedAt
```

### 1.3 当前 Turn 提交

`submitTurn` 当前把一次用户输入固定为一次生成与自动接受流程，并在同一 Document transaction 中写入：

```text
Run
user Narrative Entry
user Agent Transcript mirror
prompt Runtime Entry
provider result Runtime Entry
Commit Candidate
assistant Narrative Entry
assistant Agent Transcript mirror
Branch State Snapshot
updated Narrative Branch
completed Run
```

这条链证明了 Document Store transaction 能承载跨多个 Document 的原子提交，但其业务语义仍是旧 M0。

### 1.4 当前读取与性能边界

- `getTimeline` 返回当前 Branch 的完整路径；
- `readBranchPath` 当前先读取全部 `airp.narrativeEntry`，再在内存中构造路径；
- `getAgentTranscript` 读取全部镜像 Transcript，再按 Narrative path 组装；
- 当前 Client 一次性持有完整 Timeline 与 Transcript；
- 当前没有 Timeline 分页、Message 分页、Narrative FTS 或 Agent Message 索引。

该实现适合当前测试规模，不适合数千 Node、数百万字或几十 MB 的长期世界线。

### 1.5 当前 SQLite 边界

SQLite schema version 1 使用三张权威表：

```text
documents
document_revisions
changesets
```

每个 Document 当前版本保存在 `documents.content_json`，每次版本写入同时保存完整 Revision。该机制继续服务 Card、Prompt Resource、Preset 等真正需要版本历史的可编辑聚合；Timeline / Agent 目标实现不再通过缩小 Document 粒度规避写放大，而是使用专用 Domain Store。

### 1.6 当前 Client 依赖

Studio Client 当前仍使用：

```text
Session
Branch
NarrativeEntry
AgentTranscriptEntry
SubmitTurnResult.entries.user / assistant
application.createSessionFromCard
application.getSession
application.getTimeline
application.getAgentTranscript
application.forkBranch
```

Composer draft key、当前 Branch 选择、PromptBuild Inspector 和 Turn 后刷新流程都依赖旧 `sessionId` 语义。客户端迁移必须在后端新合同稳定后进行，不能先改 UI 名称再等待后端补齐。

---

## 2. 目标领域模型

### 2.1 Narrative Timeline

Narrative Timeline 是一次剧情世界线的根对象，也是运行时剧情资源的链接点。

```ts
type NarrativeTimelineContent = {
  title?: string
  createdFrom?: {
    cardId: string
    cardVersion: number
  }
  promptResourceIds: string[]
  activeBranchId: string
  createdAt: string
  updatedAt: string
}
```

字段规则：

- `createdFrom` 是来源记录，不表示 Card 拥有 Timeline；
- `promptResourceIds` 保存 Timeline 创建时解析出的有序运行资源链接；
- Card 后续增删资源链接，不静默改变已有 Timeline；
- 当前继续共享 Prompt Resource 内容，不创建 Timeline Resource 副本、Diff Overlay 或 CoW；
- `cardSnapshot` 不进入目标 Schema；
- Title、Opening 初始化结果和资源链接足以承载当前 Session Snapshot 的有效职责；
- Card bundle inventory、Timeline launch resources 与 recommended Preset 的进一步拆分属于 Card Manifest 后续议题，不在本计划中引入通用 Resource Binding Graph。

首版迁移保持当前最小等价语义：

```text
Card.promptResourceIds
  -> NarrativeTimeline.promptResourceIds
```

### 2.2 Narrative Branch

```ts
type NarrativeBranchContent = {
  timelineId: string
  title?: string
  headNodeId?: string
  parentBranchId?: string
  forkedFromNodeId?: string
  createdAt: string
  updatedAt: string
}
```

规则：

- Branch 只保存当前 head 与 fork 来源；
- Branch 不复制祖先 Node；
- Fork 后多个 Branch 可以共享同一祖先路径；
- 切换 Branch 只更新 `NarrativeTimeline.activeBranchId`；
- Branch 不保存 Agent Session head、Agent Message 或 Provider 状态。

### 2.3 Narrative Node

```ts
type NarrativeNodeContent = {
  timelineId: string
  parentNodeId?: string
  body: {
    format: 'loom-markdown.v1'
    raw: string
  }
  source?: {
    agentSessionId?: string
    agentMessageId?: string
    runId?: string
    changesetId?: string
  }
  createdAt: string
}
```

规则：

- Node 没有 `user | assistant` role；
- `body.raw` 是唯一 canonical 正文；
- Semantic Projection、Markdown AST、HTML 和 Renderer 输出不进入 Node；
- `source` 只保存 provenance 引用，不复制 Agent Message；
- Node 追加与 Branch head 更新必须处于同一 Document transaction；
- 首版不建立 Chapter、Scene、Floor 或 Message Variant 等额外层级。

### 2.4 Opening

旧 `OpeningChatEntryContent.role` 与去 Chat 化 Narrative 不兼容。目标 Card Opening 应提供可物化的 Narrative body template：

```ts
type NarrativeOpeningContent = {
  nodes: Array<{
    body: {
      format: 'loom-markdown.v1'
      raw: string
    }
  }>
}
```

Timeline 创建流程：

```text
read Card Opening templates
  -> materialize Narrative Nodes in order
  -> create Primary Branch
  -> set headNodeId to final Opening Node
```

ST 或旧 Card 的 `user / assistant` Opening 兼容转换属于 Importer；目标 Narrative Schema 不保留 role。

### 2.5 Chat Message Contract

```ts
type ChatToolCall = {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

type ChatMessage =
  | { role: 'system' | 'developer' | 'user'; content: string }
  | { role: 'assistant'; content?: string; tool_calls?: ChatToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }
```

规则：

- 不依赖某个 OpenAI SDK 的具体类型版本；
- 不采用 Responses `Item[]`、`previous_response_id` 或 reasoning item；
- PromptBuild 动态生成的 system / developer message 默认只属于本次 Provider Payload 和 Trace，不重复归档到 Agent Session；
- Agent Session 默认持久化实际发生的 user / assistant / tool 对话；
- assistant message 必须至少存在非空 `content` 或非空 `tool_calls`；
- tool message 的 `tool_call_id` 必须能够关联同一 Agent Session 中已完成的 assistant tool call；
- 多模态 content parts 在真实需求出现后再扩展。

### 2.6 Agent Session

Agent Session 逻辑上拥有 Message 历史，物理上不把全部 Message 内联进一个不断增长的 JSON Document。

```ts
type AgentSessionContent = {
  agentPresetId: string
  title?: string
  headMessageId?: string
  messageCount: number
  createdAt: string
  updatedAt: string
}
```

规则：

- `agentPresetId` 表达 Agent 身份，不保存本机 Provider、Model、Secret 或 Timeline；
- 正式实施 Agent Session 前必须先确认最小 Agent Preset identity；
- 不允许用旧 `AgentRuntimeProfile` 冒充最终 Agent Preset；
- Model / Provider / Permission 属于 Local Binding 或 invocation input；
- `headMessageId` 只指向本 Session 的最后一条 Message；
- Agent Session 首版是线性历史，不建立 Agent Session Branch；
- 删除 Agent Session 不删除 Narrative Node；Narrative provenance 可以变成不可解析的可选引用。

### 2.7 Agent Message

```ts
type AgentMessageContent = {
  agentSessionId: string
  parentMessageId?: string
  sequence: number
  runId?: string
  message: ChatMessage
  createdAt: string
}
```

规则：

- Message 是 Agent Session 拥有的子记录，不是可以脱离 Session 自由创建的顶层业务资源；
- `parentMessageId` 支持从 head 向前读取，不要求扫描全部 Message；
- `sequence` 由服务端在 transaction 内分配，禁止调用方自行选择；
- 同一 Agent Session 内 `sequence` 严格递增；
- Message 完成后保持不可变，流式 buffer 不作为 canonical Message 持久化；
- 首版不提供任意 Message update；历史编辑、重试和分支等需求出现后另行设计；
- 超大 ToolResult / Provider raw payload 可以进入未来 Asset / Payload Store，Message 只保存受控引用与摘要，普通文本仍存 SQLite。

### 2.8 Run 与 Step

首版不新增 `AgentStepContent` 或正式 `AgentRunContent`：

```text
Step:
  Runtime 内存状态。

runId:
  一次执行的关联 ID。
  可写入 Message、Log、Trace、Changeset 和 Narrative source。
```

只有 Suspend / Resume、持久运行状态、成本面板或失败恢复成为真实需求时，才新增 Agent Run 摘要对象。

---

## 3. 物理持久化设计

### 3.1 使用专用 Domain Stores

首版新增五张 Application-owned 权威业务表：

```text
narrative_timelines
narrative_branches
narrative_nodes
agent_sessions
agent_messages
```

这些表与 Document Store 共用同一个 SQLite Data Engine、transaction 和 Commit Journal，但不进入：

```text
documents
document_revisions
docs.list
docs.revertChangeset
Extension generic Document capability
```

原因不是 JSON 本身不可接受，而是访问模式不同：

- Node / Message 是高数量、append-only、创建后不可变的记录；
- Branch / Agent Session 的 head 会高频更新，但没有为每次 head 变化保存完整 Revision 的产品价值；
- Timeline、parent、sequence 和 run 等关系需要稳定 SQL 索引；
- Narrative / Agent 回退使用领域命令，不依赖通用 Document Revision 恢复。

复杂 payload 仍可保存为受控 JSON/Text：

```text
Narrative source -> source_json
Agent Chat Message -> message_json
Timeline prompt resource order -> prompt_resource_ids_json
```

只把身份、关系、分页、并发和生命周期字段提升为 SQL 列，不把所有 JSON KV 映射成 EAV。

### 3.2 Transaction 边界

创建 Timeline：

```text
create Narrative Timeline
create Opening Narrative Nodes
create Primary Narrative Branch
update Timeline activeBranchId
  -> one Data Engine transaction / one Changeset
```

追加 Narrative Node：

```text
validate Timeline / Branch / expected head
create Narrative Node
update Branch headNodeId
  -> one Data Engine transaction / one Changeset
```

追加 Agent Message：

```text
validate Agent Session expected version
validate parentMessageId == current headMessageId
allocate sequence
create Agent Message
update Agent Session headMessageId / messageCount
  -> one Data Engine transaction / one Changeset
```

一个 Provider / Tool 循环可以分多次提交 Message。已经成功持久化的 Message 不因后续 Provider 失败而被伪装成不存在。

一次 AIRP Turn 如果同时追加 Agent Message 与 Narrative Node，允许在同一 Data Engine transaction 内跨 Agent Store 与 Narrative Store 原子提交。Store 只记录 operation summary；Data Engine 在 SQLite commit 后统一产生一个 `DataCommitFact`。

### 3.3 首版分页路径

首版使用专用索引和 parent/head 链实现向历史方向分页：

```text
Timeline page:
  Branch.headNodeId
    -> Node.parentNodeId
    -> previous Node

Agent Message page:
  AgentSession.headMessageId
    -> Message.parentMessageId
    -> previous Message
```

首次只加载最新 50–100 条。首版不实现 arbitrary window、跨 Timeline 搜索或全文索引。

首版必须具备的索引至少包括：

```text
narrative_branches(timeline_id)
narrative_nodes(timeline_id, parent_node_id)
narrative_nodes(timeline_id, created_at)
agent_messages(agent_session_id, sequence)
agent_messages(agent_session_id, run_id)
```

cursor 不使用 SQLite offset。Narrative 可以使用下一条 `nodeId`；Agent Message 可以使用 `(sequence, messageId)` 或下一条 `messageId`，具体由 Store contract 固定。

### 3.4 FTS 与派生投影后置

以下能力仍然测量后实施：

- 从 parent 反查全部 child；
- 跨 Timeline 搜索正文；
- around-node 任意窗口；
- Branch Path 物化投影；
- 跨 Agent Session 检索 Message。

Narrative FTS 必须是可重建派生数据，不成为第二份正文事实。Semantic Projection Cache 同样不进入 Changeset。

### 3.5 JSONL 边界

JSONL 可以用于：

- Narrative Timeline 导出；
- Agent Session 导出；
- 用户可读备份；
- 未来已关闭会话的冷归档；
- 系统运行日志。

JSONL 不用于首版活跃会话 canonical persistence，避免建立 SQL index 与文件正文之间的双写恢复协议。活跃数据的 canonical source 是 Narrative / Agent SQL tables，不是 Document JSON，也不是文件。

### 3.6 删除与 GC

删除 Timeline 的产品语义是删除 Timeline 及其 Branch / Node 可见性，但首版不要求在一个巨大 transaction 中逐条物理删除几十万 Node：

- 先在 `narrative_timelines` tombstone Timeline 根对象；
- Application 查询拒绝读取已删除 Timeline 的子内容；
- Branch / Node 后台 GC、保留期和物理清理由后续数据健康计划处理；
- 删除 Timeline 不删除 Card、Prompt Resource 或 Agent Session；
- 删除 Agent Session 只 tombstone `agent_sessions`，不删除 Timeline 或 Narrative provenance；
- UI 可以提供组合删除操作，但底层仍是两个显式领域命令。

---

## 4. 目标数据操作与 API

### 4.1 Narrative Timeline 领域操作

首版需要：

```text
createTimelineFromCard
getNarrativeTimeline
getNarrativePage
forkNarrativeBranch
switchNarrativeBranch
appendNarrativeNode
deleteNarrativeTimeline
```

边界：

- `appendNarrativeNode` 是领域写入能力，不是 Provider Adapter API；
- 外部 Client / Extension 是否能直接调用该写入，应继续服从 Capability 和权限层；
- 读取 page 返回按显示顺序排列的 Node，并返回继续向历史加载的 cursor；
- cursor 首版可以使用下一条待读取的 `nodeId`，不暴露 SQLite offset；
- Fork 输入必须指定 `fromNodeId`，服务端校验其属于目标 Timeline；
- `switchNarrativeBranch` 只更新 active branch，不修改 Agent Session。

候选 RPC：

```text
application.createTimelineFromCard
application.getNarrativeTimeline
application.getNarrativePage
application.forkNarrativeBranch
application.switchNarrativeBranch
application.deleteNarrativeTimeline
```

是否公开 `application.appendNarrativeNode` 应在 Tool / Capability 权限合同实施时确认；第一方 Runtime 可以先调用内部领域操作。

### 4.2 Agent Session 领域操作

首版需要：

```text
createAgentSession
getAgentSession
getAgentMessagePage
appendAgentMessages
deleteAgentSession
```

边界：

- `appendAgentMessages` 支持一次 transaction 追加一条或一组已经完成的连续 Message；
- ToolCall 与 ToolResult 可以在同一批或不同批提交，但必须校验调用关联；
- 不开放任意 update Message；
- cursor 首版使用下一条待读取的 `messageId`；
- Agent Session 创建不要求 Timeline；
- 同一个 Agent Session 可以在不同 invocation 中面向 Timeline、Card、Prompt Resource 或其他授权目标。

候选 RPC：

```text
application.createAgentSession
application.getAgentSession
application.getAgentMessagePage
application.deleteAgentSession
```

`appendAgentMessages` 默认是 Runtime 内部能力，不应让普通 Client 绕过 Agent Runtime 任意伪造 assistant / tool 历史。未来 Extension Host 可以通过受控 Capability 暴露。

### 4.3 AIRP Turn 输入

目标 `submitTurn` 不再以旧 `sessionId` 同时推断所有对象：

```ts
type SubmitTurnInput = {
  agentSessionId: string
  timelineId?: string
  branchId?: string
  input: string
  modelProfileId?: string
  projectionOrderProfile?: ProjectionOrderProfile
  activationFacts?: ActivationFacts
}
```

首版 AIRP 默认流程可以明确执行 Narrative commit，但必须由 AIRP Runtime 的领域步骤调用 `appendNarrativeNode`，不能由 Gateway 或“assistant response 已完成”这一事实自动写入。

候选结果：

```ts
type SubmitTurnResult = {
  runId: string
  agentSession: Versioned<AgentSessionContent>
  appendedMessages: Array<Versioned<AgentMessageContent>>
  narrativeCommit?: {
    timeline: Versioned<NarrativeTimelineContent>
    branch: Versioned<NarrativeBranchContent>
    node: Versioned<NarrativeNodeContent>
    changesetId: string
  }
}
```

用户输入只进入 Agent Message。只有 `narrativeCommit` 中的 Node 成为剧情正文。

---

## 5. 分阶段实施

### Phase 0：文档与决策门槛

目标：消除已经会直接误导施工的旧设计冲突。

任务：

1. 将 `session-timeline-data-model-v0.md` 中持久化 Agent Step Tree 的描述改为 Agent Session + Agent Message；
2. 更新 `agent-model-v0.md`、`agent-runtime-loop-v0.md`、`airp-runtime-model-v0.md` 和 Application README 中的旧 Step Document 摘要；
3. 明确最小 Agent Preset identity 以及 `AgentSession.agentPresetId` 的来源；
4. 明确 Card Opening 从 role-based entry 到 Narrative body template 的目标形态；
5. 明确首版继续采用 `Card.promptResourceIds -> Timeline.promptResourceIds`，不在本阶段扩展 Card Manifest relation graph；
6. 将本计划与 `agent-session-chat-message-foundation-plan.md` 的阶段关系写清楚，避免两份计划重复定义相反 Schema；
7. 完成 `sqlite-data-engine-domain-stores-kernel-plan.md` 的 Data Engine、Commit Fact 与 Kernel commit source 基座，Narrative / Agent Store 不再自行创建第二条事务或事件管线。

验证检查点：相关 Workbench 文档不再把 Step 描述为持久化会话节点，不再把 Narrative 当 Chat，也不再把旧 Session 当目标对象。

### Phase 1：Chat Message / Provider 协议基座

状态：**Complete（2026-08-12；canonical contract、OpenAI-compatible payload 与 Gateway response 已升级）**。

目标：先让 Provider Gateway 能完整往返 canonical assistant message，避免 Agent Session 落地后仍只能保存纯文本。

任务：

1. 扩充 `ProviderMessage` / `ChatMessage` discriminated union；
2. 支持 assistant `tool_calls`；
3. 支持 tool `tool_call_id`；
4. Gateway 返回 canonical assistant message，不先压成 `text`；
5. OpenAI-compatible payload adapter 校验各 role 字段；
6. Client Prompt Inspector 继续使用现有纯文本兼容投影；Agent Session UI 与 Client canonical message 展示留到 Client 迁移阶段。

验证检查点：普通文本、assistant tool call、tool result 三条路径均能通过 Gateway 与 payload 定向测试。

当前兼容边界：`GatewayChatResult.message` 是 canonical assistant message；`GatewayChatResult.text` 与旧 `ApplicationProvider.content` 暂时保留。后端 Turn 已迁移，Tool Runtime 尚未实现。

### Phase 2：Narrative / Agent Store Schema 与纯领域操作

状态：**Complete（2026-08-12：Narrative Store 与 Agent Store foundation complete）**。

目标：建立专用关系表与 Store contract，不迁移旧 Turn Flow。

任务：

1. 新增 Narrative Store migration：`narrative_timelines / narrative_branches / narrative_nodes`；
2. 新增 Agent Store migration：`agent_sessions / agent_messages`；
3. 建立 Timeline、parent、Agent Session、sequence、run 的基础索引和约束；
4. 为目标 Schema 增加运行时输入校验；
5. 实现依赖共享 `DataTransaction` 的内部创建、读取、append、fork 操作；
6. Store 写入只向 transaction collector 记录 operation summary，不自行发布事件；
7. 保持每个业务 transaction 只产生一个 Changeset / Data Commit Fact；
8. 验证 Node / Message 不写入 `documents` 或 `document_revisions`；
9. 新链验证完成前暂不删除旧 Document Types；后端单轨收尾时统一删除。

验证检查点：SQLite `:memory:` Data Engine 中 append 与 head update 任一失败时整体回滚；一次成功 append 只生成一条 record、一次 root/head update 和一个 Changeset。

### Phase 3：Narrative Timeline 生命周期

状态：**Complete（2026-08-12；Application Runtime + Server RPC + Agent Turn projection complete）**。

目标：让 Card 能创建新的 Timeline，并以新 Node Tree 完成读取和 Fork。

任务：

1. 实现 `createTimelineFromCard`；
2. 复制当前 Card Prompt Resource IDs；
3. 将 Opening materialize 为 roleless Narrative Nodes；
4. 创建 Primary Branch 与 active branch；
5. 实现 `getNarrativeTimeline`；
6. 实现最近窗口与向历史方向的 `getNarrativePage`；
7. 实现 Fork 与 Branch 切换；
8. 实现 Timeline 根 tombstone；
9. PromptBuild 增加从 Timeline 读取 Narrative path 和 Resource IDs 的内部入口，但此阶段不切换现有 `submitTurn`。

验证检查点：Opening、追加、Fork、Branch 切换和 Server 重启持久化均只使用 Narrative Store；读取最近页使用专用索引，不扫描完整 Timeline 或 `documents.content_json`。

### Phase 4：Agent Session 生命周期

状态：**Complete（2026-08-12；Store + Preset/Local Binding + Application Runtime + Server RPC complete）**。

目标：建立独立于 Timeline 的 Agent 会话与 Message 历史。

任务：

1. 实现 Agent Session create / get / delete；
2. 实现单条和批量 append Message；
3. 服务端分配 `sequence` 并更新 head；
4. 实现向历史方向的 Message page；
5. 校验 assistant tool call 与 tool result 关联；
6. Provider raw response 继续只进入受控 Trace，不进入 Message；
7. PromptBuild 增加从 Agent Session 选择必要 Message 的输入投影；
8. 不建立 Agent Session Branch、Message update 或 Transcript compression。

验证检查点：Agent Session 可以不绑定 Timeline 独立运行；同一 Session 可以在两次调用中使用不同 target；重启后 Message head 与顺序保持一致；Message 不产生 Document Revision。

### Phase 5：AIRP Turn Flow 迁移

状态：**Backend Complete（2026-08-12；`previewAgentTurn` / `invokeAgentTurn` 已成为唯一后端 Turn 路径）**。

目标：让实际玩家输入走新 Agent Session，并通过明确 commit 写入 Narrative。

任务：

1. 修改 `submitTurn` 输入为 `agentSessionId + optional timeline target`；
2. 用户输入通过 Agent Store 写入 `agent_messages`；
3. PromptBuild 从 Agent Session、Timeline、Resource 和 Local Binding 重新构造 payload；
4. Provider assistant message 通过 Agent Store 写入 Agent Session；
5. 默认 AIRP Runtime 在需要时显式调用 Narrative append；
6. Narrative Node 通过 Narrative Store 提交，source 关联 Agent Message、runId 和 Changeset；
7. Provider / Tool 失败不产生虚假的 Narrative Node；
8. Narrative commit 成功后，后续 Run 失败不自动删除已提交 Node；
9. 将 PromptBuild Trace 从旧 Run / Runtime Entry 路径迁到独立可观测性入口或当前受控 Trace。

验证检查点：一次 Turn 至少能区分“Agent 对话成功但没有 Narrative commit”和“Agent 对话成功并提交 Narrative”两种结果；跨 Agent/Narrative 写入需要原子性时只产生一个 Data Commit Fact。

最终后端边界：

- `invokeAgentTurn` 使用 Agent Session 历史、可选 Narrative 最近窗口及 Timeline Prompt Resource 链构造 canonical request；
- Agent Session 必须引用真实 `airp.agentPreset`；本机模型通过可选 `airp.agentLocalBinding` 解析；
- Provider 成功后，本轮 user / assistant Message 才会持久化；Provider 失败不留下半轮 Message；
- `narrativeTarget.commit = true` 时，Agent Message 与 Narrative Node 使用同一个 Data Engine transaction 和 Changeset；
- `narrativeTarget.commit = false` 或未提供 target 时，只记录 Agent 对话；
- 当前上下文投影只读取最近 100 条 Agent Message / Narrative Node，这是 M0 的明确限制，后续由上下文窗口与摘要策略替代；
- 旧 `submitTurn`、Run / Runtime Entry / Transcript 镜像与对应后端 RPC 已删除；Client 迁移不再阻止后端单轨成立。

### Phase 6：RPC 与 Client 迁移

状态：**Server RPC Complete / Client Pending**。

目标：Client 不再依赖旧 Session 与镜像 Transcript。

任务：

1. 增加新 RPC 方法和请求校验；
2. Client entity 改为 NarrativeTimeline / NarrativeNode / AgentSession / AgentMessage；
3. `use-session-runtime` 重命名并拆分为 Timeline 与 Agent Session 状态；
4. Composer draft key 改为明确的 Timeline branch scope；
5. Timeline UI 使用分页窗口，不再一次性读取完整历史；
6. Agent 面板直接读取 Agent Message，不读取镜像 Transcript；
7. Turn 成功结果先应用 RPC 返回的新增 Message / Node，再执行可恢复刷新，避免提交成功却因刷新失败显示为失败；
8. PromptBuild Inspector 改用新 invocation / trace 引用；
9. 完成客户端路由、空状态和删除流程迁移。

验证检查点：浏览器刷新后能够恢复当前 Timeline Branch 与 Agent Session；Timeline 与 Agent 面板不再展示同一份镜像数组。

### Phase 7：删除旧 M0 数据链

状态：**Backend Complete / Client Pending**。

目标：完成单轨切换。

删除：

```text
airp.session
airp.narrativeEntry
airp.agentTranscriptEntry
airp.runtimeEntry
airp.commitCandidate
airp.branchStateSnapshot
旧 airp.run 固定 Turn Document
SessionContent
NarrativeEntryContent
AgentTranscriptEntryContent
旧 Session / Transcript RPC
旧 Client Session / NarrativeEntry / Transcript entities
旧镜像 helper
```

任务：

1. 删除旧创建、读取、Fork 和 submit 路径；
2. 删除 fallback normalization 与只服务旧 Session Snapshot 的 helper；
3. 清理开发 SQLite 中旧 AIRP 会话数据；
4. 不编写旧数据自动迁移器；
5. 更新 Reference 与 Architecture，仅写入已经由代码和测试证明的事实；
6. 清理本次迁移产生的孤儿 import、类型和测试 fixture。

验证检查点：代码库中不再存在运行时可达的旧 Session/Transcript 双轨；新建 Card -> Timeline -> Agent Turn -> Narrative commit 完整跑通。

### Phase 8：测量后再实施高级投影、保留策略与归档

触发条件：

- 真实 Timeline 达到数千 Node；
- parent-chain page 出现可复现延迟；
- 需要 around-node window 或反向 child 查询；
- 需要 Narrative 全文搜索；
- Narrative / Agent tables 或 Commit Journal 体积成为用户可见问题；
- 关闭的 Agent Session 需要长期冷归档。

候选升级：

- 补充 covering / partial indexes；
- Narrative FTS5 派生表；
- Branch Path 可重建投影；
- Commit Journal retention；
- JSONL export / cold archive；
- 大型 ToolResult content-addressed Payload Store。

这些升级不得提前成为 Phase 2–7 的依赖。

---

## 6. 最小验证策略

### 6.1 Schema / Provider

覆盖：

- 普通 user / assistant 文本；
- assistant `tool_calls`；
- tool `tool_call_id`；
- 非法空 assistant message；
- 不匹配的 ToolResult；
- Provider failure 不产生持久化 Agent Message 或 Narrative Node。

优先测试：

```text
tests/unit/application-runtime/provider-payload.test.ts
tests/integration/application-runtime/provider-gateway.test.ts
tests/regression/application-runtime/provider-failure-rollback.test.ts
```

### 6.2 Timeline

覆盖：

- Card 创建 Timeline；
- 资源 ID 复制但 Resource 内容不复制；
- Opening materialize；
- Node append + Branch head 原子更新；
- Fork 共享祖先；
- active branch 切换；
- 最近页与历史 cursor；
- SQLite 重启恢复；
- Node 不进入 `documents` / `document_revisions`；
- Narrative-only commit 产生 `data.changed`，不产生 `docs.changed`；
- 删除 Timeline 后不可再通过 Application API 读取。

现有测试迁移入口：

```text
tests/integration/application-runtime/card-session.test.ts
tests/integration/application-runtime/turn-flow.test.ts
tests/integration/application-runtime/prompt-preview.test.ts
tests/integration/studio-server/card-session-rpc.test.ts
tests/integration/studio-server/persistence-rpc.test.ts
```

### 6.3 Agent Session

覆盖：

- create / append / page / delete；
- sequence 与 parent/head 一致；
- 批量 append 原子性；
- Timeline-independent Session；
- 同一 Session 使用不同 invocation target；
- Message 与 Narrative 不镜像；
- ToolCall / ToolResult 顺序与引用校验；
- Message 不进入 `documents` / `document_revisions`；
- `(agent_session_id, sequence)` 索引分页；
- Server 重启恢复。

### 6.4 Client

覆盖：

- 创建 Timeline 后选择 Primary Branch；
- Composer draft 按 Timeline + Branch 隔离；
- Turn 成功结果先落本地，再进行独立刷新；
- Agent Message 与 Narrative Node 分别渲染；
- 向上分页保持滚动锚点；
- 删除 / 切换 Branch 后状态不串线。

优先测试：

```text
apps/studio-client/src/features/session-runtime/model/use-session-runtime.test.ts
apps/studio-client/src/app/use-studio-state.test.ts
apps/studio-client/src/widgets/narrative-canvas/narrative-canvas.test.ts
apps/studio-client/src/shared/ui/conversation-navigator/conversation-navigator-model.test.ts
```

### 6.5 验证强度

- 单阶段实现优先运行相关测试文件；
- 公共类型、RPC 或跨包导出改变时运行相关 package build；
- Narrative / Agent migration 改变时运行 SQLite `:memory:` migration 与重启恢复测试；
- 完成 Phase 5–7 的跨模块切换后，再运行完整 Application Runtime、Studio Server、Client 定向测试与根 TypeScript build；
- 自动检查通过不等于前端 Timeline 与 Agent 面板的视觉验收通过。

---

## 7. 风险与停止条件

### 7.1 Agent Preset identity 未确定

风险：Agent Session 缺少稳定 Agent 身份，只能继续依赖旧 Agent Runtime Profile。

处理：Phase 4 前停止，先建立最小 Agent Preset identity；不得把本地 Model Binding 写入可分发 Preset。

### 7.2 Opening 仍使用 role-based Schema

风险：创建 Timeline 时重新把 Chat role 泄漏进 Narrative。

处理：Phase 3 前完成 roleless Opening template 决定；Importer 负责旧格式转换。

### 7.3 Card Resource 语义继续扩大

风险：Card bundled resources、Timeline launch resources 和 recommended Preset 继续混用同一数组。

处理：本计划只迁移当前 `promptResourceIds` 等价链。如果实施中必须同时解决 Preset selection，则停止并单独更新 Card Manifest 计划，不在 Timeline 代码里增加临时 heuristic。

### 7.4 State Store 尚未定型

风险：为了让 Branch 回退看起来完整，提前恢复空 `BranchStateSnapshot` 或伪造 checkpoint。

处理：本计划不实现 State 持久化。Narrative Branch 先只管理正文 head；变量系统实施时再增加明确的 Timeline/Branch State authority。

### 7.5 Runtime 模块继续集中

风险：新 Timeline 与 Agent Session 全部继续堆进 `runtime.ts`。

处理：每个新领域先建立朴素的函数模块和明确 operation surface，由 `createApplicationRuntime()` 组合；不引入 Service class、DI container 或 Command Bus。

### 7.6 大范围同时切换导致无法定位回归

风险：Schema、Provider、RPC、Client、PromptBuild 同时修改，失败时无法判断责任边界。

处理：严格按 Phase 1–7 建立可运行检查点；新链验证前不删除旧链，但也不长期双写。Phase 7 必须一次性完成最终清理。

### 7.7 绕过共享 Data Engine

风险：Narrative Store 或 Agent Store 自己打开 SQLite connection、写 Changeset 或发布事件，重新形成双写与重复广播。

处理：Phase 2 前必须完成共享 Data Engine transaction / Commit Fact 基座。Domain Store 只接受受控 transaction handle，不拥有独立 platform event pipeline。

---

## 8. 完成标准

满足以下条件后，本计划可以标记完成：

1. `NarrativeTimeline` 完全取代旧剧情 `Session`；
2. Narrative Branch / Node 使用 `timelineId / headNodeId / parentNodeId`；
3. Narrative Node 不包含 Chat role；
4. Timeline 保存 Card 来源和当前有序 Prompt Resource 链接；
5. Agent Session 独立保存 Chat-compatible Agent Message；
6. Agent Message 与 Narrative Node 是独立 Domain Store 行，不内联整段历史，也不生成 Document Revision；
7. Step 不持久化，runId 只承担首版关联职责；
8. Provider ToolCall / ToolResult 可以完整往返并持久化；
9. 一次 AIRP 调用显式指定 Agent Session 与可选 Timeline target；
10. Agent 普通输出不会隐式成为 Narrative；
11. Timeline 与 Agent Session 均支持最近页和向历史分页；
12. Server 重启后两类历史都能恢复；
13. 旧 Session、Narrative Entry、Agent Transcript 镜像和固定 M0 Run 数据链已删除；
14. 当前开发数据库不再包含需要兼容读取的旧 AIRP 会话数据；
15. Narrative / Agent 提交进入统一 Data Commit Fact，Kernel 不依赖两个业务 Store；
16. Architecture / Reference 已按最终实现更新，不把计划描述成已实现事实。

---

## 9. 本计划明确不处理

- Agent Session 分支与历史 Message 编辑；
- Responses-native state chain；
- Streaming buffer 持久化；
- 持久 Agent Step / Runtime state machine Document；
- 完整 Agent Run dashboard 与 suspend/resume；
- Timeline State Store、变量 checkpoint 和世界状态回退；
- Card bundle inventory / launch resource / preset recommendation 的完整重构；
- Semantic Compiler / Renderer SDK；
- Narrative FTS、Branch Path Projection 与跨 Timeline 搜索；
- JSONL 活跃会话存储；
- 自动迁移旧开发 Session 数据；
- 多 Agent 并发编辑同一 Timeline 的冲突合并 UI；
- Extension 对 Agent Message / Narrative mutation 的最终 Capability SDK。

这些议题只能在真实依赖出现后追加独立计划，不应重新塞回本次基础迁移。
