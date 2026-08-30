# Provider Adapter Contract v0

> **状态**：Open Design
> **主题**：Provider / Gateway 层 contract、model capability、invoke / stream、tool-call 映射、错误和 usage 归一。
> **相关**：[`runtime-boundary-v0.md`](runtime-boundary-v0.md)、[`runtime-turn-flow-v0.md`](runtime-turn-flow-v0.md)、[`../../../archive/discussion/application/loom-core-integration-v0.md`](../../../archive/discussion/application/loom-core-integration-v0.md)、[`../adr/ADR-004-platform-auth-secrets-and-provider-credential-boundary.md`](../../adr/ADR-004-platform-auth-secrets-and-provider-credential-boundary.md)

---

## 1. 背景

现有文档已明确：

```text
Kernel 不内置 Provider Gateway。
Provider Adapter 不理解 Card / Setting / Session / Narrative。
Prompt Builder 输出 compiled prompt payload。
Provider Adapter 负责映射和调用具体 provider。
Secret Store 属于 Platform Security。
```

但还缺一份 Provider 层 contract，导致完整 loop 中这些问题没有落点：

- Runtime 如何选择 provider / model；
- Prompt Builder 如何知道 provider capabilities；
- compiled payload 如何交给 Provider Adapter；
- streaming chunk 如何回到 Runtime / UI；
- provider-native tool-call 如何映射为 Studio ToolCall；
- provider error / usage 如何归一；
- API key / base URL / profile 如何持久化；
- retry / timeout / cancellation 归谁管。

---

## 2. 定位

Provider Adapter 是 Application / Runtime 之外的 IO adapter。

```text
Prompt Builder:
  AIRP sources -> compiled prompt payload

AIRP Runtime:
  chooses provider binding
  calls provider invoke / stream
  handles provider result / tool calls / commit

Provider Adapter:
  compiled prompt payload -> provider request body
  provider response -> normalized provider result
```

Provider Adapter 可以是 ordinary extension。

官方 Provider Adapter 也不进入 Kernel。

---

## 3. 非目标

Provider Adapter 不做：

- 解析 Card；
- 读取 Setting Layer；
- 决定 Narrative Timeline 写入；
- 决定 Agent loop；
- 持有 API key 明文；
- 维护 Session；
- 执行 Prompt Builder；
- 替代 Runtime Policy；
- 定义平台级 `messages[]` schema。

---

## 4. Provider Profile

Provider Profile 是用户配置的 provider 连接信息。

候选内容：

```ts
type ProviderProfile = {
  id: string
  providerKind: string
  displayName: string
  baseUrl?: string
  defaultModelId?: string
  secretRef?: `secret:${string}`
  adapterExtensionId: string
  options?: Record<string, unknown>
}
```

规则：

```text
Provider Profile 可以是 Document。
secretRef 指向 Platform Secret Store。
不得存储 API key 明文。
```

Provider Profile 的 schema 由具体 Provider Adapter 贡献，但 Studio 可以定义最小公共字段。

---

## 5. Model Profile / Capability

Runtime 和 Prompt Builder 需要知道模型能力，但不能依赖 provider-specific request schema。

Provider Adapter 应暴露 model capability。

候选能力：

```text
context-window
max-output-tokens
system-instruction
multiple-system-messages
developer-message
assistant-prefill
message-name
tool-call
parallel-tool-call
json-schema-output
multimodal-input
image-output
cache-control
reasoning-budget
streaming
```

候选结构：

```ts
type ModelCapabilityProfile = {
  providerProfileId: string
  modelId: string
  displayName?: string
  family?: string
  limits?: {
    contextTokens?: number
    maxOutputTokens?: number
  }
  capabilities: Record<string, boolean | string | number>
  diagnostics?: ProviderDiagnostic[]
}
```

Capability 是用于诊断和映射的事实，不是对模型行为的绝对保证。

---

## 6. Provider Binding

Session / Runtime 需要一个 provider binding，表达本次 run 用哪个模型。

候选：

```ts
type ProviderBinding = {
  id: string
  providerProfileId: string
  modelId: string
  adapterRpc: {
    invoke: string
    stream?: string
    listModels?: string
  }
  options?: Record<string, unknown>
}
```

开放问题：

- Provider Binding 属于 Session、Runtime Profile、Agent Profile，还是 Preferences；
- 主 Agent、总结子 Agent、检索子 Agent 是否使用不同 binding；
- Card / Preset 是否只能给 hint，不能硬绑定；
- 用户临时切模型写入哪里。

---

## 7. Invoke Contract

Provider Adapter 的 invoke RPC 不应接受 AIRP documents。

候选输入：

```ts
type ProviderInvokeParams = {
  providerProfileId: string
  modelId: string
  compiledPayload: CompiledPromptPayload
  tools?: ProviderToolSpec[]
  options?: ProviderInvokeOptions
  trace?: {
    correlationId?: string
    runId?: string
    composeTraceId?: string
  }
}
```

候选输出：

```ts
type ProviderInvokeResult = {
  providerCallId: string
  status: 'completed' | 'tool_call' | 'failed'
  output?: ProviderOutputPart[]
  toolCalls?: NormalizedProviderToolCall[]
  usage?: ProviderUsage
  diagnostics?: ProviderDiagnostic[]
  rawRef?: string
}
```

`rawRef` 可以指向受控存储中的 provider raw payload。默认不应把完整 raw response 塞进普通 Document 或 Trace。

---

## 8. Stream Contract

Transport 已预留 stream envelope，但业务层还需要 Provider stream contract。

候选 stream event：

```text
provider.stream.started
provider.stream.delta
provider.stream.tool_call.delta
provider.stream.tool_call.completed
provider.stream.completed
provider.stream.failed
provider.stream.cancelled
```

Runtime 接收 stream 后负责：

- 更新 Runtime Transcript pending entry；
- 向 UI 转发进度；
- 识别 provider-native tool-call；
- 结束时生成 provider_result 或 tool_call entry；
- 处理中止和错误。

Provider Adapter 不直接写 Narrative Timeline。

---

## 9. Tool-call 映射

Provider-native tool-call 与 Studio ToolCall 不同。

Provider Adapter 负责 provider payload 层的转换：

```text
Studio Tool Spec
  -> provider-specific tool schema

provider-native tool-call
  -> NormalizedProviderToolCall
  -> Runtime Transcript ToolCall entry

Studio ToolResult
  -> provider-specific tool result message / content
```

Runtime 负责执行工具和决定 ToolResult 是否进入下一轮 prompt projection。

---

## 10. Error / Usage Normalization

Provider Adapter 应归一常见错误：

```text
auth_error
rate_limited
quota_exceeded
context_length_exceeded
invalid_request
model_not_found
network_error
provider_unavailable
timeout
cancelled
unknown_provider_error
```

候选错误结构：

```ts
type ProviderError = {
  code: string
  message: string
  retryable: boolean
  category: string
  providerStatus?: number
  diagnostics?: ProviderDiagnostic[]
}
```

Usage 候选：

```ts
type ProviderUsage = {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
  costEstimate?: {
    amount: number
    currency: string
  }
}
```

---

## 11. Capability Diagnostics

Composition Skeleton 可以声明 capability requirement。

Provider Adapter 可以提供 validation：

```text
compiled payload + model capability
  -> diagnostics
  -> warn / error / fallback
```

例子：

```text
multiple system zones
  -> OpenAI-compatible: maybe OK
  -> Anthropic: merge into system text
  -> Gemini: map to systemInstruction + contents
```

Fallback 必须进入 diagnostics / trace，不能静默改写。

---

## 12. Security Boundary

Provider Adapter 使用 Secret Store，不存储明文。

```text
Profile:
  secretRef

Platform Security:
  decrypt / withSecret / future fetchWithSecret

Provider Adapter:
  call provider with controlled secret use
```

详见 ADR-004。

Provider Adapter 还需要声明：

- network access scope；
- secret use capability；
- document read/write scope；
- provider profile document type；
- audit facts。

---

## 13. M0 候选

M0 只需要：

```text
Provider Profile:
  OpenAI-compatible baseUrl + secretRef + default model

RPC:
  listModels
  invoke

No streaming first:
  可以先同步 invoke，streaming 作为下一步

Capabilities:
  context window, system instruction, tool-call, streaming support

Errors:
  auth, rate limit, context length, network, unknown

Usage:
  input / output / total tokens
```

暂缓：

- 完整 Anthropic / Gemini mapping；
- provider-managed cache-control；
- multimodal；
- native JSON schema output；
- cost accounting；
- platform-managed `fetchWithSecret`；
- parallel tool calls；
- cross-provider fallback。

---

## 14. Discussion Capture: OpenAI-style Default / Provider Extension Mapping (2026-05-31)

### 14.1 默认作者心智采用 OpenAI-style

为了降低用户、预设作者和 UI 的心智负担，Studio Application 可以默认采用 OpenAI-style messages 心智来组织第一版 compiled payload。

这意味着：

```text
Prompt Builder / Preset UI:
  可以把 system / user / assistant / tool-like message 作为默认解释模型。

Provider Adapter:
  再把这个 messages-like payload 映射到具体 provider。
```

但这只是 Application / UX 默认，不是 Kernel contract。

### 14.2 Provider Extension 承担格式差异

不同渠道商有自己的 request shape、role 语义、参数和新增能力。

Provider Extension 负责：

- request body mapping；
- provider-specific options；
- model capability declaration；
- new parameter exposure；
- response normalization；
- usage / error normalization；
- provider-native tool-call mapping。

例子：

```text
某 provider 新增 reasoning 参数:
  Provider Extension 更新 profile/options schema。
  Provider Extension 声明 capability。
  Runtime / UI 可以发现并配置。
  Prompt Builder 不需要理解该 provider 的私有字段。
```

### 14.3 官方默认 Provider Family

官方默认渠道可以优先覆盖：

```text
OpenAI-compatible
Anthropic-compatible
Gemini-compatible
```

这些 adapter 作为官方 Provider Extension / package 提供，而不是 Kernel 内置能力。

