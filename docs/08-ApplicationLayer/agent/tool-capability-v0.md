# Tool / Capability v0

> **状态**：Open Design  
> **主题**：Tool 定义、ToolCall / ToolResult、commit_output、provider tool-call 映射。

---

## 1. 定位

Tool / Capability 是 Agent 可调用的能力。它属于 Agent 领域，不是 Kernel 概念。

```text
Agent:
  决定是否调用 Tool。

Tool:
  Agent 可调用的能力。

ToolCall:
  Agent 请求执行某个工具的记录。

ToolResult:
  工具执行后返回的结果。
```

---

## 2. 核心判断

### 2.1 ToolCall / ToolResult 是 Runtime Transcript 一等条目

ToolCall 和 ToolResult 不是普通 prompt 文本，也不是 Prompt Builder 的特殊 slot。

它们具有 message 层属性：

```text
ToolCall:
  - 调用 id
  - 调用者（哪个 Agent）
  - 工具名
  - 参数
  - 执行状态
  - 权限与 audit

ToolResult:
  - 对应哪个 call id
  - 结果内容
  - 成功 / 失败
  - 是否进入后续上下文
  - 与 provider tool-call 格式的映射关系
```

### 2.2 Retrieval / Search 是 Tool / Capability 的子能力

Agent 主动搜索设定、记忆、知识，本质上是调用一个 search / retrieval 工具。

详见 [`retrieval-search-v0.md`](retrieval-search-v0.md)。

### 2.3 commit_output 是一种 Tool

剧情文本写入 Narrative Timeline，通过 commit_output / write_story 工具实现。

```text
Agent:
  生成候选输出
  -> 调用 commit_output tool
  -> Runtime 校验 / 确认
  -> Narrative Timeline 写入
```

但 commit_output 不是普通工具。它有特殊重要性：

```text
- 写入 canonical data
- 需要权限控制
- 可能需要用户确认
- 关联 trace / audit
- 可能触发 state mutation
```

开放问题：

- commit_output 是普通 Tool Extension、Runtime 内建 API，还是两者都允许；
- commit_output 是否总是需要用户确认。

---

## 3. Tool 分类（候选方向，不是已接受分类）

按作用域：

```text
内建 capability:
  commit_output / write_story
  search / retrieval
  state_patch
  summary_write

Extension 工具:
  由 Tool / MCP Extension 提供
  外部 API 调用
  文件操作
  代码执行
```

按权限：

```text
只读工具:
  不修改 canonical data。
  例如 search、retrieval、query。

写入工具:
  修改 canonical data。
  例如 commit_output、state_patch、memory_write。
  需要更高权限和确认。

外部效果工具:
  调用外部服务。
  例如 API 调用、代码执行。
  需要权限和 audit。
```

这些分类不预设为硬编码枚举，只是讨论方向。

---

## 4. Provider Tool-Call 映射

Provider 原生 tool-call 与 Studio ToolCall 不是同一个东西。

```text
Provider Tool-Call:
  某些 Provider API 的原生功能。
  结构由 provider 定义。

Studio ToolCall:
  Runtime Transcript 中的一等条目。
  结构由 Studio Application 定义。

映射:
  Provider Tool-Call -> Runtime Transcript ToolCall entry
  ToolCall entry -> Provider 下一轮 context 中的 tool result
```

Provider Adapter 负责：

```text
compiled payload 中 tool 定义 -> provider-specific tool schema
provider response 中 tool call -> Studio ToolCall entry
Studio ToolResult -> provider 下一轮 context
```

---

## 5. Tool Result 与上下文

Tool Result 是否进入下一轮 prompt，由 Runtime 决定，不由 Tool 自身决定。

```text
Runtime 决定:
  - 哪些 ToolResult 进入 transcript
  - 哪些 transcript entries 被投影给 Prompt Builder
  - ToolResult 是否需要裁剪 / 摘要

Prompt Builder:
  只消费 Runtime 选择后的投影。
```

---

## 6. 与 Permission 的关系

Tool 调用需要权限控制。详见 [`permission-consent-v0.md`](permission-consent-v0.md)。

```text
只读工具:
  默认允许，但可能受 setting visibility 约束。

写入工具:
  需要明确权限。
  可能需要用户确认。

外部效果工具:
  需要明确权限。
  需要 audit 记录。
```

---

## 7. 非目标

本文件不定义：

- Tool schema 的最终形态；
- 完整 MCP 协议适配；
- Tool 注册和发现机制（这是 Kernel Extension 能力）；
- Tool 执行 sandbox；
- Provider tool-call 的完整 payload schema。

---

## 8. 开放问题

1. commit_output 是否应该是 Tool Extension，还是 Runtime 内建 API？
2. search / retrieval 是否总是作为 Tool 调用，还是有时作为 Source Adapter？
3. ToolCall / ToolResult 是否需要独立 Document Type？
4. Tool 的权限粒度：per-tool、per-category、per-agent？
5. Tool result 的默认上下文策略：总是进入、默认不进入、还是由 policy 决定？
6. 多个 Agent 是否可以共享同一个 Tool 调用？
7. 子 Agent 的 Tool 权限是否由父 Agent 委派？

---

## 9. Discussion Capture: 写入工具三分类与事务候选 (2026-05-27)

### 9.1 不设计通用写入工具

AIRP 应用层的写入操作极为丰富且目标结构各异，不能设计单一的通用写入工具。

写入工具按**写入目标 (Target Region)** 和**写入模式 (Mutation Mode)** 分为三类。

### 9.2 三类写入工具

```text
1. commit_narrative（叙事写入）
   目标: Narrative Timeline
   行为: Append / Replace
   调用者: 主 Agent（写作模式）
   特殊性: 需要 Permission / Consent，可能需要用户确认

2. mutate_setting（设定修改）
   目标: Setting Layer 稳定设定区
   行为: insert / update / delete 设定项
   调用者: 总结子 Agent（总结阶段批量执行）
   特殊性: 非总结阶段产生 PendingSettingPatch 暂存
            只在总结阶段统一应用，以避免 KV Cache 失效

3. patch_state（变量更新）
   目标: 动态变量区（HP / 好感度 / 临时标记）
   行为: JSON Patch (RFC 6902) 格式
   调用者: 主 Agent 或 RuleJudge 子 Agent
   特殊性: 可随时执行，不影响 Prompt 前部 Cache
```

### 9.3 统一事务机制: MutationCandidate

所有写入 Tool 物理上只产生修改候选 (MutationCandidate)。

```text
流程:
  1. Agent 调用写入 Tool → 生成 MutationCandidate 暂存
  2. Runtime Policy 验证和审计
  3. Permission / Consent 确认
  4. 原子提交（通过 Kernel docs.write）或 Discard

commit_narrative: 通常触发 UI 挂起确认
patch_state: 根据 Policy 决定静默应用或 UI 展示
mutate_setting: 总结阶段批量提交
```

---

## 10. Discussion Capture: Read Tool、Desk 与 Dynamic Context Mount (2026-05-30)

### 10.1 核心问题

Agent 主动读取的内容不应简单 inline 写入长期 Agent chat。

原因：

```text
1. read result 通常是大块上下文，直接进入 chat 会破坏缓存和卸载。
2. ToolCall / ToolResult 需要 trace，但 read payload 不一定要长期 prompt-facing。
3. 主动读出的内容与程序性触发的绿灯世界书应共享排序和挂载规则。
```

### 10.2 统一动态挂载层

不把"绿灯程序性注入"和"Desk"做成两套互相竞争的 prompt 区块。

更稳的方向：

```text
Dynamic Context Mount Layer:
  passive activation item:
    关键词 / 变量 / JS rule / activation rule 触发的动态设定。

  active read item:
    Agent 主动 read / search 得到的内容。

  runtime item:
    Runtime 临时上下文、Run Memo、特殊提示。
```

这些 item 共享：

```text
- slot / mount region
- priority / folder order / entry order
- sourceRef
- token budget
- lifecycle policy
- trace metadata
```

区别只体现在 `origin`、`freshness`、`lifecycle`、`marker` 等运行时元数据。

### 10.3 Fresh Read Tail -> Settled Dynamic Mount

主动读取结果有两个阶段：

```text
fresh:
  本轮刚由 read tool 返回。
  下一次 provider call 中放在 prompt 尾部，靠近当前 Agent 工作。
  marker 明确标注为"刚刚读取到的结果"。

settled:
  被消费过一轮后，进入 Dynamic Context Mount Layer。
  按作者设定的 slot / priority / folder order 排序。
  之后由 TTL / budget / pin / stale policy 控制卸载。
```

概念流程：

```text
Agent calls read_setting(A)
  -> ToolCall / ToolResult 进入 Runtime Transcript
  -> full payload 生成 fresh activeRead mount
  -> next provider call 在 Fresh Read Tail 渲染 A
  -> provider call 结束后 A 进入 settled dynamic mount
```

如果下一轮又读取 B：

```text
A settles into authored dynamic order
B appears in Fresh Read Tail
```

这样只有新鲜读结果临时插队一次，不长期破坏作者排序。

### 10.4 ToolResult 记录方式

Runtime Transcript 应记录 read 的执行事实，但不必保存大块 payload inline。

```text
ToolResult transcript entry:
  callId
  toolName
  status
  summary?
  mountItemId
  sourceRefs

Context Mount Item:
  full content / rendered content
  sourceRefs
  origin: activeRead
  freshness: fresh | settled | stale
  lifecycle: ttl / pinned / archived
```

### 10.5 Pin 与卸载

主动读结果的卸载不应主要交给 Agent 每轮手动决定。

```text
Runtime Policy:
  默认 TTL、token budget、source stale、topic/session boundary。

Agent:
  可以 pin / release / promote。

User:
  可以在 UI 中临时 pin 重要资料。
```

原则：

```text
Agent decides what to read.
Runtime decides how long it stays mounted.
User and Agent may pin important materials.
```

### 10.6 与程序性触发的冲突

关键词或变量条件不满足，只能卸载 passive activation item。

如果同一 source 被 Agent 主动 read 出来：

```text
passive activation:
  由 activation condition 控制。

active read:
  由 read lifecycle policy 控制。
```

二者可以共享同一个 sourceRef 并在渲染时去重，但不能用关键词引擎作为 active read 的卸载依据。
