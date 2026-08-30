# Agent Run 可观测性计划

> **状态**：Draft / Discussion Capture
>
> **主题**：Agent Run / Runtime 的系统日志、Runtime Transcript、Trace、Audit、前端 Inspector 与后端 TUI 边界。
>
> **依赖**：[日志与可观测性总计划](README.md)

---

## 1. 核心判断

Agent Run 可观测性不能用一条普通日志流代替。

必须区分：

| 数据 | 语义 |
|---|---|
| System Log | Runtime 生命周期与基础设施摘要 |
| Runtime Transcript | Agent 工作消息、ToolCall / ToolResult、候选与用户指导 |
| Run Trace | Step、Provider、Tool、Commit、Retry 等执行因果链 |
| Audit | 外部调用、权限、破坏性写入和拒绝事实 |
| Narrative Timeline | 用户接受的作品产出 |

基本方向保持不变：

```text
Agent 工作内容进入 Runtime Transcript。
剧情产出只有通过受控 commit 才进入 Narrative Timeline。
失败或 discarded Run 不应自动污染 canonical narrative。
```

默认 ephemeral prompt projection 只表示下一轮不默认投影完整历史 Run Transcript，不代表删除 Transcript、Trace 或 Audit。

---

## 2. 当前基础

现有模型已经具备：

- Run status；
- RuntimeEntry；
- CommitCandidate；
- Runtime Transcript / Narrative Timeline 分离方向；
- ToolCall / ToolResult 作为 transcript 一等条目的方向；
- commit / review / write 与 discard / retry / abort 讨论；
- Run Changeset、Run Memo、Prompt Projection Policy 候选；
- correlationId、callId、traceId、changesetId、auditId 的总体关联设计。

仍缺少：

- Run 生命周期结构化 Log 的正式范围；
- Step / Provider / Tool / Commit 的 Trace envelope；
- Runtime Transcript 与 Log / Trace 的引用协议；
- 敏感 Provider 内容、ToolResult 和 Agent 工作内容的保存策略；
- 前端 Run Inspector 与 TUI 摘要视图的正式分工。

---

## 3. 系统日志范围

候选命名空间：

```text
runtime.run
runtime.step
runtime.provider
runtime.tool
runtime.commit
runtime.projection
```

系统 Log 记录生命周期摘要，不记录完整工作内容：

```text
run.created
run.status.changed
run.completed
run.failed
run.discarded

step.started
step.completed
step.failed

provider.request.started
provider.request.completed
provider.request.failed

tool.call.started
tool.call.completed
tool.call.failed

commit.candidate.created
commit.accepted
commit.rejected
commit.failed
```

候选摘要字段：

```text
runId / stepId
sessionId / branchId
agentRuntimeProfileId / modelProfileId
provider kind / model id
tool name / call id
commit candidate id
status / outcome
durationMs
token usage summary
retry count
traceId / changesetId / auditId
correlationId / callId / parentCallId
```

Agent、Session、Card、Tool 等用户自定义显示名按私密元数据处理。普通 Run Log 保存稳定 ID 与类型；需要可读名称时由授权 UI 临时解析，不写回日志或导出。

Log 不保存：

- 完整 Agent message；
- 完整 Prompt；
- 完整 Provider response；
- 完整 ToolResult payload；
- Chain-of-Thought；
- API key、Authorization header 或 Secret；
- 完整 Narrative candidate 正文。

这些内容如有必要，应进入各自受控数据模型，并由权限、保留期和 redaction policy 管理。

---

## 4. Runtime Transcript

Runtime Transcript 是 Agent 工作过程的领域记录，不是日志文件。

它可以包含：

- 用户对当前 Run 的输入或侧栏指导；
- Agent 工作消息；
- Provider response 的可保存表示；
- ToolCall / ToolResult；
- runtime note；
- 子 Agent 结果；
- candidate output；
- error / suspension / discard note；
- compose trace、provider audit、tool audit、changeset 的引用。

Runtime Transcript 需要稳定引用：

```text
runId
entryId
stepId?
parentEntryId?
traceId?
toolCallId?
commitCandidateId?
```

大型 ToolResult 或读取内容不应无限 inline 保存。优先保存：

```text
execution fact
result summary
document / asset / blob reference
content hash / size
redaction metadata
```

是否投影 Transcript 到下一轮 Prompt，由 Runtime Profile / Projection Policy 决定，而不是由 Log retention 决定。

---

## 5. Run Trace

Run Trace 负责解释“为什么 Runtime 走到了这里”。

候选阶段：

### 5.1 Run Lifecycle

- Run 创建原因；
- 当前 Runtime Profile；
- 输入来源；
- 状态迁移；
- completed / failed / discarded / suspended 原因；
- Retry / Reroll / Abort 关系。

### 5.2 Prompt Projection

- 当前 Step 选择了哪些 Runtime Transcript entries；
- 哪些 Narrative / Setting / Dynamic Mount source 进入 PromptBuild；
- 关联 PromptBuild buildId / traceId；
- 为什么没有投影历史 Run Transcript。

Prompt 具体 composition 细节仍由 PromptBuild Trace 负责，Run Trace 只保存选择与关联。

### 5.3 Provider Call

- Provider / Model binding；
- request started / first chunk / completed 时间；
- duration / time to first token；
- input / output token usage；
- normalized finish reason；
- error / timeout / cancellation；
- PromptBuild trace ref；
- provider audit ref。

默认不保存完整 request body、response body 或秘密 header。

### 5.4 Tool Execution

- ToolCall identity、tool name、owner；
- caller Agent / Run / Step；
- permission / consent decision；
- started / completed / failed；
- result summary / payload ref；
- 是否进入后续 Prompt Projection；
- Audit ref。

### 5.5 Commit / Mutation

- CommitCandidate 创建来源；
- validation / review / confirmation；
- accepted / rejected / revised；
- Narrative append / patch；
- State patch / Setting patch；
- RunChangeset / changesetId；
- rollback / discard 边界；
- Audit ref。

Run Trace 必须清楚表达：普通 Provider assistant output 不等于 canonical Narrative commit。

---

## 6. Chain-of-Thought 与敏感内容

系统不得把隐藏 Chain-of-Thought 当作日志、Trace 或 TUI 功能目标。

允许保存和展示的是：

- 用户可见的 Agent message；
- Runtime 明确定义的 plan / status / note；
- Step 类型与状态；
- ToolCall / ToolResult；
- Provider usage、latency、finish reason；
- CommitCandidate 与受控输出；
- 结构化的 decision reason，例如 permission denied、retry policy matched。

不应保存或展示：

- 模型未显式输出给用户的内部推理；
- 为调试而猜测或重建的“思考链”；
- 未脱敏的 Prompt、Secret、Authorization header；
- 无上限的大型读取结果、二进制内容或外部响应。

如果 Provider 返回显式 reasoning content，也必须由 Provider Adapter 标注能力与敏感级别，并经过独立的保留和展示策略；不得默认进入普通 Log。

---

## 7. 前端与 TUI 分工

### 7.1 Studio Client

前端负责完整的 Application 语义：

- Run 列表与状态；
- Runtime Transcript；
- Step timeline；
- ToolCall / ToolResult 卡片；
- CommitCandidate review；
- PromptBuild Trace 跳转；
- Narrative commit 与 changeset 关联；
- Retry / Reroll / Abort / Discard 的用户交互；
- 权限确认与 Diagnostic。

### 7.2 Backend TUI

TUI 只展示后端与运维摘要：

- active / queued / failed Run 数量；
- 当前 Run ID、状态和持续时间；
- Provider 延迟、Token 和错误率；
- Tool 执行数量与失败摘要；
- commit / changeset / audit ID；
- namespace 日志；
- 点击或复制关联 ID，供前端 Inspector 深入查看。

TUI 不编辑 Narrative、不承担 Commit review、不展示完整 Agent 工作对话，也不复制前端 Agent Panel。

---

## 8. Notification 策略

适合产生 User Notification：

- 用户主动启动的 Run 完成；
- 后台 Run 失败或被挂起等待处理；
- Provider 连接中断；
- Tool 请求用户确认；
- Commit 等待 review；
- Run 因权限或安全策略被拒绝。

不适合产生 User Notification：

- 每个 Step 开始 / 完成；
- 每个 Token chunk；
- 普通 ToolResult；
- 正常 Prompt Projection；
- debug/info 生命周期日志；
- 正常 ephemeral transcript archive。

当前操作附近已经有明确状态条或确认面板时，不应重复弹 Toast。

---

## 9. 实施阶段

### Phase AR-1：Run 生命周期日志

- 接入 `runtime.run`、`runtime.provider`、`runtime.tool`、`runtime.commit` namespace；
- 记录 started / completed / failed / discarded 摘要；
- 贯穿 runId、stepId、traceId、correlationId；
- 保持完整内容不进入系统 Log。

验证：仅查看日志即可知道 Run 在哪个阶段失败，并能取得关联 ID。

### Phase AR-2：Run Trace Envelope

- 建立 Run -> Step -> Provider / Tool / Commit 的因果结构；
- 关联 PromptBuild Trace；
- 关联 Audit、Changeset、Diagnostic；
- 记录 retry / abort / discard 原因。

验证：可以回答“这次剧情为什么没有 commit”或“这次 ToolResult 为什么进入下一轮 Prompt”。

### Phase AR-3：Transcript 引用与内容策略

- 稳定 RuntimeEntry 与 Step / Tool / Commit 的引用；
- 大型 payload 改用 summary + reference；
- 增加 redaction 与权限；
- 保持 Transcript archive 与 Prompt Projection Policy 分离。

验证：完整工作记录可审查，但不会使 Log / Prompt / Document 无限膨胀。

### Phase AR-4：前端 Run Inspector

- 实现 Run timeline、Transcript、Tool、Commit 和 Trace 关联；
- 支持按 status / step / tool / correlation 查询；
- 明确 Narrative Timeline 与 Runtime Transcript 的 UI 边界；
- 接入通知与等待确认状态。

验证：常见 Runtime 问题无需阅读后端 stdout；用户也不会把 Agent 草稿误认为已提交剧情。

### Phase AR-5：TUI 摘要

- 展示 Run / Provider / Tool 的后端统计与生命周期；
- 复用系统日志、Metric 与 Trace refs；
- 不复制前端工作区。

验证：TUI 能快速发现后端故障，深入分析仍通过前端 Inspector 或结构化历史查询完成。

---

## 10. 非目标

- 不把 Runtime Transcript 存进普通 JSONL Log；
- 不把 Narrative Timeline 当作 Agent Log；
- 不保存或展示隐藏 Chain-of-Thought；
- 不让 TUI 成为 Agent 工作编辑器；
- 不让 Prompt Builder 决定 Runtime loop、retry、tool 或 commit；
- 不为每个 Step 发送 Toast；
- 不在第一版建立复杂分布式 tracing backend。

---

## 11. 待确认事项

1. Runtime Transcript 是单个 Document、Run Document 的子结构，还是独立 entry documents；
2. discarded Run 的 Transcript 默认保留期与可见性；
3. Provider response 哪些部分允许持久化；
4. 大型 ToolResult 的 storage / asset reference 形式；
5. Step identity 与 RuntimeEntry identity 的稳定关系；
6. Run Trace 进入现有 TraceAuditStore，还是需要 Application 专用 Store；
7. Run completed 的 success notification 默认是否启用；
8. TUI 是否只查看本地 Run，还是未来支持 remote server。

相关文档：

- [AIRP Runtime Model](../../discussion/application/airp-runtime-model-v0.md)
- [Agent Runtime Loop](../../discussion/application/agent/agent-runtime-loop-v0.md)
- [Runtime Policy](../../discussion/application/agent/runtime-policy-v0.md)
- [Tool Capability](../../discussion/application/agent/tool-capability-v0.md)
- [Runtime Turn Flow](../../discussion/application/runtime-turn-flow-v0.md)
- [Agent Panel Rendering](../../discussion/application/ui/agent-panel-rendering-v0.md)
- [Trace / Audit / Correlation](../../../archive/discussion/data/studio-trace-audit-correlation-v0.md)
