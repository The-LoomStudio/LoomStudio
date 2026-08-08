# Narrative Timeline / Agent Session Data Model v0

> **状态**：Open Design
> **主题**：Narrative Timeline、Agent Session、Agent Run、Step 与 Changeset 的数据边界。
> **迁移说明**：旧稿使用 `Session` 同时表示游玩实例和 Agent 工作会话，现已不再作为默认前提。
> **事实边界**：本文描述目标方向；当前 M0 Document Types 仍保留旧 Session 与镜像 Transcript 实现。

---

## 1. 核心判断

Loom Studio 中存在两种树，但它们服务不同体验：

```text
Narrative Timeline Tree:
  一次游玩体验的中心。
  表示剧情世界线和被接受的正文。

Agent Session Tree:
  一次编辑体验的中心。
  表示用户如何与 Agent 协作、尝试、调用工具和产生修改。
```

二者可以连接，但不共根、不镜像，也不要求同步回退。

---

## 2. Narrative Timeline

Narrative Timeline 是剧情世界线的权威树，不是会话记录。

它保存：

- 被接受的剧情正文；
- Narrative 节点的父子关系；
- 当前分支和 head；
- 与来源 Agent Step、Run 或 Changeset 的可选关联。

它不保存：

- Agent 的完整工作对话；
- ToolCall / ToolResult；
- Provider 原始 response；
- 失败或丢弃的候选；
- 为了控制 Runtime 而产生的 Step 状态。

### 2.1 Narrative 节点保持极简

当前候选只需要表达一个正文节点及树关系：

```text
NarrativeNode:
  id
  timelineId
  parentNodeId?
  raw
  sourceChangesetId?
  sourceAgentStepId?
  createdAt
```

字段名仍是候选。当前不引入 `Chapter`、`Scene`、`Floor` 等额外 canonical 层级。未来如需持久化渲染结果，应作为正文节点的附属数据，而不是先建立小说体裁专用嵌套。

### 2.2 文本长度不决定归属

短对话也可以写入 Narrative Timeline。判断标准是“它是否成为剧情世界的已接受正文”，而不是文本有多长、UI 看起来像小说还是聊天。

---

## 3. 玩家输入

玩家输入首先是发给 Agent 的指导或剧情意图，因此属于 Agent Session Tree 中的用户 Step。

```text
User Input
  -> Agent Session Step
  -> Agent work / tools / candidate
  -> controlled commit
  -> Narrative Node
```

玩家输入不默认作为与正文平级的 Narrative 节点。这样可以避免同一内容同时以“用户消息”和“剧情正文”进入 Agent 上下文。

为了保留来源和回退后的可解释性，Narrative 节点或其 Changeset 可以引用产生它的用户 Step。是否还需要保存一份不可变的输入摘要或 comment，属于待定的 provenance 设计，不应先复制成第二份剧情正文。

---

## 4. Agent Session Tree

Agent Session 是 Agent Preset 的运行实例和编辑工作区。

候选关系：

```text
AgentSession
  id
  agentPresetRef
  localBindingRef
  targetBindings[]
  activeBranchId

AgentSessionBranch
  id
  agentSessionId
  headStepId
  createdFromStepId?

AgentStep
  id
  agentSessionId
  branchId
  parentStepId?
  runId
  kind
  status
```

这些字段只用于表达关系，不是最终 Schema 承诺。

Agent Session Tree 可以保存：

- 用户与 Agent 的多次来回；
- Provider 输出；
- ToolCall / ToolResult；
- 等待和恢复状态；
- 候选修改；
- Changeset 引用；
- 错误、重试和分支来源。

用户可以从旧 Step 继续并形成新的 Agent Session 分支。该分支表示新的编辑路径，不自动创建新的 Narrative 世界线。

---

## 5. Agent Session 与 Narrative Timeline 的连接

Agent Session 通过显式 binding 连接工作目标，而不是拥有 Narrative Timeline。

```text
Agent Session A
  -> binds Narrative Timeline X

Agent Session B
  -> also binds Narrative Timeline X

Agent Session A
  -> may later bind Narrative Timeline Y
```

基本规则：

1. 同一 Narrative Timeline 可以被多个 Agent Session 编辑。
2. Agent Session 可以在权限允许时切换或解绑 Timeline。
3. Narrative 切换分支或回退时，Agent Session head 不自动变化。
4. Agent Session 切换分支时，Narrative head 不自动变化。
5. Agent 下一次继续工作前，应重新读取当前 target head、版本和必要 Changeset。

连接对象不必限定为 Narrative Timeline。通用 Agent 也可以绑定 Prompt Asset、Card、Extension 资源或其他工作目标。

---

## 6. Agent Run

Agent Run 是 Agent Session Tree 中一次有边界的执行过程。

一次 Run 可以跨越多个 Step，也可以等待用户后继续。Run 与树的关系不是“一条消息一个 Run”。

```text
Agent Session Branch
  Step U1: user input
  Step A1: provider output
  Step T1: tool call
  Step T2: tool result
  Step A2: ask user
  Step U2: user response
  Step C1: applied changeset
```

这些 Step 可以属于同一个 Run。Run 完成后，Agent Session 仍可继续创建后续 Run。

---

## 7. Changeset

Changeset 记录一次已经应用到持久化数据的改变。

```text
Changeset:
  id
  sourceAgentStepId?
  sourceRunId?
  sourceUserActionId?
  affectedDocuments[]
  beforeVersions[]
  afterVersions[]
  diff or semantic operations
  createdAt
```

字段名和 diff 表达仍待实现验证。

Changeset 可以覆盖：

- Narrative 追加或编辑；
- State / Variable 更新；
- Setting 与 Prompt Asset 修改；
- 其他 Document 或 Extension 数据修改。

主要用途：

- 通用 undo / redo；
- 展示剧情、变量和资产的演进 diff；
- 将 Agent Step 与真实副作用关联；
- 为 Agent 提供压缩后仍可读取的修改历史；
- 支持分支、审计和恢复。

每次 ToolCall 不一定产生 Changeset；只有实际持久化修改才需要。一次用户操作或一次提交可以组织一个 Changeset，一次 Run 也可以产生多个 Changeset。

Changeset 的逻辑分组与数据库原子性必须分开描述。只有同一实际事务覆盖的写入才能保证全部成功或全部失败。

---

## 8. 回退与分支

### 8.1 Narrative 回退

Narrative 回退切换剧情世界线的 head，并恢复该世界线所声明关联的状态。它不回退 Agent Session Tree。

Agent 继续工作时，通过当前 Narrative head、相关状态版本和 Changeset 历史理解发生了什么变化。

### 8.2 Agent Session 分支

Agent Session 分支用于从旧 Step 重新尝试编辑路径。它不自动撤销已经应用的 Changeset，也不自动切换 Narrative 分支。

如果用户希望撤销某次已经落盘的修改，应显式执行 Changeset undo 或 Narrative 回退，而不是只切换 Agent Session head。

### 8.3 一个回退入口

产品可以向用户提供统一的回退入口，但底层仍需识别当前要回退的权威对象：

- 剧情世界线：切换 Narrative head / checkpoint；
- 已应用编辑：撤销 Changeset；
- Agent 工作尝试：切换 Agent Session head。

是否把这些行为组合成一次用户操作，需要后续结合 UI 和事务能力验证，不能仅凭“一个按钮”假设它们天然是同一种数据操作。

---

## 9. SQL-first 存储原则

两棵树都应使用节点关系和索引存储，不把整棵树内联成一个大型 JSON Document。

最低要求：

- parent/head 查询明确；
- branch 切换不复制整棵树；
- Changeset 可按目标、时间和来源 Step 查询；
- 删除或归档遵守引用完整性；
- 当前版本与历史版本可以区分；
- 运行时投影不依赖扫描整个 Workspace。

具体表结构应在实现前通过真实查询路径验证。

---

## 10. 当前实现与迁移边界

当前 M0 仍存在：

- `Session` 作为剧情运行实例；
- `NarrativeEntryContent` 的 `user | assistant` 角色；
- `AgentTranscriptEntry` 对 Narrative 的镜像记录；
- `submitTurn` 自动把 Provider 输出 accepted 到 Narrative。

这些是当前代码事实，不是本文目标模型已经落地的证据。迁移前不得提前修改 Architecture 或 Reference 文档中的实现描述。

---

## 11. 开放问题

1. Narrative 世界线对象最终就叫 `NarrativeTimeline`，还是仍需要更高层的游玩实例对象？
2. Agent Session Tree 的节点是统一 Step，还是 Step 与 Message 分离？
3. Narrative checkpoint 应关联哪些 State / Asset 版本？
4. Changeset undo 是生成逆向 Changeset，还是移动版本 head？
5. 跨多个 Document 的 Changeset 如何表达部分不可逆副作用？
6. 同一 Narrative Timeline 被多个 Agent Session 并发编辑时如何做版本校验？
7. 用户输入 provenance 是引用原 Step、复制摘要，还是二者兼有？
8. Agent Session 的归档、删除和 Transcript 压缩如何保留 Changeset 来源链？
