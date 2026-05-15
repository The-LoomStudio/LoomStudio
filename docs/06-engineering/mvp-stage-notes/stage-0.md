# MVP Stage 0 Notes — Repository and Engineering Skeleton

> **Stage**: 0
> **Date**: 2026-05-15
> **Status**: Passed

---

## Build Summary

Created the Stage 0 workspace skeleton:

```text
apps/
  studio-server/
  studio-client/
packages/
  shared/
  diagnostics/
  transport/
  document-store/
  extension-host/
  extension-sdk/
  client-bridge/
  trace-audit/
  loom-runner/
  kernel/
extensions/
  example-echo/
scripts/
tests/
```

Added root workspace/tooling files:

- `package.json`
- `pnpm-workspace.yaml`
- `tsconfig.base.json`
- `tsconfig.json`
- `eslint.config.js`
- `prettier.config.js`
- `vitest.config.ts`
- `.gitignore`
- `pnpm-lock.yaml`

Added package-level `package.json`, `tsconfig.json`, and `src/index.ts` public entries for all first-batch packages.

Added placeholder app entries:

- `apps/studio-server/src/main.ts`
- `apps/studio-client/src/main.tsx`

Added minimal example extension skeleton:

- `extensions/example-echo/manifest.json`
- `extensions/example-echo/src/index.ts`

---

## Review Conclusion

- Repository shape matches `studio-repository-engineering-v0.md`.
- Package naming uses `extension-*`, not `plugin-*`.
- Public package entries use `src/index.ts`.
- `packages/loom-runner` is the only package intended to depend on Loom Core later.
- No Kernel package or API was added for Runtime / Provider / Tool / MCP / Chat / messages.
- Client placeholder only renders a minimal React app and does not import Kernel internals.
- Extension example depends on `@loom-studio/extension-sdk`, not Kernel internals.
- `.loomstudio-dev/` is ignored.

---

## Test Result

Commands run:

```text
pnpm install
pnpm lint
pnpm test
pnpm build
```

Final result:

- `pnpm install`: passed
- `pnpm lint`: passed
- `pnpm test`: passed
- `pnpm build`: passed

Notes:

- Initial lint failed because generated `dist/**` files and config/test files were included by ESLint project service. Fixed by tightening `eslint.config.js` ignores.
- Initial test failed because no test files existed. Added `tests/stage-0.test.ts` as a harness smoke test.
- Initial build failed because React type packages were missing. Added `@types/react` and `@types/react-dom`.

---

## Reflect Notes

- Node-compatible baseline is sufficient for Stage 0.
- No Bun-first assumption was introduced.
- No server framework was introduced.
- Vite/React is present only as the client shell baseline.
- The package list is broad but still matches the accepted skeleton documents; each package currently exports only minimal types/placeholders.
- ESLint boundary enforcement is not implemented yet; Stage 0 only establishes lint execution. Boundary-specific lint rules remain a later hardening step.

---

## Open Conflicts

None for Stage 0.

---

## Next-stage Readiness

Ready for Stage 1: Kernel 最小运行闭环.
