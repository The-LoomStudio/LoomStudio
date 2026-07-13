# ADR-005: PassRegistry 改造为工厂函数注册 + Payload 配置化

- **Status**: Accepted
- **Date**: 2026-04-29
- **Promoted from**: [ADR-C-005](../loom-adr-candidates.md#adr-c-005-运行时参数与静态-registry-的冲突)

## Context

`@loom/st` 合流测试暴露：真场景下大多数 Source Pass（如 `LoadChat`、`LoadCharacterCard`、`LoadPreset`）依赖**运行期数据**（chatId、character JSON 等）。原 `PassRegistry` 设计为只能注册实例化好的 `Pass` 对象，导致这些 Pass 无法作为全局共享组件在 Kernel 注册——只能由客户端本地实例化后传入 fragments，等于"配置化流水线声明"这条价值线断掉。

PoC 的 Spike 已验证可行性：
- `PassRegistry` 改为支持 `(name, factory: (params) => Pass)` 注册。
- 客户端通过 `{ name: 'ST.LoadChat', params: { chat: [...] } }` 声明，Kernel 在 dispatch 时调用 factory 实例化。
- ST.LoadChat 的数据组装逻辑留在客户端（params 准备），执行逻辑留在服务端（factory 内部），双方职责清晰。

这是七个 ADR 中**唯一一个"该让 Core 多做一点事"的情况**。其余六个都在做减法，只有这个在做加法。

## Decision

**采纳 Spike 方案（A 路线）**：彻底改造正式版 `PassRegistry`，支持注册工厂函数，`loom.run` 接受配置对象。

具体规格：

```ts
// 注册
interface PassFactory<P = unknown, M = unknown> {
  readonly name: string
  create(params: P): Pass<M>
}

PassRegistry.register(factory: PassFactory)

// 调度
loom.run({
  passes: [
    { name: 'ST.LoadChat', params: { chatId: 'abc' } },
    { name: 'ST.LoadCharacterCard', params: { cardId: 'mika' } },
    { name: 'ST.ActivateWorldInfo' },                       // 无 params
    { name: 'ST.OrderByPosition' },
    { name: 'ST.FlattenToMessages' },
  ],
  fragments: [],   // 多数场景从空开始，由 Source Pass 灌入
})
```

约束：

1. **factory 必须是纯函数**：相同 params 必须产出行为相同的 Pass；这保证 trace 可重放。
2. **params 必须可 JSON 序列化**：trace 写入 params 完整快照，DevTool 可重放任意一次 `loom.run`。
3. **factory 在 Kernel 上下文中执行**：通过 Plugin Host 沙箱保证，与普通 Extension 代码同等隔离级别。
4. **保留无参 Pass 的简洁性**：`{ name: 'ST.OrderByPosition' }` 等价于 `{ name, params: undefined }`，factory 可忽略 params。

## Consequences

- **正面**：
  - 配置化流水线声明从理论变成实践，Pipeline 可被 JSON 化、可被远程调度。
  - Pass 作者发布的 Pass 多数会变成"工厂 + Zod schema"形态，schema 可被 DevTool 自动渲染为表单。
  - 客户端从"自跑 LoadChat 生成 fragments"简化为"声明 `{ name, params }`"——这是 Loom 最有商业价值的抽象之一。
  - Trace 重放能力大幅增强（params 已序列化，整次 `loom.run` 可纯函数式重跑）。
- **负面 / 已知缺口**：
  - 安全面：factory 在 Kernel 上下文执行，必须依赖 Plugin Host 沙箱隔离恶意 factory。这把信任边界从"Pass 实例"前移到"factory 代码"。
  - 类型推导：`loom.run({ passes: [{name, params}] })` 的 params 类型推导需要 PassRegistry 维护类型映射；这是 TS 工程量。
  - 与 ADR-007（移除 barrier）共同实施时，需要确保 factory 同步返回的 Pass 也是同步 `run()`。

## Alternatives Considered

- **B. 保持现状，让 Source Pass 彻底不进 Registry，全由客户端本地跑完生成 Fragments**：
  - 拒绝原因：让生态丢失 Loom 最大的抽象——配置化流水线。Pass 作者无法发布 Source Pass 给社区共享。

## Implementation Notes

- v0.1 最终 API 使用 `PassFactory` 对象：`{ name, create(params) }`。
- `PassRegistry.register(factory)` 通过 `factory.name` 注册全局唯一键。
- `register(name, factoryFn)` 是 Spike 阶段语法，已被 v0.1 API 取代。
- 旧实例注册语法糖不进入当前 Alpha，除非后续另起 ADR 明确加入。
- `loom.run` 接受 `RunConfig { passes: PassConfig[], fragments: Fragment[] }`，`PassConfig = { name: string, params?: unknown }`。
- Trace 写入：顶层 `Trace.passConfigs` 保存已序列化的 `PassConfig[]`，每个 `PassExecution` 通过 `pass` / index 与对应配置关联。
- 与 ADR-006 联动：`validatePipeline` 接受 `PassConfig[]`，可静态检查 params 是否符合 factory schema。
- 测试用例：
  - 注册带 params 工厂 → 用 params 调用 → 实例化的 Pass 拿到正确参数。
  - 同一 factory 用不同 params 多次调用 → 每次产出独立 Pass 实例。
  - factory 抛错 → trace 记录原始 PassConfig + 错误位置。
