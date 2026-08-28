# ADR-007: 移除 Resolve Barrier，Pipeline 回归纯同步

- **Status**: Accepted
- **Date**: 2026-04-29
- **Promoted from**: [ADR-C-007](../loom-adr-candidates.md#adr-c-007-resolve-barrier-设计闲置)

## Context

合流测试发现 `@loom/st` 的 14 个真实 Pass **全部同步执行**，从未触发 Resolve Barrier 设计——`run()` 全部为同步函数，没有 `PipelineResult` 返回，也没有出现"最多一个 resolve barrier"的实际使用。

Resolve Barrier 是早期为应对"Pass 内部需要异步 IO"而引入的复杂概念，但合流测试给出了相反的真实信号：

> **Pass 是确定性数据变换，异步是 IO，混在一起违反"Determinism over Smartness"。**

异步的合理位置是 RPC（Pass 之外的 IO 边界），不是 Pass 内部。Pass 的输入应已是"准备好的数据"——这与 ADR-005 的 PassConfig + params 模型天然契合：需要异步数据的 Pass 通过客户端 RPC 拿到结果，再以 params 注入。

## Decision

**采纳 B 路线**：移除 Resolve Barrier，Pipeline 回归纯同步处理。

具体规格：

1. **`Pipeline.run()` 类型收紧**：
   ```ts
   // Before
   run(fragments: Fragment[]): Fragment[] | Promise<Fragment[]>
   
   // After
   run(fragments: Fragment[]): Fragment[]
   ```
2. **`Pass.run()` 类型收紧**：同上，纯同步。
3. **Core 不保留 Thunk content**：
   - `Fragment.content` 在 Core v0.1 中只接受 `string`。
   - Core 不定义 `meta.thunk`、`ScopeContext` 或任何 late-binding 求值阶段。
   - 若领域层需要 lazy / template / macro / late binding，必须在进入 Core 前转成 `content: string`，或作为领域包 / Source Adapter / 用户态 Pass 的私有语义处理。
4. **异步 IO 全部前移到 RPC 层**：需要数据库 / 文件 / 网络的 Pass，必须先由客户端通过 RPC 取数据 → 注入到 PassConfig.params 中（参见 ADR-005）。

## Consequences

- **正面**：
  - Pipeline 执行模型从"四阶段（Source / Compile / Resolve Barrier / Emit）"简化为"线性同步 Pass 链"。
  - 类型签名干净：`Fragment[] => Fragment[]`，可直接放进 Worker、Edge Runtime、可重入并发执行。
  - Pass 作者每写一个 Pass 都不用思考"我会不会触发 barrier"。
  - 与 ADR-005 形成的"params 化 Source Pass"模型一致——异步 IO 由客户端在准备 params 时完成。
  - 与 ADR-002 的 mutation-only trace 配合，整次 `loom.run` 是同步、确定、可重放的纯函数。
- **负面 / 已知缺口**：
  - 失去"Pass 内部直接异步 IO"的能力——但这本来就是 anti-pattern（不可重放、引入非确定性）。
  - 任何遗留的 async Pass 设计稿需要重写为 RPC + params 模式；目前 14 个真实 Pass 没有此问题。
  - 若未来真出现"必须在 Pass 链中间异步"的需求（暂未观察到），重新引入 barrier 的成本不会比现在更低，可届时另起 ADR。

## Alternatives Considered

- **A. 维持设计，以备未来复杂场景需要**：
  - 拒绝原因：YAGNI；当前真实信号已饱和指向"用不到"，留着是技术债，且每个新 Pass 作者都要消化这个未使用的概念。

## Implementation Notes

- Core 改动：
  - `Pipeline.run` 移除 `Promise<Fragment[]>` 返回路径。
  - 移除 `PipelineResult` 类型（如存在）。
  - 移除 "resolve barrier" 相关调度逻辑。
  - 移除 `Promise<string>` content、content thunk、`meta.thunk` 与 `ScopeContext`。
- 文档侧：
  - 白皮书 §"执行模型"段落删除 Resolve Barrier 描述。
  - 白皮书 / Scope 文档中涉及 Promise content、thunk、Resolve Barrier、Core Scope 的内容均标记为历史设计，不作为 v0.1 实现依据。
  - Studio architecture §"loom.run 的纯函数化" 加一段说明 Pass 链全同步。
- 测试用例：
  - Pass 返回 Promise → 编译期被 TS 拒绝（运行时若发生则抛错）。
  - 14 个 ST Pass 全数迁移后回归测试通过（已在 PoC 验证为同步）。
- 与 ADR-005 联动：PassFactory 必须同步返回 Pass 实例（params 解析也是同步）。
