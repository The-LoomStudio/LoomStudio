# Loom Studio 正式架构

本目录记录已经由当前实现和可执行测试证明的稳定架构。它描述 Loom Studio **现在如何工作**，不收录候选方案、路线图或尚未实现的承诺。

## 先选行为链

知道问题后直接进入相关合同，不必遍历全部分类：

- **输入、生成、正文落库、恢复**：[Runtime 与 Session](application/agent/runtime-and-session.md)。用户正文写入、Agent Transcript 与工具副作用不是一个原子事务。
- **提示词顺序、世界书、宏、模型消息**：[PromptBuild](application/prompt-build/README.md)。Agent 使用 Application 编译器；Core 原型已退役。
- **保存、版本冲突、删除、数据归属**：[Data](data/README.md)与[领域生命周期](application/data-capabilities-and-lifecycle.md)。Document Store 不拥有所有领域数据。
- **界面导航、草稿、正文渲染**：[UI](ui/README.md)与[Application UI](application/ui/README.md)。页面状态、业务状态与持久化所有者分开。
- **扩展安装、授权、执行、卸载**：[Extensions](extensions/README.md)。Package 声明、资源安装、Module 激活与某轮实际消费不同。

需要精确文件和测试时回到[需求词与源码路由](../guide/workspace-development.md)，不要依据包名或旧术语猜文件路径。

## 文档晋升规则

```text
对话 / Workbench Plan
  澄清问题与候选方案；需持久记录的开放问题和决策写入 Plan。

Architecture
  依据当前代码与验证结果，提炼已经落地的稳定结论。
```

文档进入本目录前必须满足：

1. 关键边界已经在代码中实现；
2. 非平庸语义有测试覆盖；
3. 文档不包含 `Draft`、`Open Design` 或未落地的未来承诺；
4. 文档与当前 package public API、依赖方向和运行时行为一致。

未落地且仍需推进的问题由当前 Plan / Issue 承接；历史讨论稿和已被取代的正文保留在 `docs/archive/`，不能作为当前施工入口。

## 分类

| 分类 | 正式职责 |
|---|---|
| [`kernel/`](kernel/) | 业务无感知的 Kernel、RPC、事件和平台服务组装边界 |
| [`data/`](data/) | Document、Revision、Changeset、持久化和审计数据边界 |
| [`extensions/`](extensions/) | 平台级 Extension Host、Manifest、生命周期和 SDK 边界 |
| [`platform/`](platform/) | 不属于 Kernel、也不只属于第一方 Application 的共享平台能力 |
| [`application/`](application/) | Studio 第一方 AIRP 领域层，包括 PromptBuild、Agent、Runtime 和默认体验 |
| [`ui/`](ui/) | Studio Shell、通用界面容器和全局 UI 原语 |

各领域的演进统一从 [`Workbench Plans`](../workbench/plans/README.md) 进入，不维护平行的领域讨论目录。

## 权威入口

上方六个分类 README 是正式内容的唯一索引。新增或晋升 Architecture 时，必须同步所属分类 README；根索引不再复制一份容易漂移的专题清单。

未出现在分类 README 中的文件不自动视为未晋升，应先检查同目录文件与当前代码；若发现漏项，修复分类索引，而不是回到旧 Workbench 猜测当前合同。
