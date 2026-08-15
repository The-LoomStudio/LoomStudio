# 文档体系审查报告：不匹配、过时与状态漂移 (Documentation Audit)

## 审查目标

全面排查 `docs/` 目录下的所有架构说明（`architecture/`）、工作台计划（`plans/`）、决策记录（`adr/`）、开发指南（`guide/`）与实际代码实现的**不匹配（Mismatch）、过时描述（Outdated）、断链（Broken Links）及未更新状态（Status Drift）**。

---

## 1. 核心问题清单

### 🔴 [高] 1. 架构文档与代码实现事实不匹配（Architecture-Code Mismatch）

#### A. PromptBuild 根本未接入 `@loom/core` Pipeline
- **涉及文档：**
  - [`docs/architecture/application/prompt-build/README.md`](file:///Users/macbookair/Desktop/LoomStudio/docs/architecture/application/prompt-build/README.md) L8-L14
  - [`docs/architecture/application/prompt-build/loom-core/studio-integration.md`](file:///Users/macbookair/Desktop/LoomStudio/docs/architecture/application/prompt-build/loom-core/studio-integration.md) L7-L16
  - [`docs/guide/project-structure.md`](file:///Users/macbookair/Desktop/LoomStudio/docs/guide/project-structure.md) L164
- **文档声称：**
  “Application Runtime -> 直接使用 @loom/core public API -> 第一方 PromptBuild”、“当前实现注册两个 Pass: prompt.source.prepared ...”。
- **实际代码事实：**
  `packages/application-runtime/src/prompt-builder.ts` 完全使用纯 TS 手写递归组装，**没有任何一行代码导入或调用 `@loom/core`**。`packages/application-runtime/package.json` 中的 `@loom/core` 也是完全未引用的幽灵依赖。`@loom/core` 目前仅在 `loom-runner` 中被 `loom.run` RPC 包装。
- **建议：**
  更新架构文档，澄清当前 PromptBuild 为纯 TS DataModel 编译模式，或补充从 TS 编译迁移至 Core Pass 的真实施工计划；移除 `application-runtime` 的无用依赖声明。

---

#### B. Migration Namespace 版本号在文档中倒错
- **涉及文档：**
  - [`docs/architecture/data/README.md`](file:///Users/macbookair/Desktop/LoomStudio/docs/architecture/data/README.md) L59, L80
- **文档声称：**
  - Narrative Store 使用 `application.narrative@1`
  - Agent Store 使用 `application.agent@2`
- **实际代码事实：**
  - [`packages/narrative-store/src/store.ts` L44-L46](file:///Users/macbookair/Desktop/LoomStudio/packages/narrative-store/src/store.ts)：包含了版本 1 和版本 2（添加了 `idx_narrative_timelines_card_updated` 索引），实际为 **`application.narrative@2`**。
  - [`packages/agent-store/src/store.ts` L34](file:///Users/macbookair/Desktop/LoomStudio/packages/agent-store/src/store.ts)：实际仅定义了版本 1，为 **`application.agent@1`**。
- **建议：**
  修正 `docs/architecture/data/README.md` 中的版本号，保持与 SQLite Schema 事实一致。

---

#### C. 虚假/过时文件引用
- **涉及文档：** [`docs/guide/project-structure.md`](file:///Users/macbookair/Desktop/LoomStudio/docs/guide/project-structure.md) L93
- **文档声称：**
  客户端包含 `shared/api/renderer-api.ts`（typed `renderer.*` RPC 映射）。
- **实际代码事实：**
  `apps/studio-client/src/shared/api/` 下只有 `studio-api.ts`、`client-bridge-logging.ts` 和 `client-json-object.ts`，**根本不存在 `renderer-api.ts`**。
- **建议：**
  从 `project-structure.md` 中删除对 `renderer-api.ts` 的描述。

---

#### D. Package 层级结构描述不符
- **涉及文档：** [`docs/guide/project-structure.md`](file:///Users/macbookair/Desktop/LoomStudio/docs/guide/project-structure.md) L158
- **文档声称：**
  `packages/extension-sdk/` 内包含了 `extension-host`。
- **实际代码事实：**
  `packages/extension-sdk` 与 `packages/extension-host` 是同级的两个独立 Workspace Package。
- **建议：**
  修正为两个独立包的并列描述。

---

### 🟡 [中] 2. ADR 决策状态过时（已实现但仍标为 Proposed）

#### A. ADR-003: Asset Store and Binary Payload Boundary
- **涉及文档：** [`docs/workbench/adr/ADR-003-asset-store-and-binary-payload-boundary.md`](file:///Users/macbookair/Desktop/LoomStudio/docs/workbench/adr/ADR-003-asset-store-and-binary-payload-boundary.md)
- **当前标示状态：** `Proposed / Refined`
- **实际代码事实：**
  `packages/blob-store` 和 `packages/asset-store` 已经作为独立 package 完整实现并被接入测试与运行链路，对应计划 `local-data-blob-store-foundation-plan.md` 也已标记为 `Implemented`。
- **建议：**
  将 ADR-003 状态更新为 **`Accepted / Implemented`**。

---

#### B. ADR-004: Platform Auth, Secrets, and Provider Credential Boundary
- **涉及文档：** [`docs/workbench/adr/ADR-004-platform-auth-secrets-and-provider-credential-boundary.md`](file:///Users/macbookair/Desktop/LoomStudio/docs/workbench/adr/ADR-004-platform-auth-secrets-and-provider-credential-boundary.md)
- **当前标示状态：** `Proposed`
- **实际代码事实：**
  `packages/secret-store`（含 Keyring / In-memory 双后端、`withSecret` 受控代理、两阶段清理）已完整实现并投入使用。
- **建议：**
  将 ADR-004 状态更新为 **`Accepted`**。

---

### 🟡 [中] 3. 历史 ADR 引用死链（Broken Relative Links）

- **涉及文档：**
  - `docs/workbench/adr/ADR-001-data-layer-workspace-sync.md`（引用了 `../04-data/...`、`../06-engineering/...`）
  - `docs/workbench/adr/ADR-002-extension-manifest-and-registration-model.md`（引用了 `../05-extensions/...`、`../06-engineering/...`）
  - `docs/workbench/adr/ADR-005-official-concept-stack-open-design.md`（引用了 `../00-overview/...`、`../03-kernel/...`、`../05-extensions/...`、`../06-engineering/...`、`../08-concept-stack/...`）
- **问题分析：**
  早期编号目录 `00-` ~ `08-` 在后续目录扁平化重构时已被迁移至 `docs/workbench/discussion/` 或 `docs/architecture/`。上述 ADR 顶部的关联链接均指向不存在的旧相对路径，产生大量 404 死链。
- **建议：**
  批量更新这些 ADR 顶部的 Related 链接，指向当前正确的 `docs/workbench/discussion/` 或 `docs/architecture/` 文件。

---

### 🟢 [低] 4. Workbench Plans 细粒度实施状态微调

- **`provider-profile-secret-store-foundation-plan.md`**：
  - 当前状态为 `In Progress / Provider Profile Backend Complete`。目前后端 `secret-store` 与 `provider-settings` 已经全部就绪，仅剩 Client 端最终表单契约收束。
- **`agent-session-narrative-timeline-data-layer-plan.md`**：
  - 核心 Narrative Timeline + Agent Session 已经完整落地并在前端交互，可将对应 phase 清单同步标记完成。

---

## 2. 审查汇总表

| 文档分类 | 文件路径 | 问题性质 | 修正建议 |
|---|---|---|---|
| **架构事实** | `architecture/application/prompt-build/README.md` | Core 接入描述与纯 TS 实现脱节 | 明确当前为 TS DataModel 编译，去掉已失真的 Core Pipeline 流程图 |
| **架构事实** | `architecture/data/README.md` | Migration 版本号倒错 | `narrative@1` 改为 `@2`；`agent@2` 改为 `@1` |
| **项目地图** | `guide/project-structure.md` | 引用不存在的 `renderer-api.ts` | 移除死引用 |
| **项目地图** | `guide/project-structure.md` | `extension-host` 描述为 sdk 内部 | 修正为独立同级 package |
| **决策记录** | `workbench/adr/ADR-003-*.md` | 状态滞后（标为 Proposed） | 升级为 `Accepted / Implemented` |
| **决策记录** | `workbench/adr/ADR-004-*.md` | 状态滞后（标为 Proposed） | 升级为 `Accepted` |
| **决策记录** | `workbench/adr/ADR-001/002/005` | 引用旧编号目录产生大量 404 断链 | 修正相对路径至 `workbench/discussion/` |
