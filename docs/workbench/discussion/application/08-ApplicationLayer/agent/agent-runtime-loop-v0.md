# Agent Runtime Loop v0

> **状态**：Open Design  
> **主题**：Agent 运行循环的基础架构。Step 作为唯一原子、Commit→Review→Write 流水线、事件约定、存储策略。  
> **相关**：[`agent-model-v0.md`](agent-model-v0.md)、[`runtime-policy-v0.md`](runtime-policy-v0.md)、[`tool-capability-v0.md`](tool-capability-v0.md)、[`../../airp-runtime-model-v0.md`](../airp-runtime-model-v0.md)

---

## 1. 核心数据结构

### 1.1 Run

一次完整的 Agent 执行生命周期。

```text
Run:
  id:        string
  status:    'executing' | 'suspended' | 'completed' | 'failed' | 'discarded'
  createdAt: string
  updatedAt: string
```
*注：Run 的执行轨迹由带有相同 `runId` 的 Chat Message 序列隐式构成。*

### 1.2 Message & StepMeta

Runtime 的每一次推进都会在 Chat 数组中追加/更新一条 Message。
Message 承载了内容，而 `step` 字段承载了**Loop 控制流**的状态。

```text
Message (Runtime Transcript 元素):
  role:       'system' | 'user' | 'assistant' | 'tool'
  content:    string | null
  tool_calls: [...] (可选)
  name:       string (可选，tool name)
  step:       StepMeta (运行时管控元数据)

StepMeta (Loop 控制器对象):
  id:         string
  runId:      string      ← 标识这条消息属于哪一次 Run
  kind:       string      ← 异化控制流的开关（命名约定）
  status:     'pending' | 'completed' | 'failed'
```

Step 不再是独立的执行单元或数组，而是附加在 Chat Message 上的控制器元数据。Loop 的运转完全依赖读取最新 Message 的 `step.status` 和 `step.kind`。

---

## 2. `kind` 约定（Convention）

平台定义一组 well-known kind，并为其提供内建行为。扩展可以定义自己的 kind，平台不认识的 kind 按黑盒走 Trace，不阻断、不报错。

### 2.1 控制流 kind 约定

`kind` 是直接对接 Loop 控制器的开关。Loop 基本上是自动化执行的（只要不停止、不超时、不报错，没遇到结束标记，就一直执行）。

```text
'tool_call'
  行为: 当前 Message 包含 tool_calls，Loop 自动解析并路由到 Tool handler 执行，
        执行完毕后追加 'tool_result' Message，Loop 继续。

'tool_result'
  行为: Tool 执行完毕的结果，Loop 将其追加并再次请求 Provider，Loop 继续。

'suspend' (例如调用了 ask_user)
  行为: 挂起 Run (status 变更为 suspended)，Loop 停止并等待外部输入；
        收到输入后追加 'user_input' Message，恢复 Run。

'commit' (例如调用了 commit_narrative)
  行为: 触发 Commit→Review→Write 流水线。

'exit' (正常结束 / 纯文本回复)
  行为: 正常退出当前 Run。

'user_insert'
  行为: 用户中途手动插入消息，可由插件/预设定义如何处理（如打断当前 Run 或纳入上下文）。
```

### 2.2 扩展自定义 kind（示例）

```text
'ext.dice.roll'
  插件自定义的控制流，Loop 不认识，默认行为可以是当做 'tool_result' 继续请求，
  或由插件注册对应的 Interceptor 拦截处理。
```

平台不认识这些 kind，只做：创建 Step → 进 Trace → 广播事件。

---

## 3. Commit → Review → Write 流水线

流水线**不是每个 Step 都走**。只有产生 Mutation（修改持久数据）的 Step 才触发。

### 3.1 什么触发流水线

```text
触发条件: Step 的 kind 属于"mutation kind"集合。

平台 well-known mutation kind:
  commit.narrative    → 写入叙事
  commit.state        → 写入动态变量
  commit.setting      → 写入设定层（通常限于总结阶段）
```

普通的 `provider.call` / `tool.execute` 只在 Trace 中流转，不触发流水线。

### 3.2 三个阶段

```text
Commit（暂存候选）
  Agent 调用写入 Tool → 产生 Candidate
  Candidate 进入 Trace，不触碰持久数据
  广播: agent.candidate.created

Review（审查）
  Permission 检查
  拦截器链式调用（插件可在此修改或拒绝）
  如需用户确认 → Run 挂起（status: suspended）
  广播: agent.candidate.review

Write（正式写入）
  Review 通过后，调用 docs.write 落盘
  广播: agent.candidate.written
  Kernel 自动广播 docs.changed
```

### 3.3 Loop 控制器逻辑

Loop 的核心判定：

```text
1. 看最后一条 Message 的 step.status：
   'failed'    → 报错中断
   'pending'   → 挂起等待（如等用户回复、等插件确认）
   'completed' → 往下看 kind

2. 看 step.kind：
   'tool_call'   → 自动执行工具，继续 Loop
   'tool_result' → 请求 LLM，继续 Loop
   'suspend'     → 挂起 Loop
   'commit'      → 走流水线
   'exit'        → 退出 Loop
   未知 kind      → 交给插件处理或默认继续

只要不遇到挂起、退出、失败，Loop 就会自动循环执行。
```

---

## 4. 与 Kernel 基建的映射

Agent Runtime 是应用层组件，消费 Kernel 已有能力，不修改 Kernel。

```text
Agent Runtime 需要的      Kernel 已有的
──────────────────────    ──────────────────────
事件广播                  EventBus (emit / subscribe / pattern)
数据持久化                DocumentStore (write / get / version / changeset)
追溯与审计                TraceAuditStore (appendTrace / appendAudit)
Prompt 编译执行           LoomRunner (fragments / passes)
扩展注册                  Extension Host (rpc.register / events.emit)
通信协议                  JSON-RPC 2.0 (Transport)
```

Agent Runtime 启动时注册 `agent.*` RPC namespace：

```text
agent.startRun         启动 Run
agent.resume           从 suspended 恢复
agent.abort            中断 Run
agent.getRunStatus     查询 Run 状态
```

---

## 5. 工具注册策略

避免工具列表爆炸。通过高内聚的路由型工具将细分意图压缩到参数中。

主 Agent 的核心 Tool 集控制在 5 个以内：

```text
1. commit_narrative         主线输出（触发流水线）
2. search_setting           读设定（scope 参数区分查人/查世界/查记忆）
3. patch_state              写动态变量（JSON Patch 格式）
4. dispatch_sub_agent       委派子任务
5. invoke_extension         调用插件能力（action 参数路由）
```

插件注册自定义 Tool 通过 `tools.*` RPC namespace，Agent Runtime 扫描自动发现。

---

## 6. Step 存储策略

### 6.1 收束方向：Step 是 Chat 消息的属性

Agent 的工作对话（Runtime Transcript）直接由 Chat 数组构成，每次操作（中间思考、Tool 调用、Tool 结果）都是独立的 Chat 元素，Step 只是它们的一个元数据对象（`step` 字段）。

```text
chat[i] = {
  role:       'assistant' | 'tool' | 'user' | 'system',
  content:    string | null,
  tool_calls: [...],
  step: {
    id:     string,
    runId:  string,
    kind:   string,
    status: 'pending' | 'completed' | 'failed'
  }
}
```

### 6.2 为什么这样存

```text
1. 一对一映射，逻辑清晰
   一个操作（比如一次 provider 生成，或一次 tool 结果返回）就是一条 Message。
   没有“一条消息内含多个步骤”的层级嵌套问题。

2. 天然兼容 Provider API
   大多数 LLM API（如 OpenAI）要求传入的 context 就是扁平的 Message 数组。
   将操作铺平为 Message，在构造 Prompt 时几乎不需要额外转换。

3. 控制流显式可见
   通过 step.runId 区分历史 Run 和当前 Run。
   停止生成（Abort）只需将最后一条 Message 的 step.status 标为 'failed'。
```

### 6.3 工作对话 vs 剧情正文

```text
Runtime Chat（Agent 工作对话 / Runtime Transcript）:
  包含所有的系统提示、用户交互、大模型思考、工具调用（如 search_setting、骰子）。
  这些信息帮助 Agent 完成任务，但不对最终读者暴露。

Narrative Timeline（剧情正文）:
  只有通过 commit 流水线的最终产出才会写入 Timeline。
  两者完全独立，互不干扰。
```

### 6.4 与 TraceAuditStore 的关系

TraceAuditStore 变为**可选的补充存储**，不再是 Step 的主存储。

```text
主存储:  chat 数组（Runtime Transcript） → 随会话持久化
补充:    traceAudit.appendTrace  → 用于跨 Run 的审计查询、分析统计
                                  可配置是否启用
```

---

## 7. ReAct 模式

ReAct 不是平台内建的状态机，而是通过 System Prompt 约定驱动的行为模式。

```text
平台提供的是:
  provider.call 返回 ToolCall → 自动创建 tool.execute Step → 自动回到 provider.call
  这个自然循环就是 ReAct 的 Action → Observation → Thought 循环。

预设作者控制的是:
  System Prompt 中的思维框架声明。
  例如："在调用工具前，先在文本中输出你的思考。"
  平台不强制，也不检查是否真的思考了。
```

---

## 8. 非目标

本文件不定义：

- 完整 chat / session 数据模型（属于数据层设计）；
- 具体 Provider Adapter 实现；
- 具体 Tool handler 实现；
- UI 如何渲染 Step；
- 子 Agent 的完整调度协议。

---

## 9. 开放问题

1. Step 的 `kind` 注册是否需要 manifest 声明，还是纯运行时约定？
2. 流水线的 Review 阶段，拦截器的执行顺序如何确定？
3. Run 的 Step[] 归档到 Trace 时，是否需要裁剪（去掉中间的大段 LLM 输出）？
4. chat[] 的数据模型与 Step[] 的关联方式（方案 A/B/C 或其他）？
5. streaming provider response 在 Step 中如何表示？是一个 Step 内的事件流，还是一个 pending → completed 的状态变化？
6. Run 挂起后的超时策略？挂起多久自动 discard？
7. 多个 Run 是否可以并发（同一个 Session 内）？

---

## 10. Discussion Capture: Run Transcript Archive 与 Prompt Projection 分离 (2026-05-30)

### 10.1 核心判断

Step / Message 的主存储仍应完整记录 Agent 工作过程，但 Prompt Builder 不必默认消费完整历史工作对话。

```text
Run Transcript Archive:
  保存完整 Runtime Transcript。
  包含 provider response、tool call、tool result、候选输出、失败、挂起和用户侧栏指导。

Prompt Projection:
  由 Runtime Profile / Policy 决定哪些 transcript 内容进入下一轮 prompt。
```

这允许默认 AIRP Runtime 使用短生命周期工作区，同时不破坏需要完整工作历史的 Agent / Extension。

### 10.2 默认 AIRP Runtime Profile

默认剧情推进形态可以是：

```text
main narrative input
  -> start new Run
  -> current Run owns fresh transcript, fresh read tail, draft output
  -> commit / discard / revise
  -> archive transcript
  -> emit Run Memo + Run Changeset
  -> next Run does not include full previous transcript by default
```

Agent 工作侧栏输入不自动开新 Run，而是继续当前 Run。

```text
side panel input
  -> append user guidance to current Run transcript
  -> keep fresh read / draft / tool state
  -> continue review or rewrite
```

### 10.3 Run Changeset

一次 Run 可能产生多个持久化影响：

```text
- narrative commit
- state patches
- settled / pinned context mount items
- pending setting patches
- run memo
- trace / audit refs
```

这些影响应被同一个 `RunChangeset` 关联，便于 rollback、branch、discard 和解释。

### 10.4 Runtime Profile 不写死

Ephemeral transcript projection 不是 Agent 基座唯一模式。

```text
ephemeral:
  归档历史 Run transcript，只投影 Run Memo / mounts / canonical sources。

persistent:
  历史工作对话持续进入 prompt。
  适合 code-agent-like / 长任务规划类 Extension。

hybrid:
  当前任务内保留完整 transcript，任务结束后 summarize/archive。
```

Runtime Loop 提供完整记录与状态推进原语；是否投影历史工作对话，由 Runtime Profile 决定。
