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

