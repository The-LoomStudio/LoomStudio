# Loom Studio Kernel Public Surface v0

> **Status**: Draft v0.1（第一批实现约束，2026-05-14）
> **Purpose**: 锁定 Studio Kernel 第一版 public surface，防止 Kernel 在实现中滑向 Chat / Provider / Tool / Runtime 业务框架。
> **Audience**: Kernel、Transport、Extension Host、Client Bridge、Loom Runner 实现者。
> **2026-08-12 演进说明**：本文仍适用于当前 Document-only Kernel public surface。未来数据层重构不会把 NarrativeStore / AgentStore 暴露给 Kernel；Kernel 将从直接订阅 `DocumentCommitFact` 改为订阅领域无关的 `DataCommitFact`，具体施工见 [`../../plans/sqlite-data-engine-domain-stores-kernel-plan.md`](../../../archive/plans/sqlite-data-engine-domain-stores-kernel-plan.md)。
> **2026-08-13 事件系统说明**：Kernel EventBus 继续保持进程内事实广播，现已实现 Event Definition Registry、owner/visibility/capability/payload 边界与 subscriber failure reporting，详见 [`../../plans/event-system-extension-scope-plan.md`](../../../archive/plans/event-system-extension-scope-plan.md)。原先只创建空 Handler 的 `events.subscribe` / `events.unsubscribe` RPC 已删除；跨端订阅仍等待独立 Event Transport。
> **Related**:
> - [`docs/architecture/README.md`](../../../architecture/README.md)
> - [`docs/architecture/kernel/`](../../../architecture/kernel/)
> - [`docs/architecture/extensions/`](../../../architecture/extensions/)
> - [`../04-data/studio-document-store-engineering-v0.md`](../data/studio-document-store-engineering-v0.md)

---

## 0. 本文解决什么问题

Studio Kernel 是平台底座，不是业务 Runtime。

本文只锁定第一批代码允许暴露的 Kernel public surface，避免为了 demo 方便出现这些接口：

```text
kernel.chat.send()
kernel.provider.invoke()
kernel.tool.call()
kernel.agent.step()
kernel.currentSession
kernel.messages
```

这些能力如果需要，必须由 Extension 通过自己的 RPC / Runtime pattern 提供。

---

## 1. Kernel 职责

Kernel 负责组合和协调 Studio 平台能力：

```text
Document Store
Event Bus
RPC Registry
Extension Host
Diagnostics Registry
Trace / Audit Store
Loom Runner
Transport method handlers
```

Kernel 不拥有具体业务语义：

```text
Chat Runtime
Agent Runtime
Provider Gateway
Tool Loop
MCP Bridge
Worldbook
Character Card
SillyTavern JSON
messages[]
```

---

## 2. Public Constructor

第一版只需要一个构造入口：

```ts
type CreateKernelOptions = {
  documents: DocumentStore
  diagnostics: DiagnosticsRegistry
  traceAudit: TraceAuditStore
  extensionHost: ExtensionHost
  loomRunner: LoomRunner
  eventBus: EventBus
  clock?: Clock
  idGenerator?: IdGenerator
}

function createKernel(options: CreateKernelOptions): Kernel
```

规则：

- Kernel 依赖接口，不依赖具体 backend；
- app 层负责组装具体实现；
- Kernel 不主动创建 SQLite connection、WebSocket server 或 React client；
- 可选 `clock` / `idGenerator` 用于测试确定性。

---

## 3. Kernel Interface MVP

```ts
type Kernel = {
  start(): Promise<void>
  stop(): Promise<void>

  registerKernelRpc(method: string, handler: KernelRpcHandler): RegistrationHandle
  callRpc<T = unknown>(method: string, params?: unknown, context?: KernelCallContext): Promise<T>

  getDocumentStore(): DocumentStore
  getExtensionHost(): ExtensionHost
  getDiagnostics(): DiagnosticsRegistry
  getEventBus(): EventBus
  getTraceAudit(): TraceAuditStore
  getLoomRunner(): LoomRunner

  getPublicSurface(): KernelPublicSurface
}
```

### 3.1 `start()`

职责：

- 注册 Kernel namespace RPC handlers；
- 初始化 Extension Host；
- 订阅必要 internal events；
- 标记 Kernel active。

不职责：

- 启动 WebSocket server；
- 启动 React client；
- 自动加载业务 Runtime；
- 自动调用 Provider。

### 3.2 `stop()`

职责：

- 停止 Kernel 接收新调用；
- 清理 Kernel-owned registrations；
- 调用 Extension Host dispose/stop；
- flush diagnostics / trace-audit pending writes（如果实现支持）。

MVP 可以简化实现，但接口应保留。

### 3.3 `registerKernelRpc()`

只允许 Kernel 内部注册保留 namespace：

```text
system.*
events.*
docs.*
extensions.*
diagnostics.*
loom.*
trace.*
audit.*
```

第三方 Extension 不能通过该方法注册 Kernel namespace。

### 3.4 `callRpc()`

用于：

- Transport dispatch；
- Extension Host 调用；
- Kernel internal composition；
- tests。

所有调用必须携带或生成：

```text
correlationId
callId
parentCallId?
clientId?
```

---

## 4. Kernel Public Surface Metadata

```ts
type KernelPublicSurface = {
  namespaces: string[]
  methods: Array<{
    name: string
    owner: 'kernel'
    description?: string
  }>
  version: string
}
```

用途：

- DevTool introspection；
- Client Bridge capability discovery；
- tests；
- docs generation。

`system.introspect` 是该 metadata 的 RPC 入口。MVP 返回值可以是最小子集，但 method 必须存在，避免 Client / DevTool / Extension 需要读取源码才能发现平台能力。

不是权限系统，也不替代 Extension registry。

---

## 5. Kernel RPC Namespaces

Kernel 保留：

```text
system.*
events.*
docs.*
extensions.*
diagnostics.*
loom.*
trace.*
audit.*
```

当前 RPC family 与 Transport 边界见 [`docs/architecture/kernel/`](../../../architecture/kernel/)；具体运行时方法以 `system.introspect` 和 [`rpc-methods.md`](../../reference/rpc-methods.md) 为准，不再维护第二份静态 v0 方法表。

Extension RPC 应使用 extension id / reverse-DNS prefix，例如：

```text
example.echo.echo
official.provider.openai.invoke
sillytavern.workspace.import
```

---

## 6. Allowed Kernel RPC Families

### 6.1 `system.*`

系统状态、版本、ping。

允许：

```text
system.ping
system.getInfo
system.introspect
```

### 6.2 `events.*`

事件订阅与取消订阅。

允许：

```text
events.subscribe
events.unsubscribe
```

### 6.3 `docs.*`

通用 Document Store 操作。

允许：

```text
docs.get
docs.list
docs.write
docs.delete
```

### 6.4 `extensions.*`

Extension Host 状态与 diagnostics。

允许：

```text
extensions.list
extensions.getDiagnostics
```

### 6.5 `diagnostics.*`

当前 diagnostics 视图。

允许：

```text
diagnostics.list
```

### 6.6 `loom.*`

通用 Loom Core adapter。

允许：

```text
loom.run
```

`loom.run` 只能表示：

```text
Fragment[] + PassConfig[] -> Fragment[] + Trace
```

它不是 Chat Runtime。

### 6.7 `trace.*` / `audit.*`

MVP 可先只保留 namespace，具体查询方法后续添加。

---

## 7. Explicitly Forbidden Kernel API

Kernel public surface 禁止出现：

```text
chat.send
chat.complete
chat.reroll
provider.invoke
provider.stream
tool.call
tool.loop
agent.step
agent.run
mcp.call
mcp.connect
messages.append
messages.list
session.current
runtime.runChat
runtime.runAgent
worldbook.search
character.load
```

这些可以由 Extension 暴露，例如：

```text
official.chatRuntime.send
example.provider.invoke
sillytavern.worldbook.search
```

但它们不是 Kernel contract。

---

## 8. Dependency Direction

Kernel 可以依赖接口：

```text
DocumentStore
ExtensionHost
DiagnosticsRegistry
TraceAuditStore
EventBus
LoomRunner
Transport types
```

Kernel 不直接依赖：

```text
React
WebSocket implementation
SQLite implementation
Provider SDK
Tool implementation
MCP SDK
Chat schema
SillyTavern schema
```

Kernel 不直接依赖 Loom Core。Core 只通过 `LoomRunner` adapter 进入。

---

## 9. Test Expectations

第一批 Kernel tests 应覆盖：

1. Kernel start 注册保留 RPC namespace；
2. Extension 不能覆盖 Kernel namespace；
3. `callRpc` 会生成/传递 correlation metadata；
4. `getPublicSurface` 不包含业务 runtime methods；
5. `loom.run` 不接受 `messages` / `model` / `tools` 等 chat/provider 字段作为 Kernel schema。

---

## 10. Non-Goals

本文不定义：

- Kernel 内部类结构；
- 完整 capability security model；
- complete RPC method params/result；
- Provider / Runtime / Tool conventions；
- Web UI API；
- Desktop shell integration。

---

## 11. Document History

- 2026-05-14: Draft v0.1. 新增 Kernel public surface 约束，明确允许/禁止的 Kernel API 与 namespace。
- 2026-08-13: 补充 Event Definition Registry 与真实 Event Transport 的演进边界，明确当前 `events.subscribe` RPC 不是有效跨端订阅。
- 2026-08-13: 完成进程内 Event Definition Registry 与发布/订阅边界，删除伪跨端 `events.subscribe` / `events.unsubscribe` RPC。
