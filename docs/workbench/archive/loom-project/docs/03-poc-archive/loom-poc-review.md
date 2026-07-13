# Loom POC 回顾报告

## 1. 核心问题解答

### Q1：极简 DataFragment 够用吗？
**结论：够用，且非常灵活。**
在实现 `DedupById` 和 `SortByPriority` 时，所有的业务逻辑都可以通过 `meta` 字段完美承载。`id` 字段作为主键在去重逻辑中表现稳定。目前的 `{ id, content, meta }` 结构确实是最小且完整的。

### Q2：Pass 的签名能统一同步和异步吗？
**结论：可以。**
通过 `ResolvedFragment[] | Promise<ResolvedFragment[]>` 的联合签名，并在 Pipeline runtime 中使用 `await pass.run(...)`，我们成功实现了同步和异步 Pass 的无缝混用。开发者在编写同步逻辑时不需要被迫使用 `async` 关键字。

### Q3：Lazy content 的三态（`string | Promise<string> | () => Promise<string>`）值得吗？
**结论：值得，尤其是第三种（thunk）。**
Thunk 允许我们在 Pipeline 真正开始之前不触发任何副作用（例如 HTTP 请求）。在 `resolution.ts` 中，我们统一处理了这三种状态。对于需要按需加载大量上下文的场景，这种灵活性是必要的。

### Q4：Pipeline 的快照机制以什么形态存在？
**结论：内存中的只读引用数组。**
目前每个 Pass 结束后，Pipeline 会记录一个 `PipelineSnapshot`。由于我们约定 Pass 不应修改输入的 `fragments` 数组及其对象（虽然 POC 阶段只靠 TS `readonly` 约束，未强制 `structuredClone`），直接持有引用在性能上是非常优越的。

### Q5：TS 泛型 `M` 的传播在真实代码里能不能忍？
**结论：完全能忍，甚至带来了极好的 DX。**
在 `examples/basic/index.ts` 中，用户只需定义一次 `pipeline<StdMeta>(...)`，后续所有的 Pass 和返回结果都能自动获得类型提示。这不仅不“刺眼”，反而减少了强制类型转换的需要。

### Q6：Stdlib 真的能和 Core 分开吗？
**结论：可以。**
`@loom/stdlib` 仅作为 `@loom/core` 的消费者存在。Core 完全感知不到 `StdMeta` 或 `DedupById` 的存在。这种物理隔离验证了我们三层架构中 Layer 1 和 Layer 2 的关系。

### Q7：最小端到端的开发者体验有多痛？
**结论：体验非常流畅。**
一个完整的 Example 仅用了不到 40 行代码。用户只需定义数据、定义 Pass、运行 Pipeline。没有复杂的配置和繁琐的生命周期钩子，符合“织机”的直觉。

## 2. 发现的问题与改进建议

1. **id 冲突校验**：目前的 Pipeline 尚未强制在 Pass 产出后校验 id 唯一性（虽然 Plan 提到要挑战后加入，但 POC 实现中为了保持 KISS 暂时跳过了）。建议在 v0.1 正式版中加入可选的校验。
2. **错误包装**：`LoomError` 目前比较简陋。在复杂 Pass 链中，需要更清晰的堆栈追踪。
3. **并发控制**：`resolveFragments` 目前是全量并发（`Promise.all`）。如果 input 中有数百个延迟加载的 fragment，可能会瞬间打满带宽/连接数，需要限流机制。

## 3. 下一步建议

**结论：通过。**
POC 证明了白皮书中的核心设计决策是成立的。建议立即进入 v0.1 正式开发阶段。
