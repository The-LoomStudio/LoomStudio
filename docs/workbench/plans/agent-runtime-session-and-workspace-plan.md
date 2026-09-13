# Agent Runtime、Session 与 Workspace 能力计划

> **状态**：In Progress / AI SDK、Agent Loop、第一方流式 Run、进程内暂停续接与 Workspace Context 首切片已完成；CodeAct Sandbox 与统一写入 Diff 待接续
> **日期**：2026-09-13
> **来源**：合并 `agent-runtime-ai-sdk-foundation-plan`、`ai-gateway-streaming-execution-plan` 与 `agent-session-context-and-workspace-capability-plan`

## 目标

统一维护 Agent 的 Provider 调用、Run / Step / Transcript、流式交付、Session Context、Tool Target 和 Workspace 写入能力。

## 已完成

- AI SDK Gateway、Provider-neutral canonical Transcript、Native / Content Tool Transport 与 Agent Loop。
- Agent Profile 的 `stream | complete` 交付偏好。
- 第一方 Agent 流式 Run、事件订阅、取消、暂停、进程内重连和 continuation。
- 暂停时保留已有正文与未完成工具状态；原生思考阶段没有正文时不写入空的正式 Message。
- Timeline Binding 只提供默认 Narrative Context，不代表所有权或权限。
- Workspace Context、Prompt Resource 搜索/读取/更新，以及 CAS、事务和 Changeset 边界。

## 后续阶段

1. 先建立 CodeAct Sandbox 与单一 JSON Tool 入口，Workspace 写入不再扩展为一组模型可见领域工具。
2. 让 Preset 对应锚点注入 CodeAct 的特殊 Prompt Resource，按触发条件描述可用能力和操作边界。
3. 实现统一写入 Diff：统计修改条目数；存在行数时同时显示行数，并在 Agent Session 消息容器中默认折叠展示。
4. 后续再单独评估 Responses Custom、跨进程恢复和插件实时 Handler。

## 已确认边界

- 平台提供 AI 能力和规范化数据传输，不替插件处理其领域数据。
- CodeAct 是统一执行入口；JSON Tool 只负责把代码交给 Sandbox 执行，具体可操作能力通过特殊 Prompt Resource 描述，并由运行时 Capability / Target / Approval 强制约束。
- 工具动作、工具调用结果和历史工具调用显示在 Agent Session 的消息容器中，默认折叠；平台保存统一 Invocation / Result / Changeset 事实，不包办业务摘要。
- Session 是 Run、事件和 continuation 的归属；Timeline 不是断线重连或 Run 恢复的身份。
- 没有新用户输入时继续属于 continuation / retry；有新输入时创建新的 User Message 和 Run。
- 原生 Provider 思考内容不作为正文；自定义正文内思维链不由平台猜测解析。

## 非目标

本阶段不实现跨进程恢复、插件 SDK 的实时 Handler 映射、通用审计平台、任意文件系统权限或 CLI/MCP。CodeAct Sandbox 是本阶段的首个新增执行基础，但不开放任意 Node / 文件系统 / 网络权限。

## 完成标准

同一套 Agent Run / Session 合同覆盖流式与非流式调用；暂停、取消、继续和新消息语义可从持久化 Transcript 与 Run 状态解释；CodeAct 写入结果以条目数和可用行数呈现，Diff 组件在输入框顶部与 Agent Session 末尾使用同一事实，且不扩大平台或工具自身的领域责任。
