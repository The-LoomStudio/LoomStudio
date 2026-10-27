# Tokenizer

`@loom-studio/tokenizer` 统一提供跨端纯文本计数，固定 `gpt-tokenizer@4.0.0` / `o200k_base`，特殊标记按字面处理。`countText(text, { multiplier })` 返回基础计数、向上取整后的估算值和可追溯的计数基准；不要在各调用方另设算法或模型 Tokenizer 注册表。

- 根入口 [`src/index.ts`](./src/index.ts)：同步 `countText` 与倍率换算；AI Gateway 用于[请求 Token 估算](../ai-gateway/src/token-estimate.ts)，Application Runtime 用于[Session 摘要长度约束](../application-runtime/src/agents/session-summary.ts)。
- `@loom-studio/tokenizer/async`：扩展宿主的异步接口；在信号取消时停止等待，单次文本最多 1,000,000 UTF-16 code units，同时最多排队 32 项，见 [`src/async-counter.ts`](./src/async-counter.ts)。
- `@loom-studio/tokenizer/contracts`：仅导出结果/计数接口和倍率辅助，不加载词表，适合只需类型合同的 SDK。

本包不访问资源、模型服务或存储，也不提供 encode/decode 公共 API。AI Gateway 的供应商 Usage 仍来自 Provider；Tokenizer 的估算不替代实际 Usage。
