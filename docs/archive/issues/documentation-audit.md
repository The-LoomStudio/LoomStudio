# 文档体系审查报告：不匹配、过时与状态漂移 (Documentation Audit)

> **状态**：Historical Audit Snapshot / Superseded
> **后续审计记录**：2026-08-28 的方向与生命周期审计及修复结果见 [`documentation-direction-and-lifecycle-audit-2026-08-28.md`](documentation-direction-and-lifecycle-audit-2026-08-28.md)。
> **最后审计**：2026-08-19（数据层大重构后重审）
> **主要进展**：ADR-003 与 ADR-004 已正式标记为 Accepted/Implemented；明确 PromptBuild 当前为 TS DataModel 编译模式。

## 审查目标

全面排查 `docs/` 目录下的所有架构说明（`architecture/`）、工作台计划（`plans/`）、决策记录（`adr/`）、开发指南（`guide/`）与实际代码实现的**不匹配（Mismatch）、过时描述（Outdated）、断链（Broken Links）及未更新状态（Status Drift）**。

---

## 1. 核心问题清单

### 🔴 [高] 1. 架构文档与代码实现事实不匹配（Architecture-Code Mismatch）

#### A. PromptBuild 架构事实界定：纯 TS DataModel 编译 vs `@loom/core` Pipeline
- **涉及文档：**
  - [`docs/architecture/application/prompt-build/README.md`](../../architecture/application/prompt-build/README.md)
  - [`docs/architecture/application/prompt-build/loom-core/studio-integration.md`](../../architecture/application/prompt-build/loom-core/studio-integration.md)
  - [`docs/guide/project-structure.md`](../../guide/project-structure.md) L164
- **现状事实：**
  `packages/application-runtime/src/prompt-builder.ts` 采用纯 TS 进行 Zone / Slot / Entry / MessageBlock 的树形与列表组装，未直接在运行时执行 `@loom/core` pipeline。`@loom/core` 目前作为底层通用 Fragment/Trace 执行层及 `loom-runner` 的底层驱动。
- **治理建议：**
  在架构文档中准确描述当前 TS DataModel 编译模式与 Core Public API 的集成边界；适时清理 `application-runtime` 中未使用的依赖项。

---

#### B. Migration Namespace 版本号在文档中倒错
- **涉及文档：**
  - [`docs/architecture/data/README.md`](../../architecture/data/README.md) L59, L80
- **实际代码事实：**
  - [`packages/narrative-store/src/store.ts`](../../../packages/narrative-store/src/store.ts)：包含了版本 1 和版本 2（添加了 `idx_narrative_timelines_card_updated` 索引），实际为 **`application.narrative@2`**。
  - [`packages/agent-store/src/store.ts`](../../../packages/agent-store/src/store.ts)：实际定义了版本 1 和版本 2（`agent_preset_id` 重命名为 `agent_profile_id`），实际为 **`application.agent@2`**。
  - [`packages/prompt-resource-store/src/store.ts`](../../../packages/prompt-resource-store/src/store.ts)：新引入的 Prompt 资源存储为 **`application.prompt_resources@1`**。

---

#### C. 虚假/过时文件引用
- **涉及文档：** [`docs/guide/project-structure.md`](../../guide/project-structure.md) L93
- **实际代码事实：**
  `apps/studio-client/src/shared/api/` 下只有 `studio-api.ts`、`client-bridge-logging.ts` 和 `client-json-object.ts`，不存在 `renderer-api.ts`。

---

#### D. Package 层级结构描述不符
- **涉及文档：** [`docs/guide/project-structure.md`](../../guide/project-structure.md) L158
- **实际代码事实：**
  `packages/extension-sdk` 与 `packages/extension-host` 是同级的两个独立 Workspace Package。

---

### ✅ [已解决] 2. ADR 决策状态更新

#### A. ADR-003: Asset Store and Binary Payload Boundary
- **状态已更新**：`Accepted / Implemented`。`packages/blob-store` 和 `packages/asset-store` 已作为独立 package 完整落地并集成。

#### B. ADR-004: Platform Auth, Secrets, and Provider Credential Boundary
- **状态已更新**：`Accepted`。`packages/secret-store`（含 Keyring / In-memory 双后端、`withSecret` 代理）已完整实现并投入使用。

---

### 🟡 [中] 3. 历史 ADR 引用死链（Broken Relative Links）

- **涉及文档：**
  - `docs/workbench/adr/ADR-001-data-layer-workspace-sync.md`
  - `docs/workbench/adr/ADR-002-extension-manifest-and-registration-model.md`
  - `docs/workbench/adr/ADR-005-official-concept-stack-open-design.md`
- **问题分析：**
  早期编号目录 `00-` ~ `08-` 在目录扁平化重构时已迁移至 `docs/workbench/discussion/` 或 `docs/architecture/`。上述 ADR 顶部的关联链接均指向不存在的旧相对路径，产生大量 404 死链。
- **建议：**
  批量更新这些 ADR 顶部的 Related 链接，指向当前正确的 `docs/workbench/discussion/` 或 `docs/architecture/` 文件。

---


- **`provider-profile-secret-store-foundation-plan.md`**：
  - 当前状态为 `In Progress / Provider Profile Backend Complete`。目前后端 `secret-store` 与 `provider-settings` 已经全部就绪，仅剩 Client 端最终表单契约收束。
- **`agent-session-narrative-timeline-data-layer-plan.md`**：
  - 核心 Narrative Timeline + Agent Session 已经完整落地并在前端交互，可将对应 phase 清单同步标记完成。

---

## 2. 审查汇总表

| 文档分类 | 文件路径 | 问题性质 | 当前状态 |
|---|---|---|---|
| **架构事实** | `architecture/application/prompt-build/README.md` | Core 接入描述与纯 TS 实现边界界定 | 待定稿同步 |
| **架构事实** | `architecture/data/README.md` | Migration 版本号同步（含新增 `prompt_resources@1`） | 待同步 |
| **项目地图** | `guide/project-structure.md` | 引用不存在的 `renderer-api.ts`、`extension-host` 描述 | 待纠偏 |
| **决策记录** | `workbench/adr/ADR-003-*.md` | 状态滞后 | **✅ 已更新为 Accepted / Implemented** |
| **决策记录** | `workbench/adr/ADR-004-*.md` | 状态滞后 | **✅ 已更新为 Accepted** |
| **决策记录** | `workbench/adr/ADR-001/002/005` | 历史相对路径断链 | 待修链 |
