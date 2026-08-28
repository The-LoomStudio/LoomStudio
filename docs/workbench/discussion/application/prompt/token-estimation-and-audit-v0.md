# Prompt Token 估算与审计 v0

> **状态**：Open Design / Research Capture
> **主题**：Message、Prompt Resource、Setting Entry、Tool Schema 与最终 Provider Payload 的 Token 估算、缓存、持久化和审计边界。
> **证据快照**：LoomStudio `7e69867978b1543e0ddea51ecc22b5cb542ab9d7`、oh-my-pi `37eee71978951fccf66b21f7e3e2b74596ac9d74`、PulsarAI `45c7ddaa5069f8dce3cdb62e8e77b6ab041870a4`。

---

## 1. 当前判断

Token 数不应成为 Message、Setting Entry 或 Prompt Resource 的固有持久属性。

更准确的模型是：

```text
Source content
  -> Activation / Resolution
  -> binding / variable / macro expansion
  -> render / role framing / Tool Schema
  -> Provider payload serialization
  -> Provider usage
```

同一份源内容在不同模型、Tokenizer、Provider Adapter、变量快照、Activation 结果和序列化规则下会得到不同 Token 数。因此：

```text
resource.tokenCount = 123
message.tokenCount = 456
```

都容易形成失效但看似精确的派生状态。

当前建议区分三类测量：

| 名称 | 测量对象 | 用途 | 权威程度 |
|---|---|---|---|
| Raw Token Estimate | 未展开的资源或 Message 内容 | 编辑器容量提示、粗略比较 | 低，只是便利信息 |
| Resolved Token Estimate | 本轮 PromptBuild 展开后的 Contribution / Payload | 预算、裁剪、Dry Run、Trace | 中，依赖测量基准 |
| Provider Usage | Provider 实际处理的完整请求与输出 | 计费、运行审计、历史锚点 | 高，但通常只能得到整次请求总量 |

一句话：

> 资源编辑器显示 Raw Estimate，PromptBuild 计算 Resolved Estimate，正式运行持久化 Provider Usage；不要给源对象永久挂一个 Token 数。

---

## 2. 为什么单条 Message Token 不是稳定事实

单条 Message 的实际成本不仅由正文决定，还可能受到以下因素影响：

- 模型与 Tokenizer；
- Provider 的 Chat Template、role 包装和特殊控制 Token；
- Tool Definition / Tool Schema；
- 图片、多模态和 Provider 自定义计费；
- reasoning、签名和加密 replay payload；
- Provider Adapter 的序列化、兼容转换和默认字段；
- 历史裁剪、摘要、Tool Result pruning 与消息重写；
- Prefix cache、cache read 和 cache write 规则。

Provider 返回的 input usage 通常也是整个请求的总量，而不是每条 Message 的独立账单。即使本地对每条 Message 分别 tokenize，相加结果也可能缺少：

```text
message envelope
role separator
request-level system framing
tool schema framing
provider-specific overhead
```

因此 per-message Token 更适合作为可失效的估算缓存，而不是 canonical data。

---

## 3. oh-my-pi：Provider 实际值锚点 + 动态尾部估算

### 3.1 已实现事实

oh-my-pi 没有给每条 Message 持久化一个独立 `tokenCount`。它采用混合策略：

```text
当前 Context Estimate
  = 最近一次成功 Assistant 请求的 Provider prompt usage
  + 该锚点之后新增 Message 的本地估算
  + 当前 non-message 内容相对锚点的变化量
```

Assistant Message 会持久化 Provider usage，并可携带 `contextSnapshot`：

```ts
interface ContextSnapshot {
  promptTokens: number
  nonMessageTokens: number
  historyRewriteTokensRemoved?: number
  lastMessageTimestamp?: number
}
```

其中：

- `promptTokens` 是 Provider 报告的完整 prompt / input usage；
- `nonMessageTokens` 是请求发送时 System Prompt、Tool Schema、Skill 等非消息内容的本地估算；
- 后续消息和运行时变化继续动态估算；
- 本地历史重写可以记录从锚点中移除的估算量；
- 没有可用 Provider 锚点时，退回为全量本地估算。

证据：

- oh-my-pi `packages/ai/src/types.ts:884-906`；
- `packages/coding-agent/src/session/agent-session.ts:2353-2365`；
- `packages/coding-agent/src/session/session-stats.ts:150-231`。

### 3.2 Message 估算缓存

oh-my-pi 的 Message Token 估算保存在进程内 `WeakMap`，不写进 Message：

- 非 Assistant Message append 后视为稳定，可按对象身份缓存；
- streaming Assistant 不缓存，避免冻结流式中间值；
- Assistant 只有在 usage 和终止状态稳定后才允许缓存；
- prune、shake、strip image 等原地重写必须显式失效缓存。

这说明 Token Estimate 被明确视为可重建派生值，而不是 Message 事实。

证据：oh-my-pi `packages/agent/src/compaction/message-cache.ts:1-104`。

### 3.3 非消息内容

oh-my-pi 把以下内容归为 non-message Token：

```text
System Prompt
System Context / Context Files
Tool name / description / schema
Skill name / description
```

这些内容从当前已组装的运行时输入动态计算。由于它们通常只在 turn 边界变化，系统按 System Prompt、Tool 和 Skill 数组引用做进程内 memoization；输入引用变化后重新计算。

证据：oh-my-pi `packages/coding-agent/src/modes/utils/context-usage.ts:45-198`。

### 3.4 Tokenizer 边界

oh-my-pi 默认快速路径使用 UTF-8 byte length / 4 估算；可选准确模式委托 native Tokenizer。准确模式仍只是所选 encoding 的本地 Tokenizer，不等于所有 Provider 的第一方计费实现。

因此它仍然区分：

```text
preflight estimate
provider-reported usage
```

证据：oh-my-pi `packages/agent/src/tokenizer.ts:1-25`、`docs/natives-text-search-pipeline.md:235-251`。

### 3.5 哪些 Token 数会持久化

oh-my-pi 会持久化：

- Assistant Provider usage；
- Assistant `contextSnapshot`；
- Compaction 的 `tokensBefore`；
- 与实际请求、计费和压缩事件相关的历史统计。

它不会持久化：

- 每条普通 Message 的本地估算缓存；
- 每个 Context File、Skill 或 Tool Schema 的永久 Token 字段；
- 与模型和当前展开环境无关的“资源固定 Token 数”。

`tokensBefore` 值得持久化，是因为它描述一次已经发生的压缩事件，而不是声称源 Message 永远具有这个 Token 数。

---

## 4. PulsarAI：只在压缩记忆 Artifact 保存粗略测量

PulsarAI 当前没有完整的 Message / Prompt Token 审计系统。

它在不可变压缩记忆 Segment 中持久化：

```ts
sourceTokenCount: number
compressedTokenCount: number
```

但当前实现只是：

```ts
Math.max(1, Math.ceil(value.length / 3))
```

这些数字用于比较摘要前后的大致容量，不是特定模型的精确 Tokenizer 结果。普通 Conversation Message、Plugin Prompt Resource 和最终 Provider Payload 没有同等级别的持久化 Token Trace。

证据：PulsarAI `src/features/Resources/Conversation/application/conversation-memory.ts:62-88`、`:619-635`、`:834-836`。

PulsarAI 的 `generatePath` 还可以动态决定：

- 读取哪些 Plugin Resource；
- 是否执行宏、变量和 imports；
- 是否调用 memory compression；
- 如何组装最终 messages；
- 是否采用默认 Agent。

这进一步说明 Plugin Resource 的 Token 数只能在具体生成流程解析之后测量，不能作为资源树节点的稳定字段。

---

## 5. LoomStudio 当前事实

### 5.1 已有 Provider usage 事实

当前 `GatewayChatResult` 已包含：

```ts
usage?: {
  inputTokens?: number
  outputTokens?: number
}
```

Agent Tool Loop 会把它写入 canonical transcript 的 `provider-observation`。因此 Loom 已经具备“正式运行持久化 Provider usage”的基础，不需要另建一份 Message Token 账本。

证据：

- `packages/application-runtime/src/types.ts:575-591`；
- `packages/application-runtime/src/agent/tool-loop.ts:756-776`。

### 5.2 已有 PromptBuild Dry Run 表面

`PreviewAgentTurnResult` 已返回：

- compiled messages；
- Prompt projection；
- PromptBuild trace；
- Tool exposure 与 Tool PromptBuild trace；
- 可选 Provider payload preview。

这正是 Resolved Token Estimate 最合适的计算位置。Token 预算不需要回写 Prompt Resource 或 Setting Store。

证据：LoomStudio `packages/application-runtime/src/types.ts:440-455`。

### 5.3 当前缺口

当前尚未形成正式实现的包括：

- model/tokenizer-aware Token Counter；
- PromptBuild Contribution 级 Token breakdown；
- Provider framing / Tool Schema overhead；
- token budget、裁剪策略和诊断；
- estimated usage 与 Provider actual usage 的差值记录；
- cache read / cache write / total usage 的统一合同。

这些是开放设计，不应把历史 Workbench 中的 Tokenizer、`BudgetByTokens` 或 Token Extension 提案描述成当前实现。

---

## 6. 建议的测量时机

| 场景 | 建议行为 | 是否持久化 |
|---|---|---|
| 打开 Message / Setting / Prompt Resource 编辑器 | 使用当前选择或默认 Tokenizer 计算 Raw Estimate | 否；按 content digest + tokenizer ID 缓存即可 |
| 编辑内容 | debounce 后重新估算 | 否 |
| PromptBuild Preview / Dry Run | 在 Activation、Resolution、binding、变量和 render 后计算 Contribution breakdown | 默认不单独落表；随 Preview 返回 |
| Budget / trimming | 使用本轮 Resolved Estimate | 作为 Trace annotation，而不是源对象字段 |
| 正式 Provider 调用前 | 计算最终 Payload Estimate，预防超窗 | 可以随 Run / PromptBuild Trace 保存 |
| Provider 调用后 | 保存实际 input/output/cache usage | 是，属于 Provider Observation |
| Compaction / Summary | 保存压缩前后估算、来源范围和 digest | 是，属于派生 Artifact 的历史事实 |

打开资源时显示的 Token 数必须带清楚的限定，例如：

```text
原始估算：约 412 tokens · o200k_base
```

不能显示成没有基准的：

```text
Tokens: 412
```

---

## 7. PromptBuild Token Trace 候选

当前不建议先新增通用 Token 数据表。最小方向是在现有 PromptBuild Trace 上增加派生测量：

```ts
type PromptTokenTrace = {
  basis: {
    modelId?: string
    tokenizerId: string
    tokenizerVersion?: string
    serializerVersion?: string
    kind: 'estimate' | 'provider'
  }

  payloadDigest: string
  estimatedInputTokens: number

  contributions: Array<{
    contributionId: string
    sourceRevisionId?: string
    resolvedDigest: string
    estimatedTokens: number
  }>

  unattributedOverheadTokens: number
}
```

这只是讨论候选，不是已批准 Schema。

`unattributedOverheadTokens` 必须存在。原因是 Provider role framing、Tool Schema wrapper 和 request-level control tokens 未必能准确归属某个 Source Contribution。不要为了让 breakdown 看起来完整而伪造精确归属。

如果未来确实需要跨 Run 长期查询测量结果，应把它保存为关联 `runId / buildId + payloadDigest` 的 measurement artifact，而不是把 `tokenCount` 写回 Resource、Node、Setting Entry 或 Message。

---

## 8. Tokenizer 与 Provider 的责任边界

建议边界：

```text
Prompt Builder:
  负责提供 resolved contributions 与 provider-neutral compiled payload。

Token Counter:
  对明确的 tokenizer / model basis 提供估算。

Provider Adapter:
  负责 provider-specific payload serialization。

Provider:
  返回实际 usage；这是运行和计费事实。
```

本地 Token Counter 不能冒充 Provider：

- Provider 可能不公开第一方 Tokenizer；
- Chat Template 可能在服务端添加内容；
- Tool 与多模态 Token 规则可能不透明；
- cache usage 与 context occupancy 不是同一个指标；
- Provider usage 只能在请求完成后获得，不能取代 preflight estimate。

因此预算判断需要 Estimate，运行审计需要 Actual Usage，两者都不能删除。

---

## 9. Trace 与 UI 最小表达

Prompt Preview 可以显示：

```text
Estimated input: 18,420 / 32,768

System / Skeleton       1,120
Setting contributions   4,860
Narrative projection    6,340
Agent transcript        4,210
Tool schemas             980
Unattributed overhead    910
```

点击 Contribution 后应能继续回答：

- 来源 Resource / Node / Revision；
- Raw Estimate；
- 是否 active；
- 变量和 binding 是否展开；
- Resolved Estimate；
- 是否被裁剪；
- 最终进入哪个 Zone / Slot / Provider Message。

正式运行结束后可以额外显示：

```text
Estimated input: 18,420
Provider input:  18,917
Difference:         497
```

这个差值是校准信号，不应自动回写各 Source 的 Token 数。

---

## 10. 候选不变量

1. Source canonical data 不保存无基准的 `tokenCount`。
2. 每个 Estimate 必须声明 tokenizer/model/serializer basis，或明确标记为 heuristic。
3. Activation、变量和 binding 展开前的 Raw Estimate 不参与正式 Prompt budget 决策。
4. Prompt budget 使用本轮 Resolved Estimate；Provider usage 用于事后审计和历史锚点。
5. Provider usage 与本地 Estimate 不互相覆盖。
6. Message / Resource 修改后，相关估算缓存必须按 revision 或 digest 失效。
7. Contribution breakdown 允许存在不可归属 overhead。
8. 图片、Tool Schema、reasoning 和 opaque provider payload 必须有显式估算策略或未知诊断。
9. Compaction Token 记录必须绑定来源范围、digest 和测量基准。
10. Trace 保存测量结果时，不重复保存可以从同一不可变 Build Artifact 无歧义重建的大段内容。

---

## 11. 明确不做

- 不给所有 Message、Setting Entry 和 Prompt Resource 增加永久 `tokenCount` 字段；
- 不为了 Token 估算把具体 Provider Tokenizer 放进 Application canonical model；
- 不把字符数比例估算描述为精确 Token；
- 不用 Provider 事后 usage 取代调用前预算检查；
- 不强行把完整请求 Token 平均分摊给每条 Message；
- 不在当前阶段新增通用 Token measurement 数据库；
- 不把 Token 预算与 Cost 预算、Rate Limit、Quota 混成一个概念。

---

## 12. 开放问题

1. Token Counter 应由 Platform 内置、Provider Extension 提供，还是两者结合？
2. 没有第一方 Tokenizer 的模型应使用兼容 encoding、byte heuristic，还是由 Provider Adapter 提供保守上界？
3. Tool Schema Token 应在 Tool PromptBuild Trace 还是主 PromptBuild Trace 中归属？
4. Prompt Preview 是否需要同时支持“当前模型”和多个候选模型的并排估算？
5. 哪些 PromptBuild Trace 需要长期保存，哪些只需要随 Preview 临时返回？
6. Provider actual usage 与 estimate 差异超过阈值时，是否产生 Diagnostic？
7. Cache read/write usage 如何与 context occupancy 和计费分别展示？
8. 多模态、Provider-native Tool 和 encrypted reasoning 的估算策略由谁声明？

---

## 13. 与其他文档的关系

- [`README.md`](README.md) — Prompt Builder 领域入口；
- [`prompt-builder-philosophy-v0.md`](prompt-builder-philosophy-v0.md) — Structure / Source / Capability 与 Activation；
- [`../trace-explainability-v0.md`](../trace-explainability-v0.md) — Prompt construction Trace；
- [`../provider-adapter-contract-v0.md`](../provider-adapter-contract-v0.md) — Provider payload 与 usage 合同；
- [`../../../reference/oh-my-pi-architecture-and-engineering-reference.md`](../../../reference/oh-my-pi-architecture-and-engineering-reference.md) — oh-my-pi 对照审计；
- [`../../../reference/pulsarai-architecture-and-product-reference.md`](../../../reference/pulsarai-architecture-and-product-reference.md) — PulsarAI 对照审计。
