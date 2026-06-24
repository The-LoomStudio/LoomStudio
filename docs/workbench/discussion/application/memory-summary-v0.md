# Memory / Summary v0

> **状态**：Open Design  
> **主题**：Memory 和 Summary 作为 Agent 的写操作，伴随截断以前的内容。

---

## 1. 核心判断

Memory / Summary 不需要被提高化与升华化。

它就是 Agent 的一个写操作，伴随着截断以前的内容。

```text
Memory write:
  Agent 把某些内容写入记忆。
  可能截断或替换以前的记忆内容。

Summary write:
  Agent 生成一段摘要。
  替换或压缩之前的长内容。
```

它们不是独立基础设施层，而是 Agent 的写操作在 Memory / Summary 这一领域对象上的表现。

---

## 2. Memory 是什么

Memory 是 Setting Layer 中的一类内容，用于保存 Agent 需要跨 run 访问的信息。

```text
Memory 可能包含:
  - 长期记忆（角色关系、世界状态、历史事件）
  - 短期记忆（当前场景、最近交互要点）
  - Agent 工作记忆（计划、待办、中间结论）
```

Memory 存储在 Setting Layer，但它的写入和截断是 Agent 行为。

---

## 3. Summary 是什么

Summary 是对较长内容的压缩表示。

```text
Summary 可能用于:
  - 剧情摘要（压缩 Narrative Timeline）
  - Agent 工作摘要（压缩 Runtime Transcript）
  - 设定摘要（压缩大量 Setting entries）
  - 记忆压缩（整合多条 Memory entries）
```

Summary 的生成是 Agent 写操作。Summary 可能替换之前的长内容。

---

## 4. 写操作 + 截断

Memory 和 Summary 的核心特征是：写入新内容时可能截断旧内容。

```text
Agent write memory:
  -> 生成新记忆内容
  -> 调用 memory_write tool / state mutation API
  -> 可能指定截断策略:
     - append: 追加，不截断
     - replace: 替换指定旧内容
     - truncate-before: 截断某个时间点之前的内容
     - compress: 压缩旧内容为摘要，保留新内容
```

截断策略是 Agent 行为的一部分，不是 Setting Layer 的内建能力。

---

## 5. 与 Setting Layer 的关系

Memory / Summary 的 canonical data 存储在 Setting Layer。

```text
Setting Layer:
  存储 memory entries / summary entries。
  提供查询和投影能力。
  管理可见性和生命周期。

Memory / Summary 行为:
  写入和截断是 Agent 操作。
  通过 Tool / State Mutation API 执行。
  遵循 Permission / Consent 策略。
```

Setting Layer 不自动压缩、自动摘要或自动遗忘。这些是 Agent 的主动行为。

---

## 6. 与 Agent 的关系

Memory write 和 Summary write 是 Agent 的写操作。

```text
Agent 运行中:
  -> 判断需要更新记忆
  -> 调用 memory_write tool
  -> Permission 检查
  -> 写入 Setting Layer
  -> 可能截断旧内容
  -> Trace 记录

Agent 运行中:
  -> 判断需要生成摘要
  -> 调用 summary_write tool
  -> Permission 检查
  -> 写入 Setting Layer
  -> 可能替换长内容
  -> Trace 记录
```

---

## 7. 与 Prompt Builder 的关系

Memory 和 Summary 是 Prompt Builder 的输入来源之一。

```text
Prompt Builder 可以消费:
  - Memory entries（通过 Setting Layer projection）
  - Summary entries（通过 Setting Layer projection）
  - Agent search result（包含命中的 memory / summary）

Prompt Builder 不决定:
  - 何时生成记忆
  - 何时生成摘要
  - 截断什么内容
  - 记忆的生命周期
```

---

## 8. M0 候选

M0 可能只需要：

```text
Memory:
  Agent 可以写入记忆。
  记忆存储在 Setting Layer。
  记忆可被 search tool 检索。

Summary:
  延后。M0 不自动生成摘要。
  如果需要，由 Card 作者手动提供。
```

---

## 9. 非目标

本文件不定义：

- 完整 Memory schema；
- 自动摘要引擎；
- 向量化记忆检索；
- 遗忘策略框架；
- Memory 与 provider long-term memory 的映射；
- 跨 Session 记忆共享。

---

## 10. 开放问题

1. Memory write 是否需要用户确认？
2. 截断策略由 Agent 决定还是由 Policy 决定？
3. 被截断的内容是否保留 audit trail？
4. Memory entries 是否有大小限制？
5. Summary 生成是否需要专门 Tool，还是 memory_write 的特殊参数？
6. Memory 和 State 的边界：情绪值是 state 还是 memory？
7. 多 Agent 是否共享 Memory？如果共享，写入冲突如何处理？
