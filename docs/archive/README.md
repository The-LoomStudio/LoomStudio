# Docs Archive 历史归档库

本目录是项目唯一的历史归档库，用于保存已经完成、被取代，或虽留有延期项但原文基线已不再适合作为当前施工入口的冻结材料。

进入 Archive 不等于每句话都已经实现。归档文档必须满足以下之一：

- 工作已经完成；
- 方向已被新 Architecture / ADR / Plan 取代；
- 原审计或计划基线已经失效，仍有价值的开放项已在 Workbench 建立当前 successor。

Archive 内的 `Open / Pending` 只描述历史快照，不自动构成当前待办。当前工作必须能从 `docs/workbench/` 索引到达。

---

## 目录结构

### 1. [`issues/`](./issues/) — 历史 Issue 与审计快照
包含历次架构重构前后的专项审查。部分原文结束时仍有开放项，但其基线已冻结；当前问题以 Workbench Issues 为准：
- **后端存储与运行时**：`backend-architecture-and-structure-review.md`、`backend-code-redundancy.md`、`backend-packages-engine-and-assets.md`、`Back_package..md`、`Prompt-build-issue.md`、`rpc-api-contract-review.md`
- **前端与架构治理**：`frontend-audit-v0.md`、`frontend-code-redundancy.md`、`frontend-fsd-and-architecture-review.md`、`architecture-governance-v0.md`
- **杂项与质量审查**：`extension-system-review.md`、`i18n-and-accessibility-review.md`、`test-suite-quality-review.md`、`documentation-audit.md`、`documentation-direction-and-lifecycle-audit-2026-08-28.md`、`refactor-chores.md`

### 2. [`plans/`](./plans/README.md) — 历史已完成、被取代或已拆分 successor 的 Plan
包含各模块实施过程与阶段判断。正文中的 Pending 阶段只有在 Workbench successor 中重新登记后才是当前路线：
- **Prompt 与数据层 V2**：`data-layer-v2-prompt-resource-node-store-plan.md`、`prompt-build-zone-slot-entry-composition-plan.md`、`prompt-build-message-block-implementation-plan.md`、`prompt-build-loom-core-pipeline-migration-plan.md`、`preset-agent-prompt-build-module-plan.md`、`prompt-resource-foundation-plan.md`
- **存储底座与 Session**：`sqlite-data-engine-domain-stores-kernel-plan.md`、`local-data-blob-store-foundation-plan.md`、`provider-profile-secret-store-foundation-plan.md`、`agent-session-narrative-timeline-data-layer-plan.md`、`agent-session-chat-message-foundation-plan.md`、`card-resource-manifest-migration-plan.md`
- **插件、事件与早期基础**：`extension-package-module-foundation-plan.md`、`server-extension-manager-mvp-plan.md`、`event-system-extension-scope-plan.md`、`document-store-kernel-data-foundation-plan.md`、`airp-resource-session-prompt-schema-plan.md`
- **其他已归档里程碑**：`agent-runtime-ai-sdk-phase-0-spike.md`、`application-runtime-context-plan.md`、`document-edit-history-plan.md`、`loom-core-monorepo-migration-plan.md`、`macro-roadmap-2026-06.md`、`variable-state-system-foundation-plan.md`

完整可点击清单见 [`plans/README.md`](./plans/README.md)。

### 3. [`discussion/`](./discussion/) — 历史 Discussion 与里程碑规格

包含 MVP / M0、WebSocket-only Transport、伪事件订阅、Manifest v1、旧 Extension Lifecycle 与早期 Prompt Composition 等已退出当前入口的设计稿。

### 4. 其他历史材料

- [`mvp-stage-notes/`](./mvp-stage-notes/) 与 [`mvp-scenario-test-plan.md`](./mvp-scenario-test-plan.md) — MVP 阶段验收记录；
- [`ui/`](./ui/) — 已被当前 UI Architecture 取代的视觉与布局草稿；
- [`loom-project/`](./loom-project/) — 外部 LoomProject 的原始历史文档快照。
