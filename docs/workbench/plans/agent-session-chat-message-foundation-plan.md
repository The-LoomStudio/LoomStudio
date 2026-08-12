# Agent Session / Chat Message Foundation Plan

> **状态**：Approved Direction / Phase 1 Complete
> **日期**：2026-08-11
> **范围**：Agent Session 的会话记录、Run / Step 边界，以及 Provider Extension 的宿主协议。

## 1. 已确定方向

Loom Studio 只维护一套 Agent 会话心智模型：受版本控制的 Chat Completions-compatible `Message[]`。

```text
Agent Session:
  持久化 Message 历史和本地 Agent Binding。

Message:
  会话记录的 canonical 单元。
  ToolCall 保存在 assistant.tool_calls 中。
  ToolResult 保存为带 tool_call_id 的 tool message。

Run:
  一次执行过程的可选分组和运行摘要。
  runId 可以标记相关 Message、日志和 Changeset。

Step:
  Runtime 在内存中决定下一步动作的状态机状态。
  Step 不是会话 Document，也不是 Provider Message 或模型思维链。
```

Narrative Timeline 与 Agent Session 数据上独立。Timeline 保存剧情来源、资源引用、正文树和状态；Agent Session 不内嵌 Timeline。一次 AIRP 调用可以把 `timelineId` 作为 invocation target 传入，但 `AgentRun.timelineId` 不作为通用基础字段。

Narrative Timeline 的正文 Schema 已由 [`../discussion/application/narrative-timeline-content-schema-v0.md`](../discussion/application/narrative-timeline-content-schema-v0.md) 固化：Node 保存 `loom-markdown.v1` raw source；Markdown 只渲染普通 TextSegment；已注册标签由对应 Semantic Compiler 编译成 JSON-compatible Semantic Part。YAML-like KV 只是作者 string 内的排版约定，不成为系统配置格式。

## 2. Chat Message Contract

第一阶段只实现当前确定需要的稳定子集：

```ts
type ChatMessage =
  | { role: 'system' | 'developer' | 'user'; content: string }
  | { role: 'assistant'; content?: string; tool_calls?: ChatToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }
```

规则：

- 不直接依赖某个 OpenAI SDK 版本的类型；
- 字段名和配对语义保持 Chat Completions-compatible；
- 不引入 Responses `Item[]`、`previous_response_id`、reasoning item 或 hosted tool 语义；
- 多模态 content parts 等真实需求出现后再扩展；
- UI 需要扁平 ToolCall / ToolResult 时，从 Message 派生 View Model，不改变持久化模型。

## 3. Provider Extension Contract

Provider Extension 自己负责从宿主 Chat contract 映射到目标 Provider，不经过 Loom 自创的第二套通用 IR。

```text
Prompt Build / Agent Session projection
  -> CanonicalChatRequest
  -> Provider Extension
  -> provider-native request
```

OpenAI-compatible Adapter 可以近似透传；其他 Adapter 只负责一次转换。Provider 原始 response 可以进入受控 Trace，但不成为 Agent Session 的 canonical 数据。

## 4. 实施阶段

### Phase 1：协议基座

- 状态：**Complete（2026-08-12）**；

- 扩充 `ProviderMessage` 为 Chat Completion-compatible discriminated union；
- 支持 assistant `tool_calls` 与 tool `tool_call_id`；
- Gateway 返回 canonical assistant message，不再把结果先压成纯 `text`；
- 为 payload 校验、tool-call 解析和普通文本回归补最小测试。

兼容边界：旧 `ApplicationProvider.content` 与 `GatewayChatResult.text` 暂时保留为纯文本投影，现有 `submitTurn` 仍消费 `text`。canonical assistant message 已可在 Gateway 与 Agent Store 中完整表达，但 Tool Runtime 和旧 Turn Flow 迁移不属于本阶段。

### Phase 2：Agent Session 持久化

- 状态：**Complete（2026-08-12）**；
- 新增正式 `AgentSession` 与 `AgentMessage` 专用 SQL Store / 查询 API；
- Message 外层保存 `id`、`agentSessionId`、`runId?`、时间戳；
- 不新增 Agent Step Document 或独立 ToolCall Transcript Document。

### Phase 3：AIRP 流转迁移

- 将旧剧情 `Session` 改造为 Narrative Timeline；
- 停止把 Agent Transcript 镜像到 Narrative；
- 由 Runtime 把受控输出提交到 Narrative；
- 迁移旧 `submitTurn`，再删除过渡类型。

## 5. 本阶段非目标

- 完整 Tool Runtime 和权限确认 UI；
- Streaming contract；
- Agent Session 分支；
- Responses-native 状态链；
- Timeline / Session 全量迁移；
- Provider Extension SDK 的最终发布格式。
