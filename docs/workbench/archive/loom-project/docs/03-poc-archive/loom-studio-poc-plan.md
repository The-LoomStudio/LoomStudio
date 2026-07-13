# Loom Studio PoC Plan

> **Status: Sealed**
> 本文件已封存。后续工作见 `loom-poc-hardening-brief.md` → `loom-adr-candidates.md`
> **Post-seal note (2026-05-02)**: Studio 架构已迁移到 `/Users/macbookair/Desktop/LoomStudio/docs/`，并补充 **Runtime as Extension Pattern**。本 PoC 仍只验证 Kernel / Concept Stack / Pass Registry / Trace 的承重假设，不验证 Provider Gateway、Chat Runtime、Agent Runtime、Tool Loop 或 MCP Bridge。

**Status**: Draft v0.1 — discussion document, not an implementation contract.
**Companion**: `docs/loom-studio-architecture.md` v0.3

---

## 0. Purpose of This Document

This PoC is **not** an attempt to build Loom Studio.
It is an attempt to **falsify** the architecture document — to take the load-bearing claims of `loom-studio-architecture.md` v0.3 and put them under the smallest amount of real code that can either confirm or break them.

If a claim survives the PoC, it earns the right to stay in the architecture doc.
If a claim breaks, the architecture doc gets revised before any real Studio work begins.

The PoC is therefore deliberately ugly, deliberately incomplete, and deliberately throwaway. Beauty is anti-goal.

---

## 1. What We Are Validating

The architecture document makes many claims. Most of them are either obvious (WebSocket works) or cheap to revise (workspace layout). A small number are **load-bearing** — if they're wrong, large sections of the architecture collapse.

These five are the load-bearing claims, and the PoC exists to put each one under fire.

### H1 — Kernel is truly stateless; pipelines are per-invocation

> *Tenet IV — The Kernel Runs Pipelines, Not Sessions.*

Two clients calling `kernel.loom.run` concurrently must not interfere with each other. The Kernel must not retain any "current session" / "active stack" notion. Each invocation must carry its full context.

If this is wrong, the multi-stack story (§9.4–§9.5 of the arch doc) and the independent-frontend story (§7.5) both collapse.

### H2 — Pass Registry + Concept Stack split is implementable

> *Tenet IV (orchestration outside the Kernel)*

A Concept Stack must be writable as a pure Extension — registering DocTypes, Passes, and `compose` / `invoke` RPCs — without needing any Kernel-side privilege. The Kernel must remain ignorant of "which stack is in charge".

If this is wrong, the entire ecosystem narrative (§9, §11 Non-Goals around "no official chat schemas") collapses; we'd have to bake a default stack into the Kernel.

### H3 — Trace is self-contained enough that DevTool works after Extensions are uninstalled

> *Tenet III — Everything Registered is Discoverable*; §10 Observability

A trace written today must be readable tomorrow even if every Extension involved has been removed. The Pass-by-Pass Fragment evolution must remain reconstructible from the trace alone.

If this is wrong, DevTool becomes brittle, and Tenet III's promise to make the platform inspectable loses half its weight.

### H4 — Server Part / Client Part separation actually works

> *Tenet II — Transport API is the Contract*

A Server Part must be reachable by **any** client speaking the Transport protocol — official Web UI, a 30-line Node script, anything. The Server Part must not "know" who is calling it.

If this is wrong, the independent-frontend ecosystem story breaks, and we collapse back into a one-UI platform.

### H5 — Cross-stack composition works without coordination

> §9.5 Scenario 3, §9.6 Stack Interop

A third-party caller must be able to invoke `stackA.compose(...)` to obtain a `Pass[]`, splice in a Pass from a completely unrelated Extension, and submit the result to `kernel.loom.run` — and have it work. No central coordinator. No Kernel-side awareness.

If this is wrong, the platform isn't really a platform. It's just a single-app with extensions.

---

## 2. What We Are Explicitly NOT Validating

These are things the architecture document also commits to, but the PoC deliberately skips them — either because they're cheap to revise later, or because validating them is a separate large project on its own.

| Skipped | Reason |
|---|---|
| Real `loom-studio-st` Concept Stack | Stage 2 work. PoC uses an `st-mini` stack with just enough ST flavour to look real. |
| Real Capability Broker enforcement | PoC declares + logs capabilities, does not enforce. Real enforcement needs vm/Proxy/freeze work that's its own project. |
| Worker isolation | Architecture promises it as opt-in; PoC is inproc-only. The manifest field is parsed but rejected with a friendly error. |
| URL-based plugin install (git/npm) | PoC loads from local filesystem paths only. URL resolvers are Stage 2. |
| Polished Web UI / Dock component | PoC ships an intentionally ugly demo client. The Dock and the official Web UI are not PoC concerns. |
| Lockfile + Resolver SAT | PoC trusts the order of `extensions/` directory entries plus a hand-written load order. |
| Card Script sandbox | Out of scope for the PoC entirely. |
| Persistence backend swap | PoC ships only the SQLite default. |
| Authentication on Transport | PoC binds to localhost without a token. Token gate is Stage 2. |
| Provider Gateway / LLM API adapter | Runtime / Provider 是 Extension Pattern，不是 Kernel service；PoC 不验证模型 API 发送链路。 |
| Chat Runtime / Agent Runtime / Tool Loop / MCP Bridge | PoC 的 `st-mini.invoke` 只是 Concept Stack RPC 的薄示例，不代表平台内置 Runtime。Agent / ReAct / Tool loop 属于后续 Extension 设计。 |
| `messages[]` / provider-neutral invocation schema | PoC 不把 `messages[]` 固化为平台 contract；任何输出格式仅是 `st-mini` 的私有示例 payload。 |

If something on this list turns out to be load-bearing during the PoC, we promote it back into the validation set and add a stage.

---

## 3. The Vertical Slice

The PoC is one thin vertical slice that touches every load-bearing claim. The shape:

```
   ┌──────────────────────────────┐    ┌──────────────────────────────┐
   │  Extension: st-mini          │    │  Extension: passext-upper    │
   │  (Concept Stack #demo)       │    │  (Pass-only Extension)       │
   │                              │    │                              │
   │  · DocTypes:                 │    │  · Passes:                   │
   │      st-mini.character       │    │      UpperCasePass           │
   │      st-mini.chat.session    │    │                              │
   │  · Passes:                   │    │  · No Client Part            │
   │      StMiniHistoryWindow     │    │                              │
   │      StMiniSystemPrompt      │    │                              │
   │      StMiniWorldInfo         │    │                              │
   │  · RPC:                      │    │                              │
   │      st-mini.compose         │    │                              │
   │      st-mini.invoke          │    │                              │
   └──────────────┬───────────────┘    └──────────────┬───────────────┘
                  │                                   │
                  └─────────────┬─────────────────────┘
                                │  loaded via manifest
                                ▼
       ┌────────────────────────────────────────────────────────┐
       │  Loom Studio Kernel (PoC)                              │
       │                                                        │
       │   Document Store (SQLite)                              │
       │   Plugin Loader (local filesystem only)                │
       │   Pass Registry                                        │
       │   LoomRunner   ── wraps @loom/core, accepts invoker    │
       │   Capability Broker (declare + log only)               │
       │   Event Bus                                            │
       │   Transport (WebSocket, JSON-RPC 2.0)                  │
       │                                                        │
       │   Writes: system.trace documents on every run          │
       └─────────────────────────┬──────────────────────────────┘
                                 │
            ┌────────────────────┼─────────────────────┐
            ▼                    ▼                     ▼
       Client A             Client B               Client C
       (demo Web UI,        (CLI script,           (CLI script,
        React, ugly)         30 lines Node)         "rogue composer")
                                                   - calls
                                                     st-mini.compose
                                                   - splices in
                                                     UpperCasePass
                                                   - calls loom.run
                                                     directly
```

### Why these three Extensions

- **st-mini** — proves Concept Stack form (H2). Just enough ST flavour (character + chat session + worldbook entries) to use real ST sample data; no instruct mode, no preset, no swipes, no streaming-specific handling. About 200–400 lines of code expected. Its `invoke` only proves "an Extension can wrap compose + loom.run + private result payload for ordinary clients"; it is **not** a built-in Chat Runtime prototype and does **not** define platform-level `messages[]` / provider request schema.
- **passext-upper** — proves "pure Pass Extension" form (H4 partial). Trivial behaviour (uppercase the content) so its mere presence proves cross-Extension Pass reuse rather than its functionality.

### Why these three Clients

- **Client A** — proves the official-UI path. The demo Web UI is React, single-file ugly, only validates "Transport reaches a real browser".
- **Client B** — proves the headless-client path (H4). A 30-line Node script with no Studio knowledge whatsoever calling `st-mini.invoke` over WebSocket. If this works, the independent-frontend story is real.
- **Client C** — proves cross-stack composition (H5). Same Transport, different intent: the script asks for a Pass list, modifies it, runs it directly.

---

## 4. Sample Data: ST-Flavored

The PoC uses **real-shape ST data** to make the experience honest. We are not going to invent toy character cards.

Concretely:

- `examples/st-real-data/` already contains ST-format fixtures from prior Loom Core work — character cards, world books, chat logs.
- The PoC's `st-mini` Extension imports those fixtures and converts them to `st-mini.character` / `st-mini.chat.session` / `st-mini.world.entry` Documents on first run.
- The PoC ships a "load fixtures" command that does this conversion idempotently.

What this gives us:

1. The PoC will compose prompts whose total bulk and structure match real ST usage. Performance and Trace storage size become realistic data points, not toy numbers.
2. ST users / authors looking at the PoC immediately recognize what the Documents represent. Even at this throwaway stage, that is a non-trivial credibility signal.
3. We start to discover where the ST data model resists clean Document-Store representation. Those discoveries belong in the architecture doc, not in the eventual `loom-studio-st`.

What this **doesn't** mean:

- `st-mini` is **not** intended to be byte-compatible with SillyTavern's prompt output. It's "ST in shape", not "ST in fidelity". The real `loom-studio-st` is a Stage 2 project.

---

## 5. Three Stages

Each stage produces an independently demonstrable artifact. No stage advances until its acceptance checks pass.

### Stage 0 — The Empty Kernel

**Goal**: Validate H1 in the absence of any Extensions.

**Build**:
- Kernel skeleton with: SQLite Document Store, LoomRunner wrapping `@loom/core`, WebSocket Transport, Event Bus.
- A hardcoded "fake Pass" written inline in test code — not via plugin loader, not via registry. Just `import { Pass } from '@loom/core'` and pass it directly.
- A throwaway test client: a single Node script that opens two WebSocket connections and calls `kernel.loom.run` concurrently from each.

**Acceptance**:
- Two concurrent invocations from two different clients run to completion with no shared state and no observable interference.
- `invoker` parameter (`stackId`, `clientId`, `callerRef`) is faithfully recorded in each `system.trace` Document.
- An `AbortSignal` cancellation from one client stops one invocation between Pass boundaries without affecting the other.
- The Kernel module exports nothing resembling `currentSession`, `activeStack`, or `runningInvocation`. (Lint check: literal grep over the Kernel source.)

**Deliberately absent**: Plugin loader, Pass Registry, Extension manifest, any user-facing UI.

**Why this stage exists alone**: H1 is the foundation of every other claim. If the Kernel turns out to need state, we discover it before adding any plugin machinery on top.

### Stage 1 — Plugins and Stacks

**Goal**: Validate H2 and H4.

**Build, on top of Stage 0**:
- Plugin Loader (local filesystem path only).
- Manifest parser with `engines.loom`, `engines.studio`, `server.contributes.{documentTypes,passes,rpc}` fields. Anything else in the schema is reserved-but-ignored.
- Pass Registry: name → loaded module pointer.
- `passext-upper` Extension (Server-only).
- `st-mini` Extension (Concept Stack).
- A simple demo Web UI (Client A) that lists characters, lets the user click one, types a message, sees a response.
- The 30-line Client B script.

**Acceptance**:
- Loading both Extensions registers their contributions into the Kernel; `system.introspect` returns an enumeration that includes them.
- `st-mini.compose(sessionId, options)` returns a `Pass[]` that includes Passes registered by `passext-upper` if `options` requests them — proving cross-Extension Pass reference.
- Client A successfully composes a prompt from real ST sample data through `st-mini.invoke` and renders the result.
- Client B, knowing **only** the Transport URL and the RPC names, calls `st-mini.invoke` and gets a result. It never imports any Studio package.
- The Server Part of `st-mini` does not contain any code path that branches on "who is calling".
- Manifest fields not yet implemented (e.g. `isolation: "worker"`) cause a friendly "not yet supported in PoC" error, not a silent ignore.

**Deliberately absent**: Lockfile, Resolver, capability enforcement, URL install, Dock.

**Also deliberately absent after v0.4 architecture update**: Provider Extension、Runtime Extension、Tool / MCP Extension。Stage 1 的 `st-mini.invoke` 不应被解读为 Kernel 需要内置 runtime；它只是一个普通 Extension RPC。

### Stage 2 — Trace, Replay, and Cross-Stack Composition

**Goal**: Validate H3 and H5.

**Build, on top of Stage 1**:
- `system.trace` Documents written fire-and-forget on every invocation.
- A CLI viewer: `loom-studio-poc trace show <traceId>` that pretty-prints the full Pass-by-Pass Fragment evolution.
- A "replay" command: `loom-studio-poc trace replay <traceId>` that re-runs the recorded Pass list against the recorded initial Fragments, with a warning if any Pass version differs from the recorded one.
- Client C: a CLI script that calls `st-mini.compose`, splices in `passext-upper.UpperCasePass`, and submits the modified Pass list directly via `kernel.loom.run`.

**Acceptance**:
- After running several invocations, **uninstalling both `st-mini` and `passext-upper`** still allows `trace show` to display every recorded trace in full. (This is the keystone test.)
- `trace replay` succeeds when Pass versions match, and warns clearly when they don't.
- Client C's spliced invocation runs to completion, produces an output where `passext-upper`'s effect is visible, and yields a trace whose `invoker.stackId` is whatever Client C chose to declare (proving the field is informational, not authoritative).
- Concurrent invocations from Client A (st-mini), Client B (st-mini), and Client C (rogue) all succeed and produce three independent traces.
- DevTool reuse: the trace viewer's Fragment-evolution display delegates to `@loom/devtool` for the per-Pass diff, proving the Loom-side DevTool is reusable in the Studio-side observability surface.

---

## 6. Repository Layout

The PoC stays in this monorepo. Studio gets its own `packages/studio-poc/`:

```
packages/
├── core/                 (existing — @loom/core)
├── stdlib/               (existing)
├── devtool/              (existing — @loom/devtool, reused by Stage 2)
├── st/                   (existing — Loom Engine ST compat layer; NOT Studio's st-mini)
└── studio-poc/           (NEW)
    ├── src/
    │   ├── kernel/                     core Kernel modules
    │   │   ├── document-store.ts       SQLite-backed
    │   │   ├── plugin-loader.ts        local-fs only
    │   │   ├── pass-registry.ts
    │   │   ├── loom-runner.ts          wraps @loom/core
    │   │   ├── capability-broker.ts    declare + log only
    │   │   ├── event-bus.ts
    │   │   └── transport.ts            WebSocket + JSON-RPC
    │   ├── extensions/                 internal helpers (manifest schema, host APIs)
    │   ├── cli/
    │   │   ├── start.ts                npm run start
    │   │   ├── trace-show.ts           Stage 2
    │   │   └── trace-replay.ts         Stage 2
    │   └── client-demo/                Client A — ugly React Web UI
    ├── extensions-bundled/             Extensions used by the PoC
    │   ├── st-mini/
    │   │   ├── manifest.json
    │   │   └── server/
    │   │       ├── index.ts
    │   │       ├── doctypes.ts
    │   │       ├── passes/
    │   │       └── rpc.ts
    │   └── passext-upper/
    │       ├── manifest.json
    │       └── server/
    │           ├── index.ts
    │           └── passes/upper.ts
    ├── examples-clients/               Client B and Client C scripts
    │   ├── client-b-headless.ts
    │   └── client-c-rogue-composer.ts
    ├── docs-poc/                       Author-doc draft (see §8)
    │   ├── 01-extension-anatomy.md
    │   ├── 02-writing-a-pass.md
    │   └── 03-writing-a-stack.md
    └── README.md
```

**Important**: `packages/studio-poc/extensions-bundled/st-mini` is **not** to be confused with `packages/st`. The latter is Loom Engine's ST data adapter — pure compute, no Studio awareness. The former is a Studio Extension that may import the latter to do its Document-conversion work, but adds the manifest, the RPC, and the Concept Stack form on top.

```
@loom/st (engine-side, existing)         packages/studio-poc/extensions-bundled/st-mini (new)
   pure Pass library + source adapter         Studio Extension wrapping the above as
                                              DocTypes + RPC + compose/invoke
```

---

## 7. Order of Operations

The stages run sequentially. Within each stage, this is the recommended internal order — it surfaces problems early.

### Stage 0
1. Document Store first (SQLite). Without storage, nothing else can be built.
2. LoomRunner second. Wrap `@loom/core`, accept `invoker`, write `system.trace`.
3. Transport third. Just enough JSON-RPC to call `loom.run`.
4. Concurrency test client fourth. The H1 keystone.

### Stage 1
1. Manifest schema and parser.
2. Plugin Loader.
3. Pass Registry.
4. `passext-upper` first — it's trivial. Use it to validate the loader before tackling Concept Stack form.
5. `st-mini` next.
6. Demo Web UI last — it's the most cosmetic and most replaceable.

### Stage 2
1. Trace writing (it's already partially in place from Stage 0).
2. Trace viewer CLI.
3. Trace replay CLI.
4. Client C.
5. The keystone test: uninstall + trace show.

---

## 8. The Author Documentation Track

A non-code deliverable that runs alongside Stage 1 and Stage 2:

> While building the PoC, the implementer also writes the first draft of "I am an external developer; how do I write an Extension?" — as if the PoC were a real platform.

Three short documents, in `packages/studio-poc/docs-poc/`:

- **`01-extension-anatomy.md`** — what's in a manifest, what's in `server/`, what's in `client/`, where files go.
- **`02-writing-a-pass.md`** — pick the Pass-only Extension form, walk through `passext-upper`, end with "now you have a working Extension".
- **`03-writing-a-stack.md`** — pick the Concept Stack form, walk through `st-mini`, end with "now you have a Stack".

The discipline this enforces: **API ergonomics that can't be documented without contortion are signals to redesign the API**. This is the cheapest way to find ugly seams in the manifest, the registration calls, and the host helpers.

These three documents will probably be wrong, awkward, and short. That's fine. They exist to be unembarrassing, not authoritative.

---

## 9. Out-of-Band Validations

A handful of things to actively check during PoC work that aren't naturally caught by the acceptance criteria:

- **Lint for "Kernel-side state"**. After Stage 0, run `grep -E "currentSession|activeStack|runningInvocation|globalSession" src/kernel/`. Should return nothing. After every PR, repeat.
- **Lint for "Pass importing Studio"**. The Loom-side rule (Pass is pure, no Studio awareness) must be checkable. Add `grep -E "studio-poc|kernel" packages/studio-poc/extensions-bundled/*/server/passes/`. Should return nothing.
- **Trace size sanity**. Pick the largest realistic ST sample (e.g. a long chat session). Run a single invocation. Inspect the `system.trace` row size. If it exceeds, say, 1 MB per invocation, the architecture's fire-and-forget assumption needs revisiting before we promise it broadly.
- **introspect output volume**. After Stage 1, call `system.introspect` and inspect the JSON. If it's already overwhelming with two Extensions, the spec needs the "scoped introspect" feature mentioned in arch §14 Open Q #9 brought forward.

---

## 10. What Counts as Success

The PoC is successful **not** when a chat works in the demo Web UI.
It is successful when:

1. All five claims (H1–H5) survive their acceptance criteria.
2. The keystone test of Stage 2 passes: uninstalled Extensions, traces still readable.
3. The author docs (§8) can be written without saying "well, you can't actually do that yet" more than three times.
4. We have at least three concrete revisions to push back into `loom-studio-architecture.md` v0.4 — discovered, not predicted.

A PoC that makes no architecture revisions is a PoC that didn't actually probe anything.

---

## 11. What Comes After the PoC

This is **not** a Stage 3. The PoC is done at the end of Stage 2. What follows is a deliberate architectural pause:

- Update `loom-studio-architecture.md` to v0.4, integrating PoC findings.
- Integrate the post-PoC runtime-boundary decision: **Runtime / Provider / Tool / MCP are Extension Patterns, not Kernel Services**. The correct follow-up validation is a new Extension-level spike, not a Stage 3 of this Kernel PoC.
- Decide whether `packages/studio-poc/` should be promoted to `packages/studio/` (and possibly extracted to its own repo `loom-studio`), or kept as a frozen reference and Studio is rebuilt cleanly elsewhere.
- Decide whether the real `loom-studio-st` work begins inside this monorepo or in a sibling repo.
- Decide whether `passext-upper` and `st-mini` survive as ongoing examples or get retired.

Potential future spike, explicitly outside this sealed PoC:

- A Provider Extension spike: one OpenAI-compatible provider exposed purely as Extension RPC.
- A Runtime Extension spike: one chat or ReAct-style loop that calls `kernel.loom.run`, provider RPC, and tool RPC in a cycle.
- A Tool / MCP Extension spike: one MCP bridge exposed as Studio RPC.

These should validate `system.introspect` richness, streaming RPC framing, capability checks, and audit correlation (`parentCallId` / `correlationId`), not add new Kernel business concepts.

These are not PoC concerns. They are Stage-Pause concerns, to be argued separately when there's actual evidence to argue from.

---

## Appendix A — Mapping from Architecture Claims to Acceptance Tests

| Arch doc claim | Stage | Acceptance test |
|---|---|---|
| Tenet I — Kernel does less | All | Lint: Kernel exports no business concepts |
| Tenet II — Transport is the contract | 1 | Client B succeeds without any Studio import |
| Tenet III — Everything registered is discoverable | 1 | `system.introspect` enumerates all contributions |
| Tenet IV — Kernel runs pipelines, not sessions | 0 | Concurrent invocations + lint for session state |
| §5.2 SQLite as default backend | 0 | Document Store uses `better-sqlite3`; works |
| §5.6 Self-hosting via `system.*` types | 0 | Trace writes go through Document Store API |
| §6.5 LoomRunner is a thin wrapper | 0 | LoomRunner has no scheduling logic of its own |
| §6.6 system.introspect | 1 | Returns all DocTypes/Passes/RPCs |
| §7.4 Concept Stack form | 1 | st-mini works as one |
| §7.4 Pass-only Extension form | 1 | passext-upper works as one |
| §9.5 Per-invocation orchestration | 0 + 1 | No global state, three concurrent stacks coexist |
| §9.6 Stack interop | 2 | Client C's spliced invocation succeeds |
| §10 Self-contained traces | 2 | Keystone test |
| §10 Replay semantics | 2 | Replay command + version mismatch warning |

---

## Appendix B — Open Questions Surfaced by Writing This Plan

These are not architecture-doc Open Questions; they are PoC-only ones whose answers don't change the architecture but do affect implementation choices. Resolve before each stage starts.

1. **What WebSocket library?** Native Node `ws` is enough; do we want anything more?
2. **What JSON-RPC framing?** Plain JSON-RPC 2.0 or pick a library? Stage 0 decision.
3. **Does the demo Web UI live inside `studio-poc` or as a separate workspace package?** Affects how `npm run dev` is structured.
4. **Where does ST sample data physically live for the PoC?** Symlink `examples/st-real-data/`? Copy it? Decision affects fixture loading code.
5. **What's the cancellation semantics granularity?** Between Passes is the obvious answer; do we also try mid-Pass cancellation, or punt?
6. **Should `system.introspect` be paginated even at PoC scale?** Probably not, but the field needs to be reserved.
7. **How does `passext-upper` declare its dependence on `st-mini`** (if at all)? It might not — UpperCasePass is generic. Test with no declared dependency first.

---

*End of Loom Studio PoC Plan v0.1.*
