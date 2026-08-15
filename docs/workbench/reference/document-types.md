# Document Types 字典 (Document Schema)

Loom Studio 使用统一的 Document Store 进行数据持久化。所有被存储在 Kernel 层的数据都必须具有合法的 `type`。由于 Kernel 本身对业务无感，这些 type 和 schema 实际上是由 Application 层或者 Extension 层定义的。

以下是由 `packages/application-runtime` (AIRP) 定义的官方内置的 Document Types。

> **详细的 TypeScript Schema 定义位于:**
> `packages/application-runtime/src/types.ts` 和 `packages/application-runtime/src/document-types.ts`

## 1. 对话与叙事树 (Narrative Tree)

### `airp.session`
- **说明**: 顶层的会话容器。
- **关联类型**: `SessionContent`
- **关键字段**: `cardSourceVersionId`, `promptResourceIds`, `activeBranchId`, `agentProfileId`
- **备注**: 新 Session 只从 Card 复制有序 Prompt Resource IDs，不复制 Resource 内容；PromptBuild 直接读取这些 Resource IDs。

### `airp.narrative_branch`
- **说明**: 会话的分支（由于允许随时分叉/修改，所有进度存储在 branch 树上）。
- **关联类型**: `NarrativeBranchContent`
- **关键字段**: `sessionId`, `parentBranchId`, `forkedFromEntryId`, `headEntryId`

### `airp.narrative_entry`
- **说明**: 用户可见的时间线上的具体发言节点。
- **关联类型**: `NarrativeEntryContent`
- **关键字段**: `sessionId`, `branchId`, `parentEntryId`, `role` (user/assistant), `content`

### `airp.branch_state_snapshot`
- **说明**: 增量状态补丁或快照，用于加速时间线计算而无需从头回放。
- **关联类型**: `BranchStateSnapshotContent`
- **关键字段**: `sessionId`, `branchId`, `runId`, `headEntryId`, `patch`

## 2. 运行态与诊断 (Runtime & Run)

### `airp.run`
- **说明**: 代表一次完整的模型交互流程（如点击发送按钮后直到 AI 回复完毕）。
- **关联类型**: `RunContent`
- **关键字段**: `sessionId`, `branchId`, `status` (running/completed), `input`, `intent`

### `airp.commit_candidate`
- **说明**: 模型生成了回复，但可能还在等待用户确认或自动接受的候选态节点。
- **关联类型**: `CommitCandidateContent`
- **关键字段**: `sessionId`, `runId`, `providerResultEntryId`, `status` (auto_accepted)

### `airp.runtime_entry`
- **说明**: 会话过程中产生的各种中间件数据，包括发给模型的确切 Prompt，或收到的原始 payload。
- **关联类型**: `RuntimeEntryContent`
- **关键字段**: `sessionId`, `runId`, `kind` (user_input/prompt/provider_result), `content`

### `airp.agent_transcript_entry`
- **说明**: Agent 真实思考和行动的原始日志（可能与对外输出的 narrative 不同）。
- **关联类型**: `AgentTranscriptEntryContent`

## 3. 智能体与卡片资产 (Agent & Assets)

### `airp.cardSource`
- **说明**: 基础角色卡资产。
- **关联类型**: `CardSourceContent`
- **关键字段**: `name`, `opening`, `promptResourceIds`, `importBundleId`, `createdAt`, `updatedAt`
- **备注**: Bundle import 路径中 Card 直接保存有序 `promptResourceIds` 与独立 `importBundleId`。`createCard` 的 M0 simple-card 路径仍保留 `preset` / `settingLayer`。

### `airp.agentProfile`
- **说明**: 将一个 Preset Prompt Resource 与一个已启用的 Provider Model 组合成可运行配置；Agent Session 只引用该 Profile。
- **关联类型**: `AgentProfileContent`
- **关键字段**: `name`, `presetId`, `model.providerProfileId`, `model.modelId`

### `airp.promptResource`
- **说明**: 一个平铺、独立编辑的顶层 Prompt 资源根节点，例如 Preset、Setting Layer、Runtime 视图或 History 视图。
- **关联类型**: `PromptResourceContent`
- **关键字段**: `resourceKind`, `rootNode`, `linkedSettingIds`, `historyPolicy`, `sourceArtifactRef`, `origin`
- **备注**: `resourceKind=preset` 时，该 Document 是 Agent 的完整 PromptBuild Module，并可通过 `linkedSettingIds` 显式引用平铺 Setting。Agent Profile 的 `presetId` 直接指向它。`origin.kind=builtin` 的官方资源只读；删除 Setting 时会解除 Card、Preset 与 Narrative Timeline 引用。

### `airp.importBundle`
- **说明**: 保存一次 Card Bundle 导入的来源 Artifact、来源引用、资源推荐关系和导入 Document 清单。
- **关联类型**: `ImportBundleContent`
- **关键字段**: `cardId`, `documentIds`, `sourceArtifact`, `sourceArtifactRef`, `bindings`, `importedAt`
- **备注**: Card export 通过 `Card.importBundleId` 回读来源与兼容数据。

## 4. 平台与提供商 (Platform Provider)

### `airp.providerProfile`
- **说明**: 用户配置的 Provider、连接配置和已启用模型清单。模型选择是 `{ providerProfileId, modelId }` 值对象，不再拥有独立 Model Profile Document。
- **关联类型**: `ProviderProfileContent`
- **关键字段**: `providerExtensionId`, `config`, `enabledModelIds`, `secretRef`
- **备注**: `secretRef` 只在后端 Document 内部使用；Client DTO 仅返回 `credential.configured` 与更新时间，Secret 明文保存在系统凭证库。
