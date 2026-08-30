# Agent Runtime 与 AI SDK 基建计划

> **状态**：Phase 4 已完成并通过主审；Phase 5 已完成可编辑 Tool Entry、Native / Content 分类投影和 Content Tool tools-zone 接缝，Responses Custom 与 Profile 级 placement override 待后续切片
> **日期**：2026-08-24
> **范围**：重新将 Vercel AI SDK 纳入 AI Gateway，实现 Provider 单步调用、流式事件、统一 ToolCall / ToolResult、三类工具 Transport、Agent Loop 与可恢复持久化。
> **事实边界**：本文是实施计划与阶段状态记录，不替代 Architecture。当前代码已有 canonical Transcript、Agent Loop、Native / Content Tool 与版本化 Tool Entry；跨进程 Resume 和 Responses Custom 仍未完成。

## 1. 决策摘要

本计划建议重新接入 Vercel AI SDK，但只把它作为 **AI Gateway 内部的 Provider 执行依赖**，不让 SDK 成为 Loom Studio 的 Prompt、Tool、Agent Loop 或 Session 权威。

```text
Prompt Builder
  -> 编译受控 Prompt Projection

Agent Runtime
  -> 拥有 Run / Step / Transcript / Tool / Permission / Loop

Platform AI Gateway
  -> 使用 AI SDK 调用 Provider
  -> 归一流、错误、usage 和 provider-native tool items

Provider
  -> OpenAI / Anthropic / Google / OpenAI-compatible / custom adapter
```

工具层采用一套 Studio canonical 语义，并支持三种传输：

```text
Provider-native JSON Function Tool
OpenAI Responses Custom / Free-form Tool
Assistant Content In-band Tool
                    ↓
          Studio ToolInvocation
                    ↓
        Registry / Approval / Execute
                    ↓
            Studio ToolResult
                    ↓
          Provider-specific Replay
```

关键取舍：

1. AI SDK 负责 Provider 基础兼容和流式执行，Studio 负责 Agent 状态机。
2. 一次 AI SDK 调用只推进一个 Provider Step；主 Agent Loop 不交给 SDK 自动持有。
3. Tool 语义与 Transport 分离；同一个 Tool 不因 Provider 不同而重复注册。
4. Raw Text 是一种输入和传输能力，不是一套独立写入系统。
5. Provider 原始 Stop Reason 与 Runtime 派生状态分别保存。
6. Session Header 只保存摘要和索引；恢复事实保存在 append-only Transcript / Step Tree 中。

## 2. 当前实现事实

### 2.1 AI Gateway 已接入 AI SDK，Application 仍保留上层账户边界

当前已新增 [`packages/ai-gateway`](../../../packages/ai-gateway)，在包内使用 Vercel AI SDK 及官方 Provider adapter，负责完整响应、流式响应、Provider-native Function Tool、usage、finish metadata 和取消。其 public contract 不暴露 AI SDK 类型。

[`packages/application-runtime/src/gateway.ts`](../../../packages/application-runtime/src/gateway.ts) 继续负责：

- Provider Profile、Secret、Model Enablement 与 Proxy；
- 将账户交给 Provider Adapter Registry 解析；
- 保持既有 Application Gateway 结果与 HTTP / 网络错误语义；
- 当前 Agent Turn 的非流式兼容入口。

### 2.2 Canonical Message 仍绑定 OpenAI Chat Completions

当前 [`packages/shared/src/chat.ts`](../../../packages/shared/src/chat.ts) 直接定义：

```ts
type ChatMessage =
  | { role: 'system' | 'developer' | 'user'; content: string }
  | { role: 'assistant'; content?: string; tool_calls?: ChatToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }
```

这不是 Provider-neutral canonical schema，而是 OpenAI Chat Completions wire shape。直接在此基础上增加 Responses Custom Tool 或 Content Tool，会使 Agent Store、Runtime 和 Provider Adapter 同时理解三种互不兼容的消息协议。

### 2.3 Agent Store 已持久化 Tool 配对，但只支持 Function Tool

当前 [`packages/agent-store/src/store.ts`](../../../packages/agent-store/src/store.ts) 会验证：

- Assistant `tool_calls` 必须使用 `type: function`；
- Tool Result 必须使用 `role: tool`；
- `tool_call_id` 必须找到对应调用；
- 一个 ToolCall 只能有一个结果。

这已经提供了调用配对和完整性基础，但 Provider wire shape 同时成为了持久化 schema。Content Tool 没有 Provider Tool Call ID，Responses Custom Tool 也不使用 Chat Completions 的 `role: tool`，因此需要先拆分 canonical Transcript 与 Provider Replay。

### 2.4 现有设计边界可以保留

以下既有方向不需要推翻：

- [`agent-runtime-loop-v0.md`](../discussion/application/agent/agent-runtime-loop-v0.md)：Provider `messages[]` 是编译后的 transport payload，不是 Runtime Transcript canonical schema；
- [`tool-capability-v0.md`](../discussion/application/agent/tool-capability-v0.md)：Provider Tool-Call 与 Studio ToolCall 不同；
- [`provider-adapter-contract-v0.md`](../discussion/application/provider-adapter-contract-v0.md)：Provider Adapter 只负责 payload 映射和调用，不拥有 Session、Prompt Builder 或 Loop；
- [`ai-gateway-streaming-execution-plan.md`](./ai-gateway-streaming-execution-plan.md)：流式是单次 Run 的交付策略，Gateway 负责取消、传输错误和规范化事件；
- [`session-timeline-data-model-v0.md`](../discussion/application/session-timeline-data-model-v0.md)：Agent Session Tree 与 Narrative Timeline 是不同权威树。

本计划补充的是实现顺序、AI SDK 边界、自由正文工具和恢复协议。

## 3. oh-my-pi 调研结论

调研基线：oh-my-pi commit `37eee71978951fccf66b21f7e3e2b74596ac9d74`，检查日期 2026-08-22。

### 3.1 它没有统一 Wire Format，而是统一内部语义

oh-my-pi 的主链是：

```text
Provider Native / Responses Custom / Assistant Content
                         ↓
              Canonical ToolCall
                         ↓
                  Agent Loop
                         ↓
              Canonical ToolResult
                         ↓
             Provider-specific Replay
```

对应实现集中在：

- `packages/agent/src/agent-loop.ts`；
- `packages/ai/src/dialect/`；
- `packages/ai/src/providers/openai-completions.ts`；
- `packages/ai/src/providers/openai-responses.ts`；
- `packages/ai/src/providers/openai-shared.ts`。

### 3.2 写入没有全部改成 Raw Text

| 工具语义                           | oh-my-pi 默认传输                                       |
| ---------------------------------- | ------------------------------------------------------- |
| 完整文件 `write`                   | JSON Function Tool：`{ path, content }`                 |
| Bash                               | JSON Function Tool：`{ command, cwd, timeout, ... }`    |
| Persistent Eval / CodeAct          | JSON Function Tool：`{ language, code }`                |
| `apply_patch` / hashline           | Responses Custom Grammar；不支持时回退 JSON `{ input }` |
| 无原生 Tool 能力或主动启用 dialect | Assistant Content XML / Hermes / GLM 等 In-band Tool    |

因此 Raw Text 的价值主要出现在“大块自由正文、代码、Patch、格式敏感内容”，不是替代所有结构化 Tool。

### 3.3 Content Tool 使用本地 Invocation ID

Content Tool 在 Provider 看来仍是 Assistant Content：

```xml
<invoke name="edit">
  <parameter name="input">*** Begin Patch ...</parameter>
</invoke>
```

Runtime 流式扫描正文，生成自己的 `ptc_*` ID，再转换为 canonical ToolCall。执行结果不伪造 Chat Completions `role: tool`，而是编译成下一轮普通正文：

```xml
<tool_response>
Done!
</tool_response>
```

这证明 Content Tool 可以兼容 Chat Completions，但配对、参数校验、流式半标签、截断和结果排序必须由 Runtime 自己承担。

### 3.4 Provider Stop Reason 不是 Agent 完成状态

Content Tool 的 Provider 原始 `finish_reason` 可能仍是 `stop`。oh-my-pi 在扫描出 canonical ToolCall 后，将内部运行判断派生为 `toolUse`。

它的 Loop 实际综合：

- Provider stop reason；
- 是否存在 canonical ToolCall；
- 是否 `length / error / aborted`；
- 是否等待权限或工具执行；
- 是否存在 steering / follow-up；
- 是否还有可继续的 Provider Step。

### 3.5 中断和分支需要 Synthetic ToolResult

当 ToolCall 因截断、中断、错误或 Session 分支失去结果时，oh-my-pi 会：

- 生成 synthetic ToolResult；或
- 将 orphan result 降级成普通说明；或
- 为 orphan call 补充 placeholder output。

目标不是伪装成功，而是保持 Provider Replay 可消费，并把真实失败原因保存在 Runtime 状态中。

### 3.6 Session 使用 append-only Tree Journal

oh-my-pi 使用：

```text
SessionHeader
Entry(id, parentId)
Entry(id, parentId)
...
```

Header 只保存 Session 身份、cwd、父 Session、缓存键等摘要。Message、ToolResult、Compaction、Branch Summary、Reset Boundary、模型变更和自定义恢复事件均作为 Entry 追加。

这与 Loom Studio 的 Agent Session Tree 方向一致：Header 不应成为完整状态机 KV 容器。

### 3.7 不直接照搬的部分

- 文件系统 `read / write / edit` 是 coding-agent 专用语义；
- Bash、Persistent Kernel、LSP、Hashline、ACP Permission Gate 不属于 Loom Studio M1 必需能力；
- OpenAI Responses Lark Grammar 是 Provider 专用优化，不是全部写入协议；
- 代码 Agent 的 Compaction 规则不能直接套用到 Narrative、Prompt Resource 或 Setting；
- Provider reasoning signature、encrypted reasoning 等元数据只能留在 Gateway / Provider Adapter。

## 4. AI SDK 的职责边界

### 4.1 计划使用 AI SDK 的部分

在选定并固定具体版本后，AI SDK 用于：

- OpenAI、Anthropic、Google 等官方 Provider adapter；
- OpenAI-compatible 或自定义 Provider adapter 基座；
- 完整响应和 Streaming 的统一调用入口；
- text delta、tool-call delta、usage、finish metadata 和 error 的基础归一；
- Provider-native JSON Function Tool 编码和解析；
- Provider-specific options 透传；
- Abort、timeout 和安全重放边界所需的底层信号；
- 原始 Provider metadata 的受控获取入口。

AI SDK 的准确包名、版本、Provider adapter 组合和 API 名称必须在 Phase 0 联网核对后固定。本计划不根据未验证的最新 API 猜测版本。

### 4.2 不交给 AI SDK 的部分

以下能力仍由 Loom Studio 拥有：

- Prompt Build 与 Context Projection；
- canonical Agent Transcript；
- Tool Registry、发现和权限；
- Tool 参数校验后的最终授权；
- Tool 执行和外部副作用；
- Agent 外层 Loop；
- Run / Step 状态机；
- Suspend / Resume / Branch / Retry；
- MutationCandidate、Changeset 与领域提交；
- Session 持久化和恢复；
- Content Tool dialect；
- Runtime 派生的完成状态。

AI SDK 的类型不得越过 AI Gateway public contract。Application Runtime、Agent Store、RPC 和 Client 不直接依赖 AI SDK message 类型。

### 4.3 为什么不让 SDK 自动持有主 Loop

AI SDK 可以提供多步和停止辅助，但 Loom Studio 的主 Loop 必须在每个关键边界持久化和暂停：

```text
Provider Step 完成
  -> 记录 ProviderObservation
  -> 记录 ToolInvocation
  -> 权限判断
  -> 可能 suspended
  -> 执行 Tool
  -> 记录 ToolResult
  -> 决定是否继续
```

如果把 Tool `execute` 和连续多步全部交给一次 SDK 调用，Permission UI、崩溃恢复、分支、用户 steering 和 Changeset 关联都会变成 SDK callback 内部的临时状态。

第一阶段采用：

> 一次 Gateway / AI SDK 调用只产生一个完整 Provider Step，Agent Runtime 在外层决定是否发起下一次调用。

未来可以为无持久副作用的 ephemeral task 提供 SDK-owned loop，但不能成为 canonical Agent Session 的默认执行路径。

## 5. 目标架构

```text
┌─────────────────────────────────────────────────────────────┐
│ Studio Application / Agent Runtime                          │
│                                                             │
│ Prompt Projection -> Agent Loop -> Tool Registry / Approval │
│                           │                   │              │
│                           │                   └-> Domain API │
│                           v                                  │
│                 Canonical Provider Step                     │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────v─────────────────────────────────┐
│ Platform AI Gateway                                         │
│                                                             │
│ Loom Contract -> AI SDK -> Provider Adapter -> HTTP/SSE      │
│       ^             │                                       │
│       └-- normalized events / usage / raw stop metadata -----┘
└─────────────────────────────────────────────────────────────┘
```

建议新增 Platform package：

```text
packages/ai-gateway/
  contract
  provider registry
  AI SDK adapter
  stream normalization
  provider metadata / error normalization
```

`apps/studio-server` 继续只作为 Composition Root：读取 Secret、注册官方 Provider、创建 Gateway，再注入 `packages/application-runtime`。

Agent Loop 初期仍位于 `packages/application-runtime` 的 Agent 领域切片，不提前新增独立 workflow engine package。

### 5.1 与 Prompt Build 的最小接缝

工具可用性与工具正文投影必须分开：

```text
Agent Profile
  -> 选择本 Agent 可以使用哪些 Tool
  -> 绑定 Permission / Runtime Policy

Resolved Tool Set
  ├─ Native Tool Specs
  │    -> Provider 顶层 tools / custom tool items
  │
  └─ Content Tool Projections
       -> Prompt Build 外部 Runtime Source
       -> tools zone
```

Preset 不保存工具开关，也不复制 Tool Definition。Preset 继续面向 Message、Source、Zone、Slot 和最终排序；Agent Profile 负责工具选择，Tool Runtime 负责注册、解析、权限、执行和结果。

统一开关作用于 `Resolved Tool Set`：

```text
enabled = false
  -> Native / Provider Custom / Content 均不暴露

enabled = true
  -> 根据 Tool 输入合同和 Model Capability 选择 Transport
```

Native Function Tool 与 Responses Custom Tool 位于 Provider request 的 message 平层，不能伪装成 Message Slot。它们进入独立的 Tool Exposure Plan / Trace，由 Gateway 编译为 Provider 顶层 Tool Spec。Provider 是否重排或重编码这些 Tool，由 Provider Adapter 负责记录 diagnostics。

Content Tool 的模型可见说明属于 Prompt Projection，但不是 Preset 内置的静态 Message。它作为外部 Runtime Source 挂载到统一 `tools` zone，并按贡献者拆分 Slot：

```text
tools zone
  official-tools
  extension:<extension-id>-tools
  future contributor slots
```

默认一个 Tool Contributor / Owner 使用一个稳定 Slot。只有不同工具组确实需要独立生命周期、Token Budget 或注意力位置时，才允许同一 Contributor 注册多个具名 Slot，避免所有工具挤进一个巨大 Slot，也避免每个 Tool 都制造一个 Slot。

Agent Profile 可以为 Content Tool Slot 声明期望的注意力位置，例如 `early`、`before-user-context` 或 `tail`。这些要求仍通过 Prompt Build 的统一 Projection Order 编译，不允许 Runtime 在 Prompt Build 完成后直接拼接字符串。

由于不同 Provider 可能合并 System Message、收束为独立 `system` 字段或重新排列工具定义，Trace 必须同时记录：

```text
requestedPlacement
effectivePlacement
normalizationDiagnostics
```

这表达作者的注意力意图，但不承诺所有 Provider 保留完全相同的 Wire Order。

Native Tool 默认不再重复进入 Content Tool Slot，避免模型同时看到顶层 Schema 和第二份正文协议。Tool 可以另外提供可选 `Tool Guidance`，用于说明工作策略、注意事项或推荐用法；只有 Agent Profile 明确启用时，它才作为普通外部 Prompt Source 参与排序。Tool Guidance 不替代正式 Tool Description / Schema。

最小组合输入因此是：

```text
Compiled Prompt Projection
          +
Resolved Tool Set
          +
Model Capability
          ↓
Agent Step Compiler
          ↓
Provider Step Request
```

第一阶段可以使用静态 Compiled Prompt fixture 验证 Tool 注入，不等待 Preset 和 Prompt Build 的完整作者界面设计。后续 Prompt Build 只需正式接收 `tools` zone 的外部 Slot Contribution，不需要接管工具注册或执行。

## 6. Canonical 合同草案

### 6.1 Tool Definition

Raw Text 不作为另一套 Tool Registry，而是 Tool 输入合同的一种：

```ts
type ToolInputDefinition =
  | {
      kind: 'structured'
      schema: JsonSchema
    }
  | {
      kind: 'freeform'
      mediaType: 'text/plain' | 'text/markdown' | 'text/x-diff' | string
      grammar?: ToolGrammar
    }
  | {
      kind: 'hybrid'
      metadataSchema: JsonSchema
      rawField: string
      mediaType: string
      grammar?: ToolGrammar
    }

type AgentToolDefinition = {
  name: string
  owner: ToolOwnerRef
  description: string
  input: ToolInputDefinition
  loadMode?: 'essential' | 'discoverable'
  concurrency?: 'shared' | 'exclusive'
  interruptible?: boolean
}
```

示例：

```text
search_context:    structured
patch_state:       structured
commit_narrative:  hybrid(metadata + raw body)
apply_patch:       freeform(diff)
bash:              structured(command string + cwd + timeout)
codeact:           hybrid(language/options + raw code)
```

### 6.2 Tool Invocation

```ts
type ToolTransport = 'native-function' | 'provider-custom' | 'content'

type ToolInvocation = {
  id: string
  runId: string
  stepId: string
  toolName: string
  transport: ToolTransport
  arguments: Record<string, unknown>
  rawInput?: string
  providerCallId?: string
  providerItemId?: string
  status:
    | 'proposed'
    | 'waiting-approval'
    | 'running'
    | 'completed'
    | 'failed'
    | 'skipped'
}
```

`id` 始终由 Studio 持有。Provider ID 只是可选映射字段，不能成为 Session Tree 主键。

### 6.3 Tool Result

```ts
type ToolResult = {
  invocationId: string
  toolName: string
  status: 'completed' | 'failed' | 'denied' | 'aborted' | 'skipped'
  content: ToolResultPart[]
  detailsRef?: string
  error?: {
    code: string
    message: string
  }
  synthetic?: {
    reason:
      | 'provider-error'
      | 'provider-abort'
      | 'length'
      | 'interrupt'
      | 'orphan-repair'
  }
}
```

ToolResult 是 Runtime Transcript 事实。是否完整投影回模型，由 Runtime Policy 决定。

### 6.4 Provider Observation 与 Runtime Disposition

```ts
type ProviderObservation = {
  providerCallId: string
  provider: string
  model: string
  rawStopReason?: string
  normalizedStopReason?: 'stop' | 'length' | 'tool-call' | 'error' | 'cancelled'
  usage?: ProviderUsage
  rawRef?: string
}

type RuntimeDisposition =
  | 'continue-tools'
  | 'continue-provider'
  | 'waiting-approval'
  | 'suspended'
  | 'completed'
  | 'failed'
  | 'aborted'
```

`rawStopReason: stop` 不代表 `RuntimeDisposition: completed`。Content Scanner 发现 ToolInvocation 后，Runtime 可以派生为 `continue-tools`。

以上类型用于固定语义，不要求第一阶段原样成为数据库表或公共 RPC。

## 7. 三类 Tool Transport

### 7.1 Native Function Tool

适用于：

- 查询；
- 搜索；
- 状态读取；
- JSON Patch；
- 参数较短且结构稳定的领域操作；
- Bash 的命令和控制参数。

```text
AgentToolDefinition
  -> AI SDK / Provider function tool
  -> provider-native tool call
  -> Studio ToolInvocation
  -> role: tool / provider-specific result replay
```

这是默认 Transport，因为它享受 Provider 原生 Schema、Tool Choice、Call ID 和流式 Tool Delta。

### 7.2 Provider Custom / Free-form Tool

适用于支持自由字符串 Tool Item 的 Provider，例如 OpenAI Responses Custom Tool：

```text
ToolDefinition freeform / hybrid
  -> provider custom tool
  -> raw input or grammar-constrained input
  -> Studio ToolInvocation
  -> provider custom tool output
```

官方 OpenAI 文档已确认 Custom Tool 可以接收任意字符串并使用 Lark / Regex Grammar；当前不能据此假设所有 Chat Completions-compatible endpoint 都支持 Custom Tool。

官方参考：<https://developers.openai.com/api/docs/guides/function-calling/#custom-tools>

### 7.3 Assistant Content In-band Tool

适用于：

- Chat Completions 没有 Free-form Tool Item；
- Provider 不支持原生 Tool；
- 特定模型在 Raw Text 下表现明显更好；
- 需要统一兼容自托管或弱兼容 Provider。

初始 dialect 候选使用 XML-like 语法，但它不是通用 XML 文档：

```xml
<loom_tool name="commit_narrative">
  <metadata>{"timelineId":"timeline-1","mode":"append"}</metadata>
  <content>
未经 JSON 字符串编码的正文
  </content>
</loom_tool>
```

结果回灌：

```xml
<loom_tool_result name="commit_narrative" status="completed">
Narrative committed at revision 42.
</loom_tool_result>
```

要求：

- Streaming Scanner 支持半标签和跨 chunk 内容；
- Scanner 创建 Studio Invocation ID；
- 识别后从可展示正文中分离 Tool Block，避免 UI 把协议文本当普通 Markdown；
- Schema / metadata 在执行前再次校验；
- 未闭合、重复、未知 Tool、超长输入和保留结束标签必须产生明确 parse error；
- Tool Result 按 Studio Invocation 映射，Provider 文本 replay 可以按稳定顺序渲染；
- Provider 原始 `stop` 保留，Runtime 单独派生 `continue-tools`。

Content Tool 不是伪造 Provider ToolCall，也不能使用 Chat Completions `role: tool` 回灌没有 Provider ID 的调用。

Content ToolResult 在 Provider Projection 中可以表现为 `role: user`，但 canonical Transcript 中仍然是 ToolResult，并保留 `origin: runtime-tool-result`。UI、审计和分支恢复不得把它展示或解释成用户亲自发送的 Message。

### 7.4 Transport 选择

建议选择顺序：

```text
Tool 需要 freeform / hybrid
  -> Provider 支持 native custom/freeform: provider-custom
  -> 否则模型启用 content dialect: content
  -> 否则退回 structured wrapper（若 Tool 声明允许）

Tool 是 structured
  -> Provider 支持 native function: native-function
  -> 否则 content
```

所有降级必须进入 diagnostics / trace，不能静默改变工具协议。

### 7.5 Tool Result Replay

结果回灌必须依据 ToolInvocation 创建时记录的 Transport，不在执行完成后重新根据当前 Provider 能力猜测：

| Invocation Transport | Provider Replay                                              |
| -------------------- | ------------------------------------------------------------ |
| `native-function`    | Provider 原生 Tool Result / Chat Completions `role: tool`    |
| `provider-custom`    | Responses `custom_tool_call_output` 或对应 Provider 原生结果 |
| `content`            | Runtime 生成的 user-content Tool Result Block                |

Provider Replay 只是下一轮模型输入的投影。canonical ToolResult、Invocation ID、Owner、状态和 provenance 不随 Replay 格式改变。

## 8. Agent Loop 与状态推进

最小 Loop：

```text
start / resume Run
  -> build Context Projection
  -> select Tool Transport Plan
  -> invoke one Provider Step through Gateway
  -> persist ProviderObservation and complete Assistant output
  -> normalize native/custom/content ToolInvocation
  -> validate Tool and arguments
  -> evaluate Permission / Consent
  -> suspend or execute
  -> persist ToolResult / synthetic result
  -> project result for next Provider Step
  -> continue or finish by Runtime Policy
```

停止判断至少考虑：

| 观测                                          | Runtime 行为                                |
| --------------------------------------------- | ------------------------------------------- |
| `stop` 且无 ToolInvocation、无 steering       | `completed` 候选                            |
| `stop` 且 Content Scanner 发现 ToolInvocation | 执行 Tool，继续                             |
| Provider-native `tool-call`                   | 执行 Tool，继续                             |
| `length` 且包含可能截断的 Tool                | 不执行；记录 synthetic skipped result       |
| `error / cancelled / aborted`                 | 终止当前 Provider Step；修复未配对 ToolCall |
| 等待 Permission / User Input                  | `suspended`                                 |
| Tool 失败                                     | 由 Runtime Policy 决定回灌、重试或终止      |
| 超过 max steps / timeout / budget             | `failed` 或 `aborted`，不得继续副作用       |

Gateway 只自动重试“尚未产生任何可见输出且可安全重放”的传输错误。语义重试、Tool 重试和重新生成由 Agent Runtime 创建新的 Step / Attempt。

## 9. Session 持久化与恢复

### 9.1 目标模型

Agent Store 从 Provider wire message store 演进为 append-only Transcript Tree：

```text
AgentSessionHeader
  id
  agentProfileId
  activeBranchId / headStepId
  summary metadata

AgentTranscriptEntry
  id
  parentId
  branchId
  runId
  kind
  payload / payloadRef
  createdAt
```

候选 well-known entry kind：

```text
user-message
assistant-message
provider-observation
tool-invocation
tool-result
runtime-state
mutation
changeset-ref
error
compaction
branch-summary
```

Header 不保存完整 Loop KV。当前恢复状态由 active leaf 到 root 的有效路径和未完成 entry 派生。

### 9.2 持久化边界

- Provider 请求开始时记录 Run / Step 状态和 provider call attempt；
- Streaming delta 默认进入内存事件流和可选受控 artifact，不逐 token 写 canonical Transcript；
- Assistant 完整消息结束后持久化 canonical entry；
- Tool 执行开始前持久化 `tool-invocation: running` 或等价事件；
- Tool 完成、失败、拒绝或中断后必须写 ToolResult；
- Permission 等待必须在返回 UI 前写入 suspend reason；
- 已提交 Mutation / Changeset 不因 Run 后续失败而自动消失；
- 恢复时重新检查 target revision、Permission 和 Tool registration。

### 9.3 当前数据迁移

项目仍处于初期，已批准不兼容旧 Agent Session 数据。`application.agent@3` 直接删除旧 `agent_messages`、`agent_tool_calls` 与 Session 行并建立 canonical Transcript schema，不实现数据转换器、双写或兼容读取。

这是开发期 breaking migration，不代表未来稳定版本可以无条件丢弃用户数据。进入正式数据兼容承诺后，后续 Agent Store migration 必须重新采用显式转换或导出恢复方案。

## 10. Tool Registry、权限和调度

Tool 注册至少需要：

- 稳定 Tool Name / Owner；
- 输入合同；
- execute；
- result content 类型；
- capability / permission 描述；
- approval(args)；
- concurrency；
- interruptible；
- context projection policy；
- optional renderer metadata；
- essential / discoverable load mode。

权限判断基于调用实例，而不只基于 Tool Name：

```text
commit_narrative(timeline A, append)
commit_narrative(timeline B, replace)
```

两次调用可能需要不同 Grant、Revision 校验和用户确认。

多 Tool 默认：

- read-only 可 `shared`；
- canonical write、交互、同一目标 Mutation 默认 `exclusive`；
- 并行 ToolCall 只有在权限、执行和 Replay 顺序都明确后开启；
- Content Tool M1 可以先串行执行，避免用过度并行扩大恢复复杂度。

## 11. Bash 与 CodeAct 的位置

### 11.1 Bash

Bash 默认保持 structured Tool：

```ts
{
  command: string
  cwd?: string
  timeoutMs?: number
  env?: Record<string, string>
  pty?: boolean
}
```

命令正文是字符串，但 cwd、timeout、env、PTY、approval 和 interruptibility 仍需结构化。只有实测证明某些模型在长 Shell Script 中明显受 JSON wrapper 影响时，才增加 freeform transport。

### 11.2 CodeAct

CodeAct 描述“用代码执行行动”，不等于必须把代码写在 Assistant Markdown Code Fence 中。

建议 canonical Tool 使用 hybrid input：

```text
metadata: language / timeout / kernel / permission
rawInput: source code
```

Transport 可以是：

- Responses Custom Tool：raw code；
- Content Tool：`<loom_code_action>`；
- JSON Function fallback：`{ language, code }`。

Persistent Kernel、代码反向调用 Agent Tool、文件系统和网络权限都属于后续 Host / Sandbox 专题。在可靠隔离、Resource Grant 和进程生命周期方案前，本计划不实施真实 Bash 或 CodeAct。

## 12. 实施阶段

### Phase 0：AI SDK Compatibility Spike

目标：在新增正式依赖前验证收益和逃生口。

任务：

1. 联网确认当前 AI SDK 稳定版本及 Node 22 / pnpm 9 支持；
2. 验证 OpenAI、Anthropic、Google、OpenAI-compatible adapter；
3. 验证完整响应、stream、usage、abort 和错误对象；
4. 验证 Provider-specific options 透传；
5. 验证不提供 Tool `execute` 时能否只返回 ToolCall，由 Studio 外层执行；
6. 验证 OpenAI Responses Custom Tool / raw input 是否有正式 adapter 支持；
7. 验证 raw provider metadata、request ID 和 stop reason 获取边界；
8. 记录 SDK 不支持的能力和自定义 adapter 接口。

验证检查点：形成一份最小 spike 结果和固定依赖版本；任一关键能力缺失时，明确由 Gateway adapter 补齐，不向 Application 泄漏 SDK 特例。

实际结果见 [`agent-runtime-ai-sdk-phase-0-spike.md`](../../archive/plans/agent-runtime-ai-sdk-phase-0-spike.md)。主审结论为 Go with guardrails：完整与流式调用均可取得 raw finish reason；Responses Custom replay 会随 Provider `store` 策略选择 `item_reference` 或重发调用项；Chat Completions 不支持 Custom Tool，必须在 Gateway 编译前拒绝或选择 Content Transport。

### Phase 1：Platform AI Gateway 与 AI SDK 接入

目标：替换手写 Provider HTTP，但不改变 Agent 行为。

任务：

1. 新建 `packages/ai-gateway`；
2. 定义不引用 AI SDK 类型的 Gateway public contract；
3. 移入 Provider Profile 解析后的执行逻辑；
4. 接入 AI SDK Provider adapter；
5. Provider Adapter 贡献并校验自己的 options schema，不接受未经验证的任意 options bag；
6. Gateway 只构造不含 `execute` 的 SDK Tool，并拒绝 Application 传入 SDK Tool 实例或多步 stop condition；
7. 保留 Fake Gateway 和确定性测试；
8. Server Composition Root 负责 Secret、Proxy、Provider 注册和注入；
9. 保持现有非流式 Agent Turn 行为通过。

验证检查点：现有 Provider Gateway、Agent Session、Secret、Proxy、日志测试保持通过；SDK 类型不出现在 `application-runtime`、RPC 或 Client public type 中。

实际结果：

- 新增 `packages/ai-gateway`，AI SDK 与 Provider adapter 类型均限制在包内部；
- `application-runtime` 继续持有 Document、Secret、Provider Profile、Model Enablement 与 Proxy，只委托低层执行；
- Phase 1 当时正式路由只替换既有 OpenAI-compatible 非流式调用；OpenAI、Anthropic 与 Google 的 Provider Profile 路由在 Phase 2 Registry 中补齐；
- Gateway 只构造无 `execute` 的 Function Tool，不提供多步 stop condition，并在请求前拒绝重复 Tool 名、未知 Tool Choice 和无 Tool 的强制调用；
- 恢复并验证既有 developer/system 合并、Provider 边界校验、HTTP 与网络错误语义；
- 定向 TypeScript、4 个测试文件 / 21 项测试、Workspace Health、ESLint、公开 `.d.ts` 泄漏检查与 `git diff --check` 均通过。

Phase 1 完成后停止，不自动进入 Streaming、Content Tool、Agent Loop 或持久化状态机阶段。

### Phase 2：统一 Gateway Run / Stream Contract

目标：完整响应和流式共用一套执行合同。

任务：

1. 落地 `GatewayRun { events, result, cancel }`；
2. 规范化 started、text-delta、tool-delta、usage、completed、failed、cancelled；
3. 已有 delta 后禁止无感自动重试；
4. SSE / AsyncIterable 只存在于 Server 内部，RPC 使用 `runId + subscribe + cancel`；
5. raw payload 进入受控 artifact / trace ref，不进入普通 Document。

验证检查点：流和非流结果一致；取消到达 Provider；慢消费者、断连和 Provider 提前关流不会制造重复 completion。

实际结果：

- 落地统一 `GatewayRun { id, events, result, cancel }`；既有 `invokeChat` 只是完整响应兼容封装；
- 完整响应与流式响应共用请求准备、Tool 注册、Provider options、结果归一和取消逻辑；AI SDK 自动重试固定为 `0`，不提供 Tool `execute` 或多步 `stopWhen`；
- 事件覆盖 `started`、`text-delta`、`tool-input-delta`、`usage`、`completed`、`failed`、`cancelled`，一次 Run 只产生一个终态；没有真实 token 数据时不伪造空 usage；
- 新增官方 Provider Adapter Registry，静态支持 OpenAI、Anthropic、Google、OpenAI-compatible 与 Fake；Provider Account/Profile 仍是持久化权威，Registry 负责配置、凭据、Provider kind、能力和模型发现；
- OpenAI 与 OpenAI-compatible 支持 `/models` 发现；Anthropic 与 Google 当前明确返回不支持模型发现，不使用未经验证的伪通用接口；
- Application Runtime 在创建、更新 Profile 和替换凭据时经 Registry 校验并保存规范化结果；Studio Server Composition Root 注入并共享同一个 Registry；
- 定向 TypeScript 与 6 个测试文件 / 35 项测试通过；Workspace Health、ESLint、公开 `.d.ts` 泄漏检查与 `git diff --check` 见本阶段主审记录。

本阶段明确未实现 RPC / Client Streaming、动态插件 Registry、raw chunk artifact、完整 Provider error category / retryable 分类、Content Tool、CodeAct、Agent Store Schema 或 Session Tree。Server 内部事件流暂为保留完整历史的内存广播；在暴露长生命周期 Run 前必须替换为有界缓冲。

Phase 2 完成后停止，不自动进入 Tool Foundation、Agent Loop 或 Prompt Build / Preset 接缝。

### Phase 3：Canonical Transcript 与 Tool Foundation

目标：解除 Agent Store 对 OpenAI Chat Message 的持久化绑定。

任务：

1. 定义 Provider-neutral Transcript Entry；
2. 定义 ToolDefinition、ToolInvocation、ToolResult；
3. 增加 Tool Registry、参数校验、approval 和执行接口；
4. 增加 Agent Profile Tool Selection 与 `Resolved Tool Set`；
5. 提供 `list / resolve / validate / analyze` 只读工具分析接口；
6. Tool Exposure Analysis 返回 exposed、omitted、transport、slot、requested/effective placement 和 diagnostics；
7. Studio ID 与 Provider ID 分离；
8. 设计并批准 Agent Store migration；
9. Provider message 和顶层 Tool Spec 只在 Gateway / Agent Step Compiler 边界生成。

验证检查点：同一 Agent Profile 开关同时控制 Native、Provider Custom 和 Content 暴露；同一 ToolInvocation 可以映射为 Chat Completions Function Tool 和 Responses Tool Item；Agent Store 不再要求所有调用使用 `type: function` wire shape。

批准并采用的实施边界：

- 不兼容初期旧 Agent Session 数据，不实现旧 `agent_messages` / `agent_tool_calls` 转换器或双轨读取；
- canonical Transcript 使用显式判别联合，不扩展 OpenAI `ChatMessage`；
- Tool 使用 namespaced 稳定 ID，Provider 可见名称不作为持久化主键；
- Agent Profile 只保存 `enabledToolIds`，不复制 Tool Schema，也不提前保存 Content Tool Prompt 位置；
- 本阶段定义 Registry 与分析接口，不执行真实 Tool、不实现 approval、Content Parser 或 Agent Loop。

实际结果：

- Agent Store `application.agent@3` 使用 `agent_transcript_entries` 与 `agent_tool_invocations`；Session 改为 `headEntryId / entryCount`；
- Transcript Entry 覆盖 message、provider-observation、tool-invocation、tool-result 与 run-state；Provider transport messages 只在调用边界生成；
- ToolInvocation / ToolResult 以 Studio Invocation ID 配对，跨批拒绝重复 Invocation、未知 Result、Tool ID 不匹配与重复 Result；
- `invokeAgentTurn` 持久化 user message、Provider Observation 与 assistant message；Prompt Build 当前只投影 message Entry；
- 新增静态 Agent Tool Registry，提供 `list / resolve / validateInvocation / analyze`，支持 structured、freeform、hybrid 与 Native / Provider Custom / Content Transport 分析；
- Agent Profile 新增去重后的 `enabledToolIds`；创建和更新时拒绝未注册 Tool；Application RPC 提供工具列表与按 Profile 分析接口；
- Provider Adapter capability 补充 Native Function / Provider Custom Tool 能力事实；当前 Content Transport 标记为未实现，不会被分析接口虚假暴露。
- 完整测试 100 个文件 / 451 项、定向 TypeScript、Workspace Health、ESLint、公开 `.d.ts` 泄漏检查与 `git diff --check` 均通过。

Phase 3 不包含 Tool execute、approval、Provider Tool replay compiler、Content Tool tools-zone Slot、Agent Loop 或恢复状态机。这些从 Phase 4 开始单独推进。

### Phase 4：Native Function Tool Loop

目标：先跑通最成熟、风险最低的 Tool 路径。

任务：

1. Runtime 每次只调用一个 Provider Step；
2. 注册只读测试 Tool；
3. 接收 native ToolCall；
4. 持久化、approval、execute、ToolResult replay；
5. 加入 max steps、timeout、abort 和 Tool error policy；
6. 中断时生成 synthetic ToolResult。

验证检查点：`provider -> tool call -> execute -> result -> provider -> stop` 完整闭环可恢复；Provider 返回错误 finish reason 时仍按 canonical ToolInvocation 判断是否继续。

实际结果：

- Agent Tool Registry 新增可选 Runtime Registration、approval allow/deny、AbortSignal-aware execute 与稳定失败结果；Definition 和运行时 Handler 仍保持分离；
- Agent Profile 的已启用 structured Tool 会按 Provider capability 编译成顶层 Native Function Tool；缺失 Handler、不可用 Transport 与重复 Provider 可见名称在请求前拒绝；
- Runtime 每次只推进一个 Provider Step，Provider ToolCall 先转换并持久化为 Studio Invocation ID，同时保留 Provider call ID 用于本次 Run replay；
- ToolInvocation、ToolResult、ProviderObservation 和 Run State 分边界追加；Tool Result 使用原 Provider call ID 编译成下一 Step 的 `role: tool`，不把 Provider ID 变成持久化主键；
- approval deny、执行抛错、未知 Tool 与取消都会形成明确 ToolResult；取消时先写 `aborted` synthetic Result 和 Run 终态，再向调用方返回 AbortError；
- 多 Tool 当前串行执行；固定最多 8 个 Provider Step、单 Tool 30 秒 timeout，AI SDK 自动重试仍为 `0`；Provider 即使返回 `stop`，只要存在 canonical Invocation 仍继续 Loop；
- 无 Tool 的既有 Agent Turn 也使用同一 Loop，并记录 `running -> completed / failed / aborted`；Provider error / length 且无 Invocation 不会被误判为完成；
- 完整测试 101 个文件 / 456 项、Workspace Health、TypeScript、ESLint 与定向 Native Tool Loop 测试通过。

本阶段的“可恢复”只指关键事实已在每个边界持久化，且同一进程内取消和失败不会留下无 Result 的已执行 Tool。跨进程 Resume、从历史 Transcript 重建 Provider Tool replay、Permission UI suspend 与分支恢复仍未实现，不能据此宣称完整状态机恢复已经完成。

Phase 4 不包含 Responses Custom、Content Tool、tools-zone Slot、CodeAct、Bash、动态 Extension Tool 注册或写入领域 Mutation Tool。

### Phase 5：Responses Custom 与 Content Tool

目标：实现自由正文输入并兼容 Chat Completions。

任务：

1. 接入 Provider Custom Tool adapter；
2. 实现 XML-like Content Tool Prompt Renderer；
3. 实现增量 Scanner；
4. 本地生成 Invocation ID；
5. 实现 Content ToolResult 的 user-content replay；
6. 支持 structured / freeform / hybrid transport selection；
7. 将 Content Tool Description 作为外部 Source 挂载到 `tools` zone；
8. 按 `official-tools` 和 `extension:<id>-tools` 等 Owner Slot 分组；
9. 记录 requested / effective placement 和降级 diagnostics；
10. 保证 Runtime ToolResult 的 user-role replay 不污染用户 Message provenance；
11. 对未知 Tool、未闭合标签、截断、重复调用和保留标签进行错误测试。

验证检查点：同一个 `commit_narrative` Tool 在 Responses Custom、Chat Completions Content 和 JSON fallback 下产生相同 canonical Invocation；官方与 Extension Tool Slot 可以独立启停、排序和卸载；Chat Completions 原始 `stop` 不会误结束 Agent Run。

当前完成状态（2026-08-24）：

- Phase 5 曾使用 `official/test_structured` 与 `official/test_content` 验证 Native JSON 和 Content Transport；完成验证后已从产品内置 Tool 中移除，由定向测试 fixture 继续覆盖协议行为；
- 已实现 `loom-content-v1` 增量 Scanner 与 Result Renderer，覆盖 chunk 边界、普通正文分离、未知 Tool、非法 metadata、重复/未知字段、未闭合协议、长度限制与结果文本转义；
- Agent Loop 会把 Content Block 转换为 Studio Invocation ID 和 canonical `tool-invocation`，并依据 Invocation 而非 Provider 原始 `stop` 决定继续；
- Content ToolResult 在 canonical Transcript 中保持 `tool-result`，Provider replay 使用 Runtime 生成的 `role: user` Content Block，不伪造 Chat Completions `role: tool` 或 Provider Call ID；
- Content Tool 说明已作为外部 Runtime Source 进入统一 Prompt Build 的 `tools` zone，并按 `official-tools`、Extension owner slot 等稳定 Slot 编译；Preset 的 order profile 可以覆盖同名外部 Slot 的默认 rank；
- M1 多 Content Invocation 串行执行；同一 Provider Step 同时出现 Native 与 Content 调用会被拒绝，避免双重派发。
- Tool 描述、参数描述与 guidance 已作为模型可见模板进入独立 Tool Prompt Source；`{{User}}` 宏、现有 Prompt Activation、Provider order 与 Content zone/slot/rank/orderHint 由 Application Runtime 直接编译；
- Native JSON、Provider Custom 候选与 Content Tool 分属两种投影平面：Native / Custom 使用 Provider 顶层 Tool Order，Content 使用 Prompt Message 的 Zone / Slot。Structured Tool 不再错误降级为需要 rawInput 的 Content Transport；
- 宏只作用于 description、parameter description 和 guidance。Tool ID/name、参数键、type、required、enum、grammar、Handler 与 replay identity 保持结构稳定；
- Agent Turn 的普通 Prompt Resource 与 Tool Prompt 现共用同一 User 宏上下文；绑定 Narrative 时从 Timeline 对应 Card 的 `userName` 派生，Agent-only Turn 回退为 `User`。
- Client 现从统一 Tool Registry 加载 Workspace Tool Definition；Preset 通过独立 `preset_tool_mounts` 关系保存挂载、默认开关、Activation、Provider Tool Order 与 Content Zone / Slot / Rank / Order，Agent Profile 只保存按 Tool ID 的 `toolOverrides` 快速覆盖；
- 有效工具集合按 `Preset 已挂载 && (Agent override ?? Preset defaultEnabled) && Activation matched` 编译。未挂载 Tool 不能由 Agent 单独启用；Preset 复制会复制 Mount，但不会复制 Tool Definition；
- Tool Definition 已持久化为版本化 `airp.agentTool` Document。Preset Tools Tab 编辑同一份 Workspace Tool Entry 的 Name、Description、Guidance、Input 与 Parameter Description；内部 Resource ID 保持稳定，修改后 Registry 立即刷新并可在 Runtime 重建后恢复；
- Structured Provider Tool 在 Preset 中显示为 Message 数组之外的 Provider-managed surface；系统只控制顶层 Tool Order，不承诺它位于第一个 System 前或后。Freeform / Hybrid 同时保存 Provider Custom 候选顺序与 Chat Completions Content fallback 的 Zone / Slot；
- Agent-only Turn 完成后，Client 会从 Agent Store 分页回载完整 canonical Transcript，而不是只追加 user / assistant 首尾消息；Message、Provider Observation、Run State、Tool Invocation 与 Tool Result 均可在 Agent 会话中检查；
- 新增一次 Turn 内 `Native Function -> Content Tool -> Final Answer` 的三步集成验证，确认原生 Tool Result 与 Content Tool user-role Result 可以依次 replay，且 Provider 原始 `stop` 不会提前结束 Content 调用。

本切片明确未完成：Responses Custom Tool adapter、Provider Custom Result replay、AI Tool Router Controller、动态 Extension Tool 注册和真实领域写入 Tool。Preset Tool Mount 已成为 Activation 与 Placement 的权威关系；Tool Definition 中同名字段暂保留为新建 Mount 的默认模板，Agent Profile 不拥有 Placement。

已使用 OpenAI-compatible 实际模型人工验证 Native Structured、Content Tool 和多步 Loop；Anthropic、Google、OpenAI Responses Custom 仍未进行真实 Provider 验收。自动化验证继续使用确定性的 Fake Gateway 覆盖持久化、投影与 replay 边界。

### Phase 6：Agent Session Tree 与恢复

目标：让 Loop 可以暂停、重连、分支和恢复。

任务：

1. 落地 Run / Step / Transcript Tree 的最小持久化；
2. Header 只保存 active branch/head 和摘要；
3. 持久化 provider attempt、tool execution start、suspend reason；
4. 恢复时修复 orphan call/result；
5. 重试创建新的 Attempt / Step，不覆盖旧事实；
6. 分支从 selected parent 继续，不复制整棵树；
7. 完整 Mutation / Changeset 关联 source Run / Step。

验证检查点：在 Provider 流中断、Tool 执行前中断、Permission 等待和 ToolResult 后中断四个边界重启 Server，均能得到明确、可继续或可终止的状态。

### Phase 7：首批领域 Tool

目标：用 Loom Studio 自身领域验证工具系统，而不是先做通用 Bash。

建议顺序：

1. `read_context` / `search_context`：只读、structured；
2. `patch_state`：JSON Patch、structured；
3. `commit_narrative`：hybrid metadata + raw body；
4. Prompt Resource / Setting Mutation：等待现有 Resource Grant、Mutation Effect 和 Consent 边界明确后接入；
5. Bash / CodeAct：等待独立 Host / Sandbox 计划批准。

验证检查点：所有 canonical write 通过 owning domain API 和真实 transaction，成功后形成 Changeset；Tool Executor 不直接写 Store 内部表。

## 13. 测试与验收矩阵

最小自动化覆盖：

| 风险              | 必须验证                                                      |
| ----------------- | ------------------------------------------------------------- |
| SDK Provider 差异 | OpenAI、Anthropic、Google、OpenAI-compatible 的最小 fixture   |
| Provider 私有参数 | options 原样到达 adapter，未识别参数有明确诊断                |
| Stream            | delta 顺序、取消、断连、usage、已输出后不自动重试             |
| Native Tool       | Schema、unknown tool、invalid args、tool error、parallel flag |
| Responses Custom  | raw input、grammar、custom output 配对                        |
| Content Tool      | chunk 边界、未闭合标签、正文与 Tool Block 混合、多个调用      |
| Tool Exposure     | Preset Mount、Agent override、Activation、Provider / Content requested/effective placement |
| Loop              | stop、tool-call、length、error、cancelled、max steps          |
| Permission        | allow、deny、prompt、恢复后重新检查                           |
| Persistence       | call/result 配对、synthetic result、orphan repair、branch     |
| Mutation          | Revision conflict、transaction failure、Changeset 来源链      |
| Migration         | 现有 Agent Session Message 数据无丢失转换                     |

人工验收不替代自动检查。UI 对 Streaming、Permission、Tool 执行状态和恢复入口的视觉与交互验收在对应前端阶段单独进行。

## 14. 成本收益判断

### 收益

- 删除手写 Provider SSE 和三家主流协议的重复维护；
- 更快获得 Provider adapter、usage、stream 和原生 Tool 支持；
- 降低 OpenAI-compatible 私有差异污染 Runtime 的概率；
- 可以把工程精力集中在 Loom Studio 独有的 Agent Session、Content Tool、Permission、Mutation 和 Changeset；
- Provider SDK 更新被限制在 Gateway package。

### 代价

- 新增核心依赖和升级成本；
- SDK 的 Message / Tool 类型可能反向侵入 canonical schema；
- SDK 自动 Loop 与 Studio 持久化状态机存在职责冲突；
- Responses Custom Tool 和弱兼容 Provider 仍可能需要手写 adapter；
- Provider-specific 参数透传和 raw metadata 必须逐家验证；
- Agent Store migration 属于高风险数据变更，不能与 SDK 接入一次性混做。

### 结论

AI SDK 的性价比成立，但前提是边界足够窄：

> 用 AI SDK 消灭 Provider 传输重复劳动；用 Studio canonical 层保留 Agent 自由度。

如果 Phase 0 证明 SDK 无法提供 Provider options、单步 ToolCall 返回、Raw metadata 或自定义 adapter 逃生口，则只采用它的部分 Provider adapter，不让其成为唯一 Gateway 实现。

## 15. 明确非目标

本计划不同时实施：

- 固定写作 / 审查 / 总结 workflow；
- 通用 Workflow Engine；
- 任意 RPC 自动暴露为 Tool；
- 所有 Tool 强制改成 Raw Text；
- 所有 Provider 强制使用 Responses API；
- Tool 执行沙箱的安全承诺；
- Bash / CodeAct 的默认启用；
- Multi-Agent orchestration；
- Prompt Builder 重写；
- 将 Provider 顶层 Native Tool 伪装成 Message Slot；
- Narrative Timeline 与 Agent Session 镜像；
- 已提交 Changeset 随 Run discard 自动回滚。

## 16. 实施前需要批准的决策

1. 是否新增 `packages/ai-gateway`，并将 AI SDK 依赖限制在该 package；
2. Phase 0 选定的 AI SDK 精确版本和 Provider adapter 集合；
3. Agent Store 是否在同一里程碑执行 breaking schema migration；
4. Content Tool 初始 dialect 是否采用 XML-like 语法；
5. 第一项 freeform / hybrid 工具是否选择 `commit_narrative`；
6. M1 是否暂时禁止 Content Tool 并行调用；
7. raw Provider payload 的受控 artifact 存储位置；
8. Bash / CodeAct 是否另立 Host / Sandbox 计划，默认不进入本轮实施。

获得批准后，应按 Phase 0 → Phase 1 顺序推进，不在 SDK 接入阶段同时修改 Agent Store 数据模型。
