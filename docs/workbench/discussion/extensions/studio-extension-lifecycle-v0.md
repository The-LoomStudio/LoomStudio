# Loom Studio Extension Lifecycle v0

> **Status**: Draft v0.1（第一批工程约束，2026-05-13）  
> **Purpose**: 定义 Server Extension MVP 生命周期、`activate(ctx)` 入口、Host API 最小形状、runtime registration 规则、状态机与 diagnostics 边界。  
> **Audience**: Extension Host 实现者、Extension SDK 作者、Server Extension 作者、Plugin Manager / DevTool 作者。  
> **Related**: [`../../adr/ADR-002-extension-manifest-and-registration-model.md`](../../adr/ADR-002-extension-manifest-and-registration-model.md), [`studio-extension-host-capabilities-v0.md`](studio-extension-host-capabilities-v0.md), [`../kernel/studio-transport-protocol-v0.md`](../kernel/studio-transport-protocol-v0.md)

---

## 0. 成功标准

MVP 完成后，Extension Host 应满足：

1. 能读取 Manifest 并加载 `server.entry`；
2. 能调用 Extension 导出的 `activate(ctx)`；
3. Extension 只能通过 `ctx` 注册 public capabilities；
4. 注册物必须记录 `ownerExtensionId`；
5. Extension 间调用只能走 `ctx.rpc.call`，不能直接拿到 Kernel 内部对象；
6. activation 失败不会拖垮 Kernel；
7. Manifest declaration 与 runtime registration 不一致会产生 diagnostics；
8. Host 数据结构为未来 deactivate / reload / isolation 留出 owner 与 handle。

---

## 1. Lifecycle Overview

MVP Server Extension 生命周期：

```text
discovered
  -> manifestLoaded
  -> manifestValidated
  -> loaded
  -> activating
  -> active | degraded | disabled
```

状态含义：

| State | Meaning |
|---|---|
| `discovered` | 找到 extension directory 或 package |
| `manifestLoaded` | 读取 manifest 成功 |
| `manifestValidated` | 基本字段、engine、entrypoint 校验通过 |
| `loaded` | server module 加载成功 |
| `activating` | 正在执行 `activate(ctx)` |
| `active` | activation 成功，关键注册一致 |
| `degraded` | activation 部分成功，但存在不一致或非致命错误 |
| `disabled` | 不可用；manifest invalid、entry load failed、activation fatal 等 |

MVP 可以不实现热重载和 deactivate，但 registry 必须能按 owner 清理，为未来 reload 留出空间。

---

## 2. Server Entry Contract

### 2.1 Module Shape

Server entry 必须导出 `activate`：

```ts
export async function activate(ctx: ServerExtensionContext): Promise<void> | void
```

MVP 不要求 class、default export 或 framework wrapper。

未来 SDK 可以提供：

```ts
export default defineServerExtension({
  activate(ctx) {
    // ...
  }
})
```

但 Host 第一版只需要支持命名导出 `activate`。

### 2.2 Activation Rule

Extension 公开能力只能在 `activate(ctx)` 内通过 `ctx` 注册。

不允许：

- 直接 import Kernel singleton；
- 直接访问 Document Store implementation；
- 直接改写全局 registry；
- 绕过 Host 调用其他 Extension handler；
- 在 module top-level 产生 public registration。

允许 module top-level 做轻量常量初始化，但不应产生外部副作用。

---

## 3. ServerExtensionContext MVP Shape

> **Current implementation note (2026-07-23)**: 当前 `ExtensionActivationContext` 已实现 extension、rpc、events、documents、diagnostics 与 lifecycle；Extension 作者可用的 `logger` 尚未进入 SDK Context。下述 Logger 与自动 correlation 仍是候选 contract，后续由 [`studio-extension-host-capabilities-v0.md`](studio-extension-host-capabilities-v0.md) 继续收敛。

```ts
type ServerExtensionContext = {
  extension: ExtensionIdentity
  logger: ExtensionLogger
  rpc: RpcHostApi
  events: EventHostApi
  documents: DocumentHostApi
  diagnostics: DiagnosticsHostApi
  lifecycle: LifecycleHostApi
}

type ExtensionIdentity = {
  id: string
  version: string
  displayName: string
  directory: string
}
```

`ctx` 是 capability facade，不是 Kernel object。

### 3.1 Logger

```ts
type ExtensionLogger = {
  debug(message: string, fields?: Record<string, unknown>): void
  info(message: string, fields?: Record<string, unknown>): void
  warn(message: string, fields?: Record<string, unknown>): void
  error(message: string, fields?: Record<string, unknown>): void
}
```

Logger 自动附加：

- `extensionId`；
- `correlationId`（如果在调用链内）；
- `callId`（如果在调用链内）。

### 3.2 RPC Host API

```ts
type RpcHostApi = {
  register(name: string, handler: RpcHandler, options?: RpcRegisterOptions): RegistrationHandle
  call<T = unknown>(method: string, params?: unknown, options?: RpcCallOptions): Promise<T>
}

type RpcHandler = (params: unknown, context: RpcHandlerContext) => Promise<unknown> | unknown

type RpcHandlerContext = {
  extensionId: string
  caller?: CallerInfo
  clientId?: string
  correlationId: string
  callId: string
  parentCallId?: string
}

type RpcRegisterOptions = {
  description?: string
  inputSchema?: unknown
  outputSchema?: unknown
  visibility?: 'public' | 'internal'
}

type RpcCallOptions = {
  correlationId?: string
  parentCallId?: string
}
```

规则：

- `name` 必须全局唯一；
- Kernel namespace 不允许 Extension 注册；
- `visibility: 'public'` 的 RPC 应在 manifest `contributes.rpc` 中声明；
- `visibility: 'internal'` 可用于同 extension 内部，但 MVP 是否暴露给其他 extension 由 Host 策略决定；
- handler throw 必须转成 `SerializedError` 与 diagnostics。

### 3.3 Event Host API

```ts
type EventHostApi = {
  publish(name: string, payload: unknown, options?: EventPublishOptions): Promise<void>
  subscribe(pattern: string, handler: EventHandler): RegistrationHandle
}

type EventPublishOptions = {
  correlationId?: string
  parentCallId?: string
}

type EventHandler = (event: StudioEvent) => Promise<void> | void
```

MVP 可以只允许 Extension publish 自己声明的 public events。

订阅行为不放入 Manifest。Manifest `contributes.events` 表示该 Extension 可能发布哪些 public events，而不是它想订阅什么。

### 3.4 Document Host API

MVP 只暴露窄接口：

```ts
type DocumentHostApi = {
  get<T = unknown>(id: string): Promise<DocumentRecord<T> | null>
  list(query?: DocumentListQuery): Promise<DocumentRecord[]>
  write<T = unknown>(input: DocumentWriteInput<T>, options?: DocumentWriteOptions): Promise<DocumentWriteResult>
  delete(id: string, options?: DocumentDeleteOptions): Promise<DocumentWriteResult>
}
```

规则：

- Document write 仍由 Document Store 做 owner / type / permission 检查；
- Extension 不直接拿 SQL connection；
- `system.*` document types 默认不可写；
- document changes 必须产生 changeset / revision / event。

### 3.5 Diagnostics Host API

```ts
type DiagnosticsHostApi = {
  report(input: DiagnosticInput): void
  clear(filter?: DiagnosticClearFilter): void
}
```

Extension 可以报告自己领域的 diagnostics，但不能删除其他 Extension 或 Kernel diagnostics。

### 3.6 Lifecycle Host API

```ts
type LifecycleHostApi = {
  onDispose(callback: () => Promise<void> | void): void
}
```

MVP 可以不公开主动 `deactivate`，但允许 Extension 注册 dispose callback。未来热重载或禁用插件时使用。

---

## 4. Registration Handle

所有注册 API 返回 handle：

```ts
type RegistrationHandle = {
  id: string
  ownerExtensionId: string
  kind: 'rpc' | 'eventSubscription' | 'documentType' | 'command' | string
  dispose(): Promise<void> | void
}
```

规则：

- Host registry 必须记录 handle；
- handle dispose 只能清理 owner 自己的注册物；
- activation 失败时，Host 应清理本次 activation 已注册的 handles，或将 extension 标记 degraded 并明确记录残留状态；
- 未来 reload 时通过 ownerExtensionId 批量清理。

---

## 5. Manifest vs Runtime Registration Validation

### 5.1 Declaration Set

从 Manifest 提取：

```text
declaredRpc
declaredDocumentTypes
declaredEvents
declaredCommands
declaredPanels
declaredConceptStacks
declaredWorkspaceAdapters
```

### 5.2 Registration Set

从 activation 期间注册物提取：

```text
registeredRpc
registeredDocumentTypes
registeredEvents
registeredCommands
```

Client panels、static UI contributions 可仅由 Manifest 声明，不要求 server registration。

### 5.3 Validation Rules

Dev Mode：

- registered public capability 不在 declared set 中：warning diagnostic；
- declared capability 未注册：warning diagnostic；
- duplicate name：error diagnostic；
- Kernel namespace registration：error，拒绝注册。

Published / Installed Mode：

- registered public capability 不在 declared set 中：error，拒绝注册或 degraded；
- declared required capability 未注册：error，degraded 或 disabled；
- duplicate name：error，后注册者 disabled / degraded；
- engine mismatch：disabled。

MVP 先实现 Dev Mode diagnostics，但数据模型保留 mode 字段。

---

## 6. Failure Semantics

### 6.1 Manifest Load Failure

结果：`disabled`

Diagnostics：

- `manifest.parse_failed`；
- `manifest.missing_required_field`；
- `manifest.invalid_engine_range`；
- `manifest.entry_not_found`。

### 6.2 Module Load Failure

结果：`disabled`

Diagnostics：

- `extension.entry_load_failed`；
- `extension.activate_export_missing`。

### 6.3 Activation Throw

结果：

- 如果没有成功注册关键能力：`disabled`；
- 如果部分非关键能力失败但 Host 可继续：`degraded`。

Diagnostics：

- `extension.activation_failed`；
- serialized cause；
- dev stack in Dev Mode。

### 6.4 Handler Throw

Extension 保持 `active`，但本次 RPC 返回 error response，并记录 diagnostics / audit。

重复大量 throw 可由未来 health policy 标记 degraded；MVP 不做自动熔断。

---

## 7. Isolation Boundary

MVP 可以与 Kernel 同进程加载 Extension，但 API 边界必须按未来隔离设计：

- Extension 只拿 `ctx`；
- `ctx` 参数与返回值必须 JSON-serializable，或显式标记为 host object；
- 不把 SQL connection / Kernel class / internal registry 暴露给 Extension；
- 所有 public calls 经过 Host dispatch；
- 所有注册物有 owner tracking。

这让未来迁移到 worker / child process / permission sandbox 时不需要重写 Extension contract。

---

## 8. Ordering and Dependencies

MVP 不实现复杂 dependency resolver。

最小规则：

1. 先加载 official / builtin extensions；
2. 再加载 user-installed extensions；
3. 同组内按 manifest id 稳定排序；
4. duplicate public capability 由 registry 拒绝后注册者；
5. dependency / conflict 字段可以 parse and preserve，但不做 SAT resolver。

如果某 Extension 需要调用另一个 Extension 的 RPC，应在 activation 后或首次使用时通过 `ctx.rpc.call` 处理 missing method error，而不是假设加载顺序。

---

## 9. Security Notes

MVP 不是完整 security sandbox。

但第一版必须避免引入错误抽象：

- 不承诺 Extension 在同进程内是安全隔离的；
- 不让 Manifest `roles` 充当权限；
- 不让 Client Extension 直接访问主窗口任意 API；
- 不把 API key 放入 Manifest；
- 不绕过 Document Store 写入 revision / audit。

未来 security model 可以基于本生命周期的 owner tracking、capability facade 与 Host dispatch 扩展。

---

## 10. Non-Goals

本文不定义：

- Client Extension Panel API 完整规格；
- marketplace package format；
- signature verification；
- dependency SAT resolver；
- worker / process isolation 实现；
- capability enforcement 完整模型；
- Provider / Runtime / Tool / MCP convention；
- Chat / Agent runtime lifecycle。

---

## 11. Minimal Example

Manifest：

```json
{
  "manifestVersion": 1,
  "id": "example.echo",
  "version": "0.1.0",
  "displayName": "Echo Extension",
  "engines": {
    "studio": "^0.1.0"
  },
  "server": {
    "entry": "./dist/server.js"
  },
  "contributes": {
    "rpc": [
      {
        "name": "example.echo.echo"
      }
    ]
  }
}
```

Server entry：

```ts
export function activate(ctx) {
  ctx.rpc.register('example.echo.echo', async params => {
    return { echo: params }
  })
}
```

Host registry fact：

```json
{
  "kind": "rpc",
  "name": "example.echo.echo",
  "ownerExtensionId": "example.echo",
  "visibility": "public"
}
```

---

## 12. Document History

- 2026-05-13: Draft v0.1. 定义 Server Extension lifecycle、activate(ctx)、Host API、registration owner tracking、diagnostics 与 failure semantics。
