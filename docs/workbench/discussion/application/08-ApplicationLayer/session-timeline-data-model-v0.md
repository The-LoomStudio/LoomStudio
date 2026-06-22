# Session / Timeline Data Model v0

> **状态**：Open Design
> **主题**：Session、Narrative Timeline、Runtime Transcript、Chat 数据形式与落盘边界。
> **相关**：[`chat-opening-model-v0.md`](chat-opening-model-v0.md)、[`airp-runtime-model-v0.md`](airp-runtime-model-v0.md)、[`isolation-scope-boundary-v0.md`](isolation-scope-boundary-v0.md)、[`user-input-intent-v0.md`](user-input-intent-v0.md)

---

## 1. 背景

当前文档已经收束了一个关键方向：

```text
messages[] 不是 Chat 本体。
Runtime Transcript 不是 Narrative Timeline。
Provider response 不自动落入剧情正文。
```

但数据层仍缺少一份说明：

```text
Session 到底持久化什么？
玩家可见剧情是什么数据？
Agent 工作记录是什么数据？
Provider messages-like payload 和 Application chat/timeline 有什么关系？
```

本文件补这个缺口。

---

## 2. 核心判断

### 2.1 Session 是一次游玩实例

候选定义：

```text
Session:
  一次 Card / source set / runtime profile 被实例化后的游玩或创作实例。
```

Session 不等于 Card，不等于 Run，也不等于 provider conversation。

Session 应连接：

- selected card ids；
- selected opening；
- Narrative Timeline；
- Runtime Transcript archive；
- State Store instance；
- Projection Order Profile；
- Runtime Profile；
- Provider / model binding；
- Run Changesets。

### 2.2 Narrative Timeline 是玩家承认的产出

Narrative Timeline 保存被接受的剧情、对白、叙事、玩家可见输出。

```text
Narrative Timeline:
  canonical user-facing product.
```

它不保存：

- provider 原始 response 的所有内容；
- agent 的草稿和思考；
- tool call / tool result 全量；
- 失败 run 的中间结果；
- 被 discard 的候选输出。

这些属于 Runtime Transcript / Trace / Audit。

### 2.3 Runtime Transcript 是工作记录

Runtime Transcript 保存 Agent / Runtime 的工作过程。

它可以包含：

- user instruction；
- provider request / response 摘要或引用；
- assistant working message；
- tool call；
- tool result；
- commit candidate；
- error；
- retry；
- suspend / resume；
- discard reason；
- trace refs。

默认 AIRP Runtime 可以归档完整 transcript，但不默认把历史 transcript 全量投影进下一轮 prompt。

### 2.4 Chat 是 UI 术语，不宜急着作为 canonical 数据名

传统 `chat[]` 过度混合了：

```text
用户可见剧情
模型上下文
运行时日志
provider messages
```

Loom Studio 应避免把 `ChatMessage` 作为唯一基础数据结构。

更稳的候选是：

```text
Session
NarrativeTimeline
NarrativeEntry
RuntimeTranscript
RuntimeEntry
CompiledPayload
ProviderMessage
```

UI 可以把 Narrative Timeline 渲染成 chat-like 体验，但 backend 不应因此把 provider message 当 canonical chat。

---

## 3. 候选 Document 关系

不作为已接受 schema，只作为数据关系草案。

当前倾向是：

```text
字段先简单克制。
关系交给 SQL 表 / 索引表达。
不要在单个 Narrative document 里再造一整棵 JSON 树。
原型跑起来后，再根据 fixtures 和生态需求追加字段。
```

```text
airp.session
  id
  selectedCardIds
  narrativeTimelineId
  activeBranchId

airp.narrativeTimeline
  id
  sessionId

airp.narrativeBranch
  id
  sessionId
  timelineId
  headEntryId
  baseEntryId?
  parentBranchId?

airp.narrativeEntry
  id
  timelineId
  branchId
  parentEntryId?
  kind
  parts
  source
  runId?
  changesetId?

airp.runtimeRun
  id
  sessionId
  branchId
  status
  startedAt
  completedAt?
  changesetId?

airp.runtimeTranscriptBranch
  id
  sessionId
  branchId
  headEntryId?

airp.runtimeEntry
  id
  runId
  branchId
  parentEntryId?
  kind
  content?
  toolCall?
  toolResult?
  providerCallRef?
  stepMeta
```

开放问题：

- Runtime Transcript 是一个 Document 还是 entry documents 集合；
- Narrative entries 是否作为独立 rows / documents；
- Run 是否是 Document；
- ToolCall / ToolResult 是否独立 Document；
- 大块 provider response 是否进入 Asset Store / blob；
- branch / variant / swipe 的最小表达。

---

## 4. Narrative Entry 候选

Narrative Entry 不应过早硬编码角色类层级。

候选字段只表达最小事实：

```ts
type NarrativeEntry = {
  id: string
  timelineId: string
  branchId: string
  parentEntryId?: string
  kind: 'text' | 'user-input' | 'system-note' | string
  parts: NarrativePart[]
  visibility?: 'player-visible' | 'hidden' | string
  source?: {
    kind: 'user' | 'agent-commit' | 'opening' | 'import' | string
    runId?: string
    commitId?: string
    traceId?: string
  }
  createdAt: string
}
```

注意：

```text
kind 不等于 provider role。
source 不等于 speaker。
speaker / actor / character 是否成为结构化字段仍未定。
```

---

## 5. Runtime Entry 候选

Runtime Entry 服务 loop 和 trace，不服务最终读者。

```ts
type RuntimeEntry = {
  id: string
  runId: string
  branchId: string
  parentEntryId?: string
  kind:
    | 'user_input'
    | 'provider_call'
    | 'provider_result'
    | 'tool_call'
    | 'tool_result'
    | 'commit_candidate'
    | 'commit_result'
    | 'runtime_note'
    | 'error'
    | string
  content?: unknown
  refs?: {
    traceId?: string
    auditId?: string
    providerCallId?: string
    toolCallId?: string
    changesetId?: string
  }
  step?: {
    id: string
    status: 'pending' | 'completed' | 'failed'
    kind: string
  }
  createdAt: string
}
```

这与 [`agent/agent-runtime-loop-v0.md`](agent/agent-runtime-loop-v0.md) 中“Step 是 Message 元数据”的方向需要后续合并：

```text
如果 Runtime Transcript entry 采用 message-like 结构，
StepMeta 仍是 RuntimeEntry 的控制元数据。
```

---

## 6. Opening 与 Timeline

Opening 不应成为 Chat 数组中特殊第一条。

候选方向：

```text
Opening:
  Card / Session 初始化材料。

Session creation:
  selected Opening
  -> initialize Narrative Timeline entries
  或作为 prompt source 投影
  或两者都有，取决于 opening mode。
```

需要区分：

```text
Opening as initial fiction:
  写入 Narrative Timeline 初始 entries。

Opening as instruction / setup:
  只作为 Prompt Builder source，不成为剧情正文。

Opening as workflow input:
  进入 Runtime Transcript，触发初始 run。
```

---

## 7. Player Input

玩家输入默认进入 Runtime Transcript。

是否进入 Narrative Timeline 由 Runtime / Policy / UI mode 决定。

```text
roleplay text:
  Runtime Transcript: user_input
  Narrative Timeline: user dialogue / narration

instruction:
  Runtime Transcript: user_input
  Narrative Timeline: no change

system operation:
  Runtime Transcript or command audit
  Narrative Timeline: no change
```

这与 [`user-input-intent-v0.md`](user-input-intent-v0.md) 对齐。

---

## 8. Provider Message 不是 Runtime Entry

Provider Adapter 可以需要 `messages[]`、`contents[]`、`systemInstruction` 或其他 request body。

这些属于 provider-facing payload，不是 Session canonical data。

```text
Narrative Timeline / Runtime Transcript
  -> Prompt Builder projection
  -> Compiled Prompt Payload
  -> Provider Adapter mapping
  -> provider-specific request body
```

Provider response 回来后：

```text
provider response
  -> Runtime Entry / provider_result
  -> maybe ToolCall
  -> maybe CommitCandidate
  -> Narrative Timeline only via commit
```

---

## 9. M0 候选

M0 可以先收束：

```text
Session:
  selected card ids, timeline id, state ref, skeleton ref, provider binding ref

Narrative Timeline:
  tree-capable entries with active branch head

Runtime Run:
  one run per player turn by default

Runtime Transcript:
  message-like entries with StepMeta, mirrored to narrative branch topology

Branch / swipe:
  M0 至少支持 reroll 生成 sibling branch；复杂 branch UI 延后
```

暂缓：

- 完整 branch tree editor / merge；
- 多候选 assistant output；
- rich speaker / actor model；
- multi-modal timeline parts；
- transcript compaction policy；
- external transcript storage；
- provider response cache。

---

## 10. Discussion Capture: Narrative Tree / Runtime Transcript Tree (2026-05-31)

### 10.1 Session 内的两条 Chat-like 流

Session 是一个对话单元，但 Agent RP 场景下不能只有一条 chat。

候选分层：

```text
Narrative Timeline:
  剧情正文树。玩家实际阅读、分支、reroll、改写的对象。

Runtime Transcript:
  Agent 工作对话树。记录 Agent 如何产生、修改、提交剧情。
```

二者都可以被 UI 渲染为 chat-like 体验，但它们不是同一种 canonical data。

### 10.2 Narrative Timeline 必须支持树

AIRP 应用中分支是高频操作，不应作为遥远后置能力。

M0 至少应保留 tree / branch 的基础形态：

```text
NarrativeEntry:
  id
  parentEntryId?
  branchId
  changesetId

NarrativeBranch:
  id
  sessionId
  headEntryId
  parentBranchId?
  createdFromEntryId?
```

M0 可以不实现复杂 branch UI 和 merge，但数据层不应被线性 append-only log 锁死。

### 10.3 Runtime Transcript Tree 默认复刻 Narrative Tree

Runtime Transcript 不需要默认独立分支。

候选规则：

```text
每个 Narrative Branch 对应一个 Runtime Transcript Branch。
每个 accepted narrative changeset 关联产生它的 Run / Transcript entries。
Reroll 剧情分支时，也创建对应的 transcript branch。
```

这样：

- 剧情分支和 Agent 工作解释天然对齐；
- 用户查看某段剧情时，可以找到对应 Run；
- 丢弃分支时，相关 transcript 也可以一起隐藏或归档；
- 默认 Runtime 不需要维护第二套独立分支语义。

### 10.4 Run 与 Branch 的关系

一次 Run 应绑定到当前 branch head。

概念关系：

```text
Session
  NarrativeBranch A
    head changeset C3
    RuntimeTranscriptBranch A
      Run R1 -> C1
      Run R2 -> C2
      Run R3 -> C3
```

当用户从 C2 reroll：

```text
NarrativeBranch B created from C2
RuntimeTranscriptBranch B mirrors Branch B
Run R4 -> C4
```

旧 Branch A 不被删除，只是 active branch head 切换。

### 10.5 Branch State

Branch state 应与 branch head 绑定，而不是只与 Session 绑定。

候选：

```text
BranchHeadState:
  branchId
  headChangesetId
  narrativeHeadEntryId
  stateSnapshotRef or stateChangesetHead
  dynamicMountHead
  pendingSettingPatchHead
  runtimeTranscriptHead
```

存储上可以采用：

```text
snapshot + changeset chain
```

也可以先在 M0 中使用：

```text
每个 accepted turn 写一个 session state snapshot ref
```

后续再优化为增量 patch。

### 10.6 Card 初始化：Version Snapshot + Copy-on-write Overlay

Card source 不应被 Session runtime 自动修改。

Session creation:

```text
Card Source Version
  -> selected source snapshot
  -> initialize Session source refs
  -> create session-local overlays
```

Agent 修改设定时：

```text
default:
  write session-local setting overlay / pending setting patch

explicit:
  user promotes selected changes back to Card source
```

这兼顾：

- 新开 Session 时重置为 Card 初始内容；
- Agent 能让当前对话中的世界动态演进；
- 用户仍能显式编辑 Card 本体；
- 原卡不会被一次游玩自动污染。

### 10.7 对 M0 候选的修正

早期 M0 可简化 UI，但数据层不宜延后分支。

修正后的 M0：

```text
Narrative Timeline:
  tree-capable entries, active branch head.

Runtime Transcript:
  mirrors narrative branch topology.

State:
  branch-head snapshot or changeset head.

Branch UI:
  可以先只支持 reroll 生成 sibling branch，不做复杂树编辑。
```

---

## 11. Discussion Capture: 克制字段与 SQL-first Timeline (2026-05-31)

### 11.1 字段先克制，原型优先

当前方向不是在实现前穷尽 Session / Timeline / Transcript 的所有字段。

M0 应优先支持可运行原型：

```text
创建 Session
写入 Narrative Entry
创建 Branch
启动 Run
写入 Runtime Entry
关联 changeset
切换 active branch
```

其他字段应在真实 fixtures、UI 原型和插件需求出现后再添加。

### 11.2 利用 SQL，而不是在 JSON 里造树

因为 Studio Data Layer 默认使用 SQL / SQLite，Narrative Timeline 不应把整棵树内联成一个大 JSON。

更合适的方向：

```text
NarrativeTimeline:
  timeline index / container。

NarrativeBranch:
  branch cursor / metadata / head pointer。

NarrativeEntry:
  剧情正文节点。
  通过 branchId + parentEntryId + changesetId 形成树。
```

也就是说，树结构主要存在于 `NarrativeEntry` 的关系中，而不是在 `NarrativeTimeline` document 中维护一棵嵌套树。

### 11.3 Branch 显式，但不是第二棵树

`NarrativeBranch` 是显式对象，但它不负责保存一棵独立剧情树。

它更像：

```text
Branch:
  - 当前分支 head 指针；
  - 从哪个 entry / branch 派生；
  - UI 和 Runtime 的当前路径标识；
  - branch-local state head 的挂载点。
```

剧情正文仍然是一组 `NarrativeEntry`，每个 entry 自己携带 `branchId` 和 `parentEntryId`。

### 11.4 M0 最小字段候选

候选最小字段：

```text
Session:
  id
  activeBranchId
  createdAt
  updatedAt

NarrativeTimeline:
  id
  sessionId

NarrativeBranch:
  id
  sessionId
  timelineId
  headEntryId?
  baseEntryId?
  parentBranchId?

NarrativeEntry:
  id
  timelineId
  branchId
  parentEntryId?
  content or parts
  sourceKind
  changesetId?
  createdAt

RuntimeRun:
  id
  sessionId
  branchId
  status
  startedAt
  completedAt?

RuntimeEntry:
  id
  runId
  branchId
  parentEntryId?
  kind
  content or ref
  createdAt
```

暂不急着加：

- speaker / actor / participant；
- provider model details；
- token usage；
- rich visibility；
- multimodal part schema；
- complete branch merge metadata；
- full runtime step taxonomy。

这些可以通过 trace / audit / refs 或后续 migrations 补。

---

## 12. Discussion Capture: Player Input Projection to Agent Transcript (2026-05-31)

### 12.1 RP 输入同时进入 Narrative 与 Runtime

在 RP 模式下，玩家输入是剧情正文的一部分，因此可以直接 accepted 到 NarrativeEntry。

但 Agent 工作对话仍需要看到这次输入。

因此应显式区分：

```text
NarrativeEntry:
  玩家输入作为作品正文。

RuntimeEntry:
  同一输入经过投影 / 加工后，作为 Agent 工作上下文。
```

这不是把同一条 chat 简单复制两份，而是两个不同语义层的记录：

```text
Narrative:
  what happened in the story.

Runtime:
  what the Agent is asked to work with.
```

### 12.2 输入加工管道

NarrativeEntry 到 RuntimeEntry 之间应预留输入加工管道。

候选：

```text
NarrativeEntry(user input)
  -> input projection / transform
  -> RuntimeEntry(user_input)
  -> Prompt Builder source
```

这个管道后续可以支持：

- 玩家输入格式化；
- 指令与剧情拆分；
- mode hint；
- 角色对白归一；
- 半转述；
- 安全 / 风格 transform；
- 插件参与输入处理。

### 12.3 Agent 切换意味着新的工作对话

如果切换 Agent 或 Runtime Profile，可以开启新的 Runtime Transcript branch / run context。

但它仍可通过 Narrative Timeline 理解剧情，因为玩家输入和已接受剧情都在 NarrativeEntry 中。

这进一步说明：

```text
Narrative Timeline 是作品事实源。
Runtime Transcript 是某个 Agent 的工作过程。
```
