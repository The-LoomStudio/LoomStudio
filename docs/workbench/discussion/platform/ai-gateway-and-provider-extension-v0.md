# AI Gateway and Provider Extension v0

> **状态**：Open Design
> **主题**：平台级 AI Gateway、Provider Extension、Model Profile、统一配置面板、网络收发与密钥边界。
> **相关**：[`provider-adapter-contract-v0.md`](../application/provider-adapter-contract-v0.md)、[`runtime-turn-flow-v0.md`](../application/runtime-turn-flow-v0.md)、[`composition-skeleton-and-preset-v0.md`](../application/prompt/composition-skeleton-and-preset-v0.md)、[`ADR-004`](../../adr/ADR-004-platform-auth-secrets-and-provider-credential-boundary.md)、[`docs/architecture/extensions/`](../../../architecture/extensions/)

---

## 1. 背景

Studio AIRP Runtime 从 fake provider 走向真实模型调用时，需要一层稳定的 Provider / Gateway 基建。

这层能力不应只是 Application Runtime 的内部小组件，因为它会被多个方向复用：

```text
AIRP Agent:
  chat completion

作者工具:
  测试 prompt、生成 opening、生成设定

素材工具:
  image generation / image edit

总结器 / 检索器:
  chat completion / embedding

第三方插件:
  统一复用平台模型配置和密钥系统
```

因此本文件把它暂定为：

```text
Platform AI Gateway
```

Application Runtime 是它的消费者，而不是它的所有者。

---

## 2. 核心判断

### 2.1 内部 canonical request 只保留最小消息模型

Loom Studio 内部对 chat completion 的最小标准采用 OpenAI-style messages：

```ts
type CanonicalChatRequest = {
  messages: CanonicalMessage[]
  metadata?: GatewayRequestMetadata
}

type CanonicalMessage = {
  role: "system" | "user" | "assistant" | "tool"
  content: string
}
```

这里的 "OpenAI-style" 只表示统一的 `messages[]` 结构，不表示把 OpenAI 的全部参数变成内部标准。

内部 canonical request 不承载：

```text
temperature
top_p
presence_penalty
frequency_penalty
reasoning_effort
thinking_budget
provider-native cache control
provider-native response format
```

这些参数属于 Model Profile / Provider Extension 配置，不属于 Prompt Builder。

### 2.2 Preset 不负责模型选择

Preset / Composition Skeleton 只负责：

```text
source set
zone / slot
prompt order
macro / binding
message projection
```

Preset 不负责：

```text
modelRef
provider
api key
baseUrl
temperature
thinking level
```

日常使用中可以有一个更高层的运行配置把 Preset 和 Model Profile 绑定起来，但这个绑定不是 Preset 自身的一部分。

候选对象：

```ts
type AgentRuntimeProfile = {
  id: string
  name: string
  presetId: string
  modelProfileId: string
  purpose: "narrative" | "agent-work" | "summary" | string
}
```

### 2.3 一个模型调用单元绑定一个 Provider Extension

不采用 SillyTavern 式的“预设绑定模型提供商”。

Loom Studio 的可调用模型单元应该是：

```text
Model Profile = Provider Account + providerModelId + capability + provider-specific config
```

这样可以支持：

```text
同一个 provider 提供多个模型；
同一个模型配置多套参数；
同一个模型使用多个 key；
同一个 provider extension 支持 chat / embedding / image generation 等多种能力；
不同插件统一复用平台模型配置。
```

### 2.4 Provider Extension 注册配置，不自己造配置面板

Provider Extension 不应默认自己构建 UI 面板。

它注册配置 schema，平台用统一配置面板渲染：

```ts
type ProviderConfigField = {
  key: string
  label: string
  type: "string" | "number" | "boolean" | "select" | "secret" | "json"
  scope: "account" | "model"
  required?: boolean
  defaultValue?: unknown
  options?: Array<{ label: string; value: string }>
  description?: string
}
```

Provider Extension 负责声明：

```text
我需要哪些 account-level 配置；
我需要哪些 model-level 配置；
哪些字段是 secret；
这些字段如何被映射进 provider-native payload。
```

平台负责：

```text
统一渲染配置 UI；
统一保存配置 Document；
统一保存或引用密钥；
统一做 redaction；
统一给插件和 Runtime 暴露可选择的 Model Profile。
```

### 2.5 网络收发归 Gateway，格式转换归 Extension

Provider Extension 不应默认直接 `fetch`。

建议边界：

```text
Provider Extension:
  canonical request -> provider http request
  provider response -> canonical response
  provider stream chunk -> canonical stream event
  provider error -> canonical provider error

AI Gateway:
  resolve model profile
  resolve secret
  call extension adapter
  send HTTP / SSE
  timeout / retry / cancellation
  request / response logging
  redaction
  usage accounting
  trace correlation
```

这可以避免每个 Provider Extension 都重复实现 SSE、AbortController、超时、日志、错误分类和密钥处理。

未来可以给特殊场景保留受控 transport：

```ts
type ProviderTransportKind = "http" | "sse" | "websocket" | "local" | "custom"
```

M0 / M1 只建议支持 `http`，流式可在之后用 `sse` 统一收敛。

---

## 3. 核心对象草案

### 3.1 Provider Extension

Provider Extension 是插件或内建 provider 包注册的能力定义。

```ts
type ProviderExtension = {
  id: string
  displayName: string
  version: string
  capabilities: AICapabilityId[]
  transports: ProviderTransportKind[]
  configSchema: ProviderConfigField[]
  adapters: {
    buildRequest: string
    parseResponse: string
    parseStreamChunk?: string
    parseError?: string
  }
}
```

`adapters` 可以是 extension host 中注册的 RPC / function id。Manifest 负责静态声明，runtime registration 才是真实能力。

### 3.2 AI Capability

AI Gateway 不应只为 LLM chat 设计，但平台也不应预制一大组能力并替插件适配所有参数。

更准确的方向是：

```text
Capability 是 Extension 注册的开放标识。
平台负责保存、索引、筛选、调用路由、密钥边界和审计。
Capability 的参数 schema / payload adapter / response parser 由 Extension 注册。
```

候选结构：

```ts
type AICapabilityId = string

type RegisteredAICapability = {
  id: AICapabilityId
  displayName: string
  ownerExtensionId: string
  inputSchema?: string
  outputSchema?: string
}
```

官方可以注册一些 well-known capability 作为约定，例如：

```text
chat.completion
image.generation
text.embedding
```

但它们只是默认生态约定，不代表平台只支持这些能力，也不代表平台要提前实现这些能力的全部参数。

示例 capability id：

```text
chat.completion
plugin.novelai.image.generation
plugin.local-diffusion.image.generation
plugin.voice.speech-to-text
```

上面的列表只作为例子，不作为封闭枚举。当前 Application Runtime M0 只消费 `chat.completion`。生态目标是允许 NovelAI、Diffusion、本地模型、语音服务、embedding provider 等能力通过 Extension 注册复用同一套账号、模型配置、密钥和调用基础设施。

### 3.3 Provider Account

Provider Account 表示某个 provider extension 下的一组账号级连接配置。

```ts
type ProviderAccount = {
  id: string
  providerExtensionId: string
  displayName: string
  config: Record<string, unknown>
  secretRefs: Record<string, SecretRef | PlainSecretRefForDev>
  createdAt: string
  updatedAt: string
}
```

示例：

```json
{
  "id": "provider-account-openai-main",
  "providerExtensionId": "official.openai-compatible",
  "displayName": "OpenAI Main",
  "config": {
    "baseUrl": "https://api.openai.com/v1"
  },
  "secretRefs": {
    "apiKey": "secret:openai-main"
  }
}
```

开发期可以允许：

```text
plain:sk-...
env:OPENAI_API_KEY
```

但数据模型仍应把 secret 引用和普通配置分开，避免 key 泄漏进 Run、Prompt、Trace 或普通 Document。

### 3.4 Model Profile

Model Profile 是用户和 Runtime 真正选择的调用单元。

```ts
type ModelProfile = {
  id: string
  providerAccountId: string
  capability: AICapabilityId
  displayName: string
  providerModelId: string
  config: Record<string, unknown>
  createdAt: string
  updatedAt: string
}
```

示例：

```json
{
  "id": "model-profile-gpt-4o-mini-rp",
  "providerAccountId": "provider-account-openai-main",
  "capability": "chat.completion",
  "displayName": "GPT-4o Mini / RP",
  "providerModelId": "gpt-4o-mini",
  "config": {
    "temperature": 0.8,
    "maxTokens": 1200
  }
}
```

`temperature` 在这里是 provider extension schema 注册出来的 model-level config，不是 Prompt Builder canonical schema 的字段。

插件 UI 不应自己保存 API profile。它应向平台查询可用 ModelProfile：

```ts
type ListModelProfilesParams = {
  capability?: string
  providerExtensionId?: string
}
```

例如生图插件只需要：

```text
listModelProfiles({ capability: "plugin.novelai.image.generation" })
```

然后把用户选择的 `modelProfileId` 保存进它自己的 Agent Profile / Extension Profile 中。插件不需要再造一套 API key、base URL、模型参数保存系统。

### 3.5 Gateway Request / Response

Application Runtime 交给 AI Gateway 的请求保持克制：

```ts
type GatewayInvokeParams = {
  modelProfileId: string
  capability: "chat.completion"
  input: CanonicalChatRequest
  trace?: {
    sessionId?: string
    runId?: string
    composeTraceId?: string
    purpose?: "narrative" | "agent-work" | "summary" | "test" | string
  }
}
```

返回值：

```ts
type GatewayChatResult = {
  text: string
  finishReason?: "stop" | "length" | "tool_call" | "error"
  usage?: {
    inputTokens?: number
    outputTokens?: number
  }
  providerCallId: string
  diagnostics?: ProviderDiagnostic[]
  rawRef?: string
}
```

`rawRef` 指向受控 raw payload 存储。默认不把完整 raw request / response 放进普通 Document。

生态版 Gateway 不应只保留 chat-specific result。更长期的方向是 capability-scoped invoke：

```ts
type GatewayInvokeParams = {
  modelProfileId: string
  capability: string
  input: unknown
  trace?: GatewayTraceMetadata
}

type GatewayInvokeResult = {
  capability: string
  output: unknown
  providerCallId: string
  diagnostics?: ProviderDiagnostic[]
  rawRef?: string
}
```

对于 `chat.completion`，`input` 可以是 OpenAI-style messages。对于生图、embedding、语音等能力，`input / output` 的结构由 capability owner 注册的 schema 决定。

M0 代码里保留 `invokeChat()` 是为了验证简单卡闭环；生态版 Gateway 应逐步收束到 capability-scoped invoke contract。

---

## 4. 调用流程

```text
1. Application Runtime 收到玩家输入。
2. Prompt Builder 读取 Card / Session / Setting Layer / Narrative Timeline。
3. Prompt Builder 生成 canonical messages。
4. Runtime 选择 AgentRuntimeProfile 或直接选择 ModelProfile。
5. Runtime 调用 AI Gateway。
6. Gateway 读取 ModelProfile。
7. Gateway 读取 ProviderAccount。
8. Gateway 找到 ProviderExtension。
9. Gateway 解析 secretRef。
10. Extension buildRequest。
11. Gateway 执行 HTTP / SSE。
12. Extension parseResponse。
13. Gateway 返回 normalized result。
14. Runtime 生成 CommitCandidate。
15. Runtime 决定是否写入 Narrative Timeline。
```

Provider Extension 不读取 AIRP documents，不决定 NarrativeEntry 写入，不参与 commit policy。

---

## 5. 与 Extension 系统的关系

Provider Extension 可以是 ordinary extension，但它的能力注册需要走平台统一贡献点。

Manifest 可以静态声明：

```json
{
  "roles": ["provider"],
  "contributes": {
    "aiProviders": [
      {
        "id": "official.openai-compatible",
        "displayName": "OpenAI Compatible",
        "capabilities": ["chat.completion"],
        "transports": ["http"]
      }
    ]
  }
}
```

运行时仍以 dynamic registration 为准：

```text
Manifest declaration is contract.
Runtime registration is truth.
```

Provider Extension 不应要求插件自己提供完整配置 UI。它可以贡献字段 schema、说明、校验规则和 payload adapter。平台统一渲染 Provider Account / Model Profile 面板。

---

## 6. 场景校验：生图插件 / 子 Agent / 能力复用

### 6.1 场景

一个文生图插件作者希望实现 NovelAI 生图能力。

它有自己的产品需求：

```text
1. 它不并入主 Agent。
2. 它有自己的 Agent / SubAgent。
3. 它有自己的 preset / tag builder。
4. 它需要读取共同上下文，例如 Narrative Timeline、Setting Layer、当前 Session / Branch。
5. 它需要调用平台上已有的模型配置，例如 NovelAI image model profile。
6. 它的能力还可能暴露给其他 UI，例如证件照生成、背景图生成、角色立绘生成。
```

### 6.2 设计判断

这个场景验证了 AI Gateway 必须是平台能力，而不是主 AIRP Runtime 的内部工具。

插件作者不应：

```text
自己保存 API key；
自己保存 baseUrl；
自己重新实现 provider profile；
自己绕过平台网络、日志、密钥和错误边界；
自己扫描 Narrative Timeline / Setting Layer。
```

插件作者应该：

```text
1. 注册自己的 capability，例如 plugin.novelai.image.generation。
2. 注册 provider/config schema 和 payload adapter。
3. 在自己的面板中调用 listModelProfiles({ capability })。
4. 将用户选择的 modelProfileId 保存进自己的 Agent Profile / Extension Profile。
5. 调用平台 Runtime Context Projection 获取共享上下文。
6. 用自己的 preset / tag builder 构造 capability input。
7. 调用 AI Gateway。
8. 将结果作为 ArtifactCandidate / CommitCandidate 进入受控写入路径。
```

### 6.3 子 Agent 与共享上下文

子 Agent 不应直接读取整个 workspace。

它应请求受控上下文投影：

```ts
type RuntimeContextProjectionRequest = {
  sessionId: string
  branchId?: string
  purpose: string
  include: Array<
    | "narrativeTimeline"
    | "activeSettingLayer"
    | "currentUserInput"
    | "sessionState"
  >
}
```

生图子 Agent 可以读取：

```text
当前剧情路径；
当前激活的 setting layer；
用户当前需求；
插件自己的 preset / tag rules。
```

但它不应默认获得：

```text
所有 Card；
所有 Session；
所有 Provider secret；
所有未选中的 global sources；
未授权的插件数据。
```

### 6.4 能力对外暴露

插件不仅可以自己调用 Gateway，也可以把能力注册给其他 UI / 作者工具复用。

例如：

```text
plugin.novelai.generatePortrait
plugin.novelai.generateBackground
plugin.novelai.generateSceneIllustration
```

这些能力不应该要求调用方理解 NovelAI 的所有 provider 参数。调用方只传任务需求和可选上下文，插件负责构造 capability input，Gateway 负责模型调用。

### 6.5 结论

当前设计方向成功之处：

```text
ModelProfile 与 AgentRuntimeProfile 分离；
Preset 不保存 provider 参数；
ProviderAccount / ModelProfile 属于平台共享配置；
AI Gateway 可以被主 Agent、子 Agent、插件 UI、作者工具共同复用。
```

当前仍缺的设计面：

```text
Capability Registry；
Provider Extension runtime registration；
capability-scoped Gateway invoke；
Runtime Context Projection API；
SubAgent / Extension Agent 注册；
ArtifactCandidate / Asset commit path。
```

这些缺口应先进入文档和 POC，不应在 M0 代码里提前预制所有 capability 类型。

---

## 7. 密钥边界

延续 ADR-004：

```text
Secret storage / encryption / redaction:
  Platform Security 负责。

Provider-specific payload behavior:
  Provider Extension 负责。
```

Provider Account / Model Profile 文档不得保存真实 API key 明文。

开发期可临时支持：

```ts
type PlainSecretRefForDev = `plain:${string}`
```

但要求：

```text
不得进入 trace detail；
不得进入 frontend 普通响应；
不得进入 provider raw payload 普通展示；
日志必须 redacted；
后续可平滑迁移到 secret store。
```

---

## 8. M0 建议

为了把简单卡 runtime loop 跑通，M0 建议只实现：

```text
1. fake provider extension
2. openai-compatible provider extension
3. ProviderAccount document
4. ModelProfile document
5. non-streaming chat.completion
6. config schema driven provider/profile storage
7. dev-only plain/env secret ref
8. Gateway request / response debug artifact
```

M0 暂缓：

```text
streaming
tool-call
image generation
embedding
custom transport
复杂 secret store
model listing
provider marketplace
provider-owned UI panel
```

对于当前 Application Runtime，M0 接入点可以是：

```text
fake provider:
  保留测试闭环。

openai-compatible:
  让简单卡可以真实回复。

submitTurn:
  Prompt Builder 生成 messages 后调用 Gateway。
```

---

## 9. 开放问题

1. `AgentRuntimeProfile` 应属于 Workspace、Card 默认配置、Session override，还是三者都有？
2. Model Profile 是否需要 capability-specific 子类型，例如 ChatModelProfile / ImageModelProfile？
3. Provider raw payload 的存储是 Trace Artifact、Run Artifact，还是单独受控表？
4. M0 是否先允许 `plain:` secret，还是只允许 `env:`？
5. Provider Extension 的 adapter 是 extension RPC、host function，还是 package-level registration？
6. Model listing 是否由 Provider Extension 提供，还是只靠用户手填 providerModelId？
7. Streaming 的 canonical event schema 何时进入设计？
