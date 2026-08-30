# 历史 Discussion 与里程碑规格

本目录保存已经被当前 Architecture 取代、对应实现已删除，或只用于回溯早期 MVP / M0 决策的讨论稿。

这些文档已经冻结，不再作为当前施工或实现合同。当前事实优先级为：

```text
当前代码与测试
  -> docs/architecture
  -> docs/workbench 中仍标记 Active / Open 的文档
  -> 本目录
```

## 归档内容分类

### 1. 早期项目愿景与 MVP 施工
- [`whitepaper-v0.md`](whitepaper-v0.md) — 早期愿景白皮书；
- [`studio-repository-engineering-v0.md`](studio-repository-engineering-v0.md) — 早期 monorepo 仓库工程选型；
- [`studio-dependency-and-runtime-choices-v0.md`](studio-dependency-and-runtime-choices-v0.md) — 早期依赖与运行时决策；
- [`studio-initial-package-api-v0.md`](studio-initial-package-api-v0.md) — 初期 Package API 规划；
- [`loom-studio-mvp-engineering.md`](loom-studio-mvp-engineering.md) — MVP 阶段工程规格；
- [`studio-mvp-development-plan.md`](studio-mvp-development-plan.md) — MVP 阶段开发计划；
- [`studio-config-and-local-state-v0.md`](studio-config-and-local-state-v0.md) — 本地配置与状态历史草案。

### 2. Application 历史规格
- [`application/m0-backend-slice-v0.md`](application/m0-backend-slice-v0.md) — 已删除的旧 Session / submitTurn M0 切片；
- [`application/composition-pipeline-v0.md`](application/composition-pipeline-v0.md) — 已被当前 PromptBuild Architecture 取代的候选 M0 pipeline；
- [`application/loom-core-integration-v0.md`](application/loom-core-integration-v0.md) — 已被 `docs/architecture/application/prompt-build/loom-core/` 取代的 Loom Core 接缝讨论；
- [`application/frontend-naming-audit-v0.md`](application/frontend-naming-audit-v0.md) — 已完成的早年前端重命名审计记录。

### 3. Data 层历史草案（已晋升至 `docs/architecture/data/`）
- [`data/studio-data-layer-architecture.md`](data/studio-data-layer-architecture.md) — 早期 SQLite / Document Store 数据层问题清单；
- [`data/studio-document-store-engineering-v0.md`](data/studio-document-store-engineering-v0.md) — 早期 Document Store 工程约束；
- [`data/studio-trace-audit-correlation-v0.md`](data/studio-trace-audit-correlation-v0.md) — 早期 Trace / Audit 关联机制草案。

### 4. Kernel 层历史协议（已晋升至 `docs/architecture/kernel/`）
- [`kernel/studio-transport-protocol-v0.md`](kernel/studio-transport-protocol-v0.md) — WebSocket-only 旧传输协议；
- [`kernel/studio-rpc-methods-v0.md`](kernel/studio-rpc-methods-v0.md) — 伪事件订阅旧 RPC 列表；
- [`kernel/studio-kernel-public-surface-v0.md`](kernel/studio-kernel-public-surface-v0.md) — 第一版 Kernel public surface 约束草案。

### 5. Extension 扩展系统历史方案（已晋升至 `docs/architecture/extensions/`）
- [`extensions/studio-extension-manifest-architecture.md`](extensions/studio-extension-manifest-architecture.md) — Manifest v1 历史规范；
- [`extensions/studio-extension-lifecycle-v0.md`](extensions/studio-extension-lifecycle-v0.md) — 单体 Extension 旧生命周期；
- [`extensions/studio-extension-host-capabilities-v0.md`](extensions/studio-extension-host-capabilities-v0.md) — Extension Host Capability 早期讨论稿。

### 6. UI 基础历史规范（已晋升至 `docs/architecture/ui/`）
- [`ui/css-architecture-and-customization-v0.md`](ui/css-architecture-and-customization-v0.md) — 早期 CSS 架构与主题定制草稿；
- [`ui/i18n-and-accessibility-v0.md`](ui/i18n-and-accessibility-v0.md) — 早期国际化与无障碍草稿；
- [`ui/ui-foundation-v0.md`](ui/ui-foundation-v0.md) — 早期 UI 原则与视觉草稿。
