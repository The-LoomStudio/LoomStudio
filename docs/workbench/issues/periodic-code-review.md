# 周期性代码审查

> **状态**：Active Review Ledger
> **最后审查时间**：2026-07-27 13:34
> **审查基线**：383f3a15ff3a81e3698e873c408ecebe8c4c26e8
> **当前分支**：main
> **审查目标**：Studio 日志查询与展示链路

## 最近覆盖记录

只保留最近 12 次记录，超出后删除最旧记录。

| 日期 | Commit | 审查目标 | 选择原因 | 结果 |
| --- | --- | --- | --- | --- |
| 2026-07-27 | `383f3a1` | Studio 日志查询与展示链路 | 最近两次提交新增并整理了结构化日志、`logs.list` 与 Logs Workspace，且链路涉及敏感信息与故障可见性 | 新增 1 个 P1：超过 500 条后 Viewer 无法访问最新 Server 日志 |

## 当前开放发现

### P0

无。

### P1

#### Server 日志超过 500 条后 Viewer 刷新仍停留在最旧批次

- **状态**：Open
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
- **关闭条件**：构造超过 500 条 Server 日志后，用户通过 Viewer 可以到达并看到最后一条记录；重复刷新能反映新追加记录；对应 Client 测试覆盖多页和刷新到最新尾部。

### P2

无。

### P3

无。

## 本次验证

- 阅读范围：`docs/guide/` 六份入口与规则文档；`docs/architecture/platform/logging.md`；`docs/workbench/issues/` 全部当前 Issue；`docs/workbench/plans/log-plan/README.md`；Logs Workspace、typed Studio API、Studio RPC Router、`logs.list`、Memory/JSONL Sink、Server/Client Composition Root 及相关测试。
- 执行命令：`git branch --show-current`；`git rev-parse HEAD`；`git status --short`；`git log --since='14 days ago' --stat`；`git blame`；`pnpm exec vitest run tests/unit/logging/core.test.ts tests/unit/studio-server/logs-rpc.test.ts tests/unit/client/studio-api.test.ts tests/integration/studio-server/logging.test.ts`；`pnpm --filter @loom-studio/studio-client build`。
- 通过检查：日志核心、Logs RPC 与 typed Client API 共 18 个单元测试通过；Studio Client TypeScript 与 Vite 构建通过；隐私日志集成测试源码确认覆盖 Document、Prompt 与 Provider 内容不进入日志。
- 未验证部分：3 个 Studio Server 日志集成测试未实际运行到断言；未进行浏览器手工交互验收。
- 环境限制：测试进程在当前沙箱监听 `127.0.0.1` 时返回 `listen EPERM: operation not permitted`，属于端口绑定限制，不作为代码回归。
