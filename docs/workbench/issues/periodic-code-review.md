# 周期性代码审查

> **状态**：Active Review Ledger
> **最后审查时间**：2026-08-03 11:34
> **审查基线**：f6253b8fc78fbe26578dfe010b549a0d4e323d39
> **当前分支**：main
> **审查目标**：Document Store 写入、Commit Fact 与 Kernel 事件传播链路

## 最近覆盖记录

只保留最近 12 次记录，超出后删除最旧记录。

| 日期 | Commit | 审查目标 | 选择原因 | 结果 |
| --- | --- | --- | --- | --- |
| 2026-08-03 | `f6253b8` | Document Store 写入、Commit Fact 与 Kernel 事件传播链路 | 最近提交及当前工作区对事务、SQLite migration、Commit observer、Application/Extension 写入传播进行了实质修改，链路涉及持久化原子性与公共事件边界 | 未发现新的可报告问题；既有 Logging P1 当时保持不变，已于 2026-08-07 复核关闭 |
| 2026-07-27 | `383f3a1` | Studio 日志查询与展示链路 | 最近两次提交新增并整理了结构化日志、`logs.list` 与 Logs Workspace，且链路涉及敏感信息与故障可见性 | 新增 1 个 P1：超过 500 条后 Viewer 无法访问最新 Server 日志 |

## 当前开放发现

### P0

无。

### P1

无。

## 已关闭历史发现

### P1：Server 日志超过 500 条后 Viewer 刷新仍停留在最旧批次

- **状态**：Closed（2026-08-07）
- **首次发现**：2026-07-27
- **最后验证**：2026-07-27
- **位置**：`apps/studio-client/src/widgets/log-viewer/log-viewer.tsx:24`
- **相关符号**：`LogViewer.refresh`、`createMemoryLogSink().query`
- **触发条件**：当前 Server Memory Sink 中存在超过 500 条记录，用户打开 Logs Workspace 或点击刷新并选择 Server 来源。
- **完整链路**：用户刷新 Logs Workspace → `LogViewer.refresh` 固定调用 `props.api.list({ limit: 500 })` 且不传 cursor → typed API 调用 `logs.list` → `callLogsRpc` 转发无 cursor 查询 → `MemoryLogSink.query` 从当前最旧 sequence 开始正向扫描并在 500 条时停止 → 返回 `hasMore: true` → Viewer 只显示该首批并仅提示后面还有记录，没有分页或追到最新的操作 → 后续刷新再次请求同一首批。
- **实际影响**：Server 运行一段时间后，最新的 Provider、PromptBuild、Document Store 或 Transport 错误无法通过当前 Viewer 查看；刷新动作不会刷新到最新事实，故障排查会稳定停留在旧日志。直到 Ring Buffer 淘汰足够多的旧记录后，较新的记录才会被动进入首批，但仍无法保证看到当前尾部。
- **现有防护检查**：Memory Sink 的 cursor、`hasMore` 与 gap 语义工作正常；typed API 支持传 cursor；Server 将 limit 限制在 1–500。问题位于 Client 消费端：没有保存返回 cursor、没有请求后续页，也没有倒序或 tail 查询；`hasMore` 文案只暴露缺口，不能访问剩余数据。未发现相关组件测试或其他当前 Issue 记录此问题。
- **验证证据**：`packages/logging/src/memory-sink.ts:82-116` 明确按 oldest → newest 扫描；`apps/studio-client/src/widgets/log-viewer/log-viewer.tsx:36-39` 每次无 cursor 请求 500 条；同文件 `:116` 只有提示，无继续加载入口。现有分页单测证明首批达到 limit 时返回 cursor 与 `hasMore: true`，但 Viewer 未消费 cursor。
- **最小处理建议**：保持现有 API，不新增抽象；Viewer 在一次刷新中沿 cursor 继续读取到 `hasMore === false`，仅保留最终需要展示的最近一批记录，或增加一个明确的“加载后续记录”动作。若 Viewer 的产品语义是“查看当前故障”，优先采用读取到尾部并展示最新记录的最小实现。
- **关闭证据**：`apps/studio-client/src/widgets/log-viewer/log-viewer-model.ts` 已通过 cursor 连续读取分页；`apps/studio-client/src/widgets/log-viewer/log-viewer.test.ts` 覆盖多页读取与最新尾部。该历史条目保留原始发现链路，避免后续审查重复报告。

### P2

无。

### P3

无。

## 本次验证

- 阅读范围：`docs/guide/` 六份入口与规则文档；`docs/architecture/data/README.md`；`docs/architecture/kernel/README.md`；`docs/workbench/issues/` 全部当前 Issue；`docs/workbench/plans/document-store-kernel-data-foundation-plan.md`；Document Store 类型、Changeset/Commit Fact、In-memory/SQLite backend、Kernel EventBus 与订阅生命周期、Studio Server 组装、Application Runtime/Extension Host 写入调用方及相关测试。
- 执行命令：`git branch --show-current`；`git rev-parse HEAD`；`git status --short`；`git log --since='14 days ago'`；`git diff`；`rg` 调用链搜索；`pnpm exec vitest run tests/unit/document-store/document-store-contract.test.ts tests/unit/document-store/sqlite-store.test.ts tests/contract/kernel/kernel-rpc.test.ts tests/contract/extension-host/document-ownership.test.ts tests/integration/platform/document-trace-diagnostics.test.ts tests/unit/application-runtime/workspace-artifact-boundary.test.ts tests/integration/application-runtime/workspace-artifact.test.ts`；`pnpm lint`。
- 通过检查：7 个相关测试文件、57 个测试全部通过；确认失败 transaction 不产生 Commit Fact，SQLite 事务回滚与 FIFO 串行有效，Application/Extension/Kernel 写入统一在提交后广播一次 `docs.changed`，订阅者异常不会把已提交写入误报为失败，调用身份与 correlation/call metadata 能沿 RPC 写入 Changeset 和事件。
- 未验证部分：未运行全量 build 与全量测试；未进行真实多进程或崩溃恢复测试；未复查既有 Logs Viewer P1 的 UI 行为。
- 环境限制：无端口或沙箱限制。全量 Lint 未通过，现有工作区在 `apps/studio-client/src/app/use-studio-state.ts:94` 有 `prefer-const`，在 `apps/studio-server/src/application-rpc.ts:606` 有未使用函数；本次只读审查未修改这些用户工作区内容，且两项不构成本链路的新发现。
