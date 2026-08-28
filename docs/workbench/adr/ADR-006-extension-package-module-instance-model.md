# ADR-006: Extension Package / Module / Instance 模型

- **Status**: Accepted
- **Date**: 2026-08-14
- **Supersedes**: [`ADR-002-extension-manifest-and-registration-model.md`](ADR-002-extension-manifest-and-registration-model.md)
- **Related**:
  - [`../plans/extension-package-module-foundation-plan.md`](../../archive/plans/extension-package-module-foundation-plan.md)
  - [`../discussion/extensions/studio-extension-manifest-architecture.md`](../../archive/discussion/extensions/studio-extension-manifest-architecture.md)

## Context

Manifest v1 把 Package identity、Server/Client entry、启用状态、权限和一次运行实例都压在单一 `extensionId` 上。这无法表达同一分发包中的多个独立 Module，也错误排除了 Client-only 与纯资源 Package。

## Decision

Extension 使用三层身份：

- **Package**：安装、版本、来源、签名、声明式资源 provenance 与共享持久数据边界；
- **Module**：`packageId + moduleId` 标识的 entry、runtime、enabled、capability request/grant 与 runtime contribution 边界；
- **Instance**：一个 Host 中一次实际激活，拥有独立 `instanceId`、Scope 和临时注册资源。

Manifest 升级为 v2：Package 顶层可以携带声明式 `contributes`，`modules[]` 可以为空；Module 声明 `runtime`、`entry`、`capabilities` 与 runtime `contributes`。

Server Manager 只编排 Server Module；Client Module 当前进入同一 Catalog 和 desired state，但真实 Instance 属于未来 Client Host。Module 独立启停、grant 和 reload，同包 sibling 不继承权限。

RPC/Event 的公开名称继续使用 Package namespace；Registry、Logger、Diagnostic 与 Introspection 同时记录 Package、Module、Instance owner。Extension-owned Document 继续保持 Package 级归属，现有 `ownerExtensionId` 字段暂不迁移数据库语义。

Server Host 默认只允许 Module 操作自己声明、且归当前 Package 所有的 Document type。通用 `ctx.rpc.call` 不提供 Kernel/Application 管理面绕过；更高权限必须由后续窄 capability 明确授予。

当前同进程 Server Module 仍是受信任代码。Module identity 是 Host capability 与审计边界，不被描述为强安全沙箱。

## Consequences

- 一个 Package 可以拥有零个或多个 Server/Client Module，也可以只携带资源；
- Package source conflict 与资源 provenance 保持稳定，运行生命周期不再被 Package 粗粒度绑定；
- 状态与授权以 `packageId + moduleId` 持久化，旧 Manifest v1 和旧管理 RPC 不继续双轨维护；
- Client Host、依赖图、加载顺序、Marketplace、安装器和进程隔离必须在后续独立设计，不塞入当前 Server 基座。
