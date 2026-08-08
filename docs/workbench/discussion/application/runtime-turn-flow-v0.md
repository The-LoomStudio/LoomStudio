# Runtime Turn Flow v0

> **状态**：Open Design
> **主题**：用户输入、Agent Session、Agent Run、Step、Changeset 与 Narrative 提交的完整路径。
> **事实边界**：本文描述目标方向，不代表当前 `submitTurn` 已经按此实现。

---

## 1. 核心链路

```text
User Input
  -> append Agent Session user Step
  -> start or resume Agent Run
  -> build Context Projection
  -> call Provider
  -> append Agent Step
  -> execute ToolCall / receive ToolResult as needed
  -> create Mutation Candidate when persistent data should change
  -> validate and apply mutation
  -> write Changeset
  -> optionally append Narrative Node
  -> continue, suspend, complete, abort or discard Run
```

玩家输入不默认写入 Narrative Timeline。Narrative 只接收经过受控提交的剧情正文。

---

## 2. 输入进入 Agent Session

用户输入首先成为 Agent Session Tree 中的 Step，并关联当前 Agent Session branch/head。

Runtime Policy 决定它会：

- 开启新 Run；
- 恢复 suspended Run；
- 作为当前 Run 的补充指导；
- 中止当前路径并从旧 Step 创建新分支。

这不是由输入文本长度或 UI 位于中央还是侧栏决定的。

---

## 3. Context Projection

每次 Provider 调用前必须重新构造受控上下文：

```text
Agent Preset
Local Model / Provider Binding
current Agent Session path
current Run state
bound target heads and versions
permitted Narrative projection
active Setting / State / Context Sources
selected Changeset history
  -> Prompt Builder
  -> compiled provider payload
```

Runtime 不能把完整 Workspace、完整 Narrative 或完整 Agent Session 自动交给 Provider。Projection 必须服从激活、权限、版本和敏感信息边界。

---

## 4. Provider 与 Tool 循环

Provider response 先记录为 Agent Step，不自动成为剧情正文。

如果 Provider 请求 Tool：

1. 解析 Tool owner 和 capability；
2. 校验参数；
3. 检查权限和当前目标版本；
4. 执行 Tool；
5. 将 ToolResult 记录为新 Step；
6. 根据 Runtime Policy 继续、挂起或结束。

Tool 读取不会产生 Changeset。Tool 对持久化数据的实际修改必须进入 Mutation 路径。

---

## 5. Mutation、Changeset 与 Narrative Commit

```text
Agent Step requests mutation
  -> validate domain input
  -> check permission and expected version
  -> create candidate when confirmation is required
  -> owning domain applies write
  -> persist Changeset
  -> append mutation result Step
```

写入 Narrative 是一种领域 Mutation：

```text
commit narrative candidate
  -> validate timeline and parent head
  -> append Narrative Node
  -> update Narrative branch head
  -> record Changeset
  -> append success Step
```

State、Setting、Prompt Asset 和 Extension 数据使用各自的领域写入 API，但都可以产生可查询的 Changeset。

一次 Run 可以多次提交。已经成功提交的 Changeset 不会因为 Run 后续失败或被中止而自动消失；是否执行补偿或 undo 必须显式决定。

---

## 6. 接受、丢弃与重试

“接受正文”表示执行 Narrative Mutation，而不是把 assistant message 改成 accepted 状态。

“丢弃候选”只丢弃尚未应用的 Candidate。已经落盘的 Changeset 必须通过 undo、补偿写入或 Narrative 回退处理。

重试可以：

- 在当前 Agent Session branch 继续；
- 从旧 Step 创建新的 Agent Session branch；
- 在当前 Narrative head 上生成新候选；
- 显式从旧 Narrative node 创建另一条世界线。

这些选择彼此独立，不应由一个隐式“reroll”同时完成。

---

## 7. Narrative 回退后的 Agent 行为

Narrative 回退不回退 Agent Session。

回退成功后应产生可观察事实，至少包含新的 Narrative head 和版本。Agent 下一次继续时重新投影当前权威状态，并可读取相关 Changeset diff。

Agent Session 中原有对话仍然存在，但其中关于旧世界线的结论可能已经过期。Runtime 应通过版本事实和 Context Projection 处理 stale information，而不是假装旧对话从未发生。

---

## 8. 自动保存与 checkpoint

每次成功持久化修改都应形成可恢复的版本事实或 Changeset，但不要求每个 Agent Step 创建剧情 checkpoint。

Narrative checkpoint 的自然候选时机是正文提交成功后。它可以关联当时的 Narrative head 以及需要随世界线恢复的状态版本。

玩家主动存档可以是对某个已存在 checkpoint/head 的命名、固定或快照策略，不必复制一整套 Agent Session Tree。

具体 checkpoint 包含哪些资产，需要在 State、Setting 与 Prompt Asset 的所有权确定后单独收束。

---

## 9. 失败路径

### Provider 或只读 Tool 失败

- 记录 error Step；
- 不产生 Changeset；
- Run 可以重试、挂起或失败；
- Narrative 不变化。

### Mutation 校验失败

- 不写目标 Document；
- 不产生成功 Changeset；
- 把字段级错误返回 Agent；
- Agent 可以修正参数后继续。

### 多 Document 写入部分失败

- 同一 Document Store 事务内的写入应整体回滚；
- 外部副作用或不在同一事务内的领域不能虚构原子性；
- 记录失败位置和已成功副作用；
- 需要时生成补偿或人工处理提示。

---

## 10. 当前实现差异

当前 `submitTurn` 仍将一次用户输入、一次 Provider 调用、Narrative 写入和镜像 Transcript 写入绑定成固定流程。这是 M0 实现事实。

目标模型需要后续拆分：

- Agent Session / Step 持久化；
- 多步 Run；
- 受控 Tool loop；
- Narrative commit；
- Changeset 与版本关联；
- 独立的两棵树及其 binding。

本文不构成直接迁移计划。

---

## 11. 开放问题

1. 哪些 Runtime facts 必须在每次 Provider 调用前重新求值？
2. 一个 Run 多次提交时，用户如何区分候选、已提交和可撤销改变？
3. Narrative checkpoint 与 Changeset 是一对一、一对多还是独立关联？
4. 玩家主动存档是否只是命名 head，还是需要物化状态快照？
5. Agent Session 分支创建时，如何处理尚未完成的 ToolCall 和 suspended continuation？
6. 外部不可逆 Tool 副作用如何进入 Changeset 和 UI 警告？
