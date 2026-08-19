# 周期性代码审查

> **状态**：Active Review Ledger
> **最后审查时间**：2026-08-17 12:21
> **审查基线**：07745fce047e9d066838bbb5ffb121fba7d615d1
> **当前分支**：main
> **审查目标**：本地 Extension Package 安装、激活、重启恢复与卸载链路

## 最近覆盖记录

只保留最近 12 次记录，超出后删除最旧记录。

| 日期 | Commit | 审查目标 | 选择原因 | 结果 |
| --- | --- | --- | --- | --- |
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

- 阅读范围：`docs/guide/` 六份入口与规则文档；`docs/architecture/extensions/README.md`；Extension Package / Module 与 Server Manager 相关 Plan；`docs/workbench/issues/` 当前 Issue；安装 RPC、Manager 串行编排、Package Installer、Source Scanner、State Store、Extension Host discover / activate / dispose、SSE 通知、定向测试与近期 Git 历史。另反向复核旧 Session Turn P1 在当前 Narrative / Agent Runtime 中的状态回写路径。
- 执行命令：`git branch --show-current`；`git rev-parse HEAD`；`git status --short`；`git diff --stat`；`git log --since='14 days ago'`；`git show`；`rg` 调用链、测试与 Issue 去重搜索；`CI=1 pnpm exec vitest run tests/unit/studio-server/extension-package-installer.test.ts tests/integration/studio-server/extension-install.test.ts tests/contract/extension-host/cleanup.test.ts tests/contract/extension-host/assets.test.ts`；`git diff --check`；`git diff --check -- docs/workbench/issues/periodic-code-review.md`。
- 通过检查：4 个相关测试文件、12 个测试全部通过；确认安装目录按 Package ID / version 原子落位、失败 staging 清理、符号链接和路径逃逸拒绝、Extension Scope 激活失败清理、Asset grant、重启后启用状态恢复、卸载后 RPC 释放以及 Package 已发布 Document / Asset 保留。静态反向检查确认 Manager 操作串行化，RPC 只在成功后发布 `extensions.changed`，卸载只允许 versioned installed 来源。固定 Issue 自身的 `git diff --check` 通过。
- 未验证部分：未运行全量 build、lint 或全量测试；未模拟复制期间源目录被并发修改、磁盘耗尽、进程在 rename 前后崩溃等系统级故障注入；未进行浏览器人工验收。
- 环境限制：无端口或沙箱限制。全工作区 `git diff --check` 被哥哥已有的 `apps/studio-client/src/shared/ui/context-menu/context-menu.tsx` 行尾空白阻塞；该文件不在本次范围，本次未修改。工作区其他大量未提交的 Prompt Build / Studio Client / Application Runtime 修改也均未触碰或覆盖。
