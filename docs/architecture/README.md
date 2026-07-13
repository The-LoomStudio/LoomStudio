# Loom Studio 正式架构

本目录记录已经由当前实现和可执行测试证明的稳定架构。它描述 Loom Studio **现在如何工作**，不收录候选方案、路线图或尚未实现的承诺。

## 文档晋升规则

```text
Workbench Discussion
  记录问题、候选方案、开放设计和演进过程。

Architecture
  从 Discussion 与代码中提炼已经落地的稳定结论。
```

文档进入本目录前必须满足：

1. 关键边界已经在代码中实现；
2. 非平庸语义有测试覆盖；
3. 文档不包含 `Draft`、`Open Design` 或未落地的未来承诺；
4. 文档与当前 package public API、依赖方向和运行时行为一致。

原 Discussion 文档不会因晋升而删除。它继续保留设计过程，但不能覆盖本目录中的当前事实。

## 分类

| 分类 | 正式职责 | 对应工作台 |
|---|---|---|
| [`kernel/`](kernel/) | 业务无感知的 Kernel、RPC、事件和平台服务组装边界 | [`workbench/discussion/kernel/`](../workbench/discussion/kernel/) |
| [`data/`](data/) | Document、Revision、Changeset、持久化和审计数据边界 | [`workbench/discussion/data/`](../workbench/discussion/data/) |
| [`extensions/`](extensions/) | 平台级 Extension Host、Manifest、生命周期和 SDK 边界 | [`workbench/discussion/extensions/`](../workbench/discussion/extensions/) |
| [`platform/`](platform/) | 不属于 Kernel、也不只属于第一方 Application 的共享平台能力 | [`workbench/discussion/platform/`](../workbench/discussion/platform/) |
| [`application/`](application/) | Studio 第一方 AIRP 领域层，包括 PromptBuild、Agent、Runtime 和默认体验 | [`workbench/discussion/application/`](../workbench/discussion/application/) |
| [`ui/`](ui/) | Studio Shell、通用界面容器和全局 UI 原语 | [`workbench/discussion/ui/`](../workbench/discussion/ui/) |

## 当前已晋升内容

- [`kernel/README.md`](kernel/README.md) — Studio Kernel 当前架构；
- [`application/prompt-build/loom-core/`](application/prompt-build/loom-core/) — PromptBuild 使用的 Loom Core 执行底座、Trace 协议与 Studio 集成边界。

没有列在这里的专题仍应先从 [`../workbench/`](../workbench/) 查阅，并以当前代码为最终依据。
