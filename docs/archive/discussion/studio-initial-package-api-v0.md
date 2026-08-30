# Loom Studio Initial Package API v0

> **Status**: Archived / Superseded MVP API Snapshot
> **Archived**: 2026-08-28；当前 public surface 以各 Package 入口、Architecture 和类型检查为准。
> **Purpose**: 锁定 Loom Studio 第一批 packages 的 public entry 与禁止导出内容，减少 shared 滥用、deep import 与循环依赖。
> **Audience**: 所有 Studio package 实现者、Extension SDK 维护者。
> **Related**:
> - [`studio-repository-engineering-v0.md`](studio-repository-engineering-v0.md)
> - [`../03-kernel/studio-kernel-public-surface-v0.md`](kernel/studio-kernel-public-surface-v0.md)
> - [`../03-kernel/studio-rpc-methods-v0.md`](../../archive/discussion/kernel/studio-rpc-methods-v0.md)

---

## 0. Scope

本文只定义第一批 package 的 public exports 草案。

每个 package 必须使用：

```text
src/index.ts
```

作为 public entry。

禁止跨 package deep import：

```ts
import { X } from '@loom-studio/kernel/src/internal/x'
```

允许：

```ts
import { createKernel } from '@loom-studio/kernel'
```

---

## 1. Export Policy

### 1.1 Public exports 应该少

只导出：

- 其他 package 必须依赖的类型；
- app bootstrap 必须调用的工厂函数；
- Extension 作者需要的 SDK API；
- tests 需要通过 public contract 验证的对象。

### 1.2 禁止导出 internal implementation

不从 `src/index.ts` 导出：

- internal registry class；
- private helper；
- concrete mutable map；
- SQL connection；
- WebSocket implementation detail；
- extension module loader internals。

### 1.3 `shared` 不是垃圾桶

`@loom-studio/shared` 只放基础 cross-cutting 类型。领域类型应留在自己的 package。

---

## 2. `@loom-studio/shared`

### Public exports

```ts
export type JsonPrimitive
export type JsonValue
export type JsonObject
export type JsonArray

export type SerializedError
export function serializeError(error: unknown): SerializedError

export type IdGenerator
export function createId(prefix?: string): string

export type Clock
export function nowIso(): string
```

### Do not export

```text
DocumentRecord
Diagnostic
ExtensionManifest
Kernel
RpcRequest
LoomRunInput
```

这些属于具体 package。

---

## 3. `@loom-studio/diagnostics`

### Public exports

```ts
export type Diagnostic
export type DiagnosticSeverity
export type DiagnosticSource
export type DiagnosticInput
export type DiagnosticFilter

export type DiagnosticsRegistry
export function createInMemoryDiagnosticsRegistry(): DiagnosticsRegistry
```

### Notes

`Diagnostic.details` 只能是 JSON-serializable。

Diagnostics 是当前可操作问题视图，不是 append-only audit。

### Do not export

```text
KernelDiagnosticsAdapter
ExtensionHostInternalReporter
UI-specific diagnostic components
```

---

## 4. `@loom-studio/transport`

### Public exports

```ts
export type RpcRequest
export type RpcSuccessResponse
export type RpcErrorResponse
export type RpcResponse
export type RpcRequestMeta
export type RpcResponseMeta
export type SerializedError

export type StudioEvent
export type ServerEventMessage
export type EventMeta

export type RpcHandler
export type RpcHandlerContext
export type RpcRegistry
export function createRpcRegistry(): RpcRegistry

export type WebSocketTransportOptions
export function createWebSocketTransport(options: WebSocketTransportOptions): TransportServer
```

### Notes

`createWebSocketTransport` 可以在 P0 暂时很薄，但 public shape 应保持。

Transport 不导出 Kernel method implementations。

### Do not export

```text
Kernel method handlers
Document Store adapters
Extension Host internals
Client React hooks
```

---

## 5. `@loom-studio/document-store`

### Public exports

```ts
export type DocumentId
export type DocumentType
export type RevisionNumber
export type ChangesetId
export type CheckpointId

export type ActorRef
export type DocumentSourceRef
export type TombstoneMeta
export type DocumentMeta
export type DocumentRecord
export type DocumentRevision
export type Changeset
export type ChangesetOperation
export type Checkpoint

export type DocumentGetOptions
export type DocumentListOptions
export type DocumentWriteInput
export type DocumentWriteOptions
export type DocumentDeleteOptions
export type DocumentWriteResult

export type DocumentStore
export function createInMemoryDocumentStore(options?: InMemoryDocumentStoreOptions): DocumentStore
```

### Notes

`createInMemoryDocumentStore` 是 P0 具体实现，可 public export 用于 app bootstrap 和 tests。

SQLite backend 后续可以作为独立 export：

```ts
export function createSqliteDocumentStore(...): DocumentStore
```

但不在 P0 定义。

### Do not export

```text
Internal revision map
SQL table helpers
Migration internals
Chat message schema
Provider call schema
```

---

## 6. `@loom-studio/extension-host`

### Public exports

```ts
export type ExtensionId
export type ExtensionState
export type ExtensionSummary
export type ExtensionManifest
export type ExtensionContributionDeclaration

export type ServerExtensionContext
export type RegistrationHandle
export type ExtensionHost
export type ExtensionHostOptions

export function createExtensionHost(options: ExtensionHostOptions): ExtensionHost
export function parseExtensionManifest(input: unknown): ExtensionManifest
```

### Notes

`ServerExtensionContext` 可以与 SDK 共享类型，但 SDK 应是 Extension 作者主要入口。

Extension Host public API 面向 Kernel / app bootstrap，不直接面向普通 Extension 作者。

### Do not export

```text
InternalExtensionRegistry
ModuleLoaderInternal
ActivationTransactionInternal
ManifestFilesystemScannerInternal
```

---

## 7. `@loom-studio/extension-sdk`

### Public exports

```ts
export type ExtensionManifest
export type ServerExtensionContext
export type ClientExtensionContext
export type RegistrationHandle

export type ServerExtensionModule
export type ClientExtensionModule

export function defineServerExtension(module: ServerExtensionModule): ServerExtensionModule
export function defineClientExtension(module: ClientExtensionModule): ClientExtensionModule
```

### Notes

Extension 作者应只依赖 SDK：

```ts
import { defineServerExtension } from '@loom-studio/extension-sdk'
```

SDK 不应 re-export Kernel。

### Do not export

```text
createKernel
DocumentStore implementation
ExtensionHost implementation
Transport server
```

---

## 8. `@loom-studio/client-bridge`

### Public exports

```ts
export type ClientBridge
export type ClientBridgeOptions
export type ClientConnectionState
export type ClientEventSubscription

export function createClientBridge(options: ClientBridgeOptions): ClientBridge
```

Suggested shape:

```ts
type ClientBridge = {
  connect(): Promise<void>
  disconnect(): Promise<void>
  call<T = unknown>(method: string, params?: unknown): Promise<T>
  subscribe(patterns: string[], handler: (event: StudioEvent) => void): Promise<ClientEventSubscription>
  getConnectionState(): ClientConnectionState
}
```

### Do not export

```text
React-specific hooks in P0
Kernel instance
WebSocket raw socket as stable API
```

React hooks can be added later in client app or separate client package.

---

## 9. `@loom-studio/trace-audit`

### Public exports

```ts
export type CorrelationIds
export type TraceId
export type AuditId
export type LoomRunTraceRecord
export type AuditEntry
export type AuditTarget

export type TraceAuditStore
export function createInMemoryTraceAuditStore(): TraceAuditStore
```

### Notes

Trace / Audit are append-only facts.

### Do not export

```text
Trace viewer UI
Provider-specific audit schema
OpenTelemetry adapter
```

---

## 10. `@loom-studio/loom-runner`

### Public exports

```ts
export type LoomRunner
export type LoomRunnerOptions
export type LoomRunInput
export type LoomRunResult

export function createLoomRunner(options: LoomRunnerOptions): LoomRunner
```

### Rules

Only `loom-runner` imports Loom Core.

Other Studio packages interact with Loom through `LoomRunner`.

### Do not export

```text
Core internal helpers
Chat runtime wrapper
Provider invocation schema
Tool loop schema
```

---

## 11. `@loom-studio/kernel`

### Public exports

```ts
export type Kernel
export type KernelOptions
export type KernelPublicSurface
export type KernelCallContext
export type KernelRpcHandler

export function createKernel(options: KernelOptions): Kernel
```

### Notes

Kernel composes platform capabilities. It is not a runtime business framework.

### Do not export

```text
chat.send
provider.invoke
tool.call
agent.step
messages[] schema
currentSession
Kernel internal registries
```

---

## 12. Apps Import Expectations

### `apps/studio-server`

Allowed imports:

```ts
import { createKernel } from '@loom-studio/kernel'
import { createInMemoryDocumentStore } from '@loom-studio/document-store'
import { createExtensionHost } from '@loom-studio/extension-host'
import { createWebSocketTransport } from '@loom-studio/transport'
```

### `apps/studio-client`

Allowed imports:

```ts
import { createClientBridge } from '@loom-studio/client-bridge'
```

Forbidden:

```ts
import { createKernel } from '@loom-studio/kernel'
import { createInMemoryDocumentStore } from '@loom-studio/document-store'
```

---

## 13. Extension Import Expectations

Allowed:

```ts
import { defineServerExtension } from '@loom-studio/extension-sdk'
```

Forbidden:

```ts
import { createKernel } from '@loom-studio/kernel'
import { createInMemoryDocumentStore } from '@loom-studio/document-store'
import { createExtensionHost } from '@loom-studio/extension-host'
```

---

## 14. First Tests

Initial package API tests should verify:

1. packages can import each other only through public entry;
2. `extension-sdk` does not import `kernel`;
3. `client-bridge` does not import `kernel`;
4. `shared` imports no Studio package;
5. only `loom-runner` imports Loom Core;
6. forbidden business methods are absent from Kernel exports.

---

## 15. Non-Goals

本文不定义：

- exact implementation class names；
- full package.json exports map；
- generated API docs；
- SDK publishing format；
- CJS/ESM dual package strategy；
- full type-level compatibility policy。

---

## 16. Document History

- 2026-05-14: Draft v0.1. 新增第一批 package public exports 与禁止导出规则。
