# Platform Architecture

本分类收录不属于 Kernel、也不只服务于第一方 Application 的共享平台能力，例如 AI Gateway、Provider Extension、Credential boundary 和跨应用 Capability Host。

放置判断：

- Kernel 必须理解且负责协调的底层原语进入 [`../kernel/`](../kernel/)；
- 第一方 AIRP 领域语义进入 [`../application/`](../application/)；
- 多种 Application 或 Extension 都可以复用、但不应进入 Kernel 的能力进入本分类。

## 当前能力入口

共享能力的实现与使用前提就近维护在包 README；这里说明职责分界并提供导航，不再复制一份 API 或依赖清单。

| 能力 | 所有者与下一阅读入口 | 与 Application 的分界 |
| --- | --- | --- |
| 模型请求、流式协议、Provider 适配与 Fake Provider | [AI Gateway](../../../packages/ai-gateway/README.md) | Preset 选择、上下文编排和 Tool Loop 由 Runtime 负责，见 [Provider 与 PromptBuild](../application/agent/provider-and-prompt-build.md) |
| 凭据引用、系统后端与受控借用 | [Secret Store](../../../packages/secret-store/README.md) | Server 注入后端和授权；Provider 配置保留引用，明文不作为 Client DTO |
| 纯文本 Token 计数与轻量/异步入口 | [Tokenizer](../../../packages/tokenizer/README.md) | Client 资源计数与请求估算是消费者，Provider usage 是另一种事实 |
| 结构化运行日志与历史查询 | [Logging](../../../packages/logging/README.md) | 模型观测归 Runtime，canonical Transcript 归 Agent Store，详见下方日志合同 |
| 非阻塞可行动诊断 | [Diagnostics](../../../packages/diagnostics/README.md) | 诊断不充当日志、任务状态或领域持久化 |
| 跨端身份、Schema 与纯逻辑合同 | [Shared](../../../packages/shared/README.md) | 不拥有服务端路由表、领域 Store 或前端状态；主应用方法类型由 Server AppRouter 推导 |

## 跨模块合同

当前已晋升专题：

- [`logging.md`](logging.md) — Server/Client 统一结构化运行日志、Memory/Console/JSONL Sink、扩展 Logger、历史查询、诊断复制，以及 Application 模型观测与可选快照保留边界。
- [`external-dependency-ownership.md`](external-dependency-ownership.md) — 第三方依赖的能力所有权、状态边界、构建工具与当前未形成的技术合同。

AI Gateway、Credential 等旧设计保留在 [`历史讨论归档`](../../archive/discussion/platform/README.md)，不能替代上表中当前包的实现入口。后续演进与未决合同由 [Plan](../../workbench/plans/README.md) 承接。
