# AI Gateway Streaming Execution Plan

> **状态**：Planned / Deferred
> **日期**：2026-08-05
> **边界**：本文只固定流式执行的职责边界。当前前端阶段不修改 Gateway、Provider Adapter、RPC 或插件 SDK。

## 决策

流式不是 Model Profile 的固定配置，而是单次 Run 的交付策略。

- Model Profile 只声明能力事实，例如 `capabilities.streaming`；
- Agent Profile 或 Application 可以保存 `auto | stream | complete` 默认偏好；
- 每次调用可以覆盖默认偏好；
- Gateway 根据请求与模型能力执行、拒绝或降级；
- 插件不得直接处理 Provider SSE、API Key 或厂商协议。

## 候选合同

```ts
type GatewayExecutionRequest = {
  modelProfileId: string
  capability: string
  input: unknown
  delivery?: 'auto' | 'stream' | 'complete'
}

type GatewayRun = {
  id: string
  events: AsyncIterable<GatewayEvent>
  result: Promise<GatewayResult>
  cancel(): void
}
```

非流式调用也走统一 Run 合同，只产生 `started -> completed`，避免第一方 Application 和插件维护两套状态机。

规范化事件至少覆盖：

- `started`；
- `text-delta`；
- `tool-call-delta`；
- `usage`；
- `completed`；
- `failed`；
- `cancelled`。

iframe 插件不能直接跨边界传递 `AsyncIterable` 或 `AbortSignal`。插件 Bridge 后续使用 `runId + subscribe + event + cancel` 映射同一合同。

## 重试边界

- Gateway 只处理明确 retryable、尚未产生输出且可安全重放的传输错误；
- 已产生部分输出后不得静默重试，避免重复文本；
- Schema、工具参数和输出质量等语义重试由 Agent Runtime 或 Application 决定；
- 用户点击重试创建新的 Run，并保留与旧 Run 的关联；
- Provider continuation 必须作为显式能力合同，不能假设所有厂商支持。

## 平台普惠能力

平台 SDK 后续提供 Run、订阅、取消和错误归一；原生 UI 可以再提供 Stream Store、React Hook 和默认状态组件。插件可以复用默认渲染，也可以只消费规范化事件自行渲染，但不重复实现网络层。

## 验收条件

1. 同一个 Model Profile 可以被流式聊天和非流式后台任务复用；
2. 不支持流式的模型在 `auto` 下可以完整响应，在强制 `stream` 下返回明确能力错误；
3. 第一方 Application 与 iframe 插件消费同一事件语义；
4. 取消最终到达 Provider 请求；
5. 已产生 Delta 的 Run 不会被无感自动重试。
