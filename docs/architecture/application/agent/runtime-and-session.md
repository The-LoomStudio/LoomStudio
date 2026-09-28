# Agent Runtime 与 Session

## 1. 身份与绑定

`AgentSession` 是一次 Agent 工作上下文的持久化身份。它直接引用 Agent Preset，不在 Session Header 中复制编排、Provider 或 Tool 配置。

```text
AgentSession.agentPresetId
  -> PromptResource（resourceKind: preset）
     -> rootNode / macros / historyPolicy
     -> model / delivery
     -> Preset Tool Mount
```

不存在独立 Profile 或 Profile → Preset 选择关系。Tool Mount 是唯一工具使用配置；模型绑定可空，但预览和执行需要模型时明确报错。

Session Header 保存 Session ID、Agent Preset ID、可选 `timelineId`、title、active head Entry ID、Entry count 和生命周期时间。`timelineId` 不代表领域所有权或权限。Header 不保存完整 Loop KV，也不把 Provider message array 作为权威状态。

Agent Store v6 只将旧引用列改名为 `agent_preset_id`，不重写 Transcript 或 State。按本轮开发数据迁移约定，不转换旧 Profile 配置或猜测重绑定；旧引用若找不到同 ID 的预设，执行明确失败，历史仍可读取。旧 Profile RPC 已移除。

## 2. Canonical Transcript

Agent Transcript 是 append-only 运行事实序列。当前 Entry 包括：

| Entry | 语义 |
|---|---|
| `message` | 用户或 Assistant 正文 |
| `reasoning` | 带来源、可见性与 replay 策略的推理内容 |
| `provider-observation` | Provider、Model、Call ID、Stop Reason 与 Usage |
| `tool-invocation` | Studio Invocation ID、Tool、Transport、输入与执行状态 |
| `tool-result` | Invocation 配对结果、内容、错误与 synthetic reason |
| `run-state` | Run 的 created / running / suspended / terminal 状态 |
| `work-summary` | 已保存的工作交接，之前的 Transcript 保留但退出后续 Prompt |

Transcript 不绑定 OpenAI Chat Completions wire schema。Provider Replay 是 Runtime 根据 canonical Entry 和原始 Invocation Transport 生成的下一步输入投影。

Turn Preparation 按 100 条分页读取最新 `work-summary` 之后的工作历史，并携带该摘要；没有摘要时读取整个工作段，不把分页当作静默裁剪。Narrative 若配置记忆来源则读取其明确发布范围；未配置来源的旧路径仍读最新 100 节点并产生诊断。这些读取不等于自动摘要、Token 预算或未完成 Run 的跨进程恢复。

每条 Entry 保存 `parentEntryId`、`sequence` 和可选 `runId`。当前 Store 沿 active parent chain 分页，并以 `expectedEntryCount` 防止并发追加覆盖。Tool Invocation / Result 的轻量配对索引保证 Invocation ID 不重复、Result 引用已知 Invocation、Tool ID 匹配，并且一个 Invocation 只有一个 Result。

## 3. Loop 推进

当前一次 Agent Run 的最小状态流：

```text
append user message + running
  -> invoke one Provider Step
  -> append provider observation
  -> scan Native and Content invocations
  -> no invocation: validate final assistant text and complete
  -> has invocation: append invocation, execute, append result, replay
  -> next Provider Step
```

Loop 是否继续由 Runtime 派生，不由 Provider Stop Reason 单独决定：

- 扫描到 Native 或 Content Invocation：继续执行 Tool；
- 没有 Invocation、有 Assistant 正文且不是 error / length：完成；
- `error`、`length`、空输出、非法 Tool 参数或超过 Step 上限：失败；
- AbortSignal 或取消错误：中止。

因此 Content Tool 即使随 Provider `stop` 返回，也不会被误判为最终完成。当前每个 Run 最多执行 8 个 Provider Step，每次 Tool 执行默认最多 30 秒；这是现阶段的安全上限，不是永久产品配置。

同一 Provider Step 当前不接受 Native 与 Content 两类 Invocation 混合出现。Content Invocation 按出现顺序串行执行。

## 4. Result Replay

Tool Result 的 canonical 身份不随 Provider 改变。Native Function 使用 Provider `tool` result message，并引用 Provider Tool Call ID；Content Tool 使用 Runtime 生成的普通 `user` content block，不伪造 Provider Tool Call ID，也不改变 canonical ToolResult provenance。

失败、拒绝、Abort 和 Timeout 都返回 ToolResult，而不是把已执行调用留成无结果状态。

Agent 主动读取与 ToolResult 的生命周期由 Runtime 管理，不等于 PromptBuild 的第三种注入语法。Anchor / Slot、正文宏与主动读取之间的边界见 [注入与内联展开](../prompt-build/injection-and-inline-expansion.md)；持续 Pin 的保留策略仍属于 Agent 侧的待实施设计。

`completeAgentSessionHandoff` 保存已生成的工作摘要，不负责生成摘要。计数 CAS 和 Store 内的安全边界校验保证不会在运行 / 暂停的 Run 或未完成工具组中提交交接。提交后旧段退出投影，摘要进入 `@memory.session`，原始记录仍可查询；后续 resume 不复活交接前的失败任务。剧情采用通知与失败收据见 [默认剧情上下文来源](../extension/narrative-context.md)。

## 5. 持久化与恢复边界

当前每个 Provider Observation、Invocation、Result 和 terminal Run State 都会分阶段持久化，因此进程内失败不会只存在于临时 callback 中。

但以下能力尚未完成：

- 从历史 Transcript 自动重建未完成 Provider Replay；
- Server 重启后的 Resume；
- Permission 等待与恢复；
- orphan Invocation / Result 自动修复；
- Agent Session 的正式 fork、retry attempt tree 和 branch UI。

`suspended`、parent Entry 和 synthetic reason 已进入 canonical 数据合同，不代表上述恢复流程已经实现。

## 6. Narrative 边界

Agent Session 是工作树，Narrative Timeline 是故事权威树。两者互不拥有，也不因一方回滚而自动回滚另一方。

游玩提交先通过 `application.appendNarrativeInput` 持久化用户正文，再将节点 ID 作为 `narrativeTarget.inputNodeId` 投递到 Session。Runtime 验证分支归属并读取节点正文；换 Session 时重投递同一节点，不重复写入用户正文。两次持久化有顺序，但不是一个跨领域原子事务；Session 投递失败保留已有节点。

Agent Loop 分阶段提交 Transcript，Agent 正文只能由授权工具写入 Timeline。Assistant 最终消息不会自动追加到正文；旧 `narrativeTarget.commit` 与 Turn 返回的自动 `narrative` 结果已移除。工具写入失败/Head 冲突通过 failed Tool Result 返回 Agent 并供用户查看，成功工具提交不因后续失败被回滚。Turn 的 mutation scope 仅描述 Session Transcript。

客户端保留当前页面最近一次用户投递的节点身份，已有重试按钮显式重新投递到当前 Session；它不自动重跑，也不是完整的持久 retry attempt tree。Server 重启后的 Run 恢复仍属于上节未完成范围。

## 7. Narrative Sampling（叙事采样读取）

在双向交互与智能体自主编排场景中，Agent 能够通过 `NarrativeSampler`（`packages/application-runtime/src/narrative/sampling.ts`）在受控范围内主动采样读取当前授权 Timeline 的历史正文：

- **选择模式**：支持 `tail`（从指定 Head 向前读取最近 N 个节点）与 `range`（指定 `afterNodeId` 到 `throughNodeId` 开闭区间的节点范围）；
- **有界预算控制**：单次采样严格限制上限（默认最大 1,000 节点、2,000,000 字符），超出预算时安全截断正文，返回 `complete: false` 与 `nextBeforeNodeId` 供后续续读；
- **只读非阻塞**：采样仅基于已提交的节点只读展开，不修改 Timeline 的 Branch Head，不推进 Memory 指针，也不触发任何 Narrative 追加。

## 8. 实现来源

- [`packages/application-data/src/agent/types.ts`](../../../../packages/application-data/src/agent/types.ts)
- [`packages/application-data/src/agent/store.ts`](../../../../packages/application-data/src/agent/store.ts)
- [`packages/application-runtime/src/narrative/sampling.ts`](../../../../packages/application-runtime/src/narrative/sampling.ts)
- [`packages/application-runtime/src/agents/tool-loop.ts`](../../../../packages/application-runtime/src/agents/tool-loop.ts)
- [`packages/application-runtime/src/agents/agent-turn.ts`](../../../../packages/application-runtime/src/agents/agent-turn.ts)
