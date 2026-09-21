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
