# Event System / Extension Scope 基建实施计划

> **状态**：Phase 1–4 Complete
> **日期**：2026-08-13
> **范围**：在现有 Kernel EventBus 与 Server Extension Host 上，建立可验证的事件定义、实例级生命周期资源收集、Extension 事件权限边界，以及可重复卸载/重载的最小基座。
> **事实边界**：Phase 1–4 已于 2026-08-13 实施：Kernel 现有 Event Hub 已增加 Definition Registry、owner/visibility/capability/payload 边界与 subscriber failure reporting；Server Extension Host 已使用 `instanceId`、统一 Scope、事件 Host API 和 reload。Server Event Transport、Client Extension Host、权限持久化与 Agent durable trigger 仍未实现。
> **首轮施工边界**：Phase 1–4 已完成。后续仍按本文边界将 Phase 5–8 分开决策，不把内存 Event Hub 扩张为跨端或持久任务系统。

相关文档：

- [`../discussion/extensions/studio-extension-lifecycle-v0.md`](../discussion/extensions/studio-extension-lifecycle-v0.md)
- [`../discussion/extensions/studio-extension-host-capabilities-v0.md`](../discussion/extensions/studio-extension-host-capabilities-v0.md)
- [`../discussion/extensions/studio-extension-manifest-architecture.md`](../discussion/extensions/studio-extension-manifest-architecture.md)
- [`../discussion/kernel/studio-kernel-public-surface-v0.md`](../discussion/kernel/studio-kernel-public-surface-v0.md)
- [`../adr/ADR-002-extension-manifest-and-registration-model.md`](../adr/ADR-002-extension-manifest-and-registration-model.md)

---

## 0. 本轮收束决定

Loom Studio 不引入 Cordis，也不建设通用 DI 容器或第二套 Kernel。现有 Extension Host 继续作为插件能力与身份边界，只借鉴成熟插件框架的一个核心经验：**每次插件激活都必须拥有独立、可整体释放的资源作用域**。

目标结构：

```text
Extension Host
  平台级管理器：发现、加载、激活、卸载、重载

  -> Extension Instance
       extensionId：稳定产品身份
       instanceId：本次加载实例身份

       -> Extension Scope
            AbortSignal
            RPC registrations
            Event definitions/subscriptions
            Timers / UI mounts / future resources
            Dispose callbacks

       -> Scoped Capability Host
            BaseExtensionHost
              -> ServerExtensionHost
              -> ClientExtensionHost (later)
```

核心规则：

1. `extensionId` 管安装、配置、权限与持久业务数据；`instanceId` 管本次运行实例拥有的临时资源；
2. 所有运行时注册必须进入同一个 `ExtensionScope`，不能再由各 capability 自建清理数组；
3. Event 只表示“事实已经发生”，无返回值且不能改变发布者结果；
4. 会影响流程的 contribution point 未来使用独立 Hook Registry，不塞进 Event Hub；
5. Event Definition 是运行时合同，Manifest 是安装前声明，Documentation 是人类语义说明；
6. Kernel Event Hub 首版仍是进程内、非持久、best-effort 广播；
7. 敏感正文、Prompt、Secret、Provider Payload 不进入普通广播事件；
8. 插件只能通过 Host 获得 scoped event capability，不直接拿 Kernel EventBus；
9. 第一轮不引入优先级、重试、重放、waterfall、复杂依赖解析或跨进程隔离；
10. 当前伪 `events.subscribe` RPC 不继续扩展，待真实 Transport 阶段删除或重新定义。

---

## 1. 当前实现事实与缺口

### 1.1 Kernel EventBus

当前 `packages/kernel/src/index.ts` 已实现：

- 同步进程内 `emit`；
- exact name 与 `namespace.*` pattern；
- `eventId`、`emittedAt`、`source`、Client/Correlation metadata；
- subscription handle 与显式 unsubscribe；
- `data.changed`、`docs.changed` 等平台事件。

当前缺口：

- 事件名在首次 emit 时自动加入 `knownEvents`，没有定义注册与发布权检查；
- payload 没有发布边界校验、大小限制或版本合同；
- subscriber 同步异常被静默吞掉；
- subscriber 返回 rejected Promise 时没有可靠隔离与 diagnostics；
- 没有 visibility、capability grant 或 owner；
- `events.subscribe` RPC 只注册一个空 Handler，既不推送事件，也没有连接生命周期，是伪订阅。

### 1.2 Server Extension Host

当前 `packages/extension-sdk/extension-host/src/index.ts` 已实现：

- Manifest 发现和 Server entry 动态加载；
- `activate(ctx)`；
- RPC register/call；
- Document facade；
- Event emit；
- Diagnostics report；
- `lifecycle.onDispose`；
- activation failure cleanup；
- 按 `ownerExtensionId` 的 RPC registration tracking；
- Manifest RPC declaration mismatch diagnostics。

当前缺口：

- 一个 `ExtensionRecord` 同时表示安装身份和活动实例，没有 `instanceId`；
- registration 与 callback 使用两套数组，不是统一 Scope；
- dispose 顺序不是反向资源释放，也没有错误汇总；
- 一个 disposer 失败会阻断后续 callback；
- `ctx.events` 只有 emit，没有 subscribe/register definition；
- Manifest event contribution 只进入展示摘要，没有 runtime enforcement；
- 旧实例无法与 reload 后的新实例区分，存在旧清理误伤新资源的风险；
- Host 还没有稳定的 Base/Server/Client capability 类型边界。

### 1.3 Transport 与 Client

当前 Client Bridge 是 HTTP RPC，没有通用实时事件传输。Client Extension Host 尚未实现，因此本轮不能假装 Server EventBus 已经是跨端广播系统。

未来边界应为：

```text
Kernel Event Hub
  -> Server Event Transport Adapter
  -> WebSocket
  -> Client Event Bridge
  -> Client Local Event Hub
  -> Official Client / Client Extensions
```

断线期间首版允许事件丢失。重连后通过 typed RPC 重读当前状态，而不是给 Event Hub 增加持久重放。

---

## 2. Extension Identity 与 Instance

### 2.1 两种身份

```ts
type ExtensionIdentity = {
  extensionId: string
  version: string
  displayName: string
  directory: string
}

type ExtensionInstanceIdentity = ExtensionIdentity & {
  instanceId: string
}
```

归属规则：

| 数据或资源 | 归属身份 |
|---|---|
| 安装记录、启用配置、权限 grant | `extensionId` |
| Extension-owned Document | `extensionId` |
| RPC registration | `instanceId` |
| Event definition / subscription | `instanceId` |
| Timer、UI mount、运行时 callback | `instanceId` |
| 日志、Diagnostics | 同时记录 `extensionId` 与 `instanceId` |

同一种 Runtime 首版可以限制一个 `extensionId` 只有一个活动实例，但内部仍必须生成新的 `instanceId`。该限制是产品策略，不是数据模型缺少 instance identity 的理由。

### 2.2 状态边界

候选活动实例状态：

```text
created
  -> activating
  -> active | degraded | activation_failed
  -> stopping
  -> disposed | dispose_failed
```

发现、Manifest 验证和安装状态属于 Extension 管理记录；`activating` 之后的状态属于具体 Instance。不要继续用一个 `disabled` 同时表达“插件未启用”“激活失败”和“实例已释放”。

---

## 3. Extension Scope

### 3.1 最小合同

```ts
type Disposable = {
  dispose(): void | Promise<void>
}

type ExtensionScope = {
  instanceId: string
  signal: AbortSignal
  track(disposable: Disposable): void
  dispose(): Promise<void>
}
```

`lifecycle.onDispose(callback)` 保留为作者体验，但内部必须转换成一个 `Disposable` 并交给 Scope，不再进入独立 callback 数组。

所有 Host registration API 都遵循同一规则：

```text
创建资源
  -> 得到 Disposable handle
  -> Scope.track(handle)
  -> 同时把 handle 返回给 Extension（如 API 需要）
```

### 3.2 Dispose 语义

统一顺序：

```text
instance state -> stopping
AbortController.abort()
禁止该 Scope 新注册资源
停止向该实例投递新事件
等待当前 Host callback 边界结束
按注册反序执行所有 disposer
分别捕获并汇总错误
instance state -> disposed | dispose_failed
```

约束：

- `dispose()` 必须幂等；
- 一个 disposer 失败不能阻断其他资源清理；
- dispose 开始后调用 `track()` 必须拒绝，并立即安全释放传入资源；
- Scope 只管理运行时资源，不删除 Extension 的持久 Document 或配置；
- 同进程 Extension 只能协作式取消；只有 iframe、Worker 或子进程 Runtime 才能强制终止；
- diagnostics 需要保留失败资源种类、`extensionId`、`instanceId` 与序列化错误，但不因此恢复实例。

### 3.3 当前回调边界

首轮不建设通用任务调度器。Host 自己进入 Extension handler 的调用需要记录为 in-flight callback；dispose 停止新增投递，并在合理边界等待已经进入的 callback。插件自行启动、未交给 Scope 的任意 Promise 无法被 Host 可靠追踪，这属于同进程协作式生命周期的明确限制。

---

## 4. Event Definition Registry

### 4.1 Runtime Definition

```ts
type EventVisibility =
  | 'public'
  | 'protected'
  | 'internal'

type EventOwner =
  | { kind: 'kernel' }
  | { kind: 'application' }
  | { kind: 'extension'; extensionId: string }

type EventCapabilityCategory =
  | 'documents'
  | 'narrative'
  | 'agent'
  | 'diagnostics'
  | 'platform-data'
  | `extension:${string}`

type EventDefinition<TPayload extends JsonValue = JsonValue> = {
  name: string
  owner: EventOwner
  version: number
  visibility: EventVisibility
  capability?: EventCapabilityCategory
  summary: string
  stability: 'experimental' | 'stable' | 'deprecated'
  maxPayloadBytes?: number
  parse?: (payload: unknown) => TPayload
}

type RegisteredEventDefinition = {
  definition: EventDefinition
  registeredBy:
    | { kind: 'platform' }
    | {
        kind: 'extension'
        extensionId: string
        instanceId: string
      }
}
```

字段必须产生真实运行作用：

| 字段 | 运行作用 |
|---|---|
| `name` | 发布/订阅匹配、命名冲突检查 |
| `owner` | 判定谁可以发布 |
| `version` | 标识 payload 破坏性合同版本，并写入事件 envelope |
| `visibility` | 控制发现、订阅和未来 Transport |
| `capability` | `protected` 事件的 grant 判定 |
| `summary` / `stability` | Introspection、DevTools 与文档展示 |
| `maxPayloadBytes` | 阻止把正文或大型对象塞进广播总线 |
| `parse` | 在发布边界校验并规范化 payload |
| `registeredBy` | Scope 清理与 reload 实例隔离 |

`parse` 是进程内 runtime validator，不写入 Manifest，也不尝试序列化。Manifest 只保存可静态声明的 Event metadata 子集。

### 4.2 Registry 规则

- 平台在 Kernel start 期间注册内置 Definition；
- Extension 只能注册 `<extensionId>.*` 命名空间；
- Extension 不能注册 Kernel/Application 保留命名空间；
- 第三方 Extension 不能定义 `internal` 事件；
- 同一 `name` 同时只能有一个活动 Definition；破坏性升级替换合同并递增 `version`，不并行注册两个版本；
- publish 未注册事件默认拒绝；开发模式可为 Manifest 声明不一致产生 warning，但不绕过 name/owner/payload 安全检查；
- Extension Definition registration 必须绑定 `instanceId` 并进入 Scope；
- Instance dispose 只删除自己注册的 Definition，不能按 `extensionId` 模糊清理新实例；
- `eventNames()` 应改为 Registry introspection，不再因 emit 自动增长。

### 4.3 Publish 与 Subscribe

首轮保持进程内 best-effort fan-out：

```text
publish
  -> 查 Definition
  -> 校验发布 owner
  -> parse payload
  -> 检查序列化后字节上限
  -> 生成携带 Definition version 的 StudioEvent envelope
  -> 对每个符合 pattern 且有权限的 subscriber 投递
  -> 隔离并报告 subscriber failure
```

Event handler 不返回业务结果。首轮可以保持同步进入 handler，以减少现有 EventBus 迁移范围；若 handler 返回 Promise，必须附加 rejection reporting，不能留下 unhandled rejection。慢同步 handler 仍会阻塞发布线程，这是进程内 MVP 的已知限制，未来隔离 Runtime 或专用队列再解决。

一个 subscriber 失败不能：

- 阻断其他 subscriber；
- 改变发布者业务结果；
- 触发 Event Hub 自动 retry；
- 被静默吞掉。

失败进入 Diagnostics/结构化日志。不要通过再次发布普通 failure event 构造无限递归错误链。

---

## 5. Visibility 与 Capability Category

### 5.1 Visibility

| Visibility | 第三方发现 | 第三方订阅 | 跨 Client Transport | Payload 边界 |
|---|---|---|---|---|
| `public` | 允许 | 允许 | 允许 | 非敏感最小事实 |
| `protected` | 可按策略展示 | 需要 capability grant | 按连接身份过滤 | 受控 ID / 摘要 |
| `internal` | 不允许 | 不允许 | 默认不允许 | 平台进程内部事实 |

`visibility` 不是纯文档标签。Runtime Registry、Host subscribe 和未来 Transport Adapter 都必须读取并执行它。

### 5.2 首版 Capability Category

```text
documents
narrative
agent
diagnostics
platform-data
```

第三方 protected 事件自动使用：

```text
extension:<extensionId>
```

类别边界：

- `documents`：`docs.changed` 等 Document 事实，只带 ID/type/version/changeset/tombstone；
- `narrative`：Timeline/Node/Branch 事实，只带稳定 ID 和最小变更摘要，不带正文；
- `agent`：Agent Session/Turn 事实，不带 Prompt、完整 Message 或模型思维内容；
- `diagnostics`：通知消费者刷新，详情通过查询 API 获取；
- `platform-data`：高级底层 `data.changed`，普通插件不应依赖它反推业务语义。

Event payload 只用于说明“什么事实发生了”。需要完整数据时，消费者拿 ID 走受权 typed RPC/API 查询。

---

## 6. Manifest、Grant、Registry 与 Host

三者不是同一份数据：

```text
Documentation
  人类理解事件语义、时机和 payload

Manifest
  安装前声明公共贡献和申请 capability category

Runtime Registry
  当前实例真正注册并可发布/订阅的事件事实
```

Manifest 候选形状：

```json
{
  "capabilities": {
    "events.subscribe": [
      "narrative",
      "agent",
      "extension:example.weather"
    ]
  },
  "contributes": {
    "events": [
      {
        "name": "example.weather.updated",
        "version": 1,
        "visibility": "public"
      }
    ]
  }
}
```

判定链：

```text
Manifest request
  -> 用户或平台 grant
  -> Host capability snapshot
  -> Runtime Registry publish/subscribe 判定
```

Manifest 不记录：

- 具体订阅事件名；
- Handler；
- `subscriptionId`；
- `instanceId`；
- payload；
- 平台 internal 事件。

开发模式允许未声明公共事件先注册，但必须产生 Diagnostic warning，提示作者同步 Manifest。正式安装模式中，未声明公共事件应拒绝注册或发布；Manifest 已声明但 activation 未注册时，实例标记为 `degraded`。

权限 grant 的持久化格式属于 Phase 7。本轮先让 Host 接收只读 capability snapshot，并据此完成运行时判定，避免把未来权限 Store 硬编码进 Event Hub。

---

## 7. Event、Hook、Stream 与 Trigger 分离

```text
Event Hub
  已发生事实
  无返回值
  best-effort fan-out

Hook Registry (later)
  明确的 contribution point
  serial / bail / waterfall 等受控语义
  可以影响调用流程

Stream Transport
  Token、进度、连续数据帧
  有连接、取消与背压语义

Durable Trigger / Job Queue (later)
  可恢复、去重、重试、确认消费
  适合 Agent 与后台任务
```

因此：

- Event Bus 不承担 Command；
- Event Bus 不承担 PromptBuild interception；
- Event Bus 不承担 Provider token stream；
- Event Bus 不承担需要重启恢复的 Agent 工作；
- Agent 可以接收事实通知，但需要可靠执行的工作必须进入未来 durable Trigger/Job Queue。

---

## 8. Server / Client Host 与热重载

### 8.1 Host 类型

`ctx` 可以继续作为 `activate(ctx)` 的变量名，但正式架构身份是 scoped Host capability：

```ts
type BaseExtensionHost = {
  extension: ExtensionInstanceIdentity
  lifecycle: ExtensionLifecycle
  permissions: ExtensionPermissions
  logger: ExtensionLogger
}

type ServerExtensionHost = BaseExtensionHost & {
  rpc: ServerExtensionRpc
  events: ServerExtensionEvents
  documents: ExtensionDocuments
  diagnostics: ExtensionDiagnostics
}

type ClientExtensionHost = BaseExtensionHost & {
  api: StudioApiClient
  events: ClientEventHost
  ui: ClientUiHost
  storage: ClientExtensionStorage
}
```

Host 不暴露 Kernel，也不保存 Extension 业务状态。Server Extension 的持久业务数据继续走 Document Store 或未来 Extension Storage；Client Extension 的业务数据继续走 typed API。

### 8.2 统一 Reload 语义

```text
dispose old Scope
load new module
create new instanceId + Scope + Host
activate new instance
```

Server：

- 动态 import 使用新的 cache key；
- 旧 Scope 完整清理后再创建新实例；
- Node ESM 代码本身不能真正卸载；
- 需要强隔离时未来使用 Worker 或子进程。

Client：

- Direct Mount / Shadow DOM 可实现接近 HMR 的目标实例替换；
- iframe reload；
- Worker terminate/recreate；
- 第一阶段只保证“不刷新整个 Studio，只替换目标插件”；插件内部临时 React state 可以丢失；
- Vite Fast Refresh 只能作为开发优化，不能成为 Extension contract。

首轮只实现 Server reload 所需的底座，不实现 Client Runtime。

---

## 9. 分阶段实施计划

### Phase 1：Extension Instance + Scope

目标：先修正生命周期归属，不触碰跨端与持久权限。

任务：

1. 拆分稳定 `extensionId` 与每次 activation 新建的 `instanceId`；
2. 引入最小 `ExtensionScope` 与幂等反向 dispose；
3. 将 RPC registration 和 `onDispose` 统一进入 Scope；
4. 为 activation failure、显式 dispose、Kernel stop 使用同一清理路径；
5. Diagnostics/日志同时携带 extension 与 instance identity；
6. 保持现有 Extension 作者 API 尽量兼容，先不扩展 Client contract。

验证检查点：

- 两次 activation 的 `instanceId` 不同；
- dispose 只清理目标 instance 的资源；
- disposer 反向执行；
- 单个 disposer throw/reject 不阻断后续清理；
- dispose 幂等；
- activation 中途失败不残留 RPC registration。

### Phase 2：Event Definition Registry + Event Hub

目标：把“任意字符串 emit”收束为有 owner、visibility、validation 的运行时合同。

任务：

1. 新增 Definition Registry；
2. 注册现有平台事件的最小 Definition；
3. 为 `StudioEvent` envelope 增加 Definition version；
4. emit 前执行 owner、payload 与大小检查；
5. `eventNames()` 改为 registry introspection；
6. subscriber 同步异常和 async rejection 进入 Diagnostics/日志；
7. 保留 exact / `namespace.*` 匹配，不扩展 glob DSL；
8. 标记当前 `events.subscribe` RPC 为待删除/重定义，首轮不伪造跨端 delivery。

验证检查点：

- 未注册事件不能发布；
- owner 不匹配不能发布；
- invalid/oversized payload 被拒绝；
- 一个 subscriber 失败不影响其他 subscriber 或发布者结果；
- internal/protected/public 的订阅判定产生真实差异。

### Phase 3：Server Extension Event Host

目标：让 Server Extension 在 Host 边界内声明、发布和订阅事件。

任务：

1. 为 `ctx.events` 增加受控 definition registration 与 subscribe；
2. publish 自动绑定可信 `extensionId` / `instanceId`，不接受插件伪造 owner；
3. 第三方事件强制 `<extensionId>.*`；
4. subscription 和 definition handle 自动进入 Scope；
5. 接入 Manifest declaration mismatch diagnostics；
6. 使用 capability snapshot 判定 protected subscribe；
7. 不借此扩大 Document/RPC 权限模型。

验证检查点：

- Extension 不能发布其他 owner 的事件；
- Extension 不能注册保留 namespace 或 internal 事件；
- 未授权 protected subscription 被拒绝；
- instance dispose 后不再收到事件；
- 旧 instance cleanup 不删除新 instance 的 definition/subscription。

### Phase 4：Dispose / Reload 闭环

目标：证明 Instance + Scope 不是静态类型装饰，而是能够支持真实重载。

任务：

1. 增加或收束 Server Extension reload 入口；
2. 严格执行 dispose old -> import new -> activate；
3. reload 失败产生 diagnostics，并保持明确实例状态；
4. 验证重复 reload 不累计 RPC、event subscriber 或 dispose callback；
5. Kernel stop 释放所有活动 Scope。

验证检查点：

- 连续 reload 后每种 registration 只有一份；
- old handler 不再执行；
- activation failure 不留下半激活实例；
- Kernel stop 后 registry 无 instance-owned 残留。

### Phase 5：Server Event Transport（后置）

建立 WebSocket Event Transport Adapter、连接身份过滤、订阅生命周期与重连后的 RPC refresh。此阶段删除或重新定义当前伪 `events.subscribe` RPC。

### Phase 6：Client Extension Host（后置）

建立 Client Local Event Hub、Client Extension Scope，以及 Direct/Shadow/iframe/Worker 的最小 Runtime adapter。Fast Refresh 不进入公共合同。

### Phase 7：持久安装状态与权限（后置）

定义 Manifest request、用户 grant、Host snapshot 的持久化与变更流程。不要在 Phase 1–4 提前建设通用 RBAC。

### Phase 8：Agent Durable Trigger（后置）

只有在 Agent 工作需要重启恢复、去重、重试和确认消费时，独立设计持久 Trigger/Job Queue。不得复用内存 Event Hub 冒充可靠任务系统。

---

## 10. 首轮最小测试策略

首轮涉及公共基础设施，测试聚焦真实风险，不追求形式化覆盖率：

1. Scope 单元测试：反向清理、幂等、错误隔离、dispose 后拒绝 track；
2. Event Registry 单元测试：冲突、owner、visibility、capability、parse、payload limit；
3. Event Hub 单元测试：pattern、订阅清理、同步 throw、async rejection 隔离；
4. Extension Host 集成测试：activation failure、dispose、reload、旧新 instance 隔离；
5. Kernel 集成测试：内置 Definition 注册、现有 `data.changed` / `docs.changed` 仍能发布；
6. 相关 package typecheck，确认 SDK/Host/Kernel public type 改动闭合。

不需要在首轮启动浏览器，也不需要为尚未实现的 Client Transport 编写伪端到端测试。

---

## 11. 非目标

- 不引入 Cordis、Tapable、Avvio 或新的插件框架依赖；
- 不建设通用 DI Container；
- 不把 Host 变成可随意挂载业务状态的 Context；
- 不暴露 Kernel、SQL connection 或内部 registry；
- 不建设 Hook waterfall/bail/priority；
- 不建设 Event persistence、replay、retry 或 exactly-once；
- 不把 Token stream、日志流或 Agent Job 塞进 Event Hub；
- 不在第一轮建设 WebSocket Event Transport；
- 不在第一轮建设 Client Extension Host/HMR；
- 不在第一轮设计完整 RBAC 或权限 UI；
- 不借事件系统顺手重构 Document Store、Narrative Store、Agent Store 或 Client；
- 不把 Discussion/Plan 中的目标状态提前写成已实现 Architecture。

---

## 12. 完成标准

首轮基建完成需要同时满足：

1. 每次 Server Extension activation 都有独立 `instanceId` 和 Scope；
2. 所有现有运行时注册统一由 Scope 清理；
3. activation failure、dispose、reload、Kernel stop 使用同一清理语义；
4. Event 必须先有 Definition 才能发布；
5. owner、visibility、capability、payload validation 在运行时生效；
6. Server Extension 可以通过 Host 安全注册、发布和订阅事件；
7. subscriber failure 可观察且不会改变发布者业务结果；
8. 连续 reload 不产生重复 Handler 或旧实例残留；
9. 当前平台数据事件继续工作，且不携带敏感正文；
10. Transport、Client Host、权限持久化和 Agent Trigger 没有被偷偷混入首轮范围。

满足以上条件后，再决定是否进入 Phase 5，而不是因为 EventBus 能运行就直接扩展跨端协议。

---

## 13. Document History

- 2026-08-13：建立 Event System / Extension Scope 基建计划；锁定 instance-scoped 生命周期、Event Definition、visibility/capability、Manifest/Registry/Host 边界与 Phase 1–4 首轮施工范围。
- 2026-08-13：完成 Phase 1–4。新增 Weather Station 真实 Server Extension 与 `pnpm run verify:server-extension` 可执行验证，覆盖 Manifest、RPC、Document、日志、Diagnostics、Event Definition/publish/subscribe、权限、payload validation/limit、activation failure、dispose、reload 与 Kernel stop。
