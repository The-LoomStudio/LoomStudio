# Extension Architecture

Loom Studio 当前采用 **Package / Module / Instance** 三层 Extension 模型。Package 是分发、来源与持久资源归属边界；Module 是入口、runtime、启用状态、权限与贡献合同边界；Instance 是一次实际激活及其临时注册资源的生命周期边界。

当前已实现 Server Module Host 与 Package Catalog；Client Module 可以被发现和保存 desired state，Extension Catalog 的状态变化也可以通过专用 SSE 到达浏览器。Client Host、UI runtime 与通用跨端 Event Transport 尚未实现。

本文对应当前实现与可执行验证：

- [`packages/extension-sdk/src/index.ts`](../../../packages/extension-sdk/src/index.ts)
- [`packages/extension-sdk/extension-host/src/index.ts`](../../../packages/extension-sdk/extension-host/src/index.ts)
- [`apps/studio-server/src/extensions/`](../../../apps/studio-server/src/extensions/)
- [`scripts/verify-server-extension.ts`](../../../scripts/verify-server-extension.ts)
- [`scripts/verify-server-extension-manager.ts`](../../../scripts/verify-server-extension-manager.ts)

## 1. 三层身份

```text
Extension Package
  packageId：安装、版本、来源、资源 provenance 与共享持久数据边界

  -> Extension Module
       packageId + moduleId：runtime、entry、enabled、grant 与 contribution 边界

       -> Extension Instance
            instanceId：一次激活及其 Scope、RPC、Event、Logger、Diagnostic 边界
```

一个 Package 可以包含零个或多个 `server` / `client` Module。没有 Module 的纯资源 Package 合法；一个 Package 也可以同时携带声明式资源和可执行 Module。Server 与 Client 是 Module runtime，不表示“同一个插件的两半”。

Module ID 只需在 Package 内唯一。内部使用结构化 `packageId`、`moduleId`；日志和 Registry owner 可显示为 `<packageId>/<moduleId>`，公开 RPC/Event 名称仍使用 Package namespace。

Package 内的 Module 不继承 sibling grant。当前 Server Module 与宿主同进程运行，因此这种边界是 Host capability、审计和产品授权边界，不是强安全沙箱。

## 2. Package Catalog 与 Server Manager

Server Extension Manager 负责：

- 扫描仓库 `extensions/*`、本地 dev links 与 `installed/<package-id>/<version>`；
- 按 `packageId` 建立 Catalog 并处理来源冲突；
- 校验 Manifest v2、Module ID、runtime 与 entry 路径边界；
- 发现 Client-only 和纯资源 Package，但只编排 Server Module；
- 按 `packageId + moduleId` 持久化 enabled、事件与 Asset capability grant；
- 从本地目录安全安装 Package，并只卸载 installed 来源；
- 串行执行 Module enable、disable 与 reload；
- 汇总 Package 来源、资源、Module desired state 与真实 Server runtime。

新 Module 默认禁用。同一 `packageId` 来自多个目录时，整个 Package 标记 unavailable，不选择隐式赢家。一个 Server Module 的激活失败不会阻止 sibling 或 Studio Server 启动。

Client Module 当前只有 Catalog 和 desired state。Server Manager 不伪造 Client Instance，也拒绝代替未来 Client Host 执行 reload。

## 3. Manifest v2

```json
{
  "manifestVersion": 2,
  "id": "author.example",
  "version": "1.0.0",
  "displayName": "Example Package",
  "description": "Example package description.",
  "icon": "./icon.png",
  "author": "Example Author",
  "homepage": "https://example.com/author.example",
  "repository": "https://github.com/example/author.example",
  "tags": ["prompt", "developer-tool"],
  "engines": { "studio": "^0.1.0" },
  "modules": [
    {
      "id": "server",
      "runtime": "server",
      "entry": "./dist/server.js",
      "capabilities": {
        "events.subscribe": ["documents"],
        "assets.publish": true,
        "assets.read": true
      },
      "contributes": {
        "rpc": [{ "name": "author.example.status" }]
      }
    },
    {
      "id": "panel",
      "runtime": "client",
      "entry": "./dist/panel.js"
    }
  ],
  "contributes": {
    "transformRules": [
      { "source": "./resources/clean-output.rule.json" }
    ]
  }
}
```

顶层 `contributes` 是 Package 携带的声明式资源索引；`modules[*].contributes` 是对应 Module 的 runtime contribution contract。capability request 必须属于具体 Module。

Manifest declaration 是静态合同，Runtime registration 是当前事实。开发/测试模式下，未声明的 RPC/Event 产生 warning 并使实例 degraded；生产模式拒绝未声明注册。声明但未注册也会产生 Diagnostic。

Package 展示元数据保持为一组轻量可选字段：`description`、`icon`、`author`、`homepage`、`repository` 与 `tags`。`tags` 只用于搜索、分类和展示，不参与权限、加载顺序或 capability 判定；旧 `roles` 字段不再接受。`homepage` / `repository` 必须是 HTTP(S) 绝对 URL，`icon` 必须是 Package 内的 PNG、JPEG、WebP 或 GIF 相对路径。

## 4. Server Module Host 与 Scope

每个 Server Module 独立 discover、load、activate、reload 与 dispose，当前最多一个活动实例。重复 activation 被拒绝；reload 先释放旧实例，再加载并激活新实例，生成新的 `instanceId`。

Server Module 通过 `activate(ctx)` 获得当前实例绑定的 capability facade：

- `ctx.extension.packageId/moduleId/runtime/instanceId`；
- scoped Logger 和 Diagnostics；
- 当前 Module 的事件 grant snapshot；
- 当前 Module 的 Asset grant snapshot；
- RPC register/call；
- Event define/emit/subscribe；
- Package-owned Document get/list/write/delete；
- Media Asset publish/read 与 Instance scratch materialize；
- `AbortSignal` 与 dispose callback。

Host 不暴露 Kernel、SQL connection 或内部 Registry，也不保存插件业务状态。

`ctx.rpc.call()` 只用于调用 Extension RPC。它拒绝 `system.*`、`docs.*`、`extensions.*`、`application.*` 等 Studio 保留 namespace，插件不能借通用 RPC 绕过 Host capability。Application 领域能力未来通过明确的 typed capability / RPC contract 开放，不把全部 Studio RPC 默认交给插件。

实例 Scope 的清理顺序是：停止接收新调用并 abort、等待已进入 callback、按注册反序执行 disposer、汇总清理错误。旧实例 handle 只能删除自己注册的资源，因此 reload 一个 Module 不会误删 sibling 或新实例的 RPC/Event。

## 5. 归属与公开能力

| 对象 | 当前归属 |
|---|---|
| Package source、version、声明式资源 | `packageId` |
| Module desired state、grant、runtime contribution | `packageId + moduleId` |
| RPC/Event 注册、订阅、Logger、Diagnostic | `packageId + moduleId + instanceId` |
| Extension-owned Document | Package 级；现有字段名仍为 `ownerExtensionId` |

公开 RPC/Event 继续使用 `<packageId>.*` namespace，不强制重复 Module ID。Kernel Registry 与 `system.introspect` 记录实际 owner 为 `extension:<packageId>/<moduleId>`；同包 Module 注册同名能力时按普通冲突拒绝。

Extension Event 的 definition、publisher 与 subscriber 都携带 Package、Module、Instance identity。Module 自己的 protected event 使用 `extension:<packageId>` capability；跨 Module 协作应走 Host RPC/Event，而不是获取 sibling 实例对象。

Event 只广播已经发生的事实，不提供返回值，也不改变发布者业务结果。完整数据通过 ID 和 typed RPC 查询，不通过 event payload 广播正文、Prompt 或 Secret。

### 5.1 Document 权限门

Server Module 的 `ctx.documents` 当前执行以下默认拒绝规则：

- Module 只能创建、读取、列举、修改和删除自己 Manifest `contributes.documentTypes` 声明的类型；
- Document type 必须位于 `<packageId>.*` namespace；
- 创建时 Host 强制写入 Package owner 和 Extension actor；插件提供的 owner/actor metadata 不进入 SDK contract；
- `get/write/delete` 会检查现有 Document 的 `ownerExtensionId`，不能读取、夺取或删除官方及其他 Package 的 Document；
- `list` 必须提供已声明 type，Host 强制附加当前 Package owner filter，调用方不能伪造 owner；
- Package 内 sibling Module 如需共享同一 Document type，必须分别声明该 type。

当前没有 `documents.read:any`、跨 Package grant 或可信插件豁免。出现明确用例后应增加窄 capability，而不是开放通用 Store。Extension transaction、调用级 correlation 继承和 Application typed capability 仍是后续工作。

### 5.2 Media Asset 权限门

`ctx.assets.publish` 需要 Module Manifest 请求并由用户授予 `assets.publish`。Host 强制写入当前 Package owner，插件不能伪造。Package 可直接读取自己的 Asset；读取其他 Package 或用户 Asset 需要 `assets.read`。Host 不暴露 Blob root、全局 Asset list 或任意文件系统目录。

`ctx.assets.materialize` 复用相同读取判定，只把字节写入 `cache/extensions/<package-id>/<instance-id>`。该路径用于需要实体文件的外部工具，属于 Instance scratch，reload / dispose 后删除；正式 Asset 仍由 Blob Store 持有。

## 6. 管理 RPC

Kernel 当前提供：

```text
extensions.listPackages
extensions.installPackage
extensions.uninstallPackage
extensions.enableModule
extensions.disableModule
extensions.reloadModule
extensions.getDiagnostics
```

`installPackage` 当前接收本地 `sourceDirectory`，安全复制并原子安装到用户数据目录；不处理 Archive 或网络下载。`uninstallPackage` 只接受 installed 来源，仓库 Package 与 dev-link 不可由该 RPC 删除。定位字段使用独立 `packageId` 与 `moduleId`。

`extensions.listPackages` 是插件管理界面的初始快照入口。Package 项返回上述静态元数据、受控 `iconUrl`、不含绝对目录的 `sourceKinds`，以及 `available`、Module desired/runtime state 和声明式资源。图标通过 `GET /extensions/:packageId/:version/icon` 读取，浏览器不会获得 Package 的物理目录。

动态变化通过 `GET /extensions/events` 的 SSE 连接推送。当前只转发 `extensions.changed`，覆盖 installed、uninstalled、enabled、disabled 与 reloaded；事件只携带 `packageId`、可选 `moduleId/version` 和 action。客户端收到事件后重新调用 `extensions.listPackages` 获取权威快照，不把 SSE payload 当作完整状态或新的 CRUD 通道。

## 7. 当前明确未实现

- Client Extension Host 与 Direct/Shadow DOM/iframe/Worker adapter；
- Client HMR、Panel Registry 与通用跨端 Event Transport；
- `extensions.changed` SSE 的 Client 消费与插件管理 UI；
- Module dependency graph、加载顺序和通用 DI Container；
- Archive 安装、Marketplace、签名、更新与依赖求解；
- Transform Rule 执行器；
- Hook Registry、durable Trigger / Job Queue；
- 不可信 Server 代码的 Worker/进程沙箱。

Server Module 当前仍是受信任本地 Node.js 代码。Host capability 不能阻止代码直接调用文件系统、网络或进程 API；真正的强隔离必须由 Worker 或独立进程提供。
