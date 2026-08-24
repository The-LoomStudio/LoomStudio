# 周期性代码审查

> **状态**：Active Review Ledger
> **最后审查时间**：2026-08-24 11:23
> **审查基线**：7d020cc1b0c53d4eb024d5270a05993a196dfb39
> **当前分支**：main
> **审查目标**：SQLite Data Engine 启动、命名空间 Schema 迁移、失败回滚与 Document Store 接入链路

## 最近覆盖记录

只保留最近 12 次记录，超出后删除最旧记录。

| 日期 | Commit | 审查目标 | 选择原因 | 结果 |
| --- | --- | --- | --- | --- |
| 2026-08-24 | `7d020cc` | SQLite Data Engine 启动、Schema 迁移与失败回滚链路 | 8 月 20 日近期加固了 Data Engine 迁移、重入与 Schema 校验；该边界直接决定服务能否安全启动，且可避开当前未提交的 Agent Runtime 开发工作 | 未发现新的可报告问题；命名空间版本、迁移缺口、高版本拒绝、失败回滚、不完整 Schema 拒绝与原子事务均有定向验证 |
| 2026-08-20 | `working` | 全局数据层重构收敛、RPC 强类型化、Prompt 对齐、跨包工具去重与测试治理 (Phase 1~5) | 加固底层 SQLite 事务防死锁与 CTE 递归分页；增强 RPC 响应元数据并统一 ProviderProfile DTO；对齐 Prompt Compiler 消息合并；收敛 `@loom-studio/shared` 基础守卫；清理废弃归档测试与 TS 配置别名对齐 | 全仓库 95 个测试文件、420 个用例 100% 全部通过；`build` / `lint` 0 错误；消除 70+ 行冗余代码与 1 个孤儿文件；删除历史失效归档 |
| 2026-08-19 | `f3418dc` | 后端数据层大重构与 Issues 全量审计 | 引入了独立 `prompt-resource-store`、`SettingMount` 挂载体系、`data-engine` 事务归一、`MessageBlock` 组装与相邻 System 消息合并，需对全量 Issue 重新对齐事实 | 确认 PromptBuild System 消息合并、空 Projection Profile 统一、Agent Preset 解耦等已解决；确认链表 N+1、DataEngine 重入死锁防护、跨包工具重复依然开放；ADR-003/004 状态已更新 |
| 2026-08-17 | `07745fc` | 本地 Extension Package 安装、激活、重启恢复与卸载链路 | 最近提交完成 Extension artifact 安装流；该链路跨越本地文件信任边界、原子复制、Catalog、Host 生命周期、持久化 desired state 与卸载清理 | 未发现新的可报告问题；确认旧 Session Turn P1 已由 2026-08-15 的 Narrative / Agent Runtime 重构消除并删除失效条目 |
| 2026-08-10 | `ea7b4c6` | Session Turn 提交、RPC 持久化与 Client 状态回写链路 | 近期提交实质修改了 Session Runtime、分域异步状态和通知；该链路跨越用户输入、Provider 调用、事务写入与 UI 回写，且上次未覆盖 Client 成功后的恢复路径 | 新增 1 个 P1：Turn 已提交后若后续 Timeline 刷新失败，Client 清空草稿但仍展示旧 Timeline，并将已成功写入的操作表现为失败 |
| 2026-08-03 | `f6253b8` | Document Store 写入、Commit Fact 与 Kernel 事件传播链路 | 最近提交及当前工作区对事务、SQLite migration、Commit observer、Application/Extension 写入传播进行了实质修改，链路涉及持久化原子性与公共事件边界 | 未发现新的可报告问题；既有 Logging P1 当时保持不变，已于 2026-08-07 复核关闭 |
| 2026-07-27 | `383f3a1` | Studio 日志查询与展示链路 | 最近两次提交新增并整理了结构化日志、`logs.list` 与 Logs Workspace，且链路涉及敏感信息与故障可见性 | 新增 1 个 P1：超过 500 条后 Viewer 无法访问最新 Server 日志 |

## 当前开放发现

### P0

无。

### P1

无。

### P2

无。

### P3

无。

## 本次验证

- 阅读范围：`docs/guide/` 六份入口与规则文档；`docs/architecture/README.md`、`docs/architecture/data/README.md`；固定 Issue 与当前 Issues 索引；已归档的 Document Store / SQLite Data Engine 实施 Plan（仅作背景）；`createStudioServer` 组装与关闭路径；Data Engine 核心 Schema、FIFO 事务、命名空间迁移、版本与列完整性校验；Document Store 迁移接入及定向测试。
- 执行命令：`git branch --show-current`；`git rev-parse HEAD`；`git status --short`；`git diff --stat`；`git log --since='14 days ago'`；`git show d8860af`；`rg` 迁移、调用链、测试与 Issue 去重搜索；`CI=1 pnpm exec vitest run tests/unit/data-engine/sqlite-data-engine.test.ts tests/unit/document-store/sqlite-store.test.ts tests/integration/application-runtime/data-layer-atomicity.test.ts`；`git diff --check -- docs/workbench/issues/periodic-code-review.md`。
- 通过检查：3 个相关测试文件、19 个测试全部通过。确认核心与 Document Schema 版本独立记录；迁移缺口和高于程序支持的 Schema 会拒绝启动；迁移失败会回滚 DDL 与版本号；不完整的旧 Document Schema 不会被错记为已迁移；运行期失败或空事务不会留下部分写入或 Commit Fact。
- 未验证部分：未运行全量 build、lint 或全量测试；未进行真实磁盘耗尽、WAL 损坏、进程在 DDL / COMMIT 间崩溃或多进程同时迁移的系统级故障注入。
- 环境限制：Node 运行时输出 SQLite ExperimentalWarning，不影响测试结果。工作区存在哥哥未提交的 Agent Runtime / AI Gateway / Studio Client 开发改动；本次选择不重叠的 Data Engine 与 Document Store 范围，未触碰或覆盖这些改动。
