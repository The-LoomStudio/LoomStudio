# Document Types 字典 (Document Schema)

Loom Studio 使用统一的 Document Store 进行数据持久化。所有被存储在 Kernel 层的数据都必须具有合法的 `type`。由于 Kernel 本身对业务无感，这些 type 和 schema 实际上是由 Application 层或者 Extension 层定义的。

以下是由 `packages/application-runtime` (AIRP) 定义的官方内置的 Document Types。

> **详细的 TypeScript Schema 定义位于:**
> `packages/application-runtime/src/types.ts` 和 `packages/application-runtime/src/document-types.ts`

## 1. 对话与叙事树 (Narrative Tree)

### `airp.session`
- **说明**: 顶层的会话容器。
- **关联类型**: `SessionContent`
- **关键字段**: `cardSourceVersionId`, `activeBranchId`, `agentRuntimeProfileId`

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

### `airp.card_source`
- **说明**: 基础角色卡资产。
- **关联类型**: `CardSourceContent`
- **关键字段**: `name`, `preset`, `opening`, `settingLayer`

### `airp.agent_runtime_profile`
- **说明**: 一组运行时配置参数集合，将角色卡应用于特定会话时使用的引擎参数。
- **关联类型**: `AgentRuntimeProfileContent`
- **关键字段**: `name`, `purpose`, `presetId`, `modelProfileId`

### `airp.prompt_workspace`
- **说明**: 用户或平台编写 Prompt Template 以及挂载外部引用的工作台内容。
- **关联类型**: `PromptWorkspaceContent`

## 4. 平台与提供商 (Platform Provider)

### `airp.provider_account`
- **说明**: 用户配置的外部 API 提供商账号（如 OpenAI / Claude API key 存放信息引用）。
- **关联类型**: `ProviderAccountContent`
- **关键字段**: `providerExtensionId`, `config`, `secretRefs`

### `airp.model_profile`
- **说明**: 基于 provider account 衍生的特定模型配置（如 gpt-4-turbo 具体参数）。
- **关联类型**: `ModelProfileContent`
- **关键字段**: `providerAccountId`, `capability`, `providerModelId`
