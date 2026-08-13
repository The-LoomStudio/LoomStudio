# Extension Architecture

Loom Studio 的 Extension Manager 管理本机 Server Extension 的来源、启用选择与事件权限 grant；Extension Host 管理插件身份、运行时能力与实例生命周期。当前实现覆盖 Server Extension；Client Extension Host 与跨端事件传输尚未实现。

本文对应当前实现与可执行验证：

- [`packages/extension-sdk/src/index.ts`](../../../packages/extension-sdk/src/index.ts)
- [`packages/extension-sdk/extension-host/src/index.ts`](../../../packages/extension-sdk/extension-host/src/index.ts)
- [`apps/studio-server/src/extensions/`](../../../apps/studio-server/src/extensions/)
- [`extensions/weather-station/`](../../../extensions/weather-station/)
- [`scripts/verify-server-extension.ts`](../../../scripts/verify-server-extension.ts)
- [`scripts/verify-server-extension-manager.ts`](../../../scripts/verify-server-extension-manager.ts)

## 1. Manager 与 Host 边界

Server Extension Manager 当前负责：

- 扫描仓库 `extensions/*`、本地 dev links 与 installed 目录；
- 校验 Manifest identity、重复 ID 与 Server entry 路径边界；
- 在 `.loomstudio-dev/extensions/state.json` 持久化 `enabled` 和事件 capability grant；
- 启动时只激活已启用插件；
- 串行编排 enable、disable 与 reload；
- 汇总 source、desired state 与 Host runtime summary。

新发现的插件默认禁用。同一个 `extensionId` 指向多个不同目录时不会选择隐式优先级，而是标记 unavailable 并产生 Diagnostic。单个插件激活失败不会阻止 Studio Server 或其他插件启动。

Server Extension 通过 `activate(ctx)` 获得当前实例绑定的 capability facade。Host 不暴露 Kernel、SQL connection 或内部 Registry，也不保存插件业务状态。

当前 Host 能力包括：

- Extension identity 与 `instanceId`；
- Extension Logger；
- 当前事件订阅 capability snapshot；
- RPC register/call；
- Event define/emit/subscribe；
- Document get/list/write/delete；
- Diagnostics report；
- `AbortSignal` 与 dispose callback。

Extension 的持久 Document 归属稳定 `extensionId`；RPC、Event Definition、Event Subscription 和 dispose callback 归属本次 `instanceId`。

## 2. Extension 与 Instance

```text
extensionId
  稳定插件产品身份
  -> Manifest、Document owner、权限申请

instanceId
  每次 activation 新建
  -> RPC、事件注册、订阅、日志、Diagnostics、Scope
```

同一 Extension 当前只允许一个活动 Server Instance。重复 activation 会被拒绝；reload 必须先释放旧实例，再动态 import 并激活新实例。

Extension Summary 同时公开兼容的 Extension state 与具体 Instance state：

```text
created -> activating -> active | degraded | activation_failed
active/degraded -> stopping -> disposed | dispose_failed
```

## 3. Extension Scope

每个实例拥有一个统一 Scope：

```ts
type ExtensionScope = {
  instanceId: string
  signal: AbortSignal
  track(kind: string, disposable: Disposable): void
  run<T>(callback: () => T | Promise<T>): Promise<T>
  dispose(): Promise<void>
}
```

Scope 的实际语义：

1. dispose 开始时先停止接收新调用并 abort signal；
2. 等待 Host 已经进入的 callback 结束；
3. 按注册反序执行所有 disposer；
4. 一个 disposer 失败不阻断后续清理；
5. 所有清理错误汇总为 `AggregateError`，同时产生带 `extensionId` / `instanceId` 的 Diagnostic；
6. dispose 幂等，旧 instance handle 只能删除自己注册的资源。

Activation failure、显式 dispose、reload 与 Kernel stop 使用同一 Scope 清理路径。Kernel stop 会尝试释放所有活动实例；清理失败会返回错误，但 Kernel 自身仍收束为 inactive。

## 4. Manifest 与 Runtime Registration

Manifest 声明插件可能公开的贡献与申请的事件 capability：

```json
{
  "capabilities": {
    "events.subscribe": ["documents"]
  },
  "contributes": {
    "rpc": [{ "name": "example.weather.status" }],
    "events": [{
      "name": "example.weather.updated",
      "version": 1,
      "visibility": "public"
    }]
  }
}
```

Runtime Registration 才是当前实例真正提供的能力。开发/测试模式中，未声明的 RPC 或 Event 会产生 warning 并把实例标记为 `degraded`；生产模式拒绝未声明注册。声明但未注册同样产生 Diagnostic 和 `degraded` 状态。

Manifest 中的 `capabilities.events.subscribe` 表示插件申请的能力；Manager state 中的 grant 表示用户实际授予的能力。Host 激活实例时只注入 grant，不再自动授予 Manifest 中的全部申请。grant 不能包含插件未申请的事件类别。

Extension Event 必须使用 `<extensionId>.*` 命名空间，不能注册平台保留命名空间或 `internal` 事件。Extension 自己的 `protected` 事件自动绑定 `extension:<extensionId>` capability。

## 5. Server Event Host

Event Definition、发布与订阅都通过 Host：

```text
ctx.events.define()
  -> Runtime Event Definition Registry
  -> instance Scope tracking

ctx.events.emit()
  -> 可信 extensionId / instanceId publisher
  -> owner、payload 与大小检查
  -> Event Hub

ctx.events.subscribe()
  -> capability snapshot 检查
  -> instance Scope tracking
  -> callback failure isolation
```

Event 只广播已经发生的事实，不提供返回值，也不改变发布者业务结果。完整数据通过 ID 和 typed RPC 查询，不通过事件 payload 广播正文、Prompt 或 Secret。

## 6. Document、日志与 Diagnostics

Extension Document write 由 Host 自动绑定：

- `ownerExtensionId`；
- Extension actor；
- Document Store Revision / Changeset / Commit 流程。

Extension Logger 自动附加 `extensionId` 与 `instanceId`。Extension Diagnostics 同样保存这两个身份，支持区分 reload 前后的实例与清理错误。

## 7. 当前明确未实现

- Client Extension Host；
- Direct/Shadow DOM/iframe/Worker Runtime adapter；
- WebSocket Event Transport；
- 事件持久重放、retry 或 exactly-once；
- 权限审批 UI 与非事件 capability 的完整 grant enforcement；
- Marketplace、正式 artifact install/uninstall、签名、更新与依赖求解；
- Hook Registry；
- Agent durable Trigger / Job Queue；
- 同进程代码的强制卸载或安全沙箱。

以上能力仍保留在 [`../../workbench/plans/event-system-extension-scope-plan.md`](../../workbench/plans/event-system-extension-scope-plan.md) 的后续 Phase 中，不属于当前实现事实。

Server Extension 目前与宿主运行在同一个 Node.js 进程。现有 capability 只能约束 Host API，不能阻止插件直接调用 Node 文件系统、网络或进程能力，因此 Server Extension 仍属于受信任本地代码。真正的不可信代码隔离需要 Worker 或独立进程。
