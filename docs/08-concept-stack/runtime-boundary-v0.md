# Runtime Boundary v0

> **状态**：从 ADR-005 迁移 / 开放设计  
> **来源**：[`../adr/ADR-005-official-concept-stack-open-design.md`](../adr/ADR-005-official-concept-stack-open-design.md)

---

## CS-7：Runtime Boundary

### 13.1 问题

Concept Stack 不能悄悄变成 Chat Runtime。

候选边界：

```text
Concept Stack:
  compose(sessionId) -> compiled prompt payload

Chat Runtime:
  sendMessage(sessionId, input)
    -> append user message
    -> concept.compose
    -> provider.invoke
    -> append assistant message
```

### 13.2 开放问题

- `compose` 是否写入 Documents？
- `compose` 是否总是产生 Trace？
- `compose` 返回 messages-like payload、fragments，还是两者都返回？
- Runtime 选择 Provider，还是 Session 选择 Provider？
- Concept Stack 是否知道 Provider profile？候选答案：不知道。
- streaming events 归谁所有？
- tool-call loops 归谁所有？
- response post-processing 归谁所有？

### 13.3 候选方向

```text
Concept Stack owns composition.
Runtime owns loop.
Provider owns API call.
Security owns secrets.
Kernel owns platform capability.
```
