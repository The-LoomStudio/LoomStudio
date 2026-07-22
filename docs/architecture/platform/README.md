# Platform Architecture

本分类收录不属于 Kernel、也不只服务于第一方 Application 的共享平台能力，例如 AI Gateway、Provider Extension、Credential boundary 和跨应用 Capability Host。

放置判断：

- Kernel 必须理解且负责协调的底层原语进入 [`../kernel/`](../kernel/)；
- 第一方 AIRP 领域语义进入 [`../application/`](../application/)；
- 多种 Application 或 Extension 都可以复用、但不应进入 Kernel 的能力进入本分类。

当前已晋升专题：

- [`logging.md`](logging.md) — Server/Client 统一结构化运行日志、Memory/Console/JSONL Sink、查询与 Viewer 边界。

AI Gateway、Credential、跨应用 Capability Host 等尚未与实现完全收口的材料继续保留在 [`../../workbench/discussion/platform/`](../../workbench/discussion/platform/) 或对应 Workbench 专题中。
