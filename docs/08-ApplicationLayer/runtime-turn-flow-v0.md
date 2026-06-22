# Runtime Turn Flow v0

> **状态**：Open Design
> **主题**：玩家输入到回复落盘的完整 loop，串联 Session、Runtime、Prompt Builder、Provider、Tool、Commit、State、Trace。
> **相关**：[`session-timeline-data-model-v0.md`](session-timeline-data-model-v0.md)、[`isolation-scope-boundary-v0.md`](isolation-scope-boundary-v0.md)、[`airp-runtime-model-v0.md`](airp-runtime-model-v0.md)、[`provider-adapter-contract-v0.md`](provider-adapter-contract-v0.md)、[`agent/agent-runtime-loop-v0.md`](agent/agent-runtime-loop-v0.md)

---

## 1. 背景

现有文档已经分别讨论了：

- Session / Chat / Opening；
- Runtime Transcript / Narrative Timeline；
- ToolCall / ToolResult / Commit；
- Prompt Builder / Composition Skeleton；
- Provider Adapter；
- State Store；
- Summary；
- Trace。

但完整玩家回合需要一条端到端主线。

本文先描述默认 AIRP Runtime 的候选 flow：

```text
玩家输入
  -> Runtime run
  -> Prompt compose
  -> Provider invoke / stream
  -> Tool loop
  -> Commit / Review / Write
  -> UI 更新
  -> Summary / cleanup
```

---

## 2. 非目标

本文不定义：

- 最终 RPC 名称；
- 完整 Document schema；
- Provider-specific request body；
- UI 具体交互；
- 复杂 multi-agent 编排；
- 完整 branch / swipe / reroll schema。

---

## 3. 分层职责

```text
UI:
  收集输入，展示运行状态，处理确认 / 中止 / 重试。

AIRP Runtime:
  创建 Run，推进 loop，调用 compose / provider / tool，处理 commit。

Prompt Builder:
  根据 source set + skeleton 编译上下文投影。

Provider Adapter:
  compiled payload -> provider request -> normalized result / stream.

Tool / Capability:
  执行 search / patch_state / commit_narrative / extension calls.

State / Mutation:
  产生 MutationCandidate，校验，提交或丢弃。

Document Store:
  持久化 Documents / changeset / rollback。

Trace / Audit:
  串联用户输入、compose、provider、tool、commit、write。
```

Kernel 不理解该 flow 的业务语义。Kernel 只提供 Document / RPC / Event / Loom Runner / Trace / Audit 等能力。

---

## 4. 默认玩家回合流程

候选主线：

```text
0. UI sends player input

1. Runtime receives input
   - resolve session
   - create correlationId
   - create user-turn checkpoint
   - append Runtime Transcript user_input entry
   - maybe append Narrative Timeline entry if input is narrative content

2. Runtime starts Run
   - create runId
   - load Runtime Profile / Policy
   - load Provider Binding
   - build current source set

3. Runtime calls Prompt Builder
   - source adapters load selected sources
   - compose fragments
   - resolve skeleton / injection groups
   - apply projection order profile
   - emit compiled prompt payload
   - write compose trace / diagnostics

4. Runtime calls Provider Adapter
   - invoke or stream
   - provider maps compiled payload
   - provider returns text / tool calls / error / usage
   - provider audit records secretRef / model / usage, not secret plaintext

5. Runtime handles provider result
   - append Runtime Transcript provider_result
   - if tool call: append ToolCall entry and execute tool
   - if candidate output: decide whether to commit / revise / continue
   - if error: apply Runtime Policy

6. Tool loop, if needed
   - execute tool
   - append ToolResult
   - update Dynamic Context Mount / Fresh Read Tail if read tool
   - create MutationCandidate if write tool
   - compose again if loop continues

7. Commit path
   - commit_narrative / patch_state / mutate_setting creates MutationCandidate
   - Permission / Consent review
   - user confirm if required
   - write accepted changes as changeset

8. Run finalization
   - mark Run completed / failed / discarded / suspended
   - emit RunChangeset
   - archive transcript
   - update Run Memo / Dynamic Context Mount
   - maybe trigger summarization

9. UI receives events
   - stream deltas
   - tool status
   - confirmation request
   - final narrative entry
   - state patch
   - diagnostics
```

---

## 5. Step-by-step Detail

### 5.1 Input Intake

Runtime receives:

```text
sessionId
input content
input mode / intent hint?
client correlationId?
```

Runtime does:

- validate session exists；
- resolve active scope；
- create user-turn checkpoint；
- append Runtime Transcript `user_input`；
- decide whether input also writes Narrative Timeline；
- emit `airp.turn.started` event。

Open questions:

- M0 是否采用单一输入框；
- UI mode 是否显式区分 narrative / instruction；
- 用户输入进入 Narrative Timeline 是否需要 commit path。

### 5.2 Source Set Resolution

Runtime builds source set from:

- Session selected Cards；
- selected Opening；
- Narrative Timeline projection；
- Setting Store selected entries；
- State Store snapshot；
- Global Scope selected sources；
- Runtime Transcript projection；
- Dynamic Context Mount；
- Fresh Read Tail；
- Extension contribution；
- Run Memo。

Source set resolution must be traceable:

```text
source included because selectedCardIds includes cardA
source excluded because session disabled global user profile
source filtered because permission denied
```

### 5.3 Compose

Runtime calls Application compose.

Candidate output:

```ts
type ComposeResult = {
  compiledPayload: CompiledPromptPayload
  traceId: string
  diagnostics: unknown[]
}
```

`CompiledPromptPayload` is still a missing formal document. Until then, it should be treated as a structured payload, not stringified JSON fragment.

### 5.4 Provider Call

Runtime resolves Provider Binding:

```text
providerProfileId
modelId
adapter invoke / stream rpc
runtime options
```

Runtime calls Provider Adapter:

```text
compiledPayload + provider binding + tool specs + trace refs
```

Provider Adapter:

- validates capabilities；
- maps compiled payload；
- uses `secretRef` via Platform Security；
- invokes model；
- normalizes result / error / usage；
- emits stream events if streaming。

### 5.5 Provider Result Handling

Possible results:

```text
text output:
  Runtime may ask model to commit, auto-wrap into commit candidate, or continue loop.

tool call:
  Runtime creates Studio ToolCall and executes tool.

error:
  Runtime Policy decides retry / fail / switch / suspend.

stream cancelled:
  Runtime marks step cancelled and decides discard / keep partial.
```

Provider output does not directly write Narrative Timeline.

### 5.6 Tool Execution

Tool types:

```text
read:
  search_setting, retrieval, inspect timeline

write:
  commit_narrative, patch_state, mutate_setting

external:
  extension call, network effect, MCP
```

Read tool result:

```text
ToolResult transcript entry
Context Mount Item
Fresh Read Tail for next provider call
```

Write tool result:

```text
MutationCandidate
Permission / Consent review
Maybe accepted changeset
```

### 5.7 Commit / Review / Write

MutationCandidate examples:

- narrative append；
- narrative replace；
- state patch；
- pending setting patch；
- summary write；
- dynamic mount update。

Review checks:

- permission；
- consent；
- schema validation；
- transform / commit validation；
- conflict against document version；
- policy。

Write:

```text
Document Store changeset
RunChangeset association
Trace / audit relation
events emitted
```

### 5.8 Finalization

Run finalization should produce:

- run status；
- run transcript archive；
- run memo if applicable；
- run changeset；
- provider usage summary；
- diagnostics；
- maybe summary trigger decision。

Run may end as:

```text
completed:
  accepted commit or intentional no-output completion.

suspended:
  waiting for user confirmation or input.

failed:
  unrecovered error.

discarded:
  user / policy discarded run without accepting output.
```

---

## 6. Streaming Events

M0 may skip full streaming, but the flow must leave room for:

```text
airp.turn.started
airp.run.started
airp.compose.completed
airp.provider.stream.delta
airp.tool.started
airp.tool.completed
airp.commit.reviewRequested
airp.commit.written
airp.run.completed
airp.turn.completed
```

Provider-specific chunks should not leak as canonical UI data. Runtime should normalize enough for UI to display progress without binding to one provider.

---

## 7. Reroll / Retry / Abort

### 7.1 Retry Provider Step

Retry provider call can reuse:

- same source set；
- same compose trace；
- or re-compose if state / context changed。

Policy decides.

### 7.2 Reroll Turn

Reroll should restore user-turn checkpoint, then start a new Run.

```text
restore checkpoint
keep external audit
start new run
old run marked discarded or superseded
```

### 7.3 Abort

Abort during streaming:

- cancel provider call if supported；
- mark pending step cancelled / failed；
- keep partial transcript according to policy；
- do not write Narrative Timeline unless commit already accepted。

---

## 8. Summary Trigger

After commit, Runtime may evaluate summarization trigger:

```text
token pressure
timeline length
pending setting patches
manual request
```

If triggered:

- start summarization sub-run；
- read truncation range + Setting Layer；
- write summary slot；
- apply stable Setting patches；
- truncate or archive old projection source；
- emit summary events。

Summary is part of Runtime flow, not Kernel.

---

## 9. M0 Candidate

M0 default turn can be:

```text
1. User input starts Run.
2. Input defaults to Runtime Transcript.
3. In roleplay mode, input also appends Narrative Timeline.
4. Compose current context.
5. Provider invoke, no streaming first.
6. If provider returns plain text, Runtime creates commit_narrative candidate.
7. Auto-accept or user-confirm according to policy.
8. Write Narrative Timeline.
9. Write final state snapshot if patch_state used.
10. Mark Run completed.
```

M0 can defer:

- provider streaming；
- provider-native tool-call；
- multi-agent；
- branch / swipe；
- automatic summarization；
- complex commit validation；
- cross-provider fallback。

---

## 10. Open Questions

1. Runtime public RPC 是 `airp.run.start`、`airp.turn.submit`，还是其他命名？
2. `CompiledPromptPayload` 的正式结构是什么？
3. Provider Binding 存在 Session、Runtime Profile、Agent Profile 还是 Preferences？
4. M0 是否允许 provider-native tool-call，还是先由模型输出文本 commit？
5. 玩家叙事输入是否直接写 Timeline，还是也走 commit candidate？
6. RunChangeset 是否必须包含 narrative + state + mount + memo 的原子关系？
7. Streaming events 是否由 Provider Adapter 直接发，还是 Runtime 转发为 normalized events？
8. Reroll 是否保留旧 run transcript 给 debug viewer？
9. Summary trigger 是否在每次 accepted commit 后评估？
10. User confirmation 挂起时，Run status 是 `suspended` 还是 commit candidate status pending？

---

## 11. Discussion Capture: M0 Turn Decisions (2026-05-31)

### 11.1 Provider 默认心智

为了降低预设作者和普通用户的心智负担，默认 Prompt / Preset / Chat projection 可以采用 OpenAI-style messages 心智作为第一版友好模型。

但需要保持边界：

```text
Application / Prompt Builder:
  可以输出 messages-like compiled payload。

Provider Adapter:
  负责把 messages-like payload 转成具体渠道商格式。
```

也就是说，OpenAI-style 可以是默认作者体验，但不能变成 Kernel contract，也不能阻止 Anthropic / Gemini / 其他 provider family 使用自己的 request shape。

当某个渠道商新增特殊能力，例如 reasoning 参数、cache-control、thinking budget 或 provider-specific safety 参数，应由对应 Provider Extension 暴露 capability、options 和 mapping。

### 11.2 默认 Provider 渠道

默认官方实现可以优先覆盖主流 provider family：

```text
OpenAI-compatible
Anthropic-compatible
Gemini-compatible
```

这些是官方默认渠道 / adapter family，不是 Kernel 内置 provider。

第三方 Provider Extension 可以继续贡献自己的 profile schema、model capability、invoke / stream mapping 和 provider-specific options。

### 11.3 玩家 RP 输入直接 accepted 到 NarrativeEntry

在 RP 模式下，玩家输入可以直接成为 accepted NarrativeEntry。

同时，Runtime 应把该输入复制 / 投影为 Runtime Transcript 中的 user input，让 Agent 能在工作对话中理解刚发生的剧情。

概念流程：

```text
player RP input
  -> NarrativeEntry(user input, accepted)
  -> RuntimeEntry(user_input, derived from NarrativeEntry)
  -> Prompt Builder projection
  -> provider call
```

这一步不是简单重复存储，而是预留了玩家输入加工管道：

```text
Narrative input
  -> input transform / intent handling / formatting
  -> Runtime Transcript projection
```

后续可以在这里处理：

- 玩家输入改写；
- 指令 / 剧情混合输入拆分；
- 敏感内容过滤；
- 角色对白格式化；
- 转述 / 半转述；
- UI mode hint。

### 11.4 Agent 输出必须走 commit path

`commit path` 的意思不是“每次都必须弹用户确认”。

它表示 Agent 输出不能直接写入 Narrative Timeline，而要经过受控写入路径：

```text
provider output
  -> RuntimeEntry(provider_result)
  -> CommitCandidate
  -> validation / policy / optional consent
  -> accepted write
  -> NarrativeEntry(agent output)
  -> branch head / changeset update
```

M0 可以 auto-accept CommitCandidate，但仍然应走这条路径。

这样做的原因：

- 失败 run 不污染剧情正文；
- Agent 草稿和最终正文可区分；
- 后续可以加入格式校验、用户确认、插件拦截、state patch 事务；
- NarrativeEntry 能追溯到 run / provider / prompt trace；
- reroll / branch / rollback 有统一 changeset 边界。

### 11.5 每次用户输入都创建 checkpoint

每次用户输入都应创建 checkpoint / branch state point。

这里的“用户输入”不只包括一轮对话开头的玩家发言，也包括后续让 Agent 修改、重写、继续、调整的指令。

候选规则：

```text
user input starts or resumes meaningful runtime work
  -> create checkpoint at current branch head
```

这样：

- “继续写”可以回滚；
- “改得更温柔一点”可以回滚；
- “不要这样，重写上一段”可以回滚；
- 中途多次指导 Agent 不会把 state / draft / transcript 搅成不可恢复状态。

### 11.6 M0 暂缓 Tool / Summary / Dynamic Mount

M0 可以暂缓：

```text
provider-native tool-call
summary trigger
dynamic context mount
fresh read tail
multi-agent orchestration
```

M0 优先目标是让基础数据模型和 turn flow 跑起来：

```text
Session
Narrative tree
Runtime transcript
Provider stub
Commit path
Branch state point
Trace / diagnostics
```

