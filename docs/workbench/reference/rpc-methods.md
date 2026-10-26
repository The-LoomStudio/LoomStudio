# RPC 方法导航 (RPC Methods)

> **状态**：Active Reference / Current RPC Registries Are Authority

本页把方法名定位到当前 Handler，不复制完整参数 Schema 或保证穷举所有方法。Client DTO、Server 参数校验和 Runtime 业务合同是不同边界，改动时沿调用链核对，不只修改其中一处。

## 按调用链定位

1. [Client typed API](../../../apps/studio-client/src/shared/api/studio-api.ts)：UI 使用的方法名、请求及返回类型。
2. [Server Router](../../../apps/studio-server/src/rpc/trpc/router.ts)：声明静态 procedure；动态扩展通过 `kernel.invoke` 交给 Kernel，并保留原权限校验。
3. 下方领域 Handler：解析、校验参数并传播调用上下文。
4. [ApplicationRuntime](../../../packages/application-runtime/src/types.ts) 与 [runtime/](../../../packages/application-runtime/src/runtime/)：领域行为；[领域 Store](../../../packages/application-data/README.md)负责持久化。

`system.introspect` 只覆盖 Kernel / Extension 注册面，不代表整个 Server API。`application.*` 不能仅从 Kernel Registry 推断。

## Application 方法族

以下方法名为精确检索示例，其余同领域方法在同一领域文件的 procedure 中。所有领域由 [tRPC router](../../../apps/studio-server/src/rpc/trpc/router.ts)串接。

| 需求 / 精确方法示例 | 参数与路由入口 | 实现 / 行为入口 |
|---|---|---|
| Card、角色、导入；`application.createCard`、`application.deleteCard` | [cards.ts](../../../apps/studio-server/src/rpc/trpc/application/cards.ts) | [cards-runtime.ts](../../../packages/application-runtime/src/runtime/cards-runtime.ts)、[Card Bundle](../../architecture/application/card-bundle-files.md) |
| Agent Preset、模型绑定；`application.createAgentPreset`、`application.updateAgentPreset` | [agents.ts](../../../apps/studio-server/src/rpc/trpc/application/agents.ts) | [agents-runtime.ts](../../../packages/application-runtime/src/runtime/agents-runtime.ts)、[Agent](../../architecture/application/agent/README.md) |
| Session、Transcript；`application.createAgentSession`、`application.getAgentTranscriptPage` | [agents.ts](../../../apps/studio-server/src/rpc/trpc/application/agents.ts) | [Runtime 与 Session](../../architecture/application/agent/runtime-and-session.md) |
| 执行、流式、恢复；`application.invokeAgentTurn`、`application.agent.run.create`、`application.agent.run.resume` | [agents.ts](../../../apps/studio-server/src/rpc/trpc/application/agents.ts) | [Run 检查点](../../../packages/application-runtime/src/agents/run-recovery.ts)、[恢复边界](../../architecture/application/agent/runtime-and-session.md#显式冷恢复) |
| 工具启用；`application.listPresetToolMounts`、`application.replacePresetToolMounts` | [agents.ts](../../../apps/studio-server/src/rpc/trpc/application/agents.ts) | [Tool 系统](../../architecture/application/agent/tool-system.md) |
| 正文、时间线、分支；`application.appendNarrativeInput`、`application.editNarrativeNode` | [timeline.ts](../../../apps/studio-server/src/rpc/trpc/application/timeline.ts) | [narrative-runtime.ts](../../../packages/application-runtime/src/runtime/narrative-runtime.ts)、[Narrative 边界](../../architecture/application/agent/runtime-and-session.md#6-narrative-边界) |
| Prompt Resource、资源树；`application.getPromptResource`、`application.updatePromptResourceAsset` | [workspaces.ts](../../../apps/studio-server/src/rpc/trpc/application/workspaces.ts) | [prompt-runtime.ts](../../../packages/application-runtime/src/runtime/prompt-runtime.ts)、[PromptBuild](../../architecture/application/prompt-build/README.md) |
| 世界书采用；`application.listLoreMounts`、`application.replaceLoreMounts` | [workspaces.ts](../../../apps/studio-server/src/rpc/trpc/application/workspaces.ts) | [资源归属与使用配置](../../architecture/application/prompt-build/README.md#资源归属与使用配置) |
| Provider 账号与凭据；`application.createProviderProfile`、`application.replaceProviderCredential` | [providers.ts](../../../apps/studio-server/src/rpc/trpc/application/providers.ts) | [providers-runtime.ts](../../../packages/application-runtime/src/runtime/providers-runtime.ts) |
| State、变量；`application.getStateSnapshot`、`application.applyStateMutation` | [states.ts](../../../apps/studio-server/src/rpc/trpc/application/states.ts) | [State 与变量](../../architecture/application/state-and-variables.md) |
| 正则、提取器、显示；`application.projectHistory`、`application.listTextTransformRules` | [text-transforms.ts](../../../apps/studio-server/src/rpc/trpc/application/text-transforms.ts) | [History Text Pipeline](../../architecture/application/history-text-pipeline.md) |
| Loom Script；`application.importLoomScript`、`application.createLoomScriptMount` | [loom-scripts.ts](../../../apps/studio-server/src/rpc/trpc/application/loom-scripts.ts) | [Loom Script Runtime](../../architecture/extensions/loom-script-runtime.md) |
| 扩展私有配置与记录 | [extension-records.ts](../../../apps/studio-server/src/rpc/trpc/application/extension-records.ts) | [扩展数据合同](../../architecture/application/extension/data-and-portable-payload.md) |
| Card 携带的扩展数据 | [portable-payloads.ts](../../../apps/studio-server/src/rpc/trpc/application/portable-payloads.ts) | [Portable Payload](../../architecture/application/extension/data-and-portable-payload.md) |

## 其他 Namespace 与数据面

| Namespace / 入口 | 当前所有者 |
|---|---|
| `system.*`、`docs.*`、`diagnostics.*` | [Kernel](../../../packages/kernel/src/index.ts) 与 [handlers.ts](../../../packages/kernel/src/handlers.ts) |
| `extensions.*`：安装、卸载、资源导入、授权、重载 | [Kernel handlers.ts](../../../packages/kernel/src/handlers.ts)注册，委托 [Server Extension Manager](../../../apps/studio-server/src/extensions/extension-manager.ts)；[安装及生命周期合同](../../architecture/extensions/README.md) |
| `ai.*` | [services.ts](../../../apps/studio-server/src/rpc/trpc/services.ts) |
| `logs.*` | [services.ts](../../../apps/studio-server/src/rpc/trpc/services.ts)；[日志查询与隐私边界](../../architecture/platform/logging.md) |
| `settings.*` | [services.ts](../../../apps/studio-server/src/rpc/trpc/services.ts)，不是 Lore Prompt Resource |
| `official.*` | [official-content.ts](../../../apps/studio-server/src/official/official-content.ts)；[官方内容](../../../official/README.md) |
| `directories.*` | [card-directory-catalog.ts](../../../apps/studio-server/src/resource-directories/card-directory-catalog.ts) |
| HTTP 认证、Asset、Card 文件、Extension 文件与 SSE | [Server README](../../../apps/studio-server/README.md#当前-http-面)、[http/](../../../apps/studio-server/src/http/)；不把文件接口当成 RPC |

## 旧名称与合同陷阱

- `loom.run`、`trace.list`、`audit.list` 已随 Core / Runner / TraceAudit 退役，不提供兼容转译。PromptBuild 和模型日志仍由 Application 拥有，见 [PromptBuild](../../architecture/application/prompt-build/README.md)与[模型观测](../../architecture/platform/logging.md)。

- `application.createAgentProfile` 等 Agent Profile CRUD 已取消。当前存在 `application.createAgentPreset` / `getAgentPreset` / `listAgentPresets` / `updateAgentPreset` / `deleteAgentPreset`；底层复用 Prompt Resource，并不因此不存在 Preset RPC。
- `LoreMount.source.kind = preset` 是当前消费配置，不是仅供兼容的旧数据。`replaceLoreMounts` 接受 `loreResourceIds` 或 `mounts` 二选一；后者可按既有 Mount ID 保留失效引用。准确校验见 Handler 使用的共享 Schema 与 Runtime。
- Session 固定绑定 Preset；查看 Session、主写作选择和 Run 恢复是不同操作。删除资源后的引用处理不按“所有删除都拒绝”或“全部级联”推断。
- 旧 `createSession` / `submitTurn`、Agent Profile、Prompt Resource 整份 Document 存储不能作为新调用的合同。类型入口见 [Core Types](core-types.md)与 [Document Types](document-types.md)。

已知精确方法时，直接在对应文件查找，例如：

```bash
rg -n -F 'replaceLoreMounts' apps/studio-server/src/rpc/trpc/application/workspaces.ts
```

验证选择对应 Handler / Runtime / Store 的真实风险，不默认跑全套。会话运行的例子：[agent-run-rpc.test.ts](../../../tests/unit/studio-server/agent-run-rpc.test.ts)与 [agent-run-recovery.test.ts](../../../tests/integration/application-runtime/agent-run-recovery.test.ts)；Lore Mount 参数边界见 [lore-mount-rpc.test.ts](../../../tests/unit/studio-server/lore-mount-rpc.test.ts)。

网络入口为认证后的 `POST /trpc/<procedure>`，请求体是输入对象，成功响应为 `{ result: { data } }`。`directories.applyChanges` 替代旧 `directories.apply`（`apply` 为 tRPC 保留名称）；StudioApi 的 `directories.apply` 调用形式保留。旧 `/rpc` 返回 404。动态扩展参数通过 `kernel.invoke` 的 `{ method, params }` 传递；它不能绕过平台 procedure 的输入校验。
