# Extension Package Source、pnpm 与 Host Runtime 改进计划

> **状态**：延期规划 / 高级扩展生态能力
>
> **日期**：2026-08-25
>
> **触发条件**：需要从本地 Archive、Git、私有 Registry 或公共 Registry 安装第三方 Extension，或者准备开放不受信任的 Extension Marketplace。
>
> **事实边界**：本文记录 Package 获取、安装与 Extension Runtime 的分层方向，不是当前实施授权。现有目录安装、Package / Module / Instance、`activate(ctx)`、desired state 与 capability grant 合同保持不变。

## 1. 决策摘要

pnpm / NPM 只负责 Extension 的开发、构建、包来源与可选版本解析，不取代 Loom Studio 的 Installer、Extension Host 或 Context Capability。

```text
pnpm / Registry / local directory / local tarball
  -> Package Source
  -> Loom Installer
  -> Package Catalog and desired state
  -> Extension Host
  -> Module Instance
  -> ExtensionActivationContext
  -> approved Application / Kernel capabilities
```

职责边界：

```text
Package Source 决定代码如何来到机器上。
Installer 决定文件能否安全落盘。
Host 决定 Module 是否以及如何运行。
CTX 决定 Instance 能调用哪些宿主能力。
```

## 2. 当前实现事实

当前 Extension 架构已经实现：

- Package / Module / Instance 三层身份；
- Manifest v2；
- 本地目录安全安装与原子落盘；
- Server Module discover / activate / reload / dispose；
- `packageId + moduleId` desired state 与 grant；
- instance-scoped RPC、Event、Document、Asset、Logger、Diagnostic 与清理 Scope。

当前尚未实现：

- Archive / `.tgz` 安装；
- NPM、Git 或 Marketplace Package Source；
- 在线更新、签名和依赖求解；
- Client Extension Host；
- 不可信 Server Extension 的 Worker / 进程隔离。

Server Module 当前通过 Node ESM 动态导入在 Studio Server 进程内运行。因此 Host capability 是正式身份、授权、审计和生命周期边界，但不是抵御恶意 Node 代码的强安全沙箱。

## 3. pnpm Monorepo 的职责

当前 pnpm Workspace 继续用于官方仓库和 Extension 作者开发：

- `workspace:*` 链接本地 SDK 和内部包；
- 单 Lockfile 固定开发依赖；
- `pnpm --filter` 定向构建和测试；
- 官方 Extension、示例和 SDK 可在同一提交中演进；
- pnpm 严格依赖解析可发现未声明依赖；
- 内容寻址 Store 减少 Monorepo 重复文件。

这些能力不直接成为最终用户安装合同。第三方 Extension 离开 Monorepo 后必须产生自包含构建产物，不能依赖宿主仓库中的 `workspace:*` 或 deep import。

## 4. Package Source 模型

未来 Installer 可以接受多个来源，但所有来源必须归一为同一份待验证 Package 输入：

```text
PackageSource
  local-directory
  local-tarball
  git-release
  npm-registry
  private-registry
  official-marketplace

resolve source
  -> bytes or staging directory
  -> integrity / provenance
  -> Loom Installer validation
```

NPM Package 不要求发布到 npmjs.com。合法来源可以包括：

- pnpm Workspace 中的本地目录；
- `pnpm pack` 生成的本地 `.tgz`；
- GitHub / GitLab Release；
- Git URL；
- Verdaccio、GitHub Packages 等私有 Registry；
- 公共 NPM Registry。

产品内部不应把 npmjs.com 写死为唯一来源。Package Source Adapter 负责下载和来源 Metadata，Installer 只接收明确字节或 staging directory。

## 5. NPM Metadata 与 Loom Manifest

`package.json` 和 Loom Manifest 承担不同责任：

| 文件 | 责任 |
| --- | --- |
| `package.json` | NPM 名称、版本、构建脚本、开发依赖、发布文件与 Registry Metadata |
| Loom `manifest.json` | Package、Module、entry、Studio engine、capability request 与 contribution contract |

NPM 名称可以作为来源标识，例如 `@loom-extensions/example`，但 Loom 的 `packageId`、权限 namespace 和 runtime identity 仍以经过验证的 Loom Manifest 为准。

不通过以下方式推断权限或主体：

- NPM Scope；
- 包作者字段；
- Tarball 文件名；
- 谁依赖了谁；
- 安装目录名称。

## 6. 本地无 Registry 分发

首个 Package Source 改进应优先支持本地 NPM-compatible Tarball：

```text
Extension project
  -> pnpm build
  -> pnpm pack
  -> extension-name-version.tgz
  -> Loom install package
```

Loom 不需要执行 `pnpm add`。Installer 直接读取 Tarball，执行与目录安装一致的安全校验，再原子落盘到：

```text
installed/<package-id>/<version>
```

Tarball 安装至少拒绝：

- absolute path、path traversal、symlink 和特殊文件；
- 重复 entry、非法 Manifest 路径和不匹配的 ID / version；
- 超过文件数量、单文件或总大小限制的 Package；
- Hash / integrity mismatch；
- Manifest 未声明或无法解析的 Module entry；
- 安装生命周期脚本触发。

## 7. 依赖策略

### 7.1 普通 JavaScript 依赖

Extension 发布产物原则上自包含。普通第三方库在构建时 bundle 到 Server / Client entry，最终用户安装时不再递归执行 NPM dependency installation。

原因：

- 避免 Registry 离线和依赖树漂移；
- 避免 `preinstall` / `postinstall`；
- 避免 native addon 与 Node ABI；
- 避免 dependency confusion；
- 避免不同 Extension 共享可变 `node_modules`；
- 让 Package Hash 对应真实可执行产物。

SDK 可以作为开发期依赖。正式 Artifact 中的 identity helper 应被 bundle / tree-shake，或者未来成为 Host 明确提供的 external；不能依赖偶然存在的 Workspace link。

### 7.2 Loom Extension 依赖

一个 Extension 需要另一个 Loom Extension 时，应在 Loom Manifest 中声明类型化 Requirement，而不是依赖普通 NPM `dependencies` 自动激活：

```text
require extension package and version
  -> Installer / Catalog reports availability
  -> user explicitly enables required Module
  -> Host evaluates grants and activation order
```

首版只做缺失依赖 Diagnostic，不自动下载、启用或授予权限。真实跨 Extension 用例出现后，再决定版本求解、冲突和加载顺序。

## 8. Host 与 CTX 保持不变

Package Source 不参与 Extension Runtime。无论 Package 来自 Workspace、本地目录、本地 Tarball 还是 Registry，Host 都按相同流程运行：

```text
discover verified Manifest
  -> create Module record
  -> read desired state and grants
  -> create Instance and Scope
  -> load entry
  -> activate(ctx)
  -> register capabilities
  -> dispose / reload cleanup
```

普通 Extension 只能通过 `ExtensionActivationContext` 使用宿主正式能力。`ApplicationRuntimeContext` 继续是 Application 内部基础设施，不暴露给 Extension。

CTX 的长期价值是把 Extension API 与实际运行位置解耦：

```text
current in-process Host
  ctx.documents.get() -> direct Host facade

future process-isolated Host
  ctx.documents.get() -> IPC proxy -> Host validation -> Document Store
```

Extension 作者的调用合同可以保持稳定，Host 内部可以从同进程迁移到 Worker 或独立进程。

## 9. 声明式资源与可执行 Module

Package 不一定进入 Host：

```text
Package only contributes declarative resources
  -> Installer / Importer registers resources
  -> no Instance
  -> no CTX

Package contains server or client Module
  -> Extension Host
  -> Instance + CTX
```

Preset、Setting、图片和普通规则不会因为通过 NPM Tarball 分发就获得 Extension 身份。独立 Agent Script 进入未来 Script Runtime，也不自动提升为 Server Extension Module。

## 10. 不可信 Extension 的安全门槛

在开放公共 Registry 或 Marketplace 安装前，必须重新审核 Server Runtime isolation。当前同进程 Host 无法阻止 Extension 代码直接访问 Node filesystem、network 或 process API。

候选目标链：

```text
Extension Worker / child process
  -> IPC capability proxy
  -> Host identity and grant validation
  -> timeout / memory / output limits
  -> audit and diagnostics
```

公共生态至少需要：

- Package integrity 与可追溯来源；
- 安装脚本禁用；
- Worker / 进程隔离；
- filesystem、network、secret 和 process capability；
- CPU、内存、时间和输出限制；
- crash、reload、abort 与 cleanup；
- 用户可审阅的权限与更新差异。

签名不能替代 Runtime isolation；隔离也不能替代来源验证和用户授权。

## 11. 推荐实施顺序

只有对应需求出现后才推进：

1. **自包含 Artifact**：冻结 Extension build output，拒绝未解析的 Workspace / Host runtime import。
2. **本地 Tarball Source**：在现有目录 Installer 前增加安全 `.tgz` 解包层。
3. **Package Source 接口**：统一 local directory、local tarball、Git 和 Registry 输出。
4. **Registry Metadata**：支持版本发现、integrity、缓存和来源展示，不自动安装依赖。
5. **Requirement Diagnostic**：只报告缺失的 Loom Extension / engine 需求。
6. **Runtime Isolation**：公共 Marketplace 前完成 Server Worker / process Host。
7. **Client Host**：按独立生命周期、Bridge 和 UI sandbox 合同实现。
8. **依赖求解**：只有真实跨 Extension 依赖出现后才加入 SemVer resolver 和 activation order。

## 12. 最小验证要求

未来实现至少验证：

- 同一 Package 从目录与 `.tgz` 安装得到相同 Manifest 和 entry；
- Tarball traversal、symlink、特殊文件、超限和 integrity mismatch 被拒绝；
- Package Source 不改变 `packageId + moduleId` desired state 与 grant；
- 使用不同来源安装的 Module 获得相同 CTX 能力边界；
- 未启用 Module 不创建 Instance；
- 纯资源 Package 不进入 Host；
- reload / dispose 清理 RPC、Event、scratch 和 disposer；
- Extension 无法通过 `ctx.rpc` 调用 Studio 保留 namespace；
- process-isolated Host 与当前 Host 通过同一 SDK contract test；
- Package 下载成功不等于 Extension 已获得执行授权。

## 13. 明确非目标

- 当前阶段嵌入完整 pnpm CLI；
- 在用户 Workspace 执行 `pnpm install`；
- 运行 NPM lifecycle scripts；
- 自动安装 native addon；
- 把 `node_modules` 作为共享插件运行目录；
- 用 NPM dependencies 代替 Loom capability 与 Requirement；
- Package 安装后自动启用 Module；
- 通过公开 Registry 安装不可信同进程代码；
- 删除 Host、CTX、Grant、Scope 或 lifecycle；
- 把 `ApplicationRuntimeContext` 暴露给普通 Extension。

## 14. 实施前开放问题

1. 首个 Archive 使用标准 NPM `.tgz`，还是同时接受 `.zip`；
2. Registry Source 首批支持 NPM protocol、GitHub Release 还是官方 Marketplace；
3. NPM package name 与 Loom `packageId` 是否要求一一映射；
4. Server entry 首批是否必须单文件 bundle；
5. Host external 是否只允许一个稳定的 SDK runtime helper；
6. Worker Thread 与独立子进程谁作为首个强隔离目标；
7. Requirement 首批只记录 Package，还是精确到 Module 和 capability；
8. 私有 Registry 的 Credential 进入 Secret Store 还是 Package Source 专用账户模型；
9. Package 更新时如何展示 Manifest、capability 与 executable diff；
10. Offline cache 与 Package provenance 的保留周期。
