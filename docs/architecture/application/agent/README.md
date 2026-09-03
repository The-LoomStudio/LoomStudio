# Agent Architecture

Studio Application 的 Agent 子系统负责组织模型调用、PromptBuild、Tool 使用和运行事实持久化。Agent 是执行工作的主体，不等于 Character；Kernel 不理解 Agent、Provider、Tool、Message 或 Narrative 语义。

当前稳定主链：

```text
Agent Profile
  -> Preset + Provider Model + Tool Overrides
  -> PromptBuild + Tool Prompt Build
  -> AI Gateway Provider Step
  -> Tool Invocation / Result Loop
  -> canonical Agent Transcript
```

## 正式文档

- [`runtime-and-session.md`](runtime-and-session.md) — Agent Session、Transcript、Loop 推进和当前恢复边界；
- [`tool-system.md`](tool-system.md) — Tool Definition、Preset Mount、Transport、Invocation、Result 与执行边界；
- [`provider-and-prompt-build.md`](provider-and-prompt-build.md) — Provider Account、AI Gateway、AI SDK 和 Tools PromptBuild 投影。

## 当前实现范围

当前已经跑通：

- Agent Profile 绑定唯一 Preset 与 Provider Model；
- canonical Transcript 与 Agent Store 持久化；
- OpenAI、Anthropic、Google 和 OpenAI-compatible Gateway adapter；
- 完整响应与 Streaming Gateway contract；
- Native Function Tool 与 Content Tool；
- Tool Validation、Approval、Execution 和 Result Replay；
- 多 Provider Step Agent Loop；
- Preset Tool Mount、Agent Profile 快速开关和 Tool Activation；
- Tool Prompt 宏、Provider Tool Order、Content Anchor / Slot；
- Provider Observation、Run State、Tool Invocation 和 Tool Result 的会话检查。

当前尚未完成：

- OpenAI Responses Custom Tool 的正式 adapter 与 result replay；
- 跨进程 Resume、Permission suspend UI 和 Agent Session 分支操作；
- 动态 Extension Tool 注册；
- 真实领域写入 Tool 与完整 Mutation / Changeset provenance；
- 子智能体、CodeAct、通用 Bash、CLI 和 MCP。

这些未完成方向继续保留在 [`../../../workbench/plans/agent-runtime-ai-sdk-foundation-plan.md`](../../../workbench/plans/agent-runtime-ai-sdk-foundation-plan.md) 及相邻 Workbench 文档中，不属于当前 Architecture 合同。

## 核心边界

```text
AI Gateway:
  统一 Provider 调用和基础 wire metadata。

Application Runtime:
  拥有 PromptBuild、Tool Registry、Agent Loop 和状态推进。

Agent Store:
  持久化 canonical Session 与 Transcript 事实。

Prompt Resource Store:
  拥有 Preset Tool Mount 和 Content Placement。

Kernel:
  只提供领域无关的平台原语，不解释 Agent 语义。
```
