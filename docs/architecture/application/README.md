# Studio Application Architecture

Studio Application 是 Loom Studio 第一方内建的 AIRP 领域层。它定义默认产品体验中的 Card、Session、Setting Layer、PromptBuild、Agent、Runtime 和领域 UI，但不进入 Kernel，也不伪装成 ordinary Extension。

删除生命周期遵循领域 Scope 与 Ownership，而不是统一盲目级联。创建 Narrative Timeline 时会固化初始 State、Schema 等运行依赖及 Opening 正文，但引用的 Prompt Resource 正文仍按 ID 读取当前版本；删除 Card 默认保留这些 Timeline，也可以由调用方显式选择在同一事务中删除关联 Timeline、Timeline State 与对应 Extension Storage。Card Scope Extension Storage 和 Card-owned Text Transform Rule 始终随 Card 删除。共享 Prompt Resource、Portable Extension Payload 与 Media Asset 不随 Card 自动删除。

## 子分类

| 分类                                                   | 职责                                                                                  | 当前状态                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| [`data-capabilities-and-lifecycle.md`](data-capabilities-and-lifecycle.md) | 文本、State、宏、运行记录的能力与共享事务、引用和生命周期边界 | 当前实现边界 |
| [`card-bundle-files.md`](card-bundle-files.md) | 文件化 Card Bundle、可编辑目录、ZIP 与 PNG 分发 | ZIP v2、PNG Base64 ZIP 与旧格式读取已实现 |
| [`prompt-build/`](prompt-build/)                       | Sources、Composition、PromptBuild pipeline 与 Loom Core 对接                          | Loom Core 边界已晋升                                   |
| [`agent/`](agent/)                                     | Agent Session、Loop、Tool、Provider 与 PromptBuild 接缝                               | 基础运行架构已晋升；恢复、子智能体与领域 Tool 仍在演进 |
| [`history-text-pipeline.md`](history-text-pipeline.md) | Narrative / Session History 的 Regex、Reasoning Promotion、Extractor 与 Renderer Slot | Phase 0—5 基础闭环已实现                               |
| [`extension/`](extension/)                             | Extension Scoped Storage、Card Portable Payload 与领域贡献协议                        | 数据、分发与 Client Renderer 主链已晋升                |
| [`state-and-variables.md`](state-and-variables.md)     | Global / Timeline State、EC 初始化、Extension Contribution、Revision、Macro 与 Undo   | State v1 核心运行链已晋升                              |
| [`ui/`](ui/) | 第一方 AIRP 的草稿/冲突、Timeline 提交与正文窗口生命周期 | 已实现合同；其他页面设计仍在 Workbench |

Application 的其他领域文档在稳定前继续保留于 [`../../workbench/discussion/`](../../workbench/discussion/)。

## 资源包与 Agent Preset

当前分发包只有 Card Package 与 Extension Package；Extension Package 可只含声明式资源而没有 Module。Agent Preset 是可直接调用的 Agent 执行定义，聚合有序 Prompt Resource 树、历史/交付策略、本地 Provider Model 绑定及 Preset Tool Mount，不存在独立 Agent Profile 层。Preset 可不绑定模型；绑定值仍引用 Provider Profile 与 model ID，Provider Profile 继续作为 Provider 配置实体存在。

Extension 安装可分别以全局或 Card 为目标；资源 origin 关联安装身份，模块启用与 capability grant 也按安装目标记录。安装、资源导入/挂载、模块激活和本轮实际消费是不同事实：Manifest 的静态贡献声明不证明 Runtime 已注册或当前运行已激活。Card/Timeline 解析只允许全局安装及所属 Card 安装的资源；Card 私有包文件通过带 Card 与归档摘要的专用路径读取。

显式资源/包更新提交后，后续资源解析使用当前资源；State、Session Transcript 与 Narrative History 不自动重置或重写。单个 Prompt Resource 导出只包含资源树与作者宏配置，不递归携带规则、脚本、模型绑定、工具实现或关联 Settings；组合分发使用 Card/Extension Package。Card Bundle 中的扩展归档与扩展 Portable Payload 私有数据分开。Loom Script 声明 `client-sandbox` 运行目标不等于任意代码的 OS 级强沙箱。

源码入口：[Agent Runtime](../../../packages/application-runtime/src/runtime/agents-runtime.ts)、[资源导入导出](../../../packages/application-runtime/src/runtime/prompt-runtime.ts)、[Extension 安装管理](../../../apps/studio-server/src/extensions/extension-manager.ts)、[Card Bundle](../../../packages/application-runtime/src/cards/workspace.ts)。

## Application Runtime Context

`packages/application-runtime` 当前使用内部 `ApplicationRuntimeContext` 统一承载稳定基础设施能力：

```text
agents? / narratives?
dataEngine / documents / promptResources / states
sourceArtifacts? / mediaAssets? / secrets
gateway / providerAdapters / aiCapabilities / agentTools
logger? / now() / createId(prefix)
```

Context 是 Application Runtime 的基础设施工具箱，不是业务状态容器。影响一次行为结果的输入继续通过 operation request 显式传递，例如：

```text
sessionId / branchId / workspaceId
userInput / activationFacts / timelineTarget
providerProfileId / modelId
```

请求边界使用独立 `RuntimeRequestContext` 传播 actor、`clientId`、`correlationId`、`callId` 和 `parentCallId`。Document mutation、PromptBuild 和 Provider 路径可以使用这些字段建立调用关联，但不得从 Context 隐式读取业务事实。

`ApplicationRuntimeContext` 不暴露给 ordinary Extension。Extension 的身份、权限、RPC、UI 和本地运行能力由独立 Extension Host Capability 负责；Server Host 基线见 [`../extensions/README.md`](../extensions/README.md)，Client Renderer Host 见 [`../extensions/client-renderer-host.md`](../extensions/client-renderer-host.md)。

## 边界

```text
Application:
  拥有 AIRP 业务语义和流程。

Kernel:
  提供业务无感知的平台原语。

Platform:
  提供可被多个 Application / Extension 复用的共享能力。

UI Shell:
  提供容器和通用交互原语。
```
