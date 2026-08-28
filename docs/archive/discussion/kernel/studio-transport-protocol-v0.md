# Loom Studio Transport Protocol v0

> **Status**: Archived / Superseded  
> **Archived**: 2026-08-28；WebSocket-only 与伪事件订阅方向已退出，当前 Transport 事实见 [`docs/architecture/kernel/`](../../../architecture/kernel/)。  
> **Purpose**: 定义 Studio MVP 的 Host / Client / Extension DevTool 之间最小传输协议，约束 JSON-RPC envelope、错误格式、事件订阅、correlation 规则与 namespace 边界。  
> **Audience**: Studio Kernel / Transport 实现者、Extension Host 实现者、Client Host Bridge 实现者、DevTool 作者。  
> **Non-Goal**: 本文不定义 Chat Runtime、Provider invocation、Tool loop、Agent step、MCP bridge 或官方 `messages[]` schema。

---

## 0. 成功标准

MVP 完成后，Transport 层应满足：

1. Client 可以通过 WebSocket 调用 Kernel 暴露的 JSON-RPC methods；
2. 每个 request / response 都能用 `requestId` 精确匹配；
3. 每个高层用户操作都能携带或生成 `correlationId`；
4. Server 能为每个 connection 注入 `clientId`；
5. Error 使用统一可序列化结构；
6. Client 可以订阅 / 取消订阅 Kernel events；
7. Transport 不引入 Runtime / Provider / Tool / Chat 业务协议；
8. 后续 streaming 能在不推翻 envelope 的前提下添加。

---

## 1. 传输选择

### 1.1 MVP 使用 WebSocket only

MVP 默认传输：

```text
WebSocket + JSON-RPC-like messages
```

暂不实现：

- HTTP long polling；
- SSE；
- gRPC；
- WebRTC；
- stdio transport；
- remote cloud gateway。

原因：

- 本地优先 Studio 需要双向事件推送；
- WebSocket 足够支撑 UI Client、DevTool、Extension sandbox bridge；
- 可以先把协议 envelope 稳住，未来再加 transport adapter。

### 1.2 Transport adapter 不是 Kernel contract

Kernel 只依赖抽象 request / response / event dispatch，不应把 WebSocket implementation 泄漏给 Document Store、Extension Host 或 Loom Runner。

---

## 2. Envelope

### 2.1 Request

```ts
type RpcRequest = {
  jsonrpc: '2.0'
  id: string
  method: string
  params?: unknown
  meta?: RpcRequestMeta
}

type RpcRequestMeta = {
  correlationId?: string
  parentCallId?: string
  source?: 'client' | 'extension' | 'devtool' | string
}
```

规则：

- `id` 是 transport request id，由 client 生成；
- `method` 使用 dot namespace，例如 `docs.get`、`events.subscribe`；
- `params` 必须是 JSON-serializable；
- `meta.correlationId` 可由 client 提供；缺省由 Kernel 生成；
- `meta.parentCallId` 用于嵌套 RPC / extension call 链路；
- server 收到 request 后必须注入 connection-level `clientId`，但不信任 client 自报 `clientId`。

### 2.2 Success Response

```ts
type RpcSuccessResponse = {
  jsonrpc: '2.0'
  id: string
  result: unknown
  meta: RpcResponseMeta
}

type RpcResponseMeta = {
  clientId: string
  correlationId: string
  callId: string
}
```

规则：

- `id` 必须等于 request `id`；
- `clientId` 由 server connection 注入；
- `correlationId` 继承 request 或由 Kernel 生成；
- `callId` 表示本次 RPC 调用事实 id。

### 2.3 Error Response

```ts
type RpcErrorResponse = {
  jsonrpc: '2.0'
  id: string | null
  error: SerializedError
  meta?: RpcResponseMeta
}

type SerializedError = {
  code: string
  message: string
  category?: 'validation' | 'not_found' | 'conflict' | 'permission' | 'activation' | 'runtime' | 'internal'
  details?: unknown
  retryable?: boolean
  cause?: SerializedError
}
```

规则：

- request parse 失败时 `id` 可以为 `null`；
- `message` 面向开发者，可显示在 diagnostics；
- `details` 必须 JSON-serializable；
- 不直接跨进程传递 Error object；
- 不把 stack trace 作为稳定 contract；Dev Mode 可在 `details.devStack` 中附带。

---

## 3. Notifications and Events

### 3.1 Server Event Envelope

Server 推送事件使用：

```ts
type ServerEventMessage = {
  jsonrpc: '2.0'
  method: 'event'
  params: {
    event: StudioEvent
  }
}

type StudioEvent = {
  name: string
  payload: unknown
  meta: EventMeta
}

type EventMeta = {
  eventId: string
  clientId?: string
  correlationId?: string
  callId?: string
  parentCallId?: string
  emittedAt: string
  source: string
}
```

规则：

- event 没有 response；
- `name` 使用 dot namespace，例如 `docs.changed`、`diagnostics.updated`；
- `payload` 必须 JSON-serializable；
- `source` 可以是 `kernel`、`extension:<id>`、`transport` 等；
- event 是事实通知，不等于 Document revision 本身。

### 3.2 Event Subscription

MVP 使用 RPC 方法订阅事件：

```text
events.subscribe
events.unsubscribe
```

Request：

```ts
type EventsSubscribeParams = {
  patterns: string[]
}

type EventsUnsubscribeParams = {
  subscriptionId: string
}
```

Response：

```ts
type EventsSubscribeResult = {
  subscriptionId: string
  patterns: string[]
}

type EventsUnsubscribeResult = {
  subscriptionId: string
  removed: boolean
}
```

Pattern MVP 规则：

- exact name：`docs.changed`；
- namespace wildcard：`docs.*`；
- 不支持任意 regex；
- 不支持 payload predicate；
- 权限过滤发生在 server side。

### 3.3 Client Notification

MVP 不要求 client-to-server notification。所有 client-to-server 操作优先使用 request / response，便于 audit、diagnostics 与 correlation。

---

## 4. Streaming 预留

MVP 不强实现 provider streaming 或 token streaming。

但 envelope 预留 stream message：

```ts
type StreamMessage = {
  jsonrpc: '2.0'
  method: 'stream'
  params: {
    streamId: string
    kind: 'start' | 'chunk' | 'end' | 'error'
    chunk?: unknown
    error?: SerializedError
    meta: StreamMeta
  }
}

type StreamMeta = {
  correlationId: string
  callId: string
  parentCallId?: string
  sequence: number
}
```

规则：

- `streamId` 与原始 RPC result 建立关联；
- `sequence` 从 0 开始递增；
- stream chunk 不定义 provider-neutral 内容；
- `chunk` 是业务 extension 自己的 payload，不是 Kernel Chat schema。

MVP 可以只保留类型与 namespace，不提供稳定 API。

---

## 5. Method Namespaces

Studio Kernel 保留以下 namespace：

```text
system.*
extensions.*
events.*
docs.*
loom.*
diagnostics.*
audit.*
trace.*
```

Extension public RPC 推荐使用 reverse-DNS 或 extension-id prefix：

```text
com.example.myExtension.doThing
official.provider.openai.invoke
sillytavern.workspace.import
```

规则：

- Kernel namespace 不允许第三方 Extension 注册；
- Extension RPC name 必须全局唯一；
- duplicate registration 必须产生 diagnostics，并拒绝后注册者或使 extension degraded；
- `roles` 不参与 RPC dispatch。

### 5.1 MVP Kernel Methods

第一批可实现的 Kernel methods：

```text
system.ping
system.getInfo
system.introspect
extensions.list
extensions.getDiagnostics
events.subscribe
events.unsubscribe
docs.get
docs.list
docs.write
docs.delete
loom.run
diagnostics.list
```

这些方法是工程起点，不代表完整 public surface。

### 5.2 明确不提供的 Methods

Kernel 不提供：

```text
chat.send
provider.invoke
tool.call
agent.step
mcp.call
session.current
messages.append
```

这些只能由 Extension 通过自己的 RPC 暴露，或由未来 conventions 定义推荐命名。

---

## 6. Correlation Rules

Transport 层必须维护以下 id：

| ID | 生成方 | 作用 |
|---|---|---|
| `requestId` / request `id` | client | 匹配一次 transport request/response |
| `clientId` | server | 标识 WebSocket connection / client session |
| `correlationId` | client or Kernel | 标识一次高层用户操作链路 |
| `callId` | Kernel / Host | 标识一次 RPC / internal call fact |
| `parentCallId` | caller | 标识嵌套调用父节点 |

规则：

1. client 可提供 `correlationId`；
2. 未提供时，Kernel 为入口 request 生成；
3. Extension 内部再调用 `ctx.rpc.call` 时必须继承 correlationId，并设置 parentCallId；
4. Document changeset、audit entry、trace entry 应记录 correlationId 与 callId；
5. `requestId` 不应用作业务幂等 id。

---

## 7. Capability and Permission Boundary

Transport 只承载消息，不决定业务权限。

权限检查发生在：

- Kernel method handler；
- Extension Host dispatch；
- Document Store write boundary；
- future capability enforcement layer。

MVP 可以先做最小检查：

- Kernel namespace 只允许 Kernel 注册；
- Extension RPC 只能由 owner extension 注册；
- `system.*` documents 只能由 Kernel 或显式授权的 official extension 写入；
- client 不能伪造 `clientId`。

---

## 8. Diagnostics

Transport 相关错误应转换为 diagnostics：

- invalid JSON；
- invalid request envelope；
- unknown method；
- duplicate request id within connection（可选）；
- method handler throw；
- subscription pattern invalid；
- event delivery failure；
- extension RPC dispatch failure。

Diagnostics 不替代 error response；二者用途不同：

```text
error response: 返回给当前 caller
Diagnostic: 留给 Studio / DevTool / plugin author 检查系统状态
```

---

## 9. Examples

### 9.1 Ping

Request：

```json
{
  "jsonrpc": "2.0",
  "id": "req-001",
  "method": "system.ping",
  "params": {},
  "meta": {
    "correlationId": "corr-hello"
  }
}
```

Response：

```json
{
  "jsonrpc": "2.0",
  "id": "req-001",
  "result": {
    "ok": true
  },
  "meta": {
    "clientId": "client-abc",
    "correlationId": "corr-hello",
    "callId": "call-001"
  }
}
```

### 9.2 Subscribe docs events

Request：

```json
{
  "jsonrpc": "2.0",
  "id": "req-002",
  "method": "events.subscribe",
  "params": {
    "patterns": ["docs.*", "diagnostics.updated"]
  }
}
```

Event：

```json
{
  "jsonrpc": "2.0",
  "method": "event",
  "params": {
    "event": {
      "name": "docs.changed",
      "payload": {
        "documentId": "doc-1",
        "type": "example.note",
        "revision": 3,
        "changesetId": "chg-1"
      },
      "meta": {
        "eventId": "evt-1",
        "correlationId": "corr-edit-note",
        "callId": "call-doc-write",
        "emittedAt": "2026-05-13T09:00:00.000Z",
        "source": "kernel"
      }
    }
  }
}
```

---

## 10. Non-Goals

本文不定义：

- official Chat schema；
- official `messages[]` schema；
- provider-neutral invocation schema；
- Agent runtime protocol；
- Tool loop protocol；
- MCP bridge architecture；
- UI panel contribution API；
- marketplace transport；
- cloud sync protocol；
- multi-user collaboration protocol。

---

## 11. Open Questions

- 是否需要为 local CLI 增加 stdio transport adapter？
- stream message 是保留为 Kernel envelope，还是推迟到首个 streaming extension spike？
- subscription 是否需要 backpressure / replay / durable cursor？
- clientId 生命周期是 per WebSocket connection，还是 per app window session？

---

## 12. Document History

- 2026-05-13: Draft v0.1. 定义 WebSocket + JSON-RPC MVP envelope、event subscription、error shape、id/correlation 规则与 namespace 边界。
