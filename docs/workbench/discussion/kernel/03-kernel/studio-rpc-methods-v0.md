# Loom Studio RPC Methods v0

> **Status**: Draft v0.1（第一批实现约束，2026-05-14）
> **Purpose**: 定义 Studio MVP 第一批 Kernel RPC method 的 params/result 形状，作为 Transport、Client Bridge、Kernel registry 与测试的共同依据。
> **Audience**: Kernel、Transport、Client Bridge、Document Store、Extension Host、Loom Runner 实现者。
> **Related**:
> - [`studio-kernel-public-surface-v0.md`](studio-kernel-public-surface-v0.md)
> - [`studio-transport-protocol-v0.md`](studio-transport-protocol-v0.md)
> - [`../04-data/studio-document-store-engineering-v0.md`](../04-data/studio-document-store-engineering-v0.md)

---

## 0. Scope

本文只定义第一批 Kernel RPC：

```text
system.ping
system.getInfo
system.introspect

events.subscribe
events.unsubscribe

docs.get
docs.list
docs.write
docs.delete

extensions.list
extensions.getDiagnostics

diagnostics.list

loom.run
```

本文不定义：

```text
chat.send
provider.invoke
tool.call
agent.step
messages.*
```

---

## 1. Shared Types

```ts
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

type RpcMethodName = string

type IsoDateTimeString = string

type ActorRef = {
  kind: 'kernel' | 'client' | 'extension' | 'workspace-adapter' | 'system'
  id: string
}

type PageInput = {
  limit?: number
  cursor?: string
}

type PageResult<T> = {
  items: T[]
  nextCursor?: string
}
```

---

## 2. `system.ping`

### Params

```ts
type SystemPingParams = {
  echo?: JsonValue
}
```

### Result

```ts
type SystemPingResult = {
  ok: true
  echo?: JsonValue
  serverTime: IsoDateTimeString
}
```

### Notes

用于连接测试与基本 round-trip 验证。

---

## 3. `system.getInfo`

### Params

```ts
type SystemGetInfoParams = Record<string, never>
```

### Result

```ts
type SystemGetInfoResult = {
  studioVersion: string
  kernelVersion: string
  protocolVersion: string
  environment: 'development' | 'production' | 'test'
  capabilities: {
    documents: boolean
    extensions: boolean
    loomRun: boolean
    traceAudit: boolean
  }
}
```

### Notes

不返回 secrets、本地绝对路径或 provider/runtime 业务能力。

---

## 4. `system.introspect`

### Params

```ts
type SystemIntrospectParams = {
  includeDiagnostics?: boolean
}
```

### Result

```ts
type SystemIntrospectResult = {
  kernel: {
    studioVersion: string
    kernelVersion: string
    protocolVersion: string
  }
  namespaces: string[]
  methods: Array<{
    name: RpcMethodName
    owner: 'kernel' | `extension:${string}`
  }>
  events: string[]
  documentTypes: Array<{
    type: DocumentType
    ownerExtensionId?: string
  }>
  extensions: Array<{
    id: string
    version: string
    active: boolean
  }>
  diagnostics?: Diagnostic[]
}
```

### Notes

用于 Client / DevTool / Extension 发现平台能力。MVP 可以先返回 Kernel-owned methods、基础 event names、已加载 Extension 摘要与 Document type 摘要。

不得返回 secrets、本地绝对路径、Provider credential、Chat Runtime 私有状态或 `messages[]` schema。

---

## 5. `events.subscribe`

### Params

```ts
type EventsSubscribeParams = {
  patterns: string[]
}
```

### Result

```ts
type EventsSubscribeResult = {
  subscriptionId: string
  patterns: string[]
}
```

### Rules

Pattern MVP 支持：

```text
exact: docs.changed
namespace wildcard: docs.*
```

不支持 regex 和 payload predicate。

---

## 6. `events.unsubscribe`

### Params

```ts
type EventsUnsubscribeParams = {
  subscriptionId: string
}
```

### Result

```ts
type EventsUnsubscribeResult = {
  subscriptionId: string
  removed: boolean
}
```

---

## 7. Document Shared Types

```ts
type DocumentId = string
type DocumentType = string
type RevisionNumber = number
type ChangesetId = string

type DocumentRecord<T = JsonValue> = {
  id: DocumentId
  type: DocumentType
  version: RevisionNumber
  content: T
  meta: DocumentMeta
}

type DocumentMeta = {
  createdAt: IsoDateTimeString
  updatedAt: IsoDateTimeString
  createdBy: ActorRef
  updatedBy: ActorRef
  ownerExtensionId?: string
  source?: DocumentSourceRef
  tombstone?: TombstoneMeta
}

type DocumentSourceRef = {
  kind: 'workspace-file' | 'import-package' | 'generated' | 'manual' | string
  uri?: string
  adapterId?: string
  externalId?: string
}

type TombstoneMeta = {
  deletedAt: IsoDateTimeString
  deletedBy: ActorRef
  reason?: string
}
```

RPC types should align with Document Store public types.

---

## 8. `docs.get`

### Params

```ts
type DocsGetParams = {
  id: DocumentId
  includeTombstone?: boolean
  version?: RevisionNumber
}
```

### Result

```ts
type DocsGetResult = {
  document: DocumentRecord | null
}
```

### Rules

- 默认不返回 tombstoned current document；
- `version` 表示读取历史 revision；
- 读取历史不改变 current state。

---

## 9. `docs.list`

### Params

```ts
type DocsListParams = PageInput & {
  type?: DocumentType
  includeTombstone?: boolean
  ownerExtensionId?: string
}
```

### Result

```ts
type DocsListResult = PageResult<DocumentRecord>
```

### Rules

- 默认排除 tombstoned documents；
- 必须支持 `type` filter；
- 分页 cursor 是 opaque string。

---

## 10. `docs.write`

### Params

```ts
type DocsWriteParams = {
  id?: DocumentId
  type: DocumentType
  content: JsonValue
  meta?: Partial<DocumentMeta>
  expectedVersion?: RevisionNumber | 'new'
  reason?: string
}
```

### Result

```ts
type DocsWriteResult = {
  changesetId: ChangesetId
  documents: DocumentRecord[]
  operations: ChangesetOperation[]
}

type ChangesetOperation = {
  kind: 'create' | 'update' | 'delete' | 'restore'
  documentId: DocumentId
  type: DocumentType
  fromVersion?: RevisionNumber
  toVersion: RevisionNumber
}
```

### Rules

- Actor / correlation 由 Kernel 从 call context 注入；
- client 不直接提交 `actor`；
- `expectedVersion: 'new'` 表示 create-only；
- `expectedVersion: number` 表示乐观冲突检查；
- 写入 `system.*` type 需要权限。

---

## 11. `docs.delete`

### Params

```ts
type DocsDeleteParams = {
  id: DocumentId
  expectedVersion?: RevisionNumber
  reason?: string
}
```

### Result

```ts
type DocsDeleteResult = DocsWriteResult
```

### Rules

- 删除使用 tombstone；
- 不物理删除历史 revision；
- 删除成功后发布 `docs.changed` event。

---

## 12. Extension Shared Types

```ts
type ExtensionState = 'discovered' | 'manifestLoaded' | 'manifestValidated' | 'loaded' | 'activating' | 'active' | 'degraded' | 'disabled'

type ExtensionSummary = {
  id: string
  version: string
  displayName: string
  state: ExtensionState
  roles?: string[]
  server?: {
    hasEntry: boolean
  }
  client?: {
    hasEntry: boolean
  }
  contributions: {
    rpc?: string[]
    documentTypes?: string[]
    events?: string[]
    commands?: string[]
    panels?: string[]
    conceptStacks?: string[]
    workspaceAdapters?: string[]
  }
}
```

---

## 13. `extensions.list`

### Params

```ts
type ExtensionsListParams = PageInput & {
  state?: ExtensionState
}
```

### Result

```ts
type ExtensionsListResult = PageResult<ExtensionSummary>
```

### Rules

- 不返回 secrets；
- 不返回 raw manifest 全量内容；
- `roles` 仅用于展示，不代表权限。

---

## 14. `extensions.getDiagnostics`

### Params

```ts
type ExtensionsGetDiagnosticsParams = {
  extensionId?: string
}
```

### Result

```ts
type ExtensionsGetDiagnosticsResult = {
  diagnostics: Diagnostic[]
}
```

---

## 15. Diagnostic Shared Types

```ts
type DiagnosticSeverity = 'info' | 'warning' | 'error'

type Diagnostic = {
  id: string
  severity: DiagnosticSeverity
  code: string
  message: string
  source: string
  extensionId?: string
  documentId?: string
  correlationId?: string
  callId?: string
  createdAt: IsoDateTimeString
  details?: JsonValue
}
```

Diagnostics 是当前问题视图，可以清理或替换；Audit / Trace 是事实记录，不应被当作 diagnostics。

---

## 16. `diagnostics.list`

### Params

```ts
type DiagnosticsListParams = PageInput & {
  severity?: DiagnosticSeverity
  source?: string
  extensionId?: string
  documentId?: string
}
```

### Result

```ts
type DiagnosticsListResult = PageResult<Diagnostic>
```

---

## 17. `loom.run`

### Params

```ts
type LoomRunParams = {
  fragments: JsonValue[]
  passes: JsonValue[]
  options?: JsonValue
  trace?: {
    enabled?: boolean
  }
}
```

### Result

```ts
type LoomRunResult = {
  fragments: JsonValue[]
  traceId?: string
  diagnostics?: Diagnostic[]
}
```

### Rules

`loom.run` 是通用 Loom Core adapter，不是 Chat Runtime。

禁止在 Kernel method schema 中出现：

```text
messages
model
temperature
tools
toolChoice
chatId
sessionId
provider
```

如果某个 Runtime 需要这些字段，应由 Extension 自己定义 RPC，例如：

```text
official.chatRuntime.send
example.agentRuntime.step
```

---

## 18. Error Codes

第一批推荐错误码：

```text
rpc.method_not_found
rpc.invalid_params
rpc.handler_failed

document.not_found
document.conflict
document.type_forbidden
document.invalid_content

extension.not_found
extension.activation_failed
extension.registration_conflict

loom.pass_not_found
loom.run_failed

permission.denied
internal.error
```

所有错误通过 Transport `SerializedError` 返回。

---

## 19. Event Names

第一批事件名：

```text
docs.changed
diagnostics.updated
extensions.changed
system.ready
system.stopping
```

事件 payload 另由相关 package 定义。RPC result 不应依赖事件已送达。

---

## 20. Non-Goals

本文不定义：

- complete trace/audit query RPC；
- full extension marketplace RPC；
- Client Panel RPC；
- Provider / Runtime / Tool conventions；
- Chat session history schema；
- Workspace Adapter RPC；
- streaming provider payload。

---

## 21. Document History

- 2026-05-14: Draft v0.1. 定义 Studio MVP 第一批 Kernel RPC params/result 与禁止的业务 schema 字段。
