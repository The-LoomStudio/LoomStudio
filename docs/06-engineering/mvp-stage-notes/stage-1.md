# MVP Stage 1 Notes — Kernel Minimal Runtime Loop

> **Stage**: 1
> **Date**: 2026-05-15
> **Status**: Passed

---

## Build Summary

Implemented the Stage 1 minimal Kernel runtime loop.

### Shared / Diagnostics / Transport

- Added `createId()` and `serializeError()` helpers in `@loom-studio/shared`.
- Expanded `@loom-studio/diagnostics` with:
  - `Diagnostic`
  - `DiagnosticInput`
  - `DiagnosticFilter`
  - `createInMemoryDiagnosticsRegistry()`
- Expanded `@loom-studio/transport` with:
  - RPC id type
  - server event envelope types
  - `parseRpcRequest()`
  - `createSuccessResponse()`
  - `createErrorResponse()`

### Document Store

Implemented `createInMemoryDocumentStore()` with:

- `get()`
- `list()`
- `write()`
- `delete()`
- monotonic document versions
- tombstone delete
- historical revision reads
- optimistic version checks

Document model uses:

- `content`
- `ownerExtensionId`
- `createdBy` / `updatedBy`
- `tombstone`

### Kernel

Implemented:

- Kernel RPC registry
- Kernel namespace guard
- Event bus
- `system.ping`
- `system.getInfo`
- `system.introspect`
- `events.subscribe`
- `events.unsubscribe`
- `docs.get`
- `docs.list`
- `docs.write`
- `docs.delete`
- `extensions.list`
- `extensions.getDiagnostics`
- `diagnostics.list`

`docs.write` and `docs.delete` emit `docs.changed`.

`system.getInfo` intentionally reports `loomRun: false` in Stage 1 because Loom Runner execution starts in Stage 2.

### Studio Server

Implemented minimal Node HTTP JSON-RPC entry:

- `GET /health`
- `POST /rpc`
- request parsing through transport helpers
- dispatch to Kernel through `kernel.callRpc()`
- serialized error response for invalid requests

No server framework was introduced.

---

## Review Conclusion

- Kernel public surface remains platform-only.
- No Chat / Runtime / Provider / Tool / MCP / messages contract was added.
- Event names use `docs.changed`.
- Document records use `content` and `ownerExtensionId`.
- `system.introspect` is present and exposes Kernel methods/events.
- Extension Host remains a stub for Stage 1; real activation is deferred to Stage 3.
- Loom Runner remains a stub for Stage 1; real Core integration is deferred to Stage 2.
- Server uses Node `http`; no server framework was introduced.
- TypeScript path aliases were avoided for build correctness; workspace package dependencies and project references remain the source of truth.

---

## Test Result

Commands run:

```text
pnpm lint
pnpm test
pnpm build
```

Final result:

- `pnpm lint`: passed
- `pnpm test`: passed
- `pnpm build`: passed

Test coverage added in `tests/stage-1.test.ts`:

- `system.ping` round-trip
- `system.getInfo` avoids business runtime capabilities
- `system.introspect` exposes methods and events
- non-Kernel namespace registration is rejected
- in-memory Document Store create / update / list / tombstone delete
- Kernel `docs.write` emits `docs.changed`
- transport request parsing and serialized invalid request errors

---

## Reflect Notes

- The minimal Kernel methods are sufficient for Stage 1.
- `loom.run` was intentionally not registered yet to keep Stage 2 as the single Loom Runner integration phase.
- Event subscription currently records subscriptions but does not bridge them to HTTP/WebSocket clients. This is acceptable for Stage 1 because event bus behavior is tested in-process; transport-level event delivery can be added when WebSocket client flow is needed.
- Document Store exposes only logical document operations; no SQLite or physical backend concerns leaked into Kernel.
- Capability enforcement remains deferred. Stage 1 did not need a capability model beyond namespace guards.

---

## Open Conflicts

None for Stage 1.

---

## Next-stage Readiness

Ready for Stage 2: Loom Runner 集成.
