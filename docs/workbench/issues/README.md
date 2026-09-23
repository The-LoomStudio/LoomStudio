# Workbench Issues 索引

本目录用于跟踪**当前开放或周期性滚动审查的质量发现**。

- [`audit-remediation-decisions-and-order.md`](./audit-remediation-decisions-and-order.md) — **审查修复口径与施工顺序**（已确认软引用、宽松 Prompt Build、编辑冲突和数据保真边界；实施进度见 [修复计划](../plans/audit-issue-remediation-plan.md)）。
- [`state-subscription-for-extensions.md`](./state-subscription-for-extensions.md) — **扩展 State 变更订阅**（已延期；不阻塞 The World 其他功能迁移）。
- [`repository-governance-audit-2026-09-12.md`](./repository-governance-audit-2026-09-12.md) — **仓库治理与生命周期审计**（2026-09-22 补查共 8 项：2 个历史生命周期问题、6 个当前文档/质量门禁问题）。
- [`full-repo-code-review-2026-09-12.md`](./full-repo-code-review-2026-09-12.md) — **2026-09-12 全仓代码审阅**（4 个 P2、3 个 P3 与 2 个精简候选）。
- [`frontend-backend-architecture-and-client-duplication-audit-2026-09-14.md`](./frontend-backend-architecture-and-client-duplication-audit-2026-09-14.md) — **前后端架构与客户端重复逻辑审计**（审计完成；依赖、性能与状态治理已拆分为下一项 Plan）。
- [`frontend-rendering-and-state-retention-audit-2026-09-21.md`](./frontend-rendering-and-state-retention-audit-2026-09-21.md) — **前端渲染性能与状态留存专项审查**（16 项发现及文件/CSS 归属建议；含 Agent UI，不含 CodeActor 与 Agent 执行器）。
- [`full-repo-code-review-2026-08-27.md`](./full-repo-code-review-2026-08-27.md) — **2026-08-27 全仓代码审阅**（审查时 2 个 P1、14 个 P2、3 个 P3 与 6 个优化候选；旧项施工前复核，FR-012 目标已调整）。
- [`documentation-direction-and-lifecycle-follow-up-2026-08-28.md`](./documentation-direction-and-lifecycle-follow-up-2026-08-28.md) — **文档方向与生命周期复核**（2 个 P2：旧 M0 实现基线残留、归档 Plan successor 缺失）。
- [`extension-dev-hot-reload-enhancement.md`](./extension-dev-hot-reload-enhancement.md) — **插件开发态热重载机制增强**（待排期的低优先级开发体验改进）。
- [`state-resource-and-reference-follow-ups.md`](./state-resource-and-reference-follow-ups.md) — **State 资源与引用检查后续**（独立 State Artifact 资源链、运行态软引用诊断）。
- [`periodic-code-review.md`](./periodic-code-review.md) — **周期代码审查台账**（滚动记录最近 12 次重大审查与核心链路发现）。

> [!NOTE]
> 历史审计快照统一位于 [`docs/archive/issues/`](../../archive/issues/)。归档只表示原审计基线已经冻结；当前仍需推进的问题必须在本索引或活跃 Plan 中重新登记。

本轮已解决的 State JSON/Delta、Prompt Resource JSON、Extension 生命周期、Document 分页及输入、Prompt Resource 分页、Card 文件往返、后端生命周期独立 Issue 已删除，交付证据见[修复实施计划](../plans/audit-issue-remediation-plan.md)。FR-012 其余领域继续在全仓审查中跟踪。
