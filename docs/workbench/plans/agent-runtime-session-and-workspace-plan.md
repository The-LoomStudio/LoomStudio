# Agent Runtime、Session 与 Workspace 能力计划

> **状态**：In Progress / 执行与流式基础已完成；统一写入结果与 UI 待接续，CodeAct 已拆至独立计划
> **日期**：2026-09-13
> **来源**：合并 `agent-runtime-ai-sdk-foundation-plan`、`ai-gateway-streaming-execution-plan` 与 `agent-session-context-and-workspace-capability-plan`

## 目标

统一维护 Agent 的 Provider 调用、Run / Step / Transcript、流式交付、Session Context、Tool Target 和 Workspace 写入能力。

## 已完成

- AI SDK Gateway、Provider-neutral canonical Transcript、Native / Content Tool Transport 与 Agent Loop。
- Agent Profile 的 `stream | complete` 交付偏好。
- 第一方 Agent 流式 Run、事件订阅、取消、暂停、进程内重连和 continuation。
- 暂停时保留已有正文与未完成工具状态；原生思考阶段没有正文时不写入空的正式 Message。
- Timeline Binding 只提供默认 Narrative Context，不代表所有权或权限。
- Workspace Context、Prompt Resource 搜索/读取/更新，以及 CAS、事务和 Changeset 边界。
- Application Data 已统一承载 Agent、Narrative、State 与 Prompt Resource Store；Application Runtime 通过统一 package 消费这些领域 Store，但各领域 schema 与 API 仍保持独立。
- Agent Run 与 AI Gateway RPC 的终态 Run 采用有界保留，最多保留 128 个已结束 Run；运行中的 Run 不参与淘汰。
- `InvokeAgentTurnResult.mutation.scope` 明确返回 changeset 的实际范围；当前 Agent Turn 仍是分阶段提交，不能把最后一个 changeset 解读为整个 Turn 的原子提交。
- State changeset 查询通过 State Store 合同完成，Runtime 不再直接读取 State 私有表；Kernel 的内建 RPC 注册也在停止时释放，支持 `start -> stop -> start`。

## 后续阶段

1. 对接 [CodeAct 与 VFS 独立计划](./codeact-vfs-tooling-plan.md) 的执行结果，复用既有 Run / Step / Transcript；本计划不再定义 Sandbox、工具签名或传输选择。
2. 实现统一写入 Diff：统计修改条目数；存在行数时同时显示行数，并在 Agent Session 消息容器中默认折叠展示。
3. 后续再单独评估跨进程恢复和插件实时 Handler。

## 已确认边界

- 平台提供 AI 能力和规范化数据传输，不替插件处理其领域数据。
- CodeAct 的能力教程与传输分离，权限仍由运行时强制约束；具体合同以独立计划为准，不再预定 JSON Tool 为唯一入口。
- 工具动作、工具调用结果和历史工具调用显示在 Agent Session 的消息容器中，默认折叠；平台保存统一 Invocation / Result / Changeset 事实，不包办业务摘要。
- Session 是 Run、事件和 continuation 的归属；Timeline 不是断线重连或 Run 恢复的身份。
- 没有新用户输入时继续属于 continuation / retry；有新输入时创建新的 User Message 和 Run。
- 原生 Provider 思考内容不作为正文；自定义正文内思维链不由平台猜测解析。
- Agent Run 的内存事件保留必须有明确上限，但 retention 不得淘汰仍可取消、订阅或恢复的运行中状态。

<a id="fr011-failure-recovery"></a>

## FR-011 顺序提交

状态：2026-09-24 已实现并完成定向验证，FR-011 关闭；本计划其他阶段不随之完成。来源为[全仓审查 FR-011](../../archive/issues/full-repo-code-review-2026-08-27.md#fr011)。没有新增另一套 Run 或跨进程恢复机制。

实施前基线（已由下述目标替代）：

- 旧 Runtime 分阶段写 Transcript，回合结束后再自动追加两条 Narrative 节点；成功结果曾区分 `narrative-commit` / `agent-session-transcript`。
- 原最终提交失败日志测试只验证日志，不证明工具结果或重试安全；该失效路径已删除，对应测试改为用户写入与工具提交的实际失败场景，不恢复“整轮同 Changeset”。

已确认目标：

1. 游玩用户提交先写入正式 Timeline 用户正文节点；确认成功后，再把该输入复制到指定 Agent Session，开始 Agent 处理。两步有顺序，不并发，不以乐观节点代替落库成功。
2. Agent 的 Assistant 最后一条消息不自动成为正文。删除回合结束后将用户输入和 Assistant 回复一起追加到 Timeline 的旧路径；Agent 正文只经已授权的写入工具提交。
3. 换 Session 后使用重试/重新投递，把同一已提交用户节点的输入复制到新 Session，不再向 Timeline 重复追加用户节点。这不是复制旧 Session 的完整历史。
4. Agent 工具写入 Timeline 失败（包括分支冲突）必须形成失败 Tool Result，告知 Agent，并向用户呈现失败；未写入不能报告成功。已成功的其他工具修改不因后续失败被伪称回滚。
5. 初始用户正文写入是工具执行前的用户操作：失败时不创建对应 Session 输入/Run，保留输入并向用户报告；不虚构一个从未发生的工具调用或 Tool Result。用户正文已提交而 Session 投递失败时，保留已提交节点，重试仅补投递。

实际实现：Client submitTurn 先调用 `application.appendNarrativeInput` 再创建/选择 Session 和 createRun；固定用户 nodeId 用于响应丢失后的显式重试。幂等写入与原收据读取归 `packages/application-data/src/narrative/store.ts` 的 appendInput，Runtime 不读取领域私有表。invoke 接收 inputNodeId，验证分支路径并采用落库 raw；旧 commit 字段、自动追加及 result.narrative 已移除。已有重试按钮连接当前页最近投递记录，换 Session 可重投递，不清掉期间的新草稿；成功后的 Timeline 刷新读取工具真实写入，无工具写入的回合也允许正常结束。

初次创建 Timeline 后的导航依据已持久化 Timeline 身份，不以 Session 投递成功为前提；投递错误仍报告并保留输入。完成回合后的读取失败单独标记 refresh-failed，只刷新结果，不重跑 Provider/Tool。没有修改 Tool Loop、CodeAct 或 Preset 设计。

验收：验证用户节点持久化早于 Session 投递；初始写入失败不投递；投递失败后或换 Session 后重试不重复创建用户正文节点；无工具写入的 Assistant 回复不产生正文；工具追加成功有真实节点/Changeset，分支冲突及存储失败返回失败 Result，Agent 与用户均可观察。旧“回合结束后提交失败”的用例必须随失效入口删除或改成当前链条的等价失败验证，不能仅改期望值掩盖缺陷。

原待决定的“最终追加失败是否单独重试”已失效，不再建设该恢复机制。工具历史回放及 Narrative 基线冻结分别归[上下文计划第17节及第13节](./agent-context-skeleton-and-memory-projection-plan.md)，不是本项是否完成的替代证据。

验证：后端 agent-session、native-tool-loop、macro-provider、codeact-tool-loop、agent-turn-rpc、logging 六个文件73项通过；将私有 SQL 移入 Store 后，仅重跑追加/HTTP四项通过、24项非目标未执行。主 Agent 的 Client 提交/重试/选择最终三文件59项通过，另一个四文件43项批次覆盖重试控件、RPC 路由和真实 SQLite 生命周期（部分用例与前批重叠，不相加为唯一用例数）。Application Data/Runtime 编译、Server/Client noEmit 及后端相关测试类型检查通过。

主测试类型检查仍失败，仅有并行消息渲染工作 `tests/unit/client/display-projection.test.ts:50,55,65` 的 QueryOptions/QueryObserverOptions 三条诊断，未修改对方文件或声称全仓绿灯。浏览器工具认证故障仍在，未做实际浏览器点击/视觉验收；当前页重试记录不是跨刷新持久的 attempt tree，已有节点和 Session/Transcript 本身按原 Store 持久化。

## 游玩分支与 Session 生命周期

2026-09-21 用户收束方向：废弃剧情不应继续进入游玩 Agent 的工作上下文。首版从历史节点新开剧情分支时，创建新的空白 Agent Session，不复制旧 Transcript、工具观察、工作摘要或运行态 Pin。原 Session 保留供用户查看，不由 Agent 回滚或删除。

新 Session 仍需构建所选分支的 Narrative、State 与合法记忆，不等于没有作品上下文。只采用覆盖范围在该分支分叉点之前且仍有效的记忆；包含废弃未来的摘要不能因换了 Session 就继续沿用。

这项用户级工作流可以组合分支创建与 Session 创建，但不把两棵历史树合并成一个数据模型。精确地从旧 Session 检查点分叉、TMP/资源覆盖快照及完整工作树语义延期；不作为首期前提。切回已有分支时是否恢复其原 Session，仍待生命周期讨论。

只读核对（2026-09-21，非完整调用链验收）：

- `packages/application-runtime/src/runtime/narrative-runtime.ts` 的 `forkNarrativeBranch` 根据分叉节点/当前 Head 选择 State Revision；`switchNarrativeBranch` 切换活动分支。这两个 Runtime 方法没有创建 Session。
- `packages/application-runtime/src/runtime/agents-runtime.ts` 的 `createAgentSession` 独立创建会话，接收 Profile 与 Timeline；准备回合时分别读取 Narrative 分支内容及指定 Session 历史。因此不能假定底层分支操作已经保证工作上下文隔离。
- 首期还需明确分支与活动 Session 的选择关联、实际交互入口编排，以及旧 Run/延迟结果不能混入新分支的处理。上述事项归本计划，不放进 CodeAct 工具实现。

会话膨胀分开处理：新 Session 不继承旧历史，可以限制单次输入增长；持久会话数量、列表展示和存储占用仍会增长。按作品/分支分组、归档旧会话是后续候选，不自动删除历史，也不以复制一份旧摘要解决跨分支污染。单个长期游玩 Session 内的工作记忆压缩归上下文投影计划。

## 非目标

本阶段不实现跨进程恢复、插件 SDK 的实时 Handler 映射、通用审计平台、任意文件系统权限或 CLI/MCP。CodeAct Sandbox 与 VFS 实施归独立计划，不在此建立平行实现。

## 完成标准

同一套 Agent Run / Session 合同覆盖流式与非流式调用；暂停、取消、继续和新消息语义可从持久化 Transcript 与 Run 状态解释；CodeAct 写入结果以条目数和可用行数呈现，Diff 组件在输入框顶部与 Agent Session 末尾使用同一事实，且不扩大平台或工具自身的领域责任。

### 已实现基础设施约束

后续 CodeAct、统一写入 Diff 和跨进程恢复设计必须复用上述 Run retention 与 mutation scope 合同，不新增第二套 Run 生命周期或假设整个 Agent Turn 由单一事务提交。Application Runtime 继续负责跨领域编排，Store 负责领域数据与 schema，Server / Kernel 负责进程级组合和释放。
