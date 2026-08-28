# Loom Studio Trace / Audit / Correlation v0

> **Status**: Draft v0.1（第一批工程约束，2026-05-13）
> **Purpose**: 定义 Studio MVP 中 request、RPC、Document changeset、Loom run、Trace 与 Audit 之间的 id 关系和事实记录边界。
> **Audience**: Kernel、Transport、Extension Host、Document Store、Loom Runner、DevTool 实现者。
> **Related**: [`docs/architecture/kernel/`](../../../architecture/kernel/), [`studio-document-store-engineering-v0.md`](studio-document-store-engineering-v0.md)

---

## 0. 成功标准

MVP 完成后，应能回答：

1. 某个 UI 操作触发了哪些 RPC？
2. 某个 Extension RPC 又调用了哪些下游 RPC？
3. 某次 `loom.run` 产生了哪个 Trace？
4. 某次 Document write 属于哪个 changeset？
5. 某个 changeset 来自哪个 request / call chain？
6. 某个外部副作用为什么不能 rollback，只能 audit？
7. project restore 后，旧 Trace / Audit 为什么仍然保留？

---

## 1. ID Taxonomy

| ID | Scope | 生成方 | 作用 |
|---|---|---|---|
| `requestId` | Transport request | Client | 匹配一次 request / response |
| `clientId` | Client connection/session | Kernel Transport | 标识连接或窗口会话 |
| `correlationId` | High-level user operation | Client or Kernel | 串联一次用户操作链路 |
| `callId` | RPC / internal call | Kernel / Host | 标识一次调用事实 |
| `parentCallId` | Nested call | Caller | 标识父调用 |
| `traceId` | Loom run trace | Loom Runner | 标识一次 Core run trace document/fact |
| `changesetId` | Document commit | Document Store | 标识一组 document revisions |
| `auditId` | Audit fact | Audit Store | 标识一条审计事实 |

核心判断：

```text
requestId is transport matching.
correlationId is user-intent chain.
callId is execution fact.
changesetId is document commit fact.
traceId is loom.run fact.
auditId is external/privileged/action fact.
```

---

## 2. Request / Correlation Rules

入口 request：

```text
client sends request(id=req-1, meta.correlationId?)
  -> Kernel assigns clientId
  -> Kernel creates correlationId if missing
  -> Kernel creates callId for handler execution
```

规则：

- `requestId` 必须由 client 生成；
- `clientId` 必须由 server 注入，不能信任 client 自报；
- `correlationId` 可由 client 提供，用于把多次 request 合并为一次 UI 操作；
- 未提供时 Kernel 为该入口 request 生成；
- `requestId` 不应用作业务 id、幂等 id 或 audit id。

---

## 3. Nested RPC Rules

Extension handler 内部调用其他 RPC：

```text
callId=A handles official.runtime.run
  -> ctx.rpc.call('official.provider.openai.invoke')
      correlationId = same as A
      parentCallId = A
      callId = B
```

规则：

- 下游调用继承 `correlationId`；
- 下游调用设置 `parentCallId`；
- 每次 RPC dispatch 生成新的 `callId`；
- handler throw 仍然产生 call fact 和 audit/diagnostic 关联；
- Extension 不能伪造其他 Extension 的 `callId`，只能传递自己当前 context 中的 parent。

---

## 4. Document Changeset Correlation

Document write 必须记录：

```ts
type ChangesetCorrelation = {
  correlationId?: string
  callId?: string
  parentCallId?: string
  requestId?: string
  clientId?: string
}
```

规则：

- 单次 write 可以生成一个 changeset；
- transaction 内多个 write/delete 合并成一个 changeset；
- changeset 记录当前 call context；
- `docs.changed` event 必须携带 `changesetId` 与 correlation meta；
- restore-as-new-version 也生成新的 changeset。

示例链路：

```text
req-10 / corr-edit-character
  -> call-1 docs.write
      -> changeset chg-1
      -> docs.changed(event, chg-1, corr-edit-character, call-1)
```

---

## 5. Loom Run Trace Correlation

`loom.run` 是 Kernel 暴露的通用 Core Runner 能力，不是 Chat Runtime。

一次 `loom.run`：

```text
request / extension call
  -> loom.run handler callId=A
  -> Core executes Fragment[] + PassConfig[]
  -> Loom Runner stores traceId=T
  -> optional Document writes create changeset=C
  -> response includes traceId and optional changesetId
```

Trace record 最小形状：

```ts
type LoomRunTraceRecord = {
  traceId: string
  createdAt: string
  correlationId?: string
  callId: string
  parentCallId?: string
  inputSummary: unknown
  outputSummary: unknown
  coreTrace: unknown
}
```

规则：

- Trace 是事实，append-only；
- Trace 不参与 document rollback；
- 如果 project restore 到旧 document state，旧 trace 仍然存在；
- Trace 可以引用 input document versions 和 output changeset；
- Core 的 mutation trace 不等于 Studio Audit。

---

## 6. Audit Facts

Audit 记录 privileged、external、destructive 或 side-effectful actions。

最小形状：

```ts
type AuditEntry = {
  auditId: string
  createdAt: string
  action: string
  actor: ActorRef
  target?: AuditTarget
  outcome: 'success' | 'failure'
  correlationId?: string
  callId?: string
  parentCallId?: string
  requestId?: string
  clientId?: string
  details?: unknown
}

type AuditTarget = {
  kind: string
  id?: string
  type?: string
}
```

应记录 audit 的行为：

- Extension activation failure / disable；
- permission denial；
- external provider call；
- tool call；
- file system import/export；
- project restore；
- document delete；
- credential access attempt；
- capability registration mismatch in installed mode。

规则：

- Audit append-only；
- Audit 不参与 rollback；
- 外部副作用只能 audit，不能由 Kernel 回滚；
- failure 也应记录 audit，如果动作已越过权限或外部边界。

---

## 7. Restore and Rollback Boundary

回滚时：

```text
restore checkpoint
  -> create new changeset chg-restore
  -> create new document revisions
  -> emit docs.changed
  -> append audit(project.restore)
  -> keep old traces
  -> keep old audit entries
```

禁止：

- 删除旧 changesets；
- 删除旧 revisions；
- 删除旧 traces；
- 删除旧 audit entries；
- 伪造旧 timestamp；
- 把 external provider/tool side effects 当作可回滚状态。

这保证 Studio 历史是可解释的，而不是被“倒带”成不可审计状态。

---

## 8. Diagnostics Correlation

Diagnostic 也应记录 correlation 信息：

```ts
type DiagnosticCorrelation = {
  correlationId?: string
  callId?: string
  parentCallId?: string
  requestId?: string
  clientId?: string
  extensionId?: string
}
```

常见 diagnostics：

- manifest parse failed；
- activation failed；
- duplicate rpc registration；
- unknown method；
- document conflict；
- workspace import invalid；
- loom pass not found；
- handler throw。

Diagnostics 可以被清理或替换；Audit / Trace 不可以。Diagnostics 是当前可操作问题视图，不是永久事实账本。

---

## 9. DevTool View

DevTool 可以按 `correlationId` 展示：

```text
Correlation corr-123
  request req-1 from client window-1
    call call-1 docs.write
      changeset chg-1
      event docs.changed evt-1
    call call-2 loom.run
      trace trace-1
      changeset chg-2
    audit audit-1 project.restore success
```

按 `callId` 展示嵌套：

```text
call-A official.runtime.run
  call-B official.provider.openai.invoke
  call-C docs.write
```

按 `changesetId` 展示：

```text
changeset chg-1
  operation update doc character:alice v2 -> v3
  correlation corr-edit
  call call-doc-write
  emitted docs.changed evt-10
```

---

## 10. Failure Policy

### 10.1 Trace write failure

如果 `loom.run` 成功但 trace persist 失败：

- response 应包含 warning diagnostic；
- audit 应记录 `trace.persist_failed`；
- 默认不让 `loom.run` 整体失败，保持 observability 不阻塞业务返回；
- 测试 / 开发模式可以使用同步 flush，以便断言 trace 已落盘；
- 只有 caller 显式启用 strict persist option 时，trace persist failure 才能使 `loom.run` 失败。

### 10.2 Audit write failure

Audit write failure 是严重错误。

MVP 策略：

- 对 external side effect 前的 audit preflight 失败：阻止动作；
- 对 side effect 后 audit persist 失败：返回 error，写入 diagnostics，并尽力写 fallback local log；
- 不假装外部动作未发生。

### 10.3 Event publish failure

Document commit 成功但 event publish 失败：

- 不回滚已提交 document；
- 写 diagnostic；
- audit 可记录 event delivery failure；
- DevTool 可提示 refresh/reindex。

---

## 11. Non-Goals

本文不定义：

- 完整 audit storage schema；
- trace viewer UI；
- distributed tracing standard；
- OpenTelemetry adapter；
- provider-specific audit payload；
- tool call protocol；
- agent runtime timeline；
- chat session history schema；
- multi-user collaboration log。

---

## 12. Document History

- 2026-05-13: Draft v0.1. 定义 request/client/correlation/call/trace/changeset/audit id 关系、rollback 边界与 DevTool 视图。
