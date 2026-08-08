# M0 Backend Slice v0

> Status: M0 Implementation Slice  
> Scope: 不接 UI、不接真实模型、不接 tool-call，先验证 Application Runtime 的后端闭环。

> **目标设计提示**：本文件记录当前已实现的 M0 事实。后续开放设计已经转向“以 Narrative Timeline 为游玩中心、以 Agent Session Tree 为编辑中心，并通过 binding 和 Changeset 关联”。因此，下文旧 `Session`、玩家输入写入 Narrative、镜像 `AgentTranscriptEntry` 和 `AgentRuntimeProfile` 不应直接视为最终 Schema。参见 [`session-timeline-data-model-v0.md`](session-timeline-data-model-v0.md) 与 [`agent/agent-model-v0.md`](agent/agent-model-v0.md)。

## 1. 目标

M0 的目标不是完成 AIRP Runtime，而是先证明下面这条链能跑通：

```text
createCard(fake JSON)
  -> createSessionFromCard
  -> submitTurn
  -> NarrativeEntry(user accepted)
  -> RuntimeEntry(user_input projection)
  -> prompt compose
  -> AI Gateway
  -> fake / openai-compatible provider
  -> RuntimeEntry(provider_result)
  -> CommitCandidate
  -> NarrativeEntry(assistant accepted)
  -> AgentTranscriptEntry(mirrored)
  -> BranchStateSnapshot
  -> NarrativeBranch.headEntryId
  -> Run.completed
```

这对应当前代码包：

```text
packages/application-runtime
```

## 2. M0 已实现能力

1. `Session` 作为运行实例。
2. `CardSource` 作为 M0 内容源，先支持 fake card JSON。
3. `createSessionFromCard(cardId)` 会读取当前 Card 版本，并把 Card snapshot 冻结进 Session。
4. `NarrativeBranch` 作为显式 branch/head 对象。
5. `NarrativeEntry` 通过 `parentEntryId` 承载剧情树路径，不在 narrative 里另造嵌套树。
6. `RuntimeEntry` 保存 Agent 工作侧投影、prompt 和 provider result。
7. 玩家输入先 accepted 到 `NarrativeEntry(user)`，再复制成 `RuntimeEntry(user_input)`。
8. provider result 必须经过 `CommitCandidate`，M0 默认 `auto_accepted`。
9. 每个 `submitTurn` 创建 `Run` 和 `BranchStateSnapshot`。
10. `forkBranch(fromEntryId)` 支持从任意已接受剧情 entry 开分支。
11. 分支 timeline 读取时沿 `parentEntryId` 回溯，因此 fork 分支会继承 fork 点之前的剧情路径。
12. 默认 fake AI Gateway 用于验证后端闭环；M0.1 已提供 non-streaming openai-compatible Gateway 适配入口。
13. `DocumentStore` 已有 SQLite-backed 实现，M0 通过 `documents / document_revisions / changesets` 三张 SQL 表持久化。
14. `apps/studio-server` 默认使用 `.loomstudio-dev/document-store.sqlite`，测试可注入临时 sqlite path 或其他 DocumentStore。
15. 持久化 ID 使用随机 UUID 后缀，不依赖进程内递增计数，避免服务重启后主键冲突。
16. `submitTurn` 的落盘阶段通过 `DocumentStore.transact()` 成批提交；Provider 调用失败不会留下 partial Run / Entry / Transcript。
17. M0.2 已加入 `ProviderAccount / ModelProfile / AgentRuntimeProfile` 文档，先用于绑定和 inspect，不负责完整 provider UI。
18. `Session` 可以绑定 `agentRuntimeProfileId`，`Run` 会记录本轮使用的 `agentRuntimeProfileId / modelProfileId`。
19. `AgentTranscriptEntry` 先按 Narrative Timeline 1:1 镜像，使用 `parentTranscriptEntryId` 保留工作侧树路径。
20. M0.3 默认 Gateway 可以根据 `Run.modelProfileId` 从 DocumentStore 自动装配 openai-compatible provider 调用。
21. M0.3 前端调试台可以创建 OpenAI-compatible `ProviderAccount / ModelProfile / AgentRuntimeProfile` 并用它提交真实回合。

## 2.1 M0 Fake Card JSON

M0.1 Card Source 先使用极简 JSON，并允许 simple preset 与 `{{User}}` 宏：

```json
{
  "name": "雾港旅馆",
  "userName": "旅人",
  "description": "一张用于测试的 AIRP 假卡。",
  "preset": {
    "system": "你是一个沉浸式 AIRP 剧情 Agent。玩家名是 {{User}}。"
  },
  "opening": {
    "entries": [
      {
        "role": "assistant",
        "content": "雨夜，{{User}}推开旅馆的门。"
      }
    ]
  },
  "settingLayer": {
    "entries": [
      {
        "path": "world.location.fog-harbor",
        "title": "雾港",
        "content": "雾港是一座潮湿安静的海港城镇。{{User}}刚进入旧旅馆。",
        "enabled": true,
        "activation": { "kind": "always" },
        "tags": ["world", "location"]
      }
    ]
  }
}
```

当前语义：

1. `name` 是必填展示名，也会进入 M0 prompt system message。
2. `userName` 是 M0.1 的最小宏上下文；缺省时 `{{User}}` 展开为 `User`。
3. `preset.system` 是 simple card 的最小预设入口，会进入 system message，但不承载模型参数。
4. `description` 是卡说明，M0 先直接进入 prompt。
5. `opening` 是预置 Chat，M0 在 `createSessionFromCard` 时写入初始 Narrative Timeline，不作为特殊第一条 Chat 字段保留。
6. `settingLayer` 是 M0 设定层种子，结构接近世界书绑定 Card；M0 先支持 `always / manual / keyword` activation。
7. `{{User}}` 目前只作为 simple macro，在 preset、opening、description、active setting projection 中展开；不代表完整变量系统。
8. Session 保存的是 Card 当前版本快照；之后改 Card Source 不应隐式影响已开的 Session。

## 2.2 AI Gateway M0.1

M0.1 已把 Runtime 的 provider 调用收束为 Gateway 形状：

```text
Prompt Builder messages[]
  -> gateway.invokeChat()
  -> normalized GatewayChatResult
  -> RuntimeEntry(provider_result)
  -> CommitCandidate
  -> NarrativeEntry(assistant accepted)
```

当前实现：

1. `createFakeAiGateway()` 作为默认实现，保持测试闭环和无 key 运行。
2. `createOpenAICompatibleGateway()` 支持 non-streaming `/chat/completions`。
3. OpenAI-compatible payload 由 `ModelProfileConfig.config` 承载 provider 参数，例如 `temperature / max_tokens`。
4. Runtime 的 canonical prompt 仍只提供 OpenAI-style `messages[]`，不把 provider 参数塞入 Prompt Builder。
5. M0.1 支持开发态 `plain:` 和 `env:` secret ref；`secret:` ref 暂未实现。
6. M0.3 的 document-backed Gateway 在存在 `modelProfileId` 时读取 `ModelProfile -> ProviderAccount`，并根据 `providerExtensionId` 选择 openai-compatible 或 fake fallback。

## 2.3 Agent Runtime M0.2

M0.2 不做 tool-call、多 Agent、总结或复杂 Agent loop，只先让 Agent 在数据层拥有明确身份和工作记录。

新增文档：

```text
ProviderAccount:
  provider extension 账号级配置。M0.2 先保存 config / secretRefs。

ModelProfile:
  一个可调用模型单元。绑定 ProviderAccount、providerModelId 和 provider 参数。

AgentRuntimeProfile:
  一个 Agent 运行配置。M0.2 先绑定 name / purpose / modelProfileId。

AgentTranscriptEntry:
  Agent 工作侧 transcript。M0.2 先 1:1 镜像 NarrativeEntry。
```

当前流程：

```text
createProviderAccount
  -> createModelProfile
  -> createAgentRuntimeProfile
  -> createSessionFromCard(agentRuntimeProfileId)
  -> submitTurn
  -> Run.agentRuntimeProfileId / Run.modelProfileId
  -> AgentTranscriptEntry(user mirrored)
  -> AgentTranscriptEntry(assistant mirrored)
```

前端调试流程：

```text
AI Gateway panel:
  baseUrl / apiKey / model / temperature / maxTokens
  -> createProviderAccount
  -> createModelProfile
  -> createAgentRuntimeProfile

New Session:
  -> createSessionFromCard(agentRuntimeProfileId)

Send:
  -> preview prompt / submitTurn
  -> document-backed AI Gateway
  -> provider response
  -> Run Inspector / Agent Transcript
```

当前语义：

1. `AgentRuntimeProfile` 是 Agent 的最小身份单元，不等于 Character。
2. `ModelProfile` 是模型选择单元，不塞进 Preset。
3. `ProviderAccount` 是账号 / provider extension 配置单元，暂不提供完整 secret store。
4. `AgentTranscriptEntry` 使用 `narrativeEntryId` 关联剧情正文，使用 `parentTranscriptEntryId` 维护工作侧树。
5. `getAgentTranscript(sessionId, branchId?)` 按当前 Narrative branch path 返回镜像 transcript，因此 fork 继承路径可以自然投影。
6. M0.2 仍采用 ephemeral prompt policy：完整 Agent Transcript 归档和 inspect，但不默认全部进入下一轮 prompt。

## 3. M0 暂缓能力

1. Anthropic / Gemini / image provider。
2. 完整 Provider Extension registry、统一配置面板和 capability negotiation。
3. Secret Store / redaction UI / provider profile 编辑。
4. tool-call / tool-result。
5. summary / memory / dynamic context mount。
6. Setting Layer 写入、世界书动态演进、状态 merge。
7. branch merge / conflict resolution。
8. UI branch editor。
9. 业务级 SQL 投影表和迁移系统。

## 4. 当前服务边界

`@loom-studio/application-runtime` 先作为 Kernel 之上的 Application 包存在。

它不把 Session / Provider / Chat 语义塞进 Kernel，也不扩大 `loom.run` 的职责。后续可以在 Studio Server 层注册 Application RPC，例如：

```text
application.createSession
application.createSessionFromCard
application.createCard
application.getCard
application.listCards
application.submitTurn
application.getSession
application.getTimeline
application.getRun
application.forkBranch
```

这些 RPC 应由 Studio Application 层拥有，而不是 Kernel public surface 的基础能力。

## 5. Server 接入

M0 已通过 `apps/studio-server` 的 `/rpc` 暴露第一组 Application RPC：

```text
application.createCard
application.getCard
application.listCards
application.createProviderAccount
application.getProviderAccount
application.listProviderAccounts
application.createModelProfile
application.getModelProfile
application.listModelProfiles
application.createAgentRuntimeProfile
application.getAgentRuntimeProfile
application.listAgentRuntimeProfiles
application.createSession
application.createSessionFromCard
application.submitTurn
application.getSession
application.getTimeline
application.getAgentTranscript
application.getRun
application.forkBranch
```

这些方法由 server 侧分发到 `@loom-studio/application-runtime`，不注册进 Kernel namespace，也不改变 `loom.run` 的边界。

## 6. 下一步

建议下一步在保持 fake gateway 可用的前提下，补齐 Gateway / Runtime 的可观测面和更稳定的 RPC 表面：

1. 给 `application.*` 返回更统一的 error code。
2. 加 `application.listSessions` / `application.listBranches`。
3. 用 ProviderAccount / ModelProfile 自动装配真实 Gateway。
4. 增加 RPC-level branch fork 测试。
5. 讨论是否需要 Application RPC registry，避免 server main 变厚。
6. 为高频 timeline / transcript / run 查询增加业务投影索引，避免长期依赖 JSON document 全量分页扫描。
