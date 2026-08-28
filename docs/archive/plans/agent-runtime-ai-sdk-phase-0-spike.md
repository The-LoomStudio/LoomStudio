# Agent Runtime 与 AI SDK Phase 0 Compatibility Spike

> 日期：2026-08-23  
> 状态：Archived / Complete；Phase 0 与后续 Phase 1 已完成。既定结论：**Go with Gateway wrapper**  
> 当前路线：[`docs/workbench/plans/agent-runtime-ai-sdk-foundation-plan.md`](../../workbench/plans/agent-runtime-ai-sdk-foundation-plan.md)

## 1. 结论先行

当前稳定版 Vercel AI SDK 可以作为 LoomStudio Platform AI Gateway 的内部依赖，但不能成为 LoomStudio 的 Agent、Tool、Prompt 或 Session 权威。

本次可执行 probe 证明，AI SDK 适合直接承担 Provider 基础执行层：

- Node 22 可以安装并运行 `ai@7.0.77`；仓库要求的 pnpm 9.15.0 可以完成临时依赖安装。
- OpenAI、Anthropic、Google 和 OpenAI-compatible Provider 都能通过同一个 `generateText` / `streamText` 入口调用，并支持自定义 `fetch`。
- JSON Function Tool 的定义、`toolChoice`、流式 Tool Delta、无 `execute` 时只返回 Tool Call，以及原生 Tool Result replay 均可用。
- OpenAI Responses 的 Custom Tool / Free-form Tool 已由当前 `@ai-sdk/openai` 正式支持，能够发送 `type: "custom"` 并接收原始字符串输入。
- AI SDK 提供 `customProvider` 和 V4 `LanguageModel` 接口，可以补齐没有官方 Provider 或需要自定义 Wire Format 的场景。
- 一次 SDK 调用可以被限制为一个 Provider Step；但若显式配置多步停止条件，SDK 会自动执行 Tool 并继续请求，必须由 Gateway 固定边界。

同时也确认了不能直接依赖的边界：

- OpenAI Chat Completions 不承载 Responses Custom Tool。把 `openai.tools.customTool(...)` 传给 `openai.chat(...)` 时，SDK 发出 `tools: []` 并给出“不支持 provider tool”的 warning。Chat Completions 的 Content Tool 仍必须由 LoomStudio 自己注入、扫描和 replay。
- SDK 的 `finishReason` 是归一值；完整调用和流式调用都可以取得 `rawFinishReason`。Gateway 仍需同时保存两者，不能只保存 SDK 的归一值。
- `generateText` / `streamText` 默认只推进一个 Step；显式 `stopWhen: stepCountIs(2)` 后会自动执行工具并发起第二次 Provider 请求。SDK 的多步能力不能成为持久化 Agent Session 的默认 Loop。
- Abort 的错误形态不统一：完整调用抛出 `AbortError`，流式调用发出 `abort` 事件，结果 Promise 可能以调用方传入的 reason 字符串 reject。Gateway 必须归一化。

因此 Phase 1 可以进入实现准备，但实施前应固定以下硬边界：AI SDK 只在 Gateway 内部；公开合同不暴露 AI SDK 类型；默认一次调用只推进一个 Provider Step；Content Tool 是 LoomStudio 的自有 Transport；Provider options、raw metadata、request id 和 raw stop reason 进入 Gateway trace / observation，不进入 Studio canonical contract 的 Provider 特例。

## 2. 精确环境与依赖版本

仓库基线：`/Users/macbookair/Desktop/LoomStudio`。

| 项目               | 实际值                             | 证据                                           |
| ------------------ | ---------------------------------- | ---------------------------------------------- |
| Node               | `v22.18.0`                         | `node --version`                               |
| 仓库声明 pnpm      | `9.15.0`                           | `package.json` 的 `packageManager` / `engines` |
| 实际 probe pnpm    | `9.15.0`                           | `corepack pnpm@9.15.0 --version`               |
| AI SDK             | `ai@7.0.77`                        | npm registry `latest`；临时目录安装            |
| OpenAI             | `@ai-sdk/openai@4.0.46`            | 临时目录 lock/install                          |
| Anthropic          | `@ai-sdk/anthropic@4.0.41`         | 临时目录 lock/install                          |
| Google             | `@ai-sdk/google@4.0.50`            | 临时目录 lock/install                          |
| OpenAI-compatible  | `@ai-sdk/openai-compatible@3.0.35` | 临时目录 lock/install                          |
| Provider contract  | `@ai-sdk/provider@4.0.7`           | transitive dependency                          |
| Provider utilities | `@ai-sdk/provider-utils@5.0.29`    | transitive dependency                          |
| Zod                | `zod@4.1.8`                        | 临时目录显式安装；满足 `ai@7.0.77` peer range  |

执行过的安装验证：

```sh
SPIKE_DIR="$(mktemp -d)"
SPIKE_CACHE="$(mktemp -d)"
npm_config_cache="$SPIKE_CACHE" \
  corepack pnpm@9.15.0 --dir "$SPIKE_DIR" add \
  --config.strict-peer-dependencies=false \
  ai@7.0.77 \
  @ai-sdk/openai@4.0.46 \
  @ai-sdk/anthropic@4.0.41 \
  @ai-sdk/google@4.0.50 \
  @ai-sdk/openai-compatible@3.0.35 \
  zod@4.1.8
```

结果：安装成功，未改动 LoomStudio 的 `package.json` 或 `pnpm-lock.yaml`。所有 probe 使用 `mktemp -d` 隔离目录、stub `fetch` 和伪造响应，没有真实 API Key，也没有真实模型请求。

根目录未找到实际的 `AGENTS.md` 文件；本任务遵守了线程中提供的同等指令，以及主计划中的 Phase 0 范围约束。

## 3. Probe 结果

### P0：Node 22 / pnpm 9 / 稳定版本

最小命令：

```sh
node --version
corepack pnpm@9.15.0 --version
pnpm view ai@latest version engines peerDependencies --json
```

实际结果：`Node v22.18.0`、`pnpm 9.15.0`、`ai@7.0.77`，package engines 为 `node >=22`。临时安装和导入运行成功。

覆盖边界：这证明当前环境与当前包版本兼容，不证明未来 `latest` 仍然保持相同 API；生产接入必须 exact pin 并通过 lockfile review。

### P1：完整响应、usage、finish metadata、request id

最小调用形态：

```ts
const result = await generateText({
  model: openai.chat('gpt-4o-mini'),
  prompt: 'say hello',
  maxRetries: 0,
})
```

stub 返回 Chat Completions 响应，捕获到：

```text
POST https://stub.test/v1/chat/completions
result.text       = "hello"
result.finishReason = "stop"
result.rawFinishReason = "stop"
result.usage      = { inputTokens: 7, outputTokens: 3, totalTokens: 10 }
result.response.id = "chatcmpl_stub_1"
result.response.headers["x-request-id"] = "req_stub_1"
result.providerMetadata = { openai: {} }
```

AI SDK 会把 Provider token 字段归一为 `inputTokens` / `outputTokens` / `totalTokens`，同时保留 `usage.raw` 的 Provider usage（流式 Step 结果中观察到）。完整结果的 `response` 暴露 id、model、headers 和编译后的 assistant messages，但本次官方 Provider probe 没有在完整结果上暴露完整原始 HTTP body。

覆盖边界：`response.headers` 可用于 request id，完整结果直接提供 `rawFinishReason`；raw response body 仍需要由自定义 fetch / Gateway trace 自己捕获，不能假定 `result.response` 永远包含原始 body。

### P2：Streaming 事件、usage、finish metadata 和 Tool Delta

最小调用形态：

```ts
const result = streamText({
  model: openai.chat('gpt-4o-mini'),
  prompt: 'hello',
  maxRetries: 0,
})

for await (const part of result.fullStream) {
  // collect part
}
```

普通文本 probe 实际事件为：

```text
start
start-step
text-start
text-delta("hel")
text-delta("lo")
text-end
finish-step { finishReason: "stop", rawFinishReason: "stop", usage }
finish { finishReason: "stop", rawFinishReason: "stop", totalUsage }
```

工具流式 probe 实际事件为：

```text
tool-input-start { id: "call_s", toolName: "write_raw" }
tool-input-delta { id: "call_s", delta: "{..." }
tool-input-delta { id: "call_s", delta: "...}" }
tool-input-end { id: "call_s" }
tool-call { toolCallId: "call_s", input: parsedObject }
finish-step { finishReason: "tool-calls", rawFinishReason: "tool_calls" }
finish { finishReason: "tool-calls", rawFinishReason: "tool_calls" }
```

设置 `includeRawChunks: true` 后，`fullStream` 还会产生 `raw` 事件，包含 stub 返回的原始 Provider chunk。Provider 返回未被 SDK 识别的 `vendor_stop` 时，实际得到 `finishReason: "other"`、`rawFinishReason: "vendor_stop"`。

结论：Gateway 可以直接采用事件流，但必须同时保存 normalized finish reason 与 raw finish reason。原始 chunk 不应进入普通 Transcript，适合进入受控 trace / artifact。

### P3：Abort

stub fetch 等待 `AbortSignal`，调用方在 20–25ms 后执行：

```ts
const controller = new AbortController()
setTimeout(() => controller.abort('studio-stop'), 25)
```

实际结果：

| 调用                        | 实际行为                                                                                                                    |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `generateText`              | fetch 收到 abort；调用抛出 `AbortError`                                                                                     |
| `streamText` / `fullStream` | fetch 收到 abort；stream 产生 `{ type: 'abort', reason: 'studio-stop' }`；`result.text` 可能以字符串 `"studio-stop"` reject |

结论：AbortSignal 逃生口可用，但 Gateway 需要把 SDK error、stream abort event 和 reason 归一成自己的 `cancelled / aborted` observation。不能直接把 SDK 异常类型暴露给 Application。

### P4：Tool 不提供 execute 时只返回 Tool Call

定义：

```ts
const writeText = tool({
  description: 'write text',
  inputSchema: z.object({
    path: z.string(),
    content: z.string(),
  }),
  // intentionally no execute
})
```

stub 返回原生 `tool_calls` 后，`generateText` 的实际结果：

```text
result.toolCalls = [{
  toolCallId: "call_abc",
  toolName: "write_text",
  input: { path: "a.txt", content: "raw\ntext" }
}]
result.toolResults = []
result.finishReason = "tool-calls"
```

没有执行本地副作用。AI SDK 文档明确说明 `execute` 可选，适用于把 Tool Call 转发到客户端或队列；probe 与文档一致。

这正是 LoomStudio 所需的外层执行模式：Gateway 只解析并返回 canonical candidate，Permission、Mutation、Application API 和持久化由 Studio 决定。

### P5：JSON Function Tool 的 request shape、tool choice 和 result replay

定义结构化 Tool 并指定 Tool Choice：

```ts
tools: { write_text: writeText },
toolChoice: { type: 'tool', toolName: 'write_text' },
```

捕获到的 Chat Completions 请求：

```json
{
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "write_text",
        "description": "write text",
        "parameters": {
          "type": "object",
          "properties": {
            "path": { "type": "string" },
            "content": { "type": "string" }
          },
          "required": ["path", "content"],
          "additionalProperties": false
        }
      }
    }
  ],
  "tool_choice": {
    "type": "function",
    "function": { "name": "write_text" }
  }
}
```

把 canonical assistant Tool Call 和 Tool Result 作为下一次 `generateText` 的 `messages` 输入，捕获到：

```json
{
  "role": "assistant",
  "tool_calls": [{
    "id": "call_abc",
    "type": "function",
    "function": {
      "name": "write_text",
      "arguments": "{\"path\":\"a.txt\",\"content\":\"raw\\ntext\"}"
    }
  ]
}
{
  "role": "tool",
  "tool_call_id": "call_abc",
  "content": "ok"
}
```

结论：AI SDK 可以承担 Provider wire replay，但 LoomStudio 仍应先持有自己的 `ToolInvocation` / `ToolResult`，只在 Gateway 边界投影成上述格式。

### P6：OpenAI、Anthropic、Google、OpenAI-compatible adapter

四种 Provider 均用自定义 `fetch` 完成无网络真实请求的最小 `generateText` 调用：

| Adapter           | 模型对象           | stub endpoint                      | 实际请求形状           |
| ----------------- | ------------------ | ---------------------------------- | ---------------------- |
| OpenAI Chat       | `openai.chat('m')` | `/openai/chat/completions`         | Chat Completions       |
| Anthropic         | `anthropic('m')`   | `/anthropic/messages`              | Anthropic Messages     |
| Google            | `google('m')`      | `/google/models/m:generateContent` | Gemini generateContent |
| OpenAI-compatible | `compatible('m')`  | `/compatible/chat/completions`     | OpenAI-compatible Chat |

四者都成功返回 `text: "ok"`，并暴露标准化 `finishReason: "stop"`。Provider 实例的 `provider` / `modelId` 可记录在 Gateway observation 中。

自定义 fetch 在四个 Provider 上均可用；Provider 设置还支持自定义 base URL、headers 和 fetch。OpenAI-compatible package 另提供 request body transform 能力，适合代理厂商的非标准字段，但该 transform 必须留在 Gateway adapter 内。

### P7：Provider-specific options、metadata 和 canonical 隔离

OpenAI Responses probe：

```ts
providerOptions: {
  openai: {
    store: false,
    reasoningEffort: 'low',
    promptCacheKey: 'cache-x',
    user: 'user-x',
    metadata: { studio: 'yes' },
  },
}
```

捕获请求中实际映射为：

```json
{
  "metadata": { "studio": "yes" },
  "store": false,
  "user": "user-x",
  "prompt_cache_key": "cache-x",
  "reasoning": { "effort": "low", "summary": "detailed" }
}
```

Anthropic `thinking` 和 Google `thinkingConfig` 也分别被映射到各自原生请求字段。也就是说，SDK 支持 Provider-specific options，但它们不是无条件的任意字段透传：Provider 会做校验、映射和 warning；例如不适配模型的 OpenAI `serviceTier` 会被 warning 并省略。

结论：Studio public canonical contract 不接受未经验证的任意 options bag。Provider Adapter 应贡献并校验自己的 options schema，Gateway 只接收校验后的命名空间数据；`serviceTier`、`thinkingConfig` 等字段不提升为公共 Agent 类型。Provider options 的最终请求 body 和 warning 留在 Gateway trace。

### P8：Responses Custom / Free-form Tool

当前 `@ai-sdk/openai@4.0.46` 提供：

```ts
const raw = openai.tools.customTool({
  description: 'raw writer',
  format: { type: 'text' },
})

generateText({
  model: openai.responses('gpt-5.6-luna'),
  tools: { write_raw: raw },
  toolChoice: { type: 'tool', toolName: 'write_raw' },
  prompt: 'write raw',
})
```

捕获到的请求：

```json
{
  "url": "https://stub.test/v1/responses",
  "tools": [
    {
      "type": "custom",
      "name": "write_raw",
      "description": "raw writer",
      "format": { "type": "text" }
    }
  ],
  "tool_choice": { "type": "custom", "name": "write_raw" }
}
```

stub 返回：

```json
{
  "type": "custom_tool_call",
  "id": "ctc_1",
  "call_id": "call_custom_1",
  "name": "write_raw",
  "input": "line 1\nline 2 { }"
}
```

AI SDK 解析为：

```text
toolCallId = "call_custom_1"
toolName   = "write_raw"
input      = "line 1\nline 2 { }"
providerMetadata.openai.itemId = "ctc_1"
finishReason = "tool-calls"
```

在默认存储策略下，把结果回放到下一次 Responses 请求时，AI SDK 生成：

```json
{
  "type": "item_reference",
  "id": "ctc_1"
}
{
  "type": "custom_tool_call_output",
  "call_id": "call_custom_1",
  "output": "written"
}
```

当显式使用 `providerOptions.openai.store: false` 时，SDK 不生成 `item_reference`，而是重发原始调用项后再追加结果：

```json
{
  "type": "custom_tool_call",
  "id": "ctc_1",
  "call_id": "call_custom_1",
  "name": "write_raw",
  "input": "line 1\nline 2 { }"
}
{
  "type": "custom_tool_call_output",
  "call_id": "call_custom_1",
  "output": "written"
}
```

结论：Responses Custom Tool 当前由 AI SDK 正式支持，足以作为 Gateway 的 Provider Custom adapter；`item_reference` 只是 Provider 存储策略下的 wire 优化，不是 canonical 配对事实。Studio 必须同时保存自己的 Invocation ID、Provider Call ID 和可选 Provider Item ID。它也不会替 LoomStudio 解决 Chat Completions Content Tool。

### P9：Chat Completions 对 Custom Tool 的限制

把同一个 `openai.tools.customTool(...)` 传给 `openai.chat('m')`，实际请求为：

```json
{
  "tools": [],
  "tool_choice": "auto"
}
```

同时收到 SDK warning：`The feature "tool type: provider" is not supported.`

因此：

- OpenAI Responses Custom 是 Provider-native Custom Tool；
- OpenAI Chat Completions 仍只能使用 Function Tool；
- Content Tool 必须作为 LoomStudio 自己的 Message Projection / `tools zone` Source，由 Scanner 转成 canonical Invocation；
- 不能因为 AI SDK 暴露统一 `tools` 参数，就假设它会把任意 Tool 类型转换为 Chat Completions 可用的 wire format。

官方 OpenAI 文档把 Custom Tool 定义为自由文本输入/输出，并以 Responses API 的 `custom_tool_call` / `custom_tool_call_output` 为例；当前包行为与这一边界一致：

- <https://developers.openai.com/api/docs/guides/function-calling/#custom-tools>
- <https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling>

### P10：customProvider / 自定义 Language Model 逃生口

使用 AI SDK 的 `customProvider` 注册一个最小 V4 `LanguageModel`，只实现 `doGenerate`，接收到：

```text
options.prompt          = 标准化 Model Prompt
options.providerOptions = { "studio.custom": { "flag": "x" } }
```

并返回：

```ts
{
  content: [{ type: 'text', text: 'custom-ok' }],
  finishReason: { unified: 'stop', raw: 'vendor_stop' },
  usage: { ...raw vendor usage... },
  response: { id: 'custom-id', headers: { 'x-request-id': 'custom-request' } },
  providerMetadata: { 'studio.custom': { raw: 'yes' } },
}
```

外层 `generateText` 成功得到标准 `text`、usage、response 和 providerMetadata。

结论：如果某个 Provider 的 Content Tool、非标准 Chat API 或 Responses 变体不能由官方 adapter 承担，可以编写 Gateway-private V4 adapter；AI SDK 的 escape hatch 足够，但实现完整 `doGenerate` / `doStream`、prompt conversion、tool parsing、raw metadata 和 replay 仍是 LoomStudio 的工作量。不能把 `customProvider` 误解为“自动获得任意 Wire Format 支持”。

### P11：多步 / 自动 execute 与单步 Provider Step

用一个带 `execute` 的 `ping` Tool，stub 第一次返回 Tool Call，第二次返回普通文本：

```ts
generateText({
  model,
  tools: { ping },
  stopWhen: stepCountIs(2),
})
```

实际发出两次 Provider 请求：第二次的 messages 自动包含：

```json
{
  "role": "assistant",
  "tool_calls": [/* call_1 */]
}
{
  "role": "tool",
  "tool_call_id": "call_1",
  "content": "{\"pong\":\"x\"}"
}
```

没有显式 `stopWhen` 时，`generateText` / `streamText` 的默认 stop condition 是一步；带 `execute` 时第一步仍会执行 Tool，但不会自动发起第二次调用。带 `execute` 且不提供 `stopWhen` 的结果为一个 Step、`finishReason: "tool-calls"`、有 `toolResults`。

结论：LoomStudio 可以把一个 SDK 调用限定为一个 Provider Step，方案有两种：

1. 默认不提供 `execute`，只接收 Tool Call；或
2. 提供 execute 以复用 SDK 的参数校验 / 事件，但强制 `stopWhen: stepCountIs(1)`。

推荐第一种。Studio 外层在权限、持久化和领域边界完成后再执行 Tool，并创建下一次 Gateway Step。不能把 SDK 的 Tool Loop 当成 Session Loop。

## 4. 支持矩阵

| 能力                               | 当前结果                      | LoomStudio 处理                                                         |
| ---------------------------------- | ----------------------------- | ----------------------------------------------------------------------- |
| Node 22 / pnpm 9                   | Pass                          | 可作为 Phase 1 依赖基线，exact pin                                      |
| 完整响应 / text / usage            | Pass                          | Gateway 归一后采用                                                      |
| Streaming text / tool delta        | Pass                          | 采用事件，但拥有自己的 Gateway event contract                           |
| AbortSignal                        | Pass with normalization       | Gateway 统一 cancelled / aborted / reason                               |
| 无 execute 只返回 Tool Call        | Pass                          | 默认采用，外层执行                                                      |
| JSON Function Tool                 | Pass                          | 采用 Provider-native adapter                                            |
| Tool Choice                        | Pass                          | Gateway 只生成受控 subset，记录诊断                                     |
| Chat Function Tool Result replay   | Pass                          | Provider adapter 投影，canonical transcript 不绑定 wire                 |
| OpenAI Responses Custom Tool       | Pass                          | OpenAI Responses adapter 直接采用                                       |
| Chat Completions Custom Tool       | No                            | 保持 Studio Content Tool / XML Scanner                                  |
| Anthropic adapter                  | Pass                          | Gateway 内部采用；保留 raw metadata                                     |
| Google adapter                     | Pass                          | Gateway 内部采用；保留 provider-specific options                        |
| OpenAI-compatible adapter          | Pass                          | 适合现有兼容 Provider；必要时使用 body transform                        |
| 自定义 fetch / headers / base URL  | Pass                          | Gateway 注入网络策略和 trace                                            |
| customProvider / V4 Language Model | Pass                          | 作为非标准 Provider 逃生口，仍需自己实现 adapter                        |
| Provider-specific options          | Pass with provider validation | Adapter schema 校验后的 namespace，不污染 canonical                     |
| request id                         | Partial / Pass                | `response.headers` 和 provider response id 可取；统一纳入 observation   |
| raw stop reason                    | Pass                          | complete / streaming 都有 `rawFinishReason`；raw body 仍需 Gateway 捕获 |
| raw provider HTTP body             | Partial                       | 自定义 fetch / raw stream capture；不能只依赖 result.response           |
| 多步自动 execute                   | Pass                          | 不作为 Studio 默认 Loop；固定 single-step                               |
| CodeAct / Content Tool parser      | No built-in                   | Studio 自己实现 Content Tool / CodeAct Transport                        |

## 5. 对主计划 Phase 1 的建议修改

Phase 1 可以保留，但应增加以下实施约束：

1. **精确 pin 版本。** 首次接入固定 `ai@7.0.77`、`@ai-sdk/openai@4.0.46`、`@ai-sdk/anthropic@4.0.41`、`@ai-sdk/google@4.0.50`、`@ai-sdk/openai-compatible@3.0.35`，并在实施时重新确认 registry 是否发生安全或兼容性更新。不得使用宽松 caret 让 Gateway 行为随安装时间漂移。Probe 临时安装的 `zod@4.1.8` 不是生产建议；仓库已有 exact-pinned `zod@4.4.3`，满足接入时应复用现有依赖而非降级。
2. **Gateway public contract 不引用 AI SDK 类型。** Provider Step 结果至少保留 normalized text/tool delta、usage、normalized finish reason、raw finish reason、response id、request id、provider metadata ref、warnings 和 cancellation outcome。
3. **默认单步。** Gateway adapter 只从 Studio Tool Definition 构造不含 `execute` 的 SDK Tool，public contract 不接受 SDK Tool 实例或 execute callback；同时拒绝 Application 传入多步 stop condition。`stepCountIs(1)` 只能作为额外保险，不能作为副作用边界。主 Loop 在 Tool Result 持久化后显式创建下一次 Provider Step。
4. **Provider options 双层保存。** Provider Adapter 贡献并校验自己的 options schema，Gateway 只接收校验后的命名空间数据；Gateway trace 保存实际映射后的 request fields、warning 和省略字段。不能把未经验证的 opaque bag 或 provider-specific options 合并进 Tool、Prompt 或 Session canonical schema。
5. **raw observation 不丢。** 对完整请求和流式请求，在 Gateway 自己捕获 request headers、response headers、request id、response id、raw stop reason 和必要的 raw chunk ref；AI SDK 结果对象只能作为其中一个来源。
6. **Responses Custom 与 Content Tool 分开。** Responses Custom 直接走 Provider adapter；Chat Completions Content Tool 不走 AI SDK `tools` 参数，而由 Agent Step Compiler 生成 `tools zone` 的外部 Source、Scanner 和 canonical Invocation。
7. **Tool Result replay 依据 Invocation transport。** 不在执行完成后重新猜测格式：native function、Responses custom、Content user replay 分别使用各自 adapter；canonical ToolResult 统一保存 provenance。
8. **Fake Gateway 先行。** Phase 1 测试继续使用 deterministic custom fetch / custom LanguageModel，不发送真实模型请求；真实 Provider smoke test 不属于本 Spike，也不应阻塞 Gateway contract 测试。

## 6. 风险与未知项

- `ai@7.0.77` 是本次日期通过 registry 查询到的稳定版；AI SDK 主版本和 Provider package 版本演进较快，必须锁定并通过定向升级 probe。
- 本次只做 stub HTTP，不验证真实 Provider 对 grammar、模型能力、工具并行、限流、SSE 中途断连和真实 token 计费的行为。
- Responses Custom Tool 的可用性依赖 Provider、模型和 Responses endpoint；不能推广到所有 OpenAI-compatible endpoint。
- AI SDK 的 Provider metadata 类型是可扩展的，但不同 Provider 的 raw 字段完整度不同；没有统一保证“完整 raw response body 永远可得”。
- `execute` 可选并不等于 AI SDK 完成了 Studio 的权限、事务、恢复和副作用幂等；这些仍必须由 LoomStudio 持有。
- `customProvider` 是 adapter escape hatch，不是自动协议转换器；Content Tool scanner、XML dialect、CodeAct parser 和 Provider-specific replay 仍需 Gateway / Agent Runtime 设计。
- 真实 AI SDK 依赖引入后需要确认 bundle、CJS/ESM 边界、Server runtime、日志脱敏、Secret 注入和现有 build/test pipeline；本次未修改生产依赖，因此未验证这些集成风险。

## 7. 主智能体复审

主审在独立临时目录中重新安装 `ai@7.0.77`、`@ai-sdk/openai@4.0.46` 和 `zod@4.1.8`，使用另一份 stub `fetch` 脚本复跑了三个决定性路径，没有读取 API Key 或发送真实 Provider 请求。

复审确认：

- Native Function Tool 在没有 `execute` 时会发送标准 Function Schema，返回 ToolCall，`toolResults` 为空；
- 完整调用同时给出 `finishReason: "tool-calls"` 与 `rawFinishReason: "tool_calls"`；
- Responses Custom Tool 的请求、自由字符串输入、Provider Item ID 和 Result replay 均可用；
- `store: true` / 默认策略使用 `item_reference`，`store: false` 重发 `custom_tool_call`，两者都用 `call_id` 关联 output；
- Chat Completions 会把 Custom Tool 省略为 `tools: []`，warning 的结构化值是 `{ type: "unsupported", feature: "tool type: provider" }`，不会自动降级成 Function Tool。

主审接受子智能体的总体 Go 结论，但修正三项实施边界：完整调用可以直接取得 raw finish reason；`item_reference` 不是固定 replay 合同；Provider options 必须先经过 Adapter schema 校验。Phase 1 还应在编译前拒绝不受支持的 Tool Transport，不能依赖 SDK warning 后继续发出空 Tool 列表。

## 8. Go / No-Go

**Phase 0 对进入 Phase 1 的判断：Go with guardrails。**

理由是核心收益已经被 probe 证明：Provider adapter、流式基础事件、usage、abort、原生 JSON Tool、外置 Tool 执行、Responses Custom Tool、自定义 fetch 和自定义 Language Model 都可用；同时最关键的自由格式缺口也已被明确隔离为 LoomStudio 自己的 Content Tool Transport，而不是继续寻找一个不存在的 Chat Completions Custom Tool 兼容层。

进入 Phase 1 的前提不是马上改代码，而是实施前批准并固定：

```text
AI SDK 只在 Platform AI Gateway 内部
一次调用只推进一个 Provider Step
Tool execute 默认留给 Studio 外层
Provider options / raw metadata 通过 Gateway observation 隔离
Responses Custom 与 Chat Content Tool 分成两条 Transport
```

本报告完成后停止在 Phase 0，不自动实施 Phase 1。

## 9. 仓库改动文件

本阶段实际新增：

```text
docs/workbench/plans/agent-runtime-ai-sdk-phase-0-spike.md
```

主审更新：

```text
docs/workbench/plans/agent-runtime-ai-sdk-foundation-plan.md
docs/workbench/plans/README.md
```

修改只包含 Phase 0 状态、复审事实、计划索引和 Phase 1 护栏。没有修改生产代码、`package.json`、`pnpm-lock.yaml`、数据库或现有测试。

实验目录均由 `mktemp -d` 创建，未写入仓库；没有真实模型请求或真实 API Key。

## 10. 参考文档

- Vercel AI SDK Tools and Tool Calling：<https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling>
- Vercel AI SDK Providers and Models：<https://ai-sdk.dev/v7/docs/foundations/providers-and-models>
- OpenAI Function Calling / Custom Tools：<https://developers.openai.com/api/docs/guides/function-calling/#custom-tools>
