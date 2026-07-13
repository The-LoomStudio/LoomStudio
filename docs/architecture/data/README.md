# Data Architecture

本分类用于收录 Loom Studio 已实现并稳定的数据基础语义，包括 Document、Revision、Changeset、持久化、Workspace 同步边界以及 Trace/Audit 数据。

放置规则：

- 与业务无关的持久化原语放在这里；
- Card、Session、Setting Layer 等业务 Document schema 放在 [`../application/`](../application/)；
- Extension 私有 schema 由对应 Extension 负责；
- Kernel 如何通过 RPC 暴露数据能力记录在 [`../kernel/`](../kernel/)；
- UI Undo/Redo history 不等同于 Document Store 的持久化历史。

当前数据层设计过程位于 [`../../workbench/discussion/data/`](../../workbench/discussion/data/)。具体专题在与当前实现逐项核对后再晋升，本目录暂不复制 Draft 文档。
