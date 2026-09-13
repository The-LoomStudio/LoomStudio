# AI Gateway Streaming Execution Plan

> **状态**：第一方 Agent 流式 Run、进程内断线重连、暂停保留与 continuation 已完成；跨进程恢复与插件实时 Handler 待后续
> **日期**：2026-09-13
> **边界**：本文固定流式执行的职责边界。当前交付覆盖 Gateway、Application Agent、Server RPC、Studio Client 和 Agent Profile；插件 SDK 与跨进程恢复仍未接入。

## 决策

流式不是 Model Profile 的固定配置，而是单次 Run 的交付策略。

- Model Profile 只声明能力事实，例如 `capabilities.streaming`；
- Agent Profile 保存默认交付偏好 `stream | complete`；
- 每次调用可以覆盖默认偏好；
- Gateway 根据请求与模型能力执行、拒绝或降级；
- 插件不得直接处理 Provider SSE、API Key 或厂商协议。

### 交付偏好的归属

流式偏好属于 Agent Profile，因为它描述的是“这个 Agent 如何执行和交付结果”，而不是账号本身的属性。

- Provider Account 只保存连接信息和凭据；
- Model Profile 只表达模型身份与能力事实，不保存 UI 交付偏好；
- Preset 只表达 Prompt、工具和 Agent 行为，不决定前台实时显示还是后台静默执行；
- Agent Profile 默认使用 `stream`，后台任务或不适合实时展示的 Agent Profile 可以保存 `complete`；
- 单次 Run 可以覆盖 Profile 默认值，避免为一次后台任务复制 Profile。

流式能力事实仍由 Gateway / Provider Adapter 判断。Profile 选择 `stream` 不是对供应商能力的假设；不支持流式时必须返回明确能力错误，`complete` 则直接使用完整响应。

### 暂停与继续

- Server 重启不恢复执行中的 Run；同一进程内暂停 Run 保留为 `paused`，直到继续、明确取消或自然失败；
- 暂停会保留已生成的 assistant 半成品和未完成工具调用状态；工具没有完整结果时不得写成成功；
- 无新用户输入时，继续沿原 Agent 任务创建 continuation。若 Provider 支持 response/session continuation，优先使用 Provider 能力；否则使用新的 Provider 请求恢复 Agent 层上下文，但不新增隐藏的用户消息；
- 用户产生新输入时创建新的独立 Run，并可通过 `sourceRunId` 关联暂停现场；
- 断线补读、暂停现场和 continuation 的归属是 `Agent Session`；`Timeline` 只是本次 Agent Turn 的可选写入目标，不参与 Run 身份、事件游标或恢复判断；
- `finishReason` 只有在明确属于长度截断等可安全续接的情况时才允许自动 continuation；`stop`、工具调用未完成、取消和错误不能统一视为可继续。
- 原生 reasoning 不等同于正文：如果暂停发生在 Provider 只返回 reasoning、尚未产生正文增量的阶段，平台不创建带内容的 partial Message；允许 UI 暂时存在空的正文容器，但它不进入正式 Transcript。此时无新输入的继续等价于重试；用户有新输入时，按原用户消息与新用户消息共同构成上下文，不保留中间空容器。
- 平台不解析正文内自定义思维链，也不通过前后缀 Heuristic 推断 reasoning；这类内容按普通正文处理，由 Agent/作者自行承担语义。

## 已实现的 Server 内部合同

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

非流式调用也走统一 Run 合同，根据 Provider 是否返回 usage 产生 `started -> usage? -> completed`，避免上层维护两套执行状态机。

规范化事件至少覆盖：

- `started`；
- `text-delta`；
- `tool-input-delta`；
- `usage`；
- `completed`；
- `failed`；
- `cancelled`。

iframe 插件不能直接跨边界传递 `AsyncIterable` 或 `AbortSignal`。插件 Bridge 后续使用 `runId + subscribe + event + cancel` 映射同一合同。

当前第一阶段已通过 RPC 暴露 Run 创建、游标订阅、取消和状态查询。订阅立即返回当前游标之后的事件，不等待 Run 完成。流式是正式能力，不因前端状态接线延期而降级为实验能力。缓存、重连和暂停/继续的详细机制另行冻结，但公共 Run 必须能表达进行中、暂停、中断、完成和失败。

2026-09-13 核对：规范化工具输入增量事件的实际名称为 `tool-input-delta`，与 `packages/ai-gateway/src/types.ts`、Gateway 实现及现有测试一致。第一阶段已建立 `runId + subscribe + cancel + state` 的第一方消费合同；缓存、重连和暂停/继续不在本轮展开为最终协议。

## 重试边界

- Gateway 只处理明确 retryable、尚未产生输出且可安全重放的传输错误；
- 已产生部分输出后不得静默重试，避免重复文本；
- Schema、工具参数和输出质量等语义重试由 Agent Runtime 或 Application 决定；
- 用户点击重试创建新的 Run，并保留与旧 Run 的关联；
- Provider continuation 必须作为显式能力合同，不能假设所有厂商支持。

## 平台普惠能力

平台 SDK 后续提供 Run、订阅、取消和错误归一；原生 UI 可以再提供 Stream Store、React Hook 和默认状态组件。插件可以复用默认渲染，也可以只消费规范化事件自行渲染，但不重复实现网络层。用户看到的暂停或中断必须对应 Run 的真实状态；点击继续应消费既有 Run 状态或创建带来源关联的 continuation，不得把原始请求当作全新请求静默重发。

## 验收条件

1. 同一个 Model Profile 可以被流式聊天和非流式后台任务复用；
2. 不支持流式的模型在 `auto` 下可以完整响应，在强制 `stream` 下返回明确能力错误；
3. 第一方 Application 与 iframe 插件消费同一事件语义；
4. 取消最终到达 Provider 请求；
5. 已产生 Delta 的 Run 不会被无感自动重试。

## 2026-09-13 第一阶段结果

- `AiGatewayRun` 增加 `getState()` 与游标读取事件能力；
- `ProfiledAiGateway` 增加 Run 创建和取消信号传递；
- Server 增加 `ai.run.create`、`ai.run.subscribe`、`ai.run.cancel`、`ai.run.state`；
- Client API 增加对应调用入口；
- 使用单进程内存 Run 注册表，未承诺进程重启后的恢复；
- Agent Profile 的 `delivery` 已接入 Agent Turn 与 Provider Gateway；旧 Profile 默认 `stream`，后台调用可显式使用 `complete`。
- Application Agent 增加 `application.agent.run.create`、`subscribe`、`cancel`、`state`，由服务端生成 `runId`，并统一发送 `started`、增量、终态事件；
- Studio Client 已消费 Agent Run 事件，实时更新助手临时消息，显示运行/完成/失败/中断状态，并支持真实取消；取消不会伪造完成消息，也不会重新发送原请求；
- Studio Client 订阅失败时会沿用原 `runId + cursor` 自动重试，恢复后从原游标继续消费，不创建新 Run；
- 暂停会把已收到的正文写入 `assistant partial`，把未完成工具调用保留为 `suspended`，并记录可供 Agent 层 continuation 使用的 Provider 消息上下文；
- `application.agent.run.pause` 与 `application.agent.run.resume` 已接入。继续请求不携带新的用户输入，使用新的关联 Run 和原用户 Entry；用户发送新消息仍创建新的独立 Run；
- 定向类型检查通过；Gateway、Server RPC、Application Runtime、Provider Gateway、Client API 五个测试文件共 48 个测试通过，相关客户端 ESLint 通过；
- 当前明确未实现：跨进程或重启后的 Run 恢复、最终缓存协议、暂停后从 Provider 原状态继续，以及 iframe 插件 SDK 映射。这些属于后续阶段，不由本阶段的内存 Run 注册表承诺。
- 暂停续接的实现不承诺 Provider 原 HTTP/SSE 请求原地恢复；没有 Provider continuation 能力时，平台只恢复 Agent 层上下文并创建关联的新 Provider Run。
- 能力注册表的现有扩展 Handler 合同仍是 `Promise<JsonValue>`；因此通用 `ProfiledAiGateway.createRun()` 当前只能在完整结果返回后发出一次文本事件，不宣称为真实实时流。第一方 Agent 的实时流仍由原生 Provider Gateway 提供。若未来要求扩展能力也支持真实增量，需要另行设计兼容的 Handler / SDK 事件合同。

## 2026-09-13 暂停与 continuation 结果

- Agent Store 新增兼容旧数据的 `partial` Message、`continuesEntryId` 和 `suspended` 工具调用状态；
- 暂停只中止当前 Provider 请求，不把中断工具标记为完成，也不自动重放可能产生外部副作用的工具；
- 原生 reasoning 阶段没有正文时不写入 partial Message；续接使用原用户任务重试，用户新消息路径不会携带中间空容器；
- `finishReason: length` 与用户暂停分开处理：有正文时先保留为 partial 并在同一 Agent Loop 内继续，无正文时按原任务重试；不会因为 `tool_call`、取消或普通错误自动续接；
- 没有 Provider 原地恢复能力时，continuation 使用新的 Provider 请求，但复用原用户 Entry、已完成工具上下文和中断现场，不插入隐藏的用户消息；
- Session 的 Transcript 和已写入的 `suspended` / `partial` 记录属于正式持久化状态；内存 Run 只保存当前进程中的事件游标和 continuation 执行快照，Server 重启后不恢复执行；
- 增加 RPC 行为测试覆盖 `pause -> suspended -> resume`，确认续接输入为空且携带 continuation checkpoint；
- 仍未承诺 Provider 原 HTTP/SSE 请求恢复、Server 重启恢复或扩展 Handler 的真实增量流。
