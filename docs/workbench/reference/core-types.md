# 核心类型速查 (Core Types)

> **状态**：Active Reference / Current Source Is Authority

本页提供当前类型入口，不复制完整接口签名。领域 DTO、持久化类型与 Provider wire 类型分别由对应模块负责。

## 内核与扩展基础设施

| 类型 | 当前职责与来源 |
|---|---|
| Kernel / EventBus | 进程内 RPC、事件与平台服务协调；[Kernel](../../../packages/kernel/src/index.ts) |
| DataTransactionInput | 公共写入上下文（actor、reason、关联 ID）；各领域 WriteContext 和 DocumentTransactionInput 直接使用此类型；[Data Engine](../../../packages/data-engine/src/sqlite.ts) |
| StudioEvent / EventMeta | 平台事件 envelope；[Extension SDK](../../../packages/extension-sdk/src/events.ts)，不再有独立 transport 包 |
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

当前会话使用 `createNarrativeTimeline`、`createAgentSession`、`previewAgentTurn`、`invokeAgentTurn` 等领域方法，不再提供旧 `createSession / submitTurn` 主链。Timeline 根 Session 与 Timeline 同 ID，Transcript 是内容历史权威，Narrative Branch / Node 提供分支与正文投影；普通辅助 Session 仍独立运行。Narrative、Agent、Prompt Resource、State 与 Workspace 的持久化分别由对应 Store 管理，见 [Data Architecture](../../architecture/data/README.md)。

## Client 实体层

[entities/](../../../apps/studio-client/src/entities/) 保存 Client DTO 与领域类型：[agent.ts](../../../apps/studio-client/src/entities/agent.ts)对应 Agent Session / Transcript / Tool，[narrative.ts](../../../apps/studio-client/src/entities/narrative.ts)对应 Timeline / Branch / Node，[card.ts](../../../apps/studio-client/src/entities/card.ts)对应 Card。Agent Profile 已取消；Agent Preset 使用 [prompt.ts](../../../apps/studio-client/src/entities/prompt.ts)的 Prompt Resource 身份。请求编排与派生 UI 状态由 Feature hooks 负责，不把实体类型文件描述成完整 UI 状态管理器。

## 已退役原型

Core、Loom Runner 与 TraceAudit 已删除，`runPasses`、`loom.run`、`trace.list`、`audit.list` 不再是当前公共入口。Agent PromptBuild 直接使用 Application 编译器及异步正文处理器；其构建 trace、Observation 和模型日志仍然保留。

Fragment / Pass / Registry 与原型 Trace 的历史设计见[退役 Core 归档](../../archive/loom-project/retired-core-2026-10-25/README.md)，不据此新增生产依赖。
