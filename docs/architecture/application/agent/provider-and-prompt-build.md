# Provider、AI Gateway 与 PromptBuild

## 1. Provider Account 与 AI Gateway

Provider Account 是 Application 层的用户配置，保存 Provider Extension ID、非敏感 config、Secret 引用和启用模型。Agent Profile 只引用 Provider Model Selection，不直接保存 API Key。

```text
Agent Profile model selection
  -> Provider Profile / Account
  -> Provider Adapter Registry
  -> resolved provider config + credential
  -> AI Gateway
```

AI Gateway 使用 AI SDK adapter 统一 OpenAI、Anthropic、Google 和 OpenAI-compatible 的基础调用，但 AI SDK 类型不越过 Gateway public contract。

Gateway 当前负责 complete / stream 调用、text delta、tool input delta、usage、terminal event、Function Tool 编解码、Abort、raw / normalized finish reason、Provider Call ID、Request ID，以及 Provider-specific options 的校验和透传。

Gateway 设置 `maxRetries: 0`。是否安全重试、创建新 Attempt 或继续 Agent Run 属于 Application Runtime，而不是 SDK callback。

## 2. Provider Capability

Provider Adapter Registry 当前暴露：

```ts
type ProviderModelCapability = {
  streaming: boolean
  nativeFunctionTools: boolean
  providerCustomTools: boolean
}
```

Transport 选择以 capability 为输入，但最终结果还要经过 Tool Definition、Mount、Activation 和 fallback 分析。Provider 私有参数只能通过已校验的 Provider options 进入 adapter，不能污染 canonical Agent Transcript。

当前官方 Adapter 已启用 Streaming 和 Native Function Tool；`providerCustomTools` 尚未在正式 Adapter 中启用。

## 3. 两条构建表面

Tool 对模型的可见性分为两个平面：

```text
Provider-managed Tools
  与 messages[] 平级进入 Provider payload。

Content Tools
  作为外部 Runtime Source 进入 PromptBuild Message Composition。
```

Provider-managed Tool 不是 System Message。Loom Studio 可以控制顶层 Tool 数组的顺序，但 Provider 没有承诺它在内部位于第一个 System Message 前或后。

Content Tool 拥有真实 Anchor / Slot placement，并与 Preset、Setting、Narrative 和 Session 等 Prompt Source 一起进入统一 PromptBuild Pipeline。

## 4. Tool Prompt Build

Tool Prompt Build 在每轮调用时处理 Preset Mount 与 Agent override 合并后的候选 Tool、Activation、User 宏、Provider Tool order、Content anchor / slot / local_depth、requested / effective order trace 和重复 exposed name 诊断。

输出分为：

```text
Compiled provider exposures
  -> Gateway tools[]

Content Tool runtime contributions
  -> PromptBuild Source / Contribution / Slot Local Depth
```

Tool Prompt Build 直接执行模板、Activation 和排序；Tool Registry、Executor 与 Provider wire mapping 都不进入 Loom Core。

## 5. Preset 挂载与预览视图

Preset 挂载与预览是构建表面的静态投影：

- Provider Tools 在顶部显示为独立 `Tools` Block；
- Content Tools 显示为对应 Anchor 孔位中的外部 Slot；
- 同一 Slot 的多个 Tool 合并为一个来源投影；
- 虚拟 Tool Source 只读，实际编辑仍在 Preset Tools Tab；
- Extension 可以贡献自己的 Slot，不与官方 Slot 混为一个所有者。

该视图当前表达 Preset 默认启用结果，不等同于完整 Dry Run。Agent override、当前 Activation Facts 和 Provider capability 裁剪后的 `effectiveEnabled / active` 需要带运行上下文的 Build Preview 才能确认。

## 6. Provider Observation 与 Runtime 状态

每个 Provider Step 保存 Provider、Model、Provider Call ID、raw / normalized stop reason 和 usage。Provider Observation 是外部事实，Run State 是 Runtime 判断。`stop` 不必然表示 Agent 完成，`tool_call` 也不直接等同于整个 Run 的状态。

## 7. 明确不属于当前合同

- Provider 内部如何排列 System Message 与 Tool Description；
- OpenAI Responses Custom Tool 的正式 wire adapter；
- 由 AI SDK 自动拥有多步 Agent Loop；
- Provider SDK message 类型直接进入 Agent Store；
- 在 PromptBuild 完成后由 Runtime 临时拼接 Content Tool 字符串。

## 8. 实现来源

- [`packages/ai-gateway/src/types.ts`](../../../../packages/ai-gateway/src/types.ts)
- [`packages/ai-gateway/src/gateway.ts`](../../../../packages/ai-gateway/src/gateway.ts)
- [`packages/ai-gateway/src/provider-registry.ts`](../../../../packages/ai-gateway/src/provider-registry.ts)
- [`packages/application-runtime/src/agents/tool-prompt-build.ts`](../../../../packages/application-runtime/src/agents/tool-prompt-build.ts)
- [`packages/application-runtime/src/agents/tool-loop.ts`](../../../../packages/application-runtime/src/agents/tool-loop.ts)
- [`apps/studio-client/src/features/context-assets/model/preset-tool-projection.ts`](../../../../apps/studio-client/src/features/context-assets/model/preset-tool-projection.ts)
