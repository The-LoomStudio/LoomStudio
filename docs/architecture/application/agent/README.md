# Agent Architecture

Studio Application 的 Agent 子系统负责组织模型调用、PromptBuild、Tool 使用和运行事实持久化。Agent 是执行工作的主体，不等于 Character；Kernel 不理解 Agent、Provider、Tool、Message 或 Narrative 语义。

当前稳定主链：

```text
Agent Preset
  -> Prompt Resource 树 + 模型绑定 + Lore / textUses / Tool Mount
  -> PromptBuild + Tool Prompt Build
  -> AI Gateway Provider Step
  -> Tool Invocation / Result Loop
  -> canonical Agent Transcript
```

Agent Preset 是完整、可直接调用的执行身份；Agent Session 直接保存 `agentPresetId`。编排树、历史/交付策略、可选模型绑定和 Preset Tool Mount 共同构成执行定义，不经过 Profile 选择层。未绑定模型时可以保存和编辑 Preset，但需要模型的预览或执行明确失败；绑定模型仍引用独立 Provider Profile 与 model ID。取消的是 Agent Profile，不是 Provider Profile。

## 正式文档

- [`runtime-and-session.md`](runtime-and-session.md) — Agent Session、Transcript、Loop 推进和当前恢复边界；
- [`tool-system.md`](tool-system.md) — Tool Definition、Preset Mount、Transport、Invocation、Result 与执行边界；
- [`provider-and-prompt-build.md`](provider-and-prompt-build.md) — Provider Account、AI Gateway、AI SDK 和 Tools PromptBuild 投影。

## 当前实现范围

当前已经跑通：

- Agent Preset 复用同一 Prompt Resource 身份，保存编排、可空模型绑定及调用配置；
- canonical Transcript 与 Agent Store 持久化；
- OpenAI、Anthropic、Google 和 OpenAI-compatible Gateway adapter；
- 完整响应与 Streaming Gateway contract；
- Native Function Tool 与 Content Tool；
- Tool Validation、Approval、Execution 和 Result Replay；
- 多 Provider Step Agent Loop；
- 单层 Preset Tool Mount 开关和 Tool Activation；
- Tool Prompt 宏、Provider Tool Order、Content Anchor / Slot；
- Provider Observation、Run State、Tool Invocation 和 Tool Result 的会话检查。
- 有完整检查点且原执行者已退出时的显式冷恢复；不是 Provider 流断点续传或任意崩溃点自动恢复，见[恢复边界](runtime-and-session.md#显式冷恢复)。

Extension Manifest 中的 Agent Preset 贡献属于静态声明。显式导入后才实例化为 Prompt Resource 与 Mount；声明、导入、安装授权和某轮实际激活不能互相替代。

创建 Session 可直接绑定没有模型的 Agent Preset；预览/执行遇到缺失模型时明确失败。Preset 上的模型选择仍由 Provider Profile ID 与 Model ID 组成，并非移除 Provider Profile。

Session 创建后固定 `agentPresetId`，不能通过 `updateAgentSession` 改绑；使用另一预设应创建另一 Session。主写作指客户端为 Narrative 输入选择的接收 Session，与当前查看对象分离。生成中不允许换主，旧暂停任务须先成功放弃，不跨预设续跑。固定绑定不冻结预设资源版本，详细边界见[身份与绑定](runtime-and-session.md#1-身份与绑定)。

预设资源使用配置与包归属分离：Lore 通过 Mount 显式采用，角色默认采用可关闭，正则/提取器以 `textUses` 覆盖公共默认。引用不自动将资源收入包，预设切换也不启动独立代码实例或停用整个扩展，见[PromptBuild](../prompt-build/README.md#资源归属与使用配置)。

当前尚未完成：

- OpenAI Responses Custom Tool 的正式 adapter 与 result replay；
- 通用 Permission 等待与恢复、Agent Session 正式分支操作；不要将这些缺口与已实现的受限显式冷恢复混为一谈；
- 动态 Extension Tool 注册；
- 泛化子智能体调度、通用 Bash、CLI 和 MCP。

CodeAct QuickJS/VFS、官方正文写入工具及其独立 Changeset 已接入；它们不代表完整子智能体调度或 Memory / Session 生命周期均已完成，详见[Runtime 与 Session](runtime-and-session.md)。

[Agent Runtime 实施记录](../../../archive/plans/agent-runtime-session-and-workspace-plan.md)已由用户确认完成。以上原范围之外的扩展方向不属于本轮未完成工作，是否推进须按具体需求另行确认。

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
