# Agent Runtime 与 Session

## 1. 身份与绑定

`AgentSession` 是一次 Agent 工作上下文的持久化身份。它直接引用 Agent Preset，不在 Session Header 中复制编排、Provider 或 Tool 配置。

```text
AgentSession.agentPresetId
  -> PromptResource（resourceKind: preset）
     -> rootNode / macros / historyPolicy
     -> model / delivery
     -> useCardLore / textUses / Lore Mount
     -> Preset Tool Mount
```

不存在独立 Profile 或 Profile → Preset 选择关系。预设 Tool Mount 决定工具使用配置；特殊 Timeline Session 额外提供当前正文模式所需的声明工具，并隐藏追加正文工具；模型绑定可空，但预览和执行需要模型时明确报错。

普通 `kind: agent` Session 固定引用预设。特殊 `kind: timeline` Session 与 Timeline 同 ID，可暂未选择预设；执行前必须有可用预设及模型。通过 `updateAgentSession` 修改预设或 `narrativeMode` 时，Store 拒绝最新 Run 为 `created`、`running` 或 `suspended`，以及 `failed` 且仍带 `recovery` 检查点的情况；不能将规则泛化为所有 `failed` Run 都禁止修改。允许修改后仍消费同一工作历史。预设身份不冻结资源内容，后续调用仍读取当前配置。

故事不存在单独选择的主接收方。主输入框的扮演和讨论均投递同 ID Session；右侧选择、创建和观察普通副 Session 独立于故事执行。绑定 Timeline 不代表自动拥有全部故事数据或工具权限。普通 Session 列表默认排除特殊 Session；删除故事统一清理根会话，普通会话删除接口拒绝删除根会话。

Header 保存 `kind`、可选预设、正文模式、可选 `timelineId`、title、采用的 Entry Head 和全局单调 Entry count。Branch 保存自己的 Entry Head；切换只改变采用位置，不降低写入计数，也不重放工具副作用。Header 不保存完整 Loop KV 或 Provider wire message array。

Agent Store v6 只将旧引用列改名为 `agent_preset_id`，不重写 Transcript 或 State。按本轮开发数据迁移约定，不转换旧 Profile 配置或猜测重绑定；旧引用若找不到同 ID 的预设，执行明确失败，历史仍可读取。旧 Profile RPC 已移除。

## 2. Canonical Transcript

Agent Transcript 是 append-only 运行事实序列。当前 Entry 包括：

| Entry | 语义 |
|---|---|
| `message` | 用户或 Assistant 内容；`purpose: narrative` 为正文，讨论及工作回复不进入正文投影；逻辑续段共享 `narrativeId` |
| `reasoning` | 带来源、可见性与 replay 策略的推理内容 |
| `request-measurement` | Provider 请求前尝试记录的输入 Token 估算，含请求摘要、Provider Step、计数基准与未计入项；估算和落库均为 best-effort，不同于供应商实际 Usage |
| `provider-observation` | Provider、Model、Call ID、Stop Reason 与 Usage |
| `tool-invocation` | Studio Invocation ID、Tool、Transport、输入与执行状态 |
| `tool-result` | Invocation 配对结果、内容、错误与 synthetic reason |
| `run-state` | Run 的 created / running / suspended / terminal 状态 |
| `work-summary` | 已保存的工作交接，显式压缩边界之前的 Transcript 保留但退出后续 Prompt，近期完整工作段继续使用 |

Transcript 不绑定 OpenAI Chat Completions wire schema。Provider Replay 是 Runtime 根据 canonical Entry 和原始 Invocation Transport 生成的下一步输入投影。

Turn Preparation 按 100 条分页选择与当前来源相容的 `work-summary`，按其显式压缩边界保留尾段；没有有效摘要时读取原工作段，不把分页当作静默裁剪。副 Session 的 Narrative 输入读取记忆来源发布范围，未配置来源的旧路径读最新 100 节点并诊断；特殊 Session 按采用路径合并原生工作消息和未被剧情总结覆盖的 canonical 正文，按 Entry 身份去重。工作摘要退休不会隐藏未被剧情摘要覆盖的正文。正文与工作消息分别走各自文本规则，工具协议不被正则改写。Session 自动整理见下文；这些读取不等于剧情摘要、Provider 容量保证或未完成任务的跨进程恢复。

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
- 无工具调用且 `length` 仍有正文：保存 partial 并继续；`length` 没有有效正文时明确停止，避免无进展续跑；
- 无效 Native Tool 调用：记录失败工具结果，交回模型纠正，不执行对应工具；
- `error` 或其他缺少正文/工具调用的结果：失败；
- AbortSignal 或取消错误：中止。

因此 Content Tool 即使随 Provider `stop` 返回，也不会被误判为最终完成。Agent 不设置固定 Provider Step 次数上限，也不设置统一的单工具 30 秒超时；由模型完成响应或用户暂停、取消结束执行。恢复沿用已有 Step 编号，不因原第 8 轮门槛再次停止。提供商或具体工具自身的请求策略仍由其实现负责。

同一 Provider Step 当前不接受 Native 与 Content 两类 Invocation 混合出现。Content Invocation 按出现顺序串行执行。

## 4. Result Replay

Tool Result 的 canonical 身份不随 Provider 改变。Native Function 使用 Provider `tool` result message，并引用 Provider Tool Call ID；Content Tool 使用 Runtime 生成的普通 `user` content block，不伪造 Provider Tool Call ID，也不改变 canonical ToolResult provenance。

失败、拒绝、Abort 和 Timeout 都返回 ToolResult，而不是把已执行调用留成无结果状态。

Agent 主动读取与 ToolResult 的生命周期由 Runtime 管理，不等于 PromptBuild 的第三种注入语法。Anchor / Slot、正文宏与主动读取之间的边界见 [注入与内联展开](../prompt-build/injection-and-inline-expansion.md)；持续 Pin 的保留策略仍属于 Agent 侧的待实施设计。

`completeAgentSessionHandoff` 保存已生成的工作摘要，不负责生成摘要。计数 CAS 和 Store 内的安全边界校验保证不会在运行 / 暂停的 Run 或未完成工具组中提交交接。提交后旧段退出投影，摘要进入 `@memory.session`，原始记录仍可查询；后续 resume 不复活交接前的失败任务。剧情采用通知与失败收据见 [默认剧情上下文来源](../extension/narrative-context.md)。

`session-summary.ts` 沿当前 Session 的固定上下文执行自我交接，仅任务期间开放提交工具；支持全文替换/patch、5000 Token 默认上限、可配置缓冲及同步/异步。来源与历史压缩边界由宿主确定，结果和共享 MEMORY 在安全边界通过同一事务采用；失败不清理历史。正常游玩在下一条正式正文输入持久化后触发；无楼层 Session 在下一输入前检查上轮 Token 压力。已采用版本持久化，未采用任务重启后丢弃。默认共享文件通过 `@memory.workspace` 注入，摘要通过 `@memory.session` 注入；自定义 Preset 需显式挂载锚点。具体接口、调度默认值和验证边界见 [实施记录](../../../archive/plans/session-summary-implementation-plan.md)。


## 5. 持久化与恢复边界

Canonical message、Tool Invocation / Result、恢复检查点与 terminal Run State 分阶段执行必要提交；这些写入失败不会作为观测故障被忽略。请求 Token 估算、`request-measurement` 与 `provider-observation` 的落库及对应通知则是 best-effort：失败不重试或阻止模型调用，也不回滚已完成步骤。Transcript 因而可能缺少计量或供应商 Usage，不能据此判断请求没有发生或将缺失值当作零。

Server 的 Run 事件重放使用绝对游标、单 Run 1 MiB / Runtime 总计 8 MiB 的序列化预算；游标过期时显式重新同步 Transcript 和当前流式状态。完整完成结果包含 Inspector 的 Prompt Projection / Build Trace，不等同于可丢弃的事件历史：前端收到并发布 `lastRun` 后调用 `application.agent.run.acknowledge-completion`，释放独立的待交付引用；普通大小的结果仍可留在有界事件重放中。未确认的完成结果最多保留两分钟，期间不因事件预算或终态元数据淘汰而提前丢弃。此必要交付状态可能暂时超过重放字节预算；这些预算不是整个进程的硬 heap 上限，也不是历史 Trace 的持久化合同。

### 显式冷恢复

Run 状态记录中的版本化 `recovery` 保存原请求、实际 Branch、Provider/Model 身份、用户 Entry、完整消息、工具合同和下一 Provider Step。首个运行状态与 user 同事务写入；工具组开始前记录不安全边界，完整工具组的最后结果与下一检查点同事务写入；最终 Assistant 与 completed 同事务提交。失败时已取得的 partial 文本和对应检查点也同事务保存。它不是 Provider 端 HTTP 请求或流的断点续传。

`application.agent.run.resume` 在缺少内存实例时，通过 Runtime 分页读取完整工作记录，校验检查点后重建，不再用最近 100 条和一段提示词猜测原请求。原 user、已接受消息和已完成工具结果保留，不重新执行已完成的工具组。续跑使用该 Session 绑定的 Preset 当前模型配置，不冻结为 checkpoint 中的旧模型；当前绑定缺失或不可用时明确失败，不自动选择替代模型。Runtime 重新编译并校验工具合同，合同变化时拒绝恢复。下一 Step 编号沿用检查点，不从第一步重跑。

检查点还保存 `promptExtensionLeases`：Prompt 准备及工具间接读取的故事扩展来源凭据。
恢复前复核原始安装版本和采用代次；暂停再启用不能让旧 Prompt 重新获得资格。
运行中每个 Step、工具写入和最终输出也受相同约束，详见 [Timeline 扩展采用](../extension/timeline-participation.md)。

接管前确认原执行者不再运行：当前进程使用实际执行登记，其他 PID 仅在探测明确返回不存在时允许恢复；进程仍存活或权限不足以判断时拒绝。没有分布式租约或跨机器接管。旧 Run 终结和新 Run 开始在同一事务完成，并校验读取检查点时的 entryCount；Store 的 Session busy 保护不移除。只有用户显式继续才会调用 Provider，初始化不自动续跑。

缺少完整检查点的旧 Run、未确定结果的工具组或已被新输入/交接替代的检查点不能自动重建。错误明确区分缺失、损坏、执行者仍活跃、工具结果未知和上下文已改变。已发到 Provider 但尚未持久化的响应可能需要在显式恢复时重新请求；不承诺 Provider 端仅计费一次、任意崩溃点无损恢复或自动重做不确定工具。

以下能力仍未完成：

- 缺少完整检查点时，仅凭历史 Transcript 自动重建未完成 Provider Replay；
- Permission 等待与恢复；
- orphan Invocation / Result 自动修复；
- 普通副 Session 的独立 fork 和 retry attempt tree；故事特殊 Session 已通过 Branch / Swipe 恢复采用位置。

`suspended`、parent Entry 和 synthetic reason 不表示这些额外流程已经实现。

## 6. Narrative 边界

特殊 Timeline Session 持有唯一内容历史。Narrative Header、分支、楼号、材料版本和 `entryId` 正文索引保留；索引不再保存第二份正文。副 Session 仍独立持有自己的过程，通过正文只读 API 采样不会获得主会话工具记录。

`application.appendNarrativeInput` 原子提交 canonical user message 与正文索引，并开启轮次；随后以 `narrativeTarget.inputNodeId` 启动 Run。Loop 复用已保存 user Entry，投递失败保留输入且不重复追加。讨论直接向同 Session 发消息，归当前轮次；首轮前属于准备阶段。

声明式模式提供 `declare_narrative`，只声明下一条完整普通 Assistant 内容为正文，采用后允许继续调用工具，未声明的普通回复结束 Run。自动模式只在扮演执行中采用普通 Assistant 文本；讨论回复、工具 JSON 与 reasoning 不进入正文。partial / length 续段保存逻辑身份，完整消息与正文索引同事务采用，checkpoint 保存声明的消费状态。编辑仍使用已有正文编辑能力，不改写历史工具事实。

一轮包含扮演输入及下一次扮演前的所有 Run、指导和修订；Swipe 切换整段采用位置，同时恢复 State / Workspace。旧楼层 Fork 共享既有工作前缀。辅助执行携带固定来源与采用游标；候选或内容版本变化后拒绝过期写入。辅助会话的有效工作历史和工作摘要同样按来源过滤，原始事实保留。

剧情总结和工作总结独立。特殊 Session 的工作缓冲按完整轮次保留，普通副 Session 沿用原正文楼层映射；退休边界与并发用全局计数分开。`loom-timeline-archive.v2` 保存所有根会话事实（含旁支）、采用 Heads、候选和恢复引用；导入仅重映射宿主引用，不执行工具，v1 仍可导入基本正文。旧开发故事升级只建立正文消息引用，不补造旧协作历史。

## 7. Narrative Sampling（叙事采样读取）

在双向交互与智能体自主编排场景中，Agent 能够通过 `NarrativeSampler`（`packages/application-runtime/src/narrative/sampling.ts`）在受控范围内主动采样读取当前授权 Timeline 的历史正文：

- **选择模式**：Agent 的 `ctx.readNarrative` 使用分支内楼层地址：`floors` 接收闭区间 `from / through`，`tail` 接收 `count` 和可选 `throughFloor`，`range` 接收 `afterFloor / throughFloor` 开闭区间。底层 Sampler 仍支持宿主使用节点 ID 指定边界，CodeAct 不接受这些节点 ID 字段；
- **有界预算控制**：单次采样严格限制上限（默认最大 1,000 节点、2,000,000 字符），按完整节点缩减返回集合，不切碎单个节点正文。预算不足但已有节点可返回时，CodeAct 返回 `complete: false`、可选 `nextBeforeFloor` 与每个节点的 `floor / path`；若首个待选节点本身就超过字符预算，明确失败，不返回该节点的部分正文。离散缺号通过 `missingFloors` 说明；底层结果还可携带节点 ID 游标，不能将其作为 Agent 调用参数；
- **只读非阻塞**：采样仅基于已提交的节点只读展开，不修改 Timeline 的 Branch Head，不推进 Memory 指针，也不触发任何 Narrative 追加。

## 8. 实现来源

- [`packages/application-data/src/agent/types.ts`](../../../../packages/application-data/src/agent/types.ts)
- [`packages/application-data/src/agent/store.ts`](../../../../packages/application-data/src/agent/store.ts)
- [`packages/application-runtime/src/narrative/sampling.ts`](../../../../packages/application-runtime/src/narrative/sampling.ts)
- [`packages/application-runtime/src/agents/tool-loop.ts`](../../../../packages/application-runtime/src/agents/tool-loop.ts)
- [`packages/application-runtime/src/agents/agent-turn.ts`](../../../../packages/application-runtime/src/agents/agent-turn.ts)

### 中断状态与审批恢复

Session 恢复先查询服务端 Run 状态，再决定重新观察或显示暂停操作。持久化的 `running` 不足以证明执行器仍在运行。状态读取与放弃任务只需要确认原执行器停止及 Transcript CAS，不要求检查点可重放；继续执行仍保留完整检查点校验，工具副作用不明时拒绝重放。

工具调用没有配对结果时，正在运行的任务显示“执行中”；明确暂停、取消、放弃或其他终态显示“已中断”。此显示不补造工具结果，不代表回滚了已提交副作用。网络观察失败保留断连恢复入口，不自行判定后台暂停。

### 发送确认与请求身份

Studio 三个 Run 发送入口为每次提交生成 `requestId`；确认失败后，同一 Session 中相同请求的显式重试沿用该 ID，确认成功后下一次发送生成新 ID。服务端以其确定初始 Run 身份，校验规范化请求摘要；同 ID、不同参数明确拒绝。

存活 Run 由内存记录去重；重启或记录回收后，使用已有 Session/Run 索引查询首个持久检查点中的发送摘要，不扫描整个 Transcript，不重放工具。没有保存检查点的准备阶段失败不等同于已有可恢复 Run。找回停止进程的 Run 后通过已有状态/Transcript 恢复，不自动续跑模型。恢复产生的 continuation 仍使用新的 Run ID。
