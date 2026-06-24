# AIRP Runtime Model v0

> **状态**：Open Design / Discussion Capture  
> **主题**：Studio Application 默认 AIRP 运行时模型、agent 工作对话与剧情产出分离、ToolCall / ToolResult / commit 边界。  
> **相关**：[`runtime-boundary-v0.md`](runtime-boundary-v0.md)、[`chat-opening-model-v0.md`](chat-opening-model-v0.md)、[`state-mutation-api-v0.md`](state-mutation-api-v0.md)、[`prompt/README.md`](prompt/README.md)

---

## 1. 背景

早期 Runtime Boundary 候选模型接近 SillyTavern 式单轮生成：

```text
append user message
  -> compose
  -> provider.invoke
  -> append assistant message
```

这个模型适合描述传统 chat completion 产品，但不足以描述 Studio Application 目标中的 AIRP 运行形态。

如果默认由 agent runtime 推进游玩 / 写作 / 世界模拟，那么一次用户输入可能触发：

- 多次模型调用；
- 工具调用；
- 子 agent 工作；
- 状态候选更新；
- 失败尝试；
- 重试 / 丢弃；
- 最终剧情文本写入。

这些内容不应全部混入同一个 `chat[]`。尤其是：

```text
Agent 的对话是工作内容。
剧情文本是产出。
```

产出不应因为模型说了一段 assistant message 就自动成为 canonical 剧情。更稳的方向是：剧情文本通过受控工具或 commit API 写入。这样失败的 agent run、幻觉的子 agent、死循环尝试都可以被丢弃，不污染最终作品时间线。

---

## 2. 核心问题

本文件讨论：

> Studio Application 的默认 AIRP Runtime 应如何组织 agent 工作过程、工具调用、剧情产出和可丢弃运行记录，而不把这些语义塞进 Kernel 或 Prompt Builder？

需要避免两个错误方向：

```text
错误方向 A：
  把 Runtime loop 设计塞进 Prompt Builder，给 prompt slot 加 Observation / Stop / Reflection 等 ReAct 专有概念。

错误方向 B：
  沿用 ST 式 chat[]，让 agent 工作消息、工具结果、草稿和最终剧情文本混在同一条 canonical timeline 中。
```

---

## 3. 当前已收束方向

### 3.1 Runtime loop 是独立专题

Runtime 的 Step、loop、hook、重试、停止条件、子 agent、工具调度都应专门讨论。

Prompt Builder 不应拥有这些 loop 语义。

```text
AIRP Runtime:
  决定如何推进运行状态。

Prompt Builder:
  编译 Runtime 选择后的上下文投影。
```

### 3.2 Step 保持简单和通用

`Step` 不应一开始就建模成：

```text
plan / observe / reflect / stop / tool-selection / state-extraction
```

这些是特定 runtime 策略中的阶段，不是基础模型。

更稳的定义是：

```text
Step:
  Run 中一次状态推进记录。
```

Step 可以关联 provider 调用、tool 调用、状态变更、commit、错误或 trace，但不预设 ReAct 分类。

### 3.3 Observation / Stop 不作为 Prompt Builder 基础概念

在 ReAct 语境里，Observation 和 Stop 很常见。

但在 Studio Application 基础模型中：

```text
Observation 是 runtime transcript 中的状态 / 内容。
Stop 是 runtime loop 的控制决策。
```

它们不应成为 Prompt Builder 的专有 slot 或 component。

如果某个 runtime 想把工具结果渲染成 `Observation: ...`，那是该 runtime / skeleton / provider payload 的渲染策略，不是 Application Layer 的基础分类。

### 3.4 ToolCall / ToolResult 属于 transcript / message 层

ToolCall 和 ToolResult 不是普通 prompt 文本，也不只是 prompt fragment。

它们具有 message 层属性：

- 调用 id；
- 调用者；
- 工具名；
- 参数；
- 执行状态；
- 结果内容；
- 成功 / 失败；
- 权限与 audit；
- 是否进入后续上下文；
- 与 provider tool-call 格式的映射关系。

因此它们应作为 Runtime Transcript 的一等条目，而不是 Prompt Builder 的特殊 slot。

### 3.5 Agent Dialogue 与 Narrative Timeline 分离

Studio Application 需要区分两条流：

```text
Runtime Transcript:
  agent 工作对话、工具调用、工具结果、子 agent 交流、草稿、失败尝试。

Narrative Timeline:
  被接受的剧情文本、对白、场景推进、作品正文或其他用户承认的产出。
```

这解决 ST 式 `chat[]` 的根本混淆：

```text
ST chat[] 往往既是模型上下文，又是剧情正文，又是运行记录。
```

Studio Application 不应继承这个混合模型。

### 3.6 剧情文本通过受控 commit 写入

默认方向：

```text
agent message 不直接等于剧情正文。
剧情正文通过 tool / commit API 写入 Narrative Timeline。
```

概念流程：

```text
Agent Transcript:
  assistant: 准备写入下一段剧情
  tool_call: commit_output({ content: "..." })
  tool_result: accepted

Narrative Timeline:
  append accepted story text
```

这样 Runtime 可以在写入前执行：

- 格式校验；
- 权限检查；
- 用户确认；
- 状态关联；
- branch / variant 处理；
- 回滚记录；
- trace / audit 关联。

### 3.7 失败 run 可以丢弃

因为 agent 工作过程和剧情产出分离，Runtime 可以丢弃一次失败运行：

```text
bad run:
  - agent 幻觉；
  - 子 agent 死循环；
  - 工具调用错误；
  - 中间草稿质量差。

discard:
  - 删除或标记该 run transcript branch；
  - 保留 audit / diagnostics 视策略而定；
  - Narrative Timeline 不受影响，除非已有 commit 被接受。
```

这对 AIRP 写作和复杂 runtime 很关键。

---

## 4. 候选分层

```text
Studio Application Documents:
  Card / Opening / Setting Layer / Session / Narrative Timeline / Runtime Transcript

AIRP Runtime:
  run / step / loop state / tool dispatch / provider call / commit policy / discard policy

Prompt Builder:
  selected documents + runtime transcript projection + narrative projection
  -> composition fragments
  -> compiled payload

Provider Adapter:
  compiled payload
  -> provider-specific request body
  -> provider response / stream / tool-call payload

Tool / MCP Extension:
  callable tools, external effects, tool result payloads

State / Mutation API:
  controlled state patch application / rollback / confirmation

Kernel:
  Document Store / RPC / Event / Extension Host / Loom Runner / Trace / Audit
```

Kernel 不认识 Runtime Transcript、Narrative Timeline、ToolCall、ToolResult 或 agent step 的语义。Kernel 只看到 Documents、RPC、Events、Loom invocations 和 Trace / Audit facts。

---

## 5. Runtime Transcript

Runtime Transcript 是 agent 工作过程的记录。

它可能包含：

- 用户给 runtime 的输入或指令；
- agent 工作消息；
- provider response；
- tool call；
- tool result；
- runtime note；
- 子 agent 结果；
- 错误；
- 被丢弃的尝试；
- 与 compose trace / provider audit / tool audit 的引用。

它不是 provider-facing `messages[]`，也不等于最终剧情正文。

Runtime 可以选择把 transcript 的一部分投影给 Prompt Builder：

```text
Runtime Transcript
  -> transcript projection / windowing / filtering
  -> Prompt Builder source adapter
  -> Composition Fragment[]
```

开放问题：

- Runtime Transcript 是否是一个 document，还是 run / step documents 的集合；
- 是否支持 branch；
- 丢弃 run 时 transcript 是删除、隐藏、归档还是保留 diagnostics；
- 用户是否可查看 agent 工作过程；
- 哪些 transcript entries 可进入后续 prompt；
- tool result 默认是否进入上下文。

---

## 6. Narrative Timeline

Narrative Timeline 是被接受的作品产出。

它可能包含：

- 剧情段落；
- 角色对白；
- 场景变化；
- 玩家可见输出；
- 被确认的生成结果；
- 与状态变更、资源引用、trace 的关联。

Narrative Timeline 应由受控写入路径修改，而不是由 provider response 自动追加。

概念写入路径：

```text
Runtime receives provider output
  -> decides to call commit tool / commit API
  -> validate / policy / confirmation
  -> append or patch Narrative Timeline
  -> write trace / audit relation
```

开放问题：

- Narrative Timeline 是否取代原 Chat timeline；
- 玩家输入如果是剧情内发言，应进入 Narrative Timeline 还是 Runtime Transcript，还是两者都有投影；
- Opening 如何初始化 Narrative Timeline；
- branch / variant / retry 是否属于 Narrative Timeline 的基础能力；
- commit 是否允许 patch 已有段落；
- commit 是否总是需要用户确认。

---

## 7. ToolCall / ToolResult

ToolCall / ToolResult 是 Runtime Transcript 的一等条目。

它们至少需要解决：

```text
ToolCall:
  agent 或 runtime 请求执行某个工具。

ToolResult:
  工具执行后返回的结果。
```

其中 `commit_output` / `write_story` / `append_narrative` 这类工具具有特殊重要性：它们是 agent 把工作成果提交到 Narrative Timeline 的受控入口。

但在基础模型中，不应过早固定这些工具的具体名称。

当前只收束原则：

```text
写入剧情正文是一种受控 commit 行为。
它可以表现为工具，也可以表现为 Runtime 内建 API。
但它不应是普通 assistant message 自动落盘。
```

开放问题：

- commit 工具是普通 Tool Extension，还是 AIRP Runtime 内建 capability；
- provider 原生 tool-call 如何映射到 Studio Runtime Transcript；
- tool result 是否可以是多媒体或 asset reference；
- tool call 是否允许由 runtime 自动产生，而不是模型产生；
- tool 执行失败是否进入下一轮 prompt；
- tool call / result 是否需要独立 Document Type。

---

## 8. Step 与 Loop

> **已迁移**：Step 与 Loop 的详细设计已独立为专题文档。  
> 见 [`agent/agent-runtime-loop-v0.md`](agent/agent-runtime-loop-v0.md)。

以下为迁移前的原始要点，保留供参考：

```text
核心收束：
  - Step 是 Run 内唯一的原子推进类型。
  - 所有语义通过 kind 字符串约定承载，不硬编码子类型。
  - 产生 Mutation 的 Step 触发 Commit → Review → Write 流水线。
  - 非 Mutation 的 Step（provider.call / tool.execute）只在 Trace 中流转。
  - Step 的存储策略需与 chat[] 数据层联动设计。
```

---

## 9. 与 Prompt Builder 的关系

Prompt Builder 不理解完整 runtime loop。

它消费 Runtime 提供的上下文投影：

```text
Runtime chooses:
  - 哪些 Narrative Timeline entries 进入上下文；
  - 哪些 Runtime Transcript entries 进入上下文；
  - 哪些 Setting Layer projection 进入上下文；
  - 当前可用工具说明；
  - 当前用户输入或目标；
  - 其他 runtime-owned context。

Prompt Builder compiles:
  selected sources -> fragments -> skeleton fill -> compiled payload
```

Prompt Builder 不决定：

- 是否继续 loop；
- 是否调用工具；
- 是否停止；
- 是否提交剧情；
- 是否丢弃 run；
- tool result 是否 canonical；
- state patch 是否应用。

这避免把 Prompt Builder 变成 Agent Framework。

---

## 10. 与 State / Mutation API 的关系

AI 或 agent runtime 不应直接随意改 Setting Layer。

更稳的方向：

```text
provider output / tool result
  -> Runtime 产生 state patch candidate
  -> Mutation policy
  -> State / Mutation API
  -> Setting Layer update
  -> Trace / Audit
```

状态更新和剧情 commit 类似，都应是受控写入。

开放问题：

- state patch candidate 是否作为 Runtime Transcript entry；
- AI 生成的状态变更是否默认需要确认；
- commit narrative 与 apply state patch 是否应在同一个事务中；
- rollback 是 Runtime 负责，还是 State / Mutation API 负责。

---

## 11. 与 Runtime Boundary 的关系

`runtime-boundary-v0.md` 负责高层边界：

```text
Studio Application owns documents and composition.
AIRP Runtime owns run / loop orchestration.
Provider Adapter owns provider mapping and invocation.
Security owns secrets.
Kernel owns platform capability.
```

本文件进一步展开 AIRP Runtime 内部需要讨论的领域模型。

---

## 12. M0 场景

### 12.1 单步剧情提交

```text
User input
  -> Runtime Transcript append user instruction
  -> Prompt Builder compile context
  -> Provider invoke
  -> Runtime receives output
  -> commit narrative output
  -> Narrative Timeline append accepted text
  -> close run
```

成功标准：

- agent 工作消息不直接污染 Narrative Timeline；
- accepted output 可以追溯到 run / provider / prompt trace；
- run 失败时可以不写入 Narrative Timeline。

### 12.2 工具调用后继续生成

```text
User input
  -> provider suggests tool call
  -> Runtime Transcript append ToolCall
  -> Tool Extension returns ToolResult
  -> Runtime Transcript append ToolResult
  -> Prompt Builder compiles next context with selected tool result
  -> provider generates candidate output
  -> commit narrative output
```

成功标准：

- ToolCall / ToolResult 是 transcript 一等条目；
- tool result 是否进入 prompt 由 Runtime 投影决定；
- Prompt Builder 不需要专门的 Observation slot。

### 12.3 丢弃失败子 run

```text
Parent runtime starts sub-agent run
  -> sub-agent loops badly
  -> Runtime marks sub run discarded
  -> no narrative commit
  -> parent run may retry or ask user
```

成功标准：

- Narrative Timeline 不被污染；
- diagnostics 可以解释为什么子 run 被丢弃；
- Prompt Builder 不需要理解子 agent 的内部 loop。

---

## 13. 非目标

本文件不定义：

- 完整 Agent Framework；
- ReAct / Plan-and-Execute / Workflow 的具体实现；
- Runtime hook API；
- Tool / MCP 协议；
- provider 原生 tool-call payload；
- Runtime Transcript 的最终 schema；
- Narrative Timeline 的最终 schema；
- commit 工具的最终命名；
- 完整 UI；
- Kernel API。

---

## 14. 开放问题汇总

1. Runtime Transcript 和 Narrative Timeline 的正式命名是什么？
2. 原 `Chat` 术语是否应被拆分或弱化？
3. 用户输入何时是 runtime instruction，何时是 narrative content？
4. commit narrative 是工具、Runtime API，还是两者都允许？
5. ToolCall / ToolResult 是否作为独立 Document Type？
6. Run / Step 是否持久化，还是只作为 trace projection？
7. 丢弃 run 时如何处理 audit、trace 和临时 documents？
8. State patch 与 narrative commit 是否需要事务边界？
9. Prompt Builder 如何消费 Runtime Transcript projection，但不依赖 transcript 内部路径？
10. Opening 如何初始化 Narrative Timeline，而不是成为特殊第一条 Chat element？

---

## 15. 当前设计原则

```text
1. Runtime loop 是独立专题，不塞进 Prompt Builder。
2. Step 是状态推进记录，不预设 ReAct 分类。
3. Observation / Stop / Reflection 不是 Prompt Builder 基础概念。
4. ToolCall / ToolResult 是 Runtime Transcript / message 层的一等条目。
5. Agent dialogue 是工作内容，不是作品正文。
6. Narrative Timeline 是产出，应通过受控 commit 写入。
7. 失败 agent run 可以整体丢弃，不污染 canonical narrative。
8. Prompt Builder 只编译 Runtime 选择后的上下文投影。
9. Provider Adapter 只映射和调用 provider，不理解 Card / Setting / Narrative 语义。
10. Kernel 不认识这些业务语义，只提供平台能力。
```

---

## 16. Discussion Capture: 默认 Ephemeral AIRP Run 与 Projection Policy (2026-05-30)

### 16.1 核心方向

默认 AIRP Runtime 可以采用短生命周期 Agent 工作区：

```text
每次主剧情窗口输入
  -> 开启一个新的 Agent Run
  -> 当前 Run 内保留完整工作对话、tool call、fresh read、候选输出
  -> commit / revise / discard
  -> Run 结束后归档完整 transcript
  -> 下一轮默认不投影完整历史 Agent transcript
```

这不是删除 Agent 工作历史，而是改变它在 Prompt Build 中的默认存在性。

```text
Agent transcript:
  程序和数据上存在。
  用于 trace / replay / debug / review。

Prompt-facing continuity:
  由 Narrative Timeline、Setting Layer、Dynamic Context Mount、Run Memo 承担。
```

### 16.2 为什么这样做

该模式解决三个耦合问题：

```text
1. 缓存:
   剧情正文成为主连续线，历史 Agent 工作对话不再并行滚动污染 prompt。

2. 卸载:
   read tool payload 不靠 chat 历史苟活，而是通过 dynamic mount 生命周期管理。

3. 总结:
   不需要同时维护剧情正文总结和 Agent 工作对话总结两套重系统。
   Agent 连续性由轻量 Run Memo / Director Memo 承担。
```

### 16.3 不污染 Agent 基座

Ephemeral run 是默认 AIRP 体验的 Runtime Profile，不是平台基座限制。

```text
Agent foundation provides:
  -完整 transcript archive
  -tool call / tool result 记录
  -run changeset
  -prompt projection policy hook
  -trace / audit

Default AIRP profile chooses:
  -历史 transcript archived but not prompt-facing by default
  -Run Memo + Dynamic Mount 作为交接
```

Extension / Preset 可以声明不同 profile：

```text
persistent:
  历史工作对话持续进入 prompt。

hybrid:
  当前任务内保留完整 transcript，任务结束后 summarize/archive。

ephemeral:
  每轮主剧情输入开新 Run，历史工作对话默认不投影。
```

### 16.4 主窗口与工作侧栏

默认 UI 交互应区分：

```text
主剧情窗口:
  输入 = 新一轮剧情推进任务。
  默认开新 Run。

Agent 工作侧栏:
  输入 = 继续当前 Run 的指导、修改、重写、确认。
  不自动开新剧情轮次。
```

### 16.5 Run Memo

Run 结束后可以生成轻量交接内容，而不是投影完整工作 chat。

候选内容：

```text
- 本轮完成了什么
- 未完成计划 / 下一轮建议
- 暗线 / 伏笔 / 约束
- 已读关键资料 sourceRefs
- 已 pin / settled 的 dynamic mount items
- 不应重复的方向
```

Run Memo 是 Prompt Builder 的显式 source，受 Skeleton / Runtime Policy 控制。
