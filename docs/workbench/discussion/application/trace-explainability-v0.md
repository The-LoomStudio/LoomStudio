# Trace / 可解释性 v0

> **状态**：从 ADR-005 迁移 / 开放设计  
> **来源**：[`../adr/ADR-005-official-concept-stack-open-design.md`](../../adr/ADR-005-official-concept-stack-open-design.md)

---

## CS-10：Trace / 可解释性

### 16.1 问题

Studio Application 必须让 prompt construction 可解释。

用户应该能够回答：

- 哪些 skeleton slots / clusters 贡献了 prompt？
- 哪些 setting entries 被激活或被选中？
- 哪些 entries 没有激活或没有被选中，原因是什么？
- 为什么这个 fragment 被排在这里？
- 哪个 Document 产生了这段输出文本？
- budget policy 裁剪了什么？
- 哪些 mutable setting / state facts 被选中？

### 16.2 开放问题

- Trace 应该存储多少 raw prompt content？
- inactive entries 是否默认出现在 Trace 中？
- activation failures 应该是 Diagnostics，还是 trace annotations？
- 如何展示 ordering reasons？
- 如何对 sensitive content 做 redaction？
- 如何把 output payload segments 链接回 source Documents？

### 16.3 候选方向

AIRP composition fragments 应包含 source metadata：

```ts
type ConceptFragmentMeta = {
  airpKind: string
  sourceDocumentId: string
  sourceField?: string
  slot?: string
  priority?: number
  activation?: {
    active: boolean
    reason?: string
  }
}
```

这些 metadata 属于 Application conventions，不属于 Loom Core schema。
