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

原 Discussion 中仍有独立开放问题的部分可以保留并标记 `Partially Promoted`；已被完整取代的正文进入 `docs/archive/`，不能继续占据活跃入口。

## 分类

| 分类 | 正式职责 | 对应工作台 |
|---|---|---|
| [`kernel/`](kernel/) | 业务无感知的 Kernel、RPC、事件和平台服务组装边界 | [`workbench/discussion/kernel/`](../workbench/discussion/kernel/) |
| [`data/`](data/) | Document、Revision、Changeset、持久化和审计数据边界 | [`workbench/discussion/data/`](../workbench/discussion/data/) |
| [`extensions/`](extensions/) | 平台级 Extension Host、Manifest、生命周期和 SDK 边界 | [`workbench/discussion/extensions/`](../workbench/discussion/extensions/) |
| [`platform/`](platform/) | 不属于 Kernel、也不只属于第一方 Application 的共享平台能力 | [`workbench/discussion/platform/`](../workbench/discussion/platform/) |
| [`application/`](application/) | Studio 第一方 AIRP 领域层，包括 PromptBuild、Agent、Runtime 和默认体验 | [`workbench/discussion/application/`](../workbench/discussion/application/) |
| [`ui/`](ui/) | Studio Shell、通用界面容器和全局 UI 原语 | [`workbench/discussion/ui/`](../workbench/discussion/ui/) |

## 权威入口

上方六个分类 README 是正式内容的唯一索引。新增或晋升 Architecture 时，必须同步所属分类 README；根索引不再复制一份容易漂移的专题清单。

未出现在分类 README 中的文件不自动视为未晋升，应先检查同目录文件与当前代码；若发现漏项，修复分类索引，而不是回到旧 Workbench 猜测当前合同。
