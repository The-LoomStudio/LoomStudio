# PromptBuild Architecture

PromptBuild 是 Studio Application 中负责把领域数据投影为模型输入的编译能力。

当前稳定边界：

```text
AIRP Documents / Runtime Sources
  -> PromptBuild source preparation
  -> Composition data model
  -> Application-owned Passes
  -> Loom Core execution
  -> Compiled Prompt / Provider Messages
```

PromptBuild 拥有 Card、Setting Layer、Narrative Timeline、Skeleton、Slot、Activation 和 Projection 等领域语义。Loom Core 只执行 Fragment pipeline，不理解这些字段。

当前 Agent Turn 的所有提示词来源都在同一次 Core Pipeline 中编译：Preset / Setting、可选 Narrative Timeline、Agent Session History 和当前输入先由 Application Runtime 准备为 Source Fragment，再交给 `@loom/core` 的第一方 `materialize -> order -> emit` Pass。Timeline 与 Session 不保存 `zoneId`；Runtime 通过稳定的 `chat.history`、`session.history` 和 `chat.inside` Zone/Slot 常量建立挂载关系。

## 正式文档

- [`loom-core/README.md`](loom-core/README.md) — Loom Core 定位、设计原则、非目标与 public surface；
- [`loom-core/execution-model.md`](loom-core/execution-model.md) — Fragment、Pass、Registry、错误和 Owner Tracking；
- [`loom-core/trace-and-replay.md`](loom-core/trace-and-replay.md) — Mutation、Trace v1、Diagnostic、Replay 与 DevTool 边界；
- [`loom-core/studio-integration.md`](loom-core/studio-integration.md) — PromptBuild、Loom Runner、Kernel 与 Provider 集成边界。

Structure / Source / Capability、Skeleton、Activation 和动态投影等仍在演进的设计保留于 [`../../../workbench/discussion/application/prompt/`](../../../workbench/discussion/application/prompt/)。只有已经与实现一致的部分才会逐项晋升。
