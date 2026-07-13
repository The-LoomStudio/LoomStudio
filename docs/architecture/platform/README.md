# Platform Architecture

本分类收录不属于 Kernel、也不只服务于第一方 Application 的共享平台能力，例如 AI Gateway、Provider Extension、Credential boundary 和跨应用 Capability Host。

放置判断：

- Kernel 必须理解且负责协调的底层原语进入 [`../kernel/`](../kernel/)；
- 第一方 AIRP 领域语义进入 [`../application/`](../application/)；
- 多种 Application 或 Extension 都可以复用、但不应进入 Kernel 的能力进入本分类。

当前平台层材料仍处于开放设计阶段，保留在 [`../../workbench/discussion/platform/`](../../workbench/discussion/platform/)。
