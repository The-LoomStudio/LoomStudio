# Studio Application Architecture

Studio Application 是 Loom Studio 第一方内建的 AIRP 领域层。它定义默认产品体验中的 Card、Session、Setting Layer、PromptBuild、Agent、Runtime 和领域 UI，但不进入 Kernel，也不伪装成 ordinary Extension。

## 子分类

| 分类                                                   | 职责                                                                                  | 当前状态                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| [`prompt-build/`](prompt-build/)                       | Sources、Composition、PromptBuild pipeline 与 Loom Core 对接                          | Loom Core 边界已晋升                                   |
| [`agent/`](agent/)                                     | Agent Session、Loop、Tool、Provider 与 PromptBuild 接缝                               | 基础运行架构已晋升；恢复、子智能体与领域 Tool 仍在演进 |
| [`history-text-pipeline.md`](history-text-pipeline.md) | Narrative / Session History 的 Regex、Reasoning Promotion、Extractor 与 Renderer Slot | Phase 0—5 基础闭环已实现                               |
| [`extension/`](extension/)                             | Extension Scoped Storage、Card Portable Payload 与后续领域贡献协议                    | 数据与分发基础已晋升；Renderer/UI 仍在 Workbench       |
| [`state-and-variables.md`](state-and-variables.md)     | Global / Timeline State、Revision、Macro、Mutation、Branch 与 Undo                    | Phase 0—6 主链已晋升                                   |
| [`ui/`](ui/)                                           | 第一方 AIRP UI 如何使用 Studio Shell                                                  | 分类已建立，具体设计仍在 Workbench                     |

Application 的其他领域文档在稳定前继续保留于 [`../../workbench/discussion/application/`](../../workbench/discussion/application/)。

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
userInput / activationFacts / projectionOrderProfile
providerProfileId / modelId
```

请求边界使用独立 `RuntimeRequestContext` 传播 actor、`clientId`、`correlationId`、`callId` 和 `parentCallId`。Document mutation、PromptBuild 和 Provider 路径可以使用这些字段建立调用关联，但不得从 Context 隐式读取业务事实。

`ApplicationRuntimeContext` 不暴露给 ordinary Extension。Extension 的身份、权限、RPC、UI 和本地运行能力由独立 Extension Host Capability 负责；当前开放设计位于 [`../../workbench/discussion/extensions/studio-extension-host-capabilities-v0.md`](../../workbench/discussion/extensions/studio-extension-host-capabilities-v0.md)。

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
