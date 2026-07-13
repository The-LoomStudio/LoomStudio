# Loom Core

`@loom/core` 是同步、线性、可追踪、可重放的 Fragment pipeline engine。在 Loom Studio 的正式文档分类中，它位于 PromptBuild 下面，因为 PromptBuild 是当前第一方 Application 对 Core 的主要领域使用者。

这只是文档归属，不改变技术边界：`packages/core` 是独立 package，public API 不包含 Card、Session、Setting Layer、Prompt、Agent 或 Provider 类型。

## 1. 定位

```text
PromptBuild:
  准备领域输入，定义具体 Pass，解释编译结果。

Loom Core:
  Fragment[] + Pass[] -> Fragment[] + Trace

Provider Adapter:
  把 PromptBuild 产物映射为具体 Provider 请求。
```

Core 是一台中立的“织机”：调用方提供数据碎片和变换规则，Core 保证按声明顺序执行，并记录每一步的结构变化。它不决定碎片代表什么，也不决定最终结果用于哪个模型或应用。

## 2. 设计原则

### 2.1 Engine Does Less

能力只有同时满足以下条件才适合进入 Core：

1. 是纯机械行为，不依赖领域知识；
2. 对不同调用方具有相同语义；
3. 缺少它会让 Fragment pipeline 本身不完整。

排序策略、Activation、预算裁剪、模板、数据源、Provider 输出都不满足这三个条件，因此由 PromptBuild、其他领域包或用户 Pass 负责。

### 2.2 Determinism over Smartness

Core 不自动：

- 猜测 Pass 顺序；
- 并行或重排 Pass；
- 修复非法输入；
- retry、fallback 或自动降级；
- 选择排序、冲突或预算策略。

Core 能保证的是确定的执行顺序；默认开启的 Trace 会记录已完成 Pass 的结构变化。Pass 是否为纯函数仍由 Pass 作者负责，Core 当前不会阻止闭包状态、随机数或时钟读取。

### 2.3 Structure over Semantics

Core 只理解：

- Fragment 的 `id`、`content`、`meta` 外壳；
- Pass 与 Factory 的机械形态；
- Mutation、Trace 和 Diagnostic；
- 保留字段 `meta.__owner`。

除 `meta.__owner` 外，Core 不解释任何 meta 字段。`role`、`priority`、`slot`、`zone`、`activation`、`projection` 等都属于上层约定。

### 2.4 Neutral Boundaries

Core 的输入和输出都是 Fragment 数组。它不承诺：

- 单字符串输出；
- OpenAI-style `messages[]`；
- Anthropic、Gemini 或其他 Provider schema；
- PromptBuild 的 Composition 数据模型；
- Agent 或 Tool 调用结果。

### 2.5 Restraint Enables Observability

Core 不替调用方隐藏冲突或自动合并结果，而是通过 Mutation、Diagnostic 和 Owner Tracking 暴露事实。策略留给上层，因果留在 Trace 中。

## 3. 核心模型

```text
Fragment
  被处理的最小结构单元。

Pass
  同步的 Fragment[] -> Fragment[] 变换。

PassFactory + PassConfig
  按配置创建 Pass instance。

Pipeline / run
  按声明顺序执行 Pass。

Mutation
  表达 add / remove / update / move。

Trace
  保存运行输入、执行记录、Mutation、Diagnostic 和最终状态。
```

详细语义见：

- [`execution-model.md`](execution-model.md)
- [`trace-and-replay.md`](trace-and-replay.md)
- [`studio-integration.md`](studio-integration.md)

## 4. Core 明确不负责

| 能力 | 归属 |
|---|---|
| Card、Session、Setting Layer、Agent | Studio Application |
| Source Adapter 与多数据源合并 | PromptBuild / 调用方 |
| Activation、过滤、排序和 Slot Fill 策略 | Application-owned Pass |
| 模板、宏、变量和 late binding | PromptBuild / 领域工具 |
| Tokenizer 与预算策略 | Provider/领域工具或 Pass |
| Provider-neutral Composition 模型 | PromptBuild |
| Provider request body | Provider Adapter |
| LLM 调用、Streaming、Agent Loop | Application Runtime / Gateway |
| Capability lint | 上层 lint / DevTool；当前 Studio workspace 尚无 `@loom/stdlib` |
| File、HTML、WebSocket、OTel Trace Sink | DevTool / Platform 层 |
| Extension 注册、权限和隔离 | Studio Extension Host |

Core 不提供 Promise/Thunk Content、Scope、Resolve Barrier、异步 Pass 或 Pass 内 IO 接口。这些是早期设计，已经被 Core v0.1 的同步模型取代。

## 5. Public API 面

当前 `@loom/core` public exports 包括：

- Fragment clone 与 validation；
- Diagnostic 类型；
- Mutation diff、apply 与 replay；
- Pass、PassFactory、PassConfig、PassRegistry；
- Trace、TraceCollector、TraceSink 与序列化；
- Owner annotation 与 cross-owner detection；
- `pipeline()`、`run()`、`runPasses()`；
- Pipeline 错误类型与序列化错误；
- `@loom/core/schemas/trace.schema.json`。

跨 package 使用必须从 `@loom/core` public exports 进入，禁止 deep import `packages/core/src/*`。

## 6. Studio 依赖边界

当前只有两个 Studio package 可以直接依赖 `@loom/core`：

```text
packages/application-runtime
  第一方 PromptBuild pipeline。

packages/loom-runner
  面向 Kernel/RPC 的 JSON adapter 与 Trace Audit 集成。
```

Kernel、Document Store、Extension Host、Client 和 ordinary Extension 不应直接依赖 Core internal API。

## 7. 当前实现的事实来源

- [`packages/core/src/index.ts`](../../../../../packages/core/src/index.ts)
- [`packages/core/src/pipeline/runner.ts`](../../../../../packages/core/src/pipeline/runner.ts)
- [`packages/core/test/`](../../../../../packages/core/test/)
- [`packages/application-runtime/src/prompt-build-pipeline.ts`](../../../../../packages/application-runtime/src/prompt-build-pipeline.ts)

历史白皮书、PoC、Accepted ADR 与 Engineering Blueprint 已保存在 [`workbench/archive/loom-project/`](../../../../workbench/archive/loom-project/)。它们解释设计来源，但当前代码和本目录中的正式说明拥有更高权威性。
