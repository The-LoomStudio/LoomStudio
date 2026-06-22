# MVP Stage 4 Notes — Studio Client Minimal Console

> **Stage**: 4
> **Date**: 2026-05-15
> **Status**: Passed

---

## Build Summary

Implemented the Stage 4 minimal Studio Client loop.

### Stage 3 Review Fixes Included

Before starting the client work, the Stage 3 review findings were addressed:

- Kernel RPC registry now keeps method ownership metadata.
- `system.introspect` can report Extension RPC methods as `extension:<id>` instead of `kernel`.
- Extension-owned document writes/deletes can emit `docs.changed` through the host integration.
- `activate()` and `activateAll()` now share activation logic.
- `activateAll()` uses stable manifest id ordering.
- Stage 3 regression tests were expanded for introspection ownership, extension document events, and partial activation cleanup.

### Client Bridge

Expanded `@loom-studio/client-bridge` with:

- `createClientBridge(options)`
- `connect()` / `disconnect()` connection state hooks
- `call(method, params)` JSON-RPC helper
- low-level `request(request)` for diagnostics/tests
- HTTP JSON-RPC transport through `fetch`

Stage 4 intentionally keeps the bridge small and does not expose Kernel internals or a raw WebSocket as stable API.

### Studio Client

Replaced the placeholder client with a minimal React + Vite console:

- RPC endpoint input
- `system.ping`
- `system.getInfo`
- `system.introspect`
- `docs.list`
- manual `docs.write`
- manual `loom.run`
- manual `example.echo.echo`
- `diagnostics.list`
- JSON result panels for documents, run result, diagnostics, and trace-bearing run output

CSS remains local and token-based with plain CSS custom properties. No Tailwind or component library was added.

---

## Review Conclusion

- Client only imports `createClientBridge` from `@loom-studio/client-bridge` plus shared JSON types.
- Client does not import Kernel, Document Store, Extension Host, Loom Runner, or Loom Core.
- Client does not assume Chat, `messages[]`, provider, tool, MCP, or runtime schemas.
- UI remains an MVP operation console, not a productized Chat UI.
- No arbitrary `window.xx` Studio-facing API was introduced.
- Client Bridge currently uses HTTP JSON-RPC because the server still exposes HTTP as the verified headless path; WebSocket delivery remains deferred.

---

## Test Result

Commands run:

```text
pnpm test -- tests/stage-3.test.ts
pnpm lint
pnpm test
pnpm build
```

Current result:

- Stage 3 regression tests: passed
- `pnpm lint`: passed
- `pnpm test`: passed
- `pnpm build`: passed

Stage 4 tests added in `tests/stage-4.test.ts`:

- client bridge request/response result handling
- RPC error response surfacing
- low-level request passthrough for diagnostics/tests

---

## Reflect Notes

- The Client Bridge is enough for the Stage 4 HTTP JSON-RPC console, but event delivery still needs WebSocket/SSE or another subscription transport later.
- `system.introspect` owner metadata needed the Stage 3 fix before it could be safely displayed in the client.
- Trace summary is currently shown as raw run JSON, which is acceptable for MVP but will need a small view model in a later UX pass.
- The UI exposed no immediate need for Client Extension Panel API yet.

---

## Open Conflicts

None blocking Stage 4.

Remaining engineering notes:

- WebSocket event delivery remains deferred.
- Client Extension sandbox activation remains out of scope for Stage 4.
- The client operation console is intentionally manual and not a product workflow.

---

## Next-stage Readiness

Ready for Stage 5: MVP 总体验收.
