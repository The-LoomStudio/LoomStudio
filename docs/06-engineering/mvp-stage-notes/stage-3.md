# MVP Stage 3 Notes — Extension Minimal Loop

> **Stage**: 3
> **Date**: 2026-05-15
> **Status**: Passed

---

## Build Summary

Implemented the Stage 3 minimal Extension loop.

### Extension SDK

- Expanded `@loom-studio/extension-sdk` with the MVP server activation context shape:
  - `ctx.extension`
  - `ctx.rpc.register`
  - `ctx.rpc.call`
  - `ctx.events.emit`
  - `ctx.documents.get/list/write/delete`
  - `ctx.diagnostics.report`
  - `ctx.lifecycle.onDispose`
- Extended manifest typing with:
  - `server.entry`
  - `client.entry`
  - top-level `contributes`
  - optional `roles`
  - optional `capabilities`

### Extension Host

Implemented `createExtensionHost()` with:

- manifest parser
- required field validation
- local extension discovery by directory
- server entry loading
- named `activate(ctx)` support
- runtime RPC registration
- duplicate RPC conflict handling through Kernel registration errors
- Kernel namespace registration rejection
- extension diagnostics
- extension-owned document writes through context
- dispose cleanup for runtime RPC registrations and lifecycle callbacks
- `extensions.list` state data through Kernel's existing RPC
- `extensions.getDiagnostics` through Kernel's existing RPC

### Kernel / Server Integration

- Kernel now supports `registerExtensionRpc()` for non-Kernel namespaces.
- Server now creates the real Extension Host.
- Server discovers and activates `extensions/example-echo` on startup.

### Example Extension

Updated `extensions/example-echo`:

- added server `activate(ctx)` export
- registers `example.echo.echo`
- returns extension id and echoed params
- registers a dispose callback diagnostic

---

## Review Conclusion

- Manifest uses top-level `contributes`.
- `server.entry` naming is used.
- `engines.studio` remains required by validation.
- Extension cannot register Kernel namespace RPC.
- Extension only receives context facades, not the Kernel object or raw registry map.
- Extension RPC registration is routed through Host/Kernel and records `ownerExtensionId`.
- `roles` remains display metadata only and is not used for permissions, dispatch, or loading.
- Capability enforcement remains diagnostic-oriented and intentionally light for MVP.

---

## Test Result

Commands run:

```text
pnpm test
```

Current result:

- `pnpm test`: passed

Stage 3 test coverage added in `tests/stage-3.test.ts`:

- manifest required field validation
- example extension activation success
- `example.echo.echo` RPC round-trip
- Kernel namespace registration rejection
- duplicate RPC registration conflict disables activation
- undeclared runtime RPC registration degrades extension and emits diagnostic
- extension-owned document write records `ownerExtensionId`
- dispose cleans extension RPC registration

---

## Reflect Notes

- The MVP activation context is intentionally narrow and does not expose the Kernel object.
- Runtime registration is treated as truth; Manifest contributes are checked as a contract and mismatches produce diagnostics/degraded state.
- The host currently uses dynamic ESM import for local server entry loading; deeper isolation, sandboxing, reload, and signature verification remain out of scope.
- Capability declarations are not enforced yet; undeclared runtime registration produces diagnostics rather than hard failure unless the Kernel registration itself fails.
- Extension document ownership is set by the context write facade, not by trusting extension-submitted `ownerExtensionId`.

---

## Open Conflicts

None blocking Stage 3.

Remaining engineering notes:

- WebSocket delivery remains deferred.
- Extension server entry loading is local-process dynamic import, not process or VM isolation.
- Full capability enforcement is deferred.

---

## Next-stage Readiness

Ready for Stage 4: Studio Client 最小可视化.
