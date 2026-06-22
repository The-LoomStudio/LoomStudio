# MVP Conflict Register

> **Date**: 2026-05-15
> **Scope**: Loom Studio MVP Stage 0-5

---

## Summary

No conflict currently blocks the MVP acceptance path.

The conflicts below record places where the whitepaper or early engineering drafts were intentionally narrowed for MVP implementation.

---

## CONFLICT-001: Transport MVP used HTTP JSON-RPC before WebSocket delivery

- **发现阶段**: Stage 1 / Stage 4
- **发现位置**: `apps/studio-server/src/main.ts`, `packages/client-bridge/src/index.ts`, `apps/studio-client/vite.config.ts`
- **原文依据**: `docs/03-kernel/studio-transport-protocol-v0.md` describes WebSocket-only MVP transport.
- **实际问题**: Stage-gated headless verification needed a minimal deterministic request/response path before implementing event delivery. HTTP JSON-RPC was already sufficient for Kernel, Extension, Loom Runner, and Client Bridge validation.
- **冲突类型**: 实现成本过高
- **影响范围**: Client / Transport / Server
- **处理建议**: 延后 WebSocket event delivery; keep RPC envelope stable so HTTP and WebSocket can share method semantics.
- **决策结果**: Deferred
- **回写位置**: `docs/03-kernel/studio-transport-protocol-v0.md` should clarify that HTTP JSON-RPC is allowed as a P0 dev/headless transport while WebSocket remains the event-delivery target.

---

## CONFLICT-002: Stage 4 Client displays raw trace JSON instead of a trace summary view model

- **发现阶段**: Stage 4
- **发现位置**: `apps/studio-client/src/main.tsx`
- **原文依据**: `docs/06-engineering/studio-mvp-development-plan.md` Stage 4 says the client should display trace summary.
- **实际问题**: The current Loom Runner returns `traceId`, and `trace.list` exposes stored trace records. A polished trace summary model would require extra UI and trace-shape decisions outside the MVP's minimal console scope.
- **冲突类型**: 设计不完整
- **影响范围**: Client / Trace
- **处理建议**: Keep raw JSON display for MVP; add a small trace view model after trace shape stabilizes.
- **决策结果**: Deferred
- **回写位置**: `docs/06-engineering/mvp-stage-notes/stage-4.md` and future client/trace UI docs.

---

## CONFLICT-003: Document persistence remains in-memory during MVP

- **发现阶段**: Stage 1 / Stage 5
- **发现位置**: `packages/document-store/src/index.ts`
- **原文依据**: `docs/04-data/studio-document-store-engineering-v0.md` and repository engineering docs describe SQL-backed persistent storage as the target.
- **实际问题**: The MVP needed revision semantics, optimistic checks, tombstones, and events first. SQLite backend implementation is larger than the Stage 0-5 acceptance path and is not required to validate Kernel/Extension/Client/RPC boundaries.
- **冲突类型**: 实现成本过高
- **影响范围**: Data / Server
- **处理建议**: Keep P0 in-memory backend; implement SQLite backend next, targeting `.loomstudio-dev/projects/<project-id>/workspace.db`.
- **决策结果**: Deferred
- **回写位置**: `docs/04-data/studio-document-store-engineering-v0.md` should keep SQL-backed as target and mark in-memory as MVP backend.

---

## CONFLICT-004: Client Extension sandbox activation is not implemented in Stage 4/5

- **发现阶段**: Stage 4 / Stage 5
- **发现位置**: `apps/studio-client/src/main.tsx`, `packages/client-bridge/src/index.ts`
- **原文依据**: `docs/05-extensions/studio-extension-manifest-architecture.md` requires Client Extension to use Client Host Bridge / sandbox activation.
- **实际问题**: Stage 4 validates the Studio Client's own Bridge to Kernel, not arbitrary third-party Client Extension panels. Adding iframe sandbox activation would expand scope beyond MVP acceptance.
- **冲突类型**: 实现成本过高
- **影响范围**: Client / Extension
- **处理建议**: Defer Client Extension sandbox runtime; keep the Bridge API transport-neutral enough for future sandbox activation.
- **决策结果**: Deferred
- **回写位置**: Future client extension lifecycle docs.

---

## CONFLICT-005: RPC method schema metadata is minimal

- **发现阶段**: Stage 5
- **发现位置**: `packages/kernel/src/index.ts`
- **原文依据**: Introspection docs imply discoverability of platform capability metadata.
- **实际问题**: MVP `system.introspect` exposes method names and ownership but not params/result schemas, stability, or descriptions.
- **冲突类型**: 设计不完整
- **影响范围**: Kernel / Client / DevTool
- **处理建议**: Keep MVP metadata minimal; add schema metadata only when public extension/client tooling needs it.
- **决策结果**: Deferred
- **回写位置**: `docs/03-kernel/studio-rpc-methods-v0.md` or a future RPC registry metadata ADR.

---

## Deprecated Designs

- Historical `plugin-sdk`, `server.contributes`, `client.bundle`, `Document.data`, and `pluginId` naming remains superseded by `extension-sdk`, top-level `contributes`, `client.entry`, `DocumentRecord.content`, and `ownerExtensionId`.
- Kernel-owned Chat / Provider / Tool / MCP runtime APIs remain rejected for Studio Kernel MVP.

---

## Needs Follow-up ADR Candidates

- Transport layering: HTTP JSON-RPC dev path plus WebSocket/SSE event delivery target.
- RPC registry metadata: method schema/stability/permission descriptors.
- Persistent Document Store backend selection and migration path.
