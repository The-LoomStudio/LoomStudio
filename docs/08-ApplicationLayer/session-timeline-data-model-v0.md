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

不作为已接受 schema，只作为数据关系草案：

```text
airp.session
  id
  selectedCardIds
  openingRef
  narrativeTimelineId
  runtimeTranscriptIndexId
  stateStoreRef
  runtimeProfileRef
  compositionSkeletonRef
  providerBindingRef

airp.narrativeTimeline
  id
  sessionId
  entryIds
  branch?

airp.narrativeEntry
  id
  timelineId
  kind
  parts
  source
  runId?
  changesetId?

airp.runtimeRun
  id
  sessionId
  status
  startedAt
  completedAt?
  transcriptId
  changesetId?

airp.runtimeTranscript
  id
  runId
  entryIds

airp.runtimeEntry
  id
  runId
  kind
  content?
  toolCall?
  toolResult?
  providerCallRef?
  stepMeta
```

开放问题：

- Runtime Transcript 是一个 Document 还是 entry documents 集合；
- Narrative entries 是否内联在 timeline document；
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
  append-only linear entries

Runtime Run:
  one run per player turn by default

Runtime Transcript:
  run-local message-like entries with StepMeta

Branch / swipe:
  延后，只保留 parent / changeset refs
```

暂缓：

- 完整 branch tree；
- 多候选 assistant output；
- rich speaker / actor model；
- multi-modal timeline parts；
- transcript compaction policy；
- external transcript storage；
- provider response cache。

