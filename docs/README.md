# Loom Studio Docs

> **Status**: Living index（2026-05-14）
> **Purpose**: 给 Studio 文档分类导航，避免架构、数据层、插件、工程实施与客户端文档混在同一层级。

---

## 目录分类

```text
docs/
├── 00-overview/      总体架构与顶层说明
├── 02-methodology/   讨论方法、场景驱动设计、规格收口方式
├── 03-kernel/        Kernel、Transport、RPC public surface
├── 04-data/          Data Layer、Document Store、Trace / Audit
├── 05-extensions/    Extension Manifest、Lifecycle、Registration
├── 06-engineering/   仓库工程、依赖选型、package API、local state、MVP 施工
├── 07-client/        Client / UI 相关文档
├── 08-ApplicationLayer/ Studio Application / AIRP 领域层开放设计
├── 09-PlatformLayer/ AI Gateway、Provider Extension、平台级共享能力
└── adr/              已接受或待接受的架构决策记录
```

---

## 00 Overview

- [`00-overview/loom-studio-architecture.md`](00-overview/loom-studio-architecture.md)

---

## 02 Methodology

- [`02-methodology/README.md`](02-methodology/README.md)
- [`02-methodology/scenario-driven-design-v0.md`](02-methodology/scenario-driven-design-v0.md)

---

## 03 Kernel / Protocol

- [`03-kernel/studio-kernel-public-surface-v0.md`](03-kernel/studio-kernel-public-surface-v0.md)
- [`03-kernel/studio-rpc-methods-v0.md`](03-kernel/studio-rpc-methods-v0.md)
- [`03-kernel/studio-transport-protocol-v0.md`](03-kernel/studio-transport-protocol-v0.md)

---

## 04 Data

- [`04-data/studio-data-layer-architecture.md`](04-data/studio-data-layer-architecture.md)
- [`04-data/studio-document-store-engineering-v0.md`](04-data/studio-document-store-engineering-v0.md)
- [`04-data/studio-trace-audit-correlation-v0.md`](04-data/studio-trace-audit-correlation-v0.md)

---

## 05 Extensions

- [`05-extensions/studio-extension-manifest-architecture.md`](05-extensions/studio-extension-manifest-architecture.md)
- [`05-extensions/studio-extension-lifecycle-v0.md`](05-extensions/studio-extension-lifecycle-v0.md)

---

## 06 Engineering

- [`06-engineering/studio-mvp-development-plan.md`](06-engineering/studio-mvp-development-plan.md)
- [`06-engineering/loom-studio-mvp-engineering.md`](06-engineering/loom-studio-mvp-engineering.md)
- [`06-engineering/studio-repository-engineering-v0.md`](06-engineering/studio-repository-engineering-v0.md)
- [`06-engineering/studio-dependency-and-runtime-choices-v0.md`](06-engineering/studio-dependency-and-runtime-choices-v0.md)
- [`06-engineering/studio-initial-package-api-v0.md`](06-engineering/studio-initial-package-api-v0.md)
- [`06-engineering/studio-config-and-local-state-v0.md`](06-engineering/studio-config-and-local-state-v0.md)

---

## 07 Client

- [`07-client/loom-studio-ui.md`](07-client/loom-studio-ui.md)

---

## 08 Application Layer

- [`08-ApplicationLayer/README.md`](08-ApplicationLayer/README.md)
- [`08-ApplicationLayer/document-map-v0.md`](08-ApplicationLayer/document-map-v0.md)
- [`08-ApplicationLayer/asset-import-export-boundary-v0.md`](08-ApplicationLayer/asset-import-export-boundary-v0.md)
- [`08-ApplicationLayer/isolation-scope-boundary-v0.md`](08-ApplicationLayer/isolation-scope-boundary-v0.md)
- [`08-ApplicationLayer/session-timeline-data-model-v0.md`](08-ApplicationLayer/session-timeline-data-model-v0.md)
- [`08-ApplicationLayer/runtime-turn-flow-v0.md`](08-ApplicationLayer/runtime-turn-flow-v0.md)
- [`08-ApplicationLayer/provider-adapter-contract-v0.md`](08-ApplicationLayer/provider-adapter-contract-v0.md)
- [`08-ApplicationLayer/prompt/README.md`](08-ApplicationLayer/prompt/README.md)
- [`08-ApplicationLayer/composition-skeleton-v0.md`](08-ApplicationLayer/composition-skeleton-v0.md)
- [`08-ApplicationLayer/composition-pipeline-v0.md`](08-ApplicationLayer/composition-pipeline-v0.md)

---

## 09 Platform Layer

- [`09-PlatformLayer/README.md`](09-PlatformLayer/README.md)
- [`09-PlatformLayer/ai-gateway-and-provider-extension-v0.md`](09-PlatformLayer/ai-gateway-and-provider-extension-v0.md)

---

## ADR

- [`adr/ADR-001-data-layer-workspace-sync.md`](adr/ADR-001-data-layer-workspace-sync.md)
- [`adr/ADR-002-extension-manifest-and-registration-model.md`](adr/ADR-002-extension-manifest-and-registration-model.md)

---

## 阅读建议

正式动工前建议按顺序阅读：

1. Overview：理解 Studio 总边界；
2. Methodology：理解讨论方法、场景驱动设计和规格收口方式；
3. ADR：理解已接受决策；
4. Kernel / Protocol：锁定 Kernel public surface 与 RPC；
5. Data：锁定 Document Store / rollback / trace-audit；
6. Extensions：锁定 Manifest / activation / registration；
7. Engineering：锁定 MVP 阶段门控计划、仓库骨架、依赖、package API 与 local state；
8. Application Layer：理解 Studio Application / AIRP 领域层开放设计。

如果只准备做 PR-1 仓库初始化，优先阅读：

- [`06-engineering/studio-mvp-development-plan.md`](06-engineering/studio-mvp-development-plan.md)
- [`06-engineering/studio-repository-engineering-v0.md`](06-engineering/studio-repository-engineering-v0.md)
- [`06-engineering/studio-dependency-and-runtime-choices-v0.md`](06-engineering/studio-dependency-and-runtime-choices-v0.md)
- [`06-engineering/studio-initial-package-api-v0.md`](06-engineering/studio-initial-package-api-v0.md)
- [`06-engineering/studio-config-and-local-state-v0.md`](06-engineering/studio-config-and-local-state-v0.md)
