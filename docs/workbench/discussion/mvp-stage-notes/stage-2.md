# MVP Stage 2 Notes — Loom Runner Integration

> **Stage**: 2
> **Date**: 2026-05-15
> **Status**: Passed

---

## Build Summary

Implemented the Stage 2 Loom Runner integration.

### Loom Runner

- `@loom-studio/loom-runner` now depends on `@loom/core`.
- Added `createLoomRunner()`.
- Added Studio-facing `LoomRunner` interface support for:
  - `fragments`
  - `passes`
  - `options?`
  - `trace?`
- Added minimal built-in test factories:
  - `noop`
  - `uppercase`
  - `throw`
- Converts Studio JSON fragments/pass configs into Loom Core `Fragment[]` / `PassConfig[]`.
- Converts Core diagnostics into Studio diagnostics.
- Persists trace into `TraceAuditStore` only when `trace.enabled` is true.
- Trace persist failure is non-blocking by default.
- `trace.strictPersist` makes trace persist failure fail the run.

### Kernel

- Registered `loom.run` RPC.
- `system.getInfo.capabilities.loomRun` now reports `true`.
- `system.introspect` exposes `loom.run`.
- `loom.run` rejects forbidden runtime/provider/chat fields:
  - `messages`
  - `model`
  - `temperature`
  - `tools`
  - `toolChoice`
  - `chatId`
  - `sessionId`
  - `provider`
- Kernel records `loom.run` diagnostics into the diagnostics registry.

### Server

- Server now uses `createLoomRunner({ traceAudit })` instead of a Stage 1 stub.

---

## Review Conclusion

- Only `packages/loom-runner` imports `@loom/core`.
- `loom.run` remains `Fragment[] + PassConfig[] -> Fragment[] + Trace`.
- No provider-neutral invocation schema was added.
- No official messages schema was added.
- No Chat / Provider / Tool / MCP / Agent Runtime contract was added to Kernel.
- Trace is persisted as append-only Trace/Audit data and is not part of rollback semantics.
- The implementation follows the current Loom Core v0.1 API: synchronous pass execution, string `Fragment.content`, mutation trace, diagnostics, and owner tracking.

---

## Test Result

Commands run:

```text
pnpm test
```

Current result:

- `pnpm test`: passed

Stage 2 test coverage added in `tests/stage-2.test.ts`:

- no-op pass run
- uppercase pass run
- missing pass diagnostic
- thrown pass diagnostic
- trace enabled creates trace id and persists trace
- trace persist failure does not fail by default
- strict trace persist failure fails the run
- Kernel `loom.run` RPC round-trip
- forbidden runtime/provider/chat fields are rejected
- `system.introspect` exposes `loom.run`

---

## Reflect Notes

- Loom Core API aligned with the Stage 2 Runner expectation closely enough for MVP.
- Core returns diagnostics for successful runs when owner tracking detects cross-owner writes; Studio records them through `diagnostics.list` rather than treating them as fatal errors.
- `@loom/core` is currently consumed through a local file dependency to `../LoomProject/packages/core`.
- Vitest aliases `@loom/core` to source for test execution; package build uses the linked package build output.
- Because `@loom/core` currently emits extensionless ESM imports in `dist`, the Core package must be built before Studio runtime/build consumers rely on the linked `dist` output.

---

## Open Conflicts

None blocking Stage 2.

Remaining engineering note:

- WebSocket delivery remains deferred from Stage 1 and is not solved by Stage 2.

---

## Next-stage Readiness

Ready for Stage 3: Extension 最小闭环.
