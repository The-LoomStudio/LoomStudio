# 核心类型速查 (Core Types)

> **状态**：Active Reference / Current Source Is Authority

本页提供当前类型入口，不复制完整接口签名。领域 DTO、持久化类型与 Provider wire 类型分别由对应模块负责。

## 内核与扩展基础设施

| 类型 | 当前职责与来源 |
|---|---|
| Kernel / EventBus | 进程内 RPC、事件与平台服务协调；[Kernel](../../../packages/kernel/src/index.ts) |
| DocumentStore | 版本化 typed JSON 聚合、Revision 与 Document revert；不拥有所有领域状态；[Document Store](../../../packages/document-store/src/index.ts) |
| ExtensionHost | Server Module 加载、Scope 清理和 capability gate；[Host](../../../packages/extension-sdk/extension-host/src/index.ts) |
| ExtensionManifest / Activation Context | Manifest v2 的 Package / Module / Instance 及作者能力合同；[SDK](../../../packages/extension-sdk/src/index.ts) |

## 应用层运行时

| 类型 | 当前职责与来源 |
|---|---|
| ApplicationRuntime | Card、Narrative Timeline、Agent Session、Prompt、State 等领域入口；[types.ts](../../../packages/application-runtime/src/types.ts) |
| ApplicationRuntimeContext | 内部 Store / Gateway / Registry 等稳定基础设施；[Context](../../../packages/application-runtime/src/foundation/application-context.ts) |
| AiGateway | Provider 调用与 Application 返回合同；[Gateway](../../../packages/application-runtime/src/providers/gateway.ts) |
| CompiledPrompt | 当前 DFS 编译器的 messages 与 editorProjection；[Prompt 类型](../../../packages/application-runtime/src/prompt/prompt-builder.ts) |

当前会话使用 `createNarrativeTimeline`、`createAgentSession`、`previewAgentTurn`、`invokeAgentTurn` 等领域方法，不再提供旧 `createSession / submitTurn` 主链。Narrative、Agent、Prompt Resource 与 State 的权威数据分别由独立 Store 管理，见 [Data Architecture](../../architecture/data/README.md)。

## Client 实体层

[entities/](../../../apps/studio-client/src/entities/) 保存 Client DTO 与领域类型：`agent.ts` 对应 Agent Profile / Session，`narrative.ts` 对应 Timeline / Branch / Node，`card.ts` 对应 Card。请求编排与派生 UI 状态由 Feature hooks 负责，不把实体类型文件描述成完整 UI 状态管理器。

## Loom Core

[Core public API](../../../packages/core/src/index.ts) 公开 Fragment、同步 Pass / PassFactory / PassConfig、PassRegistry、Trace 与 run / runPasses。Pass 是同步 Fragment 变换，不是异步 LLM 调用入口。

[Loom Runner](../../../packages/loom-runner/src/index.ts) 为 Kernel 的 `loom.run` 适配 JSON 输入、Core 执行与 Trace Audit。当前 Agent PromptBuild 直接使用 Application DFS，未调用 Core；详见 [Studio 集成](../../architecture/application/prompt-build/loom-core/studio-integration.md)。
