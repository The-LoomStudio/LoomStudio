# Architecture Decision Records

本目录保存已经形成明确决策的 ADR。ADR 可以长期保留，但状态、取代关系和当前权威入口必须准确。

| ADR | 当前状态 | 当前权威 / 说明 |
| --- | --- | --- |
| [`ADR-001`](ADR-001-data-layer-workspace-sync.md) | Partially Superseded | SQLite Data Engine 与 Card Bundle / Import-Export 边界仍有效；Dev Workspace 尚未实现，Runtime / Provider / Tool 方向由 [`docs/architecture/application/`](../../architecture/application/) 与 [`docs/architecture/platform/`](../../architecture/platform/) 取代 |
| [`ADR-002`](ADR-002-extension-manifest-and-registration-model.md) | Superseded | 当前 Extension Package / Module / Instance 权威记录见 [`ADR-006`](ADR-006-extension-package-module-instance-model.md) 与 [`docs/architecture/extensions/`](../../architecture/extensions/) |
| [`ADR-003`](ADR-003-asset-store-and-binary-payload-boundary.md) | Accepted / Implemented | 当前 Blob / Asset Store 与 `GET /assets/:assetId` 事实见 [`docs/architecture/data/local-storage-and-assets.md`](../../architecture/data/local-storage-and-assets.md) |
| [`ADR-004`](ADR-004-platform-auth-secrets-and-provider-credential-boundary.md) | Partially Implemented / Needs Revision | Secret Store、Provider Profile 与受控凭据路径已实现；登录、KDF、用户 grant 与完整 Audit 闭环仍未完成，当前 Provider Adapter 事实见 [`docs/architecture/application/agent/provider-and-prompt-build.md`](../../architecture/application/agent/provider-and-prompt-build.md) |
| [`ADR-005`](ADR-005-official-concept-stack-open-design.md) | Historical / Superseded | 历史 AIRP 开放设计日志；当前事实见 [`docs/architecture/application/`](../../architecture/application/)，开放问题见 [`discussion/application/`](../discussion/application/) |
| [`ADR-006`](ADR-006-extension-package-module-instance-model.md) | Accepted / Implemented | Package / Module / Instance 与已实现 Client Host 事实见 [`docs/architecture/extensions/`](../../architecture/extensions/) |

状态变更时只更新 ADR 正文和本表。`docs/workbench/README.md` 不再复制第二份状态清单。
