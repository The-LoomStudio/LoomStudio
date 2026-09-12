# Agent Runtime 与 Session

## 1. 身份与绑定

`AgentSession` 是一次 Agent 工作上下文的持久化身份。它引用真实 `AgentProfile`，不在 Session Header 中复制 Preset、Provider 或 Tool 配置。

```text
AgentSession.agentProfileId
  -> AgentProfile
     -> presetId
     -> provider model selection
     -> toolOverrides
```

Agent Profile 的工具配置只是快速覆盖。实际 Tool 集合仍由 Preset Tool Mount 决定。

Session Header 保存 Session ID、Agent Profile ID、可选 `timelineId`、title、active head Entry ID、Entry count 和生命周期时间。`timelineId` 不代表领域所有权或权限。Header 不保存完整 Loop KV，也不把 Provider message array 作为权威状态。

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

Transcript 不绑定 OpenAI Chat Completions wire schema。Provider Replay 是 Runtime 根据 canonical Entry 和原始 Invocation Transport 生成的下一步输入投影。

当前 Turn Preparation 分别读取最多 100 条历史 Transcript Entry 与 Narrative Node；这是当前上下文读取上限，不是完整历史、自动摘要或跨进程恢复能力。

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

Agent Loop 分阶段提交 Transcript；当提供 `narrativeTarget` 且 `commit = true` 时，Loop 成功后再用独立事务追加用户与 Assistant 两条 Narrative Node。该事务不包含已持久化的 Agent Message；Narrative Head 冲突或其他提交失败不会回滚 Agent Transcript 或已完成的 Tool 写入。没有最终 Narrative commit 不等于 Tool 没有领域副作用。

这是当前实现边界，不是对跨领域原子提交的设计裁决。若要改变该语义，需要单独确定 Agent 运行事实、Tool 副作用与 Narrative 提交各自的恢复合同，不能仅通过共享 Data Engine 推断原子性。

## 7. 实现来源

- [`packages/agent-store/src/types.ts`](../../../../packages/agent-store/src/types.ts)
- [`packages/agent-store/src/store.ts`](../../../../packages/agent-store/src/store.ts)
- [`packages/application-runtime/src/agents/tool-loop.ts`](../../../../packages/application-runtime/src/agents/tool-loop.ts)
- [`packages/application-runtime/src/agents/agent-turn.ts`](../../../../packages/application-runtime/src/agents/agent-turn.ts)
