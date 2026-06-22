# Loom Studio MVP Scenario Test 计划

> **Date**: 2026-05-16  
> **Status**: Active  
> **Scope**: MVP Stage 0-5 后的白皮书场景验证  
> **Principle**: 测试用于暴露真实架构能力与缺口，不以“全部通过”为目标。

---

## 0. 测试规则

本阶段测试遵循以下规则：

1. **不为了通过而书写测试**
   - 测试应反映白皮书承诺、MVP 目标与真实使用场景。
   - 不因为当前实现缺失就降低断言。

2. **不第一时间修改源码**
   - 如果 scenario test 失败，先记录失败原因、影响范围和可能决策。
   - 只有确认是实现偏离且优先级足够高时，才进入修复任务。

3. **区分三类结果**
   - `PASS`: 当前 MVP 已支持。
   - `FAIL-BUG`: 文档/计划要求支持，但实现偏离。
   - `FAIL-DEFERRED`: 真实缺口，但属于已知延后能力。

4. **测试文件可以失败**
   - Scenario tests 是架构探针，不是 CI 绿灯装饰。
   - 失败本身是有价值的事实。

5. **测试发现必须记录**
   - 每次运行后记录：通过项、失败项、失败原因、建议处理方式。
   - 不把失败静默变成 skipped，除非明确标为 deferred 并写入计划。

---

## 1. 当前 MVP 可验证范围

当前 Stage 0-5 MVP 已具备：

```text
Client Bridge
  -> JSON-RPC transport envelope
  -> Kernel RPC registry
  -> Document Store
  -> Extension Host
  -> Loom Runner
  -> Trace/Audit Store
  -> Diagnostics Registry
  -> in-process EventBus
```

因此可以验证：

- Kernel public surface 与 namespace guard。
- Server Extension manifest / activation / runtime registration。
- Extension RPC ownership and introspection。
- Extension-to-extension RPC collaboration。
- Client Bridge 调用 Kernel / Extension / Document / Trace / Diagnostics。
- Document revision / tombstone / owner attribution / `docs.changed`。
- Loom Runner trace / diagnostics。
- forbidden Chat / Provider / Tool / MCP / `messages[]` guard。

---

## 2. 当前不可完整验证范围

以下白皮书能力当前只能记录缺口，不能要求 MVP 完整支持：

- Browser WebSocket/SSE event delivery。
- Third-party Client Extension sandbox / iframe / postMessage activation。
- SQLite persistent Document Store backend。
- Workspace Adapter / real file projection。
- Checkpoint / rollback / restore-as-new-version。
- Capability permission enforcement / security sandbox。
- Provider / Tool / MCP / Agent Runtime as product patterns。

---

## 3. 测试分层

建议新增：

```text
tests/scenarios/
  server-extension-scenarios.test.ts
  client-bridge-scenarios.test.ts
  document-trace-diagnostics.test.ts
  mvp-cross-system.test.ts
```

第一轮先写：

```text
tests/scenarios/mvp-whitepaper-scenarios.test.ts
```

集中验证最能打穿架构的场景。

---

## 4. 第一轮 Scenario Tests

### S1. Client -> Extension B -> Extension A -> Document -> Client readback

**目的**：验证多个 Server Extension 可以通过 RPC 协作，并由下游 Extension 写入 Document，最后被 Client 读取。

流程：

```text
Extension A: example.provider.getValue -> { value: 42 }
Extension B: example.consumer.compose
  -> ctx.rpc.call('example.provider.getValue')
  -> ctx.documents.write(...)
  -> return { documentId, value }
Client Bridge:
  -> system.introspect
  -> example.consumer.compose
  -> docs.get(documentId)
```

断言：

- `system.introspect` 能看到 A/B 的 extension RPC owner。
- Client 能调用 B。
- B 能通过 `ctx.rpc.call` 调 A。
- B 写入的 Document `ownerExtensionId = example.consumer`。
- `docs.changed` emitted。
- Client 能读回 Document。

预期：当前 MVP 应支持。

---

### S2. Manifest declared RPC missing should produce diagnostic

**目的**：验证白皮书中 Manifest declaration 与 runtime registration 的一致性检查。

流程：

```text
Manifest declares example.missingDeclared.echo
activate(ctx) 不注册该 RPC
activate success
extensions.getDiagnostics(example.missingDeclared)
```

断言：

- Extension state 不应简单视为完全 active，或至少产生 warning diagnostic。
- diagnostic 应指向 declared capability missing at runtime。

预期：当前实现可能失败。  
记录类型：如果失败，初步判定为 `FAIL-BUG` 或 `FAIL-DEFERRED`，需要根据 MVP lifecycle 文档确认。

---

### S3. Client-only data panel simulation

**目的**：验证“只有 client 端，但通过 Client Bridge 获取后端数据”的可行性。

流程：

```text
panelLoadData(bridge)
  -> docs.list
  -> diagnostics.list
  -> trace.list
```

断言：

- 不需要导入 Kernel / DocumentStore / ExtensionHost。
- 只通过 `ClientBridge.call` 获取数据。
- 能拿到 documents / diagnostics / traces。

预期：当前 MVP 应支持 headless simulation，但不代表 Client Extension sandbox 已实现。

---

### S4. Audit should record RPC activity

**目的**：验证白皮书中 audit facts 的成熟度。

流程：

```text
Client calls system.ping / docs.write / loom.run
audit.list
```

断言：

- audit list 应至少能反映一次 RPC 或 platform action。

预期：当前实现可能失败，因为 audit store 目前只是 append-only abstraction，尚未接入每次 RPC。  
记录类型：如果失败，初步判定为 `FAIL-DEFERRED`。

---

## 5. 结果记录格式

每轮运行后记录：

```md
## Run YYYY-MM-DD HH:mm

Command:

```text
pnpm test -- tests/scenarios/mvp-whitepaper-scenarios.test.ts
```

Result:

- S1: PASS / FAIL-BUG / FAIL-DEFERRED
- S2: PASS / FAIL-BUG / FAIL-DEFERRED
- S3: PASS / FAIL-BUG / FAIL-DEFERRED
- S4: PASS / FAIL-BUG / FAIL-DEFERRED

Findings:

1. ...

Decision:

- Do not change source yet.
- Record required follow-up.
```

---

## 6. 第一轮成功标准

第一轮不要求全部通过。

成功标准是：

1. 至少跑出真实结果。
2. 明确哪些白皮书能力当前已经支撑。
3. 明确哪些能力只是架构承诺但尚未实现。
4. 不为了测试通过而临时修改源码。

---

## 7. 后续优先级

如果第一轮暴露缺口，优先级建议：

1. **Declared capability missing diagnostics**：如果 lifecycle 文档明确要求 MVP 支持，应修实现。
2. **Audit integration**：如果要支撑权限/回滚/调试，应进入下一阶段。
3. **WebSocket/SSE event delivery**：支撑真实前端实时联动。
4. **Client Extension sandbox**：支撑真正 client-only plugin。
5. **SQLite persistence**：支撑真实项目数据。

---

## Run 2026-05-16 14:17

Command:

```text
pnpm test -- tests/scenarios/mvp-whitepaper-scenarios.test.ts
```

Result:

- S1: PASS
- S2: FAIL-BUG / needs decision
- S3: FAIL-TEST-ASSUMPTION / needs decision
- S4: FAIL-DEFERRED

Raw summary:

```text
1 test file failed
4 tests total
1 passed
3 failed
```

Findings:

1. **S1 passed**: 当前 MVP 支持 `Client -> Extension B -> Extension A -> Document -> Client readback`。
   - Extension A/B 可通过 RPC 协作。
   - Extension B 可写入 Document。
   - Document owner 正确记录为 `example.consumer`。
   - `docs.changed` event 已发出。
   - Client 可通过 Bridge 读回 Document。

2. **S2 failed**: Manifest 声明了 RPC，但 runtime 未注册时，Extension 仍被标记为 `active`，且没有 `extension.rpc_declared_but_not_registered` diagnostic。
   - 失败断言：`expected 'active' not to be 'active'`。
   - 这暴露当前 Host 只检查“runtime registered but undeclared”，没有检查“declared but not registered”。
   - 需要决策：这是 MVP lifecycle 文档要求的实现偏离，还是允许延后到更完整的 capability validation。

3. **S3 failed**: Client-only data panel simulation 能读取数据，但测试期望 diagnostics 为空；实际 diagnostics 中出现 `loom/cross-owner-write` warning。
   - 失败断言：`expected diagnostics.items to equal []`。
   - 这不是明显源码 bug。`uppercase` pass 修改了 owner 为 `input` 的 fragment，Core 正常产生 cross-owner warning。
   - 需要决策：测试应反映“panel 能读取 diagnostics”，而不是假设 diagnostics 为空。但按照本轮规则，先记录，不立即改测试。

4. **S4 failed**: 多次 RPC activity 后 `audit.list` 仍为空。
   - 失败断言：`expected 0 to be greater than 0`。
   - 当前 audit store 只是 append-only abstraction，Kernel RPC dispatch 尚未自动 append audit。
   - 初步判断为已知 deferred 能力，不应立即改源码。

Decision:

- 本轮不修改源码以追求通过。
- 本轮不立即修改测试断言。
- 先保留 failing scenario tests 作为架构探针。
- 下一步应人工决策：
  1. S2 是否进入修复队列；
  2. S3 是否修正测试预期以真实表达 diagnostics 可见性；
  3. S4 是否继续标为 deferred，还是升级为下一阶段 audit integration 任务。

---

## Run 2026-05-16 14:22

Command:

```text
pnpm test -- tests/scenarios/mvp-whitepaper-scenarios.test.ts
pnpm lint
pnpm test
pnpm build
```

Result:

- S1: PASS
- S2: PASS after implementation fix
- S3: PASS after test expectation correction
- S4: EXPECTED-FAIL / DEFERRED

Raw summary:

```text
Scenario test file: passed
Scenario tests: 3 passed | 1 expected fail
Full test suite: 7 files passed, 40 passed | 1 expected fail
lint: passed
build: passed
```

Changes made after Run 14:17 decision:

1. **S2 fixed in implementation**
   - Extension Host now checks declared RPCs that were not registered during activation.
   - Missing declared RPC produces diagnostic `extension.rpc_declared_but_not_registered`.
   - Extension becomes `degraded` instead of `active`.

2. **S3 corrected as test expectation**
   - The scenario now asserts diagnostics visibility instead of assuming diagnostics are empty.
   - The observed `loom/cross-owner-write` warning is treated as a real diagnostic produced by Loom Core owner tracking.

3. **S4 encoded as deferred expected-fail**
   - The test remains present as an architecture probe.
   - It is marked with `it.fails` because RPC audit activity is not implemented yet.
   - This keeps the missing audit integration visible without pretending it is supported.

Decision:

- S2 was an implementation gap against the lifecycle validation rule and has been fixed.
- S3 was a faulty assumption in the scenario test and has been corrected.
- S4 remains deferred; do not implement audit activity trail until RPC audit semantics, payload redaction, and correlation policy are designed.

---

## 第二轮 Scenario Tests: Document / Trace / Diagnostics

File:

```text
tests/scenarios/document-trace-diagnostics.test.ts
```

Scenarios:

- D1: Document revision lifecycle preserves history, tombstones deletes, and emits `docs.changed`.
- D2: Optimistic version conflict rejects stale writes and preserves current document.
- D3: `ownerExtensionId` filtering returns only documents owned by that extension.
- D4: `loom.run` trace is visible through `trace.list` and is not stored as a normal document.
- D5: Diagnostics from `loom.run` are queryable and emit `diagnostics.updated`.

---

## Run 2026-05-16 14:30

Command:

```text
pnpm test -- tests/scenarios/document-trace-diagnostics.test.ts
```

Result:

- D1: PASS
- D2: PASS
- D3: PASS
- D4: PASS
- D5: PASS

Raw summary:

```text
1 test file passed
5 tests passed
```

Findings:

1. **D1 passed**: In-memory Document Store supports the MVP revision/tombstone lifecycle.
   - Version 1 historical read works.
   - Current version after update is version 2.
   - Delete creates version 3 tombstone.
   - Normal `docs.get` hides tombstone by default.
   - `includeTombstone` exposes deleted document.
   - Three `docs.changed` events were emitted for create/update/delete.

2. **D2 passed**: Optimistic version conflict protects the current document.
   - Stale `expectedVersion: 999` fails.
   - Existing content remains unchanged.

3. **D3 passed**: `ownerExtensionId` filtering works at Document Store / `docs.list` level.
   - Documents owned by `example.ownerA` and `example.ownerB` can be separated.

4. **D4 passed**: Trace is visible through `trace.list` and is not stored as a normal `system.trace` Document.
   - This matches current Stage 5 design: trace/audit store is append-only facts, separate from normal documents.

5. **D5 passed**: Loom diagnostics are queryable and emit `diagnostics.updated`.
   - Missing pass produces `loom/factory-missing` from `loom-runner`.
   - `diagnostics.updated` event emits once.

Decision:

- No source change needed for this round.
- Current MVP supports Document revision/tombstone semantics, trace visibility, diagnostics visibility, and related in-process events.
- Persistence, rollback/checkpoint, and browser event delivery remain outside this test's scope.

---

## 第三轮 Scenario Tests: Client Bridge / Frontend Data Flow

File:

```text
tests/scenarios/client-bridge-scenarios.test.ts
```

Scenarios:

- C1: Client Bridge preserves JSON-RPC request source metadata and monotonic request ids.
- C2: Client-only dashboard reads documents, diagnostics, traces, and extension summaries through ClientBridge only.
- C3: Client Bridge surfaces missing method errors and remains usable afterward.
- C4: `disconnect()` marks the bridge disconnected but does not prevent later HTTP calls.
- C5: Client Bridge should expose response metadata for correlation-aware UI diagnostics.

---

## Run 2026-05-16 14:51

Command:

```text
pnpm test -- tests/scenarios/client-bridge-scenarios.test.ts
```

Result:

- C1: PASS
- C2: PASS
- C3: PASS
- C4: PASS / semantic caveat
- C5: FAIL-BUG / needs decision

Raw summary:

```text
1 test file failed
5 tests total
4 passed
1 failed
```

Findings:

1. **C1 passed**: Client Bridge sends `source` metadata and uses monotonic request ids.
   - Calls used `client-1`, `client-2`.
   - Request metadata preserved `source: scenario-client`.

2. **C2 passed**: A client-only dashboard simulation can read platform state through Client Bridge only.
   - It reads documents, diagnostics, traces, and extension summaries.
   - This validates the non-sandboxed headless version of “client-only but reads backend data”.

3. **C3 passed**: Missing RPC method errors surface to the client, and the bridge remains usable afterward.

4. **C4 passed with semantic caveat**: `disconnect()` changes state to `disconnected`, but HTTP calls still work afterward.
   - This reflects the current HTTP stateless bridge.
   - If future WebSocket mode treats disconnect as transport closure, this behavior may need a mode-specific contract.

5. **C5 failed**: `bridge.call()` unwraps `response.result` and discards `response.meta`.
   - Failure: `result.meta` is undefined.
   - This blocks correlation-aware UI diagnostics if the UI uses only `call()`.
   - Low-level `request()` still exposes meta, but the ergonomic `call()` path does not.

Decision:

- Do not modify source immediately in this run.
- C5 is likely a real Client Bridge API gap, not a deferred platform feature.
- Need decision: add a `callWithMeta()` / `callEnvelope()` API, or change `call()` return shape. Prefer additive API to avoid breaking existing callers.

---

## Run 2026-05-16 15:07

Command:

```text
pnpm test -- tests/scenarios/client-bridge-scenarios.test.ts
pnpm lint
pnpm test
pnpm build
```

Result:

- C1: PASS
- C2: PASS
- C3: PASS
- C4: PASS / semantic caveat unchanged
- C5: PASS after additive API fix

Raw summary:

```text
Client Bridge scenario file: passed, 5 tests passed
Full suite: 9 files passed, 50 passed | 1 expected fail
lint: passed
build: passed
```

Changes made after Run 14:51 decision:

1. **Added `ClientBridge.callWithMeta()`**
   - `call()` remains unchanged and still unwraps `response.result`.
   - `callWithMeta()` returns `{ result, meta }` for correlation-aware UI diagnostics.
   - This avoids breaking existing callers while exposing transport response metadata.

2. **Updated C5**
   - C5 now validates `callWithMeta('system.ping')` exposes `correlationId` and `callId`.

Decision:

- C5 was a real Client Bridge API gap and is now fixed through an additive API.
- C4 remains a semantic caveat: HTTP stateless bridge permits calls after `disconnect()`. Revisit when WebSocket mode is introduced.

---

## 第四轮 Scenario Tests: JSON Communication Performance Probes

File:

```text
tests/scenarios/json-communication-performance.test.ts
```

Purpose:

- Measure current JSON control-plane communication baseline.
- Do not test binary/multimedia payloads in this round.
- Do not use strict timing thresholds; record observed facts only.

Scenarios:

- P1: 100 sequential `system.ping` calls through Client Bridge.
- P2: 100 sequential small JSON `docs.write` calls.
- P3: 128KiB JSON `docs.write` + `docs.get` round trip.
- P4: `docs.list` pagination over 500 small JSON documents, 50 per page.

---

## Run 2026-05-16 15:26

Command:

```text
pnpm test -- tests/scenarios/json-communication-performance.test.ts --reporter verbose
```

Result:

- P1: PASS
- P2: PASS
- P3: PASS
- P4: PASS

Raw summary:

```text
1 test file passed
4 tests passed
```

Observed measurements on this machine:

```text
P1 100 sequential system.ping:
  total=16.68ms avg=0.17ms p95=0.18ms max=12.22ms

P2 100 sequential small docs.write:
  total=5.86ms avg=0.06ms p95=0.13ms max=0.99ms

P3 1 medium docs.write 128KiB JSON:
  total=1.10ms avg=1.10ms p95=1.10ms max=1.10ms

P3 1 medium docs.get 128KiB JSON:
  total=1.08ms avg=1.08ms p95=1.07ms max=1.07ms

P4 docs.list 500 docs in pages of 50:
  total=2.79ms avg=0.28ms p95=0.39ms max=0.39ms
```

Interpretation:

1. These numbers measure an in-memory fetch adapter, not real browser-to-server network performance.
2. They are useful as a lower-bound JSON serialization / Kernel dispatch / in-memory store baseline.
3. Current JSON control-plane performance is sufficient for MVP-scale metadata, diagnostics, trace summaries, and normal document operations.
4. The measurements do not justify storing binary/multimedia payloads in JSON-RPC or `DocumentRecord.content`.
5. Multimedia/binary payload design is deferred to `docs/adr/ADR-003-asset-store-and-binary-payload-boundary.md`.

Decision:

- Keep JSON communication performance probes as non-strict baseline tests.
- Do not introduce timing thresholds into normal CI yet.
- Do not test image/base64 payloads until Asset Store design exists.
