# Architecture Decision Records

本目录保存已经形成明确决策的 ADR。ADR 可以长期保留，但状态、取代关系和当前权威入口必须准确。

| ADR | 当前状态 | 当前权威 / 说明 |
| --- | --- | --- |
| [`ADR-001`](ADR-001-data-layer-workspace-sync.md) | Partially Superseded | SQL / Workspace / Import-Export 边界仍有效；Runtime 与 Concept Stack 章节由 [`docs/architecture/application/`](../../architecture/application/) 取代 |
| [`ADR-002`](ADR-002-extension-manifest-and-registration-model.md) | Superseded | 由 [`ADR-006`](ADR-006-extension-package-module-instance-model.md) 取代 |
| [`ADR-003`](ADR-003-asset-store-and-binary-payload-boundary.md) | Accepted / Implemented | 当前事实见 [`docs/architecture/data/local-storage-and-assets.md`](../../architecture/data/local-storage-and-assets.md) |
| [`ADR-004`](ADR-004-platform-auth-secrets-and-provider-credential-boundary.md) | Accepted | Provider / Secret 边界继续演进，当前实现以 Architecture 和活跃 Plan 为准 |
| [`ADR-005`](ADR-005-official-concept-stack-open-design.md) | Historical / Superseded | 历史 AIRP 开放设计日志；当前入口为 [`docs/architecture/application/`](../../architecture/application/) 与 [`discussion/application/`](../discussion/application/) |
| [`ADR-006`](ADR-006-extension-package-module-instance-model.md) | Accepted | 当前事实见 [`docs/architecture/extensions/`](../../architecture/extensions/) |

状态变更时只更新 ADR 正文和本表。`docs/workbench/README.md` 不再复制第二份状态清单。
