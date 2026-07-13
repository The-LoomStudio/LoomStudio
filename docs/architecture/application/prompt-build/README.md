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

## 正式文档

- [`loom-core/README.md`](loom-core/README.md) — Loom Core 定位、设计原则、非目标与 public surface；
- [`loom-core/execution-model.md`](loom-core/execution-model.md) — Fragment、Pass、Registry、错误和 Owner Tracking；
- [`loom-core/trace-and-replay.md`](loom-core/trace-and-replay.md) — Mutation、Trace v1、Diagnostic、Replay 与 DevTool 边界；
- [`loom-core/studio-integration.md`](loom-core/studio-integration.md) — PromptBuild、Loom Runner、Kernel 与 Provider 集成边界。

Structure / Source / Capability、Skeleton、Activation 和动态投影等仍在演进的设计保留于 [`../../../workbench/discussion/application/prompt/`](../../../workbench/discussion/application/prompt/)。只有已经与实现一致的部分才会逐项晋升。
