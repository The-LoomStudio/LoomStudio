# Agent Runtime Loop v0

> **状态**：Open Design
> **主题**：Agent Run 的最小运行生命周期和平台原语。
> **相关**：[`agent-model-v0.md`](agent-model-v0.md)、[`runtime-policy-v0.md`](runtime-policy-v0.md)、[`tool-capability-v0.md`](tool-capability-v0.md)

---

## 1. 设计边界

Runtime Loop 负责推进 Agent Run，但不规定 Agent 必须采用哪一种工作流。

平台只提供足够完成下列行为的原语：

- 调用 Provider；
- 记录输入和输出；
- 调用 Tool 并接收结果；
- 等待用户或外部事件；
- 恢复或中止运行；
- 提交受控 Mutation；
- 正常完成、失败或丢弃。

写作、审查、角色扮演、检索和多 Agent 编排都是这些原语之上的 Agent Preset / Runtime Policy，不是 Runtime Loop 的硬编码阶段。

---

## 2. Agent Run

候选最小生命周期：

```text
created
  -> running
  -> suspended
  -> running
  -> completed | failed | aborted | discarded
```

说明：

- `suspended` 表示等待用户、权限确认或外部结果，之后可以恢复；
- `aborted` 表示运行被主动终止；
- `discarded` 表示运行记录可以保留，但候选产出不被接受；
- `completed` 不等于一定写入 Narrative；不产出持久 Mutation 的 Run 也可以完成。

状态名称仍是候选，本文不固定数据库枚举。

---

## 3. Step 与 Agent Session Tree

Step 是 Agent 工作推进和恢复状态的节点。Agent Session 通过 Step 的 parent/head 关系形成工作树，一次 Run 通常沿其中一条路径推进。

候选最小结构：

```text
Step:
  id
  agentSessionId
  runId
  parentStepId?
  kind
  status
  payload or entryRef
  createdAt
```

`Step.kind` 可以同时承担持久化判别和 Runtime 状态机输入。平台应只定义推进循环真正需要理解的少量 well-known kinds，例如：

```text
provider_output
tool_call
tool_result
user_input
suspend
mutation
exit
```

Extension 可以在有所有者和命名空间的注册面上贡献额外 kind。未知 kind 如何恢复或继续，必须由注册它的 Runtime Driver 提供，不能默认当成成功结果吞掉。

本文不要求 Step 必须内嵌在 Chat Message。Message、ToolCall、ToolResult 等内容可以由 Step 引用，避免用一个对象同时承载全部数据和控制语义。

要避免的是把 `plan -> write -> review -> patch_state` 之类某个 Agent Preset 的阶段固化为平台唯一状态机，而不是删除 Step 状态机本身。

### 3.1 Run Transcript Entry

Runtime Transcript 记录 Step 所表达的用户输入、Agent 输出、工具结果、状态变化、Changeset 和错误等工作事实。

Provider `messages[]` 是每次调用时编译出的 transport payload，不是 Runtime Transcript 的 canonical schema。

---

## 4. 推进循环

最小循环如下：

```text
start or resume Run
  -> build permitted context projection
  -> compile provider payload
  -> call provider
  -> record provider result
  -> if tool calls: execute permitted tools and continue
  -> if waiting: suspend
  -> if mutation requested: create and apply controlled candidate
  -> if policy continues: next provider call
  -> otherwise complete, fail, abort or discard
```

是否自动继续、最大调用次数、用户能否中途插入指导、一次 Run 是否可以多次提交，都由 Runtime Policy 决定。

Runtime 必须设置基础安全上限，例如取消信号、调用次数或资源预算，但具体默认值不在本文确定。

---

## 5. ToolCall / ToolResult

ToolCall 和 ToolResult 是 Runtime Transcript 的一等事实。

Runtime 负责：

- 根据 Tool 名称解析能力；
- 校验参数和调用权限；
- 执行或委派调用；
- 记录结构化结果或错误；
- 决定是否继续 Provider 调用。

Tool 数量不设置人为上限。Agent Preset 应只声明实际需要的能力，Runtime 不应通过“通用路由工具”隐藏权限和所有权边界。

Extension Tool 通过正式 Capability / Extension 注册面贡献，Runtime 不扫描任意 RPC 并自动暴露给 Agent。

---

## 6. 受控 Mutation 与 Changeset

Agent 不能因为 Provider 返回了文本或工具参数就直接修改持久化数据。

```text
Agent requests mutation
  -> validate input
  -> check capability and permission
  -> create candidate when review is needed
  -> apply through owning domain API / Document transaction
  -> record success or failure
  -> emit fact only after commit
```

不同领域可以有不同提交路径：

- Narrative 写入；
- State patch；
- Setting 修改；
- 资源或 Extension 专属数据修改。

平台不强制所有 Mutation 经过同一个固定的写作审查流程。校验、权限、候选、确认和写入仍然是通用阶段，但是否需要用户 Review、由谁 Review，应由对应领域与 Runtime Policy 决定。

成功应用的 Mutation 应产生或加入 `Changeset`。Changeset 保存受影响对象、前后版本和可展示 diff，并关联触发它的 Agent Step 或用户操作。

```text
Step / User Action
  -> Mutation Candidate
  -> validated write
  -> Changeset
      - affected documents
      - before / after versions
      - semantic diff when available
      - source step / run / user action
```

Changeset 是通用 Ctrl+Z、redo、分支、审计和 Agent 观察修改历史的基础。Agent 可以通过受控 Context Source 查看近期 Changeset，理解变量、剧情或资产如何演进，而不必依赖完整旧 Transcript。

一次 Run 可以产生多个 Changeset。一次需要共同撤销的用户操作也可以把多个写入组织到同一 Changeset，但跨领域原子性仍以实际 Document Store 事务覆盖范围为准。

---

## 7. Suspend / Resume / Abort

Run 挂起时至少需要保存：

- Run 身份和当前状态；
- 已发生的 Transcript facts；
- 恢复所需的最小 continuation data；
- 等待原因和可接受的恢复输入；
- 当前权限与目标引用。

恢复前必须重新确认目标对象和权限仍然有效。Narrative Timeline、Setting 或其他外部状态可能在挂起期间已经变化，Runtime 不能假设旧 Context Projection 仍然有效。

Abort 必须停止后续 Provider、Tool 和 Mutation 调用。已经成功提交的外部副作用不会因为 Run 被中止而自动回滚。

---

## 8. Transcript Archive 与 Prompt Projection

持久化工作记录和把工作记录放回模型上下文是两件事。

```text
Transcript Archive:
  记录 Run 实际发生了什么。

Prompt Projection:
  选择当前 Provider 调用允许看到什么。
```

Agent Preset / Runtime Policy 可以选择 persistent、ephemeral 或 hybrid 策略。Runtime Loop 不写死“一轮一压缩”，也不假定历史 Transcript 必须持续进入上下文。

---

## 9. 与 Kernel 的边界

Agent Runtime 位于 Application 层，消费 Kernel 和基础包提供的通用能力。

Kernel 不认识：

- Agent Preset；
- Agent Session；
- Narrative Timeline；
- ToolCall 的业务语义；
- Mutation Candidate 的领域规则。

领域事实只能在对应数据真正提交后发出。`docs.changed` 只表示 Document Store 已变化，不能替代 `run.completed` 或领域专用事件。

---

## 10. 非目标

本文不定义：

- 固定 ReAct 状态机；
- 封闭且不可扩展的 Step taxonomy；
- 固定的小说生成或审查流水线；
- 主 Agent 工具数量；
- Transcript 与 Narrative 的镜像树；
- 通用 Command Bus；
- 没有事务保证的跨领域原子回滚承诺；
- Provider Adapter 的具体 payload。

---

## 11. 开放问题

1. Run 的最小持久化字段和状态名称是什么？
2. Suspend continuation 应持久化到什么粒度？
3. 同一个 Agent Session 是否允许多个并发 Run？
4. 用户输入是恢复当前 Run、创建新 Run，还是作为旁路指导，由哪一层决定？
5. Step.kind 的注册、版本和恢复契约是什么？
6. Transcript 中哪些 Provider 原始内容需要保存，哪些只保留引用或摘要？
7. Runtime Driver 对 Extension 开放哪些推进钩子，如何避免绕过权限与领域 API？
8. Changeset 的分组、Ctrl+Z 顺序和失效条件如何定义？
9. 一次 Run 多次提交时，UI 如何表达已提交和仍可丢弃的部分？
