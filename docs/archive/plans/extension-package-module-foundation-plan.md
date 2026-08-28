# Extension Package / Module 基座实施计划

> **状态**：Complete  
> **日期**：2026-08-14  
> **范围**：把当前“一份 Manifest = 一个 Extension = 一个 Server Instance”的模型重构为 Package、Module、Instance 三层，为多 Server/Client Module、纯资源包和后续 Client Host 建立稳定身份与生命周期边界。  
> **非目标**：本计划不实现 Marketplace、正式安装器、签名、自动更新、第三方依赖求解、Client UI Runtime、Transform Rule 执行器或资源 Binding Graph。

相关文档：

- [`../discussion/extensions/studio-extension-manifest-architecture.md`](../discussion/extensions/studio-extension-manifest-architecture.md)
- [`../discussion/extensions/studio-extension-lifecycle-v0.md`](../discussion/extensions/studio-extension-lifecycle-v0.md)
- [`../discussion/extensions/studio-extension-host-capabilities-v0.md`](../../workbench/discussion/extensions/studio-extension-host-capabilities-v0.md)
- [`../discussion/application/transform-rule-system-v0.md`](../../workbench/discussion/application/transform-rule-system-v0.md)
- [`event-system-extension-scope-plan.md`](event-system-extension-scope-plan.md)
- [`server-extension-manager-mvp-plan.md`](server-extension-manager-mvp-plan.md)

---

## 1. 当前实现事实

当前 `ExtensionManifest` 使用一个稳定 `id`，并在同一对象上声明可选 `server.entry` 与 `client.entry`。实际 Server 基建进一步假定：

- Manifest 必须存在 `server.entry`；
- Source、Catalog、Host Record、启用状态和事件 grant 全部以 `extensionId` 为唯一主键；
- 一个 `extensionId` 当前最多拥有一个活动 Server Instance；
- RPC、Event、Logger 和 Diagnostic 只区分 `extensionId` / `instanceId`；
- Extension-owned Document 使用 `ownerExtensionId`；
- Kernel 管理 RPC 只能整体 enable、disable 或 reload 一个 `extensionId`。

这套模型可以支持一个 Server Extension MVP，但无法正确表达：

- 一个分发包包含多个独立 Server Module；
- 一个分发包同时包含多个 Client / Server Module；
- 只有 Client Module、没有 Server entry 的包；
- 没有任何可执行代码、只携带 Preset / Transform Rule 等资源的包；
- 同包 Module 使用不同权限、独立启停和独立 reload；
- 一个 Client Module 在多个浏览器窗口中同时产生多个实例。

因此不能只把 `server` / `client` 改成数组。身份、状态和权限主键必须一起调整。

---

## 2. 三层身份模型

```text
Extension Package
  安装、版本、来源、签名、更新和资源分发边界

  -> Extension Module
       独立入口、Runtime、启用状态、权限申请和贡献合同

       -> Extension Instance
            某个 Host 中的一次实际加载
            拥有 Scope 和全部临时注册资源
```

### 2.1 Package Identity

```ts
type ExtensionPackageIdentity = {
  packageId: string
  version: string
  displayName: string
  directory: string
}
```

Package 是分发与信任边界：

- Source conflict、安装来源和版本按 `packageId` 管理；
- Package 内所有 Module 来自同一份 artifact 和发布者；
- Package 可以只包含声明式资源，不包含可执行 Module；
- Package 本身不保存一个笼统的 `enabled` 状态。

插件管理器可以提供“启用全部 Module”的批量操作，但这只是 UI convenience，不能制造第二份 package-level enabled 真相。

### 2.2 Module Identity

```ts
type ExtensionModuleIdentity = {
  packageId: string
  moduleId: string
  runtime: 'server' | 'client'
  entry: string
}
```

`moduleId` 只需在 Package 内稳定且唯一。内部使用结构化 `{ packageId, moduleId }` 作为主键；如日志或 Map 需要字符串，可派生：

```text
moduleKey = <packageId>/<moduleId>
```

`moduleKey` 由平台计算，不由作者重复填写，也不应依赖拆字符串恢复业务字段。

Module 是执行与授权边界：

- 每个 Module 独立启用、禁用和 reload；
- capability request / grant 归 Module；
- Manifest runtime contribution 归 Module；
- 一个 sibling Module 激活失败不影响其他 Module；
- Server 与 Client Module 不共享直接对象引用，通过受控 RPC / Event / API 协作。

首版不增加 Module 加载优先级或依赖求解。需要 sibling 能力的 Module 应在使用时通过 capability / RPC 检查可用性；缺失时进入 unresolved / degraded，而不是依赖隐式启动顺序。

### 2.3 Instance Identity

```ts
type ExtensionInstanceIdentity = ExtensionModuleIdentity & {
  instanceId: string
}
```

Instance 是一次 Host 激活：

- Server Module 首版仍限制每个 Module 最多一个活动实例；
- Client Module 可以在不同 Browser / iframe / Worker Host 中同时产生多个实例；
- RPC registration、Event definition/subscription、Timer、UI mount、Logger、Diagnostic 和 dispose callback 归 `instanceId`；
- reload 必须产生新的 `instanceId`，旧 Scope 不能清理新实例资源。

---

## 3. 归属与权限边界

| 对象 | 稳定归属 |
|---|---|
| Artifact、安装来源、版本、签名 | `packageId` |
| 声明式资源 provenance | `packageId` |
| Package 共享持久数据 | `packageId` |
| Module 启用状态与 capability grant | `packageId + moduleId` |
| Runtime contribution contract | `packageId + moduleId` |
| RPC / Event 注册和订阅 | `instanceId`，同时记录 Module identity |
| Logger / Diagnostic | `packageId + moduleId + instanceId` |
| Client 窗口中的实际加载 | `instanceId`，必要时附 `clientId` |

Package 是同一发布者的信任边界，因此首版保留 Package 级持久数据共享语义。现有 `ownerExtensionId` 可在迁移中解释为 `ownerPackageId`；不在本阶段为每个 Module 创建独立 SQL 或 Document Store。

Module 仍是权限边界。即使两个 Module 位于同一 Package，它们也不能自动继承对方的 capability grant。需要订阅 sibling Event 或调用受保护能力时，仍应通过 Module 自己声明并获得的能力执行。

这里的“权限边界”首先是 Host capability、审计和产品授权边界，不是当前同进程 Server Runtime 的强安全沙箱。受信任 Node 代码仍可能通过文件系统、网络、进程 API 或共享全局状态绕过 Host；真正的强隔离需要 Worker 或独立进程，不能靠 Module identity 假装已经实现。

---

## 4. 目标 Manifest 方向

候选 Package Manifest：

```json
{
  "manifestVersion": 2,
  "id": "author.example",
  "version": "1.0.0",
  "displayName": "Example Package",
  "engines": {
    "studio": "^0.1.0"
  },
  "modules": [
    {
      "id": "prompt-service",
      "runtime": "server",
      "entry": "./dist/prompt-service.js",
      "capabilities": {
        "events.subscribe": ["documents"]
      },
      "contributes": {
        "rpc": [{ "name": "author.example.prompt.preview" }],
        "events": [{
          "name": "author.example.prompt.updated",
          "version": 1,
          "visibility": "public"
        }]
      }
    },
    {
      "id": "studio-ui",
      "runtime": "client",
      "entry": "./dist/studio-ui.js",
      "contributes": {
        "panels": [{ "id": "author.example.prompt.panel" }]
      }
    }
  ],
  "contributes": {
    "transformRules": [
      { "source": "./resources/clean-output.rule.json" }
    ]
  }
}
```

边界：

- 顶层 `contributes` 保存 Package 携带的声明式资源索引；
- `modules[*].contributes` 保存由该 Module 实现或挂载的运行时贡献；
- 顶层没有 `capabilities`，权限申请必须属于具体 Module；
- 纯资源包允许 `modules` 缺省或为空；
- Client-only Package 是合法 Package，Server Source Scanner 不得再要求 `server.entry`；
- `roles` 仍是 Package 展示标签，不进入权限、加载或 dispatch。

具体资源 contribution schema、Client Panel schema 和 Marketplace metadata 不在本计划固化。

---

## 5. Manager 与 Host 目标边界

```text
Package Catalog
  发现和校验 Package Manifest
  管 Source conflict、版本和声明式资源索引

Module State Store
  保存每个 Module 的 desired enabled 与 grants

Server Module Manager
  只编排 runtime=server 的 Module
  调用 Server Extension Host activate / dispose / reload

Client Module Bootstrap (later)
  读取同一 Catalog 中 runtime=client 的 Module
  每个 Client Host 创建自己的 Instance
```

Server Manager 不伪造 Client Module 的活动状态。它只可以通过 RPC 暴露 Package / Module 静态目录和 desired state；真实 Client Instance 状态属于对应 Client Host。

Package Source conflict 仍按 `packageId` 判断。同一 Package 内的重复 `moduleId`、非法 entry 或不支持的 runtime 会使该 Package unavailable，不选择隐式赢家。

---

## 6. 管理状态与 RPC 方向

状态文件目标结构：

```json
{
  "version": 2,
  "packages": {
    "author.example": {
      "modules": {
        "prompt-service": {
          "enabled": true,
          "grants": {
            "events.subscribe": ["documents"]
          },
          "updatedAt": "2026-08-14T00:00:00.000Z"
        },
        "studio-ui": {
          "enabled": true,
          "grants": {},
          "updatedAt": "2026-08-14T00:00:00.000Z"
        }
      }
    }
  }
}
```

管理操作按 Module 定位：

```text
extensions.listPackages
extensions.enableModule
extensions.disableModule
extensions.reloadModule
extensions.getDiagnostics
```

RPC 参数使用独立 `packageId`、`moduleId` 字段，不要求调用者拼接或解析 `moduleKey`。

当前项目仍处于早期，实施时优先直接迁移现有内部调用和示例 Manifest，不长期保留两套并行管理 API。是否保留短期 v1 Manifest 读取适配，仅在编码前根据已有测试资产决定；不能让兼容层反向污染目标模型。

---

## 7. 命名空间与跨 Module 通信

RPC 与 Event 的公开名称继续使用 Package namespace：

```text
author.example.*
```

Module owner 记录用于生命周期、权限、Introspection 和冲突诊断，不强迫公开 API 名称再重复一层 Module ID。一个 Package 内两个 Module 注册同名贡献时按正常冲突拒绝，由 Package 作者修正。

跨 Module 协作遵循：

```text
Client Module
  -> authenticated Host API / typed RPC
  -> Server Module contribution

Server Module A
  -> Host RPC / Event
  -> Server Module B
```

平台 contract 不提供直接取得 sibling 活动实例或共享可变宿主单例的入口。Package 可以共享静态代码依赖，但跨 Module 运行时协作应走 Host Registry。当前同进程 Server 代码无法被强制阻止自行共享全局状态，这是受信任代码模型的已知限制，不构成受支持的插件契约。

---

## 8. 分阶段实施

### Phase 1：Manifest 与身份类型

- 增加 Package / Module / Instance identity；
- Manifest Parser 支持 `modules[]` 和纯资源 Package；
- 校验 Module ID 唯一、runtime 合法、entry 位于 Package 目录内；
- 把 capabilities 和 runtime contributes 移到 Module；
- 迁移示例 Extension Manifest。
- 更新或 supersede 仍使用 “Full Extension = Server + Client” 的 ADR-002，避免 Accepted ADR 与新模型并存冲突。

验证检查点：

- 一个 Package 可以声明两个 Server Module；
- Client-only 与 resource-only Package 可以通过发现；
- 重复 Module ID 和越界 entry 被拒绝；
- 当前示例 Manifest 能迁移到目标格式。

### Phase 2：Module State Store 与 Catalog

- State Store 升级为按 Package / Module 保存 desired state；
- Source discovery 按 Package 建 Catalog，不再要求 Server entry；
- List 结果同时展示 Package、Modules、desired state 和可用性；
- 权限 request / grant 按 Module 校验。

验证检查点：同包两个 Module 可以拥有不同 enabled 和 grants，重启后保持。

### Phase 3：Server Host Module 化

- Host Record 从 `extensionId` 主键迁移到结构化 Module identity；
- 每个 Server Module 独立 load、activate、reload、dispose；
- Context、Logger、Diagnostic、RPC/Event owner 增加 Package / Module identity；
- Package 级 Document ownership 保持稳定；
- sibling failure 与 cleanup 相互隔离。

验证检查点：同包两个 Server Module 独立运行，reload 其中一个不会删除另一个的注册物。

### Phase 4：Kernel 管理面与真实闭环

- 管理 RPC 改为 Module 粒度；
- `extensions.changed` payload 增加 `packageId`、`moduleId` 和 action；
- Introspection 显示 contribution 的 Package / Module owner；
- 更新 Server Extension 与 Manager 验证脚本。

验证检查点：

- enable / disable / reload 只影响目标 Module；
- Package source conflict 阻止其全部 Module 激活；
- 一个 Module activation failure 不阻止 sibling 与 Server 启动；
- 现有 Event、Document、RPC、dispose 和重启持久化闭环继续通过。

### Phase 5：Client Host 后续入口

本计划只保证 Catalog 和身份模型能够表达 Client Module。Client Direct Mount、Shadow DOM、iframe、Worker、HMR、Panel Registry 和跨端 Event Transport 进入独立计划，不与 Server Module 迁移一起实现。

---

## 9. 明确非目标与限制

- 不因为一个 Package 有多个 Module 就引入通用 DI Container；
- 不实现 Module 启动顺序、自动依赖启用或复杂 dependency graph；
- 不把声明式 Transform Rule 变成 Module；
- 不为每个 Module 创建独立数据库；
- 不在本阶段解决不可信 Server 代码沙箱；
- 不实现 Package install/uninstall、数据保留询问、签名和升级迁移；
- 不把 Client Instance 状态伪装成 Server 全局唯一状态。

---

## 10. 完成标准

当以下事实同时成立，Package / Module 基座才算完成：

1. Package、Module、Instance 三种身份在类型和运行时中不再混用；
2. 一个 Package 可以有零个或多个 Client / Server Module；
3. Module 能独立启用、授权、激活、禁用和 reload；
4. 一个 Module 的失败或清理不会影响 sibling；
5. 声明式资源不需要启动 Module；
6. Server Manager 不声称掌握 Client Instance 的真实运行状态；
7. RPC、Event、Logger、Diagnostic 和 Introspection 能指出具体 Module owner；
8. 现有 Server Extension 的真实验证闭环迁移后继续通过。

---

## 11. 实施结果（2026-08-14）

Phase 1–4 已完成：Manifest v2、Package/Module/Instance identity、Package Catalog、Module State Store、Server Module Host、Kernel 管理 RPC、示例 Package 和验证闭环均已迁移。

已验证：

- 同包两个 Server Module 独立 enabled、grant、activation、reload、disable 与重启恢复；
- reload/disable 一个 Module 不改变 sibling instance 或 RPC；
- Client-only 与纯资源 Package 可发现，Server Manager 不伪造 Client runtime；
- 重复 Module ID、越界 entry、Package source conflict 与未申请 grant 被拒绝；
- Event、Document、RPC、Diagnostic、Logger、dispose、activation failure 和 Kernel stop 闭环继续成立；
- `system.introspect` 与 RPC owner 使用具体 Package/Module identity。

最终自动化证据：

- Server Extension 真实闭环：53 checks；
- Server Extension Manager 多 Module 闭环：23 checks；
- Extension Host、Kernel、Client Bridge、Platform 定向测试：39 tests；
- 全量 build、ESLint、workspace health 与 `git diff --check` 通过；
- 全量测试中 316 tests 通过，唯一失败是前端测试引用当前工作区不存在的 `model-profile-config.js`，不属于本计划变更。

Client Host 仍按 Phase 5 作为后续独立工作，不属于本计划缺口。
