# Workbench Issues 索引

本目录用于跟踪**当前开放或周期性滚动审查的质量发现**。

- [`card-file-roundtrip-audit-2026-09-22.md`](./card-file-roundtrip-audit-2026-09-22.md) — **Card 文件往返与导入完整性审查**（2 个 P2：媒体 MIME 往返丢失、CRC 不匹配的 ZIP 正文被接受；隔离探针已复现）。
- [`backend-lifecycle-adversarial-audit-2026-09-22.md`](./backend-lifecycle-adversarial-audit-2026-09-22.md) — **后端生命周期与失败恢复对抗性审查**（1 个 P1、6 个 P2，含已有 FR-012 的复核、Asset 下载取消及 Diagnostics 保留探针；待修复）。
- [`extension-lifecycle-adversarial-audit-2026-09-22.md`](./extension-lifecycle-adversarial-audit-2026-09-22.md) — **扩展生命周期与清理一致性审查**（1 个 P1、4 个 P2，覆盖授权重读、卸载失败与异步回调回收）。
- [`state-subscription-for-extensions.md`](./state-subscription-for-extensions.md) — **扩展 State 变更订阅**（已延期；不阻塞 The World 其他功能迁移）。
- [`repository-governance-audit-2026-09-12.md`](./repository-governance-audit-2026-09-12.md) — **仓库治理与生命周期审计**（2 个历史生命周期问题；2026-09-22 补查新增 1 个 P3 归档断链收尾项）。
- [`full-repo-code-review-2026-09-12.md`](./full-repo-code-review-2026-09-12.md) — **2026-09-12 全仓代码审阅**（4 个 P2、3 个 P3 与 2 个精简候选）。
- [`frontend-backend-architecture-and-client-duplication-audit-2026-09-14.md`](./frontend-backend-architecture-and-client-duplication-audit-2026-09-14.md) — **前后端架构与客户端重复逻辑审计**（审计完成；依赖、性能与状态治理已拆分为下一项 Plan）。
- [`frontend-rendering-and-state-retention-audit-2026-09-21.md`](./frontend-rendering-and-state-retention-audit-2026-09-21.md) — **前端渲染性能与状态留存专项审查**（15 项发现及文件/CSS 归属建议；含 Agent UI，不含 CodeActor 与 Agent 执行器）。
- [`full-repo-code-review-2026-08-27.md`](./full-repo-code-review-2026-08-27.md) — **2026-08-27 全仓代码审阅**（2 个 P1、14 个 P2、3 个 P3 与 6 个优化候选）。
- [`documentation-direction-and-lifecycle-follow-up-2026-08-28.md`](./documentation-direction-and-lifecycle-follow-up-2026-08-28.md) — **文档方向与生命周期复核**（2 个 P2：旧 M0 实现基线残留、归档 Plan successor 缺失）。
- [`extension-dev-hot-reload-enhancement.md`](./extension-dev-hot-reload-enhancement.md) — **插件开发态热重载机制增强**（待排期的低优先级开发体验改进）。
- [`state-resource-and-reference-follow-ups.md`](./state-resource-and-reference-follow-ups.md) — **State 资源与引用检查后续**（独立 State Artifact 资源链、运行态软引用诊断）。
- [`periodic-code-review.md`](./periodic-code-review.md) — **周期代码审查台账**（滚动记录最近 12 次重大审查与核心链路发现）。

> [!NOTE]
> 历史审计快照统一位于 [`docs/archive/issues/`](../../archive/issues/)。归档只表示原审计基线已经冻结；当前仍需推进的问题必须在本索引或活跃 Plan 中重新登记。
