# Runtime Boundary v0

> **状态**：从 ADR-005 迁移 / 开放设计  
> **来源**：[`../adr/ADR-005-official-concept-stack-open-design.md`](../../adr/ADR-005-official-concept-stack-open-design.md)

---

## CS-7：Runtime Boundary

> 2026-05-26 讨论补充：Runtime 的内部模型已拆出到 [`airp-runtime-model-v0.md`](airp-runtime-model-v0.md)。本文只保留 Studio Application / Runtime / Provider / Security / Kernel 的高层边界。

### 13.1 问题

Studio Application 不能悄悄变成 Kernel，也不能把 Runtime / Provider / Security 的职责吞进同一个单体。

候选边界：

```text
Studio Application:
  owns AIRP documents and composition
  compose(context) -> compiled prompt payload

AIRP Runtime package:
  owns run / loop orchestration
  owns runtime transcript and output commit policy
  may call airp.compose multiple times
  may call provider / tool / state mutation APIs

Provider Adapter Extension:
  owns provider request mapping and API call
```

早期 `sendMessage(sessionId, input)` 只适合描述简单 chat turn。默认 AIRP runtime 可能是 agentic loop，因此本文不再把 `sendMessage` 视为唯一 runtime 形态。

### 13.2 开放问题

- `compose` 是否写入 Documents？
- `compose` 是否总是产生 Trace？
- `compose` 返回 messages-like payload、fragments，还是两者都返回？
- Runtime 选择 Provider，还是 Session 选择 Provider？
- Studio AIRP composition 是否知道 Provider profile？候选答案：不直接知道。
- streaming events 归谁所有？
- tool-call loops 归谁所有？候选答案：AIRP Runtime。
- response post-processing 归谁所有？
- Runtime Transcript 和 Narrative Timeline 如何分离？见 [`airp-runtime-model-v0.md`](airp-runtime-model-v0.md)。
- 剧情文本是由 commit tool / Runtime API 写入，还是允许普通 assistant message 自动落盘？候选答案：不允许自动落盘。

### 13.3 候选方向

```text
Studio Application owns AIRP domain documents and composition.
AIRP Runtime package owns run / loop orchestration, runtime transcript, tool dispatch and output commit policy.
Provider Adapter Extension owns provider request mapping and API call.
Security owns secrets.
Kernel owns platform capability.
```

`AIRP Runtime package` 可以是 Studio 第一方内建 package，不必是 ordinary extension。Provider adapters、importers、tools 和模型特定 payload adapters 仍适合 extension 化。
