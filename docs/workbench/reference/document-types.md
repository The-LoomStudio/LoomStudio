# Document Types 字典 (Document Schema)

> **状态**：Active Reference / Current Registries Are Authority

Document Store 管理需要版本与 Revision 的 typed JSON 聚合，不是所有状态的统一持久化入口。第一方类型以 [applicationDocumentTypes](../../../packages/application-runtime/src/foundation/document-types.ts) 为准；Kernel 不定义这些业务 Schema。

## 当前第一方 Document Types

| Type | 用途 |
|---|---|
| `airp.cardSource` | Card 作者配置、资源关系、宏、State 与文本管线贡献 |
| `airp.providerProfile` | Provider 配置、启用模型与后端 Secret 引用；Client 不取得 Secret 明文 |
| `airp.aiCapabilityProfile` | AI Capability 配置 |
| `airp.agentProfile` | Preset、Provider Model Selection 与 Tool 快速覆盖 |
| `airp.agentTool` | Workspace Tool Definition；可执行实现由 Registry 提供 |
| `airp.stateDefinition` | Global Definition 或 Timeline Template |
| `airp.textTransformRule` | 带 Owner 的 History Rule |
| `airp.textExtractor` | 消费 History Projection 的语义提取配置 |
| `airp.textPipelineOverride` | 按 History Source / Phase / Consumer 保存禁用与排序覆盖 |
| `airp.loomScript` | 静态 Metadata、源码 Blob 引用与 digest |
| `airp.loomScriptMount` | Owner 挂载、顺序、版本与用户 Grant；新挂载禁用且无 Grant |
| `airp.portableExtensionPayload` | Card 显式绑定的 Extension 可移植载荷 |
| `airp.extensionConfig` | 受控 Extension 配置 |
| `airp.extensionRecord` | 受控 Extension 私有记录 |
| `airp.importBundle` | Card 导入来源、Artifact 与资源绑定信息 |
| `airp.timelineRuntimeContext` | Timeline 创建时固化的作者贡献与运行依赖 |

字段与校验继续由 [Application 合同](../../../packages/application-runtime/src/types.ts)、领域源码和下列 Architecture 维护，不在速查表复制第二份 Schema：

- [State 与变量](../../architecture/application/state-and-variables.md)
- [History Text Pipeline](../../architecture/application/history-text-pipeline.md)
- [Loom Script](../../architecture/extensions/loom-script-runtime.md)
- [Extension 数据](../../architecture/application/extension/data-and-portable-payload.md)
- [Card Bundle](../../architecture/application/card-bundle-files.md)

## 独立领域 Store（不是 Document Type）

| 领域 | 权威表与入口 |
|---|---|
| Narrative | `narrative_timelines / narrative_branches / narrative_nodes`；[Narrative Store](../../../packages/narrative-store/src/types.ts) |
| Agent Session / Transcript | `agent_sessions / agent_transcript_entries / agent_tool_invocations`；[Agent Store](../../../packages/agent-store/src/types.ts) |
| Prompt Resource | 资源头、Node、Revision、Setting Mount 与 Preset Tool Mount；[Prompt Resource Store](../../../packages/prompt-resource-store/src/types.ts) |
| State | `state_scopes / state_revisions`；[State Store](../../../packages/state-store/src/types.ts) |

旧 `airp.session`、`airp.narrative_branch`、`airp.narrative_entry`、`airp.branch_state_snapshot`、`airp.run`、`airp.commit_candidate`、`airp.runtime_entry`、`airp.agent_transcript_entry` 已不在当前注册表中；`airp.promptResource` 也不再是 Prompt Resource 权威存储。不要依据历史类型创建新记录。共享事务与实际提交边界见 [Data Architecture](../../architecture/data/README.md)。
