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
  - request / response correlation metadata
  - server event envelope types
  - `parseRpcRequest()`
  - `createSuccessResponse()`
  - `createErrorResponse()`
- Added a minimal in-memory `@loom-studio/trace-audit` store for Stage 1 Kernel composition.

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
- correlation metadata on write/delete results

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
- platform service getters for Document Store, Extension Host, Diagnostics, Event Bus, Trace/Audit, and Loom Runner

`docs.write` and `docs.delete` emit `docs.changed` with `changesetId`, operations, document summaries, and correlation metadata.

`docs.write` sanitizes client-submitted metadata so normal callers cannot forge `actor` or `ownerExtensionId` through Kernel RPC params.

`system.getInfo` intentionally reports `loomRun: false` in Stage 1 because Loom Runner execution starts in Stage 2.

### Studio Server

Implemented minimal Node HTTP JSON-RPC entry:

- `GET /health`
- `POST /rpc`
- request parsing through transport helpers
- dispatch to Kernel through `kernel.callRpc()`
- correlation / call metadata injection for HTTP RPC calls
- serialized error response for invalid requests

No server framework was introduced.

---

## Review Conclusion

- Kernel public surface remains platform-only.
- No Chat / Runtime / Provider / Tool / MCP / messages contract was added.
- Event names use `docs.changed`.
- `docs.changed` payload now follows the Document Store event summary shape.
- Document records use `content` and `ownerExtensionId`.
- Kernel public surface includes the documented platform service getters and `traceAudit` dependency.
- RPC calls generate or propagate `correlationId` / `callId`.
- Kernel docs handlers no longer trust client-submitted `actor` / `ownerExtensionId`.
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
- duplicate Kernel RPC registration is rejected
- Kernel platform service getters are exposed
- in-memory Document Store create / update / list / tombstone delete
- Kernel `docs.write` / `docs.delete` emit `docs.changed`
- `docs.changed` carries changeset/document summary and correlation metadata
- `diagnostics.list` returns a page result shape
- client-submitted `actor` / `ownerExtensionId` are not trusted by docs RPC handlers
- transport request parsing and serialized invalid request errors
- transport response metadata

---

## Reflect Notes

- The minimal Kernel methods are sufficient for Stage 1.
- `loom.run` was intentionally not registered yet to keep Stage 2 as the single Loom Runner integration phase.
- Event subscription currently records subscriptions but does not bridge them to HTTP/WebSocket clients. This is acceptable for Stage 1 because event bus behavior is tested in-process; transport-level event delivery can be added when WebSocket client flow is needed.
- Document Store exposes only logical document operations; no SQLite or physical backend concerns leaked into Kernel.
- Capability enforcement remains deferred. Stage 1 did not need a capability model beyond namespace guards.
- Stage 1 still does not implement WebSocket transport delivery. This is the only remaining planned-scope deferral; HTTP JSON-RPC is kept as the current headless verification path, while WebSocket delivery remains a Stage 2/4 transport-client integration item.
- Document Store checkpoint / restore APIs remain deferred; Stage 1 only requires get/list/write/delete plus historical revision reads.

---

## Open Conflicts

None for Stage 1.

---

## Next-stage Readiness

Ready for Stage 2: Loom Runner 集成.
