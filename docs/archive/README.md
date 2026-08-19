# Docs Archive 历史归档库

本目录用于存放项目发展过程中已完全实现、已关闭或已被新架构取代的历史方案与专项审查文档。

---

## 目录结构

### 1. [`issues/`](./issues/) — 历史已解决的 Issue 与审计报告
包含历次架构重构前后的专项审查与缺陷审计文档（问题已 100% 解决或澄清）：
- **后端存储与运行时**：`backend-architecture-and-structure-review.md`、`backend-code-redundancy.md`、`backend-packages-engine-and-assets.md`、`Back_package..md`、`Prompt-build-issue.md`、`rpc-api-contract-review.md`
- **前端与架构治理**：`frontend-audit-v0.md`、`frontend-code-redundancy.md`、`frontend-fsd-and-architecture-review.md`、`architecture-governance-v0.md`
- **杂项与质量审查**：`extension-system-review.md`、`i18n-and-accessibility-review.md`、`test-suite-quality-review.md`、`documentation-audit.md`、`refactor-chores.md`

### 2. [`plans/`](./plans/) — 历史已完成或已取代的 Plan 计划
包含各模块初期设计草案与实施步骤（对应能力已合入主线）：
- **Prompt 与数据层 V2**：`data-layer-v2-prompt-resource-node-store-plan.md`、`prompt-build-zone-slot-entry-composition-plan.md`、`prompt-build-message-block-implementation-plan.md`、`prompt-build-loom-core-pipeline-migration-plan.md`、`preset-agent-prompt-build-module-plan.md`、`prompt-resource-foundation-plan.md`
- **存储底座与 Session**：`sqlite-data-engine-domain-stores-kernel-plan.md`、`local-data-blob-store-foundation-plan.md`、`provider-profile-secret-store-foundation-plan.md`、`agent-session-narrative-timeline-data-layer-plan.md`、`agent-session-chat-message-foundation-plan.md`、`card-resource-manifest-migration-plan.md`
- **插件、事件与早期基础**：`extension-package-module-foundation-plan.md`、`server-extension-manager-mvp-plan.md`、`event-system-extension-scope-plan.md`、`document-store-kernel-data-foundation-plan.md`、`airp-resource-session-prompt-schema-plan.md`
