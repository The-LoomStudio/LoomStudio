# 周期性代码审查

> **状态**：Active Review Ledger
> **最后审查时间**：2026-08-10 12:30
> **审查基线**：ea7b4c6c29075af2f5734f2343ef1e3d90018a1f
> **当前分支**：codex/backend-runtime
> **审查目标**：Session Turn 提交、RPC 持久化与 Client 状态回写链路

## 最近覆盖记录

只保留最近 12 次记录，超出后删除最旧记录。

| 日期 | Commit | 审查目标 | 选择原因 | 结果 |
| --- | --- | --- | --- | --- |
| 2026-08-10 | `ea7b4c6` | Session Turn 提交、RPC 持久化与 Client 状态回写链路 | 近期提交实质修改了 Session Runtime、分域异步状态和通知；该链路跨越用户输入、Provider 调用、事务写入与 UI 回写，且上次未覆盖 Client 成功后的恢复路径 | 新增 1 个 P1：Turn 已提交后若后续 Timeline 刷新失败，Client 清空草稿但仍展示旧 Timeline，并将已成功写入的操作表现为失败 |
| 2026-08-03 | `f6253b8` | Document Store 写入、Commit Fact 与 Kernel 事件传播链路 | 最近提交及当前工作区对事务、SQLite migration、Commit observer、Application/Extension 写入传播进行了实质修改，链路涉及持久化原子性与公共事件边界 | 未发现新的可报告问题；既有 Logging P1 当时保持不变，已于 2026-08-07 复核关闭 |
| 2026-07-27 | `383f3a1` | Studio 日志查询与展示链路 | 最近两次提交新增并整理了结构化日志、`logs.list` 与 Logs Workspace，且链路涉及敏感信息与故障可见性 | 新增 1 个 P1：超过 500 条后 Viewer 无法访问最新 Server 日志 |

## 当前开放发现

### P0

无。

### P1

#### Turn 已提交后刷新失败会清空草稿并保留旧 Timeline

- **状态**：Open
- **首次发现**：2026-08-10
- **最后验证**：2026-08-10
- **位置**：`apps/studio-client/src/features/session-runtime/model/use-session-runtime.ts:79`
- **相关符号**：`useSessionRuntime.submitTurn`、`refreshTimeline`、`useAsyncOperations.run`
- **触发条件**：`application.submitTurn` 已成功返回并完成服务端事务，但紧随其后的 `application.getTimeline` 因瞬时网络、Bridge 或 Server 读取错误失败。
- **完整链路**：用户提交 Composer → `ChatComposer` 在 Session pending 时禁止重复提交 → `useSessionRuntime.submitTurn` 调用 typed `turns.submit` → Studio RPC 校验参数并调用 `ApplicationRuntime.submitTurn` → Provider 返回后，Run、user/assistant Narrative Entry、Commit Candidate、State Snapshot 与 Branch Head 在同一 Document Store transaction 中提交 → RPC 返回新 Branch 和两条已接受 Entry → Client 立即删除当前分支草稿并清空 Composer → Client 再串行调用 `getTimeline`、`getAgentTranscript`、`getSession`、`getRun` → 若首次 `getTimeline` 失败，`useAsyncOperations.run` 捕获错误并展示通知，但不会应用 RPC 返回的 Entry、恢复草稿或安排重新同步。
- **实际影响**：服务端已经接受并持久化该回合，Client 却仍展示提交前的旧 Timeline，同时输入内容已经消失并出现失败通知。用户无法从当前界面判断操作是否成功，重新输入并发送可能形成语义重复；不重发则要通过切换或重新打开 Session 才能看到已提交内容。
- **现有防护检查**：服务端 transaction 保证写入不会部分提交，Branch 使用 `expectedVersion` 防止并发覆盖；Client 的 `sessionBusy` 防止同一页面重复点击；`runLatest` 只用于 Session 激活，不用于 Turn 提交；通用异步状态只记录错误和 pending，不执行补偿或重取。`SubmitTurnResult` 已包含新 Branch 与 user/assistant Entry，但 Client 仅先使用 Branch，未用 Entries 更新 Timeline。当前 Session Runtime 测试只覆盖草稿 key 与 Branch 解析，没有覆盖提交成功后刷新失败。
- **验证证据**：`use-session-runtime.ts:83-100` 在 submit 成功后先于任何刷新删除草稿并清空输入，随后串行刷新；`use-async-operations.ts:18-28` 将后续刷新异常折叠为整个 action 的失败且不回滚前序状态；`packages/application-runtime/src/runtime.ts:635-824` 证明写入已在 RPC 返回前原子提交；`packages/application-runtime/src/types.ts:521-530` 与 Client `entities/run.ts:34-40` 证明返回值已有两条已接受 Entry。相关 Runtime、RPC 与异步状态测试通过，但没有 Client 失败路径测试。
- **最小处理建议**：不要新增重试框架。将 `submitTurn` 的成功结果视为提交事实：先用返回的 Branch 和两条 Entry 更新当前 Timeline 并清空草稿；后续 Transcript、Session、Run 刷新作为独立的可恢复读取，失败时保留已提交 Timeline，并允许现有通知如实提示辅助数据刷新失败。若仍依赖完整 Timeline 重取，应至少在重取失败时恢复原草稿且明确提示“提交结果未知”，但这比直接消费成功返回值更容易造成重复提交。
- **关闭条件**：模拟 `turns.submit` 成功、紧随其后的 `timeline.get` 失败时，Client 仍显示该回合的 user/assistant Entry，不恢复为可重复提交的旧输入；错误提示能区分提交失败与辅助刷新失败，并有最小自动化测试覆盖。

### P2

无。

### P3

无。

## 本次验证

- 阅读范围：`docs/guide/` 六份入口与规则文档；`docs/architecture/ui/workspace-shell.md`、`navigation-and-routing.md`；`docs/workbench/issues/` 全部当前 Issue；`docs/workbench/plans/ai-gateway-streaming-execution-plan.md`、`application-runtime-modularization-plan.md`；Chat Composer、Session Runtime hook、分域异步状态、typed Studio API、Application RPC、Application Runtime `submitTurn` transaction、Turn/Timeline/Run 相关测试与 Git 历史。
- 执行命令：`git branch --show-current`；`git rev-parse HEAD`；`git status --short`；`git diff --stat`；`git log --since='14 days ago'`；`git blame`；`rg` 调用链与 Issue 去重搜索；`pnpm exec vitest run apps/studio-client/src/features/session-runtime/model/use-session-runtime.test.ts apps/studio-client/src/shared/hooks/async-operation-model.test.ts`；`pnpm exec vitest run tests/integration/application-runtime/turn-flow.test.ts tests/integration/application-runtime/provider-gateway.test.ts`；`pnpm exec vitest run tests/integration/studio-server/card-session-rpc.test.ts`；`git diff --check`。
- 通过检查：5 个相关测试文件、18 个测试全部通过；确认 Composer pending 防重复、latest-wins 错误状态语义、`submitTurn` 成功返回新 Branch 与两条已接受 Entry、Turn transaction 原子写入、RPC 返回后 Timeline 与 Run 可读取。`git diff --check` 通过。
- 未验证部分：现有测试没有挂载 `useSessionRuntime` 并注入“submit 成功、timeline 刷新失败”的组合故障，因此本次以当前调用顺序、返回契约和错误捕获行为完成静态可达性验证；未运行全量 build、lint 或全量测试；未进行浏览器人工视觉验收。
- 环境限制：无端口或沙箱限制。
