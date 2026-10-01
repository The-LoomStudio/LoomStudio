# Tokenizer

跨端纯文本计数：固定 `gpt-tokenizer@4.0.0` / `o200k_base`，特殊标记按字面处理。
`countText(text, { multiplier })` 保留基础整数、向上取整估算与展开后的基准。
`contracts` 入口不加载词表，支持派生合计只换算一次。

不访问资源、模型服务或存储，不提供多 tokenizer 注册和 encode/decode 公共 API。
扩展宿主单次输入上限为一百万 UTF-16 code units，待处理上限为 32。
