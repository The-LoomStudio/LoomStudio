# Platform Architecture

本分类收录不属于 Kernel、也不只服务于第一方 Application 的共享平台能力，例如 AI Gateway、Provider Extension、Credential boundary 和跨应用 Capability Host。

放置判断：

- Kernel 必须理解且负责协调的底层原语进入 [`../kernel/`](../kernel/)；
- 第一方 AIRP 领域语义进入 [`../application/`](../application/)；
- 多种 Application 或 Extension 都可以复用、但不应进入 Kernel 的能力进入本分类。

当前已晋升专题：

- [`logging.md`](logging.md) — Server/Client 统一结构化运行日志、Memory/Console/JSONL Sink、扩展 Logger、历史查询、诊断复制，以及 Application 模型观测与可选快照保留边界。
- [`external-dependency-ownership.md`](external-dependency-ownership.md) — 第三方依赖的能力所有权、状态边界、构建工具与当前未形成的技术合同。

AI Gateway、Credential、跨应用 Capability Host 的旧设计保留在 [`历史讨论归档`](../../archive/discussion/platform/README.md)；当前演进与未决合同由 [Plan](../../workbench/plans/README.md) 承接，归档稿不证明实现。
