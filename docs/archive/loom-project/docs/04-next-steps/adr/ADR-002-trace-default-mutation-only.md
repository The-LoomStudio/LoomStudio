# ADR-002: Trace 默认产出 mutation-only，snapshot 仅 opt-in

- **Status**: Accepted
- **Date**: 2026-04-29
- **Promoted from**: [ADR-C-002](../loom-adr-candidates.md#adr-c-002-trace-物质成本)
- **Related**: loom-observability §"零成本默认", studio-architecture §14 Open Question #4

## Context

PoC 阶段 trace 的 `snapshot: 'boundaries'` 默认开启，每个 Pass 边界做一份 fragments 深拷贝。在 1k 次/分钟、平均 10 Pass、平均 fragments 50KB 的真实负载下，常驻成本约 500MB/分钟，在生产环境不可接受。

原候选给出 A/B/C/D 四条路线（全 off / 结构化 diff / retention 策略 / 异步背压），但这四条都没有解决核心张力：

> **可观测性必须默认开才有价值（Sentry/OTel 教训），但 snapshot 全量深拷贝又必然爆成本。**

讨论中明确了 D 路线的真实形态：mutation 已经是 fragment 状态变更的**最小完备记录**，可重放出任意时刻的 snapshot。这意味着 trace 可以在"默认开"和"低成本"之间找到原候选未明确的中间方案。

## Decision

**采纳 D 路线 + A 路线的组合**（在原候选 4 选 1 之外明确扩展）：

- **Mutation 流默认开**：`MemorySink` 在 `loom.run` 中默认启用，记录每个 Pass 产生的 add/remove/update/move mutation。
- **Snapshot 默认 'off'**：`trace.snapshot` 默认值从 `'boundaries'` 改为 `'off'`；保留 `'boundaries' | 'each'` 作为显式 opt-in。
- **DevTool 通过 mutation replay 重建状态**：任意 Pass 时间点的 fragment 全貌由 DevTool 在客户端从"初始 fragments + mutation 流"重放得出，Kernel 不再为重建服务而存 snapshot。

## Consequences

- **正面**：
  - 默认成本估算（同样负载）：~5MB/分钟（mutation-only），是原方案的 ~1%。
  - 集成方在生产环境拿得到现场——线上用户报问题时 Trace 默认就有数据。
  - "可观测性是平台契约"的 Tenet 与"零成本默认"的实现承诺同时维持。
  - Snapshot 仍可显式开启用于深度调试（性能调优、自动化 diff 对比等）。
- **负面 / 已知缺口**：
  - DevTool 必须实现 mutation replay 逻辑，复杂度从"读 snapshot"上升到"重放"。这部分一次性写完后就稳定。
  - Mutation 形态必须严格闭合（任何 fragment 变更必须能被 4 种 mutation 表达），这给 Core 增加了一条隐式约束——但合流测试已验证 14 Pass 都满足。
  - 若 Pass 内部对 fragment 进行非确定性变更（如随机字段），mutation replay 无法 100% 重建。这一类 Pass 视为 anti-pattern，由 ADR-006 的 lint 工具检出。

## Alternatives Considered

- **A. snapshot 默认 'off'（不含 mutation 部分）**：
  - 拒绝原因：等于"默认无可观测性"，对生态有害。
- **B. snapshot 改为结构化 diff**：
  - 实质上就是 mutation——已并入本决策。
- **C. 引入 retention 策略（LRU / 大小上限 / 压缩）**：
  - 不与本决策正交，可作为后续优化叠加（如 mutation 流的 ring buffer）。
- **D. trace 异步写 + 背压**：
  - 解决落盘性能但不解决"500MB/分钟数据本身"的问题；不替代本决策，但可在 FileSink 实现里采纳。

## Implementation Notes

- `Trace.snapshot` 默认值改为 `'off'`。
- `MemorySink` 默认实例化并附着到每个 `loom.run`。
- 在 loom-observability 文档中新增 "Mutation Replay" 章节，定义重放语义。
- 后续 Spike：在 DevTool CLI v0.1 中实现 mutation replay，验证 14 Pass 真实场景重建一致。
- **Sink 归属调整（2026-04-29，与 [`loom-devtool-layered.md`](../../02-architecture/loom-devtool-layered.md) 同步）**：
  - Layer 1（`@loom/core`）只保留 `NullSink` / `MemorySink` / `ConsoleSink`（无颜色）。
  - **`FileSink` 移到 Layer 2（`@loom/devtool`）**，理由：依赖 Node `fs`，破坏运行时中立。
  - WebSocket / OTel / HTTP Sink 一律放 Layer 2 或更上层。
  - `MemorySink` 默认开启时**应有内存上限**（建议默认 ring buffer 1000 个 PassExecution，可配置），避免长跑 Pipeline 的内存爆炸——这是本 ADR 的实施补丁。
