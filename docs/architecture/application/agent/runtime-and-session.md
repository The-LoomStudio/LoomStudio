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

Session Header 当前只保存 Session ID、Agent Profile ID、title、active head Entry ID、Entry count 和生命周期时间。Header 不保存完整 Loop KV，也不把 Provider message array 作为权威状态。

## 2. Canonical Transcript

Agent Transcript 是 append-only 运行事实序列。当前 Entry 包括：

| Entry | 语义 |
|---|---|
| `message` | 用户或 Assistant 正文 |
| `provider-observation` | Provider、Model、Call ID、Stop Reason 与 Usage |
| `tool-invocation` | Studio Invocation ID、Tool、Transport、输入与执行状态 |
| `tool-result` | Invocation 配对结果、内容、错误与 synthetic reason |
| `run-state` | Run 的 created / running / suspended / terminal 状态 |

Transcript 不绑定 OpenAI Chat Completions wire schema。Provider Replay 是 Runtime 根据 canonical Entry 和原始 Invocation Transport 生成的下一步输入投影。

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

Agent-only Turn 只写 Agent Session。绑定 Narrative 且显式提交时，Agent Message 与 Narrative Node 可以由 Application Runtime 放入同一个 Data Engine transaction / Changeset；这仍不把两个领域合并成同一 Session。

## 7. 实现来源

- [`packages/agent-store/src/types.ts`](../../../../packages/agent-store/src/types.ts)
- [`packages/agent-store/src/store.ts`](../../../../packages/agent-store/src/store.ts)
- [`packages/application-runtime/src/agent/tool-loop.ts`](../../../../packages/application-runtime/src/agent/tool-loop.ts)
- [`packages/application-runtime/src/agent-turn.ts`](../../../../packages/application-runtime/src/agent-turn.ts)
