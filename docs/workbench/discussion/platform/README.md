# Platform Layer 文档区

> **Status**: Open Design
> **Purpose**: 收纳不属于 Kernel、也不只属于 Studio Application 的平台级能力设计。

---

## 1. 定位

Platform Layer 承载跨应用、跨插件、跨运行时复用的基础能力。

它不是 Kernel public surface，也不是普通 Application 领域模型。典型能力包括：

```text
AI Gateway / Provider Extension
Secret / Credential boundary
Extension contribution registry
workspace-level settings / profiles
cross-application capability host
```

Studio Application 可以消费这些能力，但不拥有这些能力的完整边界。

---

## 2. 文档索引

| 文件 | 状态 | 目的 |
|---|---|---|
| [`ai-gateway-and-provider-extension-v0.md`](ai-gateway-and-provider-extension-v0.md) | Open Design | AI Gateway、Provider Extension、Model Profile、统一配置面板与网络收发边界 |

