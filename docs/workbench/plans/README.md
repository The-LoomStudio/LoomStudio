# Workbench Plans 状态索引

本页是 `docs/workbench/plans/` 的施工入口，用于区分当前任务、延期路线、已关闭计划与历史方案。计划正文可以原地保留设计过程；**状态以本页和文件顶部状态头为准，已实现事实仍以 `docs/architecture/` 与当前代码为准。**

## 当前施工入口

| 计划 | 当前状态 | 下一步 |
| --- | --- | --- |
| [`prompt-build-zone-slot-entry-composition-plan.md`](prompt-build-zone-slot-entry-composition-plan.md) | Approved Design / Implementation Pending | 先实施 Composition Schema 与官方默认 Preset，再迁移 Core Pipeline 和 Preset Workbench |
| [`prompt-build-loom-core-pipeline-migration-plan.md`](prompt-build-loom-core-pipeline-migration-plan.md) | Phase 0-2 Complete / Phase 3-4 Pending | 扩展 characterization 覆盖，完成 Client Trace 消费与 400～500 条目性能验收 |
| [`preset-agent-prompt-build-module-plan.md`](preset-agent-prompt-build-module-plan.md) | Phase 1-2 Complete / Phase 3 Main UI Complete | 完成关联 Setting Bundle 导入导出与 PromptBuild 来源诊断，收束 Timeline 混合字段 |
| [`prompt-resource-foundation-plan.md`](prompt-resource-foundation-plan.md) | Foundation Partially Implemented / Binding Model Superseded | 保留已完成的 Prompt Resource 与静态编译基础；绑定迁移转入新 Preset 计划 |
| [`provider-profile-secret-store-foundation-plan.md`](provider-profile-secret-store-foundation-plan.md) | In Progress / Provider Profile Backend Complete | 清理 Client 旧命名与 Agent Runtime 草稿，补原生壳 Secret/Auth |
| [`agent-session-narrative-timeline-data-layer-plan.md`](agent-session-narrative-timeline-data-layer-plan.md) | Backend Complete / Client Agent-only Runtime Complete | Agent Composer 已接入真实线性多轮对话；Session 恢复、流式、工具与 Narrative commit UI 延期 |
| [`agent-session-chat-message-foundation-plan.md`](agent-session-chat-message-foundation-plan.md) | Phase 1 Complete | 后续 Agent Session 与 AIRP 迁移；具体施工以数据层计划为主入口 |
| [`ui/prompt-resource-projection-workbench-v0.md`](ui/prompt-resource-projection-workbench-v0.md) | Frontend Foundation Complete / Backend Contract Pending | 收束 Folder/Zone effective enabled、默认 Projection 与诊断合同 |
| [`event-system-extension-scope-plan.md`](event-system-extension-scope-plan.md) | Phase 1–4 Complete / Extension SSE Implemented | 通用跨端 Event Transport、Client Extension Host 与权限持久化仍待独立决策 |
| [`log-plan/README.md`](log-plan/README.md) | Foundation Implemented / Follow-up Active | 历史查询、实时交付、Viewer 与通知系统仍是后续工作 |

## 延期与路线图

这些方向仍有价值，但当前不应被误认为正在施工：

- [`ai-gateway-streaming-execution-plan.md`](ai-gateway-streaming-execution-plan.md) — AI Gateway 流式执行，延期；
- [`extension-developer-experience.md`](extension-developer-experience.md) — Extension SDK、Host 与开发体验路线图；
- [`application-runtime-modularization-plan.md`](application-runtime-modularization-plan.md) — 等真实领域边界稳定后再渐进拆分 Runtime；
- [`search-and-timeline-indexing-plan.md`](search-and-timeline-indexing-plan.md) — Asset Search 已完成，Timeline Search 需基于新 Narrative Store 合同重定；
- [`ui/prompt-resource-diff-mode-v0.md`](ui/prompt-resource-diff-mode-v0.md) — 等 Revision 与 Tokenizer 合同；
- [`ui/provider-account-health-plan.md`](ui/provider-account-health-plan.md) — Provider Account 健康检查，延期；
- [`ui/provider-model-brand-icons-plan.md`](ui/provider-model-brand-icons-plan.md) — 前端试验已完成，正式资产和合同未收束；
- [`log-plan/agent-run-observability.md`](log-plan/agent-run-observability.md) — Agent 基建成熟后再恢复；
- [`log-plan/prompt-build-observability.md`](log-plan/prompt-build-observability.md) — PromptBuild 专用调试界面阶段再恢复。

## 已关闭或已实现

下列文件保留实施背景和验收边界，不代表仍需继续施工：

- [`card-resource-manifest-migration-plan.md`](card-resource-manifest-migration-plan.md) — Implemented / Phase 5 Complete；
- [`extension-package-module-foundation-plan.md`](extension-package-module-foundation-plan.md) — Complete；
- [`local-data-blob-store-foundation-plan.md`](local-data-blob-store-foundation-plan.md) — Implemented；
- [`server-extension-manager-mvp-plan.md`](server-extension-manager-mvp-plan.md) — Complete；
- [`sqlite-data-engine-domain-stores-kernel-plan.md`](sqlite-data-engine-domain-stores-kernel-plan.md) — Phase 1–6 Complete，Phase 7 测量延期；
- [`document-store-kernel-data-foundation-plan.md`](document-store-kernel-data-foundation-plan.md) — 基线已实现；“所有业务数据均为 Document”的后续方向已被 Domain Store 架构取代。

## 历史或已取代

- [`airp-resource-session-prompt-schema-plan.md`](airp-resource-session-prompt-schema-plan.md) — Card/Session/路径等主链已分别被 Card Manifest、Narrative Timeline + Agent Session 和 Local Data 计划取代；仅保留 Zone Schema 等设计历史。

## 维护规则

1. 新计划必须在本页归入一个状态区，避免只靠文件名判断优先级。
2. 实施完成后先更新状态头和本页；没有必要仅为“归档”移动文件并批量修改入站链接。
3. 后续方案取代旧计划时，在旧文件顶部写明替代文档和仍然有效的范围。
4. Discussion 记录设计过程；已经晋升的事实应链接到 Architecture，不再逐份回写成当前合同。
