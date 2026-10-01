# Workbench Issues 索引

本目录用于跟踪**当前开放或周期性滚动审查的质量发现**。

- [`client-server-api-audit-2026-10-02.md`](./client-server-api-audit-2026-10-02.md) — **前后端 API/IPC 专题**（4 项读取/通知范围优化候选；完整历史投影、引用查询、Card 子集与 Session 通知）。
- [`memory-retention-audit-2026-10-02.md`](./memory-retention-audit-2026-10-02.md) — **内存专题**（3 项预算候选；SSE 背压、Run 重放缓存、Tokenizer 批量输入；未测真实堆峰值）。
- [`ui-component-reuse-audit-2026-10-02.md`](./ui-component-reuse-audit-2026-10-02.md) — **UI 组件与 SCSS 复用专题**（4 家族、17 个源码候选实例；区分现有 API 可承载与交互差异，不是原生标签问题总数）。
- [`full-repo-code-review-2026-10-02.md`](./full-repo-code-review-2026-10-02.md) — **本轮全仓审查**（1 个 P1、9 个 P2 确认发现，2 个待验证候选；只读审查，未实施修复）。
- [`audit-follow-ups.md`](./audit-follow-ups.md) — **审查归档后续**（延期的远端 CI 与旧计划接续去向；已完成的修复账目不再留在 Workbench）。
- [`state-subscription-for-extensions.md`](./state-subscription-for-extensions.md) — **扩展 State 变更订阅**（正式写入、回滚、默认值的通知及订阅过滤/清理已修复；The World 接入独立安排）。
- [`extension-dev-hot-reload-enhancement.md`](./extension-dev-hot-reload-enhancement.md) — **插件开发态热重载机制增强**（待排期的低优先级开发体验改进）。
- [`state-resource-and-reference-follow-ups.md`](./state-resource-and-reference-follow-ups.md) — **State 资源与引用检查后续**（独立 State Artifact 资源链、运行态软引用诊断）。
- [`periodic-code-review.md`](./periodic-code-review.md) — **周期代码审查台账**（滚动记录最近 12 次重大审查与核心链路发现）。

> [!NOTE]
> 历史审计快照统一位于 [`docs/archive/issues/`](../../archive/issues/)。归档只表示原审计基线已经冻结；当前仍需推进的问题必须在本索引或活跃 Plan 中重新登记。

2026-09-24 本轮审查报告已归档：[前端16项](../../archive/issues/frontend-rendering-and-state-retention-audit-2026-09-21.md)全部关闭；[全仓19项](../../archive/issues/full-repo-code-review-2026-08-27.md)中18项收口，FR-006远端CI按用户决定延期，验收去向见[后续计划](./audit-follow-ups.md#deferred-ci-acceptance)。FR-007为用户接受当前UI、细节与读屏验证后续安排，不宣称读屏通过。归档沿用仓库现有本地留存政策。

[审查修复口径](../../archive/issues/audit-remediation-decisions-and-order.md)已实际移入归档，保留为决策参考，不是开放任务。上方独立功能Backlog和周期审查台账不属于本轮待修漏项。

本轮已解决的 State JSON/Delta、Prompt Resource JSON、Extension 生命周期、Document 分页及输入、Prompt Resource 分页、Card 文件往返、后端生命周期独立 Issue 已删除，交付证据见[修复实施计划](../../archive/plans/audit-issue-remediation-plan.md)。FR-012 已按确认后的软引用合同关闭，证据保留在已归档全仓审查中。

文档方向与生命周期复核的 DOC-FOLLOW-001/002 已完成，原 Issue 已删除：五份活跃设计稿的旧基线已修正，三份归档 Plan 的后续去向见[当前 successor](./audit-follow-ups.md#archive-successor-follow-up)。其中未验收的 UI 能力仍保留在 successor，不因治理问题关闭而视为完成。

仓库治理 GOV-001～008 已收口，原 Issue 已删除，证据保留在[修复实施计划](../../archive/plans/audit-issue-remediation-plan.md)。Knip 仍报告独立 ST Data Compat 的 activate/default 重复导出并退出 1，这是明确保留的发布形式，不冒称全仓 Knip 绿灯；主库测试类型检查和根 lint 已通过。

2026-09-12 全仓审查 SEP-001～009 已收口并删除原 Issue。部分删除、规则顺序/空文本投影、分支编辑隔离与依赖/查询职责裁定的证据见[修复实施计划](../../archive/plans/audit-issue-remediation-plan.md)；其他审查及浏览器验收不随之关闭。

2026-09-14 架构审计已移至[历史审查](../../archive/issues/frontend-backend-architecture-and-client-duplication-audit-2026-09-14.md)，不再列为开放施工清单。后续状态、门禁、软引用与浏览器验证的实际交付及限制由修复计划承接，未因归档虚称所有验收通过。
