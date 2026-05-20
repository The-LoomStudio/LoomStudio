# Runtime Boundary v0

> **状态**：从 ADR-005 迁移 / 开放设计  
> **来源**：[`../adr/ADR-005-official-concept-stack-open-design.md`](../adr/ADR-005-official-concept-stack-open-design.md)

---

## CS-7：Runtime Boundary

### 13.1 问题

Studio Application 不能悄悄变成 Kernel，也不能把 Provider / Security 的职责吞进同一个单体。

候选边界：

```text
Studio Application:
  compose(sessionId) -> compiled prompt payload

AIRP Runtime package:
  sendMessage(sessionId, input)
    -> append user message
    -> airp.compose
    -> provider.invoke
    -> append assistant message
```

### 13.2 开放问题

- `compose` 是否写入 Documents？
- `compose` 是否总是产生 Trace？
- `compose` 返回 messages-like payload、fragments，还是两者都返回？
- Runtime 选择 Provider，还是 Session 选择 Provider？
- Studio AIRP composition 是否知道 Provider profile？候选答案：不直接知道。
- streaming events 归谁所有？
- tool-call loops 归谁所有？
- response post-processing 归谁所有？

### 13.3 候选方向

```text
Studio Application owns AIRP domain documents and composition.
AIRP Runtime package owns sendMessage loop.
Provider Adapter Extension owns provider request mapping and API call.
Security owns secrets.
Kernel owns platform capability.
```

`AIRP Runtime package` 可以是 Studio 第一方内建 package，不必是 ordinary extension。Provider adapters、importers、tools 和模型特定 payload adapters 仍适合 extension 化。
