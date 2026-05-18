# MVP Stage 5 Notes — Total MVP Acceptance

> **Stage**: 5
> **Date**: 2026-05-15
> **Status**: Passed

---

## Build Summary

Completed the MVP acceptance path across Client Bridge, Kernel, Document Store, Extension Host, Loom Runner, Trace/Audit, diagnostics, and event bus.

### Acceptance Chain

The automated Stage 5 test validates this headless client chain:

```text
Client Bridge
  -> system.introspect
  -> docs.write
  -> docs.list
  -> example.echo.echo
  -> loom.run
  -> diagnostics.list
  -> trace.list
  -> docs.changed / diagnostics.updated events
```

### Additions

- Added Kernel RPC methods:
  - `trace.list`
  - `audit.list`
- Added `diagnostics.updated` emission when `loom.run` records diagnostics.
- Added a Stage 5 headless client acceptance test using `createClientBridge()` with an in-memory fetch adapter.
- Added a no-forbidden-Kernel-API snapshot-style test for Chat/Provider/runtime leakage.
- Added `docs/06-engineering/mvp-stage-notes/conflicts.md`.

---

## Review Conclusion

- Kernel still does not expose Runtime / Provider / Tool / MCP / Chat / `messages[]` contracts.
- `system.introspect` discovers Kernel-owned and Extension-owned RPC methods.
- Document records use `content` and `ownerExtensionId`.
- Document write events use `docs.changed`.
- Diagnostics update events use `diagnostics.updated`.
- Extension Host only exposes context facades, not Kernel internals or the raw RPC registry map.
- `packages/loom-runner` remains the only Studio package importing `@loom/core`.
- Client goes through `@loom-studio/client-bridge` and transport envelopes.
- Trace/Audit are append-only facts exposed through `trace.list` / `audit.list`; rollback remains out of MVP implementation.
- `.loomstudio-dev/` remains git ignored.

---

## Test Result

Commands run:

```text
pnpm lint
pnpm test
pnpm build
```

Current result:

- `pnpm lint`: passed
- `pnpm test`: passed
- `pnpm build`: passed

Stage 5 tests added in `tests/stage-5.test.ts`:

- headless client end-to-end path across Kernel, Document Store, Extension Host, Loom Runner, Trace, diagnostics, and events
- forbidden runtime/provider/chat field rejection and public surface guard

---

## Reflect Notes

MVP is now validated as a capability platform rather than a product workflow.

Still intentionally deferred:

- WebSocket/SSE event delivery to browser clients.
- SQLite persistent Document Store backend.
- Client Extension sandbox activation.
- Rich trace summary UI.
- Full RPC method schema metadata.
- Rollback/checkpoint implementation.

These deferrals are recorded in `conflicts.md` and should become the next planning input instead of hidden architectural debt.

---

## Open Conflicts

See:

```text
docs/06-engineering/mvp-stage-notes/conflicts.md
```

No conflict blocks MVP acceptance.

---

## MVP Acceptance Status

Accepted for MVP Stage 0-5 gate completion.
